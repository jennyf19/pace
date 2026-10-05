import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256File } from "./build-replay-manifest.mjs";
import {
    percentageDelta,
    protectedIdentifier,
    readJson
} from "./compare-runs.mjs";
import { profileSession } from "./profile-session.mjs";

const SCHEMA_VERSION = "0.1";
const ANALYZER_PATH = fileURLToPath(import.meta.url);
const PROTECTED_ID = /^sha256:[a-f0-9]{16}$/i;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/i;
const METRICS = [
    "current_tokens",
    "system_tokens",
    "conversation_tokens",
    "tool_definition_tokens",
    "classified_tokens",
    "unclassified_tokens",
    "model_requests",
    "tool_invocations",
    "wall_time_ms",
    "api_time_ms",
    "input_tokens",
    "non_cached_input_tokens",
    "cache_read_tokens",
    "output_tokens",
    "reasoning_tokens",
    "ai_units"
];

function pathValue(inputPath) {
    return inputPath instanceof URL ? fileURLToPath(inputPath) : inputPath;
}

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentile(sortedValues, probability) {
    if (sortedValues.length === 1) return sortedValues[0];
    const index = (sortedValues.length - 1) * probability;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    const weight = index - lower;
    return (
        sortedValues[lower] +
        (sortedValues[upper] - sortedValues[lower]) * weight
    );
}

function distribution(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return {
        count: sorted.length,
        min: sorted[0],
        max: sorted.at(-1),
        mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
        p50: percentile(sorted, 0.5),
        p90: percentile(sorted, 0.9)
    };
}

async function eventsPathOf(inputPath) {
    const resolved = await realpath(resolve(pathValue(inputPath)));
    const info = await stat(resolved);
    return info.isDirectory() ? join(resolved, "events.jsonl") : resolved;
}

async function loadManifest(inputPath) {
    const { value: manifest, resolvedPath: manifestPath } = await readJson(
        inputPath,
        "context analysis manifest"
    );
    if (manifest.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `context analysis manifest schema_version must be ${SCHEMA_VERSION}`
        );
    }
    const analysisId = requireString(manifest.analysis_id, "analysis_id");
    for (const field of ["replay_receipt", "comparison_receipt"]) {
        if (
            typeof manifest.source?.[field] !== "string" ||
            !PROTECTED_ID.test(manifest.source[field])
        ) {
            throw new Error(`source.${field} must be a protected identifier`);
        }
    }
    for (const field of [
        "experiment_source_commit",
        "analysis_source_commit"
    ]) {
        if (
            typeof manifest.source?.[field] !== "string" ||
            !SOURCE_COMMIT.test(manifest.source[field])
        ) {
            throw new Error(`source.${field} must be a 40-character SHA`);
        }
    }
    const baseline = manifest.cohorts?.baseline;
    const candidate = manifest.cohorts?.candidate;
    if (
        !Array.isArray(baseline) ||
        !Array.isArray(candidate) ||
        baseline.length < 2 ||
        baseline.length !== candidate.length
    ) {
        throw new Error(
            "context analysis requires equal baseline and candidate cohorts of at least two samples"
        );
    }
    return {
        manifest,
        manifestPath,
        analysisId,
        baseline,
        candidate
    };
}

