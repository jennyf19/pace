# Measured result: Copilot host versus direct structured model boundary

- **Date:** October 5, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `keep` for this frozen experiment

## Experiment

Both cohorts used the same eight semantic residual findings, owner taxonomy,
inline prompt, declared `gpt-5-mini` model name, `low` reasoning effort,
deterministic preprocess and merge implementation, exact evaluator, and
composite run accounting.

- **Baseline:** Copilot CLI `1.0.88` with zero visible tools.
- **Candidate:** one Azure OpenAI Responses API call with a strict JSON schema
  for the existing residual-route shape.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or lost
  findings.
- **Reasoning:** both cohorts reported exactly 192 reasoning tokens in every
  sample.

The direct deployment reported model version `2025-08-07`. Copilot exposed the
same selected model name but not an underlying model version. This is therefore
a same-name model comparison, not proof of identical model weights or serving
stacks.

## Accounting boundary

The direct Responses API reported input, cached input, output, and reasoning
tokens. It did not report Copilot AI units, premium requests, or cache-write
tokens. Pace retained those candidate metrics as incomplete instead of
converting absence into zero.

No cross-provider cost or billing-savings claim is made. All selected decision
metrics were complete on both sides.

## Performance results

| Metric | Copilot host samples | Direct structured samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 2,377, 2,371, 2,372 | 480, 480, 480 | p50 2,372 -> 480 | -79.764% |
| Non-cached input tokens | 2,377, 1,347, 1,348 | 480, 480, 480 | p50 1,348 -> 480 | -64.392% |
| Cache-read tokens | 0, 1,024, 1,024 | 0, 0, 0 | p50 1,024 -> 0 | -100% |
| Output tokens | 319, 336, 321 | 311, 304, 305 | p50 321 -> 305 | -4.984% |
| Reasoning tokens | 192, 192, 192 | 192, 192, 192 | p50 192 -> 192 | unchanged |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 5,112 ms, 6,444 ms, 3,961 ms | 4,502.458 ms, 4,997.337 ms, 3,678.363 ms | p90 6,177.6 -> 4,898.361 ms | -20.708% |
| End-to-end wall time | 94,997 ms, 18,356 ms, 18,512 ms | 4,537 ms, 5,020 ms, 3,709 ms | p90 79,700 -> 4,923.4 ms | -93.823% |

Baseline AI units were 0.123225, 0.103435, and 0.10046. The direct provider did
not report a comparable AI-unit measure, so those values are descriptive only.

## Counterevidence retained

The baseline wall-time p90 improvement is dominated by one 94,997 ms Copilot
sample. That sample's model API time was only 5,112 ms. Median wall time still
improved 75.49%, but API-time p50 improved 11.92% and API-time p90 improved
20.71%. The large remaining gap is host/session lifecycle, not model inference
alone.

The candidate also used strict structured output while the baseline enforced
the output shape through prompt instructions. Structured output is part of the
direct-boundary treatment; this receipt does not isolate raw HTTP transport
from schema enforcement.

Provider billing, cache-write tokens, and exact serving-stack equivalence remain
unproven. The result applies to this bounded, one-call semantic residual and
does not justify replacing tool-using or multi-turn agent workloads.

## Evidence bindings

- Source commit: `9c9a0979cf3c6dd0bcc3508d972cbf1a2b7b8e18`
- Replay receipt: `sha256:c911b70f425b4382`
- Comparison receipt: `sha256:4fc5439045eb4ad3`
- Workload: `sha256:b7f24e1e9fb5114bbc10b3933c6473de18b40ff0521b07d1c8bafc7944f74413`
- Source revision: `sha256:15175fdaceb05764164b1e01b6bfac5cca31a146b8f4ea8a4971f432bd2db221`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:e7438fc6c67ac7c1a72f0cac5611e7ca44576a72412cbc5acfebf21308e203ed`
- Candidate configuration: `sha256:3a074e5c62c571b4ace3ffc568f974fbad9c3b768c747231f8b9a1f201edb5b4`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

After visible tools reached zero, the Copilot host still carried about 1,892
more median input tokens than the direct structured request. The direct request
used 480 tokens, including the same semantic payload and the response schema.
Reasoning remained exactly 192 tokens and output changed only slightly, which
suggests that the semantic work stayed stable while fixed host scaffold fell
away.

The API-time improvement was meaningful but much smaller than the end-to-end
improvement. For this one-call residual, the host lifecycle was a larger
latency target than model inference.

Three samples remain descriptive evidence, not a confidence-interval or
significance claim.
