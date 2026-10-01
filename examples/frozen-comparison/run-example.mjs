import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    sha256File
} from "../../build-replay-manifest.mjs";
import {
    compareRunManifest,
    writeComparisonArtifacts
} from "../../compare-runs.mjs";
import {
    profileRunManifest,
    writeRunArtifacts
} from "../../profile-run.mjs";
import { evaluateFrozenResults } from "./evaluate-results.mjs";

const EXAMPLE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runFrozenComparison(outputDirectory) {
    const output = resolve(outputDirectory);
    const profileOutput = join(output, "profiles");
    const comparisonOutput = join(output, "comparison");
    mkdirSync(profileOutput, { recursive: true });
    mkdirSync(comparisonOutput, { recursive: true });

    const [baselineProfile, candidateProfile] = await Promise.all([
        profileRunManifest(join(EXAMPLE_DIRECTORY, "baseline-run.json")),
        profileRunManifest(join(EXAMPLE_DIRECTORY, "candidate-run.json"))
    ]);
    const baselinePaths = writeRunArtifacts(baselineProfile, profileOutput);
    const candidatePaths = writeRunArtifacts(candidateProfile, profileOutput);
    const [baselineProfileHash, candidateProfileHash] = await Promise.all([
        sha256File(baselinePaths.jsonPath),
        sha256File(candidatePaths.jsonPath)
    ]);
    const quality = await evaluateFrozenResults({
        corpusPath: join(EXAMPLE_DIRECTORY, "corpus.json"),
        baselineResultPath: join(
            EXAMPLE_DIRECTORY,
            "baseline-result.json"
        ),
        candidateResultPath: join(
            EXAMPLE_DIRECTORY,
            "candidate-result.json"
        ),
        baselineRunId: baselineProfile.run_id,
        candidateRunId: candidateProfile.run_id,
        baselineRunProfileSha256: baselineProfileHash.sha256,
        candidateRunProfileSha256: candidateProfileHash.sha256
    });
    const qualityPath = join(output, "quality.json");
    writeJson(qualityPath, quality);

    const comparisonManifestPath = join(output, "comparison-manifest.json");
    writeJson(comparisonManifestPath, {
        schema_version: "0.1",
        comparison_id: "pace-frozen-comparison-v1",
        baseline_profile: relative(output, baselinePaths.jsonPath),
        candidate_profile: relative(output, candidatePaths.jsonPath),
        quality_result: relative(output, qualityPath),
        decision_metrics: [
            {
                metric: "ai_units",
                goal: "decrease"
            },
            {
                metric: "input_tokens",
                goal: "decrease"
            },
            {
                metric: "wall_time_ms",
                goal: "not_increase"
            }
        ]
    });
    const comparison = await compareRunManifest(comparisonManifestPath);
    const comparisonPaths = writeComparisonArtifacts(
        comparison,
        comparisonOutput
    );
    return {
        baselineProfile,
        candidateProfile,
        quality,
        comparison,
        paths: {
            baselineProfile: baselinePaths.jsonPath,
            candidateProfile: candidatePaths.jsonPath,
            quality: qualityPath,
            comparisonManifest: comparisonManifestPath,
            comparison: comparisonPaths.jsonPath,
            report: comparisonPaths.markdownPath
        }
    };
}

function usage() {
    return [
        "Usage: node run-example.mjs [options]",
        "",
        "Options:",
        "  -o, --out <directory>  Output directory (default: pace-output/frozen-comparison)",
        "  -h, --help             Show this help"
    ].join("\n");
}

function parseArguments(argv) {
    let output = join("pace-output", "frozen-comparison");
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "-h" || argument === "--help") return { help: true };
        if (argument === "-o" || argument === "--out") {
            index += 1;
            if (index >= argv.length) {
                throw new Error(`${argument} requires a directory`);
            }
            output = argv[index];
            continue;
        }
        throw new Error(`unknown option: ${argument}`);
    }
    return { help: false, output };
}

async function main() {
    try {
        const args = parseArguments(process.argv.slice(2));
        if (args.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const result = await runFrozenComparison(args.output);
        process.stdout.write(
            `${result.comparison.disposition}\n${result.paths.comparison}\n${result.paths.report}\n`
        );
    } catch (error) {
        process.stderr.write(`frozen comparison failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
