import { isDeepStrictEqual } from "node:util";

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
            lost_findings: expected.tasks.flatMap(
                (task) => task.finding_ids
            )
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
    const actualTasks = new Map(
        Array.isArray(actual?.tasks)
            ? actual.tasks.map((task) => [task?.task_id, task])
            : []
    );
    const lostFindings = [];
    for (const expectedTask of expected.tasks) {
        const actualTask = actualTasks.get(expectedTask.task_id);
        const actualFindings = new Set(
            Array.isArray(actualTask?.finding_ids)
                ? actualTask.finding_ids
                : []
        );
        for (const findingId of expectedTask.finding_ids) {
            if (!actualFindings.has(findingId)) lostFindings.push(findingId);
        }
    }
    return {
        complete: true,
        passed: false,
        score: 0,
        issues: ["output:result-mismatch"],
        lost_findings: [...new Set(lostFindings)]
    };
}
