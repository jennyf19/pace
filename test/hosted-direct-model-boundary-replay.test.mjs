import assert from "node:assert/strict";
import test from "node:test";
import {
    DIRECT_MODEL_BOUNDARY_TREATMENTS,
    RESIDUAL_ROUTES_RESPONSE_FORMAT
} from "../examples/hosted-direct-model-boundary-replay/run-hosted-direct-model-boundary-replay.mjs";

test("direct boundary replay changes only the model host boundary", () => {
    const { baseline, candidate } = DIRECT_MODEL_BOUNDARY_TREATMENTS;

    assert.equal(baseline.residualMode, "inline-tool-less");
    assert.equal(candidate.residualMode, baseline.residualMode);
    assert.deepEqual(baseline.availableTools, []);
    assert.deepEqual(candidate.availableTools, baseline.availableTools);
    assert.equal(baseline.reasoningEffort, "low");
    assert.equal(candidate.reasoningEffort, baseline.reasoningEffort);
    assert.equal(baseline.boundary, "copilot-agent");
    assert.equal(candidate.boundary, "direct-structured-response");
});

test("direct boundary schema freezes all eight route ids and owners", () => {
    const route =
        RESIDUAL_ROUTES_RESPONSE_FORMAT.schema.properties.routes;

    assert.equal(RESIDUAL_ROUTES_RESPONSE_FORMAT.type, "json_schema");
    assert.equal(RESIDUAL_ROUTES_RESPONSE_FORMAT.strict, true);
    assert.equal(route.minItems, 8);
    assert.equal(route.maxItems, 8);
    assert.deepEqual(route.items.properties.id.enum, [
        "H017",
        "H018",
        "H019",
        "H020",
        "H021",
        "H022",
        "H023",
        "H024"
    ]);
    assert.deepEqual(route.items.properties.owner.enum, [
        "identity",
        "storage",
        "compute",
        "messaging"
    ]);
});
