import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DIRECT_OWNER_VECTOR_TREATMENTS } from "../examples/hosted-direct-owner-vector-replay/run-hosted-direct-owner-vector-replay.mjs";
import {
    buildFullOwnerResidualInput,
    buildOwnerVectorResponseFormat,
    buildRouteObjectResponseFormat,
    decodeOwnerVectorMergeInput
} from "../examples/hosted-direct-owner-vector-replay/prepare-owner-vector.mjs";

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
    "../examples/hosted-direct-owner-vector-replay/inline-owner-vector-prompt.txt",
    import.meta.url
);

test("owner vector schema removes route ids but preserves owner vocabulary", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const baseline = buildRouteObjectResponseFormat(
        input,
        "route_objects"
    );
    const candidate = buildOwnerVectorResponseFormat(
        input,
        "owner_vector"
    );
    const routes = baseline.schema.properties.routes;
    const owners = candidate.schema.properties.owners;

    assert.equal(routes.minItems, 64);
    assert.equal(owners.minItems, 64);
    assert.equal(owners.maxItems, 64);
    assert.deepEqual(
        owners.items.enum,
        routes.items.properties.owner.enum
    );
    assert.equal(candidate.schema.properties.routes, undefined);
    assert.equal(owners.items.properties, undefined);
});

test("ordered owner vector reproduces the exact frozen result", async () => {
    const [input, routes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);
    const residual = buildFullOwnerResidualInput(input);
    const ownerById = new Map(
        routes.routes.map((route) => [route.id, route.owner])
    );
    const owners = residual.residual_findings.map((finding) =>
        ownerById.get(finding.id)
    );

    assert.deepEqual(
        decodeOwnerVectorMergeInput({
            source: input,
            residual_routes: {
                schema_version: "0.1",
                owners
            }
        }),
        expected
    );
});

test("ordered owner vector fails closed on missing positions", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);

    assert.throws(
        () =>
            decodeOwnerVectorMergeInput({
                source: input,
                residual_routes: {
                    schema_version: "0.1",
                    owners: ["identity"]
                }
            }),
        /one owner per residual finding/
    );
});

test("owner-vector prompt binds output to residual order", async () => {
    const [baseline, candidate] = await Promise.all([
        readFile(baselinePromptUrl, "utf8"),
        readFile(candidatePromptUrl, "utf8")
    ]);

    assert.match(candidate, /array order is authoritative/);
    assert.match(candidate, /same order/);
    assert.match(candidate, /"owners":\["identity"\]/);
    assert.doesNotMatch(candidate, /"id":/);
    assert.match(baseline, /"routes":/);
});

test("owner-vector replay changes only response representation", () => {
    const { baseline, candidate } =
        DIRECT_OWNER_VECTOR_TREATMENTS;

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
        "ordered-owner-vector"
    );
    assert.match(baseline.configurationId, /-v1$/);
    assert.match(candidate.configurationId, /-v1$/);
});
