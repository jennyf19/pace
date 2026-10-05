import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    EVIDENCE_LEVELS,
    RUN_METRICS
} from "./profile-run.mjs";
import { protectedRunId } from "./profile-session.mjs";

const SCHEMA_VERSION = "0.1";
const DECISION_GOALS = new Set([
    "decrease",
    "increase",
    "not_increase",
    "not_decrease"
]);
const PROTECTED_IDENTIFIER = /^sha256:[a-f0-9]{16}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const DETERMINISTIC_ZERO_METRICS = [
    "api_time_ms",
    "input_tokens",
    "non_cached_input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "tool_definition_tokens",
    "ai_units",
    "premium_requests"
];

function validateCompositeRunProfile(profile, label) {
    const components = profile.accounting?.components;
    if (!Array.isArray(components) || components.length < 2) {
        throw new Error(
            `${label} composite run requires at least two component receipts`
        );
    }
    const componentKeys = new Set();
    const evidenceBindings = new Set();
    for (const [index, component] of components.entries()) {
        if (
            typeof component?.component_key !== "string" ||
            !component.component_key.trim()
        ) {
            throw new Error(
                `${label} composite component ${index + 1} requires component_key`
            );
        }
        if (componentKeys.has(component.component_key)) {
            throw new Error(
                `${label} composite run contains duplicate component_key`
            );
        }
        componentKeys.add(component.component_key);
        if (
            typeof component.run_profile_sha256 !== "string" ||
            !SHA256_PATTERN.test(component.run_profile_sha256)
        ) {
            throw new Error(
                `${label} composite component ${index + 1} requires run_profile_sha256`
            );
        }
        if (
            !Array.isArray(component.contributing_evidence_bindings) ||
            component.contributing_evidence_bindings.length === 0
        ) {
            throw new Error(
                `${label} composite component ${index + 1} requires contributing evidence bindings`
            );
        }
        for (const binding of component.contributing_evidence_bindings) {
            if (
                typeof binding !== "string" ||
                !SHA256_PATTERN.test(binding)
            ) {
                throw new Error(
                    `${label} composite component ${index + 1} has an invalid evidence binding`
                );
            }
            if (evidenceBindings.has(binding)) {
                throw new Error(
                    `${label} composite run reuses contributing session evidence`
                );
            }
            evidenceBindings.add(binding);
        }
    }
    for (const session of profile.sessions) {
        if (!componentKeys.has(session.component_key)) {
            throw new Error(
                `${label} composite session requires a known component_key`
            );
        }
    }
}

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pathValue(inputPath) {
    return inputPath instanceof URL ? fileURLToPath(inputPath) : inputPath;
}

function canonicalPath(inputPath) {
    return process.platform === "win32" ? inputPath.toLowerCase() : inputPath;
}

export function protectedIdentifier(value, includeIdentifiers) {
    if (includeIdentifiers || PROTECTED_IDENTIFIER.test(value)) return value;
    return protectedRunId(value, false);
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

function markdownText(value) {
    return String(value ?? "unknown").replaceAll("|", "\\|").replaceAll("`", "\\`");
}

export async function readJson(inputPath, label) {
    const resolvedPath = resolve(pathValue(inputPath));
    let value;
    let bytes;
    try {
        bytes = await readFile(resolvedPath);
        value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
        throw new Error(`cannot read ${label}: ${error.message}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object`);
    }
    return {
        value,
        resolvedPath,
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
}

function validateReceiptHash(value, label) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw new Error(`${label} requires a SHA-256 digest`);
    }
}