async function profileCohort(
    rawSamples,
    label,
    manifestPath,
    includeIdentifiers,
    allPaths
) {
    const baseDirectory = dirname(manifestPath);
    const ids = new Set();
    const samples = [];
    for (const [index, raw] of rawSamples.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`${label}[${index}] must be an object`);
        }
        const id = requireString(raw.id, `${label}[${index}].id`);
        if (ids.has(id)) throw new Error(`${label} contains duplicate id ${id}`);
        ids.add(id);
        const artifact = requireString(
            raw.artifact,
            `${label}[${index}].artifact`
        );
        const requestedPath = resolve(baseDirectory, artifact);
        const eventsPath = await eventsPathOf(requestedPath);
        const canonical =
            process.platform === "win32"
                ? eventsPath.toLowerCase()
                : eventsPath;
        if (allPaths.has(canonical)) {
            throw new Error(
                "context analysis contains duplicate artifact evidence"
            );
        }
        allPaths.add(canonical);
        const profile = await profileSession(eventsPath, {
            declaredRuntimeVersion:
                raw.declared_runtime_version ?? undefined
        });
        const context = profile.context;
        if (
            context?.snapshot_is_final !== true ||
            METRICS.slice(0, 6).some(
                (metric) => numberOrNull(context[metric]) === null
            )
        ) {
            throw new Error(
                `${label}[${index}] requires a complete final context snapshot`
            );
        }
        const modelRequests = profile.stages
            .filter((stage) => stage.kind === "model")
            .map((stage) => numberOrNull(stage.invocations))
            .filter((value) => value !== null)
            .reduce((sum, value) => sum + value, 0);
        const toolInvocations = profile.stages
            .filter((stage) => stage.kind === "tool")
            .map((stage) => numberOrNull(stage.invocations))
            .filter((value) => value !== null)
            .reduce((sum, value) => sum + value, 0);
        const artifactHash = await sha256File(eventsPath);
        samples.push({
            sample_id: protectedIdentifier(id, includeIdentifiers),
            artifact_sha256: artifactHash.sha256,
            session_run_id: profile.run_id,
            current_tokens: context.current_tokens,
            system_tokens: context.system_tokens,
            conversation_tokens: context.conversation_tokens,
            tool_definition_tokens: context.tool_definition_tokens,
            classified_tokens: context.classified_tokens,
            unclassified_tokens: context.unclassified_tokens,
            model_requests: modelRequests,
            tool_invocations: toolInvocations,
            wall_time_ms: profile.totals.wall_time_ms,
            api_time_ms: profile.totals.api_time_ms,
            input_tokens: profile.totals.input_tokens,
            non_cached_input_tokens: profile.totals.non_cached_input_tokens,
            cache_read_tokens: profile.totals.cache_read_tokens,
            output_tokens: profile.totals.output_tokens,
            reasoning_tokens: profile.totals.reasoning_tokens,
            ai_units: profile.totals.ai_units
        });
    }
    return samples;
}

function summarizeCohort(samples) {
    return {
        sample_count: samples.length,
        metrics: Object.fromEntries(
            METRICS.map((metric) => [
                metric,
                {
                    distribution: distribution(
                        samples.map((sample) => sample[metric])
                    ),
                    samples: samples.map((sample) => ({
                        sample_id: sample.sample_id,
                        value: sample[metric]
                    }))
                }
            ])
        ),
        samples: samples.map((sample) => ({
            sample_id: sample.sample_id,
            artifact_sha256: sample.artifact_sha256,
            session_run_id: sample.session_run_id
        }))
    };
}

function compareMetrics(baseline, candidate) {
    return Object.fromEntries(
        METRICS.map((metric) => {
            const baselineValue =
                baseline.metrics[metric].distribution.p50;
            const candidateValue =
                candidate.metrics[metric].distribution.p50;
            const percent = percentageDelta(
                baselineValue,
                candidateValue
            );
            return [
                metric,
                {
                    statistic: "p50",
                    baseline_value: baselineValue,
                    candidate_value: candidateValue,
                    absolute_delta: candidateValue - baselineValue,
                    percent_delta: percent.value,
                    percent_delta_status: percent.status
                }
            ];
        })
    );
}

export async function analyzeContextSnapshots(inputPath, options = {}) {
    const {
        manifest,
        manifestPath,
        analysisId,
        baseline: rawBaseline,
        candidate: rawCandidate
    } = await loadManifest(inputPath);
    const includeIdentifiers = options.includeIdentifiers === true;
    const allPaths = new Set();
    const baselineSamples = await profileCohort(
        rawBaseline,
        "baseline",
        manifestPath,
        includeIdentifiers,
        allPaths
    );
    const candidateSamples = await profileCohort(
        rawCandidate,
        "candidate",
        manifestPath,
        includeIdentifiers,
        allPaths
    );
    const baseline = summarizeCohort(baselineSamples);
    const candidate = summarizeCohort(candidateSamples);
    const analyzerHash = await sha256File(ANALYZER_PATH);

    return {
        schema_version: SCHEMA_VERSION,
        analysis_id: protectedIdentifier(
            analysisId,
            includeIdentifiers
        ),
        analysis_type: "context_snapshot_cohorts",
        source: {
            replay_receipt: manifest.source.replay_receipt,
            comparison_receipt: manifest.source.comparison_receipt,
            experiment_source_commit:
                manifest.source.experiment_source_commit,
            analysis_source_commit:
                manifest.source.analysis_source_commit,
            analyzer_sha256: analyzerHash.sha256
        },
        baseline,
        candidate,
        comparison: compareMetrics(baseline, candidate),
        accounting: {
            snapshot_policy:
                "latest final session.shutdown context snapshot per sample",
            usage_boundary:
                "context snapshot metrics are non-additive and distinct from billed/logical input usage",
            classified_context:
                "system_tokens + conversation_tokens + tool_definition_tokens",
            artifact_policy:
                "each raw events.jsonl artifact contributes once and is bound by SHA-256"
        },
        privacy: {
            identifiers: includeIdentifiers ? "included" : "hashed",
            excluded: [
                "artifact paths",
                "prompts",
                "messages",
                "tool arguments",
                "tool results",
                "working directories"
            ]
        }
    };
}

