import { readFile } from "node:fs/promises";

const SCHEMA_VERSION = "0.1";

async function readJson(path, label) {
    let value;
    try {
        value = JSON.parse(
            (await readFile(path, "utf8")).replace(/^\uFEFF/, "")
        );
    } catch (error) {
        throw new Error(`cannot read ${label}: ${error.message}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object`);
    }
    return value;
}

function sortedStrings(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`${label} must be an array of strings`);
    }
    return [...value].sort();
}

function taskMap(result, label) {
    if (result.schema_version !== SCHEMA_VERSION) {
        throw new Error(`${label} schema_version must be ${SCHEMA_VERSION}`);
    }
    if (!Array.isArray(result.tasks)) {
        throw new Error(`${label} requires tasks`);
    }
    const tasks = new Map();
    for (const task of result.tasks) {
        if (!task || typeof task !== "object" || Array.isArray(task)) {
            throw new Error(`${label} contains an invalid task result`);
        }
        if (typeof task.task_id !== "string" || !task.task_id.trim()) {
            throw new Error(`${label} task result requires task_id`);
        }
        if (tasks.has(task.task_id)) {
            throw new Error(`${label} contains duplicate task ${task.task_id}`);
        }
        tasks.set(task.task_id, task);
    }
    return tasks;
}

function arraysEqual(left, right) {
    return (
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
}

function evaluateSide(corpus, result, label) {
    const actualTasks = taskMap(result, label);
    const issues = [];
    const lostFindings = [];
    let passedTasks = 0;

    for (const task of corpus.tasks) {
        const actual = actualTasks.get(task.task_id);
        if (!actual) {
            issues.push(`${task.task_id}:missing-result`);
            lostFindings.push(...task.expected.finding_ids);
            continue;
        }
        const expectedFindings = sortedStrings(
            task.expected.finding_ids,
            `${task.task_id} expected finding_ids`
        );
        const actualFindings = sortedStrings(
            actual.finding_ids,
            `${task.task_id} actual finding_ids`
        );
        const taskPassed =
            actual.status === task.expected.status &&
            actual.decision === task.expected.decision &&
            arraysEqual(actualFindings, expectedFindings);
        if (taskPassed) {
            passedTasks += 1;
        } else {
            issues.push(`${task.task_id}:result-mismatch`);
            for (const finding of expectedFindings) {
                if (!actualFindings.includes(finding)) lostFindings.push(finding);
            }
        }
        actualTasks.delete(task.task_id);
    }
    for (const taskId of actualTasks.keys()) {
        issues.push(`${taskId}:unexpected-result`);
    }

    return {
        complete: true,
        passed: issues.length === 0,
        score: corpus.tasks.length === 0 ? 1 : passedTasks / corpus.tasks.length,
        issues: [...new Set(issues)],
        lost_findings: [...new Set(lostFindings)]
    };
}

export async function evaluateFrozenResults({
    corpusPath,
    baselineResultPath,
    candidateResultPath,
    baselineRunId,
    candidateRunId,
    baselineRunProfileSha256,
    candidateRunProfileSha256
}) {
    const [corpus, baselineResult, candidateResult] = await Promise.all([
        readJson(corpusPath, "corpus"),
        readJson(baselineResultPath, "baseline result"),
        readJson(candidateResultPath, "candidate result")
    ]);
    if (corpus.schema_version !== SCHEMA_VERSION) {
        throw new Error(`corpus schema_version must be ${SCHEMA_VERSION}`);
    }
    if (
        typeof corpus.corpus_id !== "string" ||
        typeof corpus.evaluator_id !== "string" ||
        !Array.isArray(corpus.tasks)
    ) {
        throw new Error("corpus requires corpus_id, evaluator_id, and tasks");
    }
    const baseline = evaluateSide(corpus, baselineResult, "baseline result");
    const candidate = evaluateSide(corpus, candidateResult, "candidate result");

    return {
        schema_version: SCHEMA_VERSION,
        baseline: {
            run_id: baselineRunId,
            run_profile_sha256: baselineRunProfileSha256,
            corpus_id: corpus.corpus_id,
            evaluator_id: corpus.evaluator_id,
            complete: baseline.complete,
            passed: baseline.passed,
            score: baseline.score
        },
        candidate: {
            run_id: candidateRunId,
            run_profile_sha256: candidateRunProfileSha256,
            corpus_id: corpus.corpus_id,
            evaluator_id: corpus.evaluator_id,
            complete: candidate.complete,
            passed: candidate.passed,
            score: candidate.score
        },
        regressions: candidate.issues,
        lost_findings: candidate.lost_findings
    };
}