function validateDeterministicRunProfile(profile, label) {
    if (profile.sessions.length !== 1) {
        throw new Error(`${label} deterministic run requires exactly one session`);
    }
    const session = profile.sessions[0];
    if (
        session.billing !== "independent" ||
        session.included_in !== null ||
        profile.accounting.contributing_sessions.length !== 1 ||
        profile.accounting.contributing_sessions[0] !== session.session_key
    ) {
        throw new Error(
            `${label} deterministic run requires one contributing independent session`
        );
    }
    const evidence = session.profile;
    if (
        evidence?.artifact?.format !== "pace-deterministic-json-transform" ||
        evidence.artifact.contract_version !== "0.1"
    ) {
        throw new Error(
            `${label} deterministic run requires a deterministic JSON artifact receipt`
        );
    }
    const implementation = evidence.artifact.implementation;
    if (
        !Array.isArray(implementation?.files) ||
        implementation.files.length < 2
    ) {
        throw new Error(
            `${label} deterministic run requires runner and implementation hashes`
        );
    }
    validateReceiptHash(
        implementation.files_sha256,
        `${label} deterministic implementation`
    );
    for (const [index, file] of implementation.files.entries()) {
        validateReceiptHash(
            file?.binding_sha256,
            `${label} deterministic implementation file ${index + 1} binding`
        );
        validateReceiptHash(
            file?.sha256,
            `${label} deterministic implementation file ${index + 1}`
        );
        if (!Number.isInteger(file?.size_bytes) || file.size_bytes < 0) {
            throw new Error(
                `${label} deterministic implementation file ${index + 1} requires size_bytes`
            );
        }
    }
    for (const [kind, receipt] of [
        ["input", evidence.artifact.input],
        ["output", evidence.artifact.output]
    ]) {
        validateReceiptHash(
            receipt?.binding_sha256,
            `${label} deterministic ${kind} binding`
        );
        validateReceiptHash(
            receipt?.sha256,
            `${label} deterministic ${kind}`
        );
        if (!Number.isInteger(receipt?.size_bytes) || receipt.size_bytes < 0) {
            throw new Error(
                `${label} deterministic ${kind} requires size_bytes`
            );
        }
    }
    const proof = evidence.accounting?.zero_model_usage;
    const topLevelProof = profile.accounting.deterministic_execution_contract;
    if (
        proof?.method !== "synchronous_local_json_transform_v1" ||
        proof.complete !== true ||
        proof.transform_result !== "synchronous" ||
        proof.model_calls !== 0 ||
        proof.provider_api_calls !== 0 ||
        proof.runner_source_hash_included !== true ||
        proof.implementation_hashes_verified_before_and_after !== true ||
        topLevelProof?.method !== proof.method ||
        topLevelProof.complete !== true
    ) {
        throw new Error(
            `${label} deterministic zero usage requires a complete explicit execution contract`
        );
    }
    if (
        evidence.runtime?.name !== "node" ||
        evidence.runtime.selected_model !== null ||
        evidence.runtime.context_tier !== null ||
        !Array.isArray(evidence.runtime.reasoning_efforts) ||
        evidence.runtime.reasoning_efforts.length !== 0
    ) {
        throw new Error(
            `${label} deterministic runtime must not declare a model, context tier, or reasoning effort`
        );
    }
    if (
        !Array.isArray(evidence.model_calls) ||
        evidence.model_calls.length !== 0 ||
        evidence.stages?.some((stage) => stage.kind === "model")
    ) {
        throw new Error(
            `${label} deterministic run must contain zero model-call evidence`
        );
    }
    for (const metric of DETERMINISTIC_ZERO_METRICS) {
        if (
            proof.metrics?.[metric] !== 0 ||
            evidence.totals?.[metric] !== 0 ||
            profile.totals[metric] !== 0
        ) {
            throw new Error(
                `${label} deterministic ${metric} must be explicitly measured as zero`
            );
        }
    }
    if (
        evidence.totals?.wall_time_ms !== profile.totals.wall_time_ms ||
        evidence.totals?.elapsed_span_ms !== profile.totals.elapsed_span_ms
    ) {
        throw new Error(
            `${label} deterministic timing must match its execution evidence`
        );
    }
    if (
        evidence.coverage?.evidence_level !== "L3" ||
        profile.coverage.evidence_level !== "L3" ||
        evidence.coverage.missing?.length !== 0 ||
        profile.coverage.missing.length !== 0
    ) {
        throw new Error(
            `${label} deterministic run requires complete L3 execution evidence`
        );
    }
}

