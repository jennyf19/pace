import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    DIRECT_OWNER_ENCODING_TREATMENTS,
    buildResidualRoutesResponseFormat
} from "../examples/hosted-direct-owner-code-replay/run-hosted-direct-owner-code-replay.mjs";
import {
    OWNER_CODE_BY_NAME,
    buildFullOwnerResidualInput,
    buildOwnerCodeResidualInput,
    decodeOwnerCodeMergeInput
} from "../examples/hosted-direct-owner-code-replay/prepare-owner-code.mjs";

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
const fullPromptUrl = new URL(
    "../examples/hosted-residual-overhead-replay/inline-residual-prompt.txt",
    import.meta.url
);
const codePromptUrl = new URL(
    "../examples/hosted-direct-owner-code-replay/inline-owner-code-prompt.txt",
    import.meta.url
);

test("owner-code projection preserves findings and taxonomy meaning", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const full = buildFullOwnerResidualInput(input);
    const coded = buildOwnerCodeResidualInput(input);

    assert.deepEqual(coded.residual_findings, full.residual_findings);
    assert.deepEqual(coded.allowed_owners, ["i", "s", "c", "m"]);
    for (const owner of full.allowed_owners) {
        assert.equal(
            coded.owner_taxonomy[OWNER_CODE_BY_NAME[owner]],
            full.owner_taxonomy[owner]
        );
    }
});

test("full and coded schemas freeze the same 64 route ids", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const full = buildResidualRoutesResponseFormat({
        input,
        name: "full_owner_routes_64",
        owners: input.allowed_owners
    });
    const coded = buildResidualRoutesResponseFormat({
        input,
        name: "owner_code_routes_64",
        owners: input.allowed_owners.map(
            (owner) => OWNER_CODE_BY_NAME[owner]
        )
    });
    const fullRoutes = full.schema.properties.routes;
    const codedRoutes = coded.schema.properties.routes;

    assert.equal(fullRoutes.minItems, 64);
    assert.equal(codedRoutes.minItems, 64);
    assert.deepEqual(
        codedRoutes.items.properties.id.enum,
        fullRoutes.items.properties.id.enum
    );
    assert.deepEqual(fullRoutes.items.properties.owner.enum, [
        "identity",
        "storage",
        "compute",
        "messaging"
    ]);
    assert.deepEqual(codedRoutes.items.properties.owner.enum, [
        "i",
        "s",
        "c",
        "m"
    ]);
});

test("owner-code decoding reproduces the exact frozen result", async () => {
    const [source, routes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);
    const codedRoutes = {
        ...routes,
        routes: routes.routes.map((route) => ({
            ...route,
            owner: OWNER_CODE_BY_NAME[route.owner]
        }))
    };

    assert.deepEqual(
        decodeOwnerCodeMergeInput({
            source,
            residual_routes: codedRoutes
        }),
        expected
    );
});

test("owner-code decoding fails closed on an unknown code", async () => {
    const [source, routes] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse)
    ]);
    const codedRoutes = {
        ...routes,
        routes: routes.routes.map((route) => ({
            ...route,
            owner: OWNER_CODE_BY_NAME[route.owner]
        }))
    };
    codedRoutes.routes[0].owner = "x";

    assert.throws(
        () =>
            decodeOwnerCodeMergeInput({
                source,
                residual_routes: codedRoutes
            }),
        /unknown owner code x/
    );
});

test("owner-code prompt changes only code-specific wording and example", async () => {
    const [fullPrompt, codePrompt] = await Promise.all([
        readFile(fullPromptUrl, "utf8"),
        readFile(codePromptUrl, "utf8")
    ]);

    assert.equal(
        codePrompt.trim(),
        fullPrompt
            .trim()
            .replace("allowed owner using", "allowed owner code using")
            .replace('"owner":"identity"', '"owner":"i"')
    );
});

test("owner-code replay changes only the owner representation", () => {
    const { baseline, candidate } =
        DIRECT_OWNER_ENCODING_TREATMENTS;

    assert.equal(baseline.residualMode, "inline-tool-less");
    assert.equal(candidate.residualMode, baseline.residualMode);
    assert.deepEqual(baseline.availableTools, []);
    assert.deepEqual(candidate.availableTools, baseline.availableTools);
    assert.equal(baseline.reasoningEffort, "low");
    assert.equal(candidate.reasoningEffort, baseline.reasoningEffort);
    assert.equal(baseline.ownerEncoding, "full-owner-names");
    assert.match(baseline.configurationId, /-v2$/);
    assert.equal(
        candidate.ownerEncoding,
        "single-character-owner-codes"
    );
    assert.match(candidate.configurationId, /-v2$/);
});
