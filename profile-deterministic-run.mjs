import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
    readFile,
    realpath,
    rm,
    stat,
    writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { protectedRunId } from "./profile-session.mjs";

const SCHEMA_VERSION = "0.1";
const CONTRACT_VERSION = "0.1";
const ARTIFACT_FORMAT = "pace-deterministic-json-transform";
const ZERO_USAGE_METHOD = "synchronous_local_json_transform_v1";
const ZERO_USAGE_METRICS = [
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
const RECONCILED_METRICS = ZERO_USAGE_METRICS.filter(
    (metric) => metric !== "premium_requests"
);

function pathValue(inputPath) {
    return inputPath instanceof URL ? fileURLToPath(inputPath) : inputPath;
}

function sha256Bytes(bytes) {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function requirePath(value, label) {
    if (value instanceof URL) return value;
    return requireString(value, label);
}

function protectedFileId(value, includeIdentifiers) {
    return protectedRunId(value, includeIdentifiers);
}

async function fileDescriptor(raw, label, includeIdentifiers) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`${label} must be an object`);
    }
    const id = requireString(raw.id, `${label}.id`);
    const requestedPath = requirePath(raw.path, `${label}.path`);
    let path;
    let bytes;
    try {
        path = await realpath(resolve(pathValue(requestedPath)));
        bytes = await readFile(path);
    } catch (error) {
        throw new Error(`cannot read ${label}: ${error.message}`);
    }
    return {
        id,
        path,
        sha256: sha256Bytes(bytes),
        size_bytes: bytes.length,
        receipt: {
            id: protectedFileId(id, includeIdentifiers),
            binding_sha256: sha256Bytes(id),
            sha256: sha256Bytes(bytes),
            size_bytes: bytes.length
        }
    };
}

async function implementationDescriptors(rawFiles, includeIdentifiers) {
    if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
        throw new Error("implementation_files requires at least one file");
    }
    const runnerPath = fileURLToPath(import.meta.url);
    const descriptors = await Promise.all(
        [
            {
                id: "pace-deterministic-json-runner",
                path: runnerPath
            },
            ...rawFiles
        ].map((file, index) =>
            fileDescriptor(
                file,
                `implementation_files[${index}]`,
                includeIdentifiers
            )
        )
    );
    const paths = new Set();
    const ids = new Set();
    for (const descriptor of descriptors) {
        const canonicalPath =
            process.platform === "win32"
                ? descriptor.path.toLowerCase()
                : descriptor.path;
        if (paths.has(canonicalPath)) {
            throw new Error("implementation_files contains a duplicate path");
        }
        if (ids.has(descriptor.id)) {
            throw new Error(
                `implementation_files contains duplicate id ${descriptor.id}`
            );
        }
        paths.add(canonicalPath);
        ids.add(descriptor.id);
    }
    return descriptors;
}

function implementationHash(descriptors) {
    return sha256Bytes(
        stableJson(
            descriptors.map((descriptor) => ({
                id: descriptor.id,
                sha256: descriptor.sha256,
                size_bytes: descriptor.size_bytes
            }))
        )
    );
}

async function verifyImplementationUnchanged(descriptors) {
    for (const descriptor of descriptors) {
        const bytes = await readFile(descriptor.path);
        if (
            bytes.length !== descriptor.size_bytes ||
            sha256Bytes(bytes) !== descriptor.sha256
        ) {
            throw new Error(
                `implementation file ${descriptor.id} changed during execution`
            );
        }
    }
}

function zeroReconciliation() {
    return Object.fromEntries(
        RECONCILED_METRICS.map((metric) => [
            metric,
            {
                total: 0,
                attributed: 0,
                difference: 0,
                reconciled: true
            }
        ])
    );
}

function metricCoverage(totals) {
    return Object.fromEntries(
        [
            "wall_time_ms",
            ...ZERO_USAGE_METRICS
        ].map((metric) => [
            metric,
            metric === "wall_time_ms"
                ? {
                      value: totals[metric],
                      known_span_ms: totals[metric],
                      complete: true,
                      missing_sessions: []
                  }
                : {
                      value: totals[metric],
                      known_subtotal: totals[metric],
                      complete: true,
                      missing_sessions: []
                  }
        ])
    );
}

export function deterministicRuntimeSignature() {
    return {
        name: "node",
        version: process.version,
        producer: "pace-deterministic-json-runner",
        selected_model: null,
        context_tier: null,
        reasoning_efforts: [],
        models: []
    };
}

