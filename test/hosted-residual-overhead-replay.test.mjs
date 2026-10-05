import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildInlineResidualPrompt } from "../run-hybrid-sample.mjs";
import { buildResidualInput } from "../examples/hosted-hybrid-replay/prepare-hybrid.mjs";

const inputUrl = new URL(
    "../examples/hosted-hybrid-replay/baseline-input.json",
    import.meta.url
);
const inlinePromptUrl = new URL(
    "../examples/hosted-residual-overhead-replay/inline-residual-prompt.txt",
    import.meta.url
);

test("inline treatment carries the identical residual JSON without view instructions", async () => {
    const [input, template] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(inlinePromptUrl, "utf8")
    ]);
    const residual = buildResidualInput(input);
    const prompt = buildInlineResidualPrompt(template, residual);

    assert.match(prompt, /Residual input JSON:/);
    assert.match(prompt, /"H017"/);
    assert.doesNotMatch(prompt, /Use view/i);
    assert.equal(residual.residual_findings.length, 8);
});
