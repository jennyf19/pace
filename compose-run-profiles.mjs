import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    contributingEvidenceIds,
    loadRunProfileEvidence,
    protectedIdentifier,
    readJson
} from "./compare-runs.mjs";
import {
    ADDITIVE_METRICS,
    EVIDENCE_LEVELS,
    writeRunArtifacts
} from "./profile-run.mjs";
import { protectedRunId } from "./profile-session.mjs";

const SCHEMA_VERSION = "0.1";

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sha256Value(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function canonicalPath(inputPath) {
    return process.platform === "win32" ? inputPath.toLowerCase() : inputPath;
}

async function loadCompositeManifest(inputPath) {
    const { value: manifest, resolvedPath: manifestPath } = await readJson(
        inputPath,
        "composite run manifest"
    );
    if (manifest.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `composite run manifest schema_version must be ${SCHEMA_VERSION}`
        );
    }
    const runId = requireString(manifest.run_id, "run_id");
    if (!Array.isArray(manifest.components) || manifest.components.length < 2) {
        throw new Error(
            "composite run manifest requires at least two components"
        );
    }
    return {
        manifest,
        manifestPath,
        runId
    };
}

async function loadComponents(
    rawComponents,
    manifestPath,
    includeIdentifiers
) {
    const baseDirectory = dirname(manifestPath);
    const ids = new Set();
    const paths = new Set();
    const runIds = new Set();
    const evidenceIds = new Set();
    const components = [];

    for (const [index, raw] of rawComponents.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`component ${index + 1} must be an object`);
        }
        const id = requireString(raw.id, `component ${index + 1}.id`);
        if (ids.has(id)) throw new Error(`duplicate component id: ${id}`);
        ids.add(id);
        const role =
            typeof raw.role === "string" && raw.role.trim()
                ? raw.role
                : "unspecified";
        const requestedPath = requireString(
            raw.profile,
            `component ${id}.profile`
        );
        let profilePath;
        try {
            profilePath = await realpath(
                resolve(baseDirectory, requestedPath)
            );
        } catch (error) {
            throw new Error(
                `cannot resolve component ${id}.profile: ${error.message}`
            );
        }
        const canonical = canonicalPath(profilePath);
        if (paths.has(canonical)) {
            throw new Error("composite run contains a duplicate profile path");
        }
        paths.add(canonical);
        const evidence = await loadRunProfileEvidence(
            profilePath,
            `component ${id} run profile`
        );
        if (runIds.has(evidence.profile.run_id)) {
            throw new Error(
                `composite run contains duplicate run_id ${evidence.profile.run_id}`
            );
        }
        runIds.add(evidence.profile.run_id);
        const componentEvidenceIds = contributingEvidenceIds(
            evidence.profile
        );
        for (const evidenceId of componentEvidenceIds) {
            if (evidenceIds.has(evidenceId)) {
                throw new Error(
                    "composite run contains duplicate contributing session evidence"
                );
            }
            evidenceIds.add(evidenceId);
        }
        components.push({
            id,
            component_key: protectedIdentifier(id, includeIdentifiers),
            role,
            profilePath,
            profileSha256: evidence.sha256,
            profile: evidence.profile,
            evidenceIds: componentEvidenceIds
        });
    }
    return components;
}

function flattenSessions(components, includeIdentifiers) {
    const sessions = [];
    const contributingSessions = [];

    for (const component of components) {
        const contributing = new Set(
            component.profile.accounting.contributing_sessions
        );
        const keyMap = new Map(
            component.profile.sessions.map((session) => [
                session.session_key,
                protectedRunId(
                    `${component.id}:${session.session_key}`,
                    includeIdentifiers
                )
            ])
        );
        for (const session of component.profile.sessions) {
            const sessionKey = keyMap.get(session.session_key);
            sessions.push({
                session_key: sessionKey,
                component_key: component.component_key,
                role: `${component.role}/${session.role}`,
                billing: session.billing,
                included_in:
                    session.included_in === null
                        ? null
                        : keyMap.get(session.included_in),
                profile: session.profile
            });
            if (contributing.has(session.session_key)) {
                contributingSessions.push(sessionKey);
            }
        }
    }
    return { sessions, contributingSessions };
}

function aggregateMetric(components, metric) {
    const missingComponents = [];
    const known = [];
    for (const component of components) {
        const value = numberOrNull(component.profile.totals[metric]);
        if (value === null) {
            missingComponents.push(component.component_key);
            const coverage =
                component.profile.accounting.metric_coverage?.[metric];
            const knownSubtotal =
                metric === "wall_time_ms"
                    ? numberOrNull(coverage?.known_span_ms)
                    : numberOrNull(coverage?.known_subtotal);
            if (knownSubtotal !== null) known.push(knownSubtotal);
        } else {
            known.push(value);
        }
    }
    const knownSubtotal =
        known.length > 0
            ? known.reduce((sum, value) => sum + value, 0)
            : null;
    return {
        value:
            missingComponents.length === 0
                ? known.reduce((sum, value) => sum + value, 0)
                : null,
        known_subtotal: knownSubtotal,
        complete: missingComponents.length === 0,
        missing_sessions: missingComponents
    };
}

