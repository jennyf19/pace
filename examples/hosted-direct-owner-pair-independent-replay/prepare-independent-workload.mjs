import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildHybridResult } from "../hosted-hybrid-replay/prepare-hybrid.mjs";

const SCHEMA_VERSION = "0.1";

export const OWNER_TAXONOMY = Object.freeze({
    network:
        "DNS, routing, firewalls, TLS, load balancing, packet flow, gateways, and network policy",
    database:
        "queries, indexes, transactions, replication, backups, schemas, connection pools, and data durability",
    frontend:
        "browser rendering, DOM, CSS, JavaScript bundles, accessibility, client caching, hydration, and service workers",
    observability:
        "logs, metrics, traces, alerts, dashboards, telemetry pipelines, sampling, and retention",
    deployment:
        "builds, packages, artifacts, rollouts, feature flags, environments, release orchestration, and provenance"
});

export const FINDINGS_BY_OWNER = Object.freeze({
    network: Object.freeze([
        ["high", "DNS resolver returns stale records after regional failover."],
        ["critical", "TLS gateway rejects clients after certificate rotation."],
        ["high", "Load balancer health probe targets a retired port."],
        ["critical", "Route table sends private subnet traffic through a public gateway."],
        ["critical", "Firewall rule permits management traffic from the internet."],
        ["medium", "NAT pool exhausts ephemeral ports during traffic bursts."],
        ["high", "BGP advertisement intermittently withdraws the service prefix."],
        ["medium", "Packet fragmentation drops requests across the encrypted tunnel."]
    ]),
    database: Object.freeze([
        ["medium", "Query planner ignores a selective index after statistics refresh."],
        ["high", "Read replica serves stale rows after primary failover."],
        ["critical", "Lock escalation blocks checkout writes across the hot table."],
        ["high", "Connection pool leaks sessions after request timeout."],
        ["critical", "Point-in-time restore omits the latest log segment."],
        ["high", "Schema migration rewrites the hot table without online mode."],
        ["medium", "Index bloat causes periodic query latency spikes."],
        ["critical", "Retention job deletes rows still referenced by the audit ledger."]
    ]),
    frontend: Object.freeze([
        ["high", "Hydration mismatch duplicates interactive controls after page load."],
        ["critical", "Service worker caches a revoked session response."],
        ["medium", "CSS stacking order hides the consent dialog behind the shell."],
        ["high", "Bundle splitting omits the locale chunk for first-time visitors."],
        ["high", "Keyboard focus escapes the modal and traps screen-reader users."],
        ["medium", "Browser cache serves an obsolete feature-flag configuration."],
        ["critical", "DOM event handler submits the payment form twice."],
        ["medium", "Client source map exposes internal module paths in production."]
    ]),
    observability: Object.freeze([
        ["critical", "Trace sampling drops every failed checkout request."],
        ["high", "Metric label cardinality overwhelms the ingestion pipeline."],
        ["high", "Log parser truncates the request correlation identifier."],
        ["critical", "Alert threshold suppresses a sustained error-rate increase."],
        ["medium", "Dashboard aggregates two regions into the wrong service total."],
        ["medium", "Telemetry exporter retries and emits duplicate spans."],
        ["critical", "Retention policy expires audit traces before investigation completes."],
        ["high", "Clock skew misorders spans across dependent services."]
    ]),
    deployment: Object.freeze([
        ["critical", "Canary rollout advances despite a failed health gate."],
        ["critical", "Feature flag targets the production tenant during a test rollout."],
        ["high", "Build artifact is published without provenance metadata."],
        ["critical", "Package promotion reuses an unsigned artifact from staging."],
        ["high", "Environment substitution writes a staging endpoint into production."],
        ["high", "Rollback restores the binary but not its matching configuration."],
        ["medium", "Release orchestration skips one region without failing the job."],
        ["critical", "Release lock expires while a schema migration is still running."]
    ])
});

const OWNER_ORDER_BY_ROUND = Object.freeze([
    Object.freeze(["network", "database", "frontend", "observability", "deployment"]),
    Object.freeze(["frontend", "network", "deployment", "database", "observability"]),
    Object.freeze(["deployment", "observability", "network", "frontend", "database"]),
    Object.freeze(["database", "deployment", "observability", "network", "frontend"]),
    Object.freeze(["observability", "frontend", "database", "deployment", "network"]),
    Object.freeze(["network", "observability", "frontend", "database", "deployment"]),
    Object.freeze(["database", "network", "observability", "deployment", "frontend"]),
    Object.freeze(["frontend", "deployment", "database", "observability", "network"])
]);

function buildRecords() {
    const indexes = Object.fromEntries(
        Object.keys(OWNER_TAXONOMY).map((owner) => [owner, 0])
    );
    const records = [];
    for (const owners of OWNER_ORDER_BY_ROUND) {
        for (const owner of owners) {
            const findingIndex = indexes[owner];
            const [severity, description] =
                FINDINGS_BY_OWNER[owner][findingIndex];
            indexes[owner] += 1;
            records.push({
                id: `W${String(records.length + 1).padStart(3, "0")}`,
                owner,
                severity,
                description
            });
        }
    }
    return records;
}

export function buildIndependentSource() {
    return {
        schema_version: SCHEMA_VERSION,
        batch_id: "synthetic-independent-routing-040",
        deterministic_confidence_threshold: 1,
        allowed_owners: Object.keys(OWNER_TAXONOMY),
        severity_order: ["critical", "high", "medium", "low"],
        owner_taxonomy: OWNER_TAXONOMY,
        findings: buildRecords().map((record) => ({
            id: record.id,
            severity: record.severity,
            description: record.description,
            owner_hint: null,
            owner_hint_confidence: 0
        }))
    };
}

export function buildIndependentGroundTruth() {
    return {
        schema_version: SCHEMA_VERSION,
        routes: buildRecords().map((record) => ({
            id: record.id,
            owner: record.owner
        }))
    };
}

export function buildIndependentExpectedResult() {
    return buildHybridResult(
        buildIndependentSource(),
        buildIndependentGroundTruth()
    );
}

async function main() {
    const [outputDirectory] = process.argv.slice(2);
    if (!outputDirectory) {
        throw new Error(
            "usage: node prepare-independent-workload.mjs <output-directory>"
        );
    }
    await mkdir(outputDirectory, { recursive: true });
    const artifacts = [
        ["baseline-input.json", buildIndependentSource()],
        ["ground-truth-routes.json", buildIndependentGroundTruth()],
        ["expected-result.json", buildIndependentExpectedResult()]
    ];
    await Promise.all(
        artifacts.map(([name, value]) =>
            writeFile(
                join(outputDirectory, name),
                `${JSON.stringify(value, null, 2)}\n`,
                "utf8"
            )
        )
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
