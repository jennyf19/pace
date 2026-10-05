import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    loadReplayManifest,
    renderReplayMarkdown,
    sha256File,
    writeReplayArtifacts
} from "../build-replay-manifest.mjs";
import { RUN_METRICS } from "../profile-run.mjs";

const DEFAULT_SESSION_RUNTIME = {
    name: "github-copilot-cli",
    version: "synthetic",
    producer: "pace-test",
    selected_model: "synthetic-model",
    context_tier: "default",
    reasoning_efforts: ["medium"]
};
const DEFAULT_RUNTIME_SIGNATURE = {
    ...DEFAULT_SESSION_RUNTIME,
    models: ["synthetic-model"]
};

const DEFAULT_TOTALS = {
    wall_time_ms: 1_000,
    api_time_ms: 500,
    input_tokens: 100,
    non_cached_input_tokens: 50,
    output_tokens: 20,
    cache_read_tokens: 40,
    cache_write_tokens: 10,
    reasoning_tokens: 5,
    tool_definition_tokens: 12,
    ai_units: 10,
    premium_requests: 1
};

function runProfile(
    runId,
    runtime = DEFAULT_SESSION_RUNTIME,
    models = [runtime.selected_model]
) {
    const sessionKey = `${runId}-primary`;
    const metricCoverage = Object.fromEntries(
        RUN_METRICS.map((metric) => [
            metric,
            metric === "wall_time_ms"
                ? {
                      value: DEFAULT_TOTALS[metric],
                      known_span_ms: DEFAULT_TOTALS[metric],
                      complete: true,
                      missing_sessions: []
                  }
                : {
                      value: DEFAULT_TOTALS[metric],
                      known_subtotal: DEFAULT_TOTALS[metric],
                      complete: true,
                      missing_sessions: []
                  }
        ])
    );
    return {
        schema_version: "0.1",
        run_id: runId,
        run_type: "manifest",
        sessions: [
            {
                session_key: sessionKey,
                role: "primary",
                billing: "independent",
                included_in: null,
                profile: {
                    run_id: `${runId}-session-evidence`,
                    runtime,
                    model_calls: models.map((model) => ({ model })),
                    stages: [],
                    accounting: {
                        model_reconciliation: {},
                        agent_reconciliation: {}
                    }
                }
            }
        ],
        stages: [],
        totals: {
            ...DEFAULT_TOTALS,
            elapsed_span_ms: DEFAULT_TOTALS.wall_time_ms
        },
        accounting: {
            contributing_sessions: [sessionKey],
            included_sessions: [],
            metric_coverage: metricCoverage
        },
        coverage: {
            evidence_level: "L2",
            missing: [],
            warnings: []
        },
        privacy: {
            identifiers: "included",
            excluded: []
        }
    };
}

async function writeReplayFixture(
    directory,
    {
        baselineProfiles = [
            runProfile("baseline-1"),
            runProfile("baseline-2")
        ],
        candidateProfiles = [
            runProfile("candidate-1"),
            runProfile("candidate-2")
        ]
    } = {}
) {
    const workloadPath = join(directory, "workload.json");
    const evaluatorPath = join(directory, "evaluator.mjs");
    const baselineConfigPath = join(directory, "baseline-config.json");
    const candidateConfigPath = join(directory, "candidate-config.json");
    await Promise.all([
        writeFile(
            workloadPath,
            JSON.stringify({ tasks: ["synthetic-task"] }),
            "utf8"
        ),
        writeFile(
            evaluatorPath,
            "export const evaluator = 'exact';\n",
            "utf8"
        ),
        writeFile(
            baselineConfigPath,
            JSON.stringify({ mode: "baseline" }),
            "utf8"
        ),
        writeFile(
            candidateConfigPath,
            JSON.stringify({ mode: "candidate" }),
            "utf8"
        )
    ]);
    const baselinePaths = [];
    const candidatePaths = [];
    for (const [index, profile] of baselineProfiles.entries()) {
        const name = `baseline-${index + 1}.json`;
        baselinePaths.push(name);
        await writeFile(join(directory, name), JSON.stringify(profile), "utf8");
    }
    for (const [index, profile] of candidateProfiles.entries()) {
        const name = `candidate-${index + 1}.json`;
        candidatePaths.push(name);
        await writeFile(join(directory, name), JSON.stringify(profile), "utf8");
    }
    const [
        workloadHash,
        evaluatorHash,
        baselineConfigHash,
        candidateConfigHash
    ] =
        await Promise.all([
            sha256File(workloadPath),
            sha256File(evaluatorPath),
            sha256File(baselineConfigPath),
            sha256File(candidateConfigPath)
        ]);
    const manifestPath = join(directory, "replay.json");
    await writeFile(
        manifestPath,
        JSON.stringify({
            schema_version: "0.1",
            replay_id: "private-replay",
            evaluator: {
                id: "private-evaluator",
                files: [
                    {
                        id: "evaluator",
                        path: "evaluator.mjs",
                        sha256: evaluatorHash.sha256
                    }
                ]
            },
            workload: {
                corpus_id: "private-corpus",
                source_revision: "private-source-revision",
                files: [
                    {
                        id: "workload",
                        path: "workload.json",
                        sha256: workloadHash.sha256
                    }
                ]
            },
            cohorts: {
                baseline: {
                    configuration: {
                        id: "private-baseline-config",
                        files: [
                            {
                                id: "configuration",
                                path: "baseline-config.json",
                                sha256: baselineConfigHash.sha256
                            }
                        ],
                        expected_runtime: [DEFAULT_RUNTIME_SIGNATURE]
                    },
                    profiles: baselinePaths
                },
                candidate: {
                    configuration: {
                        id: "private-candidate-config",
                        files: [
                            {
                                id: "configuration",
                                path: "candidate-config.json",
                                sha256: candidateConfigHash.sha256
                            }
                        ],
                        expected_runtime: [DEFAULT_RUNTIME_SIGNATURE]
                    },
                    profiles: candidatePaths
                }
            }
        }),
        "utf8"
    );
    return {
        manifestPath,
        workloadPath,
        evaluatorPath,
        baselineConfigPath,
        candidateConfigPath
    };
}

