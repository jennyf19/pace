# Measured result: direct boundary at 24 semantic findings

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `keep`

## Experiment

This scales the direct-boundary treatment from 8 to 24 semantic residual
findings. The source descriptions, severities, IDs, owner taxonomy, and final
owner routes came from the existing 24-finding hybrid corpus. Every owner hint
was removed, so deterministic preprocessing resolved zero findings.

Both cohorts used the same 24-finding residual payload, inline prompt, declared
`gpt-5-mini` model name, `low` reasoning effort, strict route shape,
deterministic preprocess and merge, exact evaluator, and composite accounting.

- **Baseline:** Copilot CLI with zero visible tools.
- **Candidate:** one direct Responses API call with a strict 24-ID route
  schema.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or
  lost findings.

The direct deployment reported model version `2025-08-07`. Copilot exposed the
same selected model name but not an underlying version, so identical model
weights and serving stacks remain unproven.

## Decision

| Decision metric | Copilot host | Direct structured | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 2,697 | 859 | -68.150% | met |
| Output-token p50 | 643 | 637 | -0.933% | met |
| Wall-time p90 | 48,344.8 ms | 9,395.8 ms | -80.565% | met |

Exact quality, accounting, and every declared performance goal passed.

## Full results

| Metric | Copilot host samples | Direct structured samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 2,697, 2,697, 2,698 | 859, 859, 859 | p50 2,697 -> 859 | -68.150% |
| Non-cached input tokens | 2,697, 1,673, 1,674 | 859, 859, 859 | p50 1,674 -> 859 | -48.686% |
| Cache-read tokens | 0, 1,024, 1,024 | 0, 0, 0 | p50 1,024 -> 0 | -100% |
| Output tokens | 802, 603, 643 | 711, 615, 637 | p50 643 -> 637 | -0.933% |
| Reasoning tokens | 512, 320, 384 | 448, 320, 384 | p50 384 -> 384 | unchanged |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 20,065 ms, 11,744 ms, 7,365 ms | 10,107.752 ms, 6,239.957 ms, 5,851.807 ms | p50 11,744 -> 6,239.957 ms | -46.867% |
| End-to-end wall time | 49,292 ms, 44,556 ms, 27,374 ms | 10,177 ms, 6,271 ms, 5,881 ms | p50 44,556 -> 6,271 ms | -85.926% |

Baseline AI-unit p50 was 0.17301. The direct provider did not report
comparable AI units, premium requests, or cache-write tokens, so no
cross-provider cost claim is made.

## Scale comparison

The 8-finding replication and this 24-finding result show semantic growth on
both sides while retaining a large host-scaffold gap:

| Metric | 8 findings | 24 findings |
|---|---:|---:|
| Copilot input-token p50 | 2,374 | 2,697 |
| Direct input-token p50 | 480 | 859 |
| Input-token gap | 1,894 | 1,838 |
| Input reduction | 79.781% | 68.150% |
| Copilot output-token p50 | 300 | 643 |
| Direct output-token p50 | 297 | 637 |
| Copilot reasoning-token p50 | 192 | 384 |
| Direct reasoning-token p50 | 192 | 384 |

Across the additional 16 findings, Copilot input grew by 323 tokens and direct
input grew by 379 tokens. The input gap narrowed by only 56 tokens. Output and
reasoning grew almost symmetrically, which is consistent with semantic work
scaling similarly while the Copilot host retains a large fixed scaffold.

A two-point linear fit estimates about 20.19 Copilot input tokens and 23.69
direct input tokens per additional finding, with a token crossover near 549
findings. That extrapolation is a hypothesis generator, not evidence: it uses
only two workload sizes, different cohort counts, and one synthetic routing
shape. A 64-finding scale point is the next bounded test of the slope.

## Latency boundary

At p50, Copilot wall time exceeded model API time by 32,812 ms. The direct
composite exceeded API time by about 31 ms. The shared deterministic stages
were identical and small.

The API-time gap also widened materially at this scale: p50 fell 46.867% and
p90 fell 49.273% on the direct path. The end-to-end effect remained larger,
but the 24-finding result no longer supports treating inference time as a
minor part of the total difference.

## Evidence boundaries

- The selected model name matched, but Copilot did not expose a model version.
- Strict structured output remained part of the direct treatment.
- Direct billing fields remained incomplete.
- Three samples are descriptive evidence, not a confidence interval or
  significance claim.
- The 549-finding crossover is a provisional linear extrapolation, not a
  measured threshold.

## Evidence bindings

- Source commit: `bd5aca85f19165e8eb946cacd1f6e35372c6966e`
- Replay receipt: `sha256:f1cc65e96444e495`
- Comparison receipt: `sha256:d49f9c480c68efa0`
- Workload: `sha256:f7be5744311357930fd4452b97ebdf2c65d097048aff90ddd9807ecc313054c4`
- Source revision: `sha256:3c4458ce4a45de4a60174e72af78ab18d3b4ed24924a29ef8d37a873fc8f542a`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:22d1d00453a5907fd95ae50a6727aec5bd5c52ea71f2090fc5b5c43a4d8c2d8f`
- Candidate configuration: `sha256:46587df0b28ae7db0cfa7f2012dbd4352a85eae44b69d0bb40354ff7df7c856f`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

Payload growth has started to erode the percentage input advantage, but not
the absolute host-scaffold advantage. At 24 semantic findings, the direct path
still saved 1,838 median input tokens and reduced p90 wall time by 80.565%
with exact quality.

This strengthens the architectural case for direct structured boundaries on
bounded one-call semantic stages. It remains explicitly out of scope for
multi-turn or tool-using agent workloads.
