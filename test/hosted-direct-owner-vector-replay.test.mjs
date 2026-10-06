import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DIRECT_OWNER_VECTOR_TREATMENTS } from "../examples/hosted-direct-owner-vector-replay/run-hosted-direct-owner-vector-replay.mjs";
import {
    OWNER_BLOCK_SIZE,
    buildFullOwnerResidualInput,
    buildOrderedFindingBlocks,
    buildOwnerBlockResponseFormat,
    buildOwnerVectorResponseFormat,
    buildRouteObjectResponseFormat,
    decodeOwnerBlockMergeInput,
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
    "../examples/hosted-direct-owner-vector-replay/inline-owner-block-prompt.txt",
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

test("anchored owner blocks preserve all frozen ids", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const blocks = buildOrderedFindingBlocks(input);
    const format = buildOwnerBlockResponseFormat(
        input,
        "anchored_owner_blocks"
    );
    const schemaBlocks =
        format.schema.properties.owner_blocks;

    assert.equal(OWNER_BLOCK_SIZE, 8);
    assert.equal(Object.keys(blocks).length, 8);
    assert.deepEqual(Object.keys(schemaBlocks.properties), Object.keys(blocks));
    assert.deepEqual(schemaBlocks.required, Object.keys(blocks));
    for (const [key, findingIds] of Object.entries(blocks)) {
        assert.equal(findingIds.length, 8);
        assert.equal(schemaBlocks.properties[key].minItems, 8);
        assert.equal(schemaBlocks.properties[key].maxItems, 8);
    }
    assert.deepEqual(
        Object.values(blocks).flat(),
        input.findings.map((finding) => finding.id)
    );
});

test("anchored owner blocks reproduce the exact frozen result", async () => {
    const [input, routes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);
    const ownerById = new Map(
        routes.routes.map((route) => [route.id, route.owner])
    );
    const ownerBlocks = Object.fromEntries(
        Object.entries(buildOrderedFindingBlocks(input)).map(
            ([key, findingIds]) => [
                key,
                findingIds.map((id) => ownerById.get(id))
            ]
        )
    );

    assert.deepEqual(
        decodeOwnerBlockMergeInput({
            source: input,
            residual_routes: {
                schema_version: "0.1",
                owner_blocks: ownerBlocks
            }
        }),
        expected
    );
});

test("anchored owner blocks fail closed on missing anchors", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);

    assert.throws(
        () =>
            decodeOwnerBlockMergeInput({
                source: input,
                residual_routes: {
                    schema_version: "0.1",
                    owner_blocks: {}
                }
            }),
        /every expected block/
    );
});

test("owner-block prompt binds output to anchored residual order", async () => {
    const [baseline, candidate] = await Promise.all([
        readFile(baselinePromptUrl, "utf8"),
        readFile(candidatePromptUrl, "utf8")
    ]);

    assert.match(candidate, /eight-finding block's first ID/);
    assert.match(candidate, /in residual_findings order/);
    assert.match(candidate, /"owner_blocks":\{"H001":\["identity"\]\}/);
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
        "eight-anchored-owner-blocks"
    );
    assert.match(baseline.configurationId, /-v3$/);
    assert.match(candidate.configurationId, /-v3$/);
});
