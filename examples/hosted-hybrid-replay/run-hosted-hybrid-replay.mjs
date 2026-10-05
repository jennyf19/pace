import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import {
    dirname,
    join,
    relative,
    resolve
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    loadReplayManifest,
    sha256File,
    writeReplayArtifacts
} from "../../build-replay-manifest.mjs";
import {
    compareRepeatedRunManifest,
    writeRepeatedComparisonArtifacts
} from "../../compare-run-sets.mjs";
import {
    deterministicRuntimeSignature
} from "../../profile-deterministic-run.mjs";
import {
    buildExecutionOrder,
    hostedReplayUsage,
    parseHostedReplayArguments
} from "../../run-hosted-model-free-replay.mjs";
import {
    readCopilotVersion,
    runCopilotSample
} from "../../run-copilot-sample.mjs";
import { runHybridCompositeSample } from "../../run-hybrid-sample.mjs";
import { evaluateOutput } from "./evaluate-output.mjs";
import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "./prepare-hybrid.mjs";

const SCHEMA_VERSION = "0.1";
const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const ROOT_DIRECTORY = resolve(EXAMPLE_DIRECTORY, "..", "..");
const CORPUS_ID = "pace-hosted-hybrid-routing-corpus-v1";
const EVALUATOR_ID = "pace-exact-hybrid-routing-evaluator-v1";
const SOURCE_REVISION = "pace-hosted-hybrid-routing-v1";

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function configurationFile(id, path, output, hashes) {
    return {
        id,
        path: relative(output, path),
        sha256: hashes.get(path)
    };
}

async function runBaselineSample({
    index,
    output,
    prompt,
    inputPath,
    model,
    runtimeVersion,
    maxAiCredits,
    copilotCommand
}) {
    const sampleName = `baseline-${index + 1}`;
    const measured = await runCopilotSample({
        output,
        sampleName,
        workspaceFiles: [
            {
                path: inputPath,
                name: "baseline-input.json"
            }
        ],
        prompt,
        model,
        runtimeVersion,
        maxAiCredits,
        copilotCommand,
        sessionName: `pace-hosted-hybrid-${sampleName}`,
        runIdPrefix: "pace-hosted-hybrid"
    });
    return {
        ...measured,
        side: "baseline",
        index
    };
}

