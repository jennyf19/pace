import assert from "node:assert/strict";
import test from "node:test";
import { REASONING_EFFORT_TREATMENTS } from "../examples/hosted-reasoning-effort-replay/run-hosted-reasoning-effort-replay.mjs";

test("reasoning replay changes only reasoning effort", () => {
    const { baseline, candidate } = REASONING_EFFORT_TREATMENTS;

    assert.equal(baseline.residualMode, "inline-tool-less");
    assert.equal(candidate.residualMode, baseline.residualMode);
    assert.deepEqual(baseline.availableTools, []);
    assert.deepEqual(candidate.availableTools, baseline.availableTools);
    assert.equal(baseline.reasoningEffort, "medium");
    assert.equal(candidate.reasoningEffort, "low");
});
