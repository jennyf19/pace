import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    buildExecutionOrder,
    readFinalAssistantMessage,
    runHostedModelFreeReplay,
    runHostedModelFreeReplayCli
} from "../../run-hosted-model-free-replay.mjs";
import { evaluateOutput } from "./evaluate-output.mjs";
import { buildCandidateResult } from "./prepare-input.mjs";

const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCENARIO = {
    slug: "hosted-triage",
    experiment: "model-free-v3-shared-runner",
    directory: EXAMPLE_DIRECTORY,
    entrypoint: fileURLToPath(import.meta.url),
    corpusId: "pace-hosted-triage-corpus-v1",
    evaluatorId: "pace-exact-json-evaluator-v1",
    sourceRevision: "pace-hosted-triage-model-free-v3",
    replayId: "pace-hosted-triage-model-free-replay-v3",
    comparisonId: "pace-hosted-triage-model-free-comparison-v3",
    baselineConfigurationId: "pace-hosted-baseline-v3",
    candidateConfigurationId: "pace-hosted-model-free-candidate-v3",
    implementationId: "deterministic-triage-transform",
    transform: buildCandidateResult,
    evaluateOutput
};

export { buildExecutionOrder, readFinalAssistantMessage };

export async function runHostedReplay(options) {
    return runHostedModelFreeReplay({
        ...options,
        scenario: SCENARIO
    });
}

async function main() {
    try {
        await runHostedModelFreeReplayCli(SCENARIO, {
            scriptName: "run-hosted-replay.mjs"
        });
    } catch (error) {
        process.stderr.write(`hosted replay failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
