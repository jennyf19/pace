# Measured result: compact owner encoding at 64 findings

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `keep`

## Experiment

Both cohorts used the same direct provider, deployment, declared
`gpt-5-mini` model, `low` reasoning effort, 64 findings, taxonomy meanings,
strict structure, deterministic stages, exact evaluator, and composite
accounting.

- **Baseline:** residual routes used full owner names: `identity`, `storage`,
  `compute`, and `messaging`.
- **Candidate:** residual routes used one-character codes: `i`, `s`, `c`, and
  `m`, then a deterministic transform decoded them before final merge.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or
  lost findings.

The candidate preserved every finding and taxonomy description. Only the
allowed-owner values, taxonomy keys, prompt example, and strict owner enum used
the compact representation. Unknown codes failed closed.

## Decision

| Decision metric | Full owner names | Owner codes | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 1,863 | 1,861 | -0.107% | met |
| Output-token p50 | 1,836 | 1,530 | -16.667% | met |
| Wall-time p90 | 17,959.4 ms | 15,854.8 ms | -11.719% | met |

Exact quality, accounting, and every declared performance goal passed.

## Full results

| Metric | Full-name samples | Owner-code samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 1,863, 1,863, 1,863 | 1,861, 1,861, 1,861 | p50 1,863 -> 1,861 | -0.107% |
| Non-cached input tokens | 1,863, 71, 1,863 | 1,861, 1,861, 69 | p50 1,863 -> 1,861 | -0.107% |
| Cache-read tokens | 0, 1,792, 0 | 0, 0, 1,792 | p50 0 -> 0 | unchanged |
| Output tokens | 1,629, 1,836, 1,996 | 1,494, 1,604, 1,530 | p50 1,836 -> 1,530 | -16.667% |
| Reasoning tokens | 960, 1,216, 1,344 | 832, 960, 896 | p50 1,216 -> 896 | -26.316% |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 14,909.805 ms, 13,563.265 ms, 18,645.014 ms | 11,890.239 ms, 12,600.248 ms, 16,610.039 ms | p50 14,909.805 -> 12,600.248 ms | -15.490% |
| End-to-end wall time | 15,077 ms, 13,594 ms, 18,680 ms | 11,941 ms, 12,654 ms, 16,655 ms | p50 15,077 -> 12,654 ms | -16.071% |

Both sides used the same direct-provider accounting boundary. AI units,
premium requests, and cache-write tokens remained unavailable on both sides.

## Why the result is surprising

One-character owner codes barely changed logical input: two tokens at p50.
They also did not explain most of the output reduction directly.

Subtracting each sample's reasoning tokens from total output gives a
visible-answer p50 of 652 tokens for full names and 644 for codes, a 1.227%
reduction. Reasoning p50 fell by 320 tokens, or 26.316%.

The measured win therefore appears to come primarily from changed model
reasoning behavior, not lexical compression of repeated owner strings. The
owner names may already tokenize efficiently, while shorter symbolic labels
may make the classification boundary easier for this serving stack.

That is a hypothesis, not a proven mechanism. A five-sample replication is
required before treating the reasoning reduction as stable.

## Latency

API-time p50 fell 15.490% and p90 fell 11.677%. End-to-end wall-time p50 fell
16.071% and p90 fell 11.719%.

At p50, deterministic and local orchestration added about 167 ms to the
full-name path and 54 ms to the owner-code path. Those small gaps do not drive
the result; the API-time effect tracks the reasoning/output reduction.

## Evidence boundaries

- The result applies to one direct provider deployment and model version
  `2025-08-07`.
- Three samples are descriptive evidence, not a confidence interval or
  significance claim.
- The representation change includes taxonomy keys, allowed-owner values,
  prompt example, and strict enum values as one treatment.
- The deterministic code projection and decoder are hash-bound with the
  existing hybrid transform.

## Evidence bindings

- Source commit: `b9ec8407785ed4261e0b8a24d8eb6f31587c0a7c`
- Replay receipt: `sha256:b9eee62513693cb9`
- Comparison receipt: `sha256:7122de503e1dcca2`
- Workload: `sha256:1c3e67e2c709237319679f739b5d388e6b8e33271041773aaafc4b400d485907`
- Source revision: `sha256:eb6da7c75fcb532872ba24ec46b428ddf3e567590d9145d8217d6dcb8f4dccaa`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:670f0f2fb9bd32b3d2bad705bf287155a438aad981396d604bec8af749be08f6`
- Candidate configuration: `sha256:064b3daffcb7543c340a1cecf045e7dcfcda110e553c208161c6b642acc5dbb1`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

Compact symbolic labels recovered the output regression observed at the
64-finding scale point while preserving exact final semantics. The treatment
also reduced reasoning and latency without increasing input.

This is a useful architectural result: response vocabulary can alter model
work, not just serialization size. Because the reasoning effect is much larger
than the visible-text effect, replication is the correct next move.
