import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    contributingEvidenceIds,
    loadRunProfileEvidence,
    protectedIdentifier,
    readJson
} from "./compare-runs.mjs";

const SCHEMA_VERSION = "0.1";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const RUNTIME_FIELDS = [
    "name",
    "version",
    "producer",
    "selected_model",
    "context_tier"
];

function canonicalPath(inputPath) {
    return process.platform === "win32" ? inputPath.toLowerCase() : inputPath;
}

function stableJson(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item)).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys
        .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
        .join(",")}}`;
}

function sha256Value(value) {
    return `sha256:${createHash("sha256")
        .update(value)
        .digest("hex")}`;
}

export async function sha256File(inputPath) {
    const bytes = await readFile(inputPath);
    return {
        sha256: `sha256:${createHash("sha256")
            .update(bytes)
            .digest("hex")}`,
        size_bytes: bytes.length
    };
}

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function normalizeRuntimeSignature(raw, label) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${label} must be an object`);
    }
    const signature = {};
    for (const field of RUNTIME_FIELDS) {
        const value = raw[field];
        if (value !== null && typeof value !== "string") {
            throw new Error(`${label}.${field} must be a string or null`);
        }
        if (field === "name" && (typeof value !== "string" || !value.trim())) {
            throw new Error(`${label}.name must be a non-empty string`);
        }
        signature[field] = value;
    }
    for (const field of ["models", "reasoning_efforts"]) {
        if (
            !Array.isArray(raw[field]) ||
            raw[field].some(
                (value) => typeof value !== "string" || !value.trim()
            )
        ) {
            throw new Error(
                `${label}.${field} must be an array of non-empty strings`
            );
        }
        signature[field] = [...new Set(raw[field])].sort();
    }
    return signature;
}

function normalizeRuntimeSet(raw, label) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error(`${label} requires at least one runtime signature`);
    }
    const signatures = raw.map((item, index) =>
        normalizeRuntimeSignature(item, `${label}[${index}]`)
    );
    const unique = new Map();
    for (const signature of signatures) {
        unique.set(stableJson(signature), signature);
    }
    if (unique.size !== signatures.length) {
        throw new Error(`${label} contains duplicate runtime signatures`);
    }
    return [...unique.values()].sort((left, right) =>
        stableJson(left).localeCompare(stableJson(right))
    );
}

function observedRuntimeSet(profile, label) {
    const contributors = new Set(profile.accounting.contributing_sessions);
    const signatures = profile.sessions
        .filter((session) => contributors.has(session.session_key))
        .map((session, index) => {
            const models = new Set();
            const selectedModel = session.profile.runtime?.selected_model;
            if (typeof selectedModel === "string" && selectedModel.trim()) {
                models.add(selectedModel);
            }
            for (const call of session.profile.model_calls ?? []) {
                if (typeof call.model === "string" && call.model.trim()) {
                    models.add(call.model);
                }
            }
            for (const stage of session.profile.stages ?? []) {
                if (
                    stage.kind === "model" &&
                    typeof stage.name === "string" &&
                    stage.name.trim()
                ) {
                    models.add(stage.name);
                }
            }
            return normalizeRuntimeSignature(
                {
                    ...session.profile.runtime,
                    models: [...models],
                    reasoning_efforts:
                        session.profile.runtime?.reasoning_efforts ?? []
                },
                `${label} contributing runtime ${index + 1}`
            );
        });
    const unique = new Map();
    for (const signature of signatures) {
        unique.set(stableJson(signature), signature);
    }
    return [...unique.values()].sort((left, right) =>
        stableJson(left).localeCompare(stableJson(right))
    );
}

function runtimeSetsEqual(left, right) {
    return stableJson(left) === stableJson(right);
}

function validateHash(value, label) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw new Error(`${label} must be a sha256:<64 hex> digest`);
    }
    return value.toLowerCase();
}

async function validateFrozenFiles(
    rawFiles,
    baseDirectory,
    label,
    includeIdentifiers
) {
    if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
        throw new Error(`${label} requires at least one frozen file`);
    }
    const ids = new Set();
    const paths = new Set();
    const descriptors = [];
    for (const [index, raw] of rawFiles.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error(`${label}[${index}] must be an object`);
        }
        const id = requireString(raw.id, `${label}[${index}].id`);
        if (ids.has(id)) throw new Error(`${label} contains duplicate id ${id}`);
        ids.add(id);
        const requestedPath = requireString(
            raw.path,
            `${label}[${index}].path`
        );
        let resolvedPath;
        try {
            resolvedPath = await realpath(resolve(baseDirectory, requestedPath));
        } catch (error) {
            throw new Error(
                `cannot resolve ${label}[${index}].path: ${error.message}`
            );
        }
        const canonical = canonicalPath(resolvedPath);
        if (paths.has(canonical)) {
            throw new Error(`${label} contains a duplicate file path`);
        }
        paths.add(canonical);
        const expectedHash = validateHash(
            raw.sha256,
            `${label}[${index}].sha256`
        );
        const actual = await sha256File(resolvedPath);
        if (actual.sha256 !== expectedHash) {
            throw new Error(`${label} file ${id} hash does not match`);
        }
        descriptors.push({
            id,
            path: resolvedPath,
            sha256: actual.sha256,
            size_bytes: actual.size_bytes,
            receipt: {
                id: protectedIdentifier(id, includeIdentifiers),
                sha256: actual.sha256,
                size_bytes: actual.size_bytes
            }
        });
    }
    return descriptors;
}

