import { randomUUID } from "node:crypto";
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
import { composeRunProfiles } from "../../compose-run-profiles.mjs";
import {
    deterministicRuntimeSignature,
    profileDeterministicJsonTransform
} from "../../profile-deterministic-run.mjs";
import { writeRunArtifacts } from "../../profile-run.mjs";
import {
    buildExecutionOrder,
    hostedReplayUsage,
    parseHostedReplayArguments
} from "../../run-hosted-model-free-replay.mjs";
import {
    directModelRuntimeSignature,
    runDirectModelSample
} from "../../run-direct-model-sample.mjs";
import {
    buildInlineResidualPrompt,
    buildTransformImplementationFiles,
    runHybridCompositeSample
} from "../../run-hybrid-sample.mjs";
import { evaluateOutput } from "../hosted-hybrid-replay/evaluate-output.mjs";
import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../hosted-hybrid-replay/prepare-hybrid.mjs";
import {
    PARTITION_SIZE,
    buildPartitionResponseFormat,
    buildPartitionedResidualInput,
    mergePartitionedResult
} from "./prepare-request-partition.mjs";

const SCHEMA_VERSION = "0.1";
const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HYBRID_DIRECTORY = resolve(
    EXAMPLE_DIRECTORY,
    "..",
    "hosted-hybrid-replay"
);
const SCALE_DIRECTORY = resolve(
    EXAMPLE_DIRECTORY,
    "..",
    "hosted-direct-boundary-scaling-64-replay"
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
const SOURCE_REVISION = "pace-hosted-direct-request-partition-v1";
const MAX_OUTPUT_TOKENS = 2048;

export const DIRECT_REQUEST_PARTITION_TREATMENTS = Object.freeze({
    baseline: Object.freeze({
        configurationId: "pace-direct-monolithic-64-full-owner-low-v1",
        experimentPrefix: "pace-direct-monolithic-64-full-owner-low-v1",
        reasoningEffort: "low",
        requestTopology: "one-monolithic-request",
        requestCount: 1,
        parallelism: 1,
        partitionSize: 64
    }),
    candidate: Object.freeze({
        configurationId: "pace-direct-parallel-4x16-full-owner-low-v1",
        experimentPrefix: "pace-direct-parallel-4x16-full-owner-low-v1",
        reasoningEffort: "low",
        requestTopology: "four-parallel-contiguous-partitions",
        requestCount: 4,
        parallelism: 4,
        partitionSize: PARTITION_SIZE
    })
});

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

async function runPartitionedCompositeSample({
    side,
    index,
    output,
    sourceInput,
    inputPath,
    implementationPaths,
    inlinePromptTemplate,
    model,
    provider,
    apiVersion,
    modelVersion,
    responsesUrl,
    authorizationHeader,
    deployment,
    responseFormats,
    reasoningEffort,
    experimentPrefix
}) {
    const sampleName = `${side}-${index + 1}`;
    const sampleDirectory = join(output, "raw", sampleName);
    mkdirSync(sampleDirectory, { recursive: true });
    const implementationFiles = buildTransformImplementationFiles({
        implementationPaths
    });

    const preprocessPath = join(
        sampleDirectory,
        "partitioned-residual-input.json"
    );
    const preprocess = await profileDeterministicJsonTransform({
        runId: `${experimentPrefix}-${sampleName}-preprocess-${randomUUID()}`,
        input: {
            id: "partition-source-input",
            path: inputPath
        },
        output: {
            id: `${sampleName}-partitioned-residual-input`,
            path: preprocessPath
        },
        transform: buildPartitionedResidualInput,
        implementationFiles
    });
    const preprocessPaths = writeRunArtifacts(
        preprocess.profile,
        join(output, "component-profiles")
    );
    if (
        !Array.isArray(responseFormats) ||
        responseFormats.length !== preprocess.result.partition_count
    ) {
        throw new Error(
            "responseFormats must contain one schema per partition"
        );
    }

    const residuals = await Promise.all(
        preprocess.result.partitions.map((partition, partitionIndex) =>
            runDirectModelSample({
                output,
                sampleName: `${sampleName}-residual-${partitionIndex + 1}`,
                prompt: buildInlineResidualPrompt(
                    inlinePromptTemplate,
                    partition
                ),
                responsesUrl,
                authorizationHeader,
                provider,
                apiVersion,
                deployment,
                model,
                modelVersion,
                reasoningEffort,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                responseFormat: responseFormats[partitionIndex],
                runIdPrefix: `${experimentPrefix}-residual-${partitionIndex + 1}`
            })
        )
    );
    const partitionRoutes = residuals.map((residual, partitionIndex) => {
        try {
            return JSON.parse(residual.stdout);
        } catch {
            throw new Error(
                `${sampleName} partition ${partitionIndex + 1} output is not JSON`
            );
        }
    });

    const mergeInputPath = join(sampleDirectory, "merge-input.json");
    writeJson(mergeInputPath, {
        source: sourceInput,
        partition_size: preprocess.result.partition_size,
        partition_routes: partitionRoutes
    });
    const finalResultPath = join(sampleDirectory, "final-result.json");
    const merge = await profileDeterministicJsonTransform({
        runId: `${experimentPrefix}-${sampleName}-merge-${randomUUID()}`,
        input: {
            id: `${sampleName}-merge-input`,
            path: mergeInputPath
        },
        output: {
            id: `${sampleName}-final-result`,
            path: finalResultPath
        },
        transform: mergePartitionedResult,
        implementationFiles
    });
    const mergePaths = writeRunArtifacts(
        merge.profile,
        join(output, "component-profiles")
    );

    const compositeDirectory = join(output, "composite-manifests");
    mkdirSync(compositeDirectory, { recursive: true });
    const compositeManifestPath = join(
        compositeDirectory,
        `${sampleName}.json`
    );
    writeJson(compositeManifestPath, {
        schema_version: SCHEMA_VERSION,
        run_id: `${experimentPrefix}-${sampleName}-${randomUUID()}`,
        components: [
            {
                id: "preprocess",
                role: "deterministic-preprocess",
                profile: relative(
                    compositeDirectory,
                    preprocessPaths.jsonPath
                )
            },
            ...residuals.map((residual, partitionIndex) => ({
                id: `residual-model-${partitionIndex + 1}`,
                role: "semantic-residual-partition",
                profile: relative(
                    compositeDirectory,
                    residual.runPaths.jsonPath
                )
            })),
            {
                id: "merge",
                role: "deterministic-merge",
                profile: relative(
                    compositeDirectory,
                    mergePaths.jsonPath
                )
            }
        ]
    });
    const runProfile = await composeRunProfiles(compositeManifestPath);
    const runPaths = writeRunArtifacts(runProfile, join(output, "profiles"));
    const runProfileSha256 = (await sha256File(runPaths.jsonPath)).sha256;
    return {
        side,
        index,
        stdout: JSON.stringify(merge.result),
        rendered_stdout: JSON.stringify(partitionRoutes),
        runProfile,
        runPaths,
        runProfileSha256
    };
}

export async function runHostedDirectRequestPartitionReplay({
    outputDirectory,
    providerConfigPath,
    accessToken = process.env.PACE_DIRECT_ACCESS_TOKEN,
    model = "gpt-5-mini",
    samples = 3
}) {
    if (!Number.isInteger(samples) || samples < 2) {
        throw new Error("samples must be an integer of at least 2");
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
    const inputPath = join(SCALE_DIRECTORY, "baseline-input.json");
    const expectedPath = join(SCALE_DIRECTORY, "expected-result.json");
    const groundTruthPath = join(
        SCALE_DIRECTORY,
        "ground-truth-routes.json"
    );
    const evaluatorPath = join(HYBRID_DIRECTORY, "evaluate-output.mjs");
    const hybridImplementationPath = join(
        HYBRID_DIRECTORY,
        "prepare-hybrid.mjs"
    );
    const partitionImplementationPath = join(
        EXAMPLE_DIRECTORY,
        "prepare-request-partition.mjs"
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
        providerConfigReceipt
    ] = await Promise.all([
        readFile(inputPath, "utf8").then(JSON.parse),
        readFile(expectedPath, "utf8").then(JSON.parse),
        readFile(inlinePromptPath, "utf8"),
        readFile(providerPath, "utf8")
            .then(JSON.parse)
            .then(validateProviderConfig),
        sha256File(providerPath)
    ]);
    if (providerConfig.model !== model) {
        throw new Error(
            `provider model ${providerConfig.model} does not match requested model ${model}`
        );
    }

    const provider = "azure-openai-responses";
    const apiVersion = "v1";
    const responsesUrl = `${providerConfig.endpoint.replace(/\/+$/, "")}/openai/v1/responses`;
    const authorizationHeader = `Bearer ${accessToken.trim()}`;
    const baselineResidual = buildResidualInput(sourceInput);
    const baselineResponseFormat = buildPartitionResponseFormat(
        baselineResidual,
        "monolithic_routes_64_v1"
    );
    const candidatePartitioned = buildPartitionedResidualInput(sourceInput);
    const candidateResponseFormats =
        candidatePartitioned.partitions.map((partition, index) =>
            buildPartitionResponseFormat(
                partition,
                `partition_routes_16_${index + 1}_v1`
            )
        );
    const directSignature = directModelRuntimeSignature({
        provider,
        apiVersion,
        model,
        reasoningEffort:
            DIRECT_REQUEST_PARTITION_TREATMENTS.baseline.reasoningEffort
    });
    const expectedRuntime = [
        directSignature,
        deterministicRuntimeSignature()
    ];

    const executionOrder = buildExecutionOrder(samples);
    const baselineConfigPath = join(output, "baseline-config.json");
    const candidateConfigPath = join(output, "candidate-config.json");
    writeJson(baselineConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "direct-request-partition-v1",
        model_boundary: "direct-response",
        owner_encoding: "full-owner-names",
        request_topology:
            DIRECT_REQUEST_PARTITION_TREATMENTS.baseline.requestTopology,
        request_count:
            DIRECT_REQUEST_PARTITION_TREATMENTS.baseline.requestCount,
        parallelism:
            DIRECT_REQUEST_PARTITION_TREATMENTS.baseline.parallelism,
        partition_size:
            DIRECT_REQUEST_PARTITION_TREATMENTS.baseline.partitionSize,
        prompt_template: "inline-residual-prompt.txt",
        reasoning_effort:
            DIRECT_REQUEST_PARTITION_TREATMENTS.baseline.reasoningEffort,
        max_output_tokens_per_request: MAX_OUTPUT_TOKENS,
        provider,
        api_version: apiVersion,
        model,
        model_version: providerConfig.model_version,
        provider_configuration_sha256: providerConfigReceipt.sha256,
        structured_output: baselineResponseFormat,
        execution_order: executionOrder.map((entry) => entry.sample)
    });
    writeJson(candidateConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "direct-request-partition-v1",
        model_boundary: "direct-response",
        owner_encoding: "full-owner-names",
        request_topology:
            DIRECT_REQUEST_PARTITION_TREATMENTS.candidate.requestTopology,
        request_count:
            DIRECT_REQUEST_PARTITION_TREATMENTS.candidate.requestCount,
        parallelism:
            DIRECT_REQUEST_PARTITION_TREATMENTS.candidate.parallelism,
        partition_size:
            DIRECT_REQUEST_PARTITION_TREATMENTS.candidate.partitionSize,
        partition_order: "contiguous source finding order",
        accounting:
            "token and API metrics sum all requests; wall time uses the observed parallel span",
        prompt_template: "inline-residual-prompt.txt",
        reasoning_effort:
            DIRECT_REQUEST_PARTITION_TREATMENTS.candidate.reasoningEffort,
        max_output_tokens_per_request: MAX_OUTPUT_TOKENS,
        provider,
        api_version: apiVersion,
        model,
        model_version: providerConfig.model_version,
        provider_configuration_sha256: providerConfigReceipt.sha256,
        structured_output: candidateResponseFormats,
        execution_order: executionOrder.map((entry) => entry.sample)
    });

    const baselineRuns = new Array(samples);
    const candidateRuns = new Array(samples);
    for (const entry of executionOrder) {
        const treatment =
            DIRECT_REQUEST_PARTITION_TREATMENTS[entry.side];
        let run;
        if (entry.side === "baseline") {
            run = await runHybridCompositeSample({
                side: entry.side,
                index: entry.index,
                output,
                sourceInput,
                inputPath,
                implementationPath: hybridImplementationPath,
                residualMode: "inline-tool-less",
                residualPrompt: "",
                inlinePromptTemplate,
                preprocessTransform: buildResidualInput,
                mergeTransform: buildHybridResultFromMergeInput,
                model,
                runtimeVersion: null,
                maxAiCredits: null,
                copilotCommand: null,
                experimentPrefix: treatment.experimentPrefix,
                reasoningEffort: treatment.reasoningEffort,
                runResidualSample: (options) =>
                    runDirectModelSample({
                        ...options,
                        responsesUrl,
                        authorizationHeader,
                        provider,
                        apiVersion,
                        deployment: providerConfig.deployment,
                        model,
                        modelVersion: providerConfig.model_version,
                        maxOutputTokens: MAX_OUTPUT_TOKENS,
                        responseFormat: baselineResponseFormat
                    })
            });
        } else {
            run = await runPartitionedCompositeSample({
                side: entry.side,
                index: entry.index,
                output,
                sourceInput,
                inputPath,
                implementationPaths: [
                    partitionImplementationPath,
                    hybridImplementationPath
                ],
                inlinePromptTemplate,
                model,
                provider,
                apiVersion,
                modelVersion: providerConfig.model_version,
                responsesUrl,
                authorizationHeader,
                deployment: providerConfig.deployment,
                responseFormats: candidateResponseFormats,
                reasoningEffort: treatment.reasoningEffort,
                experimentPrefix: treatment.experimentPrefix
            });
        }
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
        hybridImplementationPath,
        partitionImplementationPath,
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
            "hybrid-implementation",
            hybridImplementationPath,
            output,
            hashes
        ),
        configurationFile(
            "partition-implementation",
            partitionImplementationPath,
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
        replay_id: "pace-hosted-direct-request-partition-replay-v1",
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
                    id: DIRECT_REQUEST_PARTITION_TREATMENTS.baseline.configurationId,
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
                        configurationFile(
                            "provider-config",
                            providerPath,
                            output,
                            hashes
                        ),
                        ...sharedConfigurationFiles
                    ],
                    expected_runtime: expectedRuntime
                },
                profiles: baselineRuns.map((run) =>
                    relative(output, run.runPaths.jsonPath)
                )
            },
            candidate: {
                configuration: {
                    id: DIRECT_REQUEST_PARTITION_TREATMENTS.candidate.configurationId,
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
                    expected_runtime: expectedRuntime
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
            "pace-hosted-direct-request-partition-comparison-v1",
        replay_manifest: "replay.json",
        quality_result: "quality.json",
        decision_metrics: [
            {
                metric: "input_tokens",
                statistic: "p50",
                goal: "not_increase"
            },
            {
                metric: "output_tokens",
                statistic: "p50",
                goal: "decrease"
            },
            {
                metric: "wall_time_ms",
                statistic: "p90",
                goal: "decrease"
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
                `${hostedReplayUsage("run-hosted-direct-request-partition-replay.mjs")}\n      --provider-config <path>   Private direct-provider JSON config\n`
            );
            return;
        }
        const result = await runHostedDirectRequestPartitionReplay({
            outputDirectory: args.output,
            providerConfigPath: args.providerConfig,
            model: args.model,
            samples: args.samples
        });
        process.stdout.write(
            `${result.comparison.disposition}\n${result.paths.replay}\n${result.paths.comparison}\n${result.paths.comparisonReport}\n`
        );
    } catch (error) {
        process.stderr.write(
            `hosted direct request partition replay failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
