import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "0.1";

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function validateSource(input) {
    if (input?.schema_version !== SCHEMA_VERSION) {
        throw new Error(`input schema_version must be ${SCHEMA_VERSION}`);
    }
    requireString(input.batch_id, "batch_id");
    if (
        typeof input.deterministic_confidence_threshold !== "number" ||
        !Number.isFinite(input.deterministic_confidence_threshold)
    ) {
        throw new Error(
            "deterministic_confidence_threshold must be numeric"
        );
    }
    if (
        !Array.isArray(input.allowed_owners) ||
        input.allowed_owners.length === 0 ||
        new Set(input.allowed_owners).size !== input.allowed_owners.length
    ) {
        throw new Error("allowed_owners must contain unique values");
    }
    if (
        !Array.isArray(input.severity_order) ||
        input.severity_order.length === 0 ||
        new Set(input.severity_order).size !== input.severity_order.length
    ) {
        throw new Error("severity_order must contain unique values");
    }
    if (!input.owner_taxonomy || typeof input.owner_taxonomy !== "object") {
        throw new Error("owner_taxonomy is required");
    }
    for (const owner of input.allowed_owners) {
        requireString(owner, "allowed owner");
        requireString(input.owner_taxonomy[owner], `taxonomy for ${owner}`);
    }
    if (!Array.isArray(input.findings)) {
        throw new Error("findings must be an array");
    }

    const owners = new Set(input.allowed_owners);
    const severities = new Set(input.severity_order);
    const ids = new Set();
    for (const [index, finding] of input.findings.entries()) {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
            throw new Error(`finding ${index + 1} must be an object`);
        }
        requireString(finding.id, `finding ${index + 1}.id`);
        requireString(
            finding.description,
            `finding ${finding.id}.description`
        );
        requireString(finding.severity, `finding ${finding.id}.severity`);
        if (ids.has(finding.id)) {
            throw new Error(`duplicate finding id ${finding.id}`);
        }
        ids.add(finding.id);
        if (!severities.has(finding.severity)) {
            throw new Error(
                `finding ${finding.id} uses unknown severity ${finding.severity}`
            );
        }
        if (
            finding.owner_hint !== null &&
            !owners.has(finding.owner_hint)
        ) {
            throw new Error(
                `finding ${finding.id} uses unknown owner_hint`
            );
        }
        if (
            typeof finding.owner_hint_confidence !== "number" ||
            !Number.isFinite(finding.owner_hint_confidence)
        ) {
            throw new Error(
                `finding ${finding.id} requires owner_hint_confidence`
            );
        }
    }
}

function partitionFindings(input) {
    const threshold = input.deterministic_confidence_threshold;
    const owners = new Set(input.allowed_owners);
    const resolved = [];
    const residual = [];
    for (const finding of input.findings) {
        if (
            owners.has(finding.owner_hint) &&
            finding.owner_hint_confidence >= threshold
        ) {
            resolved.push({
                id: finding.id,
                owner: finding.owner_hint,
                severity: finding.severity
            });
        } else {
            residual.push({
                id: finding.id,
                severity: finding.severity,
                description: finding.description
            });
        }
    }
    return { resolved, residual };
}

export function buildResidualInput(input) {
    validateSource(input);
    const { residual } = partitionFindings(input);
    return {
        schema_version: SCHEMA_VERSION,
        batch_id: input.batch_id,
        allowed_owners: input.allowed_owners,
        owner_taxonomy: input.owner_taxonomy,
        residual_findings: residual
    };
}

function validateRoutes(input, residual) {
    if (input?.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `residual routes schema_version must be ${SCHEMA_VERSION}`
        );
    }
    if (!Array.isArray(input.routes)) {
        throw new Error("residual routes must contain routes");
    }
    const residualIds = new Set(residual.map((finding) => finding.id));
    const owners = new Set(
        input.allowed_owners ?? []
    );
    const expectedOwners = owners.size > 0 ? owners : null;
    const routes = new Map();
    for (const [index, route] of input.routes.entries()) {
        if (!route || typeof route !== "object" || Array.isArray(route)) {
            throw new Error(`route ${index + 1} must be an object`);
        }
        requireString(route.id, `route ${index + 1}.id`);
        requireString(route.owner, `route ${route.id}.owner`);
        if (!residualIds.has(route.id)) {
            throw new Error(`route ${route.id} is not a residual finding`);
        }
        if (routes.has(route.id)) {
            throw new Error(`duplicate route ${route.id}`);
        }
        if (expectedOwners && !expectedOwners.has(route.owner)) {
            throw new Error(`route ${route.id} uses unknown owner`);
        }
        routes.set(route.id, route.owner);
    }
    if (routes.size !== residual.length) {
        throw new Error("residual routes must cover every residual finding");
    }
    return routes;
}

export function buildHybridResult(source, residualRoutes) {
    validateSource(source);
    const { resolved, residual } = partitionFindings(source);
    const routesInput = {
        ...residualRoutes,
        allowed_owners: source.allowed_owners
    };
    const routes = validateRoutes(routesInput, residual);
    const severityRank = new Map(
        source.severity_order.map((severity, index) => [severity, index])
    );
    const routed = [
        ...resolved,
        ...residual.map((finding) => ({
            id: finding.id,
            owner: routes.get(finding.id),
            severity: finding.severity
        }))
    ];
    const batches = source.allowed_owners
        .map((owner) => {
            const findings = routed
                .filter((finding) => finding.owner === owner)
                .sort((left, right) => {
                    const severityDelta =
                        severityRank.get(left.severity) -
                        severityRank.get(right.severity);
                    return severityDelta !== 0
                        ? severityDelta
                        : left.id.localeCompare(right.id);
                });
            const counts = Object.fromEntries(
                source.severity_order.map((severity) => [
                    severity,
                    findings.filter(
                        (finding) => finding.severity === severity
                    ).length
                ])
            );
            counts.total = findings.length;
            return {
                owner,
                finding_ids: findings.map((finding) => finding.id),
                counts
            };
        })
        .filter((batch) => batch.finding_ids.length > 0);
    return {
        schema_version: SCHEMA_VERSION,
        batch_id: source.batch_id,
        batches,
        summary: {
            input_findings: source.findings.length,
            deterministic_findings: resolved.length,
            residual_findings: residual.length,
            owners: batches.length
        }
    };
}

export function buildHybridResultFromMergeInput(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("merge input must be an object");
    }
    return buildHybridResult(input.source, input.residual_routes);
}

async function main() {
    const [mode, sourcePath, routesOrOutputPath, outputPath] =
        process.argv.slice(2);
    if (mode === "preprocess" && sourcePath && routesOrOutputPath) {
        const source = JSON.parse(await readFile(sourcePath, "utf8"));
        await writeFile(
            routesOrOutputPath,
            `${JSON.stringify(buildResidualInput(source), null, 2)}\n`,
            "utf8"
        );
        return;
    }
    if (
        mode === "merge" &&
        sourcePath &&
        routesOrOutputPath &&
        outputPath
    ) {
        const [source, routes] = await Promise.all([
            readFile(sourcePath, "utf8").then(JSON.parse),
            readFile(routesOrOutputPath, "utf8").then(JSON.parse)
        ]);
        await writeFile(
            outputPath,
            `${JSON.stringify(buildHybridResult(source, routes), null, 2)}\n`,
            "utf8"
        );
        return;
    }
    throw new Error(
        "usage: node prepare-hybrid.mjs preprocess <source.json> <residual.json> OR merge <source.json> <routes.json> <result.json>"
    );
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
