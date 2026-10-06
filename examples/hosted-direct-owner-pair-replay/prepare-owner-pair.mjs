import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../hosted-hybrid-replay/prepare-hybrid.mjs";

const SCHEMA_VERSION = "0.1";

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

export function buildOwnerPairResponseFormat(input, name) {
    const residual = buildResidualInput(input);
    const values = [
        ...residual.residual_findings.map((finding) => finding.id),
        ...residual.allowed_owners
    ];
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
                pairs: {
                    type: "array",
                    minItems: residual.residual_findings.length,
                    maxItems: residual.residual_findings.length,
                    items: {
                        type: "array",
                        minItems: 2,
                        maxItems: 2,
                        items: {
                            type: "string",
                            enum: values
                        }
                    }
                }
            },
            required: ["schema_version", "pairs"],
            additionalProperties: false
        }
    };
}

export function buildFullOwnerResultFromMergeInput(input) {
    return buildHybridResultFromMergeInput(input);
}

export function decodeOwnerPairMergeInput(input) {
    if (input?.residual_routes?.schema_version !== SCHEMA_VERSION) {
        throw new Error(
            `owner pairs schema_version must be ${SCHEMA_VERSION}`
        );
    }
    if (!Array.isArray(input.residual_routes.pairs)) {
        throw new Error("owner pairs require pairs");
    }
    const residual = buildResidualInput(input.source);
    if (
        input.residual_routes.pairs.length !==
        residual.residual_findings.length
    ) {
        throw new Error(
            "owner pairs must contain one pair per residual finding"
        );
    }
    const allowedOwners = new Set(residual.allowed_owners);
    const routes = input.residual_routes.pairs.map((pair, index) => {
        if (!Array.isArray(pair) || pair.length !== 2) {
            throw new Error(
                `owner pair ${index + 1} must contain id and owner`
            );
        }
        const [id, owner] = pair;
        const expectedId = residual.residual_findings[index].id;
        if (id !== expectedId) {
            throw new Error(
                `owner pair ${index + 1} must use finding id ${expectedId}`
            );
        }
        if (!allowedOwners.has(owner)) {
            throw new Error(
                `owner pair ${id} uses unknown owner ${owner}`
            );
        }
        return { id, owner };
    });
    return buildHybridResultFromMergeInput({
        source: input.source,
        residual_routes: {
            schema_version: SCHEMA_VERSION,
            routes
        }
    });
}
