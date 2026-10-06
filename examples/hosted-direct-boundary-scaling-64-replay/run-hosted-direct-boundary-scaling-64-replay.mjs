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
import { deterministicRuntimeSignature } from "../../profile-deterministic-run.mjs";
import {
    buildExecutionOrder,
    hostedReplayUsage,
    parseHostedReplayArguments
} from "../../run-hosted-model-free-replay.mjs";
import {
    NO_TOOLS_SENTINEL,
    readCopilotVersion
} from "../../run-copilot-sample.mjs";
import {
    directModelRuntimeSignature,
    runDirectModelSample
} from "../../run-direct-model-sample.mjs";
import { runHybridCompositeSample } from "../../run-hybrid-sample.mjs";
import { evaluateOutput } from "../hosted-hybrid-replay/evaluate-output.mjs";
import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../hosted-hybrid-replay/prepare-hybrid.mjs";

const SCHEMA_VERSION = "0.1";
const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HYBRID_DIRECTORY = resolve(
    EXAMPLE_DIRECTORY,
    "..",
    "hosted-hybrid-replay"
);
const OVERHEAD_DIRECTORY = resolve(
    EXAMPLE_DIRECTORY,
    "..",
    "hosted-residual-overhead-replay"
);
const ROOT_DIRECTORY = resolve(EXAMPLE_DIRECTORY, "..", "..");
const RUNNER_PATH = fileURLToPath(import.meta.url);
const CORPUS_ID = "pace-hosted-scaled-routing-64-corpus-v2";
const EVALUATOR_ID = "pace-exact-hybrid-routing-evaluator-v1";
const SOURCE_REVISION = "pace-hosted-direct-boundary-scale-64-v2";
export const DIRECT_MODEL_BOUNDARY_TREATMENTS = Object.freeze({
    baseline: Object.freeze({
        configurationId: "pace-scale-64-inline-copilot-low-v2",
        experimentPrefix: "pace-scale-64-inline-copilot-low-v2",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        boundary: "copilot-agent"
    }),
    candidate: Object.freeze({
        configurationId: "pace-scale-64-direct-responses-low-v2",
        experimentPrefix: "pace-scale-64-direct-responses-low-v2",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        boundary: "direct-structured-response"
    })
});

export function buildResidualRoutesResponseFormat(input) {
    const residual = buildResidualInput(input);
    const ids = residual.residual_findings.map((finding) => finding.id);
    return {
        type: "json_schema",
        name: "scaled_residual_routes_64_v2",
        strict: true,
        schema: {
            type: "object",
            properties: {
                schema_version: {
                    type: "string",
                    const: "0.1"
                },
                routes: {
                    type: "array",
                    minItems: ids.length,
                    maxItems: ids.length,
                    items: {
                        type: "object",
                        properties: {
                            id: {
                                type: "string",
                                enum: ids
                            },
                            owner: {
                                type: "string",
                                enum: residual.allowed_owners
                            }
                        },
                        required: ["id", "owner"],
                        additionalProperties: false
                    }
                }
            },
            required: ["schema_version", "routes"],
            additionalProperties: false
        }
    };
}

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

function parseDirectReplayArguments(argv) {
    const remaining = [];
    let providerConfig;
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === "--provider-config") {
            providerConfig = argv[index + 1];
            if (!providerConfig) {
                throw new Error("--provider-config requires a path");
            }
            index += 1;
        } else {
            remaining.push(argv[index]);
        }
    }
    const parsed = parseHostedReplayArguments(remaining);
    if (!parsed.help && !providerConfig) {
        throw new Error("--provider-config is required");
    }
    return { ...parsed, providerConfig };
}

function validateProviderConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("provider config must be a JSON object");
    }
    for (const field of [
        "endpoint",
        "deployment",
        "model",
        "model_version"
    ]) {
        if (typeof value[field] !== "string" || !value[field].trim()) {
            throw new Error(`provider config requires ${field}`);
        }
    }
    return value;
}

