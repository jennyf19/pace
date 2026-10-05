import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    profileSession,
    renderMarkdown,
    writeProfileArtifacts
} from "../profile-session.mjs";

const completeFixture = new URL("./fixtures/complete-session/", import.meta.url);
const partialFixture = new URL("./fixtures/partial-session/", import.meta.url);
const resumedFixture = new URL("./fixtures/resumed-session/", import.meta.url);
const staleShutdownFixture = new URL(
    "./fixtures/stale-shutdown-session/",
    import.meta.url
);

test("profiles shutdown totals without retaining sensitive event payloads", async () => {
    const profile = await profileSession(completeFixture);

    assert.match(profile.run_id, /^sha256:[a-f0-9]{16}$/);
    assert.equal(profile.runtime.version, "1.0.87-0");
    assert.equal(profile.coverage.evidence_level, "L2");
    assert.deepEqual(profile.coverage.missing, []);
    assert.equal(profile.totals.wall_time_ms, 10_000);
    assert.equal(profile.totals.api_time_ms, 700);
    assert.equal(profile.totals.input_tokens, 100);
    assert.equal(profile.totals.non_cached_input_tokens, 40);
    assert.equal(profile.totals.output_tokens, 20);
    assert.equal(profile.totals.cache_read_tokens, 60);
    assert.equal(profile.totals.cache_write_tokens, 0);
    assert.equal(profile.totals.ai_units, 2);
    assert.equal(profile.tools[0].duration_ms, 1_000);
    assert.equal(profile.tools[0].status, "completed");
    const mainAgent = profile.agents.find((agent) => agent.agent_id === "main");
    const exploreAgent = profile.agents.find(
        (agent) => agent.tool_call_id === "agent-tool-1"
    );
    assert.equal(mainAgent.status, "session");
    assert.equal(mainAgent.input_tokens, 70);
    assert.equal(exploreAgent.status, "completed");
    assert.equal(exploreAgent.total_tokens, 30);
    assert.equal(exploreAgent.input_tokens, 30);
    assert.equal(
        profile.accounting.model_reconciliation.ai_units.reconciled,
        true
    );
    assert.equal(
        profile.accounting.agent_reconciliation.ai_units.reconciled,
        true
    );
    assert.ok(profile.stages.every((stage) => stage.classification === "unknown"));

    const serialized = JSON.stringify(profile);
    assert.doesNotMatch(serialized, /SECRET/);
    assert.doesNotMatch(serialized, /private-session-id/);
});

test("falls back to call receipts and reports incomplete evidence", async () => {
    const profile = await profileSession(partialFixture, {
        includeIdentifiers: true
    });

    assert.equal(profile.run_id, "partial-session");
    assert.equal(profile.totals.wall_time_ms, 4_000);
    assert.equal(profile.totals.input_tokens, 50);
    assert.equal(profile.totals.non_cached_input_tokens, 30);
    assert.equal(profile.totals.output_tokens, 10);
    assert.equal(profile.totals.cache_read_tokens, 20);
    assert.equal(profile.totals.ai_units, 0.5);
    assert.equal(profile.artifact.invalid_json_lines, 1);
    assert.equal(profile.model_calls[1].cache_read_tokens, null);
    assert.equal(profile.model_calls[1].cache_write_tokens, null);
    assert.equal(profile.model_calls[1].ai_units, null);
    const agentStage = profile.stages.find((stage) => stage.kind === "agent");
    assert.equal(agentStage.input_tokens, null);
    assert.equal(agentStage.ai_units, null);
    assert.equal(profile.tools[0].status, "incomplete");
    assert.ok(profile.coverage.missing.includes("session.shutdown totals"));
    assert.ok(
        profile.coverage.warnings.includes("1 invalid JSONL line(s) skipped")
    );
    assert.ok(
        profile.coverage.warnings.includes(
            "session is missing shutdown metrics; totals use event receipts"
        )
    );
});

test("preserves telemetry version when a declared runtime version is frozen", async () => {
    const profile = await profileSession(completeFixture, {
        declaredRuntimeVersion: "1.0.88"
    });

    assert.equal(profile.runtime.version, "1.0.88");
    assert.equal(profile.runtime.telemetry_version, "1.0.87-0");
    assert.equal(profile.runtime.version_source, "declared runtime probe");
    assert.ok(
        profile.coverage.warnings.includes(
            "declared runtime version 1.0.88 differs from session telemetry version 1.0.87-0"
        )
    );
});

