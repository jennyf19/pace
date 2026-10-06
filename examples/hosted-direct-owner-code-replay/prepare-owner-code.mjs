import {
    buildHybridResultFromMergeInput,
    buildResidualInput
} from "../hosted-hybrid-replay/prepare-hybrid.mjs";

export const OWNER_CODE_BY_NAME = Object.freeze({
    identity: "i",
    storage: "s",
    compute: "c",
    messaging: "m"
});

export const OWNER_NAME_BY_CODE = Object.freeze(
    Object.fromEntries(
        Object.entries(OWNER_CODE_BY_NAME).map(([name, code]) => [
            code,
            name
        ])
    )
);

export function buildFullOwnerResidualInput(input) {
    return buildResidualInput(input);
}

export function buildOwnerCodeResidualInput(input) {
    const residual = buildResidualInput(input);
    return {
        ...residual,
        allowed_owners: residual.allowed_owners.map((owner) => {
            const code = OWNER_CODE_BY_NAME[owner];
            if (!code) {
                throw new Error(`owner ${owner} does not have a code`);
            }
            return code;
        }),
        owner_taxonomy: Object.fromEntries(
            residual.allowed_owners.map((owner) => [
                OWNER_CODE_BY_NAME[owner],
                residual.owner_taxonomy[owner]
            ])
        )
    };
}

export function buildFullOwnerResultFromMergeInput(input) {
    return buildHybridResultFromMergeInput(input);
}

export function decodeOwnerCodeMergeInput(input) {
    if (!input?.residual_routes?.routes) {
        throw new Error("coded merge input requires residual routes");
    }
    const decodedRoutes = input.residual_routes.routes.map((route) => {
        const owner = OWNER_NAME_BY_CODE[route.owner];
        if (!owner) {
            throw new Error(`unknown owner code ${route.owner}`);
        }
        return {
            ...route,
            owner
        };
    });
    return buildHybridResultFromMergeInput({
        source: input.source,
        residual_routes: {
            ...input.residual_routes,
            routes: decodedRoutes
        }
    });
}
