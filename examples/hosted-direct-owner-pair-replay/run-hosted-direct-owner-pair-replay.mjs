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
    directModelRuntimeSignature,
    runDirectModelSample
} from "../../run-direct-model-sample.mjs";
import { runHybridCompositeSample } from "../../run-hybrid-sample.mjs";
import { evaluateOutput } from "../hosted-hybrid-replay/evaluate-output.mjs";
import {
    buildFullOwnerResidualInput,
    buildFullOwnerResultFromMergeInput,
    buildOwnerPairResponseFormat,
    buildRouteObjectResponseFormat,
    decodeOwnerPairMergeInput
} from "./prepare-owner-pair.mjs";

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
const EVALUATOR_ID = "pace-exact-hybrid-routing-evaluator-v1";

export const DIRECT_OWNER_PAIR_TREATMENTS = Object.freeze({
    baseline: Object.freeze({
        configurationId: "pace-direct-route-objects-pair-control-low-v2",
        experimentPrefix: "pace-direct-route-objects-pair-control-low-v2",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "route-objects-with-ids"
    }),
    candidate: Object.freeze({
        configurationId: "pace-direct-explicit-owner-pairs-low-v2",
        experimentPrefix: "pace-direct-explicit-owner-pairs-low-v2",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "ordered-explicit-id-owner-pairs"
    })
});

