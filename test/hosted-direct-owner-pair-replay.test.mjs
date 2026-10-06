import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DIRECT_OWNER_PAIR_TREATMENTS } from "../examples/hosted-direct-owner-pair-replay/run-hosted-direct-owner-pair-replay.mjs";
import {
    buildFullOwnerResidualInput,
    buildOwnerPairResponseFormat,
    buildRouteObjectResponseFormat,
    decodeOwnerPairMergeInput
} from "../examples/hosted-direct-owner-pair-replay/prepare-owner-pair.mjs";

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
const baselinePromptUrl = new URL(
    "../examples/hosted-residual-overhead-replay/inline-residual-prompt.txt",
    import.meta.url
);
const candidatePromptUrl = new URL(
    "../examples/hosted-direct-owner-pair-replay/inline-owner-pair-prompt.txt",
    import.meta.url
);

test("owner-pair schema preserves explicit ids with compact tuples", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const baseline = buildRouteObjectResponseFormat(
        input,
        "route_objects"
    );
    const candidate = buildOwnerPairResponseFormat(
        input,
        "owner_pairs"
    );
    const routes = baseline.schema.properties.routes;
    const pairs = candidate.schema.properties.pairs;

    assert.equal(routes.minItems, 64);
    assert.equal(pairs.minItems, 64);
    assert.equal(pairs.maxItems, 64);
    assert.equal(pairs.items.minItems, 2);
    assert.equal(pairs.items.maxItems, 2);
    assert.deepEqual(
        pairs.items.items.enum.slice(0, 64),
        routes.items.properties.id.enum
    );
    assert.deepEqual(
        pairs.items.items.enum.slice(64),
        routes.items.properties.owner.enum
    );
});

test("explicit owner pairs reproduce the exact frozen result", async () => {
    const [input, routes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);
    const residual = buildFullOwnerResidualInput(input);
    const ownerById = new Map(
        routes.routes.map((route) => [route.id, route.owner])
    );
    const pairs = residual.residual_findings.map((finding) => [
        finding.id,
        ownerById.get(finding.id)
    ]);

    assert.deepEqual(
        decodeOwnerPairMergeInput({
            source: input,
            residual_routes: {
                schema_version: "0.1",
                pairs
            }
        }),
        expected
    );
});

test("explicit owner pairs fail closed on reordered ids", async () => {
    const [input, routes] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse)
    ]);
    const residual = buildFullOwnerResidualInput(input);
    const ownerById = new Map(
        routes.routes.map((route) => [route.id, route.owner])
    );
    const pairs = residual.residual_findings.map((finding) => [
        finding.id,
        ownerById.get(finding.id)
    ]);
    [pairs[0], pairs[1]] = [pairs[1], pairs[0]];

    assert.throws(
        () =>
            decodeOwnerPairMergeInput({
                source: input,
                residual_routes: {
                    schema_version: "0.1",
                    pairs
                }
            }),
        /must use finding id H001/
    );
});

test("owner-pair prompt retains local id association", async () => {
    const [baseline, candidate] = await Promise.all([
        readFile(baselinePromptUrl, "utf8"),
        readFile(candidatePromptUrl, "utf8")
    ]);

    assert.match(candidate, /"pairs":\[\["H001","identity"\]\]/);
    assert.match(candidate, /\[finding_id,owner\] pair/);
    assert.match(candidate, /Copy each finding ID exactly/);
    assert.match(baseline, /"routes":/);
});

test("owner-pair replay changes only response representation", () => {
    const { baseline, candidate } =
        DIRECT_OWNER_PAIR_TREATMENTS;

    assert.equal(baseline.residualMode, "inline-tool-less");
    assert.equal(candidate.residualMode, baseline.residualMode);
    assert.deepEqual(baseline.availableTools, []);
    assert.deepEqual(candidate.availableTools, baseline.availableTools);
    assert.equal(baseline.reasoningEffort, "low");
    assert.equal(candidate.reasoningEffort, baseline.reasoningEffort);
    assert.equal(
        baseline.responseRepresentation,
        "route-objects-with-ids"
    );
    assert.equal(
        candidate.responseRepresentation,
        "ordered-explicit-id-owner-pairs"
    );
    assert.match(baseline.configurationId, /-v2$/);
    assert.match(candidate.configurationId, /-v2$/);
});
