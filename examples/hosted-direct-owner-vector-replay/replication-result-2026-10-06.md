# Replication result: anchored response compression

- **Date:** October 6, 2026
- **Status:** Balanced `n=5` replication
- **Final disposition:** `reject`

## Question

Pace v0.17.0 reported a descriptive `n=3` keep for concise anchored owner
blocks. This replication kept the workload, model, provider deployment,
reasoning effort, prompt, anchored schema, deterministic decode, and evaluator
unchanged under fresh source, configuration, replay, and comparison
identities.

## Quality result

- Baseline route objects: 5/5 exact.
- Anchored owner blocks: 4/5 exact.
- Lost findings: 0.
- Structurally invalid responses: 0.
- Accounting residuals: 0.

The failed candidate response returned `identity` for all 64 positions. The 16
findings whose expected owner was identity remained correct; the other 48
findings were misrouted.

Every required block anchor was present, every array had exactly eight values,
and every value was in the allowed owner vocabulary. Strict structure and
periodic ID anchors therefore bounded positional drift but did not prevent
semantic collapse to one allowed label.

Pace returned `reject`.

## Descriptive performance counterevidence

Performance is not eligible because exact quality failed:

| Metric | Route objects | Anchored owner blocks | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,866 | 1,851 | -0.804% |
| Output-token p50 | 1,630 | 1,294 | -20.613% |
| Reasoning-token p50 | 960 | 1,088 | +13.333% |
| Visible-answer p50 | 670 | 206 | -69.254% |
| API-time p50 | 13,481.279 ms | 9,434.690 ms | -30.016% |
| Wall-time p50 | 13,508 ms | 9,459 ms | -29.975% |
| Wall-time p90 | 14,865.2 ms | 10,378 ms | -30.186% |

The visible serialization saving replicated strongly. The exact-quality
failure and higher reasoning p50 make it unsafe as a default treatment.

## Interpretation

The v0.17.0 discovery keep did not replicate.

The failed sequence establishes two separate boundaries:

1. An unanchored vector can suffer insertion-style positional drift.
2. Periodic anchors can stop drift from crossing blocks, but cannot guarantee
   that the model preserves per-finding semantic discrimination.

The stronger design rule is:

> Data that looks redundant to deterministic code may still be useful model
> task structure. Remove it only when replicated quality proves that the model
> does not rely on the explicit association.

No further anchor-interval or prompt tuning is justified on this corpus. That
would adapt the representation after observing each failure mode. A future
structural treatment should retain explicit per-finding IDs, such as a compact
ID-to-owner map, and begin under fresh experimental identities.

## Evidence boundaries

- One direct provider deployment and model version `2025-08-07`.
- Five-sample cohorts are descriptive, not statistically significant.
- AI units, premium requests, cache-write tokens, and direct billing remained
  unavailable.
- Cache-read p50 was 1,792 tokens for both cohorts; no billing claim follows.

## Evidence bindings

- Source commit: `414f5adce4d6b6507684aba8f4898f3b0c8fa95a`
- Replay receipt: `sha256:ca20ea0820c4b8ea`
- Comparison receipt: `sha256:cf59677d7a1bedd2`
- Workload: `sha256:a93f39e1b18fcf8f90b3848a2f3ebb355d2b94337c828be76ef7da2e27051064`
- Source revision: `sha256:8373fddc34cd4447306d56304d7e6b46681768fc8f390ebb1fa948c145b1410d`
- Evaluator implementation: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:862b659b501071be923c26e5a2cc85b2443f06dcc6db822af1ccfa1f4fbd63f9`
- Candidate configuration: `sha256:fd6b654c466f86fb03960d4bb1db6e295b090e608f9d242b025889263fd01682`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The receipts contain no local paths, user identity, prompt text, provider
endpoint, deployment name, bearer token, or private repository domains.
