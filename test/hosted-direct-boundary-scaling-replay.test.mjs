import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    DIRECT_MODEL_BOUNDARY_TREATMENTS,
    buildResidualRoutesResponseFormat
} from "../examples/hosted-direct-boundary-scaling-replay/run-hosted-direct-boundary-scaling-replay.mjs";
import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../examples/hosted-hybrid-replay/prepare-hybrid.mjs";

const inputUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-replay/baseline-input.json",
    import.meta.url
);
const routesUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-replay/ground-truth-routes.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-replay/expected-result.json",
    import.meta.url
);

test("scaled workload sends all 24 findings to the semantic residual", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const residual = buildResidualInput(input);

    assert.equal(
        input.findings.filter((finding) => finding.owner_hint !== null)
            .length,
        0
    );
    assert.equal(residual.residual_findings.length, 24);
    assert.deepEqual(
        residual.residual_findings.map((finding) => finding.id),
        Array.from({ length: 24 }, (_, index) =>
            `H${String(index + 1).padStart(3, "0")}`
        )
    );
});

test("scaled strict schema freezes every residual id and owner", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const format = buildResidualRoutesResponseFormat(input);
    const route = format.schema.properties.routes;

    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    assert.equal(route.minItems, 24);
    assert.equal(route.maxItems, 24);
    assert.deepEqual(
        route.items.properties.id.enum,
        input.findings.map((finding) => finding.id)
    );
    assert.deepEqual(
        route.items.properties.owner.enum,
        input.allowed_owners
    );
});

test("scaled deterministic merge produces the frozen result", async () => {
    const [source, residualRoutes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);

    const actual = buildHybridResultFromMergeInput({
        source,
        residual_routes: residualRoutes
    });
    assert.deepEqual(actual, expected);
});

test("scaled boundary replay changes only the model host boundary", () => {
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
