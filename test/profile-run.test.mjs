import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    profileRunManifest,
    renderRunMarkdown,
    writeRunArtifacts
} from "../profile-run.mjs";

const runSetFixture = new URL("./fixtures/run-set.json", import.meta.url);
const completeFixture = new URL("./fixtures/complete-session/", import.meta.url);

test("aggregates independent sessions once and excludes included usage", async () => {
    const profile = await profileRunManifest(runSetFixture);

    assert.match(profile.run_id, /^sha256:[a-f0-9]{16}$/);
    assert.equal(profile.sessions.length, 3);
    assert.equal(profile.accounting.contributing_sessions.length, 2);
    assert.equal(profile.accounting.included_sessions.length, 1);
    assert.equal(profile.totals.input_tokens, 150);
    assert.equal(profile.totals.non_cached_input_tokens, 70);
    assert.equal(profile.totals.output_tokens, 30);
    assert.equal(profile.totals.cache_read_tokens, 80);
    assert.equal(profile.totals.ai_units, 2.5);
    assert.equal(profile.totals.wall_time_ms, 3_604_000);
    assert.equal(profile.totals.api_time_ms, null);
    assert.equal(
        profile.accounting.metric_coverage.api_time_ms.known_subtotal,
        700
    );
    assert.equal(
        profile.accounting.metric_coverage.api_time_ms.complete,
        false
    );
    assert.equal(profile.coverage.evidence_level, "L2");
    assert.ok(
        profile.coverage.warnings.some((warning) =>
            warning.includes("excluded from totals")
        )
    );

    const serialized = JSON.stringify(profile);
    assert.doesNotMatch(serialized, /private-run-set/);
    assert.doesNotMatch(serialized, /complete-session/);
});

test("rejects duplicate artifact paths before they can double count", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-run-duplicate-"));
    try {
        const artifact = fileURLToPath(completeFixture);
        const manifestPath = join(directory, "run-set.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                run_id: "duplicate-run",
                sessions: [
                    {
                        id: "first",
                        artifact,
                        billing: "independent"
                    },
                    {
                        id: "second",
                        artifact,
                        billing: "independent"
                    }
                ]
            }),
            "utf8"
        );

        await assert.rejects(
            profileRunManifest(manifestPath),
            /duplicate artifact path/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("writes run JSON and Markdown artifacts", async () => {
    const output = await mkdtemp(join(tmpdir(), "pace-run-profile-"));
    try {
        const profile = await profileRunManifest(runSetFixture);
        const paths = writeRunArtifacts(profile, output);
        const written = JSON.parse(await readFile(paths.jsonPath, "utf8"));
        const report = await readFile(paths.markdownPath, "utf8");

        assert.equal(written.run_id, profile.run_id);
        assert.equal(report, renderRunMarkdown(profile));
        assert.match(report, /# Pace run profile/);
        assert.match(report, /Independent sessions contribute once/i);
        assert.doesNotMatch(report, /private-run-set/);
    } finally {
        await rm(output, { recursive: true, force: true });
    }
});

test("carries a declared runtime version into aggregated session evidence", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-run-declared-version-")
    );
    try {
        const artifact = fileURLToPath(completeFixture);
        const manifestPath = join(directory, "run-set.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                run_id: "declared-version-run",
                sessions: [
                    {
                        id: "primary",
                        artifact,
                        billing: "independent",
                        declared_runtime_version: "1.0.88"
                    }
                ]
            }),
            "utf8"
        );

        const profile = await profileRunManifest(manifestPath);
        assert.equal(
            profile.sessions[0].profile.runtime.version,
            "1.0.88"
        );
        assert.equal(
            profile.sessions[0].profile.runtime.telemetry_version,
            "1.0.87-0"
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