function display(value) {
    return value === null || value === undefined
        ? "unmeasured"
        : new Intl.NumberFormat("en-US", {
              maximumFractionDigits: 3
          }).format(value);
}

function displayPercent(value, status) {
    if (status === "zero_baseline") return "n/a (zero baseline)";
    return value === null ? "unmeasured" : `${display(value)}%`;
}

export function renderContextMarkdown(analysis) {
    const lines = [
        "# Pace context snapshot analysis",
        "",
        `**Analysis:** \`${analysis.analysis_id}\`  `,
        `**Samples:** ${analysis.baseline.sample_count} baseline / ${analysis.candidate.sample_count} candidate`,
        "",
        "## Source binding",
        "",
        `- Replay: \`${analysis.source.replay_receipt}\`.`,
        `- Comparison: \`${analysis.source.comparison_receipt}\`.`,
        `- Experiment source commit: \`${analysis.source.experiment_source_commit}\`.`,
        `- Analysis source commit: \`${analysis.source.analysis_source_commit}\`.`,
        `- Analyzer implementation: \`${analysis.source.analyzer_sha256}\`.`,
        "",
        "## Median comparison",
        "",
        "| Metric | Baseline p50 | Candidate p50 | Delta | Delta % |",
        "|---|---:|---:|---:|---:|"
    ];
    for (const metric of METRICS) {
        const comparison = analysis.comparison[metric];
        lines.push(
            `| ${metric} | ${display(comparison.baseline_value)} | ${display(comparison.candidate_value)} | ${display(comparison.absolute_delta)} | ${displayPercent(comparison.percent_delta, comparison.percent_delta_status)} |`
        );
    }
    lines.push(
        "",
        "## Accounting boundary",
        "",
        `- ${analysis.accounting.snapshot_policy}.`,
        `- ${analysis.accounting.usage_boundary}.`,
        `- Classified context is ${analysis.accounting.classified_context}.`,
        `- ${analysis.accounting.artifact_policy}.`
    );
    return `${lines.join("\n")}\n`;
}

export function writeContextArtifacts(analysis, outputDirectory) {
    const output = resolve(outputDirectory);
    mkdirSync(output, { recursive: true });
    const safeId = analysis.analysis_id.replaceAll(
        /[^a-zA-Z0-9._-]/g,
        "-"
    );
    const jsonPath = join(output, `${safeId}.context-analysis.json`);
    const markdownPath = join(
        output,
        `${safeId}.context-analysis-report.md`
    );
    writeFileSync(
        jsonPath,
        `${JSON.stringify(analysis, null, 2)}\n`,
        "utf8"
    );
    writeFileSync(markdownPath, renderContextMarkdown(analysis), "utf8");
    return { jsonPath, markdownPath };
}

function usage() {
    return [
        "Usage: node analyze-context-snapshots.mjs <analysis-manifest.json> [options]",
        "",
        "Options:",
        "  -o, --out <directory>       Output directory (default: pace-output)",
        "      --include-identifiers    Preserve sample identifiers",
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
            throw new Error("only one analysis manifest is supported");
        }
    }
    if (input === null) throw new Error("an analysis manifest is required");
    return { help: false, input, output, includeIdentifiers };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const analysis = await analyzeContextSnapshots(args.input, {
            includeIdentifiers: args.includeIdentifiers
        });
        const paths = writeContextArtifacts(analysis, args.output);
        process.stdout.write(`${paths.jsonPath}\n${paths.markdownPath}\n`);
    } catch (error) {
        process.stderr.write(
            `pace context analysis failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