function validateDecisionMetrics(rawMetrics) {
    if (!Array.isArray(rawMetrics) || rawMetrics.length === 0) {
        throw new Error("comparison manifest requires at least one decision metric");
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
        if (seen.has(raw.metric)) {
            throw new Error(`duplicate decision metric: ${raw.metric}`);
        }
        seen.add(raw.metric);
        if (!DECISION_GOALS.has(raw.goal)) {
            throw new Error(
                `decision metric ${raw.metric} goal must be decrease, increase, not_increase, or not_decrease`
            );
        }
        return {
            metric: raw.metric,
            goal: raw.goal
        };
    });
}

async function loadComparisonManifest(inputPath) {
    const { value: manifest, resolvedPath: manifestPath } = await readJson(
        inputPath,
        "comparison manifest"
    );
    if (manifest.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `comparison manifest schema_version must be ${SCHEMA_VERSION}`
        );
    }
    if (
        typeof manifest.comparison_id !== "string" ||
        !manifest.comparison_id.trim()
    ) {
        throw new Error("comparison manifest requires a non-empty comparison_id");
    }
    const pathFields = [
        "baseline_profile",
        "candidate_profile",
        "quality_result"
    ];
    const baseDirectory = dirname(manifestPath);
    const paths = {};
    for (const field of pathFields) {
        if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
            throw new Error(`comparison manifest requires ${field}`);
        }
        const requestedPath = resolve(baseDirectory, manifest[field]);
        try {
            paths[field] = await realpath(requestedPath);
        } catch (error) {
            throw new Error(`cannot resolve ${field}: ${error.message}`);
        }
    }
    if (
        canonicalPath(paths.baseline_profile) ===
        canonicalPath(paths.candidate_profile)
    ) {
        throw new Error("baseline and candidate profiles must be different files");
    }
    return {
        manifest,
        manifestPath,
        paths,
        decisionMetrics: validateDecisionMetrics(manifest.decision_metrics)
    };
}

export function validateRunProfile(profile, label) {
    if (profile.schema_version !== SCHEMA_VERSION) {
        throw new Error(`${label} schema_version must be ${SCHEMA_VERSION}`);
    }
    if (!["manifest", "deterministic", "composite"].includes(profile.run_type)) {
        throw new Error(
            `${label} must be a Pace manifest, deterministic, or composite run profile`
        );
    }
    if (typeof profile.run_id !== "string" || !profile.run_id.trim()) {
        throw new Error(`${label} requires a non-empty run_id`);
    }
    if (!profile.totals || typeof profile.totals !== "object") {
        throw new Error(`${label} requires totals`);
    }
    if (
        !profile.accounting ||
        typeof profile.accounting !== "object" ||
        !profile.accounting.metric_coverage ||
        typeof profile.accounting.metric_coverage !== "object"
    ) {
        throw new Error(`${label} requires accounting.metric_coverage`);
    }
    for (const metric of RUN_METRICS) {
        const total = numberOrNull(profile.totals[metric]);
        const coverage = profile.accounting.metric_coverage[metric];
        if (!coverage || typeof coverage !== "object") {
            throw new Error(`${label} is missing coverage for ${metric}`);
        }
        if (typeof coverage.complete !== "boolean") {
            throw new Error(`${label} ${metric} coverage requires complete`);
        }
        if (!Array.isArray(coverage.missing_sessions)) {
            throw new Error(
                `${label} ${metric} coverage requires missing_sessions`
            );
        }
        if (coverage.complete && total === null) {
            throw new Error(
                `${label} ${metric} is marked complete but has no total`
            );
        }
        if (!coverage.complete && total !== null) {
            throw new Error(
                `${label} ${metric} is incomplete but has a final total`
            );
        }
    }
    if (
        !profile.coverage ||
        !EVIDENCE_LEVELS.includes(profile.coverage.evidence_level)
    ) {
        throw new Error(`${label} requires a valid coverage evidence_level`);
    }
    if (
        !Array.isArray(profile.coverage.missing) ||
        !Array.isArray(profile.coverage.warnings)
    ) {
        throw new Error(`${label} requires coverage missing and warning arrays`);
    }
    if (!Array.isArray(profile.sessions)) {
        throw new Error(`${label} requires sessions`);
    }
    if (!Array.isArray(profile.accounting.contributing_sessions)) {
        throw new Error(`${label} requires accounting.contributing_sessions`);
    }
    const sessions = new Map();
    for (const session of profile.sessions) {
        if (
            !session ||
            typeof session !== "object" ||
            typeof session.session_key !== "string"
        ) {
            throw new Error(`${label} contains an invalid session`);
        }
        sessions.set(session.session_key, session);
    }
    for (const sessionKey of profile.accounting.contributing_sessions) {
        const session = sessions.get(sessionKey);
        if (!session) {
            throw new Error(
                `${label} contributing session ${sessionKey} is not present`
            );
        }
        if (!session.profile?.accounting) {
            throw new Error(
                `${label} contributing session ${sessionKey} has no accounting evidence`
            );
        }
        if (
            typeof session.profile.run_id !== "string" ||
            !session.profile.run_id.trim()
        ) {
            throw new Error(
                `${label} contributing session ${sessionKey} has no evidence run_id`
            );
        }
    }
    if (profile.run_type === "deterministic") {
        validateDeterministicRunProfile(profile, label);
    } else if (profile.run_type === "composite") {
        validateCompositeRunProfile(profile, label);
    }
    return profile;
}

