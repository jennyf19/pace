import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    BANKING77_OWNER_PAIR_SCENARIO,
    BANKING77_OWNER_PAIR_TREATMENTS
} from "../examples/hosted-direct-owner-pair-banking77-replay/run-hosted-direct-owner-pair-banking77-replay.mjs";
import {
    CATEGORY_INDEXES,
    EXAMPLES_PER_CATEGORY,
    UPSTREAM_COMMIT,
    UPSTREAM_FILES,
    buildBanking77ExpectedResult,
    buildBanking77GroundTruth,
    buildBanking77Source
} from "../examples/hosted-direct-owner-pair-banking77-replay/prepare-banking77-workload.mjs";
import {
    buildOwnerPairResponseFormat,
    decodeOwnerPairMergeInput
} from "../examples/hosted-direct-owner-pair-replay/prepare-owner-pair.mjs";

const directoryUrl = new URL(
    "../examples/hosted-direct-owner-pair-banking77-replay/",
    import.meta.url
);

test("Banking77 source manifest pins official files and selection", async () => {
    const manifest = await readFile(
        new URL("source-manifest.json", directoryUrl),
        "utf8"
    ).then(JSON.parse);

    assert.equal(manifest.upstream_commit, UPSTREAM_COMMIT);
    assert.deepEqual(
        manifest.selection.category_indexes,
        [...CATEGORY_INDEXES]
    );
    assert.equal(
        manifest.selection.examples_per_category,
        EXAMPLES_PER_CATEGORY
    );
    for (const [key, descriptor] of Object.entries(UPSTREAM_FILES)) {
        assert.equal(
            manifest.upstream_files[key].sha256,
            descriptor.sha256
        );
    }
});

test("Banking77 selected source contains five labels and 40 stable ids", async () => {
    const selected = await readFile(
        new URL("selected-source.json", directoryUrl),
        "utf8"
    ).then(JSON.parse);
    const counts = Object.fromEntries(
        selected.labels.map((entry) => [entry.label, 0])
    );
    for (const example of selected.examples) counts[example.label] += 1;

    assert.equal(selected.examples.length, 40);
    assert.equal(new Set(selected.examples.map((example) => example.id)).size, 40);
    assert.equal(
        new Set(
            selected.examples.map((example) =>
                example.text.trim().toLowerCase()
            )
        ).size,
        40
    );
    assert.deepEqual(Object.values(counts), [8, 8, 8, 8, 8]);
    assert.deepEqual(
        selected.labels.map((entry) => entry.index),
        [...CATEGORY_INDEXES]
    );
});

test("Banking77 frozen artifacts match selected upstream source", async () => {
    const [selected, input, routes, expected] = await Promise.all([
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

    assert.deepEqual(input, buildBanking77Source(selected));
    assert.deepEqual(routes, buildBanking77GroundTruth(selected));
    assert.deepEqual(expected, buildBanking77ExpectedResult(selected));
});

test("Banking77 pair schema preserves all source-row ids", async () => {
    const input = await readFile(
        new URL("baseline-input.json", directoryUrl),
        "utf8"
    ).then(JSON.parse);
    const format = buildOwnerPairResponseFormat(input, "banking77_pairs");
    const values = format.schema.properties.pairs.items.items.enum;

    assert.equal(format.schema.properties.pairs.minItems, 40);
    assert.deepEqual(
        values.slice(0, 40),
        input.findings.map((finding) => finding.id)
    );
});

test("Banking77 owner pairs reproduce the frozen expected result", async () => {
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

test("Banking77 scenario reuses pair treatment under fresh identities", () => {
    const { baseline, candidate } =
        BANKING77_OWNER_PAIR_TREATMENTS;

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
    assert.match(BANKING77_OWNER_PAIR_SCENARIO.corpusId, /banking77/);
    assert.equal(BANKING77_OWNER_PAIR_SCENARIO.configurationFiles.length, 6);
});
