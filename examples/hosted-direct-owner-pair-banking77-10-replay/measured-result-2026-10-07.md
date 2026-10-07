# Measured result: BANKING77 ten-intent scale point

- **Date:** October 7, 2026
- **Status:** Valid `n=3` discovery; `n=5` replication transport-blocked
- **Discovery disposition:** `keep`
- **Stable recommendation:** not yet established

## Question

The five-intent BANKING77 explicit-pair result replicated at `n=5`. This
experiment held payload size at 40 official test utterances while doubling
label cardinality from five to ten.

The deterministic selection rule used official category indexes
`0, 8, 16, 24, 32, 40, 48, 56, 64, 72`, then selected the first four test
examples for each label in upstream order.

The treatment remained unchanged:

- baseline: 40 `{id, owner}` route objects;
- candidate: 40 `[finding_id, owner]` pairs;
- one direct request per sample;
- exact upstream intent labels;
- strict schemas;
- deterministic ID validation and final merge.

## Discovery result

The first actual balanced `n=3` cohort returned `keep`.

Both arms passed exact quality 3/3 with zero intent mismatches, lost findings,
ID-order errors, or accounting residuals.

| Metric | Route objects | Explicit pairs | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,705 | 1,697 | -0.469% |
| Output-token p50 | 846 | 743 | -12.175% |
| Reasoning-token p50 | 192 | 192 | 0.000% |
| Visible-answer p50 | 654 | 551 | -15.749% |
| API-time p50 | 8,283.896 ms | 7,312.326 ms | -11.728% |
| Wall-time p50 | 8,664 ms | 7,522 ms | -13.181% |
| Wall-time p90 | 10,375.2 ms | 8,314.8 ms | -19.859% |

The input saving remained a fixed eight tokens, matching the five-intent
BANKING77 result despite doubled label cardinality.

## Excluded transport attempts

The first v1 discovery attempt failed on its first request with
`ECONNRESET`. A separate balanced `n=2` transport probe then completed and was
excluded. The fresh `n=3` retry produced the valid discovery result above.

For the unchanged v2 `n=5` replication:

1. the first attempt completed one response and then failed with
   `ECONNRESET`;
2. a fresh-output `n=2` probe failed with `ECONNRESET`;
3. a second probe after a two-minute cooldown also failed with `ECONNRESET`.
4. a later retry from the exact frozen source tree failed on its first model
   request with `ECONNRESET`.

No balanced `n=5` cohort exists. Partial attempts and probes remain outside the
repository and contribute no profiles to the discovery comparison.

## Transport isolation

The later retry separated provider state from the client path:

- DNS resolution and TCP port 443 connectivity succeeded;
- Node `fetch` and `curl --http1.1` both reset on the Responses route;
- unauthenticated and deliberately invalid-auth POSTs reset in the same way,
  so the failure is not specific to the bearer token;
- the Azure account, deployment, and Resource Health control-plane views all
  reported healthy or succeeded states;
- the resource recorded 199 successful calls in the preceding 24 hours but
  recorded zero calls or errors for the recent reset window.

This supports an upstream transport-path failure before Azure request
accounting, but it does not identify the failing network component. It does not
change the experiment stopping rule.

## Interpretation

The discovery supports the direction of the explicit-pair result at ten labels
and fixed payload. It does not establish a stable cardinality-generalization
claim until the unchanged `n=5` source runs successfully.

The correct stopping rule is:

> Preserve the valid discovery, keep the replication source frozen, and wait
> for transport recovery. Do not splice partial attempts or change the
> treatment to manufacture a complete cohort.

## Evidence boundaries

- One direct provider deployment and model version `2025-08-07`.
- The valid discovery is descriptive and has only three samples per arm.
- The `n=5` replication is blocked by transport, not quality or accounting.
- AI units, premium requests, cache-write tokens, and direct billing remained
  unavailable.

## Evidence bindings

### v1: valid `n=3` discovery

- Remote source commit: `4e9e928550ff61ef5a332ff452a4854bcb9e0ad6`
- Replay receipt: `sha256:e3adb984e388b50f`
- Comparison receipt: `sha256:95351833bcad999d`
- Workload: `sha256:2e61d1d492d955fd48580b42aa8af534ceb8682fa836d30bed70b9b144a03992`
- Source revision: `sha256:e0899552739a7547305b3e02dcc7fb2a7ecfcb73644d88a3ba7d543f06c05d5c`
- Baseline configuration: `sha256:12d2906a74ddf21805e0708d85a29248a29ebd70075f31b241a959f303fadd6f`
- Candidate configuration: `sha256:c001e3cc10338ed716ed80fd3fbd64b626a024802a52354c7a5f30c90b93b4b6`

### v2: frozen replication source

- Remote source commit: `712fec0f920fe65311981840e3b3d80f15e2f329`
- Balanced comparison: not produced
- Failure class: `ECONNRESET`

Pinned upstream hashes, attribution, and license are identical to the
five-intent BANKING77 scenario.

The discovery receipts contain no local paths, user identity, prompt text,
provider endpoint, deployment name, bearer token, or private repository
domains.
