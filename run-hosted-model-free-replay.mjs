import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
    readFile,
    stat,
    writeFile
} from "node:fs/promises";
import {
    basename,
    dirname,
    join,
    relative,
    resolve
} from "node:path";
import { fileURLToPath } from "node:url";
import {
    loadReplayManifest,
    sha256File,
    writeReplayArtifacts
} from "./build-replay-manifest.mjs";
import {
    compareRepeatedRunManifest,
    writeRepeatedComparisonArtifacts
} from "./compare-run-sets.mjs";
import {
    deterministicRuntimeSignature,
    profileDeterministicJsonTransform
} from "./profile-deterministic-run.mjs";
import {
    writeRunArtifacts
} from "./profile-run.mjs";
import {
    readCopilotVersion,
    readFinalAssistantMessage,
    runCopilotSample
} from "./run-copilot-sample.mjs";

const SCHEMA_VERSION = "0.1";
const RUNNER_PATH = fileURLToPath(import.meta.url);
const DEFAULT_DECISION_METRICS = [
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
];

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function normalizeScenario(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("scenario must be an object");
    }
    const slug = requireString(raw.slug, "scenario.slug");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        throw new Error(
            "scenario.slug must use lowercase letters, numbers, and hyphens"
        );
    }
    if (typeof raw.transform !== "function") {
        throw new Error("scenario.transform must be a function");
    }
    if (typeof raw.evaluateOutput !== "function") {
        throw new Error("scenario.evaluateOutput must be a function");
    }
    const directory = resolve(requireString(raw.directory, "scenario.directory"));
    const resolveFile = (value, fallback, label) =>
        resolve(directory, requireString(value ?? fallback, label));
    const entrypointPath = resolveFile(
        raw.entrypoint,
        null,
        "scenario.entrypoint"
    );
    const decisionMetrics =
        raw.decisionMetrics === undefined
            ? DEFAULT_DECISION_METRICS
            : raw.decisionMetrics;
    if (!Array.isArray(decisionMetrics) || decisionMetrics.length === 0) {
        throw new Error(
            "scenario.decisionMetrics requires at least one metric"
        );
    }
    return {
        slug,
        experiment: requireString(raw.experiment, "scenario.experiment"),
        directory,
        entrypointPath,
        corpusId: requireString(raw.corpusId, "scenario.corpusId"),
        evaluatorId: requireString(
            raw.evaluatorId,
            "scenario.evaluatorId"
        ),
        sourceRevision: requireString(
            raw.sourceRevision,
            "scenario.sourceRevision"
        ),
        replayId: requireString(raw.replayId, "scenario.replayId"),
        comparisonId: requireString(
            raw.comparisonId,
            "scenario.comparisonId"
        ),
        baselineConfigurationId: requireString(
            raw.baselineConfigurationId,
            "scenario.baselineConfigurationId"
        ),
        candidateConfigurationId: requireString(
            raw.candidateConfigurationId,
            "scenario.candidateConfigurationId"
        ),
        inputPath: resolveFile(
            raw.inputFile,
            "baseline-input.json",
            "scenario.inputFile"
        ),
        expectedPath: resolveFile(
            raw.expectedFile,
            "expected-result.json",
            "scenario.expectedFile"
        ),
        baselinePromptPath: resolveFile(
            raw.baselinePromptFile,
            "baseline-prompt.txt",
            "scenario.baselinePromptFile"
        ),
        evaluatorPath: resolveFile(
            raw.evaluatorFile,
            "evaluate-output.mjs",
            "scenario.evaluatorFile"
        ),
        implementationPath: resolveFile(
            raw.implementationFile,
            "prepare-input.mjs",
            "scenario.implementationFile"
        ),
        inputId: requireString(
            raw.inputId ?? "baseline-input",
            "scenario.inputId"
        ),
        expectedId: requireString(
            raw.expectedId ?? "expected-result",
            "scenario.expectedId"
        ),
        implementationId: requireString(
            raw.implementationId ?? "deterministic-transform",
            "scenario.implementationId"
        ),
        transform: raw.transform,
        evaluateOutput: raw.evaluateOutput,
        decisionMetrics: decisionMetrics.map((metric) => ({ ...metric }))
    };
}

export { readFinalAssistantMessage };

export function buildExecutionOrder(samples) {
    const order = [];
    for (let index = 0; index < samples; index += 1) {
        const pair =
            index % 2 === 0
                ? ["baseline", "candidate"]
                : ["candidate", "baseline"];
        for (const side of pair) {
            order.push({
                side,
                index,
                sample: `${side}-${index + 1}`
            });
        }
    }
    return order;
}

async function runModelSample({
    scenario,
    index,
    output,
    prompt,
    model,
    runtimeVersion,
    maxAiCredits,
    copilotCommand
}) {
    const side = "baseline";
    const sampleName = `${side}-${index + 1}`;
    const measured = await runCopilotSample({
        output,
        sampleName,
        workspaceFiles: [
            {
                path: scenario.inputPath,
                name: basename(scenario.inputPath)
            }
        ],
        prompt,
        model,
        runtimeVersion,
        maxAiCredits,
        copilotCommand,
        sessionName: `pace-${scenario.slug}-${sampleName}`,
        runIdPrefix: `pace-${scenario.slug}`
    });
    return {
        ...measured,
        side,
        index
    };
}

