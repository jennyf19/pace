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
    "..",
    "hosted-direct-owner-pair-banking77-replay",
    "prepare-banking77-workload.mjs"
);

export const BANKING77_TEN_OWNER_PAIR_TREATMENTS = Object.freeze({
    baseline: Object.freeze({
        configurationId:
            "pace-banking77-ten-route-objects-pair-control-low-v2",
        experimentPrefix:
            "pace-banking77-ten-route-objects-pair-control-low-v2",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "route-objects-with-ids"
    }),
    candidate: Object.freeze({
        configurationId:
            "pace-banking77-ten-explicit-owner-pairs-low-v2",
        experimentPrefix:
            "pace-banking77-ten-explicit-owner-pairs-low-v2",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "ordered-explicit-id-owner-pairs"
    })
});

export const BANKING77_TEN_OWNER_PAIR_SCENARIO = Object.freeze({
    workloadDirectory: EXAMPLE_DIRECTORY,
    corpusId: "pace-banking77-test-step8-10x4-corpus-v1",
    sourceRevision: "pace-banking77-ten-owner-pair-v2",
    experimentId: "banking77-ten-owner-pair-v2",
    replayId: "pace-banking77-ten-owner-pair-replay-v2",
    comparisonId: "pace-banking77-ten-owner-pair-comparison-v2",
    baselineSchemaName:
        "banking77_ten_route_objects_pair_control_40_v2",
    candidateSchemaName:
        "banking77_ten_explicit_id_owner_pairs_40_v2",
    treatments: BANKING77_TEN_OWNER_PAIR_TREATMENTS,
    configurationFiles: Object.freeze([
        Object.freeze({
            id: "banking77-ten-scenario-runner",
            path: RUNNER_PATH
        }),
        Object.freeze({
            id: "banking77-workload-builder",
            path: WORKLOAD_BUILDER_PATH
        }),
        Object.freeze({
            id: "banking77-ten-selection-config",
            path: resolve(EXAMPLE_DIRECTORY, "selection-config.json")
        }),
        Object.freeze({
            id: "banking77-ten-selected-source",
            path: resolve(EXAMPLE_DIRECTORY, "selected-source.json")
        }),
        Object.freeze({
            id: "banking77-ten-source-manifest",
            path: resolve(EXAMPLE_DIRECTORY, "source-manifest.json")
        }),
        Object.freeze({
            id: "banking77-ten-attribution",
            path: resolve(EXAMPLE_DIRECTORY, "BANKING77-ATTRIBUTION.md")
        }),
        Object.freeze({
            id: "banking77-ten-license",
            path: resolve(EXAMPLE_DIRECTORY, "LICENSE-BANKING77.txt")
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

export async function runBanking77TenOwnerPairReplay(options) {
    return runHostedDirectOwnerPairReplay({
        ...options,
        scenario: BANKING77_TEN_OWNER_PAIR_SCENARIO
    });
}

async function main() {
    try {
        const args = parseDirectReplayArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(
                `${hostedReplayUsage("run-hosted-direct-owner-pair-banking77-10-replay.mjs")}\n      --provider-config <path>   Private direct-provider JSON config\n`
            );
            return;
        }
        const result = await runBanking77TenOwnerPairReplay({
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
            `Banking77 ten-intent owner-pair replay failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
