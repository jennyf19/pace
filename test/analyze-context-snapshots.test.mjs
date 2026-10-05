import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    analyzeContextSnapshots,
    renderContextMarkdown,
    writeContextArtifacts
} from "../analyze-context-snapshots.mjs";

async function writeSession(
    directory,
    name,
    {
        current,
        system,
        conversation,
        toolDefinitions,
        input,
        cacheRead,
        aiUnits,
        requests,
        toolCalls
    }
) {
    const sessionDirectory = join(directory, name);
    await writeFile(
        join(directory, `${name}.placeholder`),
        "",
        "utf8"
    );
    await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(sessionDirectory, { recursive: true })
    );
    const events = [
        {
            type: "session.start",
            timestamp: "2026-10-05T00:00:00.000Z",
            data: {
                sessionId: name,
                copilotVersion: "synthetic",
                producer: "pace-test",
                selectedModel: "synthetic-model"
            }
        }
    ];
    for (let index = 0; index < toolCalls; index += 1) {
        events.push(
            {
                type: "tool.execution_start",
                timestamp: `2026-10-05T00:00:00.${100 + index}Z`,
                data: {
                    toolCallId: `${name}-tool-${index}`,
                    toolName: "view"
                }
            },
            {
                type: "tool.execution_complete",
                timestamp: `2026-10-05T00:00:00.${200 + index}Z`,
                data: {
                    toolCallId: `${name}-tool-${index}`,
                    success: true
                }
            }
        );
    }
    events.push({
        type: "session.shutdown",
        timestamp: "2026-10-05T00:00:01.000Z",
        data: {
            currentModel: "synthetic-model",
            currentTokens: current,
            systemTokens: system,
            conversationTokens: conversation,
            toolDefinitionsTokens: toolDefinitions,
            totalPremiumRequests: 0,
            totalNanoAiu: aiUnits * 1_000_000_000,
            totalApiDurationMs: 500,
            modelMetrics: {
                "synthetic-model": {
                    requests: { count: requests },
                    usage: {
                        inputTokens: input,
                        outputTokens: 100,
                        cacheReadTokens: cacheRead,
                        cacheWriteTokens: 0,
                        reasoningTokens: 50
                    },
                    totalNanoAiu: aiUnits * 1_000_000_000
                }
            },
            agentMetrics: {}
        }
    });
    await writeFile(
        join(sessionDirectory, "events.jsonl"),
        events.map(JSON.stringify).join("\n"),
        "utf8"
    );
    return sessionDirectory;
}

test("summarizes context snapshots without adding them to usage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-context-analysis-"));
    const output = await mkdtemp(join(tmpdir(), "pace-context-output-"));
    try {
        const baseline1 = await writeSession(directory, "baseline-1", {
            current: 3003,
            system: 1900,
            conversation: 900,
            toolDefinitions: 200,
            input: 5000,
            cacheRead: 2000,
            aiUnits: 0.2,
            requests: 2,
            toolCalls: 1
        });
        const baseline2 = await writeSession(directory, "baseline-2", {
            current: 3103,
            system: 1900,
            conversation: 1000,
            toolDefinitions: 200,
            input: 5200,
            cacheRead: 2200,
            aiUnits: 0.22,
            requests: 2,
            toolCalls: 1
        });
        const candidate1 = await writeSession(directory, "candidate-1", {
            current: 2903,
            system: 1800,
            conversation: 1100,
            toolDefinitions: 0,
            input: 2400,
            cacheRead: 0,
            aiUnits: 0.15,
            requests: 1,
            toolCalls: 0
        });
        const candidate2 = await writeSession(directory, "candidate-2", {
            current: 3003,
            system: 1800,
            conversation: 1200,
            toolDefinitions: 0,
            input: 2500,
            cacheRead: 1000,
            aiUnits: 0.16,
            requests: 1,
            toolCalls: 0
        });
        const manifestPath = join(directory, "analysis.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                analysis_id: "private-context-analysis",
                source: {
                    replay_receipt: "sha256:1111111111111111",
                    comparison_receipt: "sha256:2222222222222222",
                    experiment_source_commit: "a".repeat(40),
                    analysis_source_commit: "c".repeat(40)
                },
                cohorts: {
                    baseline: [
                        { id: "baseline-1", artifact: baseline1 },
                        { id: "baseline-2", artifact: baseline2 }
                    ],
                    candidate: [
                        { id: "candidate-1", artifact: candidate1 },
                        { id: "candidate-2", artifact: candidate2 }
                    ]
                }
            }),
            "utf8"
        );

        const analysis = await analyzeContextSnapshots(manifestPath);
        const paths = writeContextArtifacts(analysis, output);
        const written = JSON.parse(await readFile(paths.jsonPath, "utf8"));
        const report = await readFile(paths.markdownPath, "utf8");

        assert.equal(
            analysis.baseline.metrics.tool_definition_tokens.distribution.p50,
            200
        );
        assert.equal(
            analysis.candidate.metrics.tool_definition_tokens.distribution.p50,
            0
        );
        assert.equal(
            analysis.baseline.metrics.model_requests.distribution.p50,
            2
        );
        assert.equal(
            analysis.candidate.metrics.tool_invocations.distribution.p50,
            0
        );
        assert.equal(
            analysis.comparison.system_tokens.absolute_delta,
            -100
        );
        assert.equal(
            analysis.accounting.usage_boundary,
            "context snapshot metrics are non-additive and distinct from billed/logical input usage"
        );
        assert.equal(written.analysis_id, analysis.analysis_id);
        assert.equal(report, renderContextMarkdown(analysis));
        assert.doesNotMatch(JSON.stringify(written), /pace-context-analysis-/);
        assert.doesNotMatch(JSON.stringify(written), /[A-Za-z]:\\\\/);
    } finally {
        await Promise.all([
            rm(directory, { recursive: true, force: true }),
            rm(output, { recursive: true, force: true })
        ]);
    }
});

test("rejects duplicate raw session evidence", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-context-duplicate-")
    );
    try {
        const session = await writeSession(directory, "shared", {
            current: 1003,
            system: 700,
            conversation: 300,
            toolDefinitions: 0,
            input: 1000,
            cacheRead: 0,
            aiUnits: 0.1,
            requests: 1,
            toolCalls: 0
        });
        const manifestPath = join(directory, "analysis.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                analysis_id: "duplicate-analysis",
                source: {
                    replay_receipt: "sha256:1111111111111111",
                    comparison_receipt: "sha256:2222222222222222",
                    experiment_source_commit: "b".repeat(40),
                    analysis_source_commit: "d".repeat(40)
                },
                cohorts: {
                    baseline: [
                        { id: "baseline-1", artifact: session },
                        { id: "baseline-2", artifact: session }
                    ],
                    candidate: [
                        { id: "candidate-1", artifact: session },
                        { id: "candidate-2", artifact: session }
                    ]
                }
            }),
            "utf8"
        );

        await assert.rejects(
            analyzeContextSnapshots(manifestPath),
            /duplicate artifact evidence/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