export async function profileDeterministicJsonTransform({
    runId,
    input,
    output,
    transform,
    implementationFiles,
    includeIdentifiers = false
}) {
    requireString(runId, "run_id");
    if (typeof transform !== "function") {
        throw new Error("transform must be a function");
    }
    const inputId = requireString(input?.id ?? "input", "input.id");
    const inputPath = requirePath(input?.path, "input.path");
    const outputId = requireString(output?.id ?? "output", "output.id");
    const outputPath = resolve(pathValue(requirePath(output?.path, "output.path")));
    try {
        await stat(outputPath);
        throw new Error(`output path already exists: ${outputPath}`);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    const implementations = await implementationDescriptors(
        implementationFiles,
        includeIdentifiers
    );
    const implementationSha256 = implementationHash(implementations);
    mkdirSync(dirname(outputPath), { recursive: true });

    let result;
    let inputBytes;
    let outputBytes;
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const started = performance.now();
    try {
        inputBytes = await readFile(resolve(pathValue(inputPath)));
        const parsedInput = JSON.parse(
            inputBytes.toString("utf8").replace(/^\uFEFF/, "")
        );
        result = transform(parsedInput);
        if (result && typeof result.then === "function") {
            throw new Error(
                "transform must return synchronously for the deterministic execution contract"
            );
        }
        const serialized = JSON.stringify(result, null, 2);
        if (serialized === undefined) {
            throw new Error("transform result must be JSON-serializable");
        }
        outputBytes = Buffer.from(`${serialized}\n`, "utf8");
        await writeFile(outputPath, outputBytes);
        await verifyImplementationUnchanged(implementations);
    } catch (error) {
        await rm(outputPath, { force: true });
        throw error;
    }
    const endedAtMs = Date.now();
    const wallTimeMs = Math.max(0, performance.now() - started);
    const endedAt = new Date(endedAtMs).toISOString();
    const runtimeSignature = deterministicRuntimeSignature();
    const runtime = {
        name: runtimeSignature.name,
        version: runtimeSignature.version,
        producer: runtimeSignature.producer,
        selected_model: runtimeSignature.selected_model,
        context_tier: runtimeSignature.context_tier,
        reasoning_efforts: runtimeSignature.reasoning_efforts
    };
    const inputReceipt = {
        id: protectedFileId(inputId, includeIdentifiers),
        binding_sha256: sha256Bytes(inputId),
        sha256: sha256Bytes(inputBytes),
        size_bytes: inputBytes.length
    };
    const outputReceipt = {
        id: protectedFileId(outputId, includeIdentifiers),
        binding_sha256: sha256Bytes(outputId),
        sha256: sha256Bytes(outputBytes),
        size_bytes: outputBytes.length
    };
    const implementationReceipts = implementations.map(
        (descriptor) => descriptor.receipt
    );
    const proof = {
        method: ZERO_USAGE_METHOD,
        complete: true,
        proof_scope:
            "hash-bound runner and declared synchronous transform implementation",
        proof_boundary:
            "zero is asserted by the deterministic execution contract, not inferred from missing provider telemetry",
        transform_result: "synchronous",
        model_calls: 0,
        provider_api_calls: 0,
        metrics: Object.fromEntries(
            ZERO_USAGE_METRICS.map((metric) => [metric, 0])
        ),
        runner_source_hash_included: true,
        implementation_hashes_verified_before_and_after: true
    };
    const totals = {
        wall_time_ms: wallTimeMs,
        elapsed_span_ms: wallTimeMs,
        api_time_ms: 0,
        input_tokens: 0,
        non_cached_input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        tool_definition_tokens: 0,
        ai_units: 0,
        premium_requests: 0
    };
    const stage = {
        id: "deterministic:json-transform",
        kind: "deterministic",
        name: "json-transform",
        classification: "deterministic",
        invocations: 1,
        successful: 1,
        failed: 0,
        incomplete: 0,
        duration_ms: wallTimeMs,
        input_tokens: 0,
        non_cached_input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        tool_definition_tokens: 0,
        ai_units: 0,
        attribution: "deterministic execution receipt"
    };
    const rawSessionId = `${runId}:deterministic-execution`;
    const sessionProfile = {
        schema_version: SCHEMA_VERSION,
        run_id: protectedRunId(rawSessionId, includeIdentifiers),
        runtime,
        artifact: {
            format: ARTIFACT_FORMAT,
            contract_version: CONTRACT_VERSION,
            implementation: {
                files: implementationReceipts,
                files_sha256: implementationSha256
            },
            input: inputReceipt,
            output: outputReceipt
        },
        timing: {
            started_at: startedAt,
            ended_at: endedAt,
            status: "ended",
            elapsed_span_ms: wallTimeMs,
            active_wall_time_ms: wallTimeMs
        },
        model_calls: [],
        agents: [],
        tools: [],
        stages: [stage],
        totals,
        accounting: {
            snapshot_policy:
                "deterministic execution receipt; no provider snapshot required",
            shutdown_snapshots: 0,
            resume_events: 0,
            attribution_views_are_non_additive: true,
            model_reconciliation: zeroReconciliation(),
            agent_reconciliation: zeroReconciliation(),
            snapshot_is_final: true,
            snapshot_age_ms: 0,
            known_subtotals: null,
            zero_model_usage: proof
        },
        coverage: {
            evidence_level: "L3",
            missing: [],
            warnings: []
        },
        privacy: {
            identifiers: includeIdentifiers ? "included" : "hashed",
            excluded: [
                "file paths",
                "input contents",
                "output contents",
                "environment variables",
                "working directories"
            ]
        }
    };
    const sessionKey = protectedRunId(
        `${runId}:primary`,
        includeIdentifiers
    );
    const profile = {
        schema_version: SCHEMA_VERSION,
        run_id: protectedRunId(runId, includeIdentifiers),
        run_type: "deterministic",
        sessions: [
            {
                session_key: sessionKey,
                role: "primary",
                billing: "independent",
                included_in: null,
                profile: sessionProfile
            }
        ],
        stages: [stage],
        totals,
        accounting: {
            session_policy:
                "one deterministic execution contributes once",
            wall_time_policy:
                "measured from input read through output write",
            missing_metric_policy:
                "zero model usage requires an explicit deterministic execution contract",
            attribution_views_are_non_additive: true,
            contributing_sessions: [sessionKey],
            included_sessions: [],
            metric_coverage: metricCoverage(totals),
            deterministic_execution_contract: proof
        },
        coverage: {
            evidence_level: "L3",
            missing: [],
            warnings: []
        },
        privacy: {
            identifiers: includeIdentifiers ? "included" : "hashed",
            excluded: [
                "file paths",
                "input contents",
                "output contents",
                "environment variables",
                "working directories"
            ]
        }
    };

    return {
        profile,
        result,
        output_path: outputPath
    };
}