export async function runHostedHybridReplay({
    outputDirectory,
    model = "gpt-5-mini",
    samples = 3,
    maxAiCredits = 30,
    copilotCommand = process.env.COPILOT_COMMAND ?? "copilot"
}) {
    if (!Number.isInteger(samples) || samples < 2) {
        throw new Error("samples must be an integer of at least 2");
    }
    if (!Number.isInteger(maxAiCredits) || maxAiCredits < 30) {
        throw new Error("maxAiCredits must be an integer of at least 30");
    }
    const output = resolve(outputDirectory);
    try {
        await stat(output);
        throw new Error(`output directory already exists: ${output}`);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    mkdirSync(output, { recursive: true });

    const inputPath = join(EXAMPLE_DIRECTORY, "baseline-input.json");
    const expectedPath = join(EXAMPLE_DIRECTORY, "expected-result.json");
    const evaluatorPath = join(EXAMPLE_DIRECTORY, "evaluate-output.mjs");
    const baselinePromptPath = join(
        EXAMPLE_DIRECTORY,
        "baseline-prompt.txt"
    );
    const residualPromptPath = join(
        EXAMPLE_DIRECTORY,
        "residual-prompt.txt"
    );
    const implementationPath = join(
        EXAMPLE_DIRECTORY,
        "prepare-hybrid.mjs"
    );
    const [
        sourceInput,
        expected,
        baselinePrompt,
        residualPrompt,
        version
    ] = await Promise.all([
        readFile(inputPath, "utf8").then(JSON.parse),
        readFile(expectedPath, "utf8").then(JSON.parse),
        readFile(baselinePromptPath, "utf8"),
        readFile(residualPromptPath, "utf8"),
        readCopilotVersion(copilotCommand, EXAMPLE_DIRECTORY)
    ]);

    const baselineRuntimeSignature = {
        name: "github-copilot-cli",
        version,
        producer: "copilot-agent",
        selected_model: model,
        context_tier: "default",
        reasoning_efforts: ["medium"],
        models: [model]
    };
    const deterministicSignature = deterministicRuntimeSignature();
    const executionOrder = buildExecutionOrder(samples);
    const baselineConfigPath = join(output, "baseline-config.json");
    const candidateConfigPath = join(output, "candidate-config.json");
    writeJson(baselineConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "hybrid-semantic-residual-v1",
        model,
        copilot_cli_version: version,
        tool_allowlist: ["view"],
        input: "baseline-input.json",
        prompt: "baseline-prompt.txt",
        execution_order: executionOrder.map((entry) => entry.sample)
    });
    writeJson(candidateConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "hybrid-semantic-residual-v1",
        runtimes: [
            deterministicSignature,
            baselineRuntimeSignature
        ],
        input: "baseline-input.json",
        preprocess: "prepare-hybrid.mjs",
        residual_prompt: "residual-prompt.txt",
        merge: "prepare-hybrid.mjs",
        compose: "compose-run-profiles.mjs",
        execution_order: executionOrder.map((entry) => entry.sample)
    });

    const baselineRuns = new Array(samples);
    const candidateRuns = new Array(samples);
    for (const entry of executionOrder) {
        const run =
            entry.side === "baseline"
                ? await runBaselineSample({
                      index: entry.index,
                      output,
                      prompt: baselinePrompt,
                      inputPath,
                      model,
                      runtimeVersion: version,
                      maxAiCredits,
                      copilotCommand
                  })
                : await runHybridCompositeSample({
                      side: "candidate",
                      index: entry.index,
                      output,
                      sourceInput,
                      inputPath,
                      implementationPath,
                      residualPrompt,
                      residualMode: "file-view",
                      inlinePromptTemplate: null,
                      preprocessTransform: buildResidualInput,
                      mergeTransform: buildHybridResultFromMergeInput,
                      model,
                      runtimeVersion: version,
                      maxAiCredits,
                      copilotCommand,
                      experimentPrefix: "pace-hosted-hybrid"
                  });
        if (entry.side === "baseline") {
            baselineRuns[entry.index] = run;
        } else {
            candidateRuns[entry.index] = run;
        }
    }

    const qualityForRun = (run) => {
        const evaluation = evaluateOutput(expected, run.stdout);
        return {
            entry: {
                run_id: run.runProfile.run_id,
                run_profile_sha256: run.runProfileSha256,
                corpus_id: CORPUS_ID,
                evaluator_id: EVALUATOR_ID,
                complete: evaluation.complete,
                passed: evaluation.passed,
                score: evaluation.score
            },
            evaluation
        };
    };
    const baselineQuality = baselineRuns.map(qualityForRun);
    const candidateQuality = candidateRuns.map(qualityForRun);
    const qualityPath = join(output, "quality.json");
    writeJson(qualityPath, {
        schema_version: SCHEMA_VERSION,
        baseline: baselineQuality.map((result) => result.entry),
        candidate: candidateQuality.map((result) => result.entry),
        regressions: [
            ...new Set(
                candidateQuality.flatMap(
                    (result) => result.evaluation.issues ?? []
                )
            )
        ],
        lost_findings: [
            ...new Set(
                candidateQuality.flatMap(
                    (result) => result.evaluation.lost_findings ?? []
                )
            )
        ]
    });

    const copilotHelperPath = join(ROOT_DIRECTORY, "run-copilot-sample.mjs");
    const compositeRunnerPath = join(
        ROOT_DIRECTORY,
        "compose-run-profiles.mjs"
    );
    const deterministicRunnerPath = join(
        ROOT_DIRECTORY,
        "profile-deterministic-run.mjs"
    );
    const hybridSamplePath = join(ROOT_DIRECTORY, "run-hybrid-sample.mjs");
    const frozenFiles = [
        inputPath,
        expectedPath,
        evaluatorPath,
        baselinePromptPath,
        residualPromptPath,
        implementationPath,
        RUNNER_PATH,
        copilotHelperPath,
        compositeRunnerPath,
        deterministicRunnerPath,
        hybridSamplePath,
        baselineConfigPath,
        candidateConfigPath
    ];
    const hashes = new Map(
        await Promise.all(
            frozenFiles.map(async (path) => [
                path,
                (await sha256File(path)).sha256
            ])
        )
    );
    const replayPath = join(output, "replay.json");
    writeJson(replayPath, {
        schema_version: SCHEMA_VERSION,
        replay_id: "pace-hosted-hybrid-routing-replay-v1",
        evaluator: {
            id: EVALUATOR_ID,
            files: [
                configurationFile(
                    "evaluator",
                    evaluatorPath,
                    output,
                    hashes
                )
            ]
        },
        workload: {
            corpus_id: CORPUS_ID,
            source_revision: SOURCE_REVISION,
            files: [
                configurationFile(
                    "baseline-input",
                    inputPath,
                    output,
                    hashes
                ),
                configurationFile(
                    "expected-result",
                    expectedPath,
                    output,
                    hashes
                )
            ]
        },
        cohorts: {
            baseline: {
                configuration: {
                    id: "pace-hosted-hybrid-baseline-v1",
                    files: [
                        configurationFile(
                            "configuration",
                            baselineConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "prompt",
                            baselinePromptPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "orchestrator",
                            RUNNER_PATH,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "copilot-helper",
                            copilotHelperPath,
                            output,
                            hashes
                        )
                    ],
                    expected_runtime: [baselineRuntimeSignature]
                },
                profiles: baselineRuns.map((run) =>
                    relative(output, run.runPaths.jsonPath)
                )
            },
            candidate: {
                configuration: {
                    id: "pace-hosted-hybrid-candidate-v1",
                    files: [
                        configurationFile(
                            "configuration",
                            candidateConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "residual-prompt",
                            residualPromptPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "implementation",
                            implementationPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "orchestrator",
                            RUNNER_PATH,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "copilot-helper",
                            copilotHelperPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "composite-runner",
                            compositeRunnerPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "deterministic-runner",
                            deterministicRunnerPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "hybrid-sample-runner",
                            hybridSamplePath,
                            output,
                            hashes
                        )
                    ],
                    expected_runtime: [
                        baselineRuntimeSignature,
                        deterministicSignature
                    ]
                },
                profiles: candidateRuns.map((run) =>
                    relative(output, run.runPaths.jsonPath)
                )
            }
        }
    });
    const replay = await loadReplayManifest(replayPath);
    const replayPaths = writeReplayArtifacts(
        replay.receipt,
        join(output, "receipts")
    );
    const comparisonPath = join(output, "comparison.json");
    writeJson(comparisonPath, {
        schema_version: SCHEMA_VERSION,
        comparison_id: "pace-hosted-hybrid-routing-comparison-v1",
        replay_manifest: "replay.json",
        quality_result: "quality.json",
        decision_metrics: [
            {
                metric: "ai_units",
                statistic: "p50",
                goal: "decrease"
            },
            {
                metric: "input_tokens",
                statistic: "p50",
                goal: "decrease"
            },
            {
                metric: "wall_time_ms",
                statistic: "p90",
                goal: "not_increase"
            }
        ]
    });
    const comparison = await compareRepeatedRunManifest(comparisonPath);
    const comparisonPaths = writeRepeatedComparisonArtifacts(
        comparison,
        join(output, "receipts")
    );
    return {
        comparison,
        replay: replay.receipt,
        quality: {
            baseline: baselineQuality,
            candidate: candidateQuality
        },
        paths: {
            replay: replayPaths.jsonPath,
            comparison: comparisonPaths.jsonPath,
            comparisonReport: comparisonPaths.markdownPath
        }
    };
}

async function main() {
    try {
        const args = parseHostedReplayArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(
                `${hostedReplayUsage("run-hosted-hybrid-replay.mjs")}\n`
            );
            return;
        }
        const result = await runHostedHybridReplay({
            outputDirectory: args.output,
            model: args.model,
            samples: args.samples,
            maxAiCredits: args.maxAiCredits
        });
        process.stdout.write(
            `${result.comparison.disposition}\n${result.paths.replay}\n${result.paths.comparison}\n${result.paths.comparisonReport}\n`
        );
    } catch (error) {
        process.stderr.write(`hosted hybrid replay failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
