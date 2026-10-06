import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateRunProfile } from "../compare-runs.mjs";
import {
    buildResponsesRequest,
    directModelRuntimeSignature,
    runDirectModelSample
} from "../run-direct-model-sample.mjs";

test("builds a structured Responses API request", () => {
    const format = {
        type: "json_schema",
        name: "result",
        strict: true,
        schema: {
            type: "object",
            properties: {
                ok: { type: "boolean" }
            },
            required: ["ok"],
            additionalProperties: false
        }
    };
    assert.deepEqual(
        buildResponsesRequest({
            deployment: "private-deployment",
            prompt: "Return JSON.",
            reasoningEffort: "low",
            maxOutputTokens: 128,
            responseFormat: format
        }),
        {
            model: "private-deployment",
            input: "Return JSON.",
            reasoning: { effort: "low" },
            max_output_tokens: 128,
            store: false,
            text: { format }
        }
    );
});

test("profiles a direct model response without retaining secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-direct-model-"));
    let request;
    try {
        const result = await runDirectModelSample({
            output: directory,
            sampleName: "candidate-1-residual",
            prompt: "private prompt text",
            responsesUrl: "https://example.openai.azure.com/openai/v1/responses",
            authorizationHeader: "Bearer private-secret",
            provider: "azure-openai-responses",
            apiVersion: "v1",
            deployment: "private-deployment",
            model: "gpt-5-mini",
            modelVersion: "2025-08-07",
            reasoningEffort: "low",
            maxOutputTokens: 128,
            responseFormat: {
                type: "json_schema",
                name: "result",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        ok: { type: "boolean" }
                    },
                    required: ["ok"],
                    additionalProperties: false
                }
            },
            runIdPrefix: "pace-direct-test",
            fetchImpl: async (url, options) => {
                request = { url: String(url), options };
                return new Response(
                    JSON.stringify({
                        id: "response-private-id",
                        status: "completed",
                        model: "gpt-5-mini",
                        output: [
                            {
                                type: "message",
                                content: [
                                    {
                                        type: "output_text",
                                        text: "{\"ok\":true}"
                                    }
                                ]
                            }
                        ],
                        usage: {
                            input_tokens: 100,
                            input_tokens_details: {
                                cached_tokens: 20
                            },
                            output_tokens: 40,
                            output_tokens_details: {
                                reasoning_tokens: 16
                            }
                        }
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" }
                    }
                );
            }
        });

        assert.equal(result.stdout, "{\"ok\":true}");
        assert.equal(result.profile.totals.input_tokens, 100);
        assert.equal(result.profile.totals.non_cached_input_tokens, 80);
        assert.equal(result.profile.totals.output_tokens, 40);
        assert.equal(result.profile.totals.reasoning_tokens, 16);
        assert.equal(result.profile.totals.tool_definition_tokens, 0);
        assert.equal(result.profile.totals.ai_units, null);
        assert.equal(
            result.profile.accounting.metric_coverage.ai_units.complete,
            false
        );
        assert.equal(
            validateRunProfile(result.profile, "direct profile"),
            result.profile
        );
        assert.equal(request.options.redirect, "error");
        assert.equal(
            request.options.headers.authorization,
            "Bearer private-secret"
        );

        const serialized = JSON.stringify(result.profile);
        assert.doesNotMatch(serialized, /private-secret/);
        assert.doesNotMatch(serialized, /private prompt text/);
        assert.doesNotMatch(serialized, /private-deployment/);
        assert.doesNotMatch(serialized, /example\.openai\.azure\.com/);
        assert.doesNotMatch(serialized, /response-private-id/);

        const usage = JSON.parse(
            await readFile(
                join(
                    directory,
                    "raw",
                    "candidate-1-residual",
                    "usage.json"
                ),
                "utf8"
            )
        );
        assert.equal(usage.model, "gpt-5-mini");
        assert.equal(usage.usage.input_tokens, 100);
        assert.doesNotMatch(JSON.stringify(usage), /private-secret/);
        assert.doesNotMatch(JSON.stringify(usage), /private prompt text/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("rejects insecure remote endpoints and missing usage", async () => {
    const signature = directModelRuntimeSignature({
        provider: "provider",
        apiVersion: "v1",
        model: "model",
        reasoningEffort: "low"
    });
    assert.deepEqual(signature.models, ["model"]);

    await assert.rejects(
        runDirectModelSample({
            output: tmpdir(),
            sampleName: "insecure",
            prompt: "prompt",
            responsesUrl: "http://example.com/v1/responses",
            authorizationHeader: "Bearer secret",
            provider: "provider",
            deployment: "deployment",
            model: "model",
            modelVersion: "1",
            runIdPrefix: "run",
            fetchImpl: async () => {
                throw new Error("should not run");
            }
        }),
        /must use HTTPS/
    );

    const directory = await mkdtemp(
        join(tmpdir(), "pace-direct-model-missing-")
    );
    try {
        await assert.rejects(
            runDirectModelSample({
                output: directory,
                sampleName: "missing-usage",
                prompt: "prompt",
                responsesUrl: "http://127.0.0.1:1234/v1/responses",
                authorizationHeader: "Bearer secret",
                provider: "provider",
                deployment: "deployment",
                model: "model",
                modelVersion: "1",
                runIdPrefix: "run",
                fetchImpl: async () =>
                    new Response(
                        JSON.stringify({
                            id: "response",
                            status: "completed",
                            model: "model",
                            output: [
                                {
                                    content: [
                                        {
                                            type: "output_text",
                                            text: "{}"
                                        }
                                    ]
                                }
                            ]
                        }),
                        { status: 200 }
                    )
            }),
            /requires input_tokens and output_tokens/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("reports the provider reason for an incomplete response", async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "pace-direct-model-incomplete-")
    );
    try {
        await assert.rejects(
            runDirectModelSample({
                output: directory,
                sampleName: "incomplete",
                prompt: "prompt",
                responsesUrl: "http://127.0.0.1:1234/v1/responses",
                authorizationHeader: "******",
                provider: "provider",
                deployment: "deployment",
                model: "model",
                modelVersion: "1",
                runIdPrefix: "run",
                fetchImpl: async () =>
                    new Response(
                        JSON.stringify({
                            id: "response",
                            status: "incomplete",
                            incomplete_details: {
                                reason: "max_output_tokens"
                            },
                            model: "model"
                        }),
                        { status: 200 }
                    )
            }),
            /got incomplete \(max_output_tokens\)/
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