function fileSetHash(files) {
    return sha256Value(
        stableJson(
            files.map((file) => ({
                id: file.id,
                sha256: file.sha256,
                size_bytes: file.size_bytes
            }))
        )
    );
}

function validateProfilePaths(rawProfiles, label) {
    if (!Array.isArray(rawProfiles) || rawProfiles.length < 2) {
        throw new Error(`${label} requires at least two run profile paths`);
    }
    return rawProfiles.map((item, index) =>
        requireString(item, `${label}[${index}]`)
    );
}

async function loadCohort({
    raw,
    label,
    baseDirectory,
    allProfilePaths,
    allRunIds,
    allEvidenceIds,
    includeIdentifiers
}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${label} cohort must be an object`);
    }
    const profileRequests = validateProfilePaths(
        raw.profiles,
        `${label}.profiles`
    );
    if (
        !raw.configuration ||
        typeof raw.configuration !== "object" ||
        Array.isArray(raw.configuration)
    ) {
        throw new Error(`${label}.configuration must be an object`);
    }
    const configurationId = requireString(
        raw.configuration.id,
        `${label}.configuration.id`
    );
    const expectedRuntime = normalizeRuntimeSet(
        raw.configuration.expected_runtime,
        `${label}.configuration.expected_runtime`
    );
    const configurationFiles = await validateFrozenFiles(
        raw.configuration.files,
        baseDirectory,
        `${label}.configuration.files`,
        includeIdentifiers
    );
    const profilePaths = [];
    for (const [index, requestedPath] of profileRequests.entries()) {
        let resolvedPath;
        try {
            resolvedPath = await realpath(resolve(baseDirectory, requestedPath));
        } catch (error) {
            throw new Error(
                `cannot resolve ${label}.profiles[${index}]: ${error.message}`
            );
        }
        const canonical = canonicalPath(resolvedPath);
        if (allProfilePaths.has(canonical)) {
            throw new Error("replay manifest contains a duplicate profile path");
        }
        allProfilePaths.add(canonical);
        profilePaths.push(resolvedPath);
    }
    const profileEvidence = await Promise.all(
        profilePaths.map((path, index) =>
            loadRunProfileEvidence(
                path,
                `${label} run profile ${index + 1}`
            )
        )
    );
    const profiles = profileEvidence.map((evidence) => evidence.profile);
    const runs = [];
    for (const [index, evidence] of profileEvidence.entries()) {
        const profile = evidence.profile;
        if (allRunIds.has(profile.run_id)) {
            throw new Error(
                `replay manifest contains duplicate run_id ${profile.run_id}`
            );
        }
        allRunIds.add(profile.run_id);
        const evidenceIds = contributingEvidenceIds(profile);
        for (const evidenceId of evidenceIds) {
            if (allEvidenceIds.has(evidenceId)) {
                throw new Error(
                    "replay manifest contains duplicate contributing session evidence"
                );
            }
            allEvidenceIds.add(evidenceId);
        }
        const observedRuntime = observedRuntimeSet(
            profile,
            `${label} run profile ${index + 1}`
        );
        if (!runtimeSetsEqual(observedRuntime, expectedRuntime)) {
            throw new Error(
                `${label} run profile ${index + 1} runtime does not match the frozen configuration`
            );
        }
        runs.push({
            run_id: protectedIdentifier(profile.run_id, includeIdentifiers),
            run_profile_sha256: evidence.sha256,
            run_binding_sha256: sha256Value(profile.run_id),
            contributing_evidence_bindings: evidenceIds.map((evidenceId) =>
                sha256Value(evidenceId)
            ),
            runtime_fingerprint: sha256Value(stableJson(observedRuntime))
        });
    }
    const configurationFileHash = fileSetHash(configurationFiles);
    const expectedRuntimeFingerprint = sha256Value(
        stableJson(expectedRuntime)
    );
    const configurationHash = sha256Value(
        stableJson({
            id: configurationId,
            files: configurationFileHash,
            expected_runtime: expectedRuntimeFingerprint
        })
    );
    return {
        profiles,
        profileHashes: new Map(
            profileEvidence.map((evidence) => [
                evidence.profile.run_id,
                evidence.sha256
            ])
        ),
        raw: {
            configuration_id: configurationId,
            expected_runtime: expectedRuntime
        },
        receipt: {
            configuration_id: protectedIdentifier(
                configurationId,
                includeIdentifiers
            ),
            configuration_binding_sha256: sha256Value(configurationId),
            configuration_files: configurationFiles.map(
                (file) => file.receipt
            ),
            configuration_files_sha256: configurationFileHash,
            expected_runtime_fingerprint: expectedRuntimeFingerprint,
            configuration_sha256: configurationHash,
            sample_count: profiles.length,
            runs
        }
    };
}

export async function loadReplayManifest(inputPath, options = {}) {
    const { value: manifest, resolvedPath: manifestPath } = await readJson(
        inputPath,
        "replay manifest"
    );
    if (manifest.schema_version !== SCHEMA_VERSION) {
        throw new Error(`replay manifest schema_version must be ${SCHEMA_VERSION}`);
    }
    const includeIdentifiers = options.includeIdentifiers === true;
    const replayId = requireString(manifest.replay_id, "replay_id");
    if (
        !manifest.evaluator ||
        typeof manifest.evaluator !== "object" ||
        Array.isArray(manifest.evaluator)
    ) {
        throw new Error("replay manifest requires evaluator");
    }
    const evaluatorId = requireString(
        manifest.evaluator.id,
        "evaluator.id"
    );
    if (
        !manifest.workload ||
        typeof manifest.workload !== "object" ||
        Array.isArray(manifest.workload)
    ) {
        throw new Error("replay manifest requires workload");
    }
    const corpusId = requireString(
        manifest.workload.corpus_id,
        "workload.corpus_id"
    );
    const sourceRevision = requireString(
        manifest.workload.source_revision,
        "workload.source_revision"
    );
    const baseDirectory = dirname(manifestPath);
    const workloadFiles = await validateFrozenFiles(
        manifest.workload.files,
        baseDirectory,
        "workload.files",
        includeIdentifiers
    );
    const evaluatorFiles = await validateFrozenFiles(
        manifest.evaluator.files,
        baseDirectory,
        "evaluator.files",
        includeIdentifiers
    );
    const allProfilePaths = new Set();
    const allRunIds = new Set();
    const allEvidenceIds = new Set();
    const baseline = await loadCohort({
        raw: manifest.cohorts?.baseline,
        label: "baseline",
        baseDirectory,
        allProfilePaths,
        allRunIds,
        allEvidenceIds,
        includeIdentifiers
    });
    const candidate = await loadCohort({
        raw: manifest.cohorts?.candidate,
        label: "candidate",
        baseDirectory,
        allProfilePaths,
        allRunIds,
        allEvidenceIds,
        includeIdentifiers
    });
    if (baseline.profiles.length !== candidate.profiles.length) {
        throw new Error("baseline and candidate replay sample counts must match");
    }
    const workloadFilesHash = fileSetHash(workloadFiles);
    const workloadHash = sha256Value(
        stableJson({
            corpus_id: corpusId,
            source_revision: sourceRevision,
            files: workloadFilesHash
        })
    );
    const evaluatorFilesHash = fileSetHash(evaluatorFiles);
    const evaluatorHash = sha256Value(
        stableJson({
            evaluator_id: evaluatorId,
            files: evaluatorFilesHash
        })
    );
    const receipt = {
        schema_version: SCHEMA_VERSION,
        replay_id: protectedIdentifier(replayId, includeIdentifiers),
        replay_type: "repeated_run_replay",
        workload: {
            corpus_id: protectedIdentifier(corpusId, includeIdentifiers),
            corpus_binding_sha256: sha256Value(corpusId),
            source_revision: protectedIdentifier(
                sourceRevision,
                includeIdentifiers
            ),
            source_revision_binding_sha256: sha256Value(sourceRevision),
            files: workloadFiles.map((file) => file.receipt),
            files_sha256: workloadFilesHash,
            workload_sha256: workloadHash
        },
        evaluator: {
            evaluator_id: protectedIdentifier(
                evaluatorId,
                includeIdentifiers
            ),
            evaluator_binding_sha256: sha256Value(evaluatorId),
            files: evaluatorFiles.map((file) => file.receipt),
            files_sha256: evaluatorFilesHash,
            evaluator_sha256: evaluatorHash
        },
        cohorts: {
            baseline: baseline.receipt,
            candidate: candidate.receipt
        },
        invariants: {
            sample_counts_equal: true,
            profile_paths_unique: true,
            run_ids_unique: true,
            contributing_evidence_unique: true,
            frozen_file_hashes_verified: true,
            runtime_matches_configuration: true
        },
        privacy: {
            identifiers: includeIdentifiers ? "included" : "hashed",
            excluded: [
                "input paths",
                "workload contents",
                "configuration contents",
                "prompts",
                "messages",
                "tool arguments",
                "tool results",
                "code changes",
                "working directories"
            ]
        }
    };
    return {
        receipt,
        baselineProfiles: baseline.profiles,
        candidateProfiles: candidate.profiles,
        bindings: {
            corpus_id: corpusId,
            evaluator_id: evaluatorId,
            source_revision: sourceRevision,
            run_profile_sha256: new Map([
                ...baseline.profileHashes,
                ...candidate.profileHashes
            ])
        }
    };
}

function markdownText(value) {
    return String(value ?? "unknown").replaceAll("|", "\\|").replaceAll("`", "\\`");
}

export function renderReplayMarkdown(receipt) {
    const lines = [
        "# Pace replay manifest",
        "",
        `**Replay:** \`${markdownText(receipt.replay_id)}\`  `,
        `**Workload SHA-256:** \`${receipt.workload.workload_sha256}\`  `,
        `**Baseline samples:** ${receipt.cohorts.baseline.sample_count}  `,
        `**Candidate samples:** ${receipt.cohorts.candidate.sample_count}`,
        "",
        "## Frozen inputs",
        "",
        "| Kind | ID | SHA-256 | Bytes |",
        "|---|---|---|---:|"
    ];
    for (const file of receipt.workload.files) {
        lines.push(
            `| workload | \`${markdownText(file.id)}\` | \`${file.sha256}\` | ${file.size_bytes} |`
        );
    }
    for (const file of receipt.evaluator.files) {
        lines.push(
            `| evaluator | \`${markdownText(file.id)}\` | \`${file.sha256}\` | ${file.size_bytes} |`
        );
    }
    for (const [cohortName, cohort] of Object.entries(receipt.cohorts)) {
        for (const file of cohort.configuration_files) {
            lines.push(
                `| ${cohortName} configuration | \`${markdownText(file.id)}\` | \`${file.sha256}\` | ${file.size_bytes} |`
            );
        }
    }
    lines.push(
        "",
        "## Cohorts",
        "",
        "| Cohort | Configuration | Configuration SHA-256 | Runtime fingerprint | Samples |",
        "|---|---|---|---|---:|"
    );
    for (const [cohortName, cohort] of Object.entries(receipt.cohorts)) {
        lines.push(
            `| ${cohortName} | \`${markdownText(cohort.configuration_id)}\` | \`${cohort.configuration_sha256}\` | \`${cohort.expected_runtime_fingerprint}\` | ${cohort.sample_count} |`
        );
    }
    lines.push(
        "",
        "## Invariants",
        "",
        "- Frozen workload and configuration file hashes verified.",
        "- Baseline and candidate sample counts match.",
        "- Profile paths, run IDs, and contributing session evidence are unique.",
        "- Every contributing runtime matches its cohort's frozen configuration."
    );
    return `${lines.join("\n")}\n`;
}

