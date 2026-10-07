import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildHybridResult } from "../hosted-hybrid-replay/prepare-hybrid.mjs";

const SCHEMA_VERSION = "0.1";
export const UPSTREAM_REPOSITORY =
    "https://github.com/PolyAI-LDN/task-specific-datasets";
export const UPSTREAM_COMMIT =
    "57ec275d8078af65b7731c2a98be812d844a6d6b";
export const CATEGORY_INDEXES = Object.freeze([0, 15, 30, 45, 60]);
export const EXAMPLES_PER_CATEGORY = 8;

export const UPSTREAM_FILES = Object.freeze({
    categories: Object.freeze({
        name: "categories.json",
        url: `https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/${UPSTREAM_COMMIT}/banking_data/categories.json`,
        sha256:
            "53261da888122daf2d120d925458631d9619e15d82e56052e7a42e535ce32b63"
    }),
    test: Object.freeze({
        name: "test.csv",
        url: `https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/${UPSTREAM_COMMIT}/banking_data/test.csv`,
        sha256:
            "d12d6e3bc4c3103966ae786dc435913c0c563dfa328f5a3646d0e62cfeeb474d"
    }),
    license: Object.freeze({
        name: "LICENSE.txt",
        url: `https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/${UPSTREAM_COMMIT}/LICENSE`,
        sha256:
            "7e7170e3cebf88a9f60c7b8421418323c09304da1af4d5e90f4da1dc1c8a2661"
    })
});

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ",") {
            row.push(field);
            field = "";
        } else if (character === "\n") {
            row.push(field.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += character;
        }
    }
    if (field || row.length > 0) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
    }
    if (quoted) throw new Error("unterminated quoted CSV field");
    return rows;
}

async function loadSourceFile(descriptor, sourceDirectory) {
    let bytes;
    if (sourceDirectory) {
        bytes = await readFile(
            join(resolve(sourceDirectory), descriptor.name)
        );
    } else {
        const response = await fetch(descriptor.url);
        if (!response.ok) {
            throw new Error(
                `failed to download ${descriptor.name}: HTTP ${response.status}`
            );
        }
        bytes = Buffer.from(await response.arrayBuffer());
    }
    const observed = sha256(bytes);
    if (observed !== descriptor.sha256) {
        throw new Error(
            `${descriptor.name} sha256 mismatch: expected ${descriptor.sha256}, got ${observed}`
        );
    }
    return bytes;
}

export function selectBanking77Examples(
    categories,
    testCsvText,
    options = {}
) {
    if (!Array.isArray(categories) || categories.length !== 77) {
        throw new Error("Banking77 categories must contain 77 labels");
    }
    const categoryIndexes =
        options.categoryIndexes ?? CATEGORY_INDEXES;
    const examplesPerCategory =
        options.examplesPerCategory ?? EXAMPLES_PER_CATEGORY;
    if (
        !Array.isArray(categoryIndexes) ||
        categoryIndexes.length === 0 ||
        new Set(categoryIndexes).size !== categoryIndexes.length ||
        categoryIndexes.some(
            (index) =>
                !Number.isInteger(index) ||
                index < 0 ||
                index >= categories.length
        )
    ) {
        throw new Error(
            "categoryIndexes must contain unique valid category indexes"
        );
    }
    if (
        !Number.isInteger(examplesPerCategory) ||
        examplesPerCategory < 1
    ) {
        throw new Error(
            "examplesPerCategory must be a positive integer"
        );
    }
    const selectedLabels = categoryIndexes.map((index) => ({
        index,
        label: categories[index]
    }));
    const csvRows = parseCsv(testCsvText);
    const [header, ...dataRows] = csvRows;
    if (
        header?.length !== 2 ||
        header[0] !== "text" ||
        header[1] !== "category"
    ) {
        throw new Error("Banking77 test CSV must contain text,category");
    }
    const selected = [];
    for (const { index, label } of selectedLabels) {
        const matches = dataRows
            .map((row, rowIndex) => ({
                source_row: rowIndex + 2,
                text: row[0],
                label: row[1]
            }))
            .filter((row) => row.label === label)
            .slice(0, examplesPerCategory);
        if (matches.length !== examplesPerCategory) {
            throw new Error(
                `Banking77 label ${label} has fewer than ${examplesPerCategory} test examples`
            );
        }
        selected.push(
            ...matches.map((row) => ({
                id: `B77-${String(row.source_row).padStart(4, "0")}`,
                source_row: row.source_row,
                category_index: index,
                text: row.text,
                label
            }))
        );
    }
    selected.sort(
        (left, right) => left.source_row - right.source_row
    );
    return {
        schema_version: SCHEMA_VERSION,
        source: {
            dataset: "BANKING77",
            repository: UPSTREAM_REPOSITORY,
            commit: UPSTREAM_COMMIT,
            split: "test",
            license: "CC BY 4.0"
        },
        selection: {
            ...(options.id ? { id: options.id } : {}),
            category_indexes: [...categoryIndexes],
            examples_per_category: examplesPerCategory,
            rule:
                options.rule ??
                "official category indexes 0,15,30,45,60; first eight matching test rows in upstream order"
        },
        labels: selectedLabels,
        examples: selected
    };
}

