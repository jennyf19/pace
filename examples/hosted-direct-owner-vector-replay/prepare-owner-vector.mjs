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
