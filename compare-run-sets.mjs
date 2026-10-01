import { mkdirSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    collectResiduals,
    evaluateGoal,
    metricCoverage,
    normalizeIssueIds,
    normalizeQualityEntry,
    percentageDelta,
    protectedIdentifier,
    readJson
} from "./compare-runs.mjs";
import {
    EVIDENCE_LEVELS,
    RUN_METRICS
} from "./profile-run.mjs";
import { loadReplayManifest } from "./build-replay-manifest.mjs";

const SCHEMA_VERSION = "0.1";
const DECISION_GOALS = new Set([
    "decrease",
    "increase",
    "not_increase",
    "not_decrease"
]);
const DECISION_STATISTICS = new Set(["min", "max", "mean", "p50", "p90"]);

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

function markdownText(value) {
    return String(value ?? "unknown").replaceAll("|", "\\|").replaceAll("`", "\\`");
}

function validateDecisionMetrics(rawMetrics) {
    if (!Array.isArray(rawMetrics) || rawMetrics.length === 0) {
        throw new Error(
            "repeated comparison manifest requires at least one decision metric"
        );
    }
    const seen = new Set();
    return rawMetrics.map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`decision metric ${index + 1} must be an object`);
        }
        if (!RUN_METRICS.includes(raw.metric)) {
            throw new Error(
                `decision metric ${index + 1} must use one of: ${RUN_METRICS.join(", ")}`
            );
        }
        if (!DECISION_STATISTICS.has(raw.statistic)) {
            throw new Error(
                `decision metric ${raw.metric} statistic must be min, max, mean, p50, or p90`
            );
        }
        if (!DECISION_GOALS.has(raw.goal)) {
            throw new Error(
                `decision metric ${raw.metric} goal must be decrease, increase, not_increase, or not_decrease`
            );
        }
        const key = `${raw.metric}:${raw.statistic}`;
        if (seen.has(key)) {
            throw new Error(`duplicate decision metric statistic: ${key}`);
        }
        seen.add(key);
        return {
            metric: raw.metric,
            statistic: raw.statistic,
            goal: raw.goal
        };
    });
}

async function loadRepeatedManifest(inputPath) {
    const { value: manifest, resolvedPath: manifestPath } = await readJson(
        inputPath,
        "repeated comparison manifest"
    );
    if (manifest.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `repeated comparison manifest schema_version must be ${SCHEMA_VERSION}`
        );
    }
    if (
        typeof manifest.comparison_id !== "string" ||
        !manifest.comparison_id.trim()
    ) {
        throw new Error(
            "repeated comparison manifest requires a non-empty comparison_id"
        );
    }
    if (
        typeof manifest.replay_manifest !== "string" ||
        !manifest.replay_manifest.trim()
    ) {
        throw new Error("repeated comparison manifest requires replay_manifest");
    }
    if (
        typeof manifest.quality_result !== "string" ||
        !manifest.quality_result.trim()
    ) {
        throw new Error("repeated comparison manifest requires quality_result");
    }
    const baseDirectory = dirname(manifestPath);
    let replayPath;
    let qualityPath;
    try {
        replayPath = await realpath(
            resolve(baseDirectory, manifest.replay_manifest)
        );
        qualityPath = await realpath(
            resolve(baseDirectory, manifest.quality_result)
        );
    } catch (error) {
        throw new Error(
            `cannot resolve repeated comparison input: ${error.message}`
        );
    }
    return {
        manifest,
        replayPath,
        qualityPath,
        decisionMetrics: validateDecisionMetrics(manifest.decision_metrics)
    };
}

function bindQualityEntries(rawEntries, profiles, profileHashes, label) {
    if (!Array.isArray(rawEntries)) {
        throw new Error(`repeated quality result requires ${label}`);
    }
    const entries = rawEntries.map((entry, index) =>
        normalizeQualityEntry(entry, `${label}[${index}]`)
    );
    const entriesByRun = new Map();
    for (const entry of entries) {
        if (entriesByRun.has(entry.run_id)) {
            throw new Error(
                `repeated quality result contains duplicate ${label} run_id ${entry.run_id}`
            );
        }
        entriesByRun.set(entry.run_id, entry);
    }
    if (entriesByRun.size !== profiles.length) {
        throw new Error(
            `repeated quality result ${label} count must match the run profiles`
        );
    }
    return profiles.map((profile) => {
        const entry = entriesByRun.get(profile.run_id);
        if (!entry) {
            throw new Error(
                `repeated quality result ${label} is missing run_id ${profile.run_id}`
            );
        }
        if (
            entry.run_profile_sha256 !==
            profileHashes.get(profile.run_id)
        ) {
            throw new Error(
                `repeated quality result ${label} run_profile_sha256 does not match run_id ${profile.run_id}`
            );
        }
        return entry;
    });
}

