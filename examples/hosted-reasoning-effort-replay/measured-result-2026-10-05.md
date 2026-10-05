# Measured result: medium versus low reasoning effort

- **Date:** October 5, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `keep` for the corrected frozen experiment

## Experiment

Both cohorts used the same eight semantic residual findings, inline JSON
transport, zero model-visible tools, deterministic preprocess and merge
implementation, `gpt-5-mini`, context tier `default`, exact evaluator, and
composite run accounting.

- **Baseline:** reasoning effort `medium`.
- **Candidate:** reasoning effort `low`, the smallest effort accepted by the
  measured model/runtime.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or lost
  findings.
- **Billing:** baseline used 0.43272 AI units in total; candidate used 0.32247,
  a 25.48% reduction. All six sessions reported zero premium requests.

The runtime probe reported CLI `1.0.88`; session profiles retained the separate
`1.0.87-0` telemetry version and mismatch warning. Per-call model receipts were
not available, so the cohort evidence floor is L2 even though all selected
totals are complete.

## Invalidated v1 treatment

The initial frozen candidate used reasoning effort `minimal`. `gpt-5-mini`
rejected that effort before its first model request. Its usage receipt reported
zero user requests and zero AI units. One baseline session had already
completed, but it was excluded because there was no matched candidate cohort.

A separate one-request canary confirmed that `low` was accepted. The canary is
not included in the comparison evidence. Only the balanced v2 cohort below
supports the `keep` disposition.

## Performance results

| Metric | Medium samples | Low samples | Comparison | Change |
|---|---:|---:|---:|---:|
| AI units | 0.14015, 0.143085, 0.149485 | 0.10221, 0.12455, 0.09571 | p50 0.143085 -> 0.10221 | -28.567% |
| Reasoning tokens | 256, 384, 448 | 192, 192, 192 | p50 384 -> 192 | -50% |
| Output tokens | 404, 534, 566 | 330, 326, 297 | p50 534 -> 326 | -38.951% |
| Logical input tokens | 2,374, 2,373, 2,373 | 2,370, 2,374, 2,374 | p50 2,373 -> 2,374 | +0.042% |
| Non-cached input tokens | 2,374, 1,349, 1,349 | 1,346, 2,374, 1,350 | p50 1,349 -> 1,350 | +0.074% |
| Cache-read tokens | 0, 1,024, 1,024 | 1,024, 0, 1,024 | p50 1,024 -> 1,024 | unchanged |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 5,641 ms, 15,447 ms, 6,083 ms | 6,179 ms, 8,349 ms, 3,532 ms | p90 13,574.2 -> 7,915 ms | -41.691% |
| End-to-end wall time | 18,999 ms, 28,281 ms, 16,779 ms | 14,678 ms, 19,415 ms, 22,164 ms | p90 26,424.6 -> 21,614.2 ms | -18.204% |
| Premium requests | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |

## Counterevidence retained

The candidate did not reduce input. Logical-input p50 increased by one token,
and non-cached-input p50 also increased by one token. Cache-read p50 was
unchanged. The reduction therefore came from less generated and reasoning work,
not a smaller prompt or runtime scaffold.

Median API time was 1.58% worse, and median end-to-end wall time was 2.19%
worse. The tail improved because the baseline contained a 15,447 ms API sample
and a 28,281 ms end-to-end sample: API p90 improved 41.69% and wall-time p90
improved 18.20%.

## Evidence bindings

- Source commit: `050abe3b94ffac232b8d743d082210a6a851f3f6`
- Invalidated v1 source commit: `ab9ff749684c1b5e7759c2284b284f11310d07e5`
- Replay receipt: `sha256:be1644a24a767f1d`
- Comparison receipt: `sha256:9f6eefb5a51ef8a1`
- Workload: `sha256:e2c694b38e8e4e305581176f3831c8c70946bcef58432180d9088e07d462f7f2`
- Source revision: `sha256:d408b902f59009a0f42fadbc7fb2b7201d5d7bf3870b774c0f8344b4272d50cb`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:71036f3a2e79caf41aea889d85edf549a477314b3f4482b485b20b092e375fd7`
- Candidate configuration: `sha256:92f6315e85fdd36efb5409026e9b2307433ec90a3735203fc7bf1cde639eaaaf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, or private repository domains.

## Interpretation

For this frozen semantic residual, lowering reasoning effort preserved exact
routing quality while halving median reasoning tokens and reducing median
output and AI usage. Input stayed flat because the same runtime scaffold,
taxonomy, and eight descriptions were still present.

This separates two optimization layers: reasoning effort controls generated
work, while transport and agent-boundary changes control fixed input overhead.
The next architectural experiment should keep the semantic payload fixed while
testing a thinner provider-neutral structured model boundary.

Three samples remain descriptive evidence, not a confidence-interval or
significance claim.
