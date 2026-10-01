import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "0.1";

export function buildCandidateResult(input) {
    if (input?.schema_version !== SCHEMA_VERSION) {
        throw new Error(`input schema_version must be ${SCHEMA_VERSION}`);
    }
    if (
        typeof input.task_id !== "string" ||
        !input.selection_rule ||
        !Array.isArray(input.findings)
    ) {
        throw new Error("input requires task_id, selection_rule, and findings");
    }
    const rule = input.selection_rule;
    if (
        typeof rule.state !== "string" ||
        !Array.isArray(rule.severities) ||
        typeof rule.minimum_confidence !== "number" ||
        typeof rule.suppressed !== "boolean" ||
        rule.sort !== "id_ascending"
    ) {
        throw new Error("unsupported selection_rule");
    }
    const severities = new Set(rule.severities);
    const findingIds = input.findings
        .filter(
            (finding) =>
                finding.state === rule.state &&
                severities.has(finding.severity) &&
                finding.confidence >= rule.minimum_confidence &&
                finding.suppressed === rule.suppressed
        )
        .map((finding) => finding.id)
        .sort((left, right) => left.localeCompare(right));
    return {
        schema_version: SCHEMA_VERSION,
        tasks: [
            {
                task_id: input.task_id,
                status: "complete",
                decision: "accept",
                finding_ids: findingIds
            }
        ]
    };
}

async function main() {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) {
        throw new Error(
            "usage: node prepare-input.mjs <baseline-input.json> <candidate-input.json>"
        );
    }
    const input = JSON.parse(
        (await readFile(inputPath, "utf8")).replace(/^\uFEFF/, "")
    );
    await writeFile(
        outputPath,
        `${JSON.stringify(buildCandidateResult(input), null, 2)}\n`,
        "utf8"
    );
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
