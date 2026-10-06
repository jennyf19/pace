import assert from "node:assert/strict";
import test from "node:test";
import {
    DIRECT_JSON_MODE_TREATMENTS,
    JSON_OBJECT_RESPONSE_FORMAT,
    RESIDUAL_ROUTES_RESPONSE_FORMAT
} from "../examples/hosted-direct-json-mode-replay/run-hosted-direct-json-mode-replay.mjs";

test("direct JSON mode replay changes only response format detail", () => {
    const { baseline, candidate } = DIRECT_JSON_MODE_TREATMENTS;

    assert.equal(baseline.residualMode, "inline-tool-less");
    assert.equal(candidate.residualMode, baseline.residualMode);
    assert.deepEqual(baseline.availableTools, []);
    assert.deepEqual(candidate.availableTools, baseline.availableTools);
    assert.equal(baseline.reasoningEffort, "low");
    assert.equal(candidate.reasoningEffort, baseline.reasoningEffort);
    assert.equal(baseline.outputContract, "strict-json-schema");
    assert.equal(candidate.outputContract, "json-object");
    assert.equal(baseline.structuredOutput, true);
    assert.equal(candidate.structuredOutput, true);
});

test("JSON-object candidate omits the strict route schema", () => {
    assert.deepEqual(JSON_OBJECT_RESPONSE_FORMAT, {
        type: "json_object"
    });
    assert.equal(RESIDUAL_ROUTES_RESPONSE_FORMAT.type, "json_schema");
    assert.ok(RESIDUAL_ROUTES_RESPONSE_FORMAT.schema);
});
