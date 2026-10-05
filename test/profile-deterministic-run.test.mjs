import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateRunProfile } from "../compare-runs.mjs";
import {
    deterministicRuntimeSignature,
    profileDeterministicJsonTransform
} from "../profile-deterministic-run.mjs";
import { buildCandidateResult } from "../examples/hosted-replay/prepare-input.mjs";

const inputUrl = new URL(
    "../examples/hosted-replay/baseline-input.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-replay/expected-result.json",
    import.meta.url
);
const implementationUrl = new URL(
    "../examples/hosted-replay/prepare-input.mjs",
    import.meta.url
);

test("profiles a hash-bound deterministic run with explicit zero model usage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-deterministic-"));
    try {
        const outputPath = join(directory, "result.json");
        const expected = JSON.parse(await readFile(expectedUrl, "utf8"));
        const { profile, result } = await profileDeterministicJsonTransform({
            runId: "private-deterministic-run",
            input: {
                id: "private-input",
                path: inputUrl
            },
            output: {
                id: "private-output",
                path: outputPath
            },
            transform: buildCandidateResult,
            implementationFiles: [
                {
                    id: "private-transform",
                    path: implementationUrl
                }
            ]
        });

        assert.deepEqual(result, expected);
        assert.deepEqual(
            JSON.parse(await readFile(outputPath, "utf8")),
            expected
        );
        assert.equal(profile.run_type, "deterministic");
        assert.equal(profile.coverage.evidence_level, "L3");
        assert.equal(profile.totals.input_tokens, 0);
        assert.equal(profile.totals.tool_definition_tokens, 0);
        assert.equal(profile.totals.ai_units, 0);
        assert.equal(profile.totals.premium_requests, 0);
        assert.equal(
            profile.accounting.metric_coverage.ai_units.complete,
            true
        );
        assert.equal(
            profile.accounting.deterministic_execution_contract.method,
            "synchronous_local_json_transform_v1"
        );
        assert.equal(
            profile.sessions[0].profile.artifact.implementation.files.length,
            2
        );
        assert.deepEqual(deterministicRuntimeSignature().models, []);
        assert.equal(
            validateRunProfile(profile, "deterministic profile"),
            profile
        );

        const serialized = JSON.stringify(profile);
        assert.doesNotMatch(serialized, /private-deterministic-run/);
        assert.doesNotMatch(serialized, /private-transform/);
        assert.doesNotMatch(serialized, /[A-Za-z]:\\\\/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects deterministic profiles whose zero-usage proof is missing", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-deterministic-proof-")
    );
    try {
        const { profile } = await profileDeterministicJsonTransform({
            runId: "proof-run",
            input: {
                id: "input",
                path: inputUrl
            },
            output: {
                id: "output",
                path: join(directory, "result.json")
            },
            transform: buildCandidateResult,
            implementationFiles: [
                {
                    id: "transform",
                    path: implementationUrl
                }
            ]
        });
        profile.sessions[0].profile.accounting.zero_model_usage.complete =
            false;

        assert.throws(
            () => validateRunProfile(profile, "tampered profile"),
            /complete explicit execution contract/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects asynchronous transforms instead of claiming zero usage", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-deterministic-async-")
    );
    const outputPath = join(directory, "result.json");
    try {
        await assert.rejects(
            profileDeterministicJsonTransform({
                runId: "async-run",
                input: {
                    id: "input",
                    path: inputUrl
                },
                output: {
                    id: "output",
                    path: outputPath
                },
                transform: async (input) => buildCandidateResult(input),
                implementationFiles: [
                    {
                        id: "transform",
                        path: implementationUrl
                    }
                ]
            }),
            /must return synchronously/
        );
        assert.equal(existsSync(outputPath), false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("fails closed if declared implementation changes during execution", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-deterministic-drift-")
    );
    const implementationPath = join(directory, "transform.mjs");
    const outputPath = join(directory, "result.json");
    try {
        await writeFile(
            implementationPath,
            "export const transform = (value) => value;\n",
            "utf8"
        );
        await assert.rejects(
            profileDeterministicJsonTransform({
                runId: "drift-run",
                input: {
                    id: "input",
                    path: inputUrl
                },
                output: {
                    id: "output",
                    path: outputPath
                },
                transform: (input) => {
                    writeFileSync(
                        implementationPath,
                        "export const transform = () => null;\n",
                        "utf8"
                    );
                    return input;
                },
                implementationFiles: [
                    {
                        id: "transform",
                        path: implementationPath
                    }
                ]
            }),
            /changed during execution/
        );
        assert.equal(existsSync(outputPath), false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
