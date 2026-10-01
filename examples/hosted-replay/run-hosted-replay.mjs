import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
    copyFile,
    readFile,
    stat,
    writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
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
    deterministicRuntimeSignature,
    profileDeterministicJsonTransform
} from "../../profile-deterministic-run.mjs";
import {
    profileRunManifest,
    writeRunArtifacts
} from "../../profile-run.mjs";
import {
    profileSession,
    writeProfileArtifacts
} from "../../profile-session.mjs";
import { evaluateOutput } from "./evaluate-output.mjs";
import { buildCandidateResult } from "./prepare-input.mjs";

const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = "0.1";
const CORPUS_ID = "pace-hosted-triage-corpus-v1";
const EVALUATOR_ID = "pace-exact-json-evaluator-v1";
const SOURCE_REVISION = "pace-hosted-triage-model-free-v2";

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForFile(path, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    do {
        try {
            await stat(path);
            return;
        } catch {
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
    } while (Date.now() < deadline);
    throw new Error(`timed out waiting for ${path}`);
}

function runProcess(command, args, { cwd, timeoutMs }) {
    return new Promise((resolveProcess, rejectProcess) => {
        const child = spawn(command, args, {
            cwd,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        const timer = setTimeout(() => {
            child.kill();
            rejectProcess(new Error(`${command} timed out`));
        }, timeoutMs);
        child.on("error", (error) => {
            clearTimeout(timer);
            rejectProcess(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolveProcess({ code, stdout, stderr });
        });
    });
}

async function copilotVersion(command) {
    const result = await runProcess(command, ["--version"], {
        cwd: EXAMPLE_DIRECTORY,
        timeoutMs: 30_000
    });
    if (result.code !== 0) {
        throw new Error(`cannot read Copilot CLI version: ${result.stderr}`);
    }
    const match = result.stdout.match(/GitHub Copilot CLI\s+([^\s]+)/);
    if (!match) throw new Error("cannot parse Copilot CLI version");
    return match[1].replace(/[.,;:]+$/, "");
}

export async function readFinalAssistantMessage(sessionDirectory) {
    const content = await readFile(
        join(sessionDirectory, "events.jsonl"),
        "utf8"
    );
    let finalMessage = null;
    for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        if (
            event.type === "assistant.message" &&
            typeof event.data?.content === "string" &&
            (!Array.isArray(event.data.toolRequests) ||
                event.data.toolRequests.length === 0)
        ) {
            finalMessage = event.data.content;
        }
    }
    if (finalMessage === null) {
        throw new Error("session has no final assistant.message");
    }
    return finalMessage;
}

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

async function runSample({
    side,
    index,
    output,
    prompt,
    model,
    runtimeVersion,
    maxAiCredits,
    copilotCommand
}) {
    const sampleName = `${side}-${index + 1}`;
    const sampleDirectory = join(output, "raw", sampleName);
    const workspace = join(sampleDirectory, "workspace");
    mkdirSync(workspace, { recursive: true });
    await copyFile(
        join(EXAMPLE_DIRECTORY, "baseline-input.json"),
        join(workspace, "baseline-input.json")
    );
    const sessionId = randomUUID();
    const usagePath = join(sampleDirectory, "usage.json");
    const result = await runProcess(
        copilotCommand,
        [
            "-p",
            prompt,
            "-s",
            "--stream",
            "off",
            "--model",
            model,
            "--reasoning-effort",
            "medium",
            "--context",
            "default",
            "--session-id",
            sessionId,
            "--name",
            `pace-hosted-${sampleName}`,
            "--max-ai-credits",
            String(maxAiCredits),
            "--usage-output-file",
            usagePath,
            "--allow-all-tools",
            "--available-tools=view",
            "--disable-builtin-mcps",
            "--no-custom-instructions",
            "--no-ask-user",
            "--no-auto-update",
            "--no-experimental",
            "--no-bash-env",
            "--no-remote",
            "--no-remote-export",
            "--no-color",
            "-C",
            workspace
        ],
        {
            cwd: workspace,
            timeoutMs: 10 * 60 * 1000
        }
    );
    await writeFile(join(sampleDirectory, "stdout.txt"), result.stdout, "utf8");
    await writeFile(join(sampleDirectory, "stderr.txt"), result.stderr, "utf8");
    if (result.code !== 0) {
        throw new Error(
            `${sampleName} failed with exit code ${result.code}: ${result.stderr.trim()}`
        );
    }

    const sessionDirectory = join(
        homedir(),
        ".copilot",
        "session-state",
        sessionId
    );
    await waitForFile(join(sessionDirectory, "events.jsonl"));
    const finalResponse = await readFinalAssistantMessage(sessionDirectory);
    await writeFile(
        join(sampleDirectory, "final-response.txt"),
        finalResponse,
        "utf8"
    );
    const sessionProfile = await profileSession(sessionDirectory, {
        declaredRuntimeVersion: runtimeVersion
    });
    writeProfileArtifacts(
        sessionProfile,
        join(output, "session-profiles")
    );
    const manifestPath = join(
        output,
        "run-manifests",
        `${sampleName}.json`
    );
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeJson(manifestPath, {
        schema_version: SCHEMA_VERSION,
        run_id: `pace-hosted-${sampleName}-${sessionId}`,
        sessions: [
            {
                id: "primary",
                role: "primary",
                artifact: sessionDirectory,
                billing: "independent",
                declared_runtime_version: runtimeVersion
            }
        ]
    });
    const runProfile = await profileRunManifest(manifestPath);
    const runPaths = writeRunArtifacts(runProfile, join(output, "profiles"));
    const runProfileSha256 = (await sha256File(runPaths.jsonPath)).sha256;
    return {
        side,
        index,
        stdout: finalResponse,
        rendered_stdout: result.stdout.trim(),
        sessionProfile,
        runProfile,
        runPaths,
        runProfileSha256
    };
}

async function runDeterministicSample({ index, output }) {
    const side = "candidate";
    const sampleName = `${side}-${index + 1}`;
    const sampleDirectory = join(output, "raw", sampleName);
    mkdirSync(sampleDirectory, { recursive: true });
    const runId = `pace-hosted-${sampleName}-${randomUUID()}`;
    const resultPath = join(sampleDirectory, "result.json");
    const measured = await profileDeterministicJsonTransform({
        runId,
        input: {
            id: "baseline-input",
            path: join(EXAMPLE_DIRECTORY, "baseline-input.json")
        },
        output: {
            id: `${sampleName}-result`,
            path: resultPath
        },
        transform: buildCandidateResult,
        implementationFiles: [
            {
                id: "deterministic-triage-transform",
                path: join(EXAMPLE_DIRECTORY, "prepare-input.mjs")
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

export async function runHostedReplay({
    outputDirectory,
    model = "gpt-5-mini",
    samples = 2,
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

    const [baselineInput, expected, baselinePrompt, version] =
        await Promise.all([
            readFile(
                join(EXAMPLE_DIRECTORY, "baseline-input.json"),
                "utf8"
            ).then(JSON.parse),
            readFile(
                join(EXAMPLE_DIRECTORY, "expected-result.json"),
                "utf8"
            ).then(JSON.parse),
            readFile(
                join(EXAMPLE_DIRECTORY, "baseline-prompt.txt"),
                "utf8"
            ),
            copilotVersion(copilotCommand)
        ]);
    const candidateInput = buildCandidateResult(baselineInput);
    if (JSON.stringify(candidateInput) !== JSON.stringify(expected)) {
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
    writeJson(baselineConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "model-free-v2",
        model,
        copilot_cli_version: version,
        tool_allowlist: ["view"],
        input: "baseline-input.json",
        prompt: "baseline-prompt.txt",
        execution_order: executionOrder.map((entry) => entry.sample)
    });
    writeJson(candidateConfigPath, {
        schema_version: SCHEMA_VERSION,
        experiment: "model-free-v2",
        runtime: candidateRuntimeSignature,
        input: "baseline-input.json",
        runner: "profile-deterministic-run.mjs",
        implementation: "prepare-input.mjs",
        execution_contract: "synchronous_local_json_transform_v1",
        execution_order: executionOrder.map((entry) => entry.sample)
    });

    const baselineRuns = new Array(samples);
    const candidateRuns = new Array(samples);
    for (const entry of executionOrder) {
        const run =
            entry.side === "baseline"
                ? await runSample({
                      side: entry.side,
                      index: entry.index,
                      output,
                      prompt: baselinePrompt,
                      model,
                      runtimeVersion: version,
                      maxAiCredits,
                      copilotCommand
                  })
                : await runDeterministicSample({
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
                candidateQuality.flatMap((result) => result.evaluation.issues)
            )
        ],
        lost_findings: [
            ...new Set(
                candidateQuality.flatMap(
                    (result) => result.evaluation.lost_findings
                )
            )
        ]
    });

    const [
        workloadInputHash,
        expectedHash,
        evaluatorHash,
        orchestratorHash,
        baselinePromptHash,
        deterministicRunnerHash,
        preprocessorHash,
        baselineConfigHash,
        candidateConfigHash
    ] = await Promise.all([
        sha256File(join(EXAMPLE_DIRECTORY, "baseline-input.json")),
        sha256File(join(EXAMPLE_DIRECTORY, "expected-result.json")),
        sha256File(join(EXAMPLE_DIRECTORY, "evaluate-output.mjs")),
        sha256File(import.meta.url),
        sha256File(join(EXAMPLE_DIRECTORY, "baseline-prompt.txt")),
        sha256File(
            join(EXAMPLE_DIRECTORY, "..", "..", "profile-deterministic-run.mjs")
        ),
        sha256File(join(EXAMPLE_DIRECTORY, "prepare-input.mjs")),
        sha256File(baselineConfigPath),
        sha256File(candidateConfigPath)
    ]);
    const replayPath = join(output, "replay.json");
    writeJson(replayPath, {
        schema_version: SCHEMA_VERSION,
        replay_id: "pace-hosted-triage-model-free-replay-v2",
        evaluator: {
            id: EVALUATOR_ID,
            files: [
                {
                    id: "evaluator",
                    path: relative(
                        output,
                        join(EXAMPLE_DIRECTORY, "evaluate-output.mjs")
                    ),
                    sha256: evaluatorHash.sha256
                }
            ]
        },
        workload: {
            corpus_id: CORPUS_ID,
            source_revision: SOURCE_REVISION,
            files: [
                {
                    id: "baseline-input",
                    path: relative(
                        output,
                        join(EXAMPLE_DIRECTORY, "baseline-input.json")
                    ),
                    sha256: workloadInputHash.sha256
                },
                {
                    id: "expected-result",
                    path: relative(
                        output,
                        join(EXAMPLE_DIRECTORY, "expected-result.json")
                    ),
                    sha256: expectedHash.sha256
                }
            ]
        },
        cohorts: {
            baseline: {
                configuration: {
                    id: "pace-hosted-baseline-v2",
                    files: [
                        {
                            id: "configuration",
                            path: "baseline-config.json",
                            sha256: baselineConfigHash.sha256
                        },
                        {
                            id: "prompt",
                            path: relative(
                                output,
                                join(
                                    EXAMPLE_DIRECTORY,
                                    "baseline-prompt.txt"
                                )
                            ),
                            sha256: baselinePromptHash.sha256
                        },
                        {
                            id: "orchestrator",
                            path: relative(
                                output,
                                join(
                                    EXAMPLE_DIRECTORY,
                                    "run-hosted-replay.mjs"
                                )
                            ),
                            sha256: orchestratorHash.sha256
                        }
                    ],
                    expected_runtime: [baselineRuntimeSignature]
                },
                profiles: baselineRuns.map((run) =>
                    relative(output, run.runPaths.jsonPath)
                )
            },
            candidate: {
                configuration: {
                    id: "pace-hosted-model-free-candidate-v2",
                    files: [
                        {
                            id: "configuration",
                            path: "candidate-config.json",
                            sha256: candidateConfigHash.sha256
                        },
                        {
                            id: "runner",
                            path: relative(
                                output,
                                join(
                                    EXAMPLE_DIRECTORY,
                                    "..",
                                    "..",
                                    "profile-deterministic-run.mjs"
                                )
                            ),
                            sha256: deterministicRunnerHash.sha256
                        },
                        {
                            id: "implementation",
                            path: relative(
                                output,
                                join(
                                    EXAMPLE_DIRECTORY,
                                    "prepare-input.mjs"
                                )
                            ),
                            sha256: preprocessorHash.sha256
                        },
                        {
                            id: "orchestrator",
                            path: relative(
                                output,
                                join(
                                    EXAMPLE_DIRECTORY,
                                    "run-hosted-replay.mjs"
                                )
                            ),
                            sha256: orchestratorHash.sha256
                        }
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
        comparison_id: "pace-hosted-triage-model-free-comparison-v2",
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

function usage() {
    return [
        "Usage: node run-hosted-replay.mjs [options]",
        "",
        "Options:",
        "  -o, --out <directory>        Required output directory",
        "      --model <model>           Copilot model (default: gpt-5-mini)",
        "      --samples <count>         Samples per cohort (default: 2)",
        "      --max-ai-credits <count>  Per-session ceiling (default/minimum: 30)",
        "  -h, --help                   Show this help"
    ].join("\n");
}

function parseArguments(argv) {
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

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const result = await runHostedReplay({
            outputDirectory: args.output,
            model: args.model,
            samples: args.samples,
            maxAiCredits: args.maxAiCredits
        });
        process.stdout.write(
            `${result.comparison.disposition}\n${result.paths.replay}\n${result.paths.comparison}\n${result.paths.comparisonReport}\n`
        );
    } catch (error) {
        process.stderr.write(`hosted replay failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
