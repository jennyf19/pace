import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    INDEPENDENT_OWNER_PAIR_SCENARIO,
    INDEPENDENT_OWNER_PAIR_TREATMENTS
} from "../examples/hosted-direct-owner-pair-independent-replay/run-hosted-direct-owner-pair-independent-replay.mjs";
import {
    FINDINGS_BY_OWNER,
    OWNER_TAXONOMY,
    buildIndependentExpectedResult,
    buildIndependentGroundTruth,
    buildIndependentSource
} from "../examples/hosted-direct-owner-pair-independent-replay/prepare-independent-workload.mjs";
import {
    buildOwnerPairResponseFormat,
    buildRouteObjectResponseFormat,
    decodeOwnerPairMergeInput
} from "../examples/hosted-direct-owner-pair-replay/prepare-owner-pair.mjs";

const directoryUrl = new URL(
    "../examples/hosted-direct-owner-pair-independent-replay/",
    import.meta.url
);

test("independent workload covers five balanced domains in varied order", () => {
    const source = buildIndependentSource();
    const routes = buildIndependentGroundTruth();
    const counts = Object.fromEntries(
        Object.keys(OWNER_TAXONOMY).map((owner) => [owner, 0])
    );
    for (const route of routes.routes) counts[route.owner] += 1;

    assert.equal(source.findings.length, 40);
    assert.deepEqual(counts, {
        network: 8,
        database: 8,
        frontend: 8,
        observability: 8,
        deployment: 8
    });
    assert.deepEqual(
        routes.routes.slice(0, 10).map((route) => route.owner),
        [
            "network",
            "database",
            "frontend",
            "observability",
            "deployment",
            "frontend",
            "network",
            "deployment",
            "database",
            "observability"
        ]
    );
});

test("independent descriptions do not expose exact owner labels", () => {
    for (const [owner, findings] of Object.entries(FINDINGS_BY_OWNER)) {
        for (const [, description] of findings) {
            assert.doesNotMatch(
                description.toLowerCase(),
                new RegExp(`\\b${owner}\\b`)
            );
        }
    }
});

test("frozen independent artifacts match the deterministic builder", async () => {
    const [input, routes, expected] = await Promise.all([
        readFile(new URL("baseline-input.json", directoryUrl), "utf8").then(
            JSON.parse
        ),
        readFile(
            new URL("ground-truth-routes.json", directoryUrl),
            "utf8"
        ).then(JSON.parse),
        readFile(new URL("expected-result.json", directoryUrl), "utf8").then(
            JSON.parse
        )
    ]);

    assert.deepEqual(input, buildIndependentSource());
    assert.deepEqual(routes, buildIndependentGroundTruth());
    assert.deepEqual(expected, buildIndependentExpectedResult());
});

test("independent pair schema preserves all 40 explicit ids", () => {
    const input = buildIndependentSource();
    const baseline = buildRouteObjectResponseFormat(input, "baseline");
    const candidate = buildOwnerPairResponseFormat(input, "candidate");

    assert.equal(baseline.schema.properties.routes.minItems, 40);
    assert.equal(candidate.schema.properties.pairs.minItems, 40);
    assert.deepEqual(
        candidate.schema.properties.pairs.items.items.enum.slice(0, 40),
        input.findings.map((finding) => finding.id)
    );
});

test("independent owner pairs reproduce the exact frozen result", () => {
    const input = buildIndependentSource();
    const routes = buildIndependentGroundTruth();
    const ownerById = new Map(
        routes.routes.map((route) => [route.id, route.owner])
    );
    const pairs = input.findings.map((finding) => [
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
        buildIndependentExpectedResult()
    );
});

test("independent scenario changes workload but not pair treatment", () => {
    const { baseline, candidate } =
        INDEPENDENT_OWNER_PAIR_TREATMENTS;

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
    assert.match(baseline.configurationId, /-v1$/);
    assert.match(candidate.configurationId, /-v1$/);
    assert.match(INDEPENDENT_OWNER_PAIR_SCENARIO.corpusId, /independent/);
    assert.equal(
        INDEPENDENT_OWNER_PAIR_SCENARIO.configurationFiles.length,
        2
    );
});
