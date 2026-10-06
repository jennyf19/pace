import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { sha256File } from "./build-replay-manifest.mjs";
import { composeRunProfiles } from "./compose-run-profiles.mjs";
import { profileDeterministicJsonTransform } from "./profile-deterministic-run.mjs";
import { writeRunArtifacts } from "./profile-run.mjs";
import { runCopilotSample } from "./run-copilot-sample.mjs";

const SCHEMA_VERSION = "0.1";
const RESIDUAL_MODES = new Set(["file-view", "inline-tool-less"]);

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildInlineResidualPrompt(template, residualInput) {
    if (typeof template !== "string" || !template.trim()) {
        throw new Error("inline residual prompt template is required");
    }
    return `${template.trim()}\n\nResidual input JSON:\n${JSON.stringify(residualInput)}`;
}

export function buildTransformImplementationFiles({
    implementationPath,
    implementationPaths
}) {
    const paths = implementationPaths ?? [implementationPath];
    if (
        paths.length === 0 ||
        paths.some((path) => typeof path !== "string" || !path)
    ) {
        throw new Error("at least one implementation path is required");
    }
    return paths.map((path, index) => ({
        id:
            index === 0
                ? "hybrid-transform"
                : `hybrid-transform-${index + 1}`,
        path
    }));
}

export async function runHybridCompositeSample({
    side,
    index,
    output,
    sourceInput,
    inputPath,
    implementationPath,
    implementationPaths,
    residualMode,
    residualPrompt,
    inlinePromptTemplate,
    preprocessTransform,
    mergeTransform,
    model,
    runtimeVersion,
    maxAiCredits,
    copilotCommand,
    experimentPrefix,
    reasoningEffort = "medium",
    runResidualSample
}) {
    if (!RESIDUAL_MODES.has(residualMode)) {
        throw new Error(
            "residualMode must be file-view or inline-tool-less"
        );
    }
    const transformImplementationFiles =
        buildTransformImplementationFiles({
            implementationPath,
            implementationPaths
        });
    const sampleName = `${side}-${index + 1}`;
    const sampleDirectory = join(output, "raw", sampleName);
    mkdirSync(sampleDirectory, { recursive: true });

    const preprocessPath = join(sampleDirectory, "residual-input.json");
    const preprocess = await profileDeterministicJsonTransform({
        runId: `${experimentPrefix}-${sampleName}-preprocess-${randomUUID()}`,
        input: {
            id: "hybrid-source-input",
            path: inputPath
        },
        output: {
            id: `${sampleName}-residual-input`,
            path: preprocessPath
        },
        transform: preprocessTransform,
        implementationFiles: transformImplementationFiles
    });
    const preprocessPaths = writeRunArtifacts(
        preprocess.profile,
        join(output, "component-profiles")
    );

    const toolLess = residualMode === "inline-tool-less";
    const prompt = toolLess
        ? buildInlineResidualPrompt(
              inlinePromptTemplate,
              preprocess.result
          )
        : residualPrompt;
    const residualSampleName = `${sampleName}-residual`;
    const residual = runResidualSample
        ? await runResidualSample({
              output,
              sampleName: residualSampleName,
              prompt,
              model,
              reasoningEffort,
              runIdPrefix: `${experimentPrefix}-residual`
          })
        : await runCopilotSample({
              output,
              sampleName: residualSampleName,
              workspaceFiles: toolLess
                  ? []
                  : [
                        {
                            path: preprocessPath,
                            name: "residual-input.json"
                        }
                    ],
              prompt,
              model,
              runtimeVersion,
              maxAiCredits,
              copilotCommand,
              sessionName: `${experimentPrefix}-${sampleName}-residual`,
              runIdPrefix: `${experimentPrefix}-residual`,
              availableTools: toolLess ? [] : ["view"],
              reasoningEffort
          });
    let residualRoutes;
    try {
        residualRoutes = JSON.parse(residual.stdout);
    } catch {
        throw new Error(`${sampleName} residual model output is not JSON`);
    }

    const mergeInputPath = join(sampleDirectory, "merge-input.json");
    writeJson(mergeInputPath, {
        source: sourceInput,
        residual_routes: residualRoutes
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
        transform: mergeTransform,
        implementationFiles: transformImplementationFiles
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
            {
                id: "residual-model",
                role: "semantic-residual",
                profile: relative(
                    compositeDirectory,
                    residual.runPaths.jsonPath
                )
            },
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
        residualMode,
        stdout: JSON.stringify(merge.result),
        rendered_stdout: residual.rendered_stdout,
        runProfile,
        runPaths,
        runProfileSha256
    };
}
