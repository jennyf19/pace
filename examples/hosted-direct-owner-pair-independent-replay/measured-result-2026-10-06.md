# Measured result: independent owner-pair generalization

- **Date:** October 6, 2026
- **Status:** Descriptive `n=3` workload qualification
- **Final disposition:** `unproven`

## Question

Explicit `[finding_id, owner]` pairs replicated on the original 64-finding
workload. This experiment asked whether the representation generalized to a
fresh semantic corpus rather than another subset of those findings.

A deterministic builder froze 40 interleaved findings across five new domains:

- network;
- database;
- frontend;
- observability;
- deployment.

Descriptions did not contain exact owner labels. The builder produced source
input, ground-truth routes, and expected final output before any model call.

The representation treatment remained unchanged:

- baseline: `{id, owner}` route objects;
- candidate: `[finding_id, owner]` pairs;
- one direct request per sample;
- full semantic owner names;
- strict schemas;
- deterministic ID validation and exact final merge.

## Quality result

- Baseline route objects: 2/3 exact.
- Explicit owner pairs: 3/3 exact.
- Lost findings: 0.
- Accounting residuals: 0.

The failed baseline sample routed `W037` to `database` instead of frozen
`deployment`:

> Release lock expires while a schema migration is still running.

Both interpretations are plausible. The deployment label follows the release
lock and orchestration context; the database label follows the active schema
migration.

The corpus therefore failed its own baseline qualification. The finding was
not rewritten after observing either treatment.

Pace returned `unproven`.

## Descriptive performance

Performance is not eligible because baseline exact quality was incomplete:

| Metric | Route objects | Explicit pairs | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,318 | 1,310 | -0.607% |
| Output-token p50 | 1,094 | 978 | -10.603% |
| Reasoning-token p50 | 640 | 640 | 0.000% |
| Visible-answer p50 | 454 | 338 | -25.551% |
| API-time p50 | 9,461.459 ms | 8,056.890 ms | -14.845% |
| Wall-time p50 | 9,528 ms | 8,074 ms | -15.260% |
| Wall-time p90 | 9,764 ms | 8,348.4 ms | -14.498% |

The candidate met every descriptive performance goal and passed exact quality
3/3. Neither fact can establish a representation win against an unstable
control.

## Interpretation

The original explicit-pair result remains valid only for its validated
64-finding workload. This fresh corpus does not broaden or contradict that
result because the new comparison never crossed the baseline quality gate.

The supported methodological rule is:

> A candidate cannot validate a benchmark that its control fails. Qualify the
> semantic corpus before using it to generalize a representation result.

No description repair or additional candidate run is justified in this
sequence. A future generalization should use an externally validated labeled
corpus or a pre-existing semantic benchmark whose quality contract is fixed
independently of Pace.

## Evidence boundaries

- One direct provider deployment and model version `2025-08-07`.
- Three-sample cohorts are descriptive, not statistically significant.
- The five-domain corpus is public-safe and frozen, but not independently
  validated by an external source.
- AI units, premium requests, cache-write tokens, and direct billing remained
  unavailable.

## Evidence bindings

- Source commit: `dfe5a4b9f076da710ce4506987181c60497013f0`
- Replay receipt: `sha256:4ceb4c27ad586e6b`
- Comparison receipt: `sha256:0b80b0d3afeeb6f3`
- Workload: `sha256:e3548e0182c2670db0761617425002ceae1b4b5ea89f4374a462837603acfd63`
- Source revision: `sha256:9ca5c05bcacdc2ed44818160f2ba0405257c5c3f9327079b7de64ec62eb3c5b2`
- Evaluator implementation: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:a11e5d7a686364263bfc3ac989598f62158130328d6446f0e45ea019361e7495`
- Candidate configuration: `sha256:af050c2ec61ab7d5b8662ff54eb28ca4a7a3c6950b68ccbbbb82eac36c6e24b8`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The receipts contain no local paths, user identity, prompt text, provider
endpoint, deployment name, bearer token, or private repository domains.