test("captures tool-definition tokens from shutdown telemetry", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-tool-definition-tokens-")
    );
    try {
        await writeFile(
            join(directory, "events.jsonl"),
            [
                JSON.stringify({
                    type: "session.start",
                    timestamp: "2026-10-05T00:00:00.000Z",
                    data: {
                        sessionId: "tool-definition-session",
                        copilotVersion: "synthetic",
                        producer: "pace-test",
                        selectedModel: "synthetic-model"
                    }
                }),
                JSON.stringify({
                    type: "session.shutdown",
                    timestamp: "2026-10-05T00:00:01.000Z",
                    data: {
                        currentModel: "synthetic-model",
                        toolDefinitionsTokens: 203,
                        totalPremiumRequests: 0,
                        totalNanoAiu: 100000000,
                        totalApiDurationMs: 500,
                        modelMetrics: {
                            "synthetic-model": {
                                requests: { count: 1 },
                                usage: {
                                    inputTokens: 1000,
                                    outputTokens: 100,
                                    cacheReadTokens: 200,
                                    cacheWriteTokens: 0,
                                    reasoningTokens: 50
                                },
                                totalNanoAiu: 100000000
                            }
                        },
                        agentMetrics: {}
                    }
                })
            ].join("\n"),
            "utf8"
        );

        const profile = await profileSession(directory);
        assert.equal(profile.totals.tool_definition_tokens, 203);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("selects the latest shutdown snapshot and fails closed on resumed wall time", async () => {
    const profile = await profileSession(resumedFixture);

    assert.equal(profile.artifact.shutdown_snapshots, 2);
    assert.equal(profile.artifact.resume_events, 1);
    assert.equal(profile.totals.input_tokens, 300);
    assert.equal(profile.totals.non_cached_input_tokens, 150);
    assert.equal(profile.totals.output_tokens, 30);
    assert.equal(profile.totals.ai_units, 30);
    assert.equal(profile.totals.elapsed_span_ms, 20_000);
    assert.equal(profile.totals.wall_time_ms, null);
    assert.equal(
        profile.accounting.model_reconciliation.ai_units.attributed,
        20
    );
    assert.equal(
        profile.accounting.model_reconciliation.ai_units.difference,
        10
    );
    assert.equal(
        profile.accounting.agent_reconciliation.ai_units.reconciled,
        false
    );
    assert.ok(
        profile.coverage.missing.includes("active wall time across resumes")
    );
    assert.ok(
        profile.coverage.warnings.includes(
            "2 shutdown snapshots found; latest snapshot selected without summing"
        )
    );
});

test("treats activity after shutdown as an incomplete known subtotal", async () => {
    const profile = await profileSession(staleShutdownFixture);

    assert.equal(profile.timing.status, "activity_after_shutdown");
    assert.equal(profile.timing.elapsed_span_ms, 13_000);
    assert.equal(profile.totals.input_tokens, null);
    assert.equal(profile.totals.ai_units, null);
    assert.equal(profile.accounting.snapshot_is_final, false);
    assert.equal(profile.accounting.snapshot_age_ms, 8_000);
    assert.equal(profile.accounting.known_subtotals.input_tokens, 100);
    assert.equal(
        profile.accounting.known_subtotals.non_cached_input_tokens,
        50
    );
    assert.equal(profile.accounting.known_subtotals.ai_units, 10);
    assert.equal(profile.coverage.evidence_level, "L2");
    assert.ok(
        profile.coverage.missing.includes(
            "final shutdown totals after the latest session activity"
        )
    );
    assert.ok(
        profile.coverage.warnings.includes(
            "events occur after the latest shutdown snapshot; additive totals are null and the snapshot is retained only as a known subtotal"
        )
    );
});

test("writes stable JSON and Markdown artifacts", async () => {
    const output = await mkdtemp(join(tmpdir(), "pace-profile-"));
    try {
        const profile = await profileSession(completeFixture);
        const paths = writeProfileArtifacts(profile, output);
        const written = JSON.parse(await readFile(paths.jsonPath, "utf8"));
        const report = await readFile(paths.markdownPath, "utf8");

        assert.equal(written.run_id, profile.run_id);
        assert.equal(report, renderMarkdown(profile));
        assert.match(report, /# Pace session profile/);
        assert.match(report, /Attribution views/);
        assert.match(report, /Do not add rows across kinds/);
        assert.doesNotMatch(report, /SECRET/);
    } finally {
        await rm(output, { recursive: true, force: true });
    }
});
