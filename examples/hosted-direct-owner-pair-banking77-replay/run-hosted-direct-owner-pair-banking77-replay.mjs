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
    "prepare-banking77-workload.mjs"
);

export const BANKING77_OWNER_PAIR_TREATMENTS = Object.freeze({
    baseline: Object.freeze({
        configurationId:
            "pace-banking77-route-objects-pair-control-low-v3",
        experimentPrefix:
            "pace-banking77-route-objects-pair-control-low-v3",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "route-objects-with-ids"
    }),
    candidate: Object.freeze({
        configurationId:
            "pace-banking77-explicit-owner-pairs-low-v3",
        experimentPrefix:
            "pace-banking77-explicit-owner-pairs-low-v3",
        residualMode: "inline-tool-less",
        availableTools: Object.freeze([]),
        reasoningEffort: "low",
        responseRepresentation: "ordered-explicit-id-owner-pairs"
    })
});

export const BANKING77_OWNER_PAIR_SCENARIO = Object.freeze({
    workloadDirectory: EXAMPLE_DIRECTORY,
    corpusId: "pace-banking77-test-step15-5x8-corpus-v1",
    sourceRevision: "pace-banking77-owner-pair-v3",
    experimentId: "banking77-owner-pair-v3",
    replayId: "pace-banking77-owner-pair-replay-v3",
    comparisonId: "pace-banking77-owner-pair-comparison-v3",
    baselineSchemaName:
        "banking77_route_objects_pair_control_40_v3",
    candidateSchemaName: "banking77_explicit_id_owner_pairs_40_v3",
    treatments: BANKING77_OWNER_PAIR_TREATMENTS,
    configurationFiles: Object.freeze([
        Object.freeze({
            id: "banking77-scenario-runner",
            path: RUNNER_PATH
        }),
        Object.freeze({
            id: "banking77-workload-builder",
            path: WORKLOAD_BUILDER_PATH
        }),
        Object.freeze({
            id: "banking77-selected-source",
            path: resolve(EXAMPLE_DIRECTORY, "selected-source.json")
        }),
        Object.freeze({
            id: "banking77-source-manifest",
            path: resolve(EXAMPLE_DIRECTORY, "source-manifest.json")
        }),
        Object.freeze({
            id: "banking77-attribution",
            path: resolve(EXAMPLE_DIRECTORY, "BANKING77-ATTRIBUTION.md")
        }),
        Object.freeze({
            id: "banking77-license",
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

export async function runBanking77OwnerPairReplay(options) {
    return runHostedDirectOwnerPairReplay({
        ...options,
        scenario: BANKING77_OWNER_PAIR_SCENARIO
    });
}

async function main() {
    try {
        const args = parseDirectReplayArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(
                `${hostedReplayUsage("run-hosted-direct-owner-pair-banking77-replay.mjs")}\n      --provider-config <path>   Private direct-provider JSON config\n`
            );
            return;
        }
        const result = await runBanking77OwnerPairReplay({
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
            `Banking77 owner-pair replay failed: ${error.message}\n`
        );
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
