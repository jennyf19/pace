# Replication result: compact owner encoding at 64 findings

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=5` per cohort
- **Disposition:** `keep`

## Experiment

This repeats the v0.13 owner-encoding treatment with fresh configuration and
replay identities and a balanced five-sample cohort.

Both cohorts used the same direct provider, deployment, model version
`2025-08-07`, `low` reasoning effort, 64 findings, taxonomy meanings, strict
structure, deterministic stages, exact evaluator, and composite accounting.

- **Baseline:** full owner names.
- **Candidate:** one-character owner codes with deterministic decode.
- **Quality:** baseline 5/5 passed; candidate 5/5 passed; no regressions or
  lost findings.

## Replicated decision

| Decision metric | Full owner names | Owner codes | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 1,865 | 1,863 | -0.107% | met |
| Output-token p50 | 1,599 | 1,527 | -4.503% | met |
| Wall-time p90 | 17,574 ms | 13,190.4 ms | -24.944% | met |

Exact quality, accounting, and every declared performance goal passed.

## Full results

| Metric | Full-name samples | Owner-code samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 1,865, 1,865, 1,865, 1,865, 1,865 | 1,863, 1,863, 1,863, 1,863, 1,863 | p50 1,865 -> 1,863 | -0.107% |
| Non-cached input tokens | 1,865, 1,865, 73, 73, 73 | 1,863, 71, 71, 71, 71 | p50 73 -> 71 | -2.740% |
| Cache-read tokens | 0, 0, 1,792, 1,792, 1,792 | 0, 1,792, 1,792, 1,792, 1,792 | p50 1,792 -> 1,792 | unchanged |
| Output tokens | 1,884, 1,599, 1,534, 1,593, 1,795 | 1,527, 1,526, 1,499, 1,531, 1,551 | p50 1,599 -> 1,527 | -4.503% |
| Reasoning tokens | 1,216, 960, 896, 960, 1,152 | 896, 896, 896, 896, 896 | p50 960 -> 896 | -6.667% |
| Tool-definition tokens | 0, 0, 0, 0, 0 | 0, 0, 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 19,184.72 ms, 11,505.708 ms, 11,240.836 ms, 15,035.934 ms, 13,405.657 ms | 13,824.259 ms, 12,163.953 ms, 11,821.261 ms, 9,815.348 ms, 10,913.606 ms | p50 13,405.657 -> 11,821.261 ms | -11.819% |
| End-to-end wall time | 19,254 ms, 11,527 ms, 11,259 ms, 15,054 ms, 13,424 ms | 13,858 ms, 12,189 ms, 11,842 ms, 9,837 ms, 10,942 ms | p50 13,424 -> 11,842 ms | -11.785% |

Both sides used the same direct-provider accounting boundary. AI units,
premium requests, and cache-write tokens remained unavailable on both sides.

The candidate received one more cache hit than the baseline, but logical input
was constant within each cohort and was the selected decision metric.

## Replication comparison

| Metric | `n=3` change | `n=5` change |
|---|---:|---:|
| Input-token p50 | -0.107% | -0.107% |
| Output-token p50 | -16.667% | -4.503% |
| Reasoning-token p50 | -26.316% | -6.667% |
| Visible-answer p50 | -1.227% | -1.252% |
| API-time p50 | -15.490% | -11.819% |
| Wall-time p50 | -16.071% | -11.785% |
| Wall-time p90 | -11.719% | -24.944% |

The visible-answer effect reproduced almost exactly: 652 -> 644 tokens at
`n=3`, then 639 -> 631 tokens at `n=5`. In both cohorts, compact encoding saved
eight median visible tokens.

The reasoning effect remained directionally favorable but attenuated from
320 tokens at `n=3` to 64 tokens at `n=5`. Candidate reasoning was exactly 896
tokens in all five replication samples, while the full-name baseline ranged
from 896 to 1,216 tokens.

The supported interpretation is therefore narrower than the first discovery:

- compact representation has a small, reproducible visible-output benefit;
- it also reduced reasoning in both cohorts, but the magnitude is variable;
- combined output and latency improvements remained material and quality-safe.

## Tail behavior

Output-token p90 fell 16.522%, reasoning-token p90 fell 24.731%, API-time p90
fell 24.907%, and wall-time p90 fell 24.944%.

The replicated tail effect is stronger than the median output effect. Compact
labels appear to remove some high-reasoning runs, but five samples remain
descriptive rather than statistically conclusive.

## Evidence boundaries

- The result applies to one direct provider deployment and model version
  `2025-08-07`.
- Five samples improve descriptive stability but do not establish statistical
  significance.
- The representation treatment includes taxonomy keys, allowed-owner values,
  prompt example, and strict enum values.
- Cache-write and billing metrics remained incomplete.

## Evidence bindings

- Source commit: `65426eed201f21ddc37292c3172d080178174bfb`
- Replay receipt: `sha256:7d5544b60962c2d9`
- Comparison receipt: `sha256:77aba7374757653c`
- Workload: `sha256:e9939a23ca43cc96be87f55264f54f287d14e57de6ea68b2c994fcce91bf4094`
- Source revision: `sha256:5b48fe49850c783d6b99cf488066c7cc6d7202177c1a0b4bc6714ebfc106ce41`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:8c6f6eedc8707ba4dd78ff0c1ed0e6dcf4e58e2b5d89c5e9b7408b951a67b3fc`
- Candidate configuration: `sha256:580d18720a1fec92dcce06f13fadf4607ae77c1fe5d43f83e2073d3ce902e63c`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

Compact owner codes are now the measured winner for this bounded 64-finding
direct route shape. The quality-safe output and latency improvements
replicated, while the initial very large reasoning estimate regressed toward a
smaller but still favorable effect.

The next generalization question is whether symbolic response vocabularies
produce the same benefit on a different semantic workload or with a different
number of labels.
