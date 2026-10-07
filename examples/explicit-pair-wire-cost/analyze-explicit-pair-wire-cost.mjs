import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buildResponsesRequest } from "../../run-direct-model-sample.mjs";
import { buildInlineResidualPrompt } from "../../run-hybrid-sample.mjs";
import {
    BANKING77_TEN_OWNER_PAIR_SCENARIO
} from "../hosted-direct-owner-pair-banking77-10-replay/run-hosted-direct-owner-pair-banking77-10-replay.mjs";
import {
    BANKING77_OWNER_PAIR_SCENARIO
} from "../hosted-direct-owner-pair-banking77-replay/run-hosted-direct-owner-pair-banking77-replay.mjs";
import {
    DEFAULT_OWNER_PAIR_SCENARIO
} from "../hosted-direct-owner-pair-replay/run-hosted-direct-owner-pair-replay.mjs";
import {
    buildFullOwnerResidualInput,
    buildFullOwnerResultFromMergeInput,
    buildOwnerPairResponseFormat,
    buildRouteObjectResponseFormat,
    decodeOwnerPairMergeInput
} from "../hosted-direct-owner-pair-replay/prepare-owner-pair.mjs";

const SCHEMA_VERSION = "0.1";
const ANALYSIS_ID = "explicit-pair-wire-cost-v1";
const DEPLOYMENT_PLACEHOLDER = "shared-deployment";
const MAX_OUTPUT_TOKENS = 2048;
const REASONING_EFFORT = "low";
const BASELINE_PROMPT_URL = new URL(
    "../hosted-residual-overhead-replay/inline-residual-prompt.txt",
    import.meta.url
);
const CANDIDATE_PROMPT_URL = new URL(
    "../hosted-direct-owner-pair-replay/inline-owner-pair-prompt.txt",
    import.meta.url
);

const SCENARIOS = Object.freeze([
    Object.freeze({
        id: "synthetic-routing-64",
        scenario: DEFAULT_OWNER_PAIR_SCENARIO,
        evidence_status: "replicated-n5",
        comparison_receipt: "sha256:512082b98c889136",
        observed: Object.freeze({
            samples_per_arm: 5,
            exact_quality_passes_per_arm: 5,
            input_tokens_p50: Object.freeze({
                baseline: 1868,
                candidate: 1857
            }),
            visible_answer_tokens_p50: Object.freeze({
                baseline: 631,
                candidate: 480
            })
        })
    }),
    Object.freeze({
        id: "banking77-five-intent-40",
        scenario: BANKING77_OWNER_PAIR_SCENARIO,
        evidence_status: "replicated-n5",
        comparison_receipt: "sha256:c04712d51628cc68",
        observed: Object.freeze({
            samples_per_arm: 5,
            exact_quality_passes_per_arm: 5,
            input_tokens_p50: Object.freeze({
                baseline: 1564,
                candidate: 1556
            }),
            visible_answer_tokens_p50: Object.freeze({
                baseline: 643,
                candidate: 580
            })
        })
    }),
    Object.freeze({
        id: "banking77-ten-intent-40",
        scenario: BANKING77_TEN_OWNER_PAIR_SCENARIO,
        evidence_status: "discovery-n3-replication-transport-blocked",
        comparison_receipt: "sha256:95351833bcad999d",
        observed: Object.freeze({
            samples_per_arm: 3,
            exact_quality_passes_per_arm: 3,
            input_tokens_p50: Object.freeze({
                baseline: 1705,
                candidate: 1697
            }),
            visible_answer_tokens_p50: Object.freeze({
                baseline: 654,
                candidate: 551
            })
        })
    })
]);

function utf8Bytes(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return Buffer.byteLength(text, "utf8");
}

function round(value, digits = 3) {
    return Number(value.toFixed(digits));
}

function compareSizes(baseline, candidate) {
    const saved = baseline - candidate;
    return {
        baseline,
        candidate,
        saved,
        reduction_percent: round((saved / baseline) * 100)
    };
}

function requireExactResult(actual, expected, label) {
    if (!isDeepStrictEqual(actual, expected)) {
        throw new Error(`${label} does not reproduce the frozen expected result`);
    }
}

function observedSavings(observed) {
    return {
        input_tokens:
            observed.input_tokens_p50.baseline -
            observed.input_tokens_p50.candidate,
        visible_answer_tokens:
            observed.visible_answer_tokens_p50.baseline -
            observed.visible_answer_tokens_p50.candidate
    };
}

