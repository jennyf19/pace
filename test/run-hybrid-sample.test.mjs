import assert from "node:assert/strict";
import test from "node:test";
import {
    buildInlineResidualPrompt,
    buildTransformImplementationFiles
} from "../run-hybrid-sample.mjs";

test("binds one hybrid implementation with the existing identifier", () => {
    assert.deepEqual(
        buildTransformImplementationFiles({
            implementationPath: "prepare-hybrid.mjs"
        }),
        [
            {
                id: "hybrid-transform",
                path: "prepare-hybrid.mjs"
            }
        ]
    );
});

test("binds multiple deterministic implementation dependencies", () => {
    assert.deepEqual(
        buildTransformImplementationFiles({
            implementationPath: "unused.mjs",
            implementationPaths: [
                "prepare-owner-code.mjs",
                "prepare-hybrid.mjs"
            ]
        }),
        [
            {
                id: "hybrid-transform",
                path: "prepare-owner-code.mjs"
            },
            {
                id: "hybrid-transform-2",
                path: "prepare-hybrid.mjs"
            }
        ]
    );
});

test("rejects an empty deterministic implementation set", () => {
    assert.throws(
        () =>
            buildTransformImplementationFiles({
                implementationPaths: []
            }),
        /at least one implementation path/
    );
});

test("builds the existing inline residual prompt shape", () => {
    assert.equal(
        buildInlineResidualPrompt("route findings\n", {
            schema_version: "0.1"
        }),
        'route findings\n\nResidual input JSON:\n{"schema_version":"0.1"}'
    );
});
