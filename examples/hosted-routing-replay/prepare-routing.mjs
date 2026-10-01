import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "0.1";

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function validateRule(rule) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        throw new Error("input requires routing_rule");
    }
    if (
        !Array.isArray(rule.eligible_states) ||
        rule.eligible_states.some(
            (state) => typeof state !== "string" || !state.trim()
        )
    ) {
        throw new Error("routing_rule.eligible_states must be strings");
    }
    if (typeof rule.suppressed !== "boolean") {
        throw new Error("routing_rule.suppressed must be boolean");
    }
    if (
        !Array.isArray(rule.severity_order) ||
        rule.severity_order.length === 0 ||
        new Set(rule.severity_order).size !== rule.severity_order.length
    ) {
        throw new Error(
            "routing_rule.severity_order must contain unique severities"
        );
    }
    for (const severity of rule.severity_order) {
        requireString(severity, "routing_rule severity");
        requireString(
            rule.priority_by_severity?.[severity],
            `routing_rule priority for ${severity}`
        );
    }
    if (
        JSON.stringify(rule.winner_order) !==
            JSON.stringify([
                "severity",
                "confidence_descending",
                "id_ascending"
            ]) ||
        JSON.stringify(rule.finding_order) !==
            JSON.stringify(["severity", "id_ascending"]) ||
        JSON.stringify(rule.batch_order) !==
            JSON.stringify(["priority", "owner_ascending"])
    ) {
        throw new Error("unsupported routing order");
    }
}

function compareWinner(left, right, severityRank) {
    const severityDelta =
        severityRank.get(left.severity) - severityRank.get(right.severity);
    if (severityDelta !== 0) return severityDelta;
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) return confidenceDelta;
    return left.id.localeCompare(right.id);
}

export function buildRoutingResult(input) {
    if (input?.schema_version !== SCHEMA_VERSION) {
        throw new Error(`input schema_version must be ${SCHEMA_VERSION}`);
    }
    const batchId = requireString(input.batch_id, "batch_id");
    validateRule(input.routing_rule);
    if (!Array.isArray(input.findings)) {
        throw new Error("input requires findings");
    }

    const rule = input.routing_rule;
    const eligibleStates = new Set(rule.eligible_states);
    const severityRank = new Map(
        rule.severity_order.map((severity, index) => [severity, index])
    );
    const ids = new Set();
    const eligible = [];
    for (const [index, finding] of input.findings.entries()) {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
            throw new Error(`finding ${index + 1} must be an object`);
        }
        for (const field of [
            "id",
            "fingerprint",
            "owner",
            "severity",
            "state"
        ]) {
            requireString(finding[field], `finding ${index + 1}.${field}`);
        }
        if (ids.has(finding.id)) {
            throw new Error(`duplicate finding id ${finding.id}`);
        }
        ids.add(finding.id);
        if (!severityRank.has(finding.severity)) {
            throw new Error(
                `finding ${finding.id} uses unknown severity ${finding.severity}`
            );
        }
        if (
            typeof finding.confidence !== "number" ||
            !Number.isFinite(finding.confidence)
        ) {
            throw new Error(`finding ${finding.id} requires confidence`);
        }
        if (typeof finding.suppressed !== "boolean") {
            throw new Error(`finding ${finding.id} requires suppressed`);
        }
        if (
            eligibleStates.has(finding.state) &&
            finding.suppressed === rule.suppressed
        ) {
            eligible.push(finding);
        }
    }

    const byFingerprint = new Map();
    for (const finding of eligible) {
        const group = byFingerprint.get(finding.fingerprint) ?? [];
        group.push(finding);
        byFingerprint.set(finding.fingerprint, group);
    }
    const selected = [...byFingerprint.values()].map(
        (group) => [...group].sort((left, right) =>
            compareWinner(left, right, severityRank)
        )[0]
    );

    const byOwner = new Map();
    for (const finding of selected) {
        const group = byOwner.get(finding.owner) ?? [];
        group.push(finding);
        byOwner.set(finding.owner, group);
    }
    const priorityRank = new Map(
        rule.severity_order.map((severity, index) => [
            rule.priority_by_severity[severity],
            index
        ])
    );
    const batches = [...byOwner.entries()]
        .map(([owner, findings]) => {
            const sorted = [...findings].sort((left, right) => {
                const severityDelta =
                    severityRank.get(left.severity) -
                    severityRank.get(right.severity);
                return severityDelta !== 0
                    ? severityDelta
                    : left.id.localeCompare(right.id);
            });
            const counts = Object.fromEntries(
                rule.severity_order.map((severity) => [
                    severity,
                    sorted.filter(
                        (finding) => finding.severity === severity
                    ).length
                ])
            );
            counts.total = sorted.length;
            return {
                owner,
                priority: rule.priority_by_severity[sorted[0].severity],
                finding_ids: sorted.map((finding) => finding.id),
                counts
            };
        })
        .sort((left, right) => {
            const priorityDelta =
                priorityRank.get(left.priority) -
                priorityRank.get(right.priority);
            return priorityDelta !== 0
                ? priorityDelta
                : left.owner.localeCompare(right.owner);
        });

    return {
        schema_version: SCHEMA_VERSION,
        batch_id: batchId,
        batches,
        summary: {
            input_findings: input.findings.length,
            eligible_findings: eligible.length,
            selected_findings: selected.length,
            duplicates_removed: eligible.length - selected.length,
            owners: batches.length
        }
    };
}

async function main() {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) {
        throw new Error(
            "usage: node prepare-routing.mjs <baseline-input.json> <expected-result.json>"
        );
    }
    const input = JSON.parse(
        (await readFile(inputPath, "utf8")).replace(/^\uFEFF/, "")
    );
    await writeFile(
        outputPath,
        `${JSON.stringify(buildRoutingResult(input), null, 2)}\n`,
        "utf8"
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
