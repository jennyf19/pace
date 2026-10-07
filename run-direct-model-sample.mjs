import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { RUN_METRICS, writeRunArtifacts } from "./profile-run.mjs";
import { protectedRunId } from "./profile-session.mjs";

const SCHEMA_VERSION = "0.1";
const CONTRACT_VERSION = "0.1";
const RUNTIME_NAME = "openai-compatible-responses";
const RUNNER_PATH = fileURLToPath(import.meta.url);

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function fetchErrorCode(error) {
    for (const value of [
        error?.cause?.code,
        error?.code,
        error?.cause?.name
    ]) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function stableJson(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item)).join(",")}]`;
    }
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
        .join(",")}}`;
}

function sha256Bytes(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validateResponsesUrl(value) {
    let url;
    try {
        url = new URL(requireString(value, "responsesUrl"));
    } catch (error) {
        throw new Error(`responsesUrl must be an absolute URL: ${error.message}`);
    }
    if (url.username || url.password) {
        throw new Error("responsesUrl must not contain credentials");
    }
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        throw new Error(
            "responsesUrl must use HTTPS unless it targets loopback"
        );
    }
    return url;
}

function coverage(value, sessionKey, span = false) {
    const complete = numberOrNull(value) !== null;
    return {
        value: complete ? value : null,
        ...(span
            ? { known_span_ms: complete ? value : null }
            : { known_subtotal: complete ? value : null }),
        complete,
        missing_sessions: complete ? [] : [sessionKey]
    };
}

function reconciliation(total, attributed) {
    const normalizedTotal = numberOrNull(total);
    const normalizedAttributed = numberOrNull(attributed);
    if (normalizedTotal === null || normalizedAttributed === null) {
        return {
            total: normalizedTotal,
            attributed: normalizedAttributed,
            difference: null,
            reconciled: null
        };
    }
    const difference = normalizedTotal - normalizedAttributed;
    return {
        total: normalizedTotal,
        attributed: normalizedAttributed,
        difference,
        reconciled: difference === 0
    };
}

function extractOutputText(payload) {
    const text = (payload.output ?? [])
        .flatMap((item) => item?.content ?? [])
        .filter((item) => item?.type === "output_text")
        .map((item) => item.text)
        .filter((value) => typeof value === "string")
        .join("");
    if (!text) {
        throw new Error("direct model response contains no output_text");
    }
    return text;
}

export function directModelRuntimeSignature({
    provider,
    apiVersion,
    model,
    reasoningEffort
}) {
    return {
        name: RUNTIME_NAME,
        version: requireString(apiVersion, "apiVersion"),
        producer: requireString(provider, "provider"),
        selected_model: requireString(model, "model"),
        context_tier: null,
        reasoning_efforts: [requireString(reasoningEffort, "reasoningEffort")],
        models: [model]
    };
}

export function buildResponsesRequest({
    deployment,
    prompt,
    reasoningEffort,
    maxOutputTokens,
    responseFormat
}) {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
        throw new Error("maxOutputTokens must be a positive integer");
    }
    const request = {
        model: requireString(deployment, "deployment"),
        input: requireString(prompt, "prompt"),
        reasoning: {
            effort: requireString(reasoningEffort, "reasoningEffort")
        },
        max_output_tokens: maxOutputTokens,
        store: false
    };
    if (responseFormat !== undefined) {
        if (
            !responseFormat ||
            typeof responseFormat !== "object" ||
            Array.isArray(responseFormat)
        ) {
            throw new Error("responseFormat must be an object");
        }
        request.text = { format: responseFormat };
    }
    return request;
}