export async function runHostedDirectBoundaryScaling64Replay({
    outputDirectory,
    providerConfigPath,
    accessToken = process.env.PACE_DIRECT_ACCESS_TOKEN,
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
    if (typeof accessToken !== "string" || !accessToken.trim()) {
        throw new Error("PACE_DIRECT_ACCESS_TOKEN is required");
    }
    const output = resolve(outputDirectory);
    try {
        await stat(output);
        throw new Error(`output directory already exists: ${output}`);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    mkdirSync(output, { recursive: true });

    const providerPath = resolve(providerConfigPath);
    const inputPath = join(EXAMPLE_DIRECTORY, "baseline-input.json");
    const expectedPath = join(EXAMPLE_DIRECTORY, "expected-result.json");
    const groundTruthPath = join(
        EXAMPLE_DIRECTORY,
        "ground-truth-routes.json"
    );
    const evaluatorPath = join(HYBRID_DIRECTORY, "evaluate-output.mjs");
    const implementationPath = join(
        HYBRID_DIRECTORY,
        "prepare-hybrid.mjs"
    );
    const inlinePromptPath = join(
        OVERHEAD_DIRECTORY,
        "inline-residual-prompt.txt"
    );
    const [
        sourceInput,
        expected,
        inlinePromptTemplate,
        providerConfig,
        providerConfigReceipt,
        version
    ] = await Promise.all([
        readFile(inputPath, "utf8").then(JSON.parse),
        readFile(expectedPath, "utf8").then(JSON.parse),
        readFile(inlinePromptPath, "utf8"),
        readFile(providerPath, "utf8")
            .then(JSON.parse)
            .then(validateProviderConfig),
        sha256File(providerPath),
        readCopilotVersion(copilotCommand, EXAMPLE_DIRECTORY)
    ]);
    if (providerConfig.model !== model) {
        throw new Error(
            `provider model ${providerConfig.model} does not match baseline model ${model}`
        );
    }
    const responseFormat = buildResidualRoutesResponseFormat(sourceInput);
    const provider = "azure-openai-responses";
    const apiVersion = "v1";
    const responsesUrl = `${providerConfig.endpoint.replace(/\/+$/, "")}/openai/v1/responses`;

    const copilotRuntimeSignature = (reasoningEffort) => ({
        name: "github-copilot-cli",
        version,
        producer: "copilot-agent",
        selected_model: model,
        context_tier: "default",
        reasoning_efforts: [reasoningEffort],
        models: [model]
    });
    const deterministicSignature = deterministicRuntimeSignature();
    const baselineExpectedRuntime = [
        copilotRuntimeSignature(
            DIRECT_MODEL_BOUNDARY_TREATMENTS.baseline.reasoningEffort
        ),
        deterministicSignature
    ];
    const candidateExpectedRuntime = [
        directModelRuntimeSignature({
            provider,
            apiVersion,
            model,
            reasoningEffort:
                DIRECT_MODEL_BOUNDARY_TREATMENTS.candidate.reasoningEffort
        }),
        deterministicSignature
    ];
    const executionOrder = buildExecutionOrder(samples);
    const baselineConfigPath = join(output, "baseline-config.json");
    const candidateConfigPath = join(output, "candidate-config.json");
    writeJson(baselineConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "direct-boundary-scale-64-v2",
        model_boundary:
            DIRECT_MODEL_BOUNDARY_TREATMENTS.baseline.boundary,
        residual_transport:
            DIRECT_MODEL_BOUNDARY_TREATMENTS.baseline.residualMode,
        available_tools: [
            ...DIRECT_MODEL_BOUNDARY_TREATMENTS.baseline.availableTools
        ],
        tool_filter_sentinel: NO_TOOLS_SENTINEL,
        prompt_template: "inline-residual-prompt.txt",
        semantic_input: "identical generated residual JSON appended inline",
        reasoning_effort:
            DIRECT_MODEL_BOUNDARY_TREATMENTS.baseline.reasoningEffort,
        execution_order: executionOrder.map((entry) => entry.sample)
    });
    writeJson(candidateConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "direct-boundary-scale-64-v2",
        model_boundary:
            DIRECT_MODEL_BOUNDARY_TREATMENTS.candidate.boundary,
        residual_transport:
            DIRECT_MODEL_BOUNDARY_TREATMENTS.candidate.residualMode,
        available_tools: [
            ...DIRECT_MODEL_BOUNDARY_TREATMENTS.candidate.availableTools
        ],
        prompt_template: "inline-residual-prompt.txt",
        semantic_input: "identical generated residual JSON appended inline",
        reasoning_effort:
            DIRECT_MODEL_BOUNDARY_TREATMENTS.candidate.reasoningEffort,
        provider,
        api_version: apiVersion,
        model,
        model_version: providerConfig.model_version,
        provider_configuration_sha256: providerConfigReceipt.sha256,
        structured_output: responseFormat,
        execution_order: executionOrder.map((entry) => entry.sample)
    });

    const baselineRuns = new Array(samples);
    const candidateRuns = new Array(samples);
    for (const entry of executionOrder) {
        const treatment = DIRECT_MODEL_BOUNDARY_TREATMENTS[entry.side];
        const runResidualSample =
            entry.side === "candidate"
                ? (options) =>
                      runDirectModelSample({
                          ...options,
                          responsesUrl,
                          authorizationHeader: `Bearer ${accessToken}`,
                          provider,
                          apiVersion,
                          deployment: providerConfig.deployment,
                          model,
                          modelVersion: providerConfig.model_version,
                          responseFormat
                      })
                : undefined;
        const run = await runHybridCompositeSample({
            side: entry.side,
            index: entry.index,
            output,
            sourceInput,
            inputPath,
            implementationPath,
            residualMode: treatment.residualMode,
            residualPrompt: "",
            inlinePromptTemplate,
            preprocessTransform: buildResidualInput,
            mergeTransform: buildHybridResultFromMergeInput,
            model,
            runtimeVersion: version,
            maxAiCredits,
            copilotCommand,
            experimentPrefix: treatment.experimentPrefix,
            reasoningEffort: treatment.reasoningEffort,
            runResidualSample
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
    const directModelHelperPath = join(
        ROOT_DIRECTORY,
        "run-direct-model-sample.mjs"
    );
    const hybridSamplePath = join(ROOT_DIRECTORY, "run-hybrid-sample.mjs");
    const compositeRunnerPath = join(
        ROOT_DIRECTORY,
        "compose-run-profiles.mjs"
    );
    const deterministicRunnerPath = join(
        ROOT_DIRECTORY,
        "profile-deterministic-run.mjs"
    );
    const frozenFiles = [
        inputPath,
        expectedPath,
        groundTruthPath,
        evaluatorPath,
        implementationPath,
        inlinePromptPath,
        RUNNER_PATH,
        providerPath,
        copilotHelperPath,
        directModelHelperPath,
        hybridSamplePath,
        compositeRunnerPath,
        deterministicRunnerPath,
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
    const sharedConfigurationFiles = [
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
            "direct-model-helper",
            directModelHelperPath,
            output,
            hashes
        ),
        configurationFile(
            "hybrid-sample-runner",
            hybridSamplePath,
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
        )
    ];
    const replayPath = join(output, "replay.json");
    writeJson(replayPath, {
        schema_version: SCHEMA_VERSION,
        replay_id: "pace-hosted-direct-boundary-scale-64-replay-v2",
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
                ),
                configurationFile(
                    "ground-truth-routes",
                    groundTruthPath,
                    output,
                    hashes
                )
            ]
        },
        cohorts: {
            baseline: {
                configuration: {
                    id: DIRECT_MODEL_BOUNDARY_TREATMENTS.baseline.configurationId,
                    files: [
                        configurationFile(
                            "configuration",
                            baselineConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "inline-prompt",
                            inlinePromptPath,
                            output,
                            hashes
                        ),
                        ...sharedConfigurationFiles
                    ],
                    expected_runtime: baselineExpectedRuntime
                },
                profiles: baselineRuns.map((run) =>
                    relative(output, run.runPaths.jsonPath)
                )
            },
            candidate: {
                configuration: {
                    id: DIRECT_MODEL_BOUNDARY_TREATMENTS.candidate.configurationId,
                    files: [
                        configurationFile(
                            "configuration",
                            candidateConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "inline-prompt",
                            inlinePromptPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "provider-config",
                            providerPath,
                            output,
                            hashes
                        ),
                        ...sharedConfigurationFiles
                    ],
                    expected_runtime: candidateExpectedRuntime
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
        comparison_id:
            "pace-hosted-direct-boundary-scale-64-comparison-v2",
        replay_manifest: "replay.json",
        quality_result: "quality.json",
        decision_metrics: [
            {
                metric: "input_tokens",
                statistic: "p50",
                goal: "decrease"
            },
            {
                metric: "output_tokens",
                statistic: "p50",
                goal: "not_increase"
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
        const args = parseDirectReplayArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(
                `${hostedReplayUsage("run-hosted-direct-boundary-scaling-64-replay.mjs")}\n      --provider-config <path>   Private direct-provider JSON config\n`
            );
            return;
        }
        const result = await runHostedDirectBoundaryScaling64Replay({
            outputDirectory: args.output,
            providerConfigPath: args.providerConfig,
            model: args.model,
            samples: args.samples,
            maxAiCredits: args.maxAiCredits
        });
        process.stdout.write(
            `${result.comparison.disposition}\n${result.paths.replay}\n${result.paths.comparison}\n${result.paths.comparisonReport}\n`
        );
    } catch (error) {
        process.stderr.write(
            `hosted direct boundary 64-finding scaling replay failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
