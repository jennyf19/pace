# Measured result: strict schema versus JSON-object mode

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `revise`

## Experiment

Both cohorts used the same direct endpoint and deployment, model version
`2025-08-07`, declared `gpt-5-mini` model, `low` reasoning effort, inline
prompt, eight residual findings, taxonomy, deterministic preprocess and merge,
exact evaluator, and composite accounting.

- **Baseline:** strict JSON schema with the eight route IDs and four owners.
- **Candidate:** JSON-object syntax enforcement without the route schema.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or lost
  findings.

The only request-body change was the `text.format` object.

## Decision

JSON-object mode met the input goal but missed both the output-token and
wall-time goals. Pace therefore returned `revise`.

| Decision metric | Strict schema | JSON object | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 480 | 384 | -20% | met |
| Output-token p50 | 293 | 303 | +3.413% | missed |
| Wall-time p90 | 4,671.4 ms | 5,721.6 ms | +22.481% | missed |

## Full results

| Metric | Strict-schema samples | JSON-object samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 480, 480, 480 | 384, 384, 384 | p50 480 -> 384 | -20% |
| Non-cached input tokens | 480, 480, 480 | 384, 384, 384 | p50 480 -> 384 | -20% |
| Output tokens | 293, 304, 278 | 402, 303, 280 | p50 293 -> 303 | +3.413% |
| Reasoning tokens | 192, 192, 128 | 256, 192, 128 | p50 192 -> 192 | unchanged |
| Cache-read tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 4,832.212 ms, 3,361.243 ms, 3,825.47 ms | 4,042.996 ms, 3,447.61 ms, 6,115.016 ms | p90 4,630.864 -> 5,700.612 ms | +23.100% |
| End-to-end wall time | 4,878 ms, 3,379 ms, 3,845 ms | 4,060 ms, 3,464 ms, 6,137 ms | p90 4,671.4 -> 5,721.6 ms | +22.481% |

Provider AI units, premium requests, and cache-write tokens were unavailable
on both sides and remain incomplete. No cost claim is made.

## Counterevidence retained

JSON-object mode saved exactly the same 96 input tokens as prompt-only output.
It did not repeat the strict IDs-and-owners schema. One candidate sample still
used 402 output tokens and 256 reasoning tokens, lifting output p90 26.64% and
reasoning p90 26.67%.

Median reasoning was unchanged, but median API time was 5.69% worse and median
wall time was 5.59% worse. Unlike the prompt-only replay, JSON-object mode also
made the measured tail worse.

Exact quality remained 3/3, but this bounded corpus cannot establish that
JSON-object mode preserves route coverage and allowed values as reliably as a
strict schema on broader inputs.

## Evidence bindings

- Source commit: `06bf356ce89318fb096a6b26c258425446752640`
- Replay receipt: `sha256:8d0f386b17a505bc`
- Comparison receipt: `sha256:9a64515ecc7ed407`
- Workload: `sha256:0b18b16a4574fa47348754a05f4650b86d09a69965171fadef857415aa5af243`
- Source revision: `sha256:a8311dfa031bb4c3bec523334a3646d5886fbb000693d3190ff21113e3c0a895`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:4911cf6044a07c9e630b5f993c8e1a4105db4b44cc970e3c0d46fa118350c5c9`
- Candidate configuration: `sha256:3b7061a443d12ebd20a219f407ebb4564fcf4e94136fdbdf946afddb257396c7`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

The lighter JSON-object contract did not recover the strict schema's generation
control. It saved input but increased output and latency and failed two declared
goals. Combined with the prompt-only result, the current evidence favors the
full strict schema for this residual.

Further response-format micro-optimization has diminishing value. The next
experiment should replicate the strict-schema direct boundary and Copilot-host
comparison at a larger sample count to test the lifecycle and tail findings.

Three samples remain descriptive evidence, not a confidence-interval or
significance claim.
