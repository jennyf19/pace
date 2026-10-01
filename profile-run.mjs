import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    profileSession,
    protectedRunId
} from "./profile-session.mjs";

const SCHEMA_VERSION = "0.1";
export const ADDITIVE_METRICS = [
    "api_time_ms",
    "input_tokens",
    "non_cached_input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "ai_units",
    "premium_requests"
];
export const RUN_METRICS = ["wall_time_ms", ...ADDITIVE_METRICS];
export const EVIDENCE_LEVELS = ["L0", "L1", "L2", "L3", "L4"];

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumKnown(values) {
    const known = values.filter(
        (value) => typeof value === "number" && Number.isFinite(value)
    );
    return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function pathValue(inputPath) {
    return inputPath instanceof URL ? fileURLToPath(inputPath) : inputPath;
}

function display(value) {
    return value === null || value === undefined
        ? "unmeasured"
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

function markdownText(value) {
    return String(value ?? "unknown").replaceAll("|", "\\|").replaceAll("`", "\\`");
}

async function loadManifest(inputPath) {
    const manifestPath = resolve(pathValue(inputPath));
    let manifest;
    try {
        manifest = JSON.parse(
            (await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, "")
        );
    } catch (error) {
        throw new Error(`cannot read run manifest: ${error.message}`);
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error("run manifest must be a JSON object");
    }
    if (manifest.schema_version !== SCHEMA_VERSION) {
        throw new Error(`run manifest schema_version must be ${SCHEMA_VERSION}`);
    }
    if (typeof manifest.run_id !== "string" || !manifest.run_id.trim()) {
        throw new Error("run manifest requires a non-empty run_id");
    }
    if (!Array.isArray(manifest.sessions) || manifest.sessions.length === 0) {
        throw new Error("run manifest requires at least one session");
    }
    return { manifest, manifestPath };
}

async function normalizeEntries(manifest, manifestPath) {
    const ids = new Set();
    const artifacts = new Set();
    const baseDirectory = dirname(manifestPath);
    const entries = [];

    for (const raw of manifest.sessions) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("each run manifest session must be an object");
        }
        if (typeof raw.id !== "string" || !raw.id.trim()) {
            throw new Error("each run manifest session requires a non-empty id");
        }
        if (ids.has(raw.id)) throw new Error(`duplicate session id: ${raw.id}`);
        ids.add(raw.id);
        if (typeof raw.artifact !== "string" || !raw.artifact.trim()) {
            throw new Error(`session ${raw.id} requires an artifact path`);
        }
        const billing = raw.billing ?? "independent";
        if (!["independent", "included"].includes(billing)) {
            throw new Error(
                `session ${raw.id} billing must be independent or included`
            );
        }
        if (billing === "included" && typeof raw.included_in !== "string") {
            throw new Error(`included session ${raw.id} requires included_in`);
        }
        if (billing === "independent" && raw.included_in !== undefined) {
            throw new Error(
                `independent session ${raw.id} must not declare included_in`
            );
        }
        if (
            raw.declared_runtime_version !== undefined &&
            (typeof raw.declared_runtime_version !== "string" ||
                !raw.declared_runtime_version.trim())
        ) {
            throw new Error(
                `session ${raw.id} declared_runtime_version must be a non-empty string`
            );
        }

        const artifactPath = resolve(baseDirectory, raw.artifact);
        const resolvedArtifactPath = await realpath(artifactPath);
        const canonicalPath =
            process.platform === "win32"
                ? resolvedArtifactPath.toLowerCase()
                : resolvedArtifactPath;
        if (artifacts.has(canonicalPath)) {
            throw new Error(`duplicate artifact path for session ${raw.id}`);
        }
        artifacts.add(canonicalPath);
        entries.push({
            id: raw.id,
            role:
                typeof raw.role === "string" && raw.role.trim()
                    ? raw.role
                    : "unspecified",
            billing,
            included_in: raw.included_in ?? null,
            declaredRuntimeVersion:
                raw.declared_runtime_version ?? null,
            artifactPath
        });
    }

    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    for (const entry of entries) {
        if (entry.billing !== "included") continue;
        const target = entriesById.get(entry.included_in);
        if (!target) {
            throw new Error(
                `included session ${entry.id} references unknown session ${entry.included_in}`
            );
        }
        if (target.billing !== "independent") {
            throw new Error(
                `included session ${entry.id} must reference an independent session`
            );
        }
    }
    if (!entries.some((entry) => entry.billing === "independent")) {
        throw new Error("run manifest requires at least one independent session");
    }
    return entries;
}

