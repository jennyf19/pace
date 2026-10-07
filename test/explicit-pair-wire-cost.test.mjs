import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    analyzeExplicitPairWireCost
} from "../examples/explicit-pair-wire-cost/analyze-explicit-pair-wire-cost.mjs";

const resultUrl = new URL(
    "../examples/explicit-pair-wire-cost/wire-cost-result.json",
    import.meta.url
);

test("explicit-pair wire-cost result is reproducible", async () => {
    const [actual, committed] = await Promise.all([
        analyzeExplicitPairWireCost(),
        readFile(resultUrl, "utf8").then(JSON.parse)
    ]);

    assert.deepEqual(actual, committed);
});

test("explicit-pair structural output savings follow the exact formula", async () => {
    const result = await analyzeExplicitPairWireCost();

    assert.deepEqual(
        result.scenarios.map((scenario) => ({
            items: scenario.item_count,
            labels: scenario.label_count
        })),
        [
            { items: 64, labels: 4 },
            { items: 40, labels: 5 },
            { items: 40, labels: 10 }
        ]
    );
    for (const scenario of result.scenarios) {
        const output = scenario.expected_minified_output_utf8_bytes;
        assert.equal(output.saved, 13 * scenario.item_count + 1);
        assert.equal(output.saved, output.formula_bytes);
        assert.ok(output.reduction_percent > 0);
    }
});

test("static wire cost ranks direction but does not claim token equivalence", async () => {
    const result = await analyzeExplicitPairWireCost();

    assert.deepEqual(
        result.scenarios.map(
            (scenario) => scenario.observed.savings.input_tokens
        ),
        [11, 8, 8]
    );
    assert.deepEqual(
        result.scenarios.map(
            (scenario) =>
                scenario.observed.savings.visible_answer_tokens
        ),
        [151, 63, 103]
    );
    for (const scenario of result.scenarios) {
        assert.ok(
            scenario.request.serialized_request_utf8_bytes.saved > 0
        );
        assert.ok(
            scenario.expected_minified_output_utf8_bytes.saved > 0
        );
    }
    assert.ok(
        result.conclusions.unsupported_uses.includes(
            "replace semantic quality evaluation"
        )
    );
});