async function loadRepeatedQuality(
    inputPath,
    baselineProfiles,
    candidateProfiles,
    profileHashes
) {
    const { value: raw } = await readJson(
        inputPath,
        "repeated quality result"
    );
    if (raw.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `repeated quality result schema_version must be ${SCHEMA_VERSION}`
        );
    }
    const baseline = bindQualityEntries(
        raw.baseline,
        baselineProfiles,
        profileHashes,
        "baseline"
    );
    const candidate = bindQualityEntries(
        raw.candidate,
        candidateProfiles,
        profileHashes,
        "candidate"
    );
    const regressions = normalizeIssueIds(raw.regressions, "regressions");
    const lostFindings = normalizeIssueIds(
        raw.lost_findings,
        "lost_findings"
    );
    const entries = [...baseline, ...candidate];
    const corpusId = entries[0].corpus_id;
    const evaluatorId = entries[0].evaluator_id;
    if (entries.some((entry) => entry.corpus_id !== corpusId)) {
        throw new Error(
            "all repeated quality results must use the same corpus identity"
        );
    }
    if (entries.some((entry) => entry.evaluator_id !== evaluatorId)) {
        throw new Error(
            "all repeated quality results must use the same evaluator identity"
        );
    }
    return {
        baseline,
        candidate,
        corpus_id: corpusId,
        evaluator_id: evaluatorId,
        regressions,
        lost_findings: lostFindings
    };
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
    if (values.length === 0) return null;
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

function summarizeMetricSet(profiles, metric, includeIdentifiers) {
    const samples = profiles.map((profile) => ({
        run_id: protectedIdentifier(profile.run_id, includeIdentifiers),
        ...metricCoverage(profile, metric, includeIdentifiers)
    }));
    const observedValues = samples
        .filter((sample) => sample.complete)
        .map((sample) => sample.value);
    const observedDistribution = distribution(observedValues);
    const complete = samples.every((sample) => sample.complete);
    return {
        sample_count: samples.length,
        complete_samples: observedValues.length,
        complete,
        distribution: complete ? observedDistribution : null,
        observed_distribution: observedDistribution,
        missing_runs: samples
            .filter((sample) => !sample.complete)
            .map((sample) => sample.run_id),
        samples
    };
}

function evidenceFloor(profiles) {
    const indexes = profiles.map((profile) =>
        EVIDENCE_LEVELS.indexOf(profile.coverage.evidence_level)
    );
    return EVIDENCE_LEVELS[Math.min(...indexes)];
}

function summarizeRunSet(profiles, includeIdentifiers) {
    return {
        sample_count: profiles.length,
        evidence_floor: evidenceFloor(profiles),
        run_ids: profiles.map((profile) =>
            protectedIdentifier(profile.run_id, includeIdentifiers)
        ),
        missing_measurements: profiles.reduce(
            (count, profile) => count + profile.coverage.missing.length,
            0
        ),
        warnings: profiles.reduce(
            (count, profile) => count + profile.coverage.warnings.length,
            0
        )
    };
}

function collectSetResiduals(profiles, includeIdentifiers) {
    return profiles.flatMap((profile) =>
        collectResiduals(profile, includeIdentifiers).map((residual) => ({
            run_id: protectedIdentifier(profile.run_id, includeIdentifiers),
            ...residual
        }))
    );
}