export async function loadRunProfile(inputPath, label) {
    const { value } = await readJson(inputPath, label);
    return validateRunProfile(value, label);
}

export async function loadRunProfileEvidence(inputPath, label) {
    const { value, resolvedPath, sha256 } = await readJson(inputPath, label);
    return {
        profile: validateRunProfile(value, label),
        resolvedPath,
        sha256
    };
}

export function contributingEvidenceIds(profile) {
    const contributors = new Set(profile.accounting.contributing_sessions);
    return profile.sessions
        .filter((session) => contributors.has(session.session_key))
        .map((session) => session.profile.run_id);
}

export function normalizeQualityEntry(raw, label) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`quality result ${label} must be an object`);
    }
    for (const field of ["run_id", "corpus_id", "evaluator_id"]) {
        if (typeof raw[field] !== "string" || !raw[field].trim()) {
            throw new Error(
                `quality result ${label} requires a non-empty ${field}`
            );
        }
    }
    if (
        typeof raw.run_profile_sha256 !== "string" ||
        !SHA256_PATTERN.test(raw.run_profile_sha256)
    ) {
        throw new Error(
            `quality result ${label} requires run_profile_sha256`
        );
    }
    if (typeof raw.complete !== "boolean") {
        throw new Error(`quality result ${label} requires complete`);
    }
    if (
        raw.passed !== null &&
        raw.passed !== undefined &&
        typeof raw.passed !== "boolean"
    ) {
        throw new Error(`quality result ${label} passed must be boolean or null`);
    }
    if (raw.complete && typeof raw.passed !== "boolean") {
        throw new Error(
            `quality result ${label} requires passed when complete is true`
        );
    }
    if (
        raw.score !== null &&
        raw.score !== undefined &&
        numberOrNull(raw.score) === null
    ) {
        throw new Error(`quality result ${label} score must be numeric or null`);
    }
    return {
        run_id: raw.run_id,
        run_profile_sha256: raw.run_profile_sha256.toLowerCase(),
        corpus_id: raw.corpus_id,
        evaluator_id: raw.evaluator_id,
        complete: raw.complete,
        passed: typeof raw.passed === "boolean" ? raw.passed : null,
        score: numberOrNull(raw.score)
    };
}

export function normalizeIssueIds(value, field) {
    if (!Array.isArray(value)) {
        throw new Error(`quality result requires ${field}`);
    }
    return value.map((item, index) => {
        if (typeof item !== "string" || !item.trim()) {
            throw new Error(
                `quality result ${field}[${index}] must be a non-empty string`
            );
        }
        return item;
    });
}

