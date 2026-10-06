import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    DIRECT_SYMBOLIC_LABEL_TREATMENTS,
    buildResidualRoutesResponseFormat
} from "../examples/hosted-direct-symbolic-label-replay/run-hosted-direct-symbolic-label-replay.mjs";
import {
    FINDING_IDS_BY_LABEL,
    LABEL_TAXONOMY,
    SYMBOL_BY_LABEL,
    buildEightLabelSource,
    buildExpectedResult,
    buildFullLabelResidualInput,
    buildSymbolicLabelResidualInput,
    decodeSymbolicLabelMergeInput
} from "../examples/hosted-direct-symbolic-label-replay/prepare-symbolic-label.mjs";

const source64Url = new URL(
    "../examples/hosted-direct-boundary-scaling-64-replay/baseline-input.json",
    import.meta.url
);
const inputUrl = new URL(
    "../examples/hosted-direct-symbolic-label-replay/baseline-input.json",
    import.meta.url
);
const routesUrl = new URL(
    "../examples/hosted-direct-symbolic-label-replay/ground-truth-routes.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-direct-symbolic-label-replay/expected-result.json",
    import.meta.url
);
const fullPromptUrl = new URL(
    "../examples/hosted-direct-symbolic-label-replay/inline-full-label-prompt.txt",
    import.meta.url
);
const symbolicPromptUrl = new URL(
    "../examples/hosted-direct-symbolic-label-replay/inline-symbolic-label-prompt.txt",
    import.meta.url
);

test("eight-label workload preserves all 64 descriptions", async () => {
    const [source64, input] = await Promise.all([
        readFile(source64Url, "utf8").then(JSON.parse),
        readFile(inputUrl, "utf8").then(JSON.parse)
    ]);

    assert.deepEqual(
        input.findings.map(({ id, severity, description }) => ({
            id,
            severity,
            description
        })),
        source64.findings.map(({ id, severity, description }) => ({
            id,
            severity,
            description
        }))
    );
    assert.deepEqual(input.allowed_owners, Object.keys(LABEL_TAXONOMY));
});

test("eight-label taxonomy balances eight findings per label", () => {
    assert.equal(Object.keys(FINDING_IDS_BY_LABEL).length, 8);
    assert.equal(new Set(Object.values(SYMBOL_BY_LABEL)).size, 8);
    for (const findingIds of Object.values(FINDING_IDS_BY_LABEL)) {
        assert.equal(findingIds.length, 8);
    }
});

test("frozen workload artifacts match the deterministic builder", async () => {
    const [source64, input, expected] = await Promise.all([
        readFile(source64Url, "utf8").then(JSON.parse),
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);

    assert.deepEqual(buildEightLabelSource(source64), input);
    assert.deepEqual(buildExpectedResult(source64), expected);
});

test("symbolic projection preserves findings and taxonomy meaning", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const full = buildFullLabelResidualInput(input);
    const symbolic = buildSymbolicLabelResidualInput(input);

    assert.deepEqual(symbolic.residual_findings, full.residual_findings);
    assert.deepEqual(symbolic.allowed_owners, [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h"
    ]);
    for (const label of full.allowed_owners) {
        assert.equal(
            symbolic.owner_taxonomy[SYMBOL_BY_LABEL[label]],
            full.owner_taxonomy[label]
        );
    }
});

test("full and symbolic schemas freeze the same 64 ids", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const full = buildResidualRoutesResponseFormat({
        input,
        name: "full_semantic_label_routes_64",
        owners: input.allowed_owners
    });
    const symbolic = buildResidualRoutesResponseFormat({
        input,
        name: "symbolic_label_routes_64",
        owners: input.allowed_owners.map(
            (label) => SYMBOL_BY_LABEL[label]
        )
    });

    assert.deepEqual(
        symbolic.schema.properties.routes.items.properties.id.enum,
        full.schema.properties.routes.items.properties.id.enum
    );
    assert.deepEqual(
        symbolic.schema.properties.routes.items.properties.owner.enum,
        ["a", "b", "c", "d", "e", "f", "g", "h"]
    );
});

test("symbolic decoding reproduces the exact frozen result", async () => {
    const [source, routes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);
    const symbolicRoutes = {
        ...routes,
        routes: routes.routes.map((route) => ({
            ...route,
            owner: SYMBOL_BY_LABEL[route.owner]
        }))
    };

    assert.deepEqual(
        decodeSymbolicLabelMergeInput({
            source,
            residual_routes: symbolicRoutes
        }),
        expected
    );
});

test("symbolic decoding fails closed on an unknown symbol", async () => {
    const [source, routes] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse)
    ]);
    const symbolicRoutes = {
        ...routes,
        routes: routes.routes.map((route) => ({
            ...route,
            owner: SYMBOL_BY_LABEL[route.owner]
        }))
    };
    symbolicRoutes.routes[0].owner = "z";

    assert.throws(
        () =>
            decodeSymbolicLabelMergeInput({
                source,
                residual_routes: symbolicRoutes
            }),
        /unknown label symbol z/
    );
});

test("symbolic prompt changes only representation wording and example", async () => {
    const [fullPrompt, symbolicPrompt] = await Promise.all([
        readFile(fullPromptUrl, "utf8"),
        readFile(symbolicPromptUrl, "utf8")
    ]);

    assert.equal(
        symbolicPrompt.trim(),
        fullPrompt
            .trim()
            .replace("owner label using", "owner label symbol using")
            .replace(
                '"owner":"identity-access"',
                '"owner":"a"'
            )
    );
});

test("symbolic-label replay changes only label representation", () => {
    const { baseline, candidate } =
        DIRECT_SYMBOLIC_LABEL_TREATMENTS;

    assert.equal(baseline.residualMode, "inline-tool-less");
    assert.equal(candidate.residualMode, baseline.residualMode);
    assert.deepEqual(baseline.availableTools, []);
    assert.deepEqual(candidate.availableTools, baseline.availableTools);
    assert.equal(baseline.reasoningEffort, "low");
    assert.equal(candidate.reasoningEffort, baseline.reasoningEffort);
    assert.equal(baseline.labelEncoding, "full-semantic-labels");
    assert.equal(
        candidate.labelEncoding,
        "single-character-symbols"
    );
});
