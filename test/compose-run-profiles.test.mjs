import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256File } from "../build-replay-manifest.mjs";
import { composeRunProfiles } from "../compose-run-profiles.mjs";
import { validateRunProfile } from "../compare-runs.mjs";
import { profileRunManifest, writeRunArtifacts } from "../profile-run.mjs";

const baselineManifest = new URL(
    "../examples/frozen-comparison/baseline-run.json",
    import.meta.url
);
const candidateManifest = new URL(
    "../examples/frozen-comparison/candidate-run.json",
    import.meta.url
);

async function writeComponentProfiles(directory) {
    const baseline = await profileRunManifest(baselineManifest, {
        includeIdentifiers: true
    });
    const candidate = await profileRunManifest(candidateManifest, {
        includeIdentifiers: true
    });
    const baselinePaths = writeRunArtifacts(baseline, directory);
    const candidatePaths = writeRunArtifacts(candidate, directory);
    return {
        baseline,
        candidate,
        baselinePath: baselinePaths.jsonPath,
        candidatePath: candidatePaths.jsonPath
    };
}

test("composes component profiles once with end-to-end timing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compose-"));
    try {
        const components = await writeComponentProfiles(directory);
        const manifestPath = join(directory, "composite.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                run_id: "hybrid-run",
                components: [
                    {
                        id: "preprocess",
                        role: "deterministic",
                        profile: components.baselinePath
                    },
                    {
                        id: "residual",
                        role: "semantic",
                        profile: components.candidatePath
                    }
                ]
            }),
            "utf8"
        );

        const profile = await composeRunProfiles(manifestPath, {
            includeIdentifiers: true
        });
        assert.equal(profile.run_type, "composite");
        assert.equal(profile.accounting.components.length, 2);
        assert.equal(
            profile.totals.input_tokens,
            components.baseline.totals.input_tokens +
                components.candidate.totals.input_tokens
        );
        assert.equal(profile.totals.ai_units, 3.8);
        assert.equal(profile.totals.wall_time_ms, 3_606_000);
        assert.equal(profile.sessions.length, 2);
        assert.equal(profile.accounting.contributing_sessions.length, 2);
        assert.equal(validateRunProfile(profile, "composite profile"), profile);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("fails closed when a component metric is incomplete", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-compose-incomplete-")
    );
    try {
        const components = await writeComponentProfiles(directory);
        const candidate = JSON.parse(
            await readFile(components.candidatePath, "utf8")
        );
        candidate.totals.ai_units = null;
        candidate.accounting.metric_coverage.ai_units = {
            value: null,
            known_subtotal: 1,
            complete: false,
            missing_sessions: ["candidate-session"]
        };
        candidate.coverage.missing.push("ai_units is incomplete");
        await writeFile(
            components.candidatePath,
            JSON.stringify(candidate),
            "utf8"
        );
        const manifestPath = join(directory, "composite.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                run_id: "hybrid-run",
                components: [
                    {
                        id: "preprocess",
                        profile: components.baselinePath
                    },
                    {
                        id: "residual",
                        profile: components.candidatePath
                    }
                ]
            }),
            "utf8"
        );

        const profile = await composeRunProfiles(manifestPath);
        assert.equal(profile.totals.ai_units, null);
        assert.equal(
            profile.accounting.metric_coverage.ai_units.complete,
            false
        );
        assert.equal(
            profile.accounting.metric_coverage.ai_units.known_subtotal,
            components.baseline.totals.ai_units + 1
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects duplicate component evidence even through copied profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compose-duplicate-"));
    try {
        const components = await writeComponentProfiles(directory);
        const copiedPath = join(directory, "copied-profile.json");
        await writeFile(
            copiedPath,
            await readFile(components.baselinePath, "utf8"),
            "utf8"
        );
        const manifestPath = join(directory, "composite.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                run_id: "hybrid-run",
                components: [
                    {
                        id: "first",
                        profile: components.baselinePath
                    },
                    {
                        id: "copy",
                        profile: copiedPath
                    }
                ]
            }),
            "utf8"
        );

        await assert.rejects(
            composeRunProfiles(manifestPath),
            /duplicate run_id|duplicate contributing session evidence/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("component profile hashes remain bound in composite receipts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compose-hash-"));
    try {
        const components = await writeComponentProfiles(directory);
        const manifestPath = join(directory, "composite.json");
        await writeFile(
            manifestPath,
            JSON.stringify({
                schema_version: "0.1",
                run_id: "hybrid-run",
                components: [
                    {
                        id: "first",
                        profile: components.baselinePath
                    },
                    {
                        id: "second",
                        profile: components.candidatePath
                    }
                ]
            }),
            "utf8"
        );
        const profile = await composeRunProfiles(manifestPath);
        const baselineHash = (await sha256File(components.baselinePath)).sha256;

        assert.equal(
            profile.accounting.components[0].run_profile_sha256,
            baselineHash
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