export async function runDirectModelSample({
    output,
    sampleName,
    prompt,
    responsesUrl,
    authorizationHeader,
    provider,
    apiVersion = "v1",
    deployment,
    model,
    modelVersion,
    reasoningEffort = "low",
    maxOutputTokens = 2048,
    responseFormat,
    runIdPrefix,
    timeoutMs = 3 * 60 * 1000,
    fetchImpl = fetch
}) {
    const url = validateResponsesUrl(responsesUrl);
    requireString(authorizationHeader, "authorizationHeader");
    requireString(sampleName, "sampleName");
    requireString(runIdPrefix, "runIdPrefix");
    requireString(modelVersion, "modelVersion");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
        throw new Error("timeoutMs must be a positive integer");
    }
    if (typeof fetchImpl !== "function") {
        throw new Error("fetchImpl must be a function");
    }

    const request = buildResponsesRequest({
        deployment,
        prompt,
        reasoningEffort,
        maxOutputTokens,
        responseFormat
    });
    const sampleDirectory = join(resolve(output), "raw", sampleName);
    mkdirSync(sampleDirectory, { recursive: true });

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const started = performance.now();
    let response;
    try {
        response = await fetchImpl(url, {
            method: "POST",
            redirect: "error",
            headers: {
                authorization: authorizationHeader,
                "content-type": "application/json"
            },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        const code = fetchErrorCode(error);
        throw new Error(
            `direct model request failed: ${error.message}${code ? ` (${code})` : ""}`
        );
    }
    const responseBody = await response.text();
    const apiTimeMs = Math.max(0, performance.now() - started);
    const endedAtMs = Date.now();
    const endedAt = new Date(endedAtMs).toISOString();
    if (!response.ok) {
        throw new Error(
            `direct model request returned HTTP ${response.status}: ${responseBody.slice(0, 500)}`
        );
    }

    let payload;
    try {
        payload = JSON.parse(responseBody);
    } catch (error) {
        throw new Error(`direct model response is not JSON: ${error.message}`);
    }
    if (payload.status !== "completed") {
        const incompleteReason =
            typeof payload.incomplete_details?.reason === "string"
                ? ` (${payload.incomplete_details.reason})`
                : "";
        throw new Error(
            `direct model response status must be completed, got ${payload.status ?? "missing"}${incompleteReason}`
        );
    }
    const stdout = extractOutputText(payload);
    const usage = payload.usage;
    const inputTokens = numberOrNull(usage?.input_tokens);
    const outputTokens = numberOrNull(usage?.output_tokens);
    if (inputTokens === null || outputTokens === null) {
        throw new Error(
            "direct model response requires input_tokens and output_tokens"
        );
    }
    const cacheReadTokens = numberOrNull(
        usage?.input_tokens_details?.cached_tokens
    );
    const nonCachedInputTokens =
        cacheReadTokens === null ? null : inputTokens - cacheReadTokens;
    if (nonCachedInputTokens !== null && nonCachedInputTokens < 0) {
        throw new Error("cached input tokens exceed total input tokens");
    }
    const reasoningTokens = numberOrNull(
        usage?.output_tokens_details?.reasoning_tokens
    );
    const observedModel = requireString(payload.model, "response.model");
    const warnings = [];
    if (observedModel !== model) {
        warnings.push(
            `declared model ${model} differs from response model ${observedModel}`
        );
    }

    const wallTimeMs = Math.max(0, endedAtMs - startedAtMs);
    const totals = {
        wall_time_ms: wallTimeMs,
        elapsed_span_ms: wallTimeMs,
        api_time_ms: apiTimeMs,
        input_tokens: inputTokens,
        non_cached_input_tokens: nonCachedInputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: null,
        reasoning_tokens: reasoningTokens,
        tool_definition_tokens: 0,
        ai_units: null,
        premium_requests: null
    };
    const rawRunId = `${runIdPrefix}-${randomUUID()}`;
    const rawSessionId = `${rawRunId}:direct-model`;
    const sessionKey = protectedRunId(`${rawRunId}:primary`);
    const evidenceRunId = protectedRunId(rawSessionId);
    const metricCoverage = Object.fromEntries(
        RUN_METRICS.map((metric) => [
            metric,
            coverage(totals[metric], sessionKey, metric === "wall_time_ms")
        ])
    );
    const missing = [
        ...(totals.cache_write_tokens === null
            ? ["provider cache-write token usage"]
            : []),
        ...(totals.ai_units === null ? ["provider AI-unit billing"] : []),
        ...(totals.premium_requests === null
            ? ["provider premium-request billing"]
            : [])
    ];
    if (totals.cache_read_tokens === null) {
        missing.push("provider cache-read token usage");
    }
    if (totals.reasoning_tokens === null) {
        missing.push("provider reasoning token usage");
    }
    if (totals.non_cached_input_tokens === null) {
        missing.push("provider non-cached input token usage");
    }

    const runtime = directModelRuntimeSignature({
        provider,
        apiVersion,
        model,
        reasoningEffort
    });
    delete runtime.models;
    const providerBinding = sha256Bytes(
        stableJson({
            origin: url.origin,
            pathname: url.pathname,
            deployment,
            model,
            modelVersion,
            provider,
            apiVersion
        })
    );
    const requestBinding = sha256Bytes(stableJson(request));
    const responseBinding = sha256Bytes(responseBody);
    const runnerBytes = await readFile(RUNNER_PATH);
    const runnerReceipt = {
        id: protectedRunId("pace-direct-model-runner"),
        binding_sha256: sha256Bytes("pace-direct-model-runner"),
        sha256: sha256Bytes(runnerBytes),
        size_bytes: runnerBytes.length
    };
    const stage = {
        id: "model:direct-response",
        kind: "model",
        name: observedModel,
        classification: "semantic",
        invocations: 1,
        successful: 1,
        failed: 0,
        incomplete: 0,
        duration_ms: apiTimeMs,
        input_tokens: inputTokens,
        non_cached_input_tokens: nonCachedInputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: null,
        reasoning_tokens: reasoningTokens,
        tool_definition_tokens: 0,
        ai_units: null,
        attribution: "single OpenAI-compatible Responses API call"
    };
    const modelCall = {
        call_id: protectedRunId(payload.id ?? rawSessionId),
        model: observedModel,
        status: payload.status,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: apiTimeMs,
        input_tokens: inputTokens,
        non_cached_input_tokens: nonCachedInputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: null,
        reasoning_tokens: reasoningTokens,
        tool_definition_tokens: 0,
        ai_units: null
    };
    const reconciliationMetrics = [
        "input_tokens",
        "non_cached_input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "reasoning_tokens",
        "ai_units"
    ];
    const modelReconciliation = Object.fromEntries(
        reconciliationMetrics.map((metric) => [
            metric,
            reconciliation(totals[metric], modelCall[metric])
        ])
    );
    const sessionProfile = {
        schema_version: SCHEMA_VERSION,
        run_id: evidenceRunId,
        runtime,
        artifact: {
            format: "openai-compatible-responses-json",
            contract_version: CONTRACT_VERSION,
            implementation: {
                files: [runnerReceipt],
                files_sha256: sha256Bytes(stableJson([runnerReceipt]))
            },
            provider_configuration_binding_sha256: providerBinding,
            request_binding_sha256: requestBinding,
            response_binding_sha256: responseBinding,
            response_status: payload.status,
            model_version: modelVersion
        },
        timing: {
            started_at: startedAt,
            ended_at: endedAt,
            status: "ended",
            elapsed_span_ms: wallTimeMs,
            active_wall_time_ms: wallTimeMs
        },
        model_calls: [modelCall],
        agents: [],
        tools: [],
        stages: [stage],
        totals,
        accounting: {
            snapshot_policy:
                "single direct response usage receipt; no session snapshot",
            shutdown_snapshots: 0,
            resume_events: 0,
            attribution_views_are_non_additive: true,
            model_reconciliation: modelReconciliation,
            agent_reconciliation: {},
            snapshot_is_final: true,
            snapshot_age_ms: 0,
            known_subtotals: null,
            direct_model_call: {
                method: "openai_compatible_responses_v1",
                request_count: 1,
                response_status: payload.status,
                provider_usage_present: true,
                tools_requested: 0,
                authorization_excluded: true
            }
        },
        coverage: {
            evidence_level: "L2",
            missing,
            warnings
        },
        privacy: {
            identifiers: "hashed",
            excluded: [
                "endpoint",
                "deployment",
                "authorization",
                "prompt",
                "response text",
                "working directories"
            ]
        }
    };
    const profile = {
        schema_version: SCHEMA_VERSION,
        run_id: protectedRunId(rawRunId),
        run_type: "manifest",
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
            session_policy: "one direct model response contributes once",
            wall_time_policy: "single direct request start to response end",
            missing_metric_policy:
                "provider-absent usage and billing fields remain null",
            attribution_views_are_non_additive: true,
            contributing_sessions: [sessionKey],
            included_sessions: [],
            metric_coverage: metricCoverage,
            direct_model_call: sessionProfile.accounting.direct_model_call
        },
        coverage: {
            evidence_level: "L2",
            missing,
            warnings
        },
        privacy: sessionProfile.privacy
    };

    await Promise.all([
        writeFile(join(sampleDirectory, "response.txt"), stdout, "utf8"),
        writeFile(
            join(sampleDirectory, "usage.json"),
            `${JSON.stringify(
                {
                    provider,
                    api_version: apiVersion,
                    model: observedModel,
                    model_version: modelVersion,
                    usage,
                    provider_configuration_binding_sha256: providerBinding,
                    request_binding_sha256: requestBinding,
                    response_binding_sha256: responseBinding
                },
                null,
                2
            )}\n`,
            "utf8"
        )
    ]);
    const runPaths = writeRunArtifacts(
        profile,
        join(resolve(output), "direct-model-profiles")
    );
    return {
        stdout,
        rendered_stdout: stdout,
        profile,
        runPaths,
        provider_configuration_binding_sha256: providerBinding
    };
}
