import assert from "node:assert/strict";
import test from "node:test";
import {
    buildToolArguments,
    validateReasoningEffort
} from "../run-copilot-sample.mjs";
import { buildInlineResidualPrompt } from "../run-hybrid-sample.mjs";

test("builds an explicit view-only tool set", () => {
    assert.deepEqual(buildToolArguments(["view"]), [
        "--allow-all-tools",
        "--available-tools",
        "view"
    ]);
});

test("builds an explicit empty tool set", () => {
    assert.deepEqual(buildToolArguments([]), [
        "--allow-all-tools",
        "--available-tools",
        "__pace_no_tools__"
    ]);
});

test("rejects invalid tool names", () => {
    assert.throws(
        () => buildToolArguments([""]),
        /availableTools must contain non-empty strings/
    );
});

test("builds a deterministic inline residual prompt", () => {
    const prompt = buildInlineResidualPrompt("Route exactly.", {
        schema_version: "0.1",
        residual_findings: [{ id: "H001" }]
    });

    assert.equal(
        prompt,
        'Route exactly.\n\nResidual input JSON:\n{"schema_version":"0.1","residual_findings":[{"id":"H001"}]}'
    );
});

test("validates supported reasoning efforts", () => {
    assert.equal(validateReasoningEffort("minimal"), "minimal");
    assert.equal(validateReasoningEffort("medium"), "medium");
    assert.throws(
        () => validateReasoningEffort("tiny"),
        /reasoningEffort must be/
    );
});
