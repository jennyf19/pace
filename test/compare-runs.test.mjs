import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    compareRunManifest,
    renderComparisonMarkdown,
    writeComparisonArtifacts
} from "../compare-runs.mjs";
import { RUN_METRICS } from "../profile-run.mjs";

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

function qualityResult(
    baselineRunId,
    candidateRunId,
    {
        baseline = {},
        candidate = {},
        regressions = [],
        lostFindings = []
    } = {}
) {
    return {
        schema_version: "0.1",
        baseline: {
            run_id: baselineRunId,
            corpus_id: "private-corpus",
            evaluator_id: "private-evaluator",
            complete: true,
            passed: true,
            score: 1,
            ...baseline
        },
        candidate: {
            run_id: candidateRunId,
            corpus_id: "private-corpus",
            evaluator_id: "private-evaluator",
            complete: true,
            passed: true,
            score: 1,
            ...candidate
        },
        regressions,
        lost_findings: lostFindings
    };
}

async function fileSha256(path) {
    return `sha256:${createHash("sha256")
        .update(await readFile(path))
        .digest("hex")}`;
}

async function bindQualityHashes(quality, baselinePath, candidatePath) {
    const [baselineHash, candidateHash] = await Promise.all([
        fileSha256(baselinePath),
        fileSha256(candidatePath)
    ]);
    return {
        ...quality,
        baseline: {
            ...quality.baseline,
            run_profile_sha256: baselineHash
        },
        candidate: {
            ...quality.candidate,
            run_profile_sha256: candidateHash
        }
    };
}

async function writeInputs(
    directory,
    {
        baselineProfile,
        candidateProfile,
        quality,
        decisionMetrics = [
            { metric: "ai_units", goal: "decrease" },
            { metric: "wall_time_ms", goal: "not_increase" }
        ]
    }
) {
    const baselinePath = join(directory, "baseline.run-profile.json");
    const candidatePath = join(directory, "candidate.run-profile.json");
    const qualityPath = join(directory, "quality.json");
    const manifestPath = join(directory, "comparison.json");
    await Promise.all([
        writeFile(
            baselinePath,
            JSON.stringify(baselineProfile),
            "utf8"
        ),
        writeFile(
            candidatePath,
            JSON.stringify(candidateProfile),
            "utf8"
        )
    ]);
    await writeFile(
        qualityPath,
        JSON.stringify(
            await bindQualityHashes(quality, baselinePath, candidatePath)
        ),
        "utf8"
    );
    await writeFile(
        manifestPath,
        JSON.stringify({
            schema_version: "0.1",
            comparison_id: "private-comparison",
            baseline_profile: "baseline.run-profile.json",
            candidate_profile: "candidate.run-profile.json",
            quality_result: "quality.json",
            decision_metrics: decisionMetrics
        }),
        "utf8"
    );
    return manifestPath;
}

