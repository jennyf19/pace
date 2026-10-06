# Measured result: anchored response-structure compression

- **Date:** October 6, 2026
- **Status:** Descriptive `n=3` discovery sequence
- **Final disposition:** `keep`

> **Replication update:** The unchanged balanced `n=5` replication passed
> exact quality only 4/5 and returned `reject`. The keep below is a discovery
> result, not a stable recommendation. See
> `replication-result-2026-10-06.md`.

## Question

The direct 64-finding response repeated every finding ID inside 64
`{id, owner}` objects even though deterministic code already knew the frozen
input order. This experiment asked whether that redundant response structure
could be removed without changing semantic owner labels or adding model calls.

All attempts used the same validated four-owner workload, direct provider
deployment, `gpt-5-mini`, `low` reasoning effort, exact evaluator, and
deterministic final merge.

## Attempt history

### v1: unanchored owner vector reject

The first candidate emitted one strict 64-position owner array and mapped each
position back to the corresponding frozen finding ID.

- Baseline quality: 3/3 exact.
- Candidate quality: 2/3 exact.
- Input-token p50: -10.932%.
- Output-token p50: -34.101%.
- Wall-time p90: -21.216%.

One candidate sample duplicated the owner at position 38. The remaining 27
owners shifted by one position and the final owner disappeared. The response
still satisfied the 64-item schema, proving that strict length does not prove
semantic alignment.

Pace returned `reject`.

### v2: eight anchored blocks revise

The response was changed to eight arrays of eight owners. Each array was keyed
by the first finding ID in its fixed block. Deterministic code required every
anchor and exactly eight owners per block.

- Baseline quality: 3/3 exact.
- Candidate quality: 3/3 exact.
- Input-token p50: +0.857%, or 16 tokens.
- Output-token p50: -30.466%.
- Reasoning-token p50: -12.500%.
- API-time p50: -19.484%.
- Wall-time p90: -30.981%.

Anchors eliminated the global alignment failure. The only declared miss was
input: the candidate prompt contained 77 words versus 47 for baseline.

Pace returned `revise`.

### v3: concise anchored blocks keep

The anchored schema, block mapping, owner vocabulary, workload, model, and
decode remained unchanged. Only the candidate prompt was reduced from 77 to
46 words under fresh source, configuration, replay, and comparison identities.

Both cohorts passed exact quality 3/3 with no lost findings, regressions, or
accounting residuals.

| Metric | Route objects | Anchored owner blocks | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,866 | 1,851 | -0.804% |
| Output-token p50 | 1,721 | 1,268 | -26.322% |
| Reasoning-token p50 | 1,088 | 1,024 | -5.882% |
| Visible-answer p50 | 633 | 244 | -61.453% |
| API-time p50 | 12,876.588 ms | 10,535.293 ms | -18.183% |
| Wall-time p50 | 13,006 ms | 10,596 ms | -18.530% |
| Wall-time p90 | 13,260.4 ms | 12,007.2 ms | -9.451% |

Pace returned `keep`.

## Interpretation

The useful design is not an unanchored vector. It is deterministic
reconstruction with bounded alignment domains:

> Remove response data the host already knows, but retain enough periodic
> anchors that one local generation mistake cannot corrupt the remaining
> response.

The result also demonstrates why prompt cost belongs inside the treatment.
The v2 schema already delivered large output and latency improvements, but 30
extra prompt words erased its logical input saving. Trimming only that measured
overhead converted the same anchored representation from `revise` to `keep`.

Visible serialization, not reasoning, is the stable mechanism in this
discovery. The anchored candidate reduced visible-answer p50 61.453%.
Reasoning-token p50 fell only 5.882%, and candidate reasoning-token p90 rose
17.647%. The tail counterevidence prevents a broad claim that structural
compression always reduces reasoning.

## Cache counterevidence

In v3, baseline cache-read p50 was 1,792 tokens while candidate p50 was zero.
Logical input still fell by 15 tokens, but non-cached input moved in the
opposite direction. Cache behavior remains request-order and provider
sensitive, so no billing claim is supported.

## Evidence boundaries

- All attempts used one direct provider deployment and model version
  `2025-08-07`.
- Three-sample cohorts are descriptive, not statistically significant.
- The frozen finding order is part of the candidate contract.
- The eight-finding anchor interval is measured only on this 64-finding
  workload.
- AI units, premium requests, cache-write tokens, and direct billing remained
  unavailable.

## Evidence bindings

### v1: unanchored vector

- Source commit: `41747c63dab0cf9ea376a8d8572837c901e5e56d`
- Replay receipt: `sha256:97f7526da8ea9867`
- Comparison receipt: `sha256:0a0e0374fc169355`
- Workload: `sha256:2b7ee82ebf5ee62b6c496c511c48be446ca3c1eec7ed02314036fe408149b921`
- Source revision: `sha256:0816e31d2e7f006928da160241269f1e4a1b8afd8087842e842a77143b9d41ff`
- Baseline configuration: `sha256:e8dc1feee1a543039a2de2eece68b706c2a295e4b09664d925935d8be45c8bed`
- Candidate configuration: `sha256:b36d69fdd6b7a68a33bc989347d0f2ce7e9291779f0ae1bf90f2262ee848ec11`

### v2: anchored blocks

- Source commit: `ffdcc3f54039e692ff012e0058ba321277db0e54`
- Replay receipt: `sha256:1c85c2b033bf4194`
- Comparison receipt: `sha256:1820789d054f1ff1`
- Workload: `sha256:078688c8e83c1a92cbafc1a5b5039160ed0781877423a820b4b7ff877702659f`
- Source revision: `sha256:b4046463d07b59cc8ef30f9ec8013aacc086b63f4e51bda4bd477373641b32b2`
- Baseline configuration: `sha256:9b1df567392a795be5b8606b220e092abd9eebf477f2da2ed38bd19697c8f5d8`
- Candidate configuration: `sha256:f57aa8c2ba5bb1b47c055e90ff8e104201e4cf4040250effd95563d22558320c`

### v3: concise anchored blocks

- Source commit: `ac8a13fddadcf1dba495c1b725c5e8251562308c`
- Replay receipt: `sha256:999d0a099a03ce60`
- Comparison receipt: `sha256:ca1a31fbe2718234`
- Workload: `sha256:209ade620aa6e8c509403d3edcc2091d58f10f7eca90bfc68b4dec175a4d8f46`
- Source revision: `sha256:b8f0ad0fde5fcc9bd538db0f5d111ea364f07068550248e7ea35bebf5c9256e1`
- Baseline configuration: `sha256:30c74976e565323e0d79cf4424c52ce468fba32f2bccc15a243abc8403cf73e6`
- Candidate configuration: `sha256:9a4cf0824686e8958d42527ee815007b9828efa207e3935909ce90c130f6465c`

Shared evaluator implementation:
`sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`.

Private provider configuration:
`sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`.

The receipts contain no local paths, user identity, prompt text, provider
endpoint, deployment name, bearer token, or private repository domains.