export function writeReplayArtifacts(receipt, outputDirectory) {
    const output = resolve(outputDirectory);
    mkdirSync(output, { recursive: true });
    const safeReplayId = receipt.replay_id.replaceAll(
        /[^a-zA-Z0-9._-]/g,
        "-"
    );
    const jsonPath = join(output, `${safeReplayId}.replay-manifest.json`);
    const markdownPath = join(output, `${safeReplayId}.replay-report.md`);
    writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, renderReplayMarkdown(receipt), "utf8");
    return { jsonPath, markdownPath };
}

function usage() {
    return [
        "Usage: node build-replay-manifest.mjs <replay-manifest.json> [options]",
        "",
        "Options:",
        "  -o, --out <directory>       Output directory (default: pace-output)",
        "      --include-identifiers    Preserve replay and cohort identifiers",
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
            throw new Error("only one replay manifest is supported");
        }
        input = argument;
    }

    if (input === null) throw new Error("a replay manifest is required");
    return { input, output, includeIdentifiers, help: false };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const { receipt } = await loadReplayManifest(args.input, {
            includeIdentifiers: args.includeIdentifiers
        });
        const paths = writeReplayArtifacts(receipt, args.output);
        process.stdout.write(`${paths.jsonPath}\n${paths.markdownPath}\n`);
    } catch (error) {
        process.stderr.write(`pace replay manifest failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
