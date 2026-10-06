# Revised result: direct boundary at 64 semantic findings

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `revise`

## Revision

The v1 cohort was rejected after one direct sample routed an ambiguous
legal-hold finding to identity instead of storage. The v2 corpus changed
exactly one description:

> A legal hold can be removed without a second approver.

became:

> An object-storage legal hold can be removed without a second approver.

The corpus, source revision, configuration, replay, and comparison identities
were all versioned independently. The v1 reject remains preserved in
`measured-result-2026-10-06.md`.

## Experiment

Both v2 cohorts used the same 64-finding residual payload, inline prompt,
declared `gpt-5-mini` model name, `low` reasoning effort, route shape,
deterministic preprocess and merge, exact evaluator, and composite accounting.

- **Baseline:** Copilot CLI with zero visible tools.
- **Candidate:** one direct Responses API call with a strict 64-ID route
  schema.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or
  lost findings.

The direct deployment reported model version `2025-08-07`. Copilot exposed the
same selected model name but not an underlying version, so identical model
weights and serving stacks remain unproven.

## Decision

| Decision metric | Copilot host | Direct structured | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 3,581 | 1,866 | -47.892% | met |
| Output-token p50 | 1,579 | 1,693 | +7.220% | missed |
| Wall-time p90 | 50,995.2 ms | 13,217.2 ms | -74.081% | met |

Quality and accounting passed. Pace returned `revise` because the candidate
missed the declared output-token goal.

## Full results

| Metric | Copilot host samples | Direct structured samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 3,581, 3,583, 3,581 | 1,866, 1,866, 1,866 | p50 3,581 -> 1,866 | -47.892% |
| Non-cached input tokens | 3,581, 2,559, 2,557 | 1,866, 74, 74 | p50 2,559 -> 74 | -97.108% |
| Cache-read tokens | 0, 1,024, 1,024 | 0, 1,792, 1,792 | p50 1,024 -> 1,792 | +75% |
| Output tokens | 1,591, 1,579, 1,563 | 1,863, 1,693, 1,541 | p50 1,579 -> 1,693 | +7.220% |
| Reasoning tokens | 960, 960, 896 | 1,216, 1,024, 896 | p50 960 -> 1,024 | +6.667% |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 19,805 ms, 42,134 ms, 26,927 ms | 13,211.087 ms, 12,217.638 ms, 12,973.674 ms | p50 26,927 -> 12,973.674 ms | -51.819% |
| End-to-end wall time | 31,308 ms, 53,883 ms, 39,444 ms | 13,256 ms, 12,242 ms, 13,062 ms | p50 39,444 -> 13,062 ms | -66.885% |

Baseline AI-unit p50 was 0.382335. The direct provider did not report
comparable AI units, premium requests, or cache-write tokens, so no
cross-provider cost claim is made.

Logical input is the selected input metric. Two direct samples received 1,792
cache-read tokens, which drove non-cached input p50 down to 74; that cache
behavior is descriptive and not treated as a cross-host cost comparison.

## Three scale points

| Findings | Copilot input p50 | Direct input p50 | Input gap | Input change | Copilot output p50 | Direct output p50 | Output change |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 2,374 | 480 | 1,894 | -79.781% | 300 | 297 | -1% |
| 24 | 2,697 | 859 | 1,838 | -68.150% | 643 | 637 | -0.933% |
| 64 | 3,581 | 1,866 | 1,715 | -47.892% | 1,579 | 1,693 | +7.220% |

The input gap narrowed by 123 tokens from 24 to 64 findings, or about 3.08
tokens per added finding. A three-point linear fit estimates 21.66 Copilot
input tokens and 24.83 direct input tokens per finding, with a provisional
input crossover near 604 findings.

That extrapolation is only a hypothesis. The measured boundary arrived much
earlier in generated work: at 64 findings, direct output and reasoning became
larger even though the direct request retained a 1,715-token input advantage.

Subtracting each sample's reasoning tokens from output gives a visible-answer
p50 of 631 tokens for Copilot and 647 for direct, a 2.54% increase. Reasoning
p50 contributed another 64-token increase. This suggests that both response
representation and generated reasoning are now relevant optimization targets.

## Latency boundary

At p50, Copilot wall time exceeded model API time by 12,517 ms. The direct
composite exceeded API time by about 88 ms. API-time p50 fell 51.819% and
wall-time p90 fell 74.081% on the direct path.

The direct boundary therefore remains materially faster at 64 findings, but
Pace does not trade an explicit output regression for latency and input gains.

## Next treatment

The next bounded experiment keeps the direct provider, model, effort,
64-finding payload, evaluator, and strict structure fixed. It replaces the
repeated owner strings in the response with one-character owner codes and
decodes them deterministically before merge.

That treatment targets the first measured crossover directly. It must preserve
exact quality and reduce output without increasing input or latency.

## Evidence boundaries

- The selected model name matched, but Copilot did not expose a model version.
- Strict structured output remained part of the direct treatment.
- Direct billing fields remained incomplete.
- Three samples are descriptive evidence, not a confidence interval or
  significance claim.
- The 604-finding input crossover is a linear extrapolation, not a measured
  threshold.

## Evidence bindings

- Source commit: `0911679c5a7067f344fd8d89331082f1d1b89980`
- Replay receipt: `sha256:87e7151838f99419`
- Comparison receipt: `sha256:9e084c7d139a5aaa`
- Workload: `sha256:1ece4290bb4e0f349f8c18e6c3e0fd7ec188092f7adb29134c25a275b0059f5c`
- Source revision: `sha256:1c72a163198a47c80e51776c0ed47d9013a5d68188d04ed6d54013899999c6a2`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:45f7f365e8f50c95a0df557eedbfe81588d4884ec79ce750fc891585bb6b417d`
- Candidate configuration: `sha256:44f4ca6b752dbd5b234c2be3ba2104ce247c5c9126f9aeced591257c5c31018e`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

The direct structured boundary still wins decisively on logical input and
latency at 64 findings, with exact quality after the ambiguity fix. It no
longer wins on total generated output.

This is the first measured payload-scale boundary in the direct-host evidence
ladder. The right response is not to discard the boundary or redefine success;
it is to optimize the repeated response representation and measure again.