export const DEFAULT_OWNER_PAIR_SCENARIO = Object.freeze({
    workloadDirectory: SCALE_DIRECTORY,
    corpusId: "pace-hosted-scaled-routing-64-corpus-v2",
    evaluatorId: EVALUATOR_ID,
    sourceRevision: "pace-hosted-direct-owner-pair-v2",
    experimentId: "direct-owner-pair-v2",
    replayId: "pace-hosted-direct-owner-pair-replay-v2",
    comparisonId: "pace-hosted-direct-owner-pair-comparison-v2",
    baselineSchemaName: "full_owner_route_objects_pair_control_64_v2",
    candidateSchemaName: "explicit_id_owner_pairs_64_v2",
    treatments: DIRECT_OWNER_PAIR_TREATMENTS,
    configurationFiles: Object.freeze([])
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

export async function runHostedDirectOwnerPairReplay({
    outputDirectory,
    providerConfigPath,
    accessToken = process.env.PACE_DIRECT_ACCESS_TOKEN,
    model = "gpt-5-mini",
    samples = 3,
    scenario = DEFAULT_OWNER_PAIR_SCENARIO
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

    const treatments = scenario.treatments;
    const workloadDirectory = resolve(scenario.workloadDirectory);
    const evaluatorId = scenario.evaluatorId ?? EVALUATOR_ID;
    const scenarioConfigurationFiles =
        scenario.configurationFiles ?? [];
    const providerPath = resolve(providerConfigPath);
    const inputPath = join(workloadDirectory, "baseline-input.json");
    const expectedPath = join(workloadDirectory, "expected-result.json");
    const groundTruthPath = join(
        workloadDirectory,
        "ground-truth-routes.json"
    );
    const evaluatorPath = join(HYBRID_DIRECTORY, "evaluate-output.mjs");
    const hybridImplementationPath = join(
        HYBRID_DIRECTORY,
        "prepare-hybrid.mjs"
    );
    const pairImplementationPath = join(
        EXAMPLE_DIRECTORY,
        "prepare-owner-pair.mjs"
    );
    const baselinePromptPath = join(
        OVERHEAD_DIRECTORY,
        "inline-residual-prompt.txt"
    );
    const candidatePromptPath = join(
        EXAMPLE_DIRECTORY,
        "inline-owner-pair-prompt.txt"
    );
    const [
        sourceInput,
        expected,
        baselinePromptTemplate,
        candidatePromptTemplate,
        providerConfig,
        providerConfigReceipt
    ] = await Promise.all([
        readFile(inputPath, "utf8").then(JSON.parse),
        readFile(expectedPath, "utf8").then(JSON.parse),
        readFile(baselinePromptPath, "utf8"),
        readFile(candidatePromptPath, "utf8"),
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
    const residual = buildFullOwnerResidualInput(sourceInput);
    const baselineResponseFormat = buildRouteObjectResponseFormat(
        sourceInput,
        scenario.baselineSchemaName
    );
    const candidateResponseFormat = buildOwnerPairResponseFormat(
        sourceInput,
        scenario.candidateSchemaName
    );
    const expectedRuntime = [
        directModelRuntimeSignature({
            provider,
            apiVersion,
            model,
            reasoningEffort:
                treatments.baseline.reasoningEffort
        }),
        deterministicRuntimeSignature()
    ];

    const executionOrder = buildExecutionOrder(samples);
    const baselineConfigPath = join(output, "baseline-config.json");
    const candidateConfigPath = join(output, "candidate-config.json");
    writeJson(baselineConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: scenario.experimentId,
        model_boundary: "direct-response",
        response_representation:
            treatments.baseline.responseRepresentation,
        residual_transport:
            treatments.baseline.residualMode,
        available_tools: [
            ...treatments.baseline.availableTools
        ],
        prompt_template: "inline-residual-prompt.txt",
        semantic_input:
            `${sourceInput.findings.length} findings and full owner-name taxonomy appended inline`,
        reasoning_effort:
            treatments.baseline.reasoningEffort,
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
        experiment: scenario.experimentId,
        model_boundary: "direct-response",
        response_representation:
            treatments.candidate.responseRepresentation,
        residual_transport:
            treatments.candidate.residualMode,
        available_tools: [
            ...treatments.candidate.availableTools
        ],
        prompt_template: "inline-owner-pair-prompt.txt",
        semantic_input:
            `identical ${sourceInput.findings.length} findings and full owner-name taxonomy appended inline`,
        ordered_finding_ids: residual.residual_findings.map(
            (finding) => finding.id
        ),
        deterministic_decode:
            "each pair id must exactly match the corresponding residual finding id",
        reasoning_effort:
            treatments.candidate.reasoningEffort,
        provider,
        api_version: apiVersion,
        model,
        model_version: providerConfig.model_version,
        provider_configuration_sha256: providerConfigReceipt.sha256,
        structured_output: candidateResponseFormat,
        execution_order: executionOrder.map((entry) => entry.sample)
    });

    const baselineRuns = new Array(samples);
    const candidateRuns = new Array(samples);
    for (const entry of executionOrder) {
        const treatment = treatments[entry.side];
        const isCandidate = entry.side === "candidate";
        const responseFormat = isCandidate
            ? candidateResponseFormat
            : baselineResponseFormat;
        const run = await runHybridCompositeSample({
            side: entry.side,
            index: entry.index,
            output,
            sourceInput,
            inputPath,
            implementationPath: pairImplementationPath,
            implementationPaths: [
                pairImplementationPath,
                hybridImplementationPath
            ],
            residualMode: treatment.residualMode,
            residualPrompt: "",
            inlinePromptTemplate: isCandidate
                ? candidatePromptTemplate
                : baselinePromptTemplate,
            preprocessTransform: buildFullOwnerResidualInput,
            mergeTransform: isCandidate
                ? decodeOwnerPairMergeInput
                : buildFullOwnerResultFromMergeInput,
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
                    authorizationHeader: `Bearer ${accessToken.trim()}`,
                    provider,
                    apiVersion,
                    deployment: providerConfig.deployment,
                    model,
                    modelVersion: providerConfig.model_version,
                    responseFormat
                })
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
                corpus_id: scenario.corpusId,
                evaluator_id: evaluatorId,
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
        pairImplementationPath,
        baselinePromptPath,
        candidatePromptPath,
        RUNNER_PATH,
        providerPath,
        copilotHelperPath,
        directModelHelperPath,
        hybridSamplePath,
        compositeRunnerPath,
        deterministicRunnerPath,
        ...scenarioConfigurationFiles.map((file) => resolve(file.path)),
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
            "owner-pair-implementation",
            pairImplementationPath,
            output,
            hashes
        ),
        configurationFile(
            "hybrid-implementation",
            hybridImplementationPath,
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
        ),
        ...scenarioConfigurationFiles.map((file) =>
            configurationFile(
                file.id,
                resolve(file.path),
                output,
                hashes
            )
        )
    ];
    const replayPath = join(output, "replay.json");
    writeJson(replayPath, {
        schema_version: SCHEMA_VERSION,
        replay_id: scenario.replayId,
        evaluator: {
            id: evaluatorId,
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
            corpus_id: scenario.corpusId,
            source_revision: scenario.sourceRevision,
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
                    id: treatments.baseline.configurationId,
                    files: [
                        configurationFile(
                            "configuration",
                            baselineConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "inline-prompt",
                            baselinePromptPath,
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
                    id: treatments.candidate.configurationId,
                    files: [
                        configurationFile(
                            "configuration",
                            candidateConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "owner-pair-prompt",
                            candidatePromptPath,
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
        comparison_id: scenario.comparisonId,
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
        const args = parseDirectReplayArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(
                `${hostedReplayUsage("run-hosted-direct-owner-pair-replay.mjs")}\n      --provider-config <path>   Private direct-provider JSON config\n`
            );
            return;
        }
        const result = await runHostedDirectOwnerPairReplay({
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
            `hosted direct owner-pair replay failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