function aggregateMetric(contributors, metric) {
    const missingSessions = [];
    const known = [];
    for (const session of contributors) {
        const value = numberOrNull(session.profile.totals[metric]);
        if (value === null) {
            missingSessions.push(session.session_key);
            const knownSubtotal = numberOrNull(
                session.profile.accounting.known_subtotals?.[metric]
            );
            if (knownSubtotal !== null) known.push(knownSubtotal);
        } else {
            known.push(value);
        }
    }
    return {
        value:
            missingSessions.length === 0
                ? known.reduce((sum, value) => sum + value, 0)
                : null,
        known_subtotal: sumKnown(known),
        complete: missingSessions.length === 0,
        missing_sessions: missingSessions
    };
}

function aggregateSpan(contributors) {
    const starts = [];
    const ends = [];
    const missingSessions = [];
    for (const session of contributors) {
        const start = Date.parse(session.profile.timing.started_at);
        const end = Date.parse(session.profile.timing.ended_at);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            missingSessions.push(session.session_key);
            continue;
        }
        starts.push(start);
        ends.push(end);
    }
    const knownSpan =
        starts.length > 0 ? Math.max(...ends) - Math.min(...starts) : null;
    return {
        value: missingSessions.length === 0 ? knownSpan : null,
        known_span_ms: knownSpan,
        complete: missingSessions.length === 0,
        missing_sessions: missingSessions
    };
}

function sumStageMetric(stages, field) {
    const values = stages.map((stage) => numberOrNull(stage[field]));
    if (values.every((value) => value === null)) return null;
    if (values.some((value) => value === null)) return null;
    return values.reduce((sum, value) => sum + value, 0);
}

