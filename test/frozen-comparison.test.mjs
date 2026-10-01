import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluateFrozenResults } from "../examples/frozen-comparison/evaluate-results.mjs";
import { runFrozenComparison } from "../examples/frozen-comparison/run-example.mjs";

const exampleDirectory = fileURLToPath(
    new URL("../examples/frozen-comparison/", import.meta.url)
);

test("runs the frozen comparison end to end", async () => {
    const output = await mkdtemp(join(tmpdir(), "pace-frozen-comparison-"));
    try {
        const result = await runFrozenComparison(output);
        const comparisonArtifact = JSON.parse(
            await readFile(result.paths.comparison, "utf8")
        );
        const report = await readFile(result.paths.report, "utf8");

        assert.equal(result.quality.baseline.passed, true);
        assert.equal(result.quality.candidate.passed, true);
        assert.equal(result.comparison.disposition, "keep");
        assert.equal(result.comparison.metrics.ai_units.absolute_delta, -1);
        assert.equal(result.comparison.metrics.input_tokens.absolute_delta, -40);
        assert.equal(
            result.comparison.metrics.wall_time_ms.absolute_delta,
            -4_000
        );
        assert.equal(comparisonArtifact.disposition, "keep");
        assert.match(report, /\*\*Disposition:\*\* `keep`/);
        assert.doesNotMatch(
            JSON.stringify(comparisonArtifact),
            /pace-public-synthetic-corpus-v1/
        );
        assert.doesNotMatch(
            JSON.stringify(comparisonArtifact),
            /pace-exact-result-evaluator-v1/
        );
        assert.doesNotMatch(JSON.stringify(comparisonArtifact), /:\\\\/);
    } finally {
        await rm(output, { recursive: true, force: true });
    }
});

test("the external evaluator rejects a lost synthetic finding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pace-frozen-quality-"));
    try {
        const candidateResultPath = join(directory, "candidate-result.json");
        await writeFile(
            candidateResultPath,
            JSON.stringify({
                schema_version: "0.1",
                tasks: [
                    {
                        task_id: "synthetic-review-001",
                        status: "complete",
                        decision: "accept",
                        finding_ids: []
                    }
                ]
            }),
            "utf8"
        );
        const quality = await evaluateFrozenResults({
            corpusPath: join(exampleDirectory, "corpus.json"),
            baselineResultPath: join(
                exampleDirectory,
                "baseline-result.json"
            ),
            candidateResultPath,
            baselineRunId: "baseline",
            candidateRunId: "candidate",
            baselineRunProfileSha256: `sha256:${"a".repeat(64)}`,
            candidateRunProfileSha256: `sha256:${"b".repeat(64)}`
        });

        assert.equal(quality.baseline.passed, true);
        assert.equal(quality.candidate.passed, false);
        assert.deepEqual(quality.lost_findings, ["synthetic-finding-001"]);
        assert.deepEqual(quality.regressions, [
            "synthetic-review-001:result-mismatch"
        ]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
