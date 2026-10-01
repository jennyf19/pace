import { isDeepStrictEqual } from "node:util";

function findingIds(result) {
    return Array.isArray(result?.batches)
        ? result.batches.flatMap((batch) =>
              Array.isArray(batch?.finding_ids) ? batch.finding_ids : []
          )
        : [];
}

export function evaluateOutput(expected, rawOutput) {
    let actual;
    try {
        actual = JSON.parse(String(rawOutput).trim());
    } catch {
        return {
            complete: true,
            passed: false,
            score: 0,
            issues: ["output:not-json"],
            lost_findings: findingIds(expected)
        };
    }
    if (isDeepStrictEqual(actual, expected)) {
        return {
            complete: true,
            passed: true,
            score: 1,
            issues: [],
            lost_findings: []
        };
    }
    const actualIds = new Set(findingIds(actual));
    return {
        complete: true,
        passed: false,
        score: 0,
        issues: ["output:result-mismatch"],
        lost_findings: findingIds(expected).filter(
            (findingId) => !actualIds.has(findingId)
        )
    };
}
