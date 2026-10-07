# Measured result: BANKING77 explicit ID-owner pairs

- **Date:** October 7, 2026
- **Status:** Descriptive `n=3` discovery plus balanced `n=5` replication
- **Final disposition:** `keep`

## Question

Explicit `[finding_id, owner]` pairs replicated on Pace's validated synthetic
64-finding workload. This experiment asked whether the response representation
generalized to externally labeled semantic data.

The scenario uses a deterministic 40-example subset of the official BANKING77
test split:

- upstream repository:
  `https://github.com/PolyAI-LDN/task-specific-datasets`;
- pinned commit:
  `57ec275d8078af65b7731c2a98be812d844a6d6b`;
- license: Creative Commons Attribution 4.0 International;
- category indexes: `0, 15, 30, 45, 60`;
- examples: first eight test rows for each selected category.

The selected intents are:

- `card_arrival`;
- `top_up_by_bank_transfer_charge`;
- `unable_to_verify_identity`;
- `declined_card_payment`;
- `getting_spare_card`.

The treatment remained unchanged:

- baseline: 40 `{id, owner}` route objects;
- candidate: 40 `[finding_id, owner]` pairs;
- one direct request per sample;
- exact upstream intent labels;
- strict schemas;
- deterministic source-row ID validation and final merge.

## Discovery result

The balanced `n=3` cohort returned `keep`.

- Baseline quality: 3/3 exact.
- Candidate quality: 3/3 exact.
- Input-token p50: -0.512%.
- Output-token p50: -11.613%.
- Wall-time p90: -26.600%.
- Reasoning-token p50: unchanged at 128.

## Transport attempts

The first unchanged `n=5` run completed nine responses and failed on the tenth
with `fetch failed`. Two fresh-output retries also failed at transport before
balanced cohorts existed. All three partial attempts are preserved outside the
repository and excluded from evidence.

The direct runner was then versioned to report a privacy-safe fetch cause code.
A separate balanced `n=2` transport probe completed successfully and was also
excluded from the final replication.

No partial profile or probe sample contributes to the `n=5` result below.

## Replication result

The fresh balanced `n=5` cohort returned `keep`.

Both arms passed exact quality 5/5 with zero intent mismatches, lost findings,
ID-order errors, or accounting residuals.

| Metric | Route objects | Explicit pairs | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,564 | 1,556 | -0.512% |
| Output-token p50 | 835 | 644 | -22.874% |
| Reasoning-token p50 | 192 | 64 | -66.667% |
| Visible-answer p50 | 643 | 580 | -9.798% |
| API-time p50 | 8,723.175 ms | 6,118.356 ms | -29.861% |
| Wall-time p50 | 8,776 ms | 6,136 ms | -30.082% |
| Wall-time p90 | 9,357.2 ms | 8,982.8 ms | -4.001% |

The logical input saving was exactly eight tokens in both discovery and
replication, binding the input effect to the fixed prompt and schema change.

## Interpretation

The explicit-pair result now generalizes across two distinct semantic
workloads:

1. Pace's synthetic four-owner finding routing;
2. BANKING77 intent classification using externally published labels.

The supported response-design rule is:

> Preserve explicit item identity and local label association. Compress the
> repeated field names around that association.

Visible serialization improved in both BANKING77 cohorts: 13.910% at `n=3`
and 9.798% at `n=5`. Reasoning did not provide the stable mechanism. It was
unchanged in discovery and fell sharply in replication, so the evidence does
not support assuming a fixed reasoning benefit.

## License and attribution

The selected utterances and labels remain BANKING77 data and are redistributed
under CC BY 4.0. The pinned upstream hashes, deterministic selection rule,
modifications, citation, attribution, and normalized license copy are committed
with the scenario.

## Evidence boundaries

- One direct provider deployment and model version `2025-08-07`.
- The selected subset covers five of BANKING77's 77 intents and 40 of the
  official test examples.
- The cohorts remain descriptive, not statistically significant.
- AI units, premium requests, cache-write tokens, and direct billing remained
  unavailable.

## Evidence bindings

### v1: `n=3` discovery

- Source commit: `ea298771517c64cf0aba5c2cdba1cccc7efb046f`
- Replay receipt: `sha256:8b4f5a22a126cb3d`
- Comparison receipt: `sha256:069e7406ba1a2a77`
- Workload: `sha256:8bd21b1dc5d8895bffc41ce0a526fd83a33f09ba5cf56ccb1d49e4781bd38e72`
- Source revision: `sha256:bcbd52132b650dde7f3f4537f414ba00f4ad6c803f1b5b2a1b56914d40ca7630`
- Baseline configuration: `sha256:8fb7e0f95116693af132d2550597988f01a237c2dbc87c2ea382fe434a773e10`
- Candidate configuration: `sha256:eb74f6ade96c5ebe3586d91c8ee31046252b37462d7385c449e630da0865e415`

### v3: `n=5` replication

- Source commit: `a4078d3367819c358703859d615124770f3b606c`
- Replay receipt: `sha256:75112a3dfff46978`
- Comparison receipt: `sha256:c04712d51628cc68`
- Workload: `sha256:51dca38db3f9f3cded736c67853135b4becf7d536a608d584a03f9c30b18a165`
- Source revision: `sha256:9f78a6c86f4104b4373193600f755958cab835deb561f092c897fbb461f29ef4`
- Baseline configuration: `sha256:96d54c66760eb29af9e7c344a1a5805fed74b0adc41a7659697053efa8419b69`
- Candidate configuration: `sha256:e31fa867f51fe065b83d0e744dc8d2ad9756efbd0e3e7cb606d24d7dcf261d44`

### Pinned upstream files

- `categories.json`:
  `sha256:53261da888122daf2d120d925458631d9619e15d82e56052e7a42e535ce32b63`
- `test.csv`:
  `sha256:d12d6e3bc4c3103966ae786dc435913c0c563dfa328f5a3646d0e62cfeeb474d`
- `LICENSE`:
  `sha256:7e7170e3cebf88a9f60c7b8421418323c09304da1af4d5e90f4da1dc1c8a2661`

Shared evaluator implementation:
`sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`.

Private provider configuration:
`sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`.

The receipts contain no local paths, user identity, prompt text, provider
endpoint, deployment name, bearer token, or private repository domains.
