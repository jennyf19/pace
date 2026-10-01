import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    compareRepeatedRunManifest,
    renderRepeatedComparisonMarkdown,
    writeRepeatedComparisonArtifacts
} from "../compare-run-sets.mjs";
import { sha256File } from "../build-replay-manifest.mjs";
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
    ai_units: 10,
    premium_requests: 1
};

function runProfile(
    runId,
    {
        totals: totalOverrides = {},
        coverage: coverageOverrides = {},
        residuals = []
    } = {}
) {
    const totals = {
        ...DEFAULT_TOTALS,
        ...totalOverrides
    };
    const sessionKey = `${runId}-primary`;
    const metricCoverage = Object.fromEntries(
        RUN_METRICS.map((metric) => {
            const override = coverageOverrides[metric] ?? {};
            const complete = override.complete ?? totals[metric] !== null;
            const knownSubtotal =
                override.known_subtotal ??
                (totals[metric] === null ? null : totals[metric]);
            return [
                metric,
                metric === "wall_time_ms"
                    ? {
                          value: totals[metric],
                          known_span_ms: knownSubtotal,
                          complete,
                          missing_sessions: override.missing_sessions ?? []
                      }
                    : {
                          value: totals[metric],
                          known_subtotal: knownSubtotal,
                          complete,
                          missing_sessions: override.missing_sessions ?? []
                      }
            ];
        })
    );
    const reconciliation = {};
    for (const residual of residuals) {
        reconciliation[residual.metric] = {
            total: residual.total,
            attributed: residual.attributed,
            difference: residual.total - residual.attributed,
            reconciled: false
        };
    }
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
                    runtime: DEFAULT_SESSION_RUNTIME,
                    model_calls: [
                        {
                            model: DEFAULT_SESSION_RUNTIME.selected_model
                        }
                    ],
                    stages: [],
                    accounting: {
                        model_reconciliation: reconciliation,
                        agent_reconciliation: {}
                    }
                }
            }
        ],
        stages: [],
        totals: {
            ...totals,
            elapsed_span_ms: totals.wall_time_ms
        },
        accounting: {
            contributing_sessions: [sessionKey],
            included_sessions: [],
            metric_coverage: metricCoverage
        },
        coverage: {
            evidence_level: "L2",
            missing: Object.entries(metricCoverage)
                .filter(([, coverage]) => !coverage.complete)
                .map(([metric]) => `${metric} is incomplete`),
            warnings: []
        },
        privacy: {
            identifiers: "included",
            excluded: []
        }
    };
}

function qualityEntry(runId, overrides = {}) {
    return {
        run_id: runId,
        corpus_id: "private-corpus",
        evaluator_id: "private-evaluator",
        complete: true,
        passed: true,
        score: 1,
        ...overrides
    };
}