async function runDeterministicSample({ scenario, index, output }) {
    const side = "candidate";
    const sampleName = `${side}-${index + 1}`;
    const sampleDirectory = join(output, "raw", sampleName);
    mkdirSync(sampleDirectory, { recursive: true });
    const runId = `pace-${scenario.slug}-${sampleName}-${randomUUID()}`;
    const resultPath = join(sampleDirectory, "result.json");
    const measured = await profileDeterministicJsonTransform({
        runId,
        input: {
            id: scenario.inputId,
            path: scenario.inputPath
        },
        output: {
            id: `${scenario.slug}-${sampleName}-result`,
            path: resultPath
        },
        transform: scenario.transform,
        implementationFiles: [
            {
                id: scenario.implementationId,
                path: scenario.implementationPath
            }
        ]
    });
    const runPaths = writeRunArtifacts(
        measured.profile,
        join(output, "profiles")
    );
    const runProfileSha256 = (await sha256File(runPaths.jsonPath)).sha256;
    return {
        side,
        index,
        stdout: JSON.stringify(measured.result),
        rendered_stdout: JSON.stringify(measured.result),
        sessionProfile: measured.profile.sessions[0].profile,
        runProfile: measured.profile,
        runPaths,
        runProfileSha256
    };
}

function configurationFile(id, path, output, hashes) {
    return {
        id,
        path: relative(output, path),
        sha256: hashes.get(path)
    };
}