async function loadQualityResult(
    inputPath,
    baselineProfile,
    candidateProfile,
    baselineProfileSha256,
    candidateProfileSha256
) {
    const { value: raw } = await readJson(inputPath, "quality result");
    if (raw.schema_version !== SCHEMA_VERSION) {
        throw new Error(`quality result schema_version must be ${SCHEMA_VERSION}`);
    }
    const baseline = normalizeQualityEntry(raw.baseline, "baseline");
    const candidate = normalizeQualityEntry(raw.candidate, "candidate");
    const regressions = normalizeIssueIds(raw.regressions, "regressions");
    const lostFindings = normalizeIssueIds(raw.lost_findings, "lost_findings");

    if (baseline.run_id !== baselineProfile.run_id) {
        throw new Error("quality baseline run_id does not match the baseline profile");
    }
    if (candidate.run_id !== candidateProfile.run_id) {
        throw new Error(
            "quality candidate run_id does not match the candidate profile"
        );
    }
    if (baseline.run_profile_sha256 !== baselineProfileSha256) {
        throw new Error(
            "quality baseline run_profile_sha256 does not match the baseline profile"
        );
    }
    if (candidate.run_profile_sha256 !== candidateProfileSha256) {
        throw new Error(
            "quality candidate run_profile_sha256 does not match the candidate profile"
        );
    }
    if (baseline.corpus_id !== candidate.corpus_id) {
        throw new Error(
            "baseline and candidate quality results must use the same corpus identity"
        );
    }
    if (baseline.evaluator_id !== candidate.evaluator_id) {
        throw new Error(
            "baseline and candidate quality results must use the same evaluator identity"
        );
    }
    return {
        baseline,
        candidate,
        regressions,
        lost_findings: lostFindings
    };
}

export function metricCoverage(profile, metric, includeIdentifiers) {
    const coverage = profile.accounting.metric_coverage[metric];
    const value = numberOrNull(profile.totals[metric]);
    const reportedSubtotal =
        metric === "wall_time_ms"
            ? numberOrNull(coverage.known_span_ms)
            : numberOrNull(coverage.known_subtotal);
    return {
        value,
        known_subtotal: reportedSubtotal ?? value,
        complete: coverage.complete,
        missing_sessions: coverage.missing_sessions.map((session) =>
            protectedIdentifier(String(session), includeIdentifiers)
        )
    };
}

export function percentageDelta(baseline, candidate) {
    if (baseline === 0) {
        return candidate === 0
            ? { value: 0, status: "available" }
            : { value: null, status: "zero_baseline" };
    }
    return {
        value: ((candidate - baseline) / baseline) * 100,
        status: "available"
    };
}

function compareMetric(
    baselineProfile,
    candidateProfile,
    metric,
    includeIdentifiers
) {
    const baseline = metricCoverage(
        baselineProfile,
        metric,
        includeIdentifiers
    );
    const candidate = metricCoverage(
        candidateProfile,
        metric,
        includeIdentifiers
    );
    const complete = baseline.complete && candidate.complete;
    const percent = complete
        ? percentageDelta(baseline.value, candidate.value)
        : { value: null, status: "incomplete" };
    return {
        baseline,
        candidate,
        complete,
        absolute_delta: complete ? candidate.value - baseline.value : null,
        percent_delta: percent.value,
        percent_delta_status: percent.status
    };
}