async function writeInputs(
    directory,
    {
        baselineProfiles,
        candidateProfiles,
        qualityOverrides = {},
        decisionMetrics = [
            { metric: "ai_units", statistic: "p50", goal: "decrease" },
            {
                metric: "wall_time_ms",
                statistic: "p90",
                goal: "not_increase"
            }
        ]
    }
) {
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
    const [baselineProfileHashes, candidateProfileHashes] = await Promise.all([
        Promise.all(
            baselinePaths.map((path) => sha256File(join(directory, path)))
        ),
        Promise.all(
            candidatePaths.map((path) => sha256File(join(directory, path)))
        )
    ]);
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
    await writeFile(
        join(directory, "replay.json"),
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
    const defaultBaselineQuality = baselineProfiles.map((profile, index) =>
        qualityEntry(profile.run_id, {
            run_profile_sha256: baselineProfileHashes[index].sha256
        })
    );
    const defaultCandidateQuality = candidateProfiles.map((profile, index) =>
        qualityEntry(profile.run_id, {
            run_profile_sha256: candidateProfileHashes[index].sha256
        })
    );
    const quality = {
        schema_version: "0.1",
        baseline: defaultBaselineQuality,
        candidate: defaultCandidateQuality,
        regressions: [],
        lost_findings: [],
        ...qualityOverrides
    };
    quality.baseline = quality.baseline.map((entry, index) => ({
        ...entry,
        run_profile_sha256:
            entry.run_profile_sha256 ??
            baselineProfileHashes[index]?.sha256
    }));
    quality.candidate = quality.candidate.map((entry, index) => ({
        ...entry,
        run_profile_sha256:
            entry.run_profile_sha256 ??
            candidateProfileHashes[index]?.sha256
    }));
    await writeFile(
        join(directory, "quality.json"),
        JSON.stringify(quality),
        "utf8"
    );
    const manifestPath = join(directory, "comparison.json");
    await writeFile(
        manifestPath,
        JSON.stringify({
            schema_version: "0.1",
            comparison_id: "private-repeated-comparison",
            replay_manifest: "replay.json",
            quality_result: "quality.json",
            decision_metrics: decisionMetrics
        }),
        "utf8"
    );
    return manifestPath;
}

test("keeps a repeated-run p50 and p90 improvement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-repeated-keep-"));
    try {
        const baselineProfiles = [
            runProfile("baseline-1", {
                totals: { ai_units: 10, wall_time_ms: 1_000 }
            }),
            runProfile("baseline-2", {
                totals: { ai_units: 12, wall_time_ms: 1_200 }
            }),
            runProfile("baseline-3", {
                totals: { ai_units: 14, wall_time_ms: 3_000 }
            })
        ];
        const candidateProfiles = [
            runProfile("candidate-1", {
                totals: { ai_units: 6, wall_time_ms: 900 }
            }),
            runProfile("candidate-2", {
                totals: { ai_units: 7, wall_time_ms: 1_000 }
            }),
            runProfile("candidate-3", {
                totals: { ai_units: 8, wall_time_ms: 1_500 }
            })
        ];
        const manifestPath = await writeInputs(directory, {
            baselineProfiles,
            candidateProfiles
        });
        const comparison = await compareRepeatedRunManifest(manifestPath, {
            includeIdentifiers: true
        });

        assert.equal(comparison.disposition, "keep");
        assert.equal(comparison.metrics.ai_units.baseline.distribution.p50, 12);
        assert.equal(comparison.metrics.ai_units.candidate.distribution.p50, 7);
        assert.equal(
            comparison.metrics.wall_time_ms.baseline.distribution.p90,
            2_640
        );
        assert.equal(
            comparison.metrics.wall_time_ms.candidate.distribution.p90,
            1_400
        );
        assert.equal(comparison.decision.gates.quality, "passed");
        assert.equal(comparison.decision.gates.accounting, "passed");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("does not average away an incomplete selected sample", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-repeated-missing-"));
    try {
        const baselineProfiles = [
            runProfile("baseline-1"),
            runProfile("baseline-2"),
            runProfile("baseline-3")
        ];
        const candidateProfiles = [
            runProfile("candidate-1", { totals: { ai_units: 6 } }),
            runProfile("candidate-2", { totals: { ai_units: 7 } }),
            runProfile("candidate-3", {
                totals: { ai_units: null },
                coverage: {
                    ai_units: {
                        complete: false,
                        known_subtotal: 5,
                        missing_sessions: ["candidate-hidden"]
                    }
                }
            })
        ];
        const manifestPath = await writeInputs(directory, {
            baselineProfiles,
            candidateProfiles,
            decisionMetrics: [
                { metric: "ai_units", statistic: "p50", goal: "decrease" }
            ]
        });
        const comparison = await compareRepeatedRunManifest(manifestPath, {
            includeIdentifiers: true
        });

        assert.equal(comparison.disposition, "unproven");
        assert.equal(comparison.metrics.ai_units.candidate.distribution, null);
        assert.equal(
            comparison.metrics.ai_units.candidate.observed_distribution.count,
            2
        );
        assert.equal(
            comparison.metrics.ai_units.candidate.samples[2].known_subtotal,
            5
        );
        assert.deepEqual(
            comparison.metrics.ai_units.candidate.missing_runs,
            ["candidate-3"]
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects repeated quality regressions and identity mismatches", async () => {
    const rejectedDirectory = await mkdtemp(
        join(tmpdir(), "pace-repeated-reject-")
    );
    const identityDirectory = await mkdtemp(
        join(tmpdir(), "pace-repeated-identity-")
    );
    try {
        const baselineProfiles = [
            runProfile("baseline-1"),
            runProfile("baseline-2")
        ];
        const candidateProfiles = [
            runProfile("candidate-1", { totals: { ai_units: 5 } }),
            runProfile("candidate-2", { totals: { ai_units: 6 } })
        ];
        const rejectedManifest = await writeInputs(rejectedDirectory, {
            baselineProfiles,
            candidateProfiles,
            qualityOverrides: {
                candidate: [
                    qualityEntry("candidate-1"),
                    qualityEntry("candidate-2", {
                        passed: false,
                        score: 0
                    })
                ],
                regressions: ["private-regression"]
            }
        });
        const rejected = await compareRepeatedRunManifest(rejectedManifest, {
            includeIdentifiers: true
        });
        assert.equal(rejected.disposition, "reject");

        const identityManifest = await writeInputs(identityDirectory, {
            baselineProfiles,
            candidateProfiles,
            qualityOverrides: {
                candidate: [
                    qualityEntry("candidate-1"),
                    qualityEntry("candidate-2", {
                        evaluator_id: "other-evaluator"
                    })
                ]
            }
        });
        await assert.rejects(
            compareRepeatedRunManifest(identityManifest),
            /same evaluator identity/
        );

        const otherEvaluatorQuality = JSON.parse(
            await readFile(
                join(identityDirectory, "quality.json"),
                "utf8"
            )
        );
        otherEvaluatorQuality.baseline =
            otherEvaluatorQuality.baseline.map((entry) => ({
                ...entry,
                evaluator_id: "other-evaluator"
            }));
        otherEvaluatorQuality.candidate =
            otherEvaluatorQuality.candidate.map((entry) => ({
                ...entry,
                evaluator_id: "other-evaluator"
            }));
        await writeFile(
            join(identityDirectory, "quality.json"),
            JSON.stringify(otherEvaluatorQuality),
            "utf8"
        );
        await assert.rejects(
            compareRepeatedRunManifest(identityManifest),
            /does not match the replay manifest/
        );

        const profileHashMismatch = JSON.parse(
            await readFile(
                join(identityDirectory, "quality.json"),
                "utf8"
            )
        );
        profileHashMismatch.baseline[0].evaluator_id =
            "private-evaluator";
        profileHashMismatch.baseline[1].evaluator_id =
            "private-evaluator";
        profileHashMismatch.candidate[0].evaluator_id =
            "private-evaluator";
        profileHashMismatch.candidate[1].evaluator_id =
            "private-evaluator";
        profileHashMismatch.baseline[0].run_profile_sha256 =
            `sha256:${"0".repeat(64)}`;
        await writeFile(
            join(identityDirectory, "quality.json"),
            JSON.stringify(profileHashMismatch),
            "utf8"
        );
        await assert.rejects(
            compareRepeatedRunManifest(identityManifest),
            /run_profile_sha256 does not match/
        );
    } finally {
        await Promise.all([
            rm(rejectedDirectory, { recursive: true, force: true }),
            rm(identityDirectory, { recursive: true, force: true })
        ]);
    }
});

test("blocks keep on selected residuals and unequal sample counts", async () => {
    const residualDirectory = await mkdtemp(
        join(tmpdir(), "pace-repeated-residual-")
    );
    const countDirectory = await mkdtemp(
        join(tmpdir(), "pace-repeated-count-")
    );
    try {
        const baselineProfiles = [
            runProfile("baseline-1", {
                residuals: [
                    {
                        metric: "ai_units",
                        total: 10,
                        attributed: 9
                    }
                ]
            }),
            runProfile("baseline-2")
        ];
        const candidateProfiles = [
            runProfile("candidate-1", { totals: { ai_units: 5 } }),
            runProfile("candidate-2", { totals: { ai_units: 6 } })
        ];
        const residualManifest = await writeInputs(residualDirectory, {
            baselineProfiles,
            candidateProfiles,
            decisionMetrics: [
                { metric: "ai_units", statistic: "p50", goal: "decrease" }
            ]
        });
        const residualComparison = await compareRepeatedRunManifest(
            residualManifest,
            { includeIdentifiers: true }
        );
        assert.equal(residualComparison.disposition, "unproven");
        assert.equal(
            residualComparison.accounting.blocking_residuals.length,
            1
        );

        const countManifest = await writeInputs(countDirectory, {
            baselineProfiles: [
                ...baselineProfiles,
                runProfile("baseline-3")
            ],
            candidateProfiles
        });
        await assert.rejects(
            compareRepeatedRunManifest(countManifest),
            /sample counts must match/
        );
    } finally {
        await Promise.all([
            rm(residualDirectory, { recursive: true, force: true }),
            rm(countDirectory, { recursive: true, force: true })
        ]);
    }
});

test("rejects duplicate contributing evidence with relabeled run IDs", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-repeated-duplicate-evidence-")
    );
    try {
        const baselineProfiles = [
            runProfile("baseline-1"),
            runProfile("baseline-2")
        ];
        const candidateProfiles = [
            runProfile("candidate-1", { totals: { ai_units: 5 } }),
            runProfile("candidate-2", { totals: { ai_units: 6 } })
        ];
        candidateProfiles[1].sessions[0].profile.run_id =
            candidateProfiles[0].sessions[0].profile.run_id;
        const manifestPath = await writeInputs(directory, {
            baselineProfiles,
            candidateProfiles
        });

        await assert.rejects(
            compareRepeatedRunManifest(manifestPath),
            /duplicate contributing session evidence/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("writes privacy-safe repeated comparison artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-repeated-write-"));
    const output = await mkdtemp(join(tmpdir(), "pace-repeated-output-"));
    try {
        const baselineProfiles = [
            runProfile("private-baseline-1"),
            runProfile("private-baseline-2")
        ];
        const candidateProfiles = [
            runProfile("private-candidate-1", {
                totals: { ai_units: 5 }
            }),
            runProfile("private-candidate-2", {
                totals: { ai_units: 6 }
            })
        ];
        const manifestPath = await writeInputs(directory, {
            baselineProfiles,
            candidateProfiles,
            decisionMetrics: [
                { metric: "ai_units", statistic: "p50", goal: "decrease" }
            ]
        });
        const comparison = await compareRepeatedRunManifest(manifestPath);
        const paths = writeRepeatedComparisonArtifacts(comparison, output);
        const written = JSON.parse(await readFile(paths.jsonPath, "utf8"));
        const report = await readFile(paths.markdownPath, "utf8");

        assert.equal(written.disposition, "keep");
        assert.equal(report, renderRepeatedComparisonMarkdown(comparison));
        assert.match(report, /# Pace repeated-run comparison/);
        assert.match(report, /## Replay binding/);
        assert.doesNotMatch(JSON.stringify(written), /private-/);
        assert.doesNotMatch(report, /private-/);
    } finally {
        await Promise.all([
            rm(directory, { recursive: true, force: true }),
            rm(output, { recursive: true, force: true })
        ]);
    }
});