function aggregateStages(contributors) {
    const groups = new Map();
    for (const session of contributors) {
        for (const stage of session.profile.stages) {
            const key = `${stage.kind}:${stage.name}`;
            const group = groups.get(key) ?? [];
            group.push(stage);
            groups.set(key, group);
        }
    }

    return [...groups.entries()]
        .map(([id, stages]) => ({
            id,
            kind: stages[0].kind,
            name: stages[0].name,
            classification: "unknown",
            invocations: sumStageMetric(stages, "invocations"),
            successful: sumStageMetric(stages, "successful"),
            failed: sumStageMetric(stages, "failed"),
            incomplete: sumStageMetric(stages, "incomplete"),
            duration_ms: sumStageMetric(stages, "duration_ms"),
            input_tokens: sumStageMetric(stages, "input_tokens"),
            non_cached_input_tokens: sumStageMetric(
                stages,
                "non_cached_input_tokens"
            ),
            output_tokens: sumStageMetric(stages, "output_tokens"),
            cache_read_tokens: sumStageMetric(stages, "cache_read_tokens"),
            cache_write_tokens: sumStageMetric(stages, "cache_write_tokens"),
            ai_units: sumStageMetric(stages, "ai_units"),
            attribution:
                "sum within one attribution kind across contributing sessions; kinds remain non-additive"
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
}

function evidenceFloor(contributors) {
    const indexes = contributors.map((session) => {
        const index = EVIDENCE_LEVELS.indexOf(
            session.profile.coverage.evidence_level
        );
        return index < 0 ? 0 : index;
    });
    return EVIDENCE_LEVELS[Math.min(...indexes)];
}

export async function profileRunManifest(inputPath, options = {}) {
    const { manifest, manifestPath } = await loadManifest(inputPath);
    const entries = await normalizeEntries(manifest, manifestPath);
    const includeIdentifiers = options.includeIdentifiers === true;
    const keyMap = new Map(
        entries.map((entry) => [
            entry.id,
            protectedRunId(entry.id, includeIdentifiers)
        ])
    );
    const profiled = await Promise.all(
        entries.map(async (entry) => ({
            ...entry,
            session_key: keyMap.get(entry.id),
            profile: await profileSession(entry.artifactPath, {
                includeIdentifiers,
                declaredRuntimeVersion:
                    entry.declaredRuntimeVersion ?? undefined
            })
        }))
    );

    const profileRunIds = new Set();
    for (const session of profiled) {
        if (profileRunIds.has(session.profile.run_id)) {
            throw new Error(
                `duplicate profiled session detected for ${session.session_key}`
            );
        }
        profileRunIds.add(session.profile.run_id);
    }

    const sessions = profiled.map((session) => ({
        session_key: session.session_key,
        role: session.role,
        billing: session.billing,
        included_in:
            session.included_in === null ? null : keyMap.get(session.included_in),
        profile: session.profile
    }));
    const contributors = sessions.filter(
        (session) => session.billing === "independent"
    );
    const metricCoverage = Object.fromEntries(
        ADDITIVE_METRICS.map((metric) => [
            metric,
            aggregateMetric(contributors, metric)
        ])
    );
    const wallTime = aggregateSpan(contributors);
    const totals = {
        wall_time_ms: wallTime.value,
        elapsed_span_ms: wallTime.value,
        ...Object.fromEntries(
            ADDITIVE_METRICS.map((metric) => [
                metric,
                metricCoverage[metric].value
            ])
        )
    };
    const missing = [];
    const warnings = [];
    for (const session of contributors) {
        for (const item of session.profile.coverage.missing) {
            missing.push(`${session.session_key}: ${item}`);
        }
        for (const warning of session.profile.coverage.warnings) {
            warnings.push(`${session.session_key}: ${warning}`);
        }
    }
    if (!wallTime.complete) {
        missing.push(
            `run wall time: missing timestamps from ${wallTime.missing_sessions.join(", ")}`
        );
    }
    for (const [metric, coverage] of Object.entries(metricCoverage)) {
        if (!coverage.complete) {
            missing.push(
                `${metric}: missing from ${coverage.missing_sessions.join(", ")}`
            );
        }
    }
    for (const session of sessions.filter(
        (session) => session.billing === "included"
    )) {
        warnings.push(
            `${session.session_key} is visible but excluded from totals because its usage is included in ${session.included_in}`
        );
    }

    return {
        schema_version: SCHEMA_VERSION,
        run_id: protectedRunId(manifest.run_id, includeIdentifiers),
        run_type: "manifest",
        sessions,
        stages: aggregateStages(contributors),
        totals,
        accounting: {
            session_policy:
                "independent sessions contribute once; included sessions contribute zero",
            wall_time_policy:
                "earliest contributing start to latest contributing end; session durations are not summed",
            missing_metric_policy:
                "aggregate value is null when any contributing session is missing the metric",
            attribution_views_are_non_additive: true,
            contributing_sessions: contributors.map(
                (session) => session.session_key
            ),
            included_sessions: sessions
                .filter((session) => session.billing === "included")
                .map((session) => session.session_key),
            metric_coverage: {
                wall_time_ms: wallTime,
                ...metricCoverage
            }
        },
        coverage: {
            evidence_level: evidenceFloor(contributors),
            missing: [...new Set(missing)],
            warnings: [...new Set(warnings)]
        },
        privacy: {
            identifiers: includeIdentifiers ? "included" : "hashed",
            excluded: [
                "artifact paths",
                "prompts",
                "messages",
                "tool arguments",
                "tool results",
                "code changes",
                "working directories"
            ]
        }
    };
}

export function renderRunMarkdown(profile) {
    const lines = [
        "# Pace run profile",
        "",
        `**Run:** \`${markdownText(profile.run_id)}\`  `,
        `**Evidence floor:** ${profile.coverage.evidence_level}`,
        "",
        "## Totals",
        "",
        "| Metric | Value | Complete |",
        "|---|---:|---|",
        `| End-to-end wall time (ms) | ${display(profile.totals.wall_time_ms)} | ${profile.accounting.metric_coverage.wall_time_ms.complete ? "yes" : "no"} |`
    ];
    for (const metric of ADDITIVE_METRICS) {
        lines.push(
            `| ${markdownText(metric)} | ${display(profile.totals[metric])} | ${profile.accounting.metric_coverage[metric].complete ? "yes" : "no"} |`
        );
    }

    lines.push(
        "",
        "## Sessions",
        "",
        "| Session | Role | Billing | Included in | Evidence | Input tokens | AI units |",
        "|---|---|---|---|---|---:|---:|"
    );
    for (const session of profile.sessions) {
        lines.push(
            `| \`${markdownText(session.session_key)}\` | ${markdownText(session.role)} | ${session.billing} | ${markdownText(session.included_in ?? "-")} | ${session.profile.coverage.evidence_level} | ${display(session.profile.totals.input_tokens)} | ${display(session.profile.totals.ai_units)} |`
        );
    }

    lines.push(
        "",
        "## Accounting invariants",
        "",
        `- ${profile.accounting.session_policy}.`,
        `- ${profile.accounting.wall_time_policy}.`,
        `- ${profile.accounting.missing_metric_policy}.`,
        "- Model, agent, and tool attribution views are non-additive.",
        "",
        "## Coverage",
        ""
    );
    if (profile.coverage.missing.length === 0) {
        lines.push("- No required run measurements are missing.");
    } else {
        for (const item of profile.coverage.missing) {
            lines.push(`- Missing: ${markdownText(item)}`);
        }
    }
    for (const warning of profile.coverage.warnings) {
        lines.push(`- Warning: ${markdownText(warning)}`);
    }
    return `${lines.join("\n")}\n`;
}

export function writeRunArtifacts(profile, outputDirectory) {
    const output = resolve(outputDirectory);
    mkdirSync(output, { recursive: true });
    const safeRunId = profile.run_id.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
    const jsonPath = join(output, `${safeRunId}.run-profile.json`);
    const markdownPath = join(output, `${safeRunId}.run-report.md`);
    writeFileSync(jsonPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, renderRunMarkdown(profile), "utf8");
    return { jsonPath, markdownPath };
}

function usage() {
    return [
        "Usage: node profile-run.mjs <run-manifest.json> [options]",
        "",
        "Options:",
        "  -o, --out <directory>       Output directory (default: pace-output)",
        "      --include-identifiers    Preserve manifest and session identifiers",
        "  -h, --help                  Show this help"
    ].join("\n");
}

function parseArguments(argv) {
    let input = null;
    let output = "pace-output";
    let includeIdentifiers = false;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "-h" || argument === "--help") return { help: true };
        if (argument === "-o" || argument === "--out") {
            index += 1;
            if (index >= argv.length) throw new Error(`${argument} requires a directory`);
            output = argv[index];
            continue;
        }
        if (argument === "--include-identifiers") {
            includeIdentifiers = true;
            continue;
        }
        if (argument.startsWith("-")) throw new Error(`unknown option: ${argument}`);
        if (input !== null) throw new Error("only one run manifest is supported");
        input = argument;
    }

    if (input === null) throw new Error("a run manifest is required");
    return { input, output, includeIdentifiers, help: false };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const profile = await profileRunManifest(args.input, {
            includeIdentifiers: args.includeIdentifiers
        });
        const paths = writeRunArtifacts(profile, args.output);
        process.stdout.write(`${paths.jsonPath}\n${paths.markdownPath}\n`);
    } catch (error) {
        process.stderr.write(`pace run profile failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
