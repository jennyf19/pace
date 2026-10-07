import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    BANKING77_TEN_OWNER_PAIR_SCENARIO,
    BANKING77_TEN_OWNER_PAIR_TREATMENTS
} from "../examples/hosted-direct-owner-pair-banking77-10-replay/run-hosted-direct-owner-pair-banking77-10-replay.mjs";
import {
    buildBanking77ExpectedResult,
    buildBanking77GroundTruth,
    buildBanking77Source
} from "../examples/hosted-direct-owner-pair-banking77-replay/prepare-banking77-workload.mjs";
import {
    buildOwnerPairResponseFormat,
    decodeOwnerPairMergeInput
} from "../examples/hosted-direct-owner-pair-replay/prepare-owner-pair.mjs";

const directoryUrl = new URL(
    "../examples/hosted-direct-owner-pair-banking77-10-replay/",
    import.meta.url
);

test("ten-intent selection holds payload at 40 with four examples each", async () => {
    const [config, selected] = await Promise.all([
        readFile(new URL("selection-config.json", directoryUrl), "utf8").then(
            JSON.parse
        ),
        readFile(new URL("selected-source.json", directoryUrl), "utf8").then(
            JSON.parse
        )
    ]);
    const counts = Object.fromEntries(
        selected.labels.map((entry) => [entry.label, 0])
    );
    for (const example of selected.examples) counts[example.label] += 1;

    assert.deepEqual(config.category_indexes, [
        0,
        8,
        16,
        24,
        32,
        40,
        48,
        56,
        64,
        72
    ]);
    assert.equal(selected.labels.length, 10);
    assert.equal(selected.examples.length, 40);
    assert.deepEqual(Object.values(counts), new Array(10).fill(4));
    assert.equal(new Set(selected.examples.map((example) => example.id)).size, 40);
});

test("ten-intent artifacts match the frozen selected source", async () => {
    const [config, selected, input, routes, expected] = await Promise.all([
        readFile(new URL("selection-config.json", directoryUrl), "utf8").then(
            JSON.parse
        ),
        readFile(new URL("selected-source.json", directoryUrl), "utf8").then(
            JSON.parse
        ),
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
    const options = { batchId: config.batch_id };

    assert.deepEqual(input, buildBanking77Source(selected, options));
    assert.deepEqual(routes, buildBanking77GroundTruth(selected));
    assert.deepEqual(
        expected,
        buildBanking77ExpectedResult(selected, options)
    );
});

test("ten-intent pair schema preserves all 40 source-row ids", async () => {
    const input = await readFile(
        new URL("baseline-input.json", directoryUrl),
        "utf8"
    ).then(JSON.parse);
    const format = buildOwnerPairResponseFormat(
        input,
        "banking77_ten_pairs"
    );

    assert.equal(format.schema.properties.pairs.minItems, 40);
    assert.deepEqual(
        format.schema.properties.pairs.items.items.enum.slice(0, 40),
        input.findings.map((finding) => finding.id)
    );
    assert.equal(input.allowed_owners.length, 10);
});

test("ten-intent owner pairs reproduce the expected result", async () => {
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
    const ownerById = new Map(
        routes.routes.map((route) => [route.id, route.owner])
    );

    assert.deepEqual(
        decodeOwnerPairMergeInput({
            source: input,
            residual_routes: {
                schema_version: "0.1",
                pairs: input.findings.map((finding) => [
                    finding.id,
                    ownerById.get(finding.id)
                ])
            }
        }),
        expected
    );
});

test("ten-intent scenario changes cardinality but not treatment", () => {
    const { baseline, candidate } =
        BANKING77_TEN_OWNER_PAIR_TREATMENTS;

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
    assert.match(BANKING77_TEN_OWNER_PAIR_SCENARIO.corpusId, /10x4/);
});