export function collectResiduals(profile, includeIdentifiers) {
    const contributors = new Set(profile.accounting.contributing_sessions);
    const residuals = [];
    for (const session of profile.sessions) {
        if (!contributors.has(session.session_key)) continue;
        for (const [view, reconciliation] of [
            ["model", session.profile.accounting.model_reconciliation],
            ["agent", session.profile.accounting.agent_reconciliation]
        ]) {
            if (!reconciliation || typeof reconciliation !== "object") continue;
            for (const [metric, result] of Object.entries(reconciliation)) {
                if (!result || result.reconciled !== false) continue;
                residuals.push({
                    session_key: protectedIdentifier(
                        session.session_key,
                        includeIdentifiers
                    ),
                    view,
                    metric,
                    total: numberOrNull(result.total),
                    attributed: numberOrNull(result.attributed),
                    difference: numberOrNull(result.difference)
                });
            }
        }
    }
    return residuals.sort((left, right) =>
        `${left.session_key}:${left.view}:${left.metric}`.localeCompare(
            `${right.session_key}:${right.view}:${right.metric}`
        )
    );
}

export function evaluateGoal(metricComparison, goal) {
    if (!metricComparison.complete) {
        return {
            goal_met: null,
            strict_improvement: null
        };
    }
    const delta = metricComparison.absolute_delta;
    if (goal === "decrease") {
        return {
            goal_met: delta < 0,
            strict_improvement: delta < 0
        };
    }
    if (goal === "increase") {
        return {
            goal_met: delta > 0,
            strict_improvement: delta > 0
        };
    }
    if (goal === "not_increase") {
        return {
            goal_met: delta <= 0,
            strict_improvement: delta < 0
        };
    }
    return {
        goal_met: delta >= 0,
        strict_improvement: delta > 0
    };
}

function evidenceFloor(baselineProfile, candidateProfile) {
    const indexes = [
        baselineProfile.coverage.evidence_level,
        candidateProfile.coverage.evidence_level
    ].map((level) => EVIDENCE_LEVELS.indexOf(level));
    return EVIDENCE_LEVELS[Math.min(...indexes)];
}

function summarizeRun(profile, profileSha256, includeIdentifiers) {
    return {
        run_id: protectedIdentifier(profile.run_id, includeIdentifiers),
        run_profile_sha256: profileSha256,
        evidence_level: profile.coverage.evidence_level,
        missing_measurements: profile.coverage.missing.length,
        warnings: profile.coverage.warnings.length
    };
}

