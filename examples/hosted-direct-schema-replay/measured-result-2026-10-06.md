# Measured result: strict schema versus prompt-only direct output

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `revise`

## Experiment

Both cohorts used the same direct endpoint and deployment, model version
`2025-08-07`, declared `gpt-5-mini` model, `low` reasoning effort, inline
prompt, eight residual findings, taxonomy, deterministic preprocess and merge,
exact evaluator, and composite accounting.

- **Baseline:** strict JSON schema through `text.format`.
- **Candidate:** the identical prompt and payload with no response format.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or lost
  findings.

This is a stronger treatment isolation than the host-boundary replay: the only
request-body change is schema enforcement.

## Decision

Prompt-only output met the input and wall-time goals but missed the declared
output-token goal. Pace therefore returned `revise` instead of treating one
improved metric as sufficient.

| Decision metric | Strict schema | Prompt only | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 480 | 384 | -20% | met |
| Output-token p50 | 288 | 298 | +3.472% | missed |
| Wall-time p90 | 8,075.2 ms | 3,942.2 ms | -51.181% | met |

## Full results

| Metric | Strict-schema samples | Prompt-only samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 480, 480, 480 | 384, 384, 384 | p50 480 -> 384 | -20% |
| Non-cached input tokens | 480, 480, 480 | 384, 384, 384 | p50 480 -> 384 | -20% |
| Output tokens | 289, 288, 275 | 305, 298, 291 | p50 288 -> 298 | +3.472% |
| Reasoning tokens | 192, 128, 128 | 192, 192, 192 | p50 128 -> 192 | +50% |
| Cache-read tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 9,183.862 ms, 3,364.255 ms, 3,413.875 ms | 3,964.358 ms, 3,416.67 ms, 3,762.855 ms | p90 8,029.865 -> 3,924.058 ms | -51.132% |
| End-to-end wall time | 9,235 ms, 3,383 ms, 3,436 ms | 3,983 ms, 3,436 ms, 3,779 ms | p90 8,075.2 -> 3,942.2 ms | -51.181% |

Provider AI units, premium requests, and cache-write tokens were unavailable
on both sides and remain incomplete. No cost claim is made.

## Counterevidence retained

The tail improvement is dominated by one 9,235 ms strict-schema sample.
Prompt-only median API time was 10.22% worse, and median wall time was 9.98%
worse. The candidate was more stable in this three-sample cohort, but not
uniformly faster.

Removing the schema saved exactly 96 input tokens per sample. It also increased
median reasoning by 64 tokens and median output by 10 tokens. A plausible
interpretation is that strict schema constrained generation enough to offset
part of its input overhead, but this receipt does not establish mechanism.

Prompt-only output happened to preserve exact quality in all three samples.
That is descriptive evidence, not a guarantee that shape and coverage remain
stable on a larger or more varied corpus.

## Evidence bindings

- Source commit: `f9c070658519727d1e3d341a0542caed176b4875`
- Replay receipt: `sha256:8a75ae9dbe07cd8a`
- Comparison receipt: `sha256:73eca9423fa34eff`
- Workload: `sha256:140e7f0fdfc4fc2ba98cb87b7a19513cde0eefb2638e5a706f65f8035b2b620f`
- Source revision: `sha256:a1816cd85916a366ed035bc5ccd2a7651df558714c77f8f679d0d859cb3bb964`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:5a5b3f5eb2c5709c3ea494dbf660d642bd4791fd2c636ebcdedd2772af06d8fc`
- Candidate configuration: `sha256:26a1af74b87a54b1a905fa33221863ca3fb6438b352a4a1fc7ad1582219ba0a8`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

Strict schema costs 96 input tokens on this frozen residual, but prompt-only
generation spent more output and reasoning tokens and missed the declared
optimization goal. The current evidence does not support removing strict
schema.

The next low-entropy treatment is a lighter JSON-only response contract:
preserve machine-readable syntax without repeating the full IDs-and-owners
schema. That tests whether a middle boundary can retain quality and generation
control with less input overhead.

Three samples remain descriptive evidence, not a confidence-interval or
significance claim.