function summarizeQuality(quality, includeIdentifiers) {
    const summarizeEntries = (entries) =>
        entries.map((entry) => ({
            run_id: protectedIdentifier(entry.run_id, includeIdentifiers),
            run_profile_sha256: entry.run_profile_sha256,
            complete: entry.complete,
            passed: entry.passed,
            score: entry.score
        }));
    return {
        same_corpus: true,
        same_evaluator: true,
        corpus_id: protectedIdentifier(
            quality.corpus_id,
            includeIdentifiers
        ),
        evaluator_id: protectedIdentifier(
            quality.evaluator_id,
            includeIdentifiers
        ),
        baseline: summarizeEntries(quality.baseline),
        candidate: summarizeEntries(quality.candidate),
        regressions: quality.regressions.map((item) =>
            protectedIdentifier(item, includeIdentifiers)
        ),
        lost_findings: quality.lost_findings.map((item) =>
            protectedIdentifier(item, includeIdentifiers)
        )
    };
}

function decideDisposition({
    quality,
    decisions,
    blockingResiduals
}) {
    const reasons = [];
    const failedCandidates = quality.candidate.filter(
        (entry) => entry.complete && entry.passed === false
    );
    const knownQualityFailure =
        failedCandidates.length > 0 ||
        quality.regressions.length > 0 ||
        quality.lost_findings.length > 0;
    const qualityReady =
        [...quality.baseline, ...quality.candidate].every(
            (entry) => entry.complete && entry.passed === true
        ) &&
        quality.regressions.length === 0 &&
        quality.lost_findings.length === 0;
    const incompleteMetrics = decisions
        .filter((decision) => !decision.complete)
        .map((decision) => `${decision.metric}.${decision.statistic}`);
    const accountingReady =
        incompleteMetrics.length === 0 && blockingResiduals.length === 0;
    const failedGoals = decisions.filter(
        (decision) => decision.goal_met === false
    );
    const hasMeasuredImprovement = decisions.some(
        (decision) => decision.strict_improvement === true
    );

    if (knownQualityFailure) {
        if (failedCandidates.length > 0) {
            reasons.push(
                `${failedCandidates.length} candidate sample(s) failed the external quality gate`
            );
        }
        if (quality.regressions.length > 0) {
            reasons.push(
                `${quality.regressions.length} quality regression(s) were reported`
            );
        }
        if (quality.lost_findings.length > 0) {
            reasons.push(
                `${quality.lost_findings.length} previously detected finding(s) were lost`
            );
        }
        return {
            disposition: "reject",
            qualityGate: "failed",
            accountingGate: accountingReady ? "passed" : "incomplete",
            performanceGate: accountingReady ? "not_evaluated" : "unmeasured",
            reasons
        };
    }

    if (!qualityReady) {
        const incomplete = [...quality.baseline, ...quality.candidate].filter(
            (entry) => !entry.complete
        ).length;
        const failedBaselines = quality.baseline.filter(
            (entry) => entry.complete && entry.passed === false
        ).length;
        if (incomplete > 0) {
            reasons.push(
                `${incomplete} repeated quality sample(s) are incomplete`
            );
        }
        if (failedBaselines > 0) {
            reasons.push(
                `${failedBaselines} baseline sample(s) did not pass the declared quality bar`
            );
        }
    }
    if (incompleteMetrics.length > 0) {
        reasons.push(
            `decision statistic accounting is incomplete for: ${incompleteMetrics.join(", ")}`
        );
    }
    if (blockingResiduals.length > 0) {
        reasons.push(
            `${blockingResiduals.length} non-zero attribution residual(s) affect decision metrics`
        );
    }
    if (!qualityReady || !accountingReady) {
        return {
            disposition: "unproven",
            qualityGate: qualityReady ? "passed" : "incomplete",
            accountingGate: accountingReady ? "passed" : "incomplete",
            performanceGate: accountingReady ? "not_evaluated" : "unmeasured",
            reasons
        };
    }

    if (failedGoals.length > 0) {
        reasons.push(
            `candidate missed the declared goal for: ${failedGoals.map((item) => `${item.metric}.${item.statistic}`).join(", ")}`
        );
        return {
            disposition: "revise",
            qualityGate: "passed",
            accountingGate: "passed",
            performanceGate: "failed",
            reasons
        };
    }
    if (!hasMeasuredImprovement) {
        reasons.push(
            "candidate produced no strict improvement in a decision statistic"
        );
        return {
            disposition: "revise",
            qualityGate: "passed",
            accountingGate: "passed",
            performanceGate: "no_measured_improvement",
            reasons
        };
    }
    reasons.push(
        "candidate met every repeated-run decision statistic and improved at least one without a quality regression"
    );
    return {
        disposition: "keep",
        qualityGate: "passed",
        accountingGate: "passed",
        performanceGate: "passed",
        reasons
    };
}