export async function runHostedModelFreeReplay({
    scenario: rawScenario,
    outputDirectory,
    model = "gpt-5-mini",
    samples = 2,
    maxAiCredits = 30,
    copilotCommand = process.env.COPILOT_COMMAND ?? "copilot"
}) {
    const scenario = normalizeScenario(rawScenario);
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

    const [baselineInput, expected, baselinePrompt, version] =
        await Promise.all([
            readFile(scenario.inputPath, "utf8").then(JSON.parse),
            readFile(scenario.expectedPath, "utf8").then(JSON.parse),
            readFile(scenario.baselinePromptPath, "utf8"),
            readCopilotVersion(copilotCommand, scenario.directory)
        ]);
    const candidateResult = scenario.transform(baselineInput);
    if (
        candidateResult &&
        typeof candidateResult.then === "function"
    ) {
        throw new Error("scenario transform must return synchronously");
    }
    if (JSON.stringify(candidateResult) !== JSON.stringify(expected)) {
        throw new Error(
            "deterministic candidate result does not match the expected result"
        );
    }

    const baselineRuntimeSignature = {
        name: "github-copilot-cli",
        version,
        producer: "copilot-agent",
        selected_model: model,
        context_tier: "default",
        reasoning_efforts: ["medium"],
        models: [model]
    };
    const candidateRuntimeSignature = deterministicRuntimeSignature();
    const executionOrder = buildExecutionOrder(samples);
    const baselineConfigPath = join(output, "baseline-config.json");
    const candidateConfigPath = join(output, "candidate-config.json");
    const orchestratorFiles = [
        {
            id: "hosted-model-free-runner",
            path: RUNNER_PATH
        },
        {
            id: "scenario-entrypoint",
            path: scenario.entrypointPath
        }
    ];
    writeJson(baselineConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: scenario.experiment,
        model,
        copilot_cli_version: version,
        tool_allowlist: ["view"],
        input: basename(scenario.inputPath),
        prompt: basename(scenario.baselinePromptPath),
        orchestrators: orchestratorFiles.map((file) => file.id),
        execution_order: executionOrder.map((entry) => entry.sample)
    });
    writeJson(candidateConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: scenario.experiment,
        runtime: candidateRuntimeSignature,
        input: basename(scenario.inputPath),
        runner: basename(
            new URL("./profile-deterministic-run.mjs", import.meta.url)
                .pathname
        ),
        implementation: basename(scenario.implementationPath),
        orchestrators: orchestratorFiles.map((file) => file.id),
        execution_contract: "synchronous_local_json_transform_v1",
        execution_order: executionOrder.map((entry) => entry.sample)
    });

    const baselineRuns = new Array(samples);
    const candidateRuns = new Array(samples);
    for (const entry of executionOrder) {
        const run =
            entry.side === "baseline"
                ? await runModelSample({
                      scenario,
                      index: entry.index,
                      output,
                      prompt: baselinePrompt,
                      model,
                      runtimeVersion: version,
                      maxAiCredits,
                      copilotCommand
                  })
                : await runDeterministicSample({
                      scenario,
                      index: entry.index,
                      output
                  });
        if (entry.side === "baseline") {
            baselineRuns[entry.index] = run;
        } else {
            candidateRuns[entry.index] = run;
        }
    }

    const qualityForRun = (run) => {
        const evaluation = scenario.evaluateOutput(expected, run.stdout);
        return {
            entry: {
                run_id: run.runProfile.run_id,
                run_profile_sha256: run.runProfileSha256,
                corpus_id: scenario.corpusId,
                evaluator_id: scenario.evaluatorId,
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

    const frozenFiles = [
        scenario.inputPath,
        scenario.expectedPath,
        scenario.evaluatorPath,
        scenario.baselinePromptPath,
        scenario.implementationPath,
        RUNNER_PATH,
        scenario.entrypointPath,
        resolve(dirname(RUNNER_PATH), "profile-deterministic-run.mjs"),
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
    const deterministicRunnerPath = resolve(
        dirname(RUNNER_PATH),
        "profile-deterministic-run.mjs"
    );
    const orchestratorReceipts = orchestratorFiles.map((file) =>
        configurationFile(file.id, file.path, output, hashes)
    );
    const replayPath = join(output, "replay.json");
    writeJson(replayPath, {
        schema_version: SCHEMA_VERSION,
        replay_id: scenario.replayId,
        evaluator: {
            id: scenario.evaluatorId,
            files: [
                configurationFile(
                    "evaluator",
                    scenario.evaluatorPath,
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
                    scenario.inputId,
                    scenario.inputPath,
                    output,
                    hashes
                ),
                configurationFile(
                    scenario.expectedId,
                    scenario.expectedPath,
                    output,
                    hashes
                )
            ]
        },
        cohorts: {
            baseline: {
                configuration: {
                    id: scenario.baselineConfigurationId,
                    files: [
                        configurationFile(
                            "configuration",
                            baselineConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "prompt",
                            scenario.baselinePromptPath,
                            output,
                            hashes
                        ),
                        ...orchestratorReceipts
                    ],
                    expected_runtime: [baselineRuntimeSignature]
                },
                profiles: baselineRuns.map((run) =>
                    relative(output, run.runPaths.jsonPath)
                )
            },
            candidate: {
                configuration: {
                    id: scenario.candidateConfigurationId,
                    files: [
                        configurationFile(
                            "configuration",
                            candidateConfigPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "runner",
                            deterministicRunnerPath,
                            output,
                            hashes
                        ),
                        configurationFile(
                            "implementation",
                            scenario.implementationPath,
                            output,
                            hashes
                        ),
                        ...orchestratorReceipts
                    ],
                    expected_runtime: [candidateRuntimeSignature]
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
    const comparisonManifestPath = join(output, "comparison.json");
    writeJson(comparisonManifestPath, {
        schema_version: SCHEMA_VERSION,
        comparison_id: scenario.comparisonId,
        replay_manifest: "replay.json",
        quality_result: "quality.json",
        decision_metrics: scenario.decisionMetrics
    });
    const comparison = await compareRepeatedRunManifest(
        comparisonManifestPath
    );
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
            replayReport: replayPaths.markdownPath,
            comparison: comparisonPaths.jsonPath,
            comparisonReport: comparisonPaths.markdownPath
        }
    };
}

export function hostedReplayUsage(scriptName) {
    return [
        `Usage: node ${scriptName} [options]`,
        "",
        "Options:",
        "  -o, --out <directory>        Required output directory",
        "      --model <model>           Copilot model (default: gpt-5-mini)",
        "      --samples <count>         Samples per cohort (default: 2)",
        "      --max-ai-credits <count>  Per-session ceiling (default/minimum: 30)",
        "  -h, --help                   Show this help"
    ].join("\n");
}

export function parseHostedReplayArguments(argv) {
    let output = null;
    let model = "gpt-5-mini";
    let samples = 2;
    let maxAiCredits = 30;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "-h" || argument === "--help") return { help: true };
        if (argument === "-o" || argument === "--out") {
            output = argv[++index];
        } else if (argument === "--model") {
            model = argv[++index];
        } else if (argument === "--samples") {
            samples = Number(argv[++index]);
        } else if (argument === "--max-ai-credits") {
            maxAiCredits = Number(argv[++index]);
        } else {
            throw new Error(`unknown option: ${argument}`);
        }
    }
    if (!output) throw new Error("--out is required");
    return { help: false, output, model, samples, maxAiCredits };
}

export async function runHostedModelFreeReplayCli(
    scenario,
    {
        argv = process.argv.slice(2),
        scriptName = "run-hosted-replay.mjs"
    } = {}
) {
    const args = parseHostedReplayArguments(argv);
    if (args.help) {
        process.stdout.write(`${hostedReplayUsage(scriptName)}\n`);
        return null;
    }
    const result = await runHostedModelFreeReplay({
        scenario,
        outputDirectory: args.output,
        model: args.model,
        samples: args.samples,
        maxAiCredits: args.maxAiCredits
    });
    process.stdout.write(
        `${result.comparison.disposition}\n${result.paths.replay}\n${result.paths.comparison}\n${result.paths.comparisonReport}\n`
    );
    return result;
}