async function analyzeScenario(descriptor, promptTemplates) {
    const directory = resolve(descriptor.scenario.workloadDirectory);
    const [source, groundTruth, expected] = await Promise.all([
        readFile(resolve(directory, "baseline-input.json"), "utf8").then(
            JSON.parse
        ),
        readFile(
            resolve(directory, "ground-truth-routes.json"),
            "utf8"
        ).then(JSON.parse),
        readFile(resolve(directory, "expected-result.json"), "utf8").then(
            JSON.parse
        )
    ]);
    const residual = buildFullOwnerResidualInput(source);
    const ownerById = new Map(
        groundTruth.routes.map((route) => [route.id, route.owner])
    );
    const pairs = residual.residual_findings.map((finding) => {
        const owner = ownerById.get(finding.id);
        if (typeof owner !== "string") {
            throw new Error(
                `${descriptor.id} has no ground-truth owner for ${finding.id}`
            );
        }
        return [finding.id, owner];
    });
    if (ownerById.size !== pairs.length) {
        throw new Error(
            `${descriptor.id} ground truth does not contain one route per finding`
        );
    }

    const baselineOutput = {
        schema_version: SCHEMA_VERSION,
        routes: groundTruth.routes
    };
    const candidateOutput = {
        schema_version: SCHEMA_VERSION,
        pairs
    };
    requireExactResult(
        buildFullOwnerResultFromMergeInput({
            source,
            residual_routes: baselineOutput
        }),
        expected,
        `${descriptor.id} route objects`
    );
    requireExactResult(
        decodeOwnerPairMergeInput({
            source,
            residual_routes: candidateOutput
        }),
        expected,
        `${descriptor.id} explicit pairs`
    );

    const baselinePrompt = buildInlineResidualPrompt(
        promptTemplates.baseline,
        residual
    );
    const candidatePrompt = buildInlineResidualPrompt(
        promptTemplates.candidate,
        residual
    );
    const baselineFormat = buildRouteObjectResponseFormat(
        source,
        descriptor.scenario.baselineSchemaName
    );
    const candidateFormat = buildOwnerPairResponseFormat(
        source,
        descriptor.scenario.candidateSchemaName
    );
    const baselineRequest = buildResponsesRequest({
        deployment: DEPLOYMENT_PLACEHOLDER,
        prompt: baselinePrompt,
        reasoningEffort: REASONING_EFFORT,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseFormat: baselineFormat
    });
    const candidateRequest = buildResponsesRequest({
        deployment: DEPLOYMENT_PLACEHOLDER,
        prompt: candidatePrompt,
        reasoningEffort: REASONING_EFFORT,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseFormat: candidateFormat
    });

    const request = {
        prompt_utf8_bytes: compareSizes(
            utf8Bytes(baselinePrompt),
            utf8Bytes(candidatePrompt)
        ),
        response_format_utf8_bytes: compareSizes(
            utf8Bytes(baselineFormat),
            utf8Bytes(candidateFormat)
        ),
        serialized_request_utf8_bytes: compareSizes(
            utf8Bytes(baselineRequest),
            utf8Bytes(candidateRequest)
        )
    };
    const output = compareSizes(
        utf8Bytes(baselineOutput),
        utf8Bytes(candidateOutput)
    );
    const observed = {
        ...descriptor.observed,
        savings: observedSavings(descriptor.observed)
    };
    const expectedStructuralSavings =
        13 * residual.residual_findings.length + 1;
    if (output.saved !== expectedStructuralSavings) {
        throw new Error(
            `${descriptor.id} output savings must equal 13 bytes per item plus one container-key byte`
        );
    }

    return {
        id: descriptor.id,
        corpus_id: descriptor.scenario.corpusId,
        evidence_status: descriptor.evidence_status,
        comparison_receipt: descriptor.comparison_receipt,
        item_count: residual.residual_findings.length,
        label_count: residual.allowed_owners.length,
        request,
        expected_minified_output_utf8_bytes: {
            ...output,
            formula_bytes: expectedStructuralSavings,
            average_saved_per_item: round(output.saved / pairs.length)
        },
        observed,
        calibration: {
            request_bytes_saved_per_observed_input_token: round(
                request.serialized_request_utf8_bytes.saved /
                    observed.savings.input_tokens
            ),
            output_bytes_saved_per_observed_visible_answer_token: round(
                output.saved / observed.savings.visible_answer_tokens
            )
        }
    };
}

export async function analyzeExplicitPairWireCost() {
    const [baseline, candidate] = await Promise.all([
        readFile(BASELINE_PROMPT_URL, "utf8"),
        readFile(CANDIDATE_PROMPT_URL, "utf8")
    ]);
    const scenarios = [];
    for (const descriptor of SCENARIOS) {
        scenarios.push(
            await analyzeScenario(descriptor, { baseline, candidate })
        );
    }
    return {
        schema_version: SCHEMA_VERSION,
        analysis_id: ANALYSIS_ID,
        method: {
            encoding: "UTF-8",
            serialization: "minified JSON",
            deployment_value:
                "shared public placeholder; the unchanged private deployment value cancels from every byte delta",
            quality_gate:
                "both deterministic representations must reproduce the frozen expected result before sizes are reported"
        },
        scenarios,
        conclusions: {
            output_savings_rule:
                "13 bytes per item plus one byte from the shorter pairs container key",
            request_effect:
                "these frozen prompt and strict-schema pairs produce small request savings relative to output savings",
            supported_use:
                "rank response representations for later quality-gated model experiments",
            unsupported_uses: [
                "predict token savings exactly",
                "predict latency",
                "replace semantic quality evaluation"
            ]
        }
    };
}

async function main() {
    const args = process.argv.slice(2);
    let output;
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--out") {
            output = args[index + 1];
            if (!output) throw new Error("--out requires a path");
            index += 1;
        } else if (args[index] === "--help") {
            process.stdout.write(
                "Usage: node analyze-explicit-pair-wire-cost.mjs [--out <path>]\n"
            );
            return;
        } else {
            throw new Error(`unknown argument: ${args[index]}`);
        }
    }
    const result = await analyzeExplicitPairWireCost();
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (output) {
        await writeFile(resolve(output), serialized, "utf8");
    } else {
        process.stdout.write(serialized);
    }
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
    main().catch((error) => {
        process.stderr.write(
            `Explicit-pair wire-cost analysis failed: ${error.message}\n`
        );
        process.exitCode = 1;
    });
}
