import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateOutput } from "../examples/hosted-hybrid-replay/evaluate-output.mjs";
import {
    buildHybridResult,
    buildResidualInput
} from "../examples/hosted-hybrid-replay/prepare-hybrid.mjs";

const inputUrl = new URL(
    "../examples/hosted-hybrid-replay/baseline-input.json",
    import.meta.url
);
const routesUrl = new URL(
    "../examples/hosted-hybrid-replay/ground-truth-routes.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-hybrid-replay/expected-result.json",
    import.meta.url
);

test("partitions clear mechanics from eight semantic residuals", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const residual = buildResidualInput(input);

    assert.equal(residual.residual_findings.length, 8);
    assert.deepEqual(
        residual.residual_findings.map((finding) => finding.id),
        [
            "H017",
            "H018",
            "H019",
            "H020",
            "H021",
            "H022",
            "H023",
            "H024"
        ]
    );
});

test("merges residual routes into the frozen final result", async () => {
    const [input, routes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);

    const actual = buildHybridResult(input, routes);
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual.summary, {
        input_findings: 24,
        deterministic_findings: 16,
        residual_findings: 8,
        owners: 4
    });
});

test("rejects incomplete residual coverage", async () => {
    const [input, routes] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse)
    ]);
    routes.routes.pop();

    assert.throws(
        () => buildHybridResult(input, routes),
        /cover every residual finding/
    );
});

test("exact hybrid evaluator reports a lost finding", async () => {
    const expected = await readFile(expectedUrl, "utf8").then(JSON.parse);
    const changed = structuredClone(expected);
    changed.batches[0].finding_ids.pop();

    const result = evaluateOutput(expected, JSON.stringify(changed));
    assert.equal(result.passed, false);
    assert.equal(result.lost_findings.length, 1);
});