test("builds a privacy-safe replay receipt from frozen evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-replay-build-"));
    const output = await mkdtemp(join(tmpdir(), "pace-replay-output-"));
    try {
        const fixture = await writeReplayFixture(directory);
        const { receipt, baselineProfiles, candidateProfiles } =
            await loadReplayManifest(fixture.manifestPath);
        const paths = writeReplayArtifacts(receipt, output);
        const written = JSON.parse(await readFile(paths.jsonPath, "utf8"));
        const report = await readFile(paths.markdownPath, "utf8");

        assert.equal(baselineProfiles.length, 2);
        assert.equal(candidateProfiles.length, 2);
        assert.equal(receipt.invariants.frozen_file_hashes_verified, true);
        assert.match(
            receipt.workload.workload_sha256,
            /^sha256:[a-f0-9]{64}$/
        );
        assert.equal(written.replay_id, receipt.replay_id);
        assert.equal(report, renderReplayMarkdown(receipt));
        assert.doesNotMatch(JSON.stringify(written), /private-/);
        assert.doesNotMatch(JSON.stringify(written), /[A-Za-z]:\\\\/);
    } finally {
        await Promise.all([
            rm(directory, { recursive: true, force: true }),
            rm(output, { recursive: true, force: true })
        ]);
    }
});

test("rejects workload hash drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-replay-hash-"));
    try {
        const fixture = await writeReplayFixture(directory);
        await writeFile(
            fixture.workloadPath,
            JSON.stringify({ tasks: ["changed-task"] }),
            "utf8"
        );

        await assert.rejects(
            loadReplayManifest(fixture.manifestPath),
            /hash does not match/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects configuration hash drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-replay-config-hash-"));
    try {
        const fixture = await writeReplayFixture(directory);
        await writeFile(
            fixture.baselineConfigPath,
            JSON.stringify({ mode: "changed-baseline" }),
            "utf8"
        );

        await assert.rejects(
            loadReplayManifest(fixture.manifestPath),
            /hash does not match/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects runtime drift from the frozen cohort configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-replay-runtime-"));
    try {
        const fixture = await writeReplayFixture(directory, {
            candidateProfiles: [
                runProfile("candidate-1"),
                runProfile("candidate-2", {
                    ...DEFAULT_SESSION_RUNTIME,
                    selected_model: "different-model"
                })
            ]
        });

        await assert.rejects(
            loadReplayManifest(fixture.manifestPath),
            /runtime does not match the frozen configuration/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects observed fallback model drift", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-replay-model-drift-")
    );
    try {
        const fixture = await writeReplayFixture(directory, {
            candidateProfiles: [
                runProfile("candidate-1"),
                runProfile(
                    "candidate-2",
                    DEFAULT_SESSION_RUNTIME,
                    ["synthetic-model", "fallback-model"]
                )
            ]
        });

        await assert.rejects(
            loadReplayManifest(fixture.manifestPath),
            /runtime does not match the frozen configuration/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects duplicate contributing evidence across cohorts", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-replay-duplicate-evidence-")
    );
    try {
        const duplicate = runProfile("candidate-2");
        duplicate.sessions[0].profile.run_id =
            "baseline-1-session-evidence";
        const fixture = await writeReplayFixture(directory, {
            candidateProfiles: [
                runProfile("candidate-1"),
                duplicate
            ]
        });

        await assert.rejects(
            loadReplayManifest(fixture.manifestPath),
            /duplicate contributing session evidence/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