export async function compareRepeatedRunManifest(inputPath, options = {}) {
    const {
        manifest,
        replayPath,
        qualityPath,
        decisionMetrics
    } = await loadRepeatedManifest(inputPath);
    const includeIdentifiers = options.includeIdentifiers === true;
    const replay = await loadReplayManifest(replayPath, {
        includeIdentifiers
    });
    const baselineProfiles = replay.baselineProfiles;
    const candidateProfiles = replay.candidateProfiles;
    const quality = await loadRepeatedQuality(
        qualityPath,
        baselineProfiles,
        candidateProfiles,
        replay.bindings.run_profile_sha256
    );
    if (quality.corpus_id !== replay.bindings.corpus_id) {
        throw new Error(
            "repeated quality corpus identity does not match the replay manifest"
        );
    }
    if (quality.evaluator_id !== replay.bindings.evaluator_id) {
        throw new Error(
            "repeated quality evaluator identity does not match the replay manifest"
        );
    }
    const metrics = Object.fromEntries(
        RUN_METRICS.map((metric) => [
            metric,
            {
                baseline: summarizeMetricSet(
                    baselineProfiles,
                    metric,
                    includeIdentifiers
                ),
                candidate: summarizeMetricSet(
                    candidateProfiles,
                    metric,
                    includeIdentifiers
                )
            }
        ])
    );
    const decisions = decisionMetrics.map(({ metric, statistic, goal }) => {
        const comparison = metrics[metric];
        const complete =
            comparison.baseline.complete && comparison.candidate.complete;
        const baselineValue = complete
            ? comparison.baseline.distribution[statistic]
            : null;
        const candidateValue = complete
            ? comparison.candidate.distribution[statistic]
            : null;
        const absoluteDelta = complete
            ? candidateValue - baselineValue
            : null;
        const percent = complete
            ? percentageDelta(baselineValue, candidateValue)
            : { value: null, status: "incomplete" };
        return {
            metric,
            statistic,
            goal,
            complete,
            baseline_value: baselineValue,
            candidate_value: candidateValue,
            absolute_delta: absoluteDelta,
            percent_delta: percent.value,
            percent_delta_status: percent.status,
            ...evaluateGoal(
                {
                    complete,
                    absolute_delta: absoluteDelta
                },
                goal
            )
        };
    });
    const baselineResiduals = collectSetResiduals(
        baselineProfiles,
        includeIdentifiers
    );
    const candidateResiduals = collectSetResiduals(
        candidateProfiles,
        includeIdentifiers
    );
    const decisionMetricNames = new Set(
        decisionMetrics.map((decision) => decision.metric)
    );
    const blockingResiduals = [
        ...baselineResiduals.map((residual) => ({
            side: "baseline",
            ...residual
        })),
        ...candidateResiduals.map((residual) => ({
            side: "candidate",
            ...residual
        }))
    ].filter((residual) => decisionMetricNames.has(residual.metric));
    const disposition = decideDisposition({
        quality,
        decisions,
        blockingResiduals
    });

    return {
        schema_version: SCHEMA_VERSION,
        comparison_id: protectedIdentifier(
            manifest.comparison_id,
            includeIdentifiers
        ),
        comparison_type: "repeated_run_profiles",
        replay: replay.receipt,
        baseline: summarizeRunSet(baselineProfiles, includeIdentifiers),
        candidate: summarizeRunSet(candidateProfiles, includeIdentifiers),
        metrics,
        decision: {
            metrics: decisions,
            gates: {
                quality: disposition.qualityGate,
                accounting: disposition.accountingGate,
                performance: disposition.performanceGate
            }
        },
        quality: summarizeQuality(quality, includeIdentifiers),
        accounting: {
            sample_policy:
                "baseline and candidate use equal sample counts; no incomplete sample is dropped",
            distribution_policy:
                "final distributions are null when any sample is incomplete; observed distributions include only complete samples",
            percentile_method:
                "linear interpolation at index (sample_count - 1) * percentile",
            statistical_claim:
                "descriptive statistics only; no confidence interval or significance claim",
            evidence_floor: evidenceFloor([
                ...baselineProfiles,
                ...candidateProfiles
            ]),
            decision_statistics_complete: decisions.every(
                (decision) => decision.complete
            ),
            residual_policy:
                "non-zero attribution residuals on decision metrics block keep",
            residuals: {
                baseline: baselineResiduals,
                candidate: candidateResiduals
            },
            blocking_residuals: blockingResiduals
        },
        disposition: disposition.disposition,
        reasons: disposition.reasons,
        privacy: {
            identifiers: includeIdentifiers ? "included" : "hashed",
            excluded: [
                "input paths",
                "raw quality item identifiers",
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

export function renderRepeatedComparisonMarkdown(comparison) {
    const lines = [
        "# Pace repeated-run comparison",
        "",
        `**Comparison:** \`${markdownText(comparison.comparison_id)}\`  `,
        `**Disposition:** \`${comparison.disposition}\`  `,
        `**Samples:** ${comparison.baseline.sample_count} baseline / ${comparison.candidate.sample_count} candidate  `,
        `**Evidence floor:** ${comparison.accounting.evidence_floor}`,
        "",
        "## Replay binding",
        "",
        `- Workload: \`${comparison.replay.workload.workload_sha256}\`.`,
        `- Source revision binding: \`${comparison.replay.workload.source_revision_binding_sha256}\`.`,
        `- Evaluator identity binding: \`${comparison.replay.evaluator.evaluator_binding_sha256}\`.`,
        `- Evaluator implementation: \`${comparison.replay.evaluator.evaluator_sha256}\`.`,
        `- Baseline configuration: \`${comparison.replay.cohorts.baseline.configuration_sha256}\`.`,
        `- Candidate configuration: \`${comparison.replay.cohorts.candidate.configuration_sha256}\`.`,
        "",
        "## Decision",
        "",
        "| Metric | Statistic | Goal | Baseline | Candidate | Delta | Delta % | Complete | Goal met |",
        "|---|---|---|---:|---:|---:|---:|---|---|"
    ];
    for (const decision of comparison.decision.metrics) {
        lines.push(
            `| ${markdownText(decision.metric)} | ${decision.statistic} | ${markdownText(decision.goal)} | ${display(decision.baseline_value)} | ${display(decision.candidate_value)} | ${display(decision.absolute_delta)} | ${displayPercent(decision.percent_delta, decision.percent_delta_status)} | ${decision.complete ? "yes" : "no"} | ${decision.goal_met === null ? "unmeasured" : decision.goal_met ? "yes" : "no"} |`
        );
    }
    lines.push("", "### Gates", "");
    lines.push(`- Quality: ${comparison.decision.gates.quality}.`);
    lines.push(`- Accounting: ${comparison.decision.gates.accounting}.`);
    lines.push(`- Performance: ${comparison.decision.gates.performance}.`);
    for (const reason of comparison.reasons) {
        lines.push(`- ${markdownText(reason)}.`);
    }

    lines.push(
        "",
        "## Distributions",
        "",
        "| Metric | Baseline complete | Baseline p50 | Baseline p90 | Candidate complete | Candidate p50 | Candidate p90 |",
        "|---|---|---:|---:|---|---:|---:|"
    );
    for (const [metric, result] of Object.entries(comparison.metrics)) {
        lines.push(
            `| ${markdownText(metric)} | ${result.baseline.complete ? "yes" : "no"} | ${display(result.baseline.distribution?.p50 ?? null)} | ${display(result.baseline.distribution?.p90 ?? null)} | ${result.candidate.complete ? "yes" : "no"} | ${display(result.candidate.distribution?.p50 ?? null)} | ${display(result.candidate.distribution?.p90 ?? null)} |`
        );
    }

    const baselineQualityPasses = comparison.quality.baseline.filter(
        (entry) => entry.complete && entry.passed
    ).length;
    const candidateQualityPasses = comparison.quality.candidate.filter(
        (entry) => entry.complete && entry.passed
    ).length;
    lines.push(
        "",
        "## Quality",
        "",
        `- Corpus identity matched across all samples: ${comparison.quality.same_corpus ? "yes" : "no"}.`,
        `- Evaluator identity matched across all samples: ${comparison.quality.same_evaluator ? "yes" : "no"}.`,
        `- Baseline quality passes: ${baselineQualityPasses}/${comparison.quality.baseline.length}.`,
        `- Candidate quality passes: ${candidateQualityPasses}/${comparison.quality.candidate.length}.`,
        `- Reported regressions: ${comparison.quality.regressions.length}.`,
        `- Lost findings: ${comparison.quality.lost_findings.length}.`,
        "",
        "## Statistical boundary",
        "",
        `- ${comparison.accounting.percentile_method}.`,
        `- ${comparison.accounting.statistical_claim}.`
    );

    lines.push("", "## Accounting residuals", "");
    const residuals = [
        ...comparison.accounting.residuals.baseline.map((item) => ({
            side: "baseline",
            ...item
        })),
        ...comparison.accounting.residuals.candidate.map((item) => ({
            side: "candidate",
            ...item
        }))
    ];
    if (residuals.length === 0) {
        lines.push("- No non-zero attribution residuals were reported.");
    } else {
        lines.push(
            "| Side | Run | Session | View | Metric | Residual | Blocks keep |",
            "|---|---|---|---|---|---:|---|"
        );
        const blocking = new Set(
            comparison.accounting.blocking_residuals.map(
                (item) =>
                    `${item.side}:${item.run_id}:${item.session_key}:${item.view}:${item.metric}`
            )
        );
        for (const residual of residuals) {
            const key = `${residual.side}:${residual.run_id}:${residual.session_key}:${residual.view}:${residual.metric}`;
            lines.push(
                `| ${residual.side} | \`${markdownText(residual.run_id)}\` | \`${markdownText(residual.session_key)}\` | ${residual.view} | ${markdownText(residual.metric)} | ${display(residual.difference)} | ${blocking.has(key) ? "yes" : "no"} |`
            );
        }
    }
    return `${lines.join("\n")}\n`;
}

export function writeRepeatedComparisonArtifacts(
    comparison,
    outputDirectory
) {
    const output = resolve(outputDirectory);
    mkdirSync(output, { recursive: true });
    const safeComparisonId = comparison.comparison_id.replaceAll(
        /[^a-zA-Z0-9._-]/g,
        "-"
    );
    const jsonPath = join(
        output,
        `${safeComparisonId}.repeated-comparison.json`
    );
    const markdownPath = join(
        output,
        `${safeComparisonId}.repeated-comparison-report.md`
    );
    writeFileSync(
        jsonPath,
        `${JSON.stringify(comparison, null, 2)}\n`,
        "utf8"
    );
    writeFileSync(
        markdownPath,
        renderRepeatedComparisonMarkdown(comparison),
        "utf8"
    );
    return { jsonPath, markdownPath };
}

function usage() {
    return [
        "Usage: node compare-run-sets.mjs <repeated-comparison-manifest.json> [options]",
        "",
        "Options:",
        "  -o, --out <directory>       Output directory (default: pace-output)",
        "      --include-identifiers    Preserve comparison and evidence identifiers",
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
            if (index >= argv.length) {
                throw new Error(`${argument} requires a directory`);
            }
            output = argv[index];
            continue;
        }
        if (argument === "--include-identifiers") {
            includeIdentifiers = true;
            continue;
        }
        if (argument.startsWith("-")) {
            throw new Error(`unknown option: ${argument}`);
        }
        if (input !== null) {
            throw new Error(
                "only one repeated comparison manifest is supported"
            );
        }
        input = argument;
    }

    if (input === null) {
        throw new Error("a repeated comparison manifest is required");
    }
    return { input, output, includeIdentifiers, help: false };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const comparison = await compareRepeatedRunManifest(args.input, {
            includeIdentifiers: args.includeIdentifiers
        });
        const paths = writeRepeatedComparisonArtifacts(
            comparison,
            args.output
        );
        process.stdout.write(`${paths.jsonPath}\n${paths.markdownPath}\n`);
    } catch (error) {
        process.stderr.write(
            `pace repeated run comparison failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
