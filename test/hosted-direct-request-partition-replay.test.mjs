import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DIRECT_REQUEST_PARTITION_TREATMENTS } from "../examples/hosted-direct-request-partition-replay/run-hosted-direct-request-partition-replay.mjs";
import {
    PARTITION_SIZE,
    buildPartitionResponseFormat,
    buildPartitionedResidualInput,
    mergePartitionedResult
} from "../examples/hosted-direct-request-partition-replay/prepare-request-partition.mjs";

const inputUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-64-replay/baseline-input.json",
    import.meta.url
);
const routesUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-64-replay/ground-truth-routes.json",
    import.meta.url
);
const expectedUrl = new URL(
    "../examples/hosted-direct-boundary-scaling-64-replay/expected-result.json",
    import.meta.url
);

test("partitioned residual preserves all 64 findings in order", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const result = buildPartitionedResidualInput(input);

    assert.equal(result.partition_size, PARTITION_SIZE);
    assert.equal(result.partition_count, 4);
    assert.deepEqual(
        result.partitions.map(
            (partition) => partition.residual_findings.length
        ),
        [16, 16, 16, 16]
    );
    assert.deepEqual(
        result.partitions.flatMap((partition) =>
            partition.residual_findings.map((finding) => finding.id)
        ),
        input.findings.map((finding) => finding.id)
    );
    for (const partition of result.partitions) {
        assert.deepEqual(partition.allowed_owners, input.allowed_owners);
        assert.deepEqual(partition.owner_taxonomy, input.owner_taxonomy);
    }
});

test("partition response schema freezes only its 16 route ids", async () => {
    const input = await readFile(inputUrl, "utf8").then(JSON.parse);
    const partition =
        buildPartitionedResidualInput(input).partitions[1];
    const format = buildPartitionResponseFormat(
        partition,
        "partition_routes_16_2_v1"
    );
    const routes = format.schema.properties.routes;

    assert.equal(routes.minItems, 16);
    assert.equal(routes.maxItems, 16);
    assert.deepEqual(
        routes.items.properties.id.enum,
        partition.residual_findings.map((finding) => finding.id)
    );
    assert.deepEqual(
        routes.items.properties.owner.enum,
        input.allowed_owners
    );
});

test("partitioned merge reproduces the exact frozen result", async () => {
    const [input, routes, expected] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse),
        readFile(expectedUrl, "utf8").then(JSON.parse)
    ]);
    const partitioned = buildPartitionedResidualInput(input);
    const routeById = new Map(
        routes.routes.map((route) => [route.id, route])
    );
    const partitionRoutes = partitioned.partitions.map((partition) => ({
        schema_version: "0.1",
        routes: partition.residual_findings.map((finding) =>
            routeById.get(finding.id)
        )
    }));

    assert.deepEqual(
        mergePartitionedResult({
            source: input,
            partition_size: PARTITION_SIZE,
            partition_routes: partitionRoutes
        }),
        expected
    );
});

test("partitioned merge fails closed on cross-partition routes", async () => {
    const [input, routes] = await Promise.all([
        readFile(inputUrl, "utf8").then(JSON.parse),
        readFile(routesUrl, "utf8").then(JSON.parse)
    ]);
    const partitioned = buildPartitionedResidualInput(input);
    const routeById = new Map(
        routes.routes.map((route) => [route.id, route])
    );
    const partitionRoutes = partitioned.partitions.map((partition) => ({
        schema_version: "0.1",
        routes: partition.residual_findings.map((finding) => ({
            ...routeById.get(finding.id)
        }))
    }));
    [
        partitionRoutes[0].routes[0],
        partitionRoutes[1].routes[0]
    ] = [
        partitionRoutes[1].routes[0],
        partitionRoutes[0].routes[0]
    ];

    assert.throws(
        () =>
            mergePartitionedResult({
                source: input,
                partition_size: PARTITION_SIZE,
                partition_routes: partitionRoutes
            }),
        /does not belong to partition/
    );
});

test("request partition replay changes only request topology", () => {
    const { baseline, candidate } =
        DIRECT_REQUEST_PARTITION_TREATMENTS;

    assert.equal(baseline.reasoningEffort, "low");
    assert.equal(candidate.reasoningEffort, baseline.reasoningEffort);
    assert.equal(baseline.requestTopology, "one-monolithic-request");
    assert.equal(baseline.requestCount, 1);
    assert.equal(baseline.parallelism, 1);
    assert.equal(baseline.partitionSize, 64);
    assert.equal(
        candidate.requestTopology,
        "four-parallel-contiguous-partitions"
    );
    assert.equal(candidate.requestCount, 4);
    assert.equal(candidate.parallelism, 4);
    assert.equal(candidate.partitionSize, 16);
    assert.match(baseline.configurationId, /-v1$/);
    assert.match(candidate.configurationId, /-v1$/);
});
