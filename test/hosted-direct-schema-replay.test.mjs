import assert from "node:assert/strict";
import test from "node:test";
import {
    DIRECT_SCHEMA_TREATMENTS,
    RESIDUAL_ROUTES_RESPONSE_FORMAT
} from "../examples/hosted-direct-schema-replay/run-hosted-direct-schema-replay.mjs";

test("direct schema replay changes only response format enforcement", () => {
    const { baseline, candidate } = DIRECT_SCHEMA_TREATMENTS;

    assert.equal(baseline.residualMode, "inline-tool-less");
    assert.equal(candidate.residualMode, baseline.residualMode);
    assert.deepEqual(baseline.availableTools, []);
    assert.deepEqual(candidate.availableTools, baseline.availableTools);
    assert.equal(baseline.reasoningEffort, "low");
    assert.equal(candidate.reasoningEffort, baseline.reasoningEffort);
    assert.equal(baseline.outputContract, "strict-json-schema");
    assert.equal(candidate.outputContract, "prompt-only");
    assert.equal(baseline.structuredOutput, true);
    assert.equal(candidate.structuredOutput, false);
});

test("schema baseline reuses the frozen residual route contract", () => {
    const routes =
        RESIDUAL_ROUTES_RESPONSE_FORMAT.schema.properties.routes;

    assert.equal(RESIDUAL_ROUTES_RESPONSE_FORMAT.type, "json_schema");
    assert.equal(routes.minItems, 8);
    assert.equal(routes.maxItems, 8);
    assert.deepEqual(routes.items.required, ["id", "owner"]);
});
