import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
    buildHybridResult,
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../hosted-hybrid-replay/prepare-hybrid.mjs";

export const LABEL_TAXONOMY = Object.freeze({
    "identity-access":
        "sign-in, MFA, password reset, OAuth and workload tokens, federation, authentication telemetry, token lifetime, and risk signals",
    "identity-governance":
        "conditional access policy, app and service-principal privilege, administrator roles, access reviews, account ownership, and identity governance",
    "storage-access":
        "storage authentication, keys, encryption, anonymous access, protocols, SAS tokens, ACLs, and authorization telemetry",
    "storage-lifecycle":
        "retention, legal hold, backup, replication, archive, snapshot inventory, delete markers, and data residency",
    "compute-runtime":
        "hypervisors, containers, images, attestation, host networking, metadata endpoints, node quarantine, and runtime isolation",
    "compute-capacity":
        "health probes, autoscale, scheduling, CPU, memory, GPU allocation, quotas, and resource inventory",
    "messaging-control":
        "authorization, producer identity, checkpoint policy, filters, privileged replay, retention controls, and ownership",
    "messaging-delivery":
        "locks, retries, failover, replication, forwarding, partitions, duplicate delivery, and deduplication"
});

export const SYMBOL_BY_LABEL = Object.freeze({
    "identity-access": "a",
    "identity-governance": "b",
    "storage-access": "c",
    "storage-lifecycle": "d",
    "compute-runtime": "e",
    "compute-capacity": "f",
    "messaging-control": "g",
    "messaging-delivery": "h"
});

export const LABEL_BY_SYMBOL = Object.freeze(
    Object.fromEntries(
        Object.entries(SYMBOL_BY_LABEL).map(([label, symbol]) => [
            symbol,
            label
        ])
    )
);

export const FINDING_IDS_BY_LABEL = Object.freeze({
    "identity-access": Object.freeze([
        "H005",
        "H017",
        "H029",
        "H033",
        "H041",
        "H045",
        "H057",
        "H061"
    ]),
    "identity-governance": Object.freeze([
        "H001",
        "H009",
        "H013",
        "H021",
        "H025",
        "H037",
        "H049",
        "H053"
    ]),
    "storage-access": Object.freeze([
        "H002",
        "H006",
        "H014",
        "H018",
        "H026",
        "H038",
        "H046",
        "H062"
    ]),
    "storage-lifecycle": Object.freeze([
        "H010",
        "H022",
        "H030",
        "H034",
        "H042",
        "H050",
        "H054",
        "H058"
    ]),
    "compute-runtime": Object.freeze([
        "H007",
        "H015",
        "H027",
        "H031",
        "H035",
        "H039",
        "H047",
        "H055"
    ]),
    "compute-capacity": Object.freeze([
        "H003",
        "H011",
        "H019",
        "H023",
        "H043",
        "H051",
        "H059",
        "H063"
    ]),
    "messaging-control": Object.freeze([
        "H004",
        "H016",
        "H032",
        "H036",
        "H040",
        "H044",
        "H052",
        "H064"
    ]),
    "messaging-delivery": Object.freeze([
        "H008",
        "H012",
        "H020",
        "H024",
        "H028",
        "H048",
        "H056",
        "H060"
    ])
});

const LABEL_BY_FINDING_ID = Object.freeze(
    Object.fromEntries(
        Object.entries(FINDING_IDS_BY_LABEL).flatMap(
            ([label, findingIds]) =>
                findingIds.map((findingId) => [findingId, label])
        )
    )
);

function validateSource(input) {
    if (!Array.isArray(input?.findings) || input.findings.length !== 64) {
        throw new Error("symbolic-label source must contain 64 findings");
    }
    const sourceIds = input.findings.map((finding) => finding.id);
    const mappedIds = Object.keys(LABEL_BY_FINDING_ID);
    if (
        new Set(sourceIds).size !== 64 ||
        mappedIds.length !== 64 ||
        sourceIds.some((findingId) => !LABEL_BY_FINDING_ID[findingId])
    ) {
        throw new Error("symbolic-label mapping must cover every finding");
    }
}

export function buildEightLabelSource(input) {
    validateSource(input);
    return {
        ...input,
        batch_id: "synthetic-symbolic-routing-064",
        allowed_owners: Object.keys(LABEL_TAXONOMY),
        owner_taxonomy: LABEL_TAXONOMY,
        findings: input.findings.map((finding) => ({
            ...finding,
            owner_hint: null,
            owner_hint_confidence: 0
        }))
    };
}

export function buildGroundTruthRoutes(input) {
    validateSource(input);
    return {
        schema_version: "0.1",
        routes: input.findings.map((finding) => ({
            id: finding.id,
            owner: LABEL_BY_FINDING_ID[finding.id]
        }))
    };
}

export function buildFullLabelResidualInput(input) {
    return buildResidualInput(input);
}

export function buildSymbolicLabelResidualInput(input) {
    const residual = buildResidualInput(input);
    return {
        ...residual,
        allowed_owners: residual.allowed_owners.map((label) => {
            const symbol = SYMBOL_BY_LABEL[label];
            if (!symbol) {
                throw new Error(`label ${label} does not have a symbol`);
            }
            return symbol;
        }),
        owner_taxonomy: Object.fromEntries(
            residual.allowed_owners.map((label) => [
                SYMBOL_BY_LABEL[label],
                residual.owner_taxonomy[label]
            ])
        )
    };
}

export function buildNamedSymbolicLabelResidualInput(input) {
    const residual = buildSymbolicLabelResidualInput(input);
    return {
        ...residual,
        owner_taxonomy: Object.fromEntries(
            input.allowed_owners.map((label) => [
                SYMBOL_BY_LABEL[label],
                `${label}: ${input.owner_taxonomy[label]}`
            ])
        )
    };
}

export function buildFullLabelResultFromMergeInput(input) {
    return buildHybridResultFromMergeInput(input);
}

export function decodeSymbolicLabelMergeInput(input) {
    if (!input?.residual_routes?.routes) {
        throw new Error("symbolic merge input requires residual routes");
    }
    const decodedRoutes = input.residual_routes.routes.map((route) => {
        const label = LABEL_BY_SYMBOL[route.owner];
        if (!label) {
            throw new Error(`unknown label symbol ${route.owner}`);
        }
        return {
            ...route,
            owner: label
        };
    });
    return buildHybridResultFromMergeInput({
        source: input.source,
        residual_routes: {
            ...input.residual_routes,
            routes: decodedRoutes
        }
    });
}

export function buildExpectedResult(input) {
    const source = buildEightLabelSource(input);
    return buildHybridResult(source, buildGroundTruthRoutes(source));
}

async function main() {
    const [sourcePath, outputDirectory] = process.argv.slice(2);
    if (!sourcePath || !outputDirectory) {
        throw new Error(
            "usage: node prepare-symbolic-label.mjs <source.json> <output-directory>"
        );
    }
    const source = JSON.parse(await readFile(sourcePath, "utf8"));
    const transformed = buildEightLabelSource(source);
    const routes = buildGroundTruthRoutes(transformed);
    const expected = buildHybridResult(transformed, routes);
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
        writeFile(
            join(outputDirectory, "baseline-input.json"),
            `${JSON.stringify(transformed, null, 2)}\n`,
            "utf8"
        ),
        writeFile(
            join(outputDirectory, "ground-truth-routes.json"),
            `${JSON.stringify(routes, null, 2)}\n`,
            "utf8"
        ),
        writeFile(
            join(outputDirectory, "expected-result.json"),
            `${JSON.stringify(expected, null, 2)}\n`,
            "utf8"
        )
    ]);
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