test("keeps a scoped measured improvement with matched quality evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compare-keep-"));
    try {
        const baseline = runProfile("baseline-run", {
            residuals: [
                {
                    metric: "api_time_ms",
                    total: 500,
                    attributed: 450
                }
            ]
        });
        const candidate = runProfile("candidate-run", {
            totals: {
                wall_time_ms: 900,
                api_time_ms: null,
                ai_units: 6
            },
            coverage: {
                api_time_ms: {
                    complete: false,
                    known_subtotal: 400,
                    missing_sessions: ["candidate-hidden"]
                }
            }
        });
        const manifestPath = await writeInputs(directory, {
            baselineProfile: baseline,
            candidateProfile: candidate,
            quality: qualityResult("baseline-run", "candidate-run")
        });
        const comparison = await compareRunManifest(manifestPath, {
            includeIdentifiers: true
        });

        assert.equal(comparison.disposition, "keep");
        assert.equal(comparison.decision.gates.quality, "passed");
        assert.equal(comparison.decision.gates.accounting, "passed");
        assert.equal(comparison.metrics.ai_units.absolute_delta, -4);
        assert.equal(comparison.metrics.ai_units.percent_delta, -40);
        assert.equal(comparison.metrics.api_time_ms.complete, false);
        assert.equal(
            comparison.metrics.api_time_ms.candidate.known_subtotal,
            400
        );
        assert.equal(comparison.accounting.residuals.baseline.length, 1);
        assert.equal(comparison.accounting.blocking_residuals.length, 0);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects mismatched run, corpus, or evaluator identities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compare-identity-"));
    try {
        const manifestPath = await writeInputs(directory, {
            baselineProfile: runProfile("baseline-run"),
            candidateProfile: runProfile("candidate-run", {
                totals: { ai_units: 5 }
            }),
            quality: qualityResult("baseline-run", "candidate-run", {
                candidate: {
                    evaluator_id: "different-evaluator"
                }
            })
        });

        await assert.rejects(
            compareRunManifest(manifestPath),
            /same evaluator identity/
        );

        await writeFile(
            join(directory, "quality.json"),
            JSON.stringify(
                await bindQualityHashes(
                    qualityResult("baseline-run", "candidate-run", {
                        candidate: {
                            corpus_id: "different-corpus"
                        }
                    }),
                    join(directory, "baseline.run-profile.json"),
                    join(directory, "candidate.run-profile.json")
                )
            ),
            "utf8"
        );
        await assert.rejects(
            compareRunManifest(manifestPath),
            /same corpus identity/
        );

        await writeFile(
            join(directory, "quality.json"),
            JSON.stringify(
                await bindQualityHashes(
                    qualityResult("wrong-baseline", "candidate-run"),
                    join(directory, "baseline.run-profile.json"),
                    join(directory, "candidate.run-profile.json")
                )
            ),
            "utf8"
        );
        await assert.rejects(
            compareRunManifest(manifestPath),
            /baseline run_id does not match/
        );

        const profileHashMismatch = await bindQualityHashes(
            qualityResult("baseline-run", "candidate-run"),
            join(directory, "baseline.run-profile.json"),
            join(directory, "candidate.run-profile.json")
        );
        profileHashMismatch.candidate.run_profile_sha256 =
            `sha256:${"0".repeat(64)}`;
        await writeFile(
            join(directory, "quality.json"),
            JSON.stringify(profileHashMismatch),
            "utf8"
        );
        await assert.rejects(
            compareRunManifest(manifestPath),
            /candidate run_profile_sha256 does not match/
        );

        const sharedEvidenceCandidate = runProfile("candidate-run", {
            totals: { ai_units: 5 }
        });
        sharedEvidenceCandidate.sessions[0].profile.run_id =
            runProfile("baseline-run").sessions[0].profile.run_id;
        await writeFile(
            join(directory, "candidate.run-profile.json"),
            JSON.stringify(sharedEvidenceCandidate),
            "utf8"
        );
        await writeFile(
            join(directory, "quality.json"),
            JSON.stringify(
                await bindQualityHashes(
                    qualityResult("baseline-run", "candidate-run"),
                    join(directory, "baseline.run-profile.json"),
                    join(directory, "candidate.run-profile.json")
                )
            ),
            "utf8"
        );
        await assert.rejects(
            compareRunManifest(manifestPath),
            /share contributing session evidence/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("preserves incomplete decision coverage and refuses keep", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compare-missing-"));
    try {
        const manifestPath = await writeInputs(directory, {
            baselineProfile: runProfile("baseline-run"),
            candidateProfile: runProfile("candidate-run", {
                totals: { ai_units: null },
                coverage: {
                    ai_units: {
                        complete: false,
                        known_subtotal: 6,
                        missing_sessions: ["candidate-classification"]
                    }
                }
            }),
            quality: qualityResult("baseline-run", "candidate-run")
        });
        const comparison = await compareRunManifest(manifestPath, {
            includeIdentifiers: true
        });

        assert.equal(comparison.disposition, "unproven");
        assert.equal(comparison.decision.gates.accounting, "incomplete");
        assert.equal(comparison.metrics.ai_units.absolute_delta, null);
        assert.equal(
            comparison.metrics.ai_units.candidate.known_subtotal,
            6
        );
        assert.deepEqual(
            comparison.metrics.ai_units.candidate.missing_sessions,
            ["candidate-classification"]
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("preserves selected accounting residuals and refuses keep", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compare-residual-"));
    try {
        const manifestPath = await writeInputs(directory, {
            baselineProfile: runProfile("baseline-run", {
                residuals: [
                    {
                        metric: "ai_units",
                        total: 10,
                        attributed: 9
                    }
                ]
            }),
            candidateProfile: runProfile("candidate-run", {
                totals: { ai_units: 5 }
            }),
            quality: qualityResult("baseline-run", "candidate-run")
        });
        const comparison = await compareRunManifest(manifestPath, {
            includeIdentifiers: true
        });

        assert.equal(comparison.disposition, "unproven");
        assert.equal(comparison.accounting.blocking_residuals.length, 1);
        assert.equal(
            comparison.accounting.blocking_residuals[0].difference,
            1
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects a known quality regression and leaves incomplete quality unproven", async () => {
    const rejectedDirectory = await mkdtemp(
        join(tmpdir(), "pace-compare-reject-")
    );
    const unprovenDirectory = await mkdtemp(
        join(tmpdir(), "pace-compare-quality-missing-")
    );
    try {
        const baseline = runProfile("baseline-run");
        const candidate = runProfile("candidate-run", {
            totals: { ai_units: 5 }
        });
        const rejectedManifest = await writeInputs(rejectedDirectory, {
            baselineProfile: baseline,
            candidateProfile: candidate,
            quality: qualityResult("baseline-run", "candidate-run", {
                regressions: ["private-regression"]
            })
        });
        const rejected = await compareRunManifest(rejectedManifest, {
            includeIdentifiers: true
        });
        assert.equal(rejected.disposition, "reject");
        assert.equal(rejected.decision.gates.quality, "failed");

        const unprovenManifest = await writeInputs(unprovenDirectory, {
            baselineProfile: baseline,
            candidateProfile: candidate,
            quality: qualityResult("baseline-run", "candidate-run", {
                candidate: {
                    complete: false,
                    passed: null,
                    score: null
                }
            })
        });
        const unproven = await compareRunManifest(unprovenManifest, {
            includeIdentifiers: true
        });
        assert.equal(unproven.disposition, "unproven");
        assert.equal(unproven.decision.gates.quality, "incomplete");
    } finally {
        await Promise.all([
            rm(rejectedDirectory, { recursive: true, force: true }),
            rm(unprovenDirectory, { recursive: true, force: true })
        ]);
    }
});

test("returns revise when a complete candidate has no measured win", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compare-revise-"));
    try {
        const manifestPath = await writeInputs(directory, {
            baselineProfile: runProfile("baseline-run"),
            candidateProfile: runProfile("candidate-run"),
            quality: qualityResult("baseline-run", "candidate-run"),
            decisionMetrics: [
                { metric: "ai_units", goal: "not_increase" },
                { metric: "wall_time_ms", goal: "not_increase" }
            ]
        });
        const comparison = await compareRunManifest(manifestPath, {
            includeIdentifiers: true
        });

        assert.equal(comparison.disposition, "revise");
        assert.equal(
            comparison.decision.gates.performance,
            "no_measured_improvement"
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("keeps zero-baseline percentages distinct from exact single-run changes", async () => {
    const zeroDirectory = await mkdtemp(
        join(tmpdir(), "pace-compare-zero-baseline-")
    );
    const noiseDirectory = await mkdtemp(
        join(tmpdir(), "pace-compare-exact-change-")
    );
    try {
        const zeroManifest = await writeInputs(zeroDirectory, {
            baselineProfile: runProfile("baseline-run", {
                totals: { ai_units: 0 }
            }),
            candidateProfile: runProfile("candidate-run", {
                totals: { ai_units: 1 }
            }),
            quality: qualityResult("baseline-run", "candidate-run"),
            decisionMetrics: [
                { metric: "ai_units", goal: "not_increase" }
            ]
        });
        const zeroComparison = await compareRunManifest(zeroManifest, {
            includeIdentifiers: true
        });

        assert.equal(zeroComparison.disposition, "revise");
        assert.equal(zeroComparison.metrics.ai_units.absolute_delta, 1);
        assert.equal(zeroComparison.metrics.ai_units.percent_delta, null);
        assert.equal(
            zeroComparison.metrics.ai_units.percent_delta_status,
            "zero_baseline"
        );
        assert.match(
            renderComparisonMarkdown(zeroComparison),
            /n\/a \(zero baseline\)/
        );

        const noiseManifest = await writeInputs(noiseDirectory, {
            baselineProfile: runProfile("baseline-run"),
            candidateProfile: runProfile("candidate-run", {
                totals: { wall_time_ms: 1_001 }
            }),
            quality: qualityResult("baseline-run", "candidate-run"),
            decisionMetrics: [
                { metric: "wall_time_ms", goal: "not_increase" }
            ]
        });
        const noiseComparison = await compareRunManifest(noiseManifest, {
            includeIdentifiers: true
        });

        assert.equal(noiseComparison.disposition, "revise");
        assert.equal(
            noiseComparison.metrics.wall_time_ms.percent_delta,
            0.1
        );
    } finally {
        await Promise.all([
            rm(zeroDirectory, { recursive: true, force: true }),
            rm(noiseDirectory, { recursive: true, force: true })
        ]);
    }
});

test("writes privacy-safe comparison JSON and Markdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-compare-write-"));
    const output = await mkdtemp(join(tmpdir(), "pace-compare-output-"));
    try {
        const manifestPath = await writeInputs(directory, {
            baselineProfile: runProfile("private-baseline"),
            candidateProfile: runProfile("private-candidate", {
                totals: { ai_units: 5 }
            }),
            quality: qualityResult("private-baseline", "private-candidate")
        });
        const comparison = await compareRunManifest(manifestPath);
        const paths = writeComparisonArtifacts(comparison, output);
        const written = JSON.parse(await readFile(paths.jsonPath, "utf8"));
        const report = await readFile(paths.markdownPath, "utf8");

        assert.equal(written.disposition, "keep");
        assert.equal(report, renderComparisonMarkdown(comparison));
        assert.match(report, /# Pace run comparison/);
        assert.doesNotMatch(JSON.stringify(written), /private-/);
        assert.doesNotMatch(report, /private-/);
    } finally {
        await Promise.all([
            rm(directory, { recursive: true, force: true }),
            rm(output, { recursive: true, force: true })
        ]);
    }
});
