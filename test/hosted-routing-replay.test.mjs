import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateOutput } from "../examples/hosted-routing-replay/evaluate-output.mjs";
import { buildRoutingResult } from "../examples/hosted-routing-replay/prepare-routing.mjs";

const inputUrl = new URL(
    "../examples/hosted-routing-replay/baseline-input.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-routing-replay/expected-result.json",
    import.meta.url
);

test("deduplicates and routes the frozen workload exactly", async () => {
    const [input, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);

    const actual = buildRoutingResult(input);
    assert.deepEqual(actual, expected);
    assert.deepEqual(
        actual.batches.map((batch) => batch.owner),
        ["identity", "messaging", "compute", "storage"]
    );
    assert.deepEqual(actual.summary, {
        input_findings: 47,
        eligible_findings: 39,
        selected_findings: 16,
        duplicates_removed: 23,
        owners: 4
    });
});

test("exact routing evaluator reports a lost selected finding", async () => {
    const expected = await readFile(expectedUrl, "utf8").then(JSON.parse);
    const changed = structuredClone(expected);
    changed.batches[0].finding_ids.pop();

    const result = evaluateOutput(expected, JSON.stringify(changed));
    assert.equal(result.passed, false);
    assert.equal(result.lost_findings.length, 1);
});