function summarizeQuality(quality, includeIdentifiers) {
    const summarizeEntry = (entry) => ({
        run_id: protectedIdentifier(entry.run_id, includeIdentifiers),
        run_profile_sha256: entry.run_profile_sha256,
        complete: entry.complete,
        passed: entry.passed,
        score: entry.score
    });
    return {
        same_corpus: true,
        same_evaluator: true,
        corpus_id: protectedIdentifier(
            quality.baseline.corpus_id,
            includeIdentifiers
        ),
        evaluator_id: protectedIdentifier(
            quality.baseline.evaluator_id,
            includeIdentifiers
        ),
        baseline: summarizeEntry(quality.baseline),
        candidate: summarizeEntry(quality.candidate),
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
    const knownQualityFailure =
        (quality.candidate.complete && quality.candidate.passed === false) ||
        quality.regressions.length > 0 ||
        quality.lost_findings.length > 0;
    const qualityReady =
        quality.baseline.complete &&
        quality.baseline.passed === true &&
        quality.candidate.complete &&
        quality.candidate.passed === true &&
        quality.regressions.length === 0 &&
        quality.lost_findings.length === 0;
    const incompleteMetrics = decisions
        .filter((decision) => !decision.complete)
        .map((decision) => decision.metric);
    const accountingReady =
        incompleteMetrics.length === 0 && blockingResiduals.length === 0;
    const failedGoals = decisions.filter(
        (decision) => decision.goal_met === false
    );
    const hasMeasuredImprovement = decisions.some(
        (decision) => decision.strict_improvement === true
    );

    if (knownQualityFailure) {
        if (quality.candidate.complete && quality.candidate.passed === false) {
            reasons.push("candidate failed the external quality gate");
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
        if (!quality.baseline.complete || !quality.candidate.complete) {
            reasons.push("external quality evidence is incomplete");
        }
        if (quality.baseline.complete && quality.baseline.passed === false) {
            reasons.push("baseline did not pass the declared quality bar");
        }
    }
    if (incompleteMetrics.length > 0) {
        reasons.push(
            `decision metric accounting is incomplete for: ${incompleteMetrics.join(", ")}`
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
            `candidate missed the declared goal for: ${failedGoals.map((item) => item.metric).join(", ")}`
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
        reasons.push("candidate produced no strict improvement in a decision metric");
        return {
            disposition: "revise",
            qualityGate: "passed",
            accountingGate: "passed",
            performanceGate: "no_measured_improvement",
            reasons
        };
    }
    reasons.push(
        "candidate met every decision metric and improved at least one without a quality regression"
    );
    return {
        disposition: "keep",
        qualityGate: "passed",
        accountingGate: "passed",
        performanceGate: "passed",
        reasons
    };
}

export async function compareRunManifest(inputPath, options = {}) {
    const {
        manifest,
        paths,
        decisionMetrics
    } = await loadComparisonManifest(inputPath);
    const includeIdentifiers = options.includeIdentifiers === true;
    const [baselineProfileEvidence, candidateProfileEvidence] =
        await Promise.all([
        loadRunProfileEvidence(
            paths.baseline_profile,
            "baseline run profile"
        ),
        loadRunProfileEvidence(
            paths.candidate_profile,
            "candidate run profile"
        )
    ]);
    const baselineProfile = baselineProfileEvidence.profile;
    const candidateProfile = candidateProfileEvidence.profile;
    if (baselineProfile.run_id === candidateProfile.run_id) {
        throw new Error("baseline and candidate run profiles must have different run_id values");
    }
    const baselineEvidence = new Set(
        contributingEvidenceIds(baselineProfile)
    );
    if (
        contributingEvidenceIds(candidateProfile).some((runId) =>
            baselineEvidence.has(runId)
        )
    ) {
        throw new Error(
            "baseline and candidate share contributing session evidence"
        );
    }
    const quality = await loadQualityResult(
        paths.quality_result,
        baselineProfile,
        candidateProfile,
        baselineProfileEvidence.sha256,
        candidateProfileEvidence.sha256
    );
    const metrics = Object.fromEntries(
        RUN_METRICS.map((metric) => [
            metric,
            compareMetric(
                baselineProfile,
                candidateProfile,
                metric,
                includeIdentifiers
            )
        ])
    );
    const decisions = decisionMetrics.map(({ metric, goal }) => {
        const comparison = metrics[metric];
        return {
            metric,
            goal,
            complete: comparison.complete,
            absolute_delta: comparison.absolute_delta,
            percent_delta: comparison.percent_delta,
            percent_delta_status: comparison.percent_delta_status,
            ...evaluateGoal(comparison, goal)
        };
    });
    const baselineResiduals = collectResiduals(
        baselineProfile,
        includeIdentifiers
    );
    const candidateResiduals = collectResiduals(
        candidateProfile,
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
        comparison_type: "run_profiles",
        baseline: summarizeRun(
            baselineProfile,
            baselineProfileEvidence.sha256,
            includeIdentifiers
        ),
        candidate: summarizeRun(
            candidateProfile,
            candidateProfileEvidence.sha256,
            includeIdentifiers
        ),
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
            evidence_floor: evidenceFloor(baselineProfile, candidateProfile),
            decision_metrics_complete: decisions.every(
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

export function renderComparisonMarkdown(comparison) {
    const lines = [
        "# Pace run comparison",
        "",
        `**Comparison:** \`${markdownText(comparison.comparison_id)}\`  `,
        `**Disposition:** \`${comparison.disposition}\`  `,
        `**Evidence floor:** ${comparison.accounting.evidence_floor}`,
        "",
        "## Decision",
        "",
        "| Metric | Goal | Baseline | Candidate | Delta | Delta % | Complete | Goal met |",
        "|---|---|---:|---:|---:|---:|---|---|"
    ];
    for (const decision of comparison.decision.metrics) {
        const metric = comparison.metrics[decision.metric];
        lines.push(
            `| ${markdownText(decision.metric)} | ${markdownText(decision.goal)} | ${display(metric.baseline.value)} | ${display(metric.candidate.value)} | ${display(decision.absolute_delta)} | ${displayPercent(decision.percent_delta, decision.percent_delta_status)} | ${decision.complete ? "yes" : "no"} | ${decision.goal_met === null ? "unmeasured" : decision.goal_met ? "yes" : "no"} |`
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
        "## Quality",
        "",
        `- Corpus identity matched: ${comparison.quality.same_corpus ? "yes" : "no"}.`,
        `- Evaluator identity matched: ${comparison.quality.same_evaluator ? "yes" : "no"}.`,
        `- Baseline complete/pass: ${comparison.quality.baseline.complete ? "yes" : "no"}/${comparison.quality.baseline.passed === null ? "unmeasured" : comparison.quality.baseline.passed ? "yes" : "no"}.`,
        `- Candidate complete/pass: ${comparison.quality.candidate.complete ? "yes" : "no"}/${comparison.quality.candidate.passed === null ? "unmeasured" : comparison.quality.candidate.passed ? "yes" : "no"}.`,
        `- Reported regressions: ${comparison.quality.regressions.length}.`,
        `- Lost findings: ${comparison.quality.lost_findings.length}.`
    );

    lines.push(
        "",
        "## Metric coverage",
        "",
        "| Metric | Baseline | Baseline complete | Candidate | Candidate complete | Delta |",
        "|---|---:|---|---:|---|---:|"
    );
    for (const [metric, result] of Object.entries(comparison.metrics)) {
        lines.push(
            `| ${markdownText(metric)} | ${display(result.baseline.value)} | ${result.baseline.complete ? "yes" : "no"} | ${display(result.candidate.value)} | ${result.candidate.complete ? "yes" : "no"} | ${display(result.absolute_delta)} |`
        );
    }

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
            "| Side | Session | View | Metric | Residual | Blocks keep |",
            "|---|---|---|---|---:|---|"
        );
        const blocking = new Set(
            comparison.accounting.blocking_residuals.map(
                (item) =>
                    `${item.side}:${item.session_key}:${item.view}:${item.metric}`
            )
        );
        for (const residual of residuals) {
            const key = `${residual.side}:${residual.session_key}:${residual.view}:${residual.metric}`;
            lines.push(
                `| ${residual.side} | \`${markdownText(residual.session_key)}\` | ${residual.view} | ${markdownText(residual.metric)} | ${display(residual.difference)} | ${blocking.has(key) ? "yes" : "no"} |`
            );
        }
    }
    return `${lines.join("\n")}\n`;
}

export function writeComparisonArtifacts(comparison, outputDirectory) {
    const output = resolve(outputDirectory);
    mkdirSync(output, { recursive: true });
    const safeComparisonId = comparison.comparison_id.replaceAll(
        /[^a-zA-Z0-9._-]/g,
        "-"
    );
    const jsonPath = join(output, `${safeComparisonId}.comparison.json`);
    const markdownPath = join(
        output,
        `${safeComparisonId}.comparison-report.md`
    );
    writeFileSync(
        jsonPath,
        `${JSON.stringify(comparison, null, 2)}\n`,
        "utf8"
    );
    writeFileSync(
        markdownPath,
        renderComparisonMarkdown(comparison),
        "utf8"
    );
    return { jsonPath, markdownPath };
}

function usage() {
    return [
        "Usage: node compare-runs.mjs <comparison-manifest.json> [options]",
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
            throw new Error("only one comparison manifest is supported");
        }
        input = argument;
    }

    if (input === null) throw new Error("a comparison manifest is required");
    return { input, output, includeIdentifiers, help: false };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const comparison = await compareRunManifest(args.input, {
            includeIdentifiers: args.includeIdentifiers
        });
        const paths = writeComparisonArtifacts(comparison, args.output);
        process.stdout.write(`${paths.jsonPath}\n${paths.markdownPath}\n`);
    } catch (error) {
        process.stderr.write(`pace run comparison failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
