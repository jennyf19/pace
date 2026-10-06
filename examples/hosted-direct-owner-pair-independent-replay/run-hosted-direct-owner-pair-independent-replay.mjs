import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    hostedReplayUsage,
    parseHostedReplayArguments
} from "../../run-hosted-model-free-replay.mjs";
import {
    runHostedDirectOwnerPairReplay
} from "../hosted-direct-owner-pair-replay/run-hosted-direct-owner-pair-replay.mjs";

const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = fileURLToPath(import.meta.url);
const WORKLOAD_BUILDER_PATH = resolve(
    EXAMPLE_DIRECTORY,
    "prepare-independent-workload.mjs"
);

export const INDEPENDENT_OWNER_PAIR_TREATMENTS = Object.freeze({
    baseline: Object.freeze({
        configurationId:
            "pace-independent-route-objects-pair-control-low-v1",
        experimentPrefix:
            "pace-independent-route-objects-pair-control-low-v1",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "route-objects-with-ids"
    }),
    candidate: Object.freeze({
        configurationId:
            "pace-independent-explicit-owner-pairs-low-v1",
        experimentPrefix:
            "pace-independent-explicit-owner-pairs-low-v1",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "ordered-explicit-id-owner-pairs"
    })
});

export const INDEPENDENT_OWNER_PAIR_SCENARIO = Object.freeze({
    workloadDirectory: EXAMPLE_DIRECTORY,
    corpusId: "pace-independent-operations-routing-40-corpus-v1",
    sourceRevision: "pace-independent-owner-pair-v1",
    experimentId: "independent-owner-pair-v1",
    replayId: "pace-independent-owner-pair-replay-v1",
    comparisonId: "pace-independent-owner-pair-comparison-v1",
    baselineSchemaName:
        "independent_route_objects_pair_control_40_v1",
    candidateSchemaName: "independent_explicit_id_owner_pairs_40_v1",
    treatments: INDEPENDENT_OWNER_PAIR_TREATMENTS,
    configurationFiles: Object.freeze([
        Object.freeze({
            id: "independent-scenario-runner",
            path: RUNNER_PATH
        }),
        Object.freeze({
            id: "independent-workload-builder",
            path: WORKLOAD_BUILDER_PATH
        })
    ])
});

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

export async function runIndependentOwnerPairReplay(options) {
    return runHostedDirectOwnerPairReplay({
        ...options,
        scenario: INDEPENDENT_OWNER_PAIR_SCENARIO
    });
}

async function main() {
    try {
        const args = parseDirectReplayArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(
                `${hostedReplayUsage("run-hosted-direct-owner-pair-independent-replay.mjs")}\n      --provider-config <path>   Private direct-provider JSON config\n`
            );
            return;
        }
        const result = await runIndependentOwnerPairReplay({
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
            `independent owner-pair replay failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
