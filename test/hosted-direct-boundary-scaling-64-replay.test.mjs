import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    DIRECT_MODEL_BOUNDARY_TREATMENTS,
    buildResidualRoutesResponseFormat
} from "../examples/hosted-direct-boundary-scaling-64-replay/run-hosted-direct-boundary-scaling-64-replay.mjs";
import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../examples/hosted-hybrid-replay/prepare-hybrid.mjs";

const inputUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-64-replay/baseline-input.json",
    import.meta.url
);
const routesUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-64-replay/ground-truth-routes.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-64-replay/expected-result.json",
    import.meta.url
);
const scale24InputUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-replay/baseline-input.json",
    import.meta.url
);

test("64-finding workload is a strict superset of the 24-finding scale point", async () => {
    const [input, scale24Input] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(scale24InputUrl, "utf8").then(JSON.parse)
    ]);

    assert.deepEqual(input.allowed_owners, scale24Input.allowed_owners);
    assert.deepEqual(input.owner_taxonomy, scale24Input.owner_taxonomy);
    assert.deepEqual(input.findings.slice(0, 24), scale24Input.findings);
    assert.equal(input.findings.length, 64);
});

test("64-finding workload sends every finding to the semantic residual", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const residual = buildResidualInput(input);

    assert.equal(
        input.findings.filter((finding) => finding.owner_hint !== null)
            .length,
        0
    );
    assert.equal(residual.residual_findings.length, 64);
    assert.deepEqual(
        residual.residual_findings.map((finding) => finding.id),
        Array.from({ length: 64 }, (_, index) =>
            `H${String(index + 1).padStart(3, "0")}`
        )
    );
});

test("64-finding strict schema freezes every residual id and owner", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const format = buildResidualRoutesResponseFormat(input);
    const route = format.schema.properties.routes;

    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    assert.equal(route.minItems, 64);
    assert.equal(route.maxItems, 64);
    assert.deepEqual(
        route.items.properties.id.enum,
        input.findings.map((finding) => finding.id)
    );
    assert.deepEqual(
        route.items.properties.owner.enum,
        input.allowed_owners
    );
});

test("64-finding deterministic merge produces balanced frozen batches", async () => {
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
    for (const batch of actual.batches) {
        assert.deepEqual(batch.counts, {
            critical: 4,
            high: 7,
            medium: 4,
            low: 1,
            total: 16
        });
    }
});

test("64-finding replay changes only the model host boundary", () => {
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