export function buildBanking77Source(
    selectedSource,
    options = {}
) {
    const labels = selectedSource.labels.map((entry) => entry.label);
    return {
        schema_version: SCHEMA_VERSION,
        batch_id:
            options.batchId ??
            "banking77-test-index-step15-5x8-v1",
        deterministic_confidence_threshold: 1,
        allowed_owners: labels,
        severity_order: ["medium"],
        owner_taxonomy: Object.fromEntries(
            labels.map((label) => [
                label,
                label.replaceAll("_", " ")
            ])
        ),
        findings: selectedSource.examples.map((example) => ({
            id: example.id,
            severity: "medium",
            description: example.text,
            owner_hint: null,
            owner_hint_confidence: 0
        }))
    };
}

export function buildBanking77GroundTruth(selectedSource) {
    return {
        schema_version: SCHEMA_VERSION,
        routes: selectedSource.examples.map((example) => ({
            id: example.id,
            owner: example.label
        }))
    };
}

export function buildBanking77ExpectedResult(
    selectedSource,
    options = {}
) {
    return buildHybridResult(
        buildBanking77Source(selectedSource, options),
        buildBanking77GroundTruth(selectedSource)
    );
}

function buildManifest(selectedSource) {
    return {
        schema_version: SCHEMA_VERSION,
        dataset: "BANKING77",
        upstream_repository: UPSTREAM_REPOSITORY,
        upstream_commit: UPSTREAM_COMMIT,
        upstream_files: Object.fromEntries(
            Object.entries(UPSTREAM_FILES).map(([key, value]) => [
                key,
                {
                    url: value.url,
                    sha256: value.sha256
                }
            ])
        ),
        license: "Creative Commons Attribution 4.0 International",
        selection: selectedSource.selection,
        selected_labels: selectedSource.labels,
        selected_examples: selectedSource.examples.length,
        modifications: [
            "selected a deterministic subset of the official test split",
            "added stable B77 source-row identifiers",
            "mapped intent labels to the Pace owner field",
            "normalized the committed license copy to LF"
        ]
    };
}

function buildAttribution() {
    return `# BANKING77 attribution

This scenario includes a deterministic subset of the BANKING77 test split.

- Dataset: BANKING77
- Authors: Iñigo Casanueva, Tadas Temčinas, Daniela Gerz, Matthew Henderson, and Ivan Vulić
- Upstream repository: ${UPSTREAM_REPOSITORY}
- Pinned commit: ${UPSTREAM_COMMIT}
- License: Creative Commons Attribution 4.0 International
- Paper: "Efficient Intent Detection with Dual Sentence Encoders," ACL 2020 Workshop on NLP for Conversational AI
- Paper URL: https://arxiv.org/abs/2003.04807

Selection and modifications are documented in \`source-manifest.json\`.
The original utterance text and labels remain attributed to the BANKING77
authors and are redistributed under CC BY 4.0.
`;
}

async function writeJson(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
    const args = process.argv.slice(2);
    const outputDirectory = args[0];
    const sourceDirectoryIndex = args.indexOf("--source-directory");
    const selectionConfigIndex = args.indexOf("--selection-config");
    const sourceDirectory =
        sourceDirectoryIndex >= 0
            ? args[sourceDirectoryIndex + 1]
            : null;
    const selectionConfigPath =
        selectionConfigIndex >= 0
            ? args[selectionConfigIndex + 1]
            : null;
    if (!outputDirectory) {
        throw new Error(
            "usage: node prepare-banking77-workload.mjs <output-directory> [--source-directory <path>] [--selection-config <path>]"
        );
    }
    if (sourceDirectoryIndex >= 0 && !sourceDirectory) {
        throw new Error("--source-directory requires a path");
    }
    if (selectionConfigIndex >= 0 && !selectionConfigPath) {
        throw new Error("--selection-config requires a path");
    }

    const selectionConfig = selectionConfigPath
        ? JSON.parse(await readFile(resolve(selectionConfigPath), "utf8"))
        : {};
    const selectionOptions = selectionConfigPath
        ? {
              id: selectionConfig.id,
              categoryIndexes: selectionConfig.category_indexes,
              examplesPerCategory:
                  selectionConfig.examples_per_category,
              rule: selectionConfig.rule
          }
        : {};
    const buildOptions = selectionConfigPath
        ? { batchId: selectionConfig.batch_id }
        : {};

    const [categoryBytes, testBytes, licenseBytes] = await Promise.all([
        loadSourceFile(UPSTREAM_FILES.categories, sourceDirectory),
        loadSourceFile(UPSTREAM_FILES.test, sourceDirectory),
        loadSourceFile(UPSTREAM_FILES.license, sourceDirectory)
    ]);
    const categories = JSON.parse(categoryBytes.toString("utf8"));
    const selectedSource = selectBanking77Examples(
        categories,
        testBytes.toString("utf8"),
        selectionOptions
    );
    const output = resolve(outputDirectory);
    await mkdir(output, { recursive: true });
    await Promise.all([
        writeJson(join(output, "selected-source.json"), selectedSource),
        writeJson(
            join(output, "baseline-input.json"),
            buildBanking77Source(selectedSource, buildOptions)
        ),
        writeJson(
            join(output, "ground-truth-routes.json"),
            buildBanking77GroundTruth(selectedSource)
        ),
        writeJson(
            join(output, "expected-result.json"),
            buildBanking77ExpectedResult(
                selectedSource,
                buildOptions
            )
        ),
        writeJson(
            join(output, "source-manifest.json"),
            buildManifest(selectedSource)
        ),
        writeFile(
            join(output, "BANKING77-ATTRIBUTION.md"),
            buildAttribution(),
            "utf8"
        ),
        writeFile(
            join(output, "LICENSE-BANKING77.txt"),
            licenseBytes.toString("utf8").replace(/\r\n/g, "\n"),
            "utf8"
        )
    ]);
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
