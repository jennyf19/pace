# Measured result: explicit ID-owner pairs

- **Date:** October 6, 2026
- **Status:** Descriptive `n=3` discovery plus balanced `n=5` replication
- **Final disposition:** `keep`

## Question

Positional owner compression reduced serialization but failed replicated exact
quality. This experiment asked whether the response could preserve explicit
per-finding association while removing only repeated object field names.

The baseline emitted 64 route objects:

```json
{"id":"H001","owner":"identity"}
```

The candidate emitted 64 compact pairs:

```json
["H001","identity"]
```

Both arms used one direct request, the same 64 findings, full semantic owner
names, taxonomy, provider deployment, model, `low` reasoning effort, exact
evaluator, and deterministic final merge.

Candidate decode required exactly 64 pairs, required every ID to match the
corresponding frozen residual finding, validated every owner, and failed
closed before merge.

## Discovery result

The balanced `n=3` cohort returned `keep`.

- Baseline quality: 3/3 exact.
- Candidate quality: 3/3 exact.
- Input-token p50: -0.589%.
- Output-token p50: -11.074%.
- Wall-time p90: -4.536%.
- Reasoning-token p50: +7.692%.

The result suggested that compact visible serialization, not reasoning
reduction, was the primary mechanism.

## Replication result

The unchanged balanced `n=5` cohort also returned `keep`.

Both cohorts passed exact quality 5/5 with no lost findings, ID-order errors,
semantic mismatches, or accounting residuals.

| Metric | Route objects | Explicit pairs | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,868 | 1,857 | -0.589% |
| Output-token p50 | 1,591 | 1,312 | -17.536% |
| Reasoning-token p50 | 960 | 832 | -13.333% |
| Visible-answer p50 | 631 | 480 | -23.930% |
| API-time p50 | 12,234.545 ms | 10,665.749 ms | -12.823% |
| Wall-time p50 | 12,255 ms | 10,938 ms | -10.747% |
| Wall-time p90 | 13,563 ms | 11,154.2 ms | -17.760% |

The logical input saving was exactly 11 tokens in both discovery and
replication, consistent with a fixed schema-and-prompt change.

## Interpretation

The result narrows the response-compression rule:

> Preserve item identity and local semantic association. Compress repeated
> structural labels around that association.

The explicit pair representation retained each finding ID adjacent to its
owner. That avoided both failure modes observed in positional compression:

- insertion-style shifts across an owner vector;
- structurally valid collapse to one owner across anchored blocks.

The stable mechanism is response-structure reduction. Visible-answer p50 fell
23.930% in replication. Reasoning moved in opposite directions across the two
cohorts: it rose 7.692% in discovery and fell 13.333% in replication. The
evidence therefore does not support a general reasoning-reduction claim.

## Cache counterevidence

In replication, both cohorts had cache-read p50 of 1,792 tokens. Non-cached
input p50 was 76 for baseline and 65 for the candidate. Direct billing and
cache-write usage remained unavailable, so the result is stated in logical
tokens rather than cost.

## Evidence boundaries

- One direct provider deployment and model version `2025-08-07`.
- The replicated sample remains descriptive, not statistically significant.
- The finding IDs and their order are part of the candidate contract.
- The compact tuple schema is measured only on this 64-finding, four-owner
  workload.
- AI units, premium requests, cache-write tokens, and direct billing remained
  unavailable.

## Evidence bindings

### v1: `n=3` discovery

- Source commit: `e4985521e072be71d943493c4223e622e9a12529`
- Replay receipt: `sha256:8d9f52c63fbe1cfc`
- Comparison receipt: `sha256:9c4592e387ba3178`
- Workload: `sha256:7d14d992f7918fefd7bdf313d57dacb61b2d59ddd737b9995fbc0185aa846888`
- Source revision: `sha256:5bd4b5762fbbcedd55b4b3c25c5ca29d59ac3b67ff7b84bf9c7faecee94f22af`
- Baseline configuration: `sha256:079dbad573f138eb558127e70eae0d520aaad2406adc3f57b3d4baeed1bb3bbe`
- Candidate configuration: `sha256:67c2c60f6867c823f5454f02119ea2ab14b8fa0df79737af494e38eec3be0e85`

### v2: `n=5` replication

- Source commit: `9c55b8fb6c6535a839d0da0420fef6a0843092a1`
- Replay receipt: `sha256:064e157d0f65eae8`
- Comparison receipt: `sha256:512082b98c889136`
- Workload: `sha256:813c87eb1fa8b5b2d7a21efeabaac6926e4ba54ca6f2fb83fc44bf5dd809e98e`
- Source revision: `sha256:ed1a166cc3e0b3bd3aba426fdfba2a00d03978871dad2fc5ed9ace9fc233919e`
- Baseline configuration: `sha256:4a4e0c3c662be1f43c54a2d7ffff7b9822fa5d756e24ee5c5e4117b853d571cf`
- Candidate configuration: `sha256:b032e5a0a190e0ad7b9a8ed75eaa682120241617b0232d28b57b053bd54be44d`

Shared evaluator implementation:
`sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`.

Private provider configuration:
`sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`.

The receipts contain no local paths, user identity, prompt text, provider
endpoint, deployment name, bearer token, or private repository domains.
