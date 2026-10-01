import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    runHostedModelFreeReplay,
    runHostedModelFreeReplayCli
} from "../../run-hosted-model-free-replay.mjs";
import { evaluateOutput } from "./evaluate-output.mjs";
import { buildRoutingResult } from "./prepare-routing.mjs";

const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SCENARIO = {
    slug: "hosted-routing",
    experiment: "dedupe-owner-routing-v1",
    directory: EXAMPLE_DIRECTORY,
    entrypoint: fileURLToPath(import.meta.url),
    corpusId: "pace-hosted-routing-corpus-v1",
    evaluatorId: "pace-exact-routing-evaluator-v1",
    sourceRevision: "pace-hosted-routing-dedupe-v1",
    replayId: "pace-hosted-routing-replay-v1",
    comparisonId: "pace-hosted-routing-comparison-v1",
    baselineConfigurationId: "pace-hosted-routing-baseline-v1",
    candidateConfigurationId: "pace-hosted-routing-candidate-v1",
    implementationFile: "prepare-routing.mjs",
    implementationId: "deterministic-dedupe-routing-transform",
    transform: buildRoutingResult,
    evaluateOutput
};

export async function runHostedRoutingReplay(options) {
    return runHostedModelFreeReplay({
        ...options,
        scenario: SCENARIO
    });
}

async function main() {
    try {
        await runHostedModelFreeReplayCli(SCENARIO, {
            scriptName: "run-hosted-routing-replay.mjs"
        });
    } catch (error) {
        process.stderr.write(`hosted routing replay failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
