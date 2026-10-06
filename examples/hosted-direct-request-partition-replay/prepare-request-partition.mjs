import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../hosted-hybrid-replay/prepare-hybrid.mjs";

const SCHEMA_VERSION = "0.1";
export const PARTITION_SIZE = 16;

function requirePositiveInteger(value, label) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value;
}

function validatePartition(partition) {
    if (partition?.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `partition schema_version must be ${SCHEMA_VERSION}`
        );
    }
    if (
        !Array.isArray(partition.residual_findings) ||
        partition.residual_findings.length === 0
    ) {
        throw new Error("partition requires residual findings");
    }
    if (
        !Array.isArray(partition.allowed_owners) ||
        partition.allowed_owners.length === 0
    ) {
        throw new Error("partition requires allowed owners");
    }
}

export function buildPartitionedResidualInput(
    input,
    partitionSize = PARTITION_SIZE
) {
    requirePositiveInteger(partitionSize, "partitionSize");
    const residual = buildResidualInput(input);
    const partitions = [];
    for (
        let offset = 0;
        offset < residual.residual_findings.length;
        offset += partitionSize
    ) {
        partitions.push({
            ...residual,
            residual_findings: residual.residual_findings.slice(
                offset,
                offset + partitionSize
            )
        });
    }
    if (partitions.length < 2) {
        throw new Error("partitioned residual requires at least two parts");
    }
    return {
        schema_version: SCHEMA_VERSION,
        partition_size: partitionSize,
        partition_count: partitions.length,
        partitions
    };
}

export function buildPartitionResponseFormat(partition, name) {
    validatePartition(partition);
    if (typeof name !== "string" || !name.trim()) {
        throw new Error("response format name is required");
    }
    const ids = partition.residual_findings.map((finding) => finding.id);
    return {
        type: "json_schema",
        name,
        strict: true,
        schema: {
            type: "object",
            properties: {
                schema_version: {
                    type: "string",
                    const: SCHEMA_VERSION
                },
                routes: {
                    type: "array",
                    minItems: ids.length,
                    maxItems: ids.length,
                    items: {
                        type: "object",
                        properties: {
                            id: {
                                type: "string",
                                enum: ids
                            },
                            owner: {
                                type: "string",
                                enum: partition.allowed_owners
                            }
                        },
                        required: ["id", "owner"],
                        additionalProperties: false
                    }
                }
            },
            required: ["schema_version", "routes"],
            additionalProperties: false
        }
    };
}

export function mergePartitionedResult(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("partition merge input must be an object");
    }
    const partitionSize = requirePositiveInteger(
        input.partition_size,
        "partition_size"
    );
    if (!Array.isArray(input.partition_routes)) {
        throw new Error("partition merge input requires partition_routes");
    }
    const expected = buildPartitionedResidualInput(
        input.source,
        partitionSize
    );
    if (input.partition_routes.length !== expected.partition_count) {
        throw new Error(
            "partition routes must contain one response per partition"
        );
    }

    const routes = [];
    for (const [index, routeSet] of input.partition_routes.entries()) {
        if (
            routeSet?.schema_version !== SCHEMA_VERSION ||
            !Array.isArray(routeSet.routes)
        ) {
            throw new Error(
                `partition ${index + 1} requires schema_version and routes`
            );
        }
        const expectedIds = new Set(
            expected.partitions[index].residual_findings.map(
                (finding) => finding.id
            )
        );
        if (routeSet.routes.length !== expectedIds.size) {
            throw new Error(
                `partition ${index + 1} must cover every partition finding`
            );
        }
        const seen = new Set();
        for (const route of routeSet.routes) {
            if (!expectedIds.has(route?.id)) {
                throw new Error(
                    `route ${route?.id ?? "missing"} does not belong to partition ${index + 1}`
                );
            }
            if (seen.has(route.id)) {
                throw new Error(
                    `partition ${index + 1} contains duplicate route ${route.id}`
                );
            }
            seen.add(route.id);
            routes.push(route);
        }
    }

    return buildHybridResultFromMergeInput({
        source: input.source,
        residual_routes: {
            schema_version: SCHEMA_VERSION,
            routes
        }
    });
}
