import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateOutput } from "../examples/hosted-replay/evaluate-output.mjs";
import { buildCandidateResult } from "../examples/hosted-replay/prepare-input.mjs";
import {
    buildExecutionOrder,
    readFinalAssistantMessage
} from "../examples/hosted-replay/run-hosted-replay.mjs";

const baselineInputUrl = new URL(
    "../examples/hosted-replay/baseline-input.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-replay/expected-result.json",
    import.meta.url
);

test("deterministic preprocessor produces the frozen expected result", async () => {
    const [input, expected] = await Promise.all([
        readFile(baselineInputUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);

    assert.deepEqual(buildCandidateResult(input), expected);
});

test("exact evaluator accepts the receipt and catches a lost finding", async () => {
    const expected = await readFile(expectedUrl, "utf8").then(JSON.parse);
    const accepted = evaluateOutput(expected, JSON.stringify(expected));
    assert.equal(accepted.passed, true);

    const changed = structuredClone(expected);
    changed.tasks[0].finding_ids.pop();
    const rejected = evaluateOutput(expected, JSON.stringify(changed));
    assert.equal(rejected.passed, false);
    assert.deepEqual(rejected.lost_findings, ["F030"]);
});

test("extracts the final semantic answer instead of rendered stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-hosted-message-"));
    try {
        await writeFile(
            join(directory, "events.jsonl"),
            [
                JSON.stringify({
                    type: "assistant.message",
                    data: {
                        content: "Reading input.",
                        toolRequests: [{ name: "view" }]
                    }
                }),
                JSON.stringify({
                    type: "assistant.message",
                    data: {
                        content: "{\"result\":\"exact\"}",
                        toolRequests: []
                    }
                })
            ].join("\n"),
            "utf8"
        );

        assert.equal(
            await readFinalAssistantMessage(directory),
            "{\"result\":\"exact\"}"
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("balances two-sample execution order as ABBA", () => {
    assert.deepEqual(
        buildExecutionOrder(2).map((entry) => entry.sample),
        ["baseline-1", "candidate-1", "candidate-2", "baseline-2"]
    );
});
