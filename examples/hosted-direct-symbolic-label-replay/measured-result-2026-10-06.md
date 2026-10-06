# Measured result: symbolic labels at eight-category granularity

- **Date:** October 6, 2026
- **Status:** Discovery boundary; descriptive `n=3` cohorts
- **Final disposition:** `reject`

## Question

Compact owner codes improved quality-gated output and latency for a coarse
four-owner taxonomy. This experiment asked whether the same response pattern
generalized after doubling semantic label cardinality to eight:

- identity access versus governance;
- storage access versus lifecycle;
- compute runtime versus capacity;
- messaging control versus delivery.

The workload preserved the same 64 finding IDs and severities. One ambiguous
checkpoint description was eventually clarified, and one scheduler finding
was moved from a forced balanced bucket to its more natural semantic label.

## Attempt history

### v1: output ceiling invalidation

The first full-label request exhausted the shared 2,048-token output ceiling
and returned `incomplete` before a balanced cohort existed. No comparison
receipt was produced.

The direct runner now reports provider incomplete reasons explicitly. The
experiment was versioned with a 4,096-token ceiling for both cohorts.

### v2: bare symbols reject

- Full labels: 3/3 exact.
- Bare symbols: 0/3 exact.
- Repeated confusions included messaging control versus delivery, identity
  governance, and compute runtime versus capacity.
- Replay: `sha256:f359ba7a25184cf9`.
- Comparison: `sha256:fcbf808a2b75b2d4`.

The symbolic path reduced input-token p50 2.295% and output-token p50 4.901%,
but quality failed and wall-time p90 rose 16.843%.

### v3: named taxonomy values reject

The candidate retained every full label name once inside its symbolic taxonomy
value while still emitting one-character symbols.

- Full labels: 2/3 exact.
- Named symbols: 1/3 exact.
- The full-label miss was messaging control versus delivery.
- The symbolic misses consistently included compute runtime versus capacity.
- Replay: `sha256:d2f94c88ef785c51`.
- Comparison: `sha256:e80499f9b0548772`.

All declared performance goals were met descriptively, but quality failed.

### v4: corrected synthetic ground truth reject

The final revision removed forced balance:

- `H055`, a batch-scheduler finding, moved from compute runtime to compute
  capacity;
- `H044` explicitly named checkpoint access control;
- compute runtime and capacity contained seven and nine findings rather than
  forcing eight each.

Quality remained unstable:

- Full labels: 1/3 exact.
- Named symbols: 2/3 exact.
- Full-label samples still split on `H055`.
- One symbolic sample routed dead-letter retention from messaging control to
  messaging delivery.
- No response was truncated or structurally invalid; every response covered
  all 64 findings.

Pace returned `reject`.

## Final descriptive performance

Performance cannot override the failed quality gate:

| Metric | Full labels | Named symbols | Change |
|---|---:|---:|---:|
| Input-token p50 | 2,050 | 2,033 | -0.829% |
| Output-token p50 | 2,352 | 2,073 | -11.862% |
| Reasoning-token p50 | 1,600 | 1,408 | -12.000% |
| API-time p50 | 20,765.955 ms | 17,671.993 ms | -14.899% |
| Wall-time p50 | 20,871 ms | 17,693 ms | -15.227% |
| Wall-time p90 | 24,340.6 ms | 18,865 ms | -22.496% |

The compact representation remained cheaper and faster descriptively. It was
not quality-safe at this semantic granularity.

## Interpretation

The four-owner result does not generalize automatically to eight finer labels.
At four labels, broad taxonomy descriptions were sufficient for symbolic
aliases. At eight labels, neighboring categories depended on nuanced and
sometimes genuinely overlapping semantics.

The stronger boundary is not “symbols fail.” It is:

> Symbolic output labels are safe only when the semantic taxonomy is already
> stable enough that label names are not carrying essential disambiguation.

This experiment also exposed a benchmark-design limit. Exact quality cannot be
used to compare representations when the full-label baseline itself is not
stable against the frozen ground truth.

The branch closes here rather than repeatedly rewriting synthetic findings
until the desired treatment passes. A future generalization should start with
an independently validated semantic corpus, not another post-hoc split of the
same 64 descriptions.

## Evidence boundaries

- All completed cohorts used one direct provider deployment and model version
  `2025-08-07`.
- Three-sample cohorts are descriptive, not statistically significant.
- AI units, premium requests, and cache-write tokens remained unavailable.
- Performance distributions from rejected cohorts are counterevidence, not
  optimization claims.

## Final v4 evidence bindings

- Source commit: `22a1d9e6701e10ca135c1a9e4a4f4c3e7321bfcc`
- Replay receipt: `sha256:7619ca9fe8d95ebc`
- Comparison receipt: `sha256:687c0fd6693c0b20`
- Workload: `sha256:5b22c0048d97d939b54988a1d4f29a6b66f10e240476560e3c5609e919e7c9d8`
- Source revision: `sha256:b4abf1b837e5e860742bae25e149e143a6f9010e964324556b3357cbcf354b47`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:88a1545b4e47a953907c09cf5af55e8a58892249bf7558c6797de0cccfc96a55`
- Candidate configuration: `sha256:66459ec047ad80b8a257f125af5e274f46989586654e064c3c226c0fb2d308fc`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final receipts contain no local paths, user identity, prompt text,
provider endpoint, deployment name, bearer token, or private repository
domains.