function aggregateWallTime(sessions, contributingSessions) {
    const contributing = new Set(contributingSessions);
    const starts = [];
    const ends = [];
    const missingSessions = [];
    for (const session of sessions) {
        if (!contributing.has(session.session_key)) continue;
        const start = Date.parse(session.profile.timing?.started_at);
        const end = Date.parse(session.profile.timing?.ended_at);
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

function flattenStages(components) {
    return components.flatMap((component) =>
        component.profile.stages.map((stage) => ({
            ...stage,
            id: `${component.component_key}:${stage.id}`,
            component_key: component.component_key
        }))
    );
}

function evidenceFloor(components) {
    const indexes = components.map((component) =>
        EVIDENCE_LEVELS.indexOf(component.profile.coverage.evidence_level)
    );
    return EVIDENCE_LEVELS[Math.min(...indexes)];
}

export async function composeRunProfiles(inputPath, options = {}) {
    const { manifest, manifestPath, runId } =
        await loadCompositeManifest(inputPath);
    const includeIdentifiers = options.includeIdentifiers === true;
    const components = await loadComponents(
        manifest.components,
        manifestPath,
        includeIdentifiers
    );
    const { sessions, contributingSessions } = flattenSessions(
        components,
        includeIdentifiers
    );
    const wallTime = aggregateWallTime(sessions, contributingSessions);
    const metricCoverage = Object.fromEntries(
        ADDITIVE_METRICS.map((metric) => [
            metric,
            aggregateMetric(components, metric)
        ])
    );
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
    if (!wallTime.complete) {
        missing.push(
            `composite wall time: missing timestamps from ${wallTime.missing_sessions.join(", ")}`
        );
    }
    for (const [metric, coverage] of Object.entries(metricCoverage)) {
        if (!coverage.complete) {
            missing.push(
                `${metric}: missing from ${coverage.missing_sessions.join(", ")}`
            );
        }
    }
    for (const component of components) {
        for (const item of component.profile.coverage.missing) {
            missing.push(`${component.component_key}: ${item}`);
        }
        for (const warning of component.profile.coverage.warnings) {
            warnings.push(`${component.component_key}: ${warning}`);
        }
    }

    return {
        schema_version: SCHEMA_VERSION,
        run_id: protectedRunId(runId, includeIdentifiers),
        run_type: "composite",
        sessions,
        stages: flattenStages(components),
        totals,
        accounting: {
            component_policy:
                "component run totals contribute once; nested session evidence remains non-additive",
            wall_time_policy:
                "earliest contributing component-session start to latest contributing component-session end",
            missing_metric_policy:
                "aggregate value is null when any component is missing the metric",
            attribution_views_are_non_additive: true,
            contributing_sessions: contributingSessions,
            included_sessions: sessions
                .filter((session) => session.billing === "included")
                .map((session) => session.session_key),
            metric_coverage: {
                wall_time_ms: wallTime,
                ...metricCoverage
            },
            components: components.map((component) => ({
                component_key: component.component_key,
                role: component.role,
                run_id: protectedIdentifier(
                    component.profile.run_id,
                    includeIdentifiers
                ),
                run_profile_sha256: component.profileSha256,
                contributing_evidence_bindings:
                    component.evidenceIds.map(sha256Value)
            }))
        },
        coverage: {
            evidence_level: evidenceFloor(components),
            missing: [...new Set(missing)],
            warnings: [...new Set(warnings)]
        },
        privacy: {
            identifiers: includeIdentifiers ? "included" : "hashed",
            excluded: [
                "profile paths",
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

function usage() {
    return [
        "Usage: node compose-run-profiles.mjs <composite-manifest.json> [options]",
        "",
        "Options:",
        "  -o, --out <directory>       Output directory (default: pace-output)",
        "      --include-identifiers    Preserve component and run identifiers",
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
            output = argv[++index];
        } else if (argument === "--include-identifiers") {
            includeIdentifiers = true;
        } else if (argument.startsWith("-")) {
            throw new Error(`unknown option: ${argument}`);
        } else if (input === null) {
            input = argument;
        } else {
            throw new Error("only one composite manifest is supported");
        }
    }
    if (input === null) throw new Error("a composite manifest is required");
    return { help: false, input, output, includeIdentifiers };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const profile = await composeRunProfiles(args.input, {
            includeIdentifiers: args.includeIdentifiers
        });
        const paths = writeRunArtifacts(profile, args.output);
        process.stdout.write(`${paths.jsonPath}\n${paths.markdownPath}\n`);
    } catch (error) {
        process.stderr.write(`pace composite run failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
