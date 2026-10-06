import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../hosted-hybrid-replay/prepare-hybrid.mjs";

const SCHEMA_VERSION = "0.1";
export const OWNER_BLOCK_SIZE = 8;

function requireName(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("response format name is required");
    }
    return value;
}

export function buildFullOwnerResidualInput(input) {
    return buildResidualInput(input);
}

export function buildRouteObjectResponseFormat(input, name) {
    const residual = buildResidualInput(input);
    const ids = residual.residual_findings.map((finding) => finding.id);
    return {
        type: "json_schema",
        name: requireName(name),
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
                                enum: residual.allowed_owners
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

export function buildOwnerVectorResponseFormat(input, name) {
    const residual = buildResidualInput(input);
    return {
        type: "json_schema",
        name: requireName(name),
        strict: true,
        schema: {
            type: "object",
            properties: {
                schema_version: {
                    type: "string",
                    const: SCHEMA_VERSION
                },
                owners: {
                    type: "array",
                    minItems: residual.residual_findings.length,
                    maxItems: residual.residual_findings.length,
                    items: {
                        type: "string",
                        enum: residual.allowed_owners
                    }
                }
            },
            required: ["schema_version", "owners"],
            additionalProperties: false
        }
    };
}

function buildOwnerBlocks(input, blockSize = OWNER_BLOCK_SIZE) {
    if (!Number.isInteger(blockSize) || blockSize < 1) {
        throw new Error("blockSize must be a positive integer");
    }
    const residual = buildResidualInput(input);
    const blocks = [];
    for (
        let offset = 0;
        offset < residual.residual_findings.length;
        offset += blockSize
    ) {
        const findings = residual.residual_findings.slice(
            offset,
            offset + blockSize
        );
        blocks.push({
            key: findings[0].id,
            finding_ids: findings.map((finding) => finding.id)
        });
    }
    return { residual, blocks };
}

export function buildOwnerBlockResponseFormat(input, name) {
    const { residual, blocks } = buildOwnerBlocks(input);
    const ownerBlocks = Object.fromEntries(
        blocks.map((block) => [
            block.key,
            {
                type: "array",
                minItems: block.finding_ids.length,
                maxItems: block.finding_ids.length,
                items: {
                    type: "string",
                    enum: residual.allowed_owners
                }
            }
        ])
    );
    return {
        type: "json_schema",
        name: requireName(name),
        strict: true,
        schema: {
            type: "object",
            properties: {
                schema_version: {
                    type: "string",
                    const: SCHEMA_VERSION
                },
                owner_blocks: {
                    type: "object",
                    properties: ownerBlocks,
                    required: blocks.map((block) => block.key),
                    additionalProperties: false
                }
            },
            required: ["schema_version", "owner_blocks"],
            additionalProperties: false
        }
    };
}

export function buildOrderedFindingBlocks(input) {
    return Object.fromEntries(
        buildOwnerBlocks(input).blocks.map((block) => [
            block.key,
            block.finding_ids
        ])
    );
}

export function buildFullOwnerResultFromMergeInput(input) {
    return buildHybridResultFromMergeInput(input);
}

export function decodeOwnerVectorMergeInput(input) {
    if (input?.residual_routes?.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `owner vector schema_version must be ${SCHEMA_VERSION}`
        );
    }
    if (!Array.isArray(input.residual_routes.owners)) {
        throw new Error("owner vector requires owners");
    }
    const residual = buildResidualInput(input.source);
    if (
        input.residual_routes.owners.length !==
        residual.residual_findings.length
    ) {
        throw new Error(
            "owner vector must contain one owner per residual finding"
        );
    }
    const routes = input.residual_routes.owners.map((owner, index) => ({
        id: residual.residual_findings[index].id,
        owner
    }));
    return buildHybridResultFromMergeInput({
        source: input.source,
        residual_routes: {
            schema_version: SCHEMA_VERSION,
            routes
        }
    });
}

export function decodeOwnerBlockMergeInput(input) {
    if (input?.residual_routes?.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `owner blocks schema_version must be ${SCHEMA_VERSION}`
        );
    }
    if (
        !input.residual_routes.owner_blocks ||
        typeof input.residual_routes.owner_blocks !== "object" ||
        Array.isArray(input.residual_routes.owner_blocks)
    ) {
        throw new Error("owner blocks require owner_blocks");
    }
    const { blocks } = buildOwnerBlocks(input.source);
    const expectedKeys = blocks.map((block) => block.key);
    const actualKeys = Object.keys(input.residual_routes.owner_blocks);
    if (
        actualKeys.length !== expectedKeys.length ||
        expectedKeys.some((key) => !actualKeys.includes(key)) ||
        actualKeys.some((key) => !expectedKeys.includes(key))
    ) {
        throw new Error("owner blocks must contain every expected block");
    }

    const routes = [];
    for (const block of blocks) {
        const owners = input.residual_routes.owner_blocks[block.key];
        if (
            !Array.isArray(owners) ||
            owners.length !== block.finding_ids.length
        ) {
            throw new Error(
                `owner block ${block.key} must contain one owner per finding`
            );
        }
        for (const [index, owner] of owners.entries()) {
            routes.push({
                id: block.finding_ids[index],
                owner
            });
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
