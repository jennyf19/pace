import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_VERSION = "0.1";
const NANO_AI_UNITS = 1_000_000_000;

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumKnown(values) {
    const known = values.filter(
        (value) => typeof value === "number" && Number.isFinite(value)
    );
    return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function nonCachedInput(inputTokens, cacheReadTokens, cacheWriteTokens) {
    if (inputTokens === null) return null;
    if (inputTokens === 0) return 0;
    if (cacheReadTokens === null || cacheWriteTokens === null) return null;
    const value = inputTokens - cacheReadTokens - cacheWriteTokens;
    return value >= 0 ? value : null;
}

function timestampMs(value) {
    if (typeof value !== "string") return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function isUsageActivity(type) {
    return (
        type === "session.resume" ||
        type === "user.message" ||
        type === "skill.invoked" ||
        type.startsWith("assistant.") ||
        type.startsWith("model.") ||
        type.startsWith("tool.") ||
        type.startsWith("subagent.") ||
        type.startsWith("external_tool.")
    );
}

function tokenDetailsByType(data) {
    const result = new Map();
    const details = data?.copilotUsage?.token_details;
    if (!Array.isArray(details)) return result;

    for (const detail of details) {
        const type = detail?.token_type;
        const count = numberOrNull(detail?.token_count);
        if (typeof type !== "string" || count === null) continue;
        result.set(type, (result.get(type) ?? 0) + count);
    }
    return result;
}

function normalizeModelCall(event) {
    const data = event.data ?? {};
    const responseUsage = data.responseUsage ?? data.responseChunk?.usage ?? {};
    const tokenDetails = tokenDetailsByType(data);
    const promptTokens = numberOrNull(responseUsage.prompt_tokens);
    const completionTokens = numberOrNull(responseUsage.completion_tokens);
    const cachedPromptTokens = numberOrNull(responseUsage.prompt_tokens_details?.cached_tokens);
    const detailedCacheRead = tokenDetails.get("cache_read") ?? null;
    const cacheReadTokens =
        detailedCacheRead === null && cachedPromptTokens === null
            ? null
            : Math.max(detailedCacheRead ?? 0, cachedPromptTokens ?? 0);
    const cacheWriteTokens = tokenDetails.get("cache_write") ?? null;
    const detailedInputTokens = tokenDetails.get("input") ?? null;
    const fallbackInputTokens = sumKnown([
        detailedInputTokens,
        detailedCacheRead,
        cacheWriteTokens
    ]);
    const nanoAiUnits = numberOrNull(data.copilotUsage?.total_nano_aiu);

    return {
        call_id: data.callId ?? event.id ?? null,
        timestamp: event.timestamp ?? null,
        model: data.modelCall?.model ?? data.responseChunk?.model ?? null,
        kind: data.kind ?? null,
        duration_ms: numberOrNull(data.modelCallDurationMs),
        time_to_first_token_ms: numberOrNull(data.ttftMs ?? data.outputTtftMs),
        input_tokens: promptTokens ?? fallbackInputTokens,
        non_cached_input_tokens:
            detailedInputTokens ??
            (promptTokens !== null && cachedPromptTokens !== null
                ? Math.max(0, promptTokens - cachedPromptTokens)
                : promptTokens === 0
                  ? 0
                  : null),
        output_tokens: completionTokens ?? tokenDetails.get("output") ?? null,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        reasoning_tokens: numberOrNull(
            responseUsage.completion_tokens_details?.reasoning_tokens
        ),
        ai_units: nanoAiUnits === null ? null : nanoAiUnits / NANO_AI_UNITS,
        tool_count: numberOrNull(data.toolCount)
    };
}

function mergeTool(startEvent, completeEvent) {
    const startData = startEvent?.data ?? {};
    const completeData = completeEvent?.data ?? {};
    const startedAt = timestampMs(startEvent?.timestamp);
    const completedAt = timestampMs(completeEvent?.timestamp);

    return {
        tool_call_id: startData.toolCallId ?? completeData.toolCallId ?? null,
        name: startData.toolName ?? null,
        model: startData.model ?? completeData.model ?? null,
        parent_tool_call_id:
            startData.parentToolCallId ?? completeData.parentToolCallId ?? null,
        started_at: startEvent?.timestamp ?? null,
        completed_at: completeEvent?.timestamp ?? null,
        duration_ms:
            startedAt !== null && completedAt !== null
                ? Math.max(0, completedAt - startedAt)
                : null,
        success:
            typeof completeData.success === "boolean" ? completeData.success : null,
        status: completeEvent ? "completed" : "incomplete"
    };
}

function mergeAgent(existing, event, status) {
    const data = event.data ?? {};
    return {
        ...existing,
        tool_call_id: data.toolCallId ?? existing?.tool_call_id ?? null,
        name: data.agentName ?? existing?.name ?? null,
        display_name: data.agentDisplayName ?? existing?.display_name ?? null,
        type: data.agentType ?? existing?.type ?? null,
        execution_mode: data.executionMode ?? existing?.execution_mode ?? null,
        model: data.model ?? existing?.model ?? null,
        parent_id: data.parentId ?? event.parentId ?? existing?.parent_id ?? null,
        started_at: existing?.started_at ?? (status === "running" ? event.timestamp : null),
        completed_at: status === "running" ? null : event.timestamp ?? null,
        duration_ms: numberOrNull(data.durationMs) ?? existing?.duration_ms ?? null,
        total_tokens: numberOrNull(data.totalTokens) ?? existing?.total_tokens ?? null,
        total_tool_calls:
            numberOrNull(data.totalToolCalls) ?? existing?.total_tool_calls ?? null,
        status
    };
}

function usageFromModelMetrics(modelMetrics) {
    const models = [];

    for (const [model, metrics] of Object.entries(modelMetrics ?? {})) {
        const usage = metrics?.usage ?? {};
        const nanoAiUnits = numberOrNull(metrics?.totalNanoAiu);
        const inputTokens = numberOrNull(usage.inputTokens);
        const cacheReadTokens = numberOrNull(usage.cacheReadTokens);
        const cacheWriteTokens = numberOrNull(usage.cacheWriteTokens);
        models.push({
            model,
            requests: numberOrNull(metrics?.requests?.count),
            input_tokens: inputTokens,
            non_cached_input_tokens: nonCachedInput(
                inputTokens,
                cacheReadTokens,
                cacheWriteTokens
            ),
            output_tokens: numberOrNull(usage.outputTokens),
            cache_read_tokens: cacheReadTokens,
            cache_write_tokens: cacheWriteTokens,
            reasoning_tokens: numberOrNull(usage.reasoningTokens),
            ai_units: nanoAiUnits === null ? null : nanoAiUnits / NANO_AI_UNITS
        });
    }

    return {
        models,
        input_tokens: sumKnown(models.map((model) => model.input_tokens)),
        non_cached_input_tokens: sumKnown(
            models.map((model) => model.non_cached_input_tokens)
        ),
        output_tokens: sumKnown(models.map((model) => model.output_tokens)),
        cache_read_tokens: sumKnown(
            models.map((model) => model.cache_read_tokens)
        ),
        cache_write_tokens: sumKnown(
            models.map((model) => model.cache_write_tokens)
        ),
        reasoning_tokens: sumKnown(
            models.map((model) => model.reasoning_tokens)
        ),
        ai_units: sumKnown(models.map((model) => model.ai_units))
    };
}

function usageFromShutdown(shutdownData) {
    const modelMetrics =
        shutdownData?.modelMetrics && typeof shutdownData.modelMetrics === "object"
            ? shutdownData.modelMetrics
            : {};
    const modelUsage = usageFromModelMetrics(modelMetrics);
    if (modelUsage.models.length > 0) return modelUsage;

    const tokenDetails = shutdownData?.tokenDetails ?? {};
    const nonCachedInput = numberOrNull(tokenDetails.input?.tokenCount);
    const cacheRead = numberOrNull(tokenDetails.cache_read?.tokenCount);
    const cacheWrite = numberOrNull(tokenDetails.cache_write?.tokenCount);
    return {
        models: [],
        input_tokens: sumKnown([nonCachedInput, cacheRead, cacheWrite]),
        non_cached_input_tokens: nonCachedInput,
        output_tokens: numberOrNull(tokenDetails.output?.tokenCount),
        cache_read_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
        reasoning_tokens: null,
        ai_units: null
    };
}

function agentUsageFromShutdown(shutdownData) {
    const agentMetrics =
        shutdownData?.agentMetrics && typeof shutdownData.agentMetrics === "object"
            ? shutdownData.agentMetrics
            : {};

    return Object.entries(agentMetrics).map(([agentId, metrics]) => {
        const usage = usageFromModelMetrics(metrics?.modelMetrics ?? {});
        const nanoAiUnits = numberOrNull(metrics?.totalNanoAiu);
        return {
            agent_id: agentId,
            tool_call_id: agentId === "main" ? null : agentId,
            name: metrics?.agentName ?? (agentId === "main" ? "main" : null),
            display_name:
                metrics?.agentDisplayName ?? (agentId === "main" ? "Main agent" : null),
            api_time_ms: numberOrNull(metrics?.totalApiDurationMs),
            input_tokens: usage.input_tokens,
            non_cached_input_tokens: usage.non_cached_input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_tokens: usage.cache_read_tokens,
            cache_write_tokens: usage.cache_write_tokens,
            reasoning_tokens: usage.reasoning_tokens,
            ai_units:
                nanoAiUnits === null ? usage.ai_units : nanoAiUnits / NANO_AI_UNITS,
            models: usage.models,
            attribution: "session.shutdown agent metrics"
        };
    });
}

function reconcile(total, attributed) {
    if (total === null || attributed === null) {
        return {
            total,
            attributed,
            difference: null,
            reconciled: null
        };
    }
    const difference = total - attributed;
    return {
        total,
        attributed,
        difference,
        reconciled: Math.abs(difference) < 0.000001
    };
}

function groupBy(items, keySelector) {
    const groups = new Map();
    for (const item of items) {
        const key = keySelector(item) ?? "unknown";
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
    }
    return groups;
}

function buildStages(modelCalls, shutdownModels, tools, agents) {
    const stages = [];
    const modelGroups = groupBy(modelCalls, (call) => call.model);
    const shutdownByModel = new Map(
        shutdownModels.map((model) => [model.model, model])
    );

    for (const model of new Set([...modelGroups.keys(), ...shutdownByModel.keys()])) {
        const calls = modelGroups.get(model) ?? [];
        const shutdown = shutdownByModel.get(model);
        stages.push({
            id: `model:${model}`,
            kind: "model",
            name: model,
            classification: "unknown",
            invocations: shutdown?.requests ?? calls.length,
            duration_ms: sumKnown(calls.map((call) => call.duration_ms)),
            input_tokens:
                shutdown?.input_tokens ??
                sumKnown(calls.map((call) => call.input_tokens)),
            non_cached_input_tokens:
                shutdown?.non_cached_input_tokens ??
                sumKnown(calls.map((call) => call.non_cached_input_tokens)),
            output_tokens:
                shutdown?.output_tokens ??
                sumKnown(calls.map((call) => call.output_tokens)),
            cache_read_tokens:
                shutdown?.cache_read_tokens ??
                sumKnown(calls.map((call) => call.cache_read_tokens)),
            cache_write_tokens:
                shutdown?.cache_write_tokens ??
                sumKnown(calls.map((call) => call.cache_write_tokens)),
            ai_units:
                shutdown?.ai_units ?? sumKnown(calls.map((call) => call.ai_units)),
            attribution: shutdown
                ? "session.shutdown model metrics"
                : "model call receipts"
        });
    }

    for (const [name, calls] of groupBy(tools, (tool) => tool.name)) {
        stages.push({
            id: `tool:${name}`,
            kind: "tool",
            name,
            classification: "unknown",
            invocations: calls.length,
            successful: calls.filter((call) => call.success === true).length,
            failed: calls.filter((call) => call.success === false).length,
            incomplete: calls.filter((call) => call.status === "incomplete").length,
            duration_ms: sumKnown(calls.map((call) => call.duration_ms)),
            input_tokens: null,
            non_cached_input_tokens: null,
            output_tokens: null,
            cache_read_tokens: null,
            cache_write_tokens: null,
            ai_units: null,
            attribution: "tool execution receipts"
        });
    }

    for (const [name, runs] of groupBy(agents, (agent) => agent.name)) {
        stages.push({
            id: `agent:${name}`,
            kind: "agent",
            name,
            classification: "unknown",
            invocations: runs.length,
            successful: runs.filter((run) => run.status === "completed").length,
            failed: runs.filter((run) => run.status === "failed").length,
            incomplete: runs.filter((run) => run.status === "running").length,
            duration_ms: sumKnown(runs.map((run) => run.duration_ms)),
            reported_total_tokens: sumKnown(runs.map((run) => run.total_tokens)),
            input_tokens: sumKnown(runs.map((run) => run.input_tokens)),
            non_cached_input_tokens: sumKnown(
                runs.map((run) => run.non_cached_input_tokens)
            ),
            output_tokens: sumKnown(runs.map((run) => run.output_tokens)),
            cache_read_tokens: sumKnown(
                runs.map((run) => run.cache_read_tokens)
            ),
            cache_write_tokens: sumKnown(
                runs.map((run) => run.cache_write_tokens)
            ),
            ai_units: sumKnown(runs.map((run) => run.ai_units)),
            attribution: runs.some(
                (run) => run.attribution === "session.shutdown agent metrics"
            )
                ? "session.shutdown agent metrics; this is an attribution view, not additional usage"
                : "subagent lifecycle receipts; tokens may overlap session totals"
        });
    }

    return stages.sort((left, right) =>
        `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`)
    );
}

export function protectedRunId(rawRunId, includeIdentifiers) {
    if (includeIdentifiers) return rawRunId;
    const digest = createHash("sha256").update(rawRunId).digest("hex").slice(0, 16);
    return `sha256:${digest}`;
}

async function eventsPathOf(inputPath) {
    const pathValue =
        inputPath instanceof URL ? fileURLToPath(inputPath) : inputPath;
    const absolute = resolve(pathValue);
    const info = await stat(absolute);
    return info.isDirectory() ? join(absolute, "events.jsonl") : absolute;
}

export async function profileSession(inputPath, options = {}) {
    const eventsPath = await eventsPathOf(inputPath);
    const reader = createInterface({
        input: createReadStream(eventsPath, { encoding: "utf8" }),
        crlfDelay: Infinity
    });

    let parsedEvents = 0;
    let invalidJsonLines = 0;
    let firstTimestamp = null;
    let lastTimestamp = null;
    let latestActivityTimestamp = null;
    let sessionStart = null;
    let shutdown = null;
    let shutdownSnapshots = 0;
    let resumeEvents = 0;
    const eventCounts = new Map();
    const modelCalls = [];
    const toolStarts = new Map();
    const tools = [];
    const agents = new Map();
    const reasoningEfforts = new Set();

    for await (const rawLine of reader) {
        const line = rawLine.replace(/^\uFEFF/, "").trim();
        if (!line) continue;

        let event;
        try {
            event = JSON.parse(line);
        } catch {
            invalidJsonLines += 1;
            continue;
        }

        parsedEvents += 1;
        const type = typeof event.type === "string" ? event.type : "unknown";
        eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1);
        const eventTime = timestampMs(event.timestamp);
        if (eventTime !== null) {
            firstTimestamp =
                firstTimestamp === null ? eventTime : Math.min(firstTimestamp, eventTime);
            lastTimestamp =
                lastTimestamp === null ? eventTime : Math.max(lastTimestamp, eventTime);
            if (isUsageActivity(type)) {
                latestActivityTimestamp =
                    latestActivityTimestamp === null
                        ? eventTime
                        : Math.max(latestActivityTimestamp, eventTime);
            }
        }

        if (type === "session.start") {
            sessionStart ??= event;
        } else if (type === "session.resume") {
            resumeEvents += 1;
        } else if (type === "session.shutdown") {
            shutdownSnapshots += 1;
            const candidateTime = timestampMs(event.timestamp);
            const selectedTime = timestampMs(shutdown?.timestamp);
            if (
                shutdown === null ||
                selectedTime === null ||
                (candidateTime !== null && candidateTime >= selectedTime)
            ) {
                shutdown = event;
            }
        } else if (type === "session.usage_checkpoint") {
            for (const state of event.data?.promptCacheBreakState ?? []) {
                for (const model of Object.values(state?.models ?? {})) {
                    if (
                        typeof model?.reasoning_effort === "string" &&
                        model.reasoning_effort.trim()
                    ) {
                        reasoningEfforts.add(model.reasoning_effort);
                    }
                }
            }
        } else if (type === "model.model_call_success") {
            modelCalls.push(normalizeModelCall(event));
        } else if (type === "tool.execution_start") {
            const toolCallId = event.data?.toolCallId;
            if (typeof toolCallId === "string") toolStarts.set(toolCallId, event);
        } else if (type === "tool.execution_complete") {
            const toolCallId = event.data?.toolCallId;
            const startEvent =
                typeof toolCallId === "string" ? toolStarts.get(toolCallId) : null;
            tools.push(mergeTool(startEvent, event));
            if (typeof toolCallId === "string") toolStarts.delete(toolCallId);
        } else if (type === "subagent.started") {
            const toolCallId = event.data?.toolCallId ?? event.id;
            agents.set(toolCallId, mergeAgent(agents.get(toolCallId), event, "running"));
        } else if (type === "subagent.completed" || type === "subagent.failed") {
            const toolCallId = event.data?.toolCallId ?? event.id;
            agents.set(
                toolCallId,
                mergeAgent(
                    agents.get(toolCallId),
                    event,
                    type === "subagent.completed" ? "completed" : "failed"
                )
            );
        }
    }

    for (const startEvent of toolStarts.values()) {
        tools.push(mergeTool(startEvent, null));
    }

    const shutdownData = shutdown?.data ?? null;
    const shutdownUsage = shutdownData ? usageFromShutdown(shutdownData) : null;
    const shutdownAgentUsage = shutdownData
        ? agentUsageFromShutdown(shutdownData)
        : [];
    for (const usage of shutdownAgentUsage) {
        const existing = agents.get(usage.agent_id);
        agents.set(usage.agent_id, {
            ...existing,
            ...usage,
            tool_call_id: existing?.tool_call_id ?? usage.tool_call_id,
            name: existing?.name ?? usage.name,
            display_name: existing?.display_name ?? usage.display_name,
            status:
                existing?.status ?? (usage.agent_id === "main" ? "session" : "unobserved")
        });
    }
    const fallbackUsage = {
        input_tokens: sumKnown(modelCalls.map((call) => call.input_tokens)),
        non_cached_input_tokens: sumKnown(
            modelCalls.map((call) => call.non_cached_input_tokens)
        ),
        output_tokens: sumKnown(modelCalls.map((call) => call.output_tokens)),
        cache_read_tokens: sumKnown(
            modelCalls.map((call) => call.cache_read_tokens)
        ),
        cache_write_tokens: sumKnown(
            modelCalls.map((call) => call.cache_write_tokens)
        ),
        reasoning_tokens: sumKnown(
            modelCalls.map((call) => call.reasoning_tokens)
        )
    };
    const startData = sessionStart?.data ?? {};
    const telemetryRuntimeVersion =
        typeof startData.copilotVersion === "string" &&
        startData.copilotVersion.trim()
            ? startData.copilotVersion
            : null;
    const declaredRuntimeVersion =
        options.declaredRuntimeVersion === undefined
            ? null
            : typeof options.declaredRuntimeVersion === "string" &&
                options.declaredRuntimeVersion.trim()
              ? options.declaredRuntimeVersion
              : (() => {
                    throw new Error(
                        "declaredRuntimeVersion must be a non-empty string"
                    );
                })();
    const rawRunId =
        startData.sessionId ?? basename(dirname(eventsPath)) ?? "unknown-session";
    const shutdownTime = timestampMs(shutdown?.timestamp);
    const recordedStartTime =
        numberOrNull(shutdownData?.sessionStartTime) ??
        timestampMs(startData.startTime) ??
        timestampMs(sessionStart?.timestamp) ??
        firstTimestamp;
    const hasPostShutdownActivity =
        shutdownTime !== null &&
        latestActivityTimestamp !== null &&
        latestActivityTimestamp > shutdownTime;
    const recordedEndTime = hasPostShutdownActivity
        ? latestActivityTimestamp
        : shutdownTime ?? lastTimestamp;
    const elapsedSpanMs =
        recordedStartTime !== null && recordedEndTime !== null
            ? Math.max(0, recordedEndTime - recordedStartTime)
            : null;
    const wallTimeMs =
        resumeEvents > 0 || hasPostShutdownActivity ? null : elapsedSpanMs;
    const nanoAiUnits = numberOrNull(shutdownData?.totalNanoAiu);
    const agentsList = [...agents.values()].sort((left, right) =>
        `${left.name}:${left.tool_call_id}`.localeCompare(
            `${right.name}:${right.tool_call_id}`
        )
    );
    tools.sort((left, right) =>
        `${left.started_at}:${left.tool_call_id}`.localeCompare(
            `${right.started_at}:${right.tool_call_id}`
        )
    );

    const measuredTotals = {
        wall_time_ms: wallTimeMs,
        elapsed_span_ms: elapsedSpanMs,
        api_time_ms: numberOrNull(shutdownData?.totalApiDurationMs),
        input_tokens:
            shutdownUsage?.input_tokens ?? fallbackUsage.input_tokens,
        non_cached_input_tokens:
            shutdownUsage?.non_cached_input_tokens ??
            fallbackUsage.non_cached_input_tokens,
        output_tokens:
            shutdownUsage?.output_tokens ?? fallbackUsage.output_tokens,
        cache_read_tokens:
            shutdownUsage?.cache_read_tokens ?? fallbackUsage.cache_read_tokens,
        cache_write_tokens:
            shutdownUsage?.cache_write_tokens ?? fallbackUsage.cache_write_tokens,
        reasoning_tokens:
            shutdownUsage?.reasoning_tokens ?? fallbackUsage.reasoning_tokens,
        ai_units:
            nanoAiUnits === null
                ? sumKnown(modelCalls.map((call) => call.ai_units))
                : nanoAiUnits / NANO_AI_UNITS,
        premium_requests: numberOrNull(shutdownData?.totalPremiumRequests)
    };
    const totals = hasPostShutdownActivity
        ? {
              wall_time_ms: null,
              elapsed_span_ms: elapsedSpanMs,
              api_time_ms: null,
              input_tokens: null,
              non_cached_input_tokens: null,
              output_tokens: null,
              cache_read_tokens: null,
              cache_write_tokens: null,
              reasoning_tokens: null,
              ai_units: null,
              premium_requests: null
          }
        : measuredTotals;
    const modelAttributed = shutdownUsage ?? {
        ...fallbackUsage,
        ai_units: sumKnown(modelCalls.map((call) => call.ai_units))
    };
    const agentAttributed = {
        api_time_ms: sumKnown(
            shutdownAgentUsage.map((agent) => agent.api_time_ms)
        ),
        input_tokens: sumKnown(
            shutdownAgentUsage.map((agent) => agent.input_tokens)
        ),
        non_cached_input_tokens: sumKnown(
            shutdownAgentUsage.map(
                (agent) => agent.non_cached_input_tokens
            )
        ),
        output_tokens: sumKnown(
            shutdownAgentUsage.map((agent) => agent.output_tokens)
        ),
        cache_read_tokens: sumKnown(
            shutdownAgentUsage.map((agent) => agent.cache_read_tokens)
        ),
        cache_write_tokens: sumKnown(
            shutdownAgentUsage.map((agent) => agent.cache_write_tokens)
        ),
        reasoning_tokens: sumKnown(
            shutdownAgentUsage.map((agent) => agent.reasoning_tokens)
        ),
        ai_units: sumKnown(shutdownAgentUsage.map((agent) => agent.ai_units))
    };
    const accounting = {
        snapshot_policy: shutdown
            ? "latest session.shutdown snapshot; earlier snapshots are not summed"
            : "model call receipt fallback",
        shutdown_snapshots: shutdownSnapshots,
        resume_events: resumeEvents,
        attribution_views_are_non_additive: true,
        model_reconciliation: {
            input_tokens: reconcile(
                measuredTotals.input_tokens,
                modelAttributed.input_tokens
            ),
            non_cached_input_tokens: reconcile(
                measuredTotals.non_cached_input_tokens,
                modelAttributed.non_cached_input_tokens
            ),
            output_tokens: reconcile(
                measuredTotals.output_tokens,
                modelAttributed.output_tokens
            ),
            cache_read_tokens: reconcile(
                measuredTotals.cache_read_tokens,
                modelAttributed.cache_read_tokens
            ),
            cache_write_tokens: reconcile(
                measuredTotals.cache_write_tokens,
                modelAttributed.cache_write_tokens
            ),
            ai_units: reconcile(
                measuredTotals.ai_units,
                modelAttributed.ai_units
            )
        },
        agent_reconciliation: {
            api_time_ms: reconcile(
                measuredTotals.api_time_ms,
                agentAttributed.api_time_ms
            ),
            input_tokens: reconcile(
                measuredTotals.input_tokens,
                agentAttributed.input_tokens
            ),
            non_cached_input_tokens: reconcile(
                measuredTotals.non_cached_input_tokens,
                agentAttributed.non_cached_input_tokens
            ),
            output_tokens: reconcile(
                measuredTotals.output_tokens,
                agentAttributed.output_tokens
            ),
            cache_read_tokens: reconcile(
                measuredTotals.cache_read_tokens,
                agentAttributed.cache_read_tokens
            ),
            cache_write_tokens: reconcile(
                measuredTotals.cache_write_tokens,
                agentAttributed.cache_write_tokens
            ),
            ai_units: reconcile(
                measuredTotals.ai_units,
                agentAttributed.ai_units
            )
        },
        snapshot_is_final: shutdown ? !hasPostShutdownActivity : null,
        snapshot_age_ms: shutdown
            ? hasPostShutdownActivity
                ? recordedEndTime - shutdownTime
                : 0
            : null,
        known_subtotals: hasPostShutdownActivity ? measuredTotals : null
    };
    const missing = [];
    if (!shutdown) missing.push("session.shutdown totals");
    if (hasPostShutdownActivity) {
        missing.push("final shutdown totals after the latest session activity");
    }
    if (totals.elapsed_span_ms === null) {
        missing.push("wall-clock timestamps");
    } else if (resumeEvents > 0) {
        missing.push("active wall time across resumes");
    }
    if (totals.input_tokens === null && totals.output_tokens === null) {
        missing.push("model token usage");
    }
    if (modelCalls.length === 0) missing.push("per-call model receipts");
    const hasTokenEvidence =
        measuredTotals.input_tokens !== null ||
        measuredTotals.output_tokens !== null ||
        measuredTotals.cache_read_tokens !== null ||
        measuredTotals.cache_write_tokens !== null;
    const evidenceLevel = hasTokenEvidence ? "L2" : parsedEvents > 0 ? "L1" : "L0";
    const warnings = [];
    if (invalidJsonLines > 0) {
        warnings.push(`${invalidJsonLines} invalid JSONL line(s) skipped`);
    }
    const incompleteTools = tools.filter((tool) => tool.status === "incomplete").length;
    if (incompleteTools > 0) {
        warnings.push(`${incompleteTools} tool call(s) have no completion event`);
    }
    const runningAgents = agentsList.filter((agent) => agent.status === "running").length;
    if (runningAgents > 0) {
        warnings.push(`${runningAgents} subagent run(s) have no terminal event`);
    }
    if (!shutdown) {
        warnings.push("session is missing shutdown metrics; totals use event receipts");
    }
    if (shutdownSnapshots > 1) {
        warnings.push(
            `${shutdownSnapshots} shutdown snapshots found; latest snapshot selected without summing`
        );
    }
    if (resumeEvents > 0) {
        warnings.push(
            "session contains resume events; elapsed span includes inactive gaps and active wall time is unmeasured"
        );
    }
    if (hasPostShutdownActivity) {
        warnings.push(
            "events occur after the latest shutdown snapshot; additive totals are null and the snapshot is retained only as a known subtotal"
        );
    }
    if (
        declaredRuntimeVersion !== null &&
        telemetryRuntimeVersion !== null &&
        declaredRuntimeVersion !== telemetryRuntimeVersion
    ) {
        warnings.push(
            `declared runtime version ${declaredRuntimeVersion} differs from session telemetry version ${telemetryRuntimeVersion}`
        );
    }
    for (const [view, reconciliation] of [
        ["model", accounting.model_reconciliation],
        ["agent", accounting.agent_reconciliation]
    ]) {
        for (const [metric, result] of Object.entries(reconciliation)) {
            if (result.reconciled === false) {
                warnings.push(
                    `${view} ${metric} attribution does not reconcile with the session total; residual ${result.difference}`
                );
            }
        }
    }

    return {
        schema_version: SCHEMA_VERSION,
        run_id: protectedRunId(String(rawRunId), options.includeIdentifiers === true),
        runtime: {
            name: "github-copilot-cli",
            version: declaredRuntimeVersion ?? telemetryRuntimeVersion,
            telemetry_version: telemetryRuntimeVersion,
            version_source:
                declaredRuntimeVersion === null
                    ? "session.start"
                    : "declared runtime probe",
            producer: startData.producer ?? null,
            selected_model:
                shutdownData?.currentModel ?? startData.selectedModel ?? null,
            context_tier: startData.contextTier ?? null,
            reasoning_efforts: [...reasoningEfforts].sort()
        },
        artifact: {
            format: "github-copilot-cli-events-jsonl",
            parsed_events: parsedEvents,
            invalid_json_lines: invalidJsonLines,
            shutdown_snapshots: shutdownSnapshots,
            resume_events: resumeEvents,
            event_counts: Object.fromEntries(
                [...eventCounts.entries()].sort(([left], [right]) =>
                    left.localeCompare(right)
                )
            )
        },
        timing: {
            started_at:
                recordedStartTime === null
                    ? null
                    : new Date(recordedStartTime).toISOString(),
            ended_at:
                recordedEndTime === null
                    ? null
                    : new Date(recordedEndTime).toISOString(),
            status: hasPostShutdownActivity
                ? "activity_after_shutdown"
                : shutdown
                  ? "ended"
                  : "live_or_interrupted",
            elapsed_span_ms: elapsedSpanMs,
            active_wall_time_ms: wallTimeMs
        },
        model_calls: modelCalls,
        agents: agentsList,
        tools,
        stages: buildStages(
            modelCalls,
            shutdownUsage?.models ?? [],
            tools,
            agentsList
        ),
        totals,
        accounting,
        coverage: {
            evidence_level: evidenceLevel,
            missing,
            warnings
        },
        privacy: {
            identifiers: options.includeIdentifiers === true ? "included" : "hashed",
            excluded: [
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

function display(value) {
    return value === null || value === undefined
        ? "unmeasured"
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

function markdownText(value) {
    return String(value ?? "unknown").replaceAll("|", "\\|").replaceAll("`", "\\`");
}

export function renderMarkdown(profile) {
    const lines = [
        "# Pace session profile",
        "",
        `**Run:** \`${markdownText(profile.run_id)}\`  `,
        `**Runtime:** ${markdownText(profile.runtime.name)} ${markdownText(profile.runtime.version ?? "")}  `,
        `**Evidence:** ${profile.coverage.evidence_level}`,
        "",
        "## Totals",
        "",
        "| Metric | Value |",
        "|---|---:|",
        `| Active wall time (ms) | ${display(profile.totals.wall_time_ms)} |`,
        `| Elapsed span (ms) | ${display(profile.totals.elapsed_span_ms)} |`,
        `| API time (ms) | ${display(profile.totals.api_time_ms)} |`,
        `| Input tokens | ${display(profile.totals.input_tokens)} |`,
        `| Non-cached input tokens | ${display(profile.totals.non_cached_input_tokens)} |`,
        `| Output tokens | ${display(profile.totals.output_tokens)} |`,
        `| Cache read tokens | ${display(profile.totals.cache_read_tokens)} |`,
        `| Cache write tokens | ${display(profile.totals.cache_write_tokens)} |`,
        `| AI units | ${display(profile.totals.ai_units)} |`,
        "",
        "## Attribution views",
        "",
        "Model, agent, and tool rows are different views of the same work. Do not add rows across kinds. Classification remains `unknown` until a human marks each stage as deterministic, retrieval, orchestration/transport, or semantic judgment.",
        "",
        "| Kind | Name | Invocations | Duration (ms) | Input | Non-cached input | Output | Cache read | AI units |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|"
    ];

    for (const stage of profile.stages) {
        lines.push(
            `| ${markdownText(stage.kind)} | ${markdownText(stage.name)} | ${display(stage.invocations)} | ${display(stage.duration_ms)} | ${display(stage.input_tokens)} | ${display(stage.non_cached_input_tokens)} | ${display(stage.output_tokens)} | ${display(stage.cache_read_tokens)} | ${display(stage.ai_units)} |`
        );
    }

    lines.push(
        "",
        "## Accounting",
        "",
        `- Snapshot policy: ${markdownText(profile.accounting.snapshot_policy)}`,
        `- Shutdown snapshots: ${display(profile.accounting.shutdown_snapshots)}`,
        `- Resume events: ${display(profile.accounting.resume_events)}`,
        `- Latest shutdown snapshot final: ${profile.accounting.snapshot_is_final === null ? "unavailable" : profile.accounting.snapshot_is_final ? "yes" : "no"}`,
        `- Activity after latest snapshot (ms): ${display(profile.accounting.snapshot_age_ms)}`,
        "- Attribution views are non-additive.",
        "",
        "| View | Metric | Reference total | Attributed | Residual | Reconciled |",
        "|---|---|---:|---:|---:|---|"
    );
    for (const [view, reconciliation] of [
        ["model", profile.accounting.model_reconciliation],
        ["agent", profile.accounting.agent_reconciliation]
    ]) {
        for (const [metric, result] of Object.entries(reconciliation)) {
            lines.push(
                `| ${view} | ${markdownText(metric)} | ${display(result.total)} | ${display(result.attributed)} | ${display(result.difference)} | ${result.reconciled === null ? "unmeasured" : result.reconciled ? "yes" : "no"} |`
            );
        }
    }

    lines.push("", "## Coverage", "");
    if (profile.coverage.missing.length === 0) {
        lines.push("- No required MVP measurements are missing.");
    } else {
        for (const item of profile.coverage.missing) {
            lines.push(`- Missing: ${markdownText(item)}`);
        }
    }
    for (const warning of profile.coverage.warnings) {
        lines.push(`- Warning: ${markdownText(warning)}`);
    }
    lines.push(
        "",
        `Parsed ${display(profile.artifact.parsed_events)} events; raw prompts, messages, tool arguments, results, code changes, and working directories were excluded.`
    );

    return `${lines.join("\n")}\n`;
}

export function writeProfileArtifacts(profile, outputDirectory) {
    const output = resolve(outputDirectory);
    mkdirSync(output, { recursive: true });
    const safeRunId = profile.run_id.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
    const jsonPath = join(output, `${safeRunId}.agent-profile.json`);
    const markdownPath = join(output, `${safeRunId}.report.md`);
    writeFileSync(jsonPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, renderMarkdown(profile), "utf8");
    return { jsonPath, markdownPath };
}

function usage() {
    return [
        "Usage: node profile-session.mjs <session-directory|events.jsonl> [options]",
        "",
        "Options:",
        "  -o, --out <directory>       Output directory (default: pace-output)",
        "      --include-identifiers    Preserve the raw session identifier",
        "  -h, --help                  Show this help"
    ].join("\n");
}

function parseArguments(argv) {
    let input = null;
    let output = "pace-output";
    let includeIdentifiers = false;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "-h" || argument === "--help") {
            return { help: true };
        }
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
        if (input !== null) throw new Error("only one session artifact is supported");
        input = argument;
    }

    if (input === null) throw new Error("a session directory or events.jsonl is required");
    return { input, output, includeIdentifiers, help: false };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const profile = await profileSession(args.input, {
            includeIdentifiers: args.includeIdentifiers
        });
        const paths = writeProfileArtifacts(profile, args.output);
        process.stdout.write(`${paths.jsonPath}\n${paths.markdownPath}\n`);
    } catch (error) {
        process.stderr.write(`pace profile failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
