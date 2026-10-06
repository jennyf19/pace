# Replication result: Copilot host versus direct structured boundary

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=5` per cohort
- **Disposition:** `keep`

## Experiment

This repeats the v0.7 treatment with fresh configuration and replay identities
and a balanced five-sample cohort.

Both cohorts used the same eight semantic residual findings, taxonomy, inline
prompt, declared `gpt-5-mini` model name, `low` reasoning effort,
deterministic preprocess and merge, exact evaluator, and composite accounting.

- **Baseline:** Copilot CLI with zero visible tools.
- **Candidate:** one direct Responses API call with the strict route schema.
- **Quality:** baseline 5/5 passed; candidate 5/5 passed; no regressions or lost
  findings.

The direct deployment reported model version `2025-08-07`. Copilot exposed the
same selected model name but not an underlying version, so identical model
weights and serving stacks remain unproven.

## Replicated decision

| Decision metric | Copilot host | Direct structured | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 2,374 | 480 | -79.781% | met |
| Output-token p50 | 300 | 297 | -1% | met |
| Wall-time p90 | 24,677.6 ms | 4,909.8 ms | -80.104% | met |

Exact quality, accounting, and every declared performance goal passed.

## Full results

| Metric | Copilot host samples | Direct structured samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 2,375, 2,368, 2,368, 2,374, 2,375 | 480, 480, 480, 480, 480 | p50 2,374 -> 480 | -79.781% |
| Non-cached input tokens | 2,375, 2,368, 1,344, 1,350, 1,351 | 480, 480, 480, 480, 480 | p50 1,351 -> 480 | -64.471% |
| Cache-read tokens | 0, 0, 1,024, 1,024, 1,024 | 0, 0, 0, 0, 0 | p50 1,024 -> 0 | -100% |
| Output tokens | 295, 278, 347, 300, 336 | 299, 297, 301, 278, 297 | p50 300 -> 297 | -1% |
| Reasoning tokens | 192, 128, 192, 192, 192 | 192, 192, 192, 128, 192 | p50 192 -> 192 | unchanged |
| Tool-definition tokens | 0, 0, 0, 0, 0 | 0, 0, 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 3,299 ms, 5,137 ms, 14,022 ms, 4,208 ms, 9,708 ms | 4,933.372 ms, 4,240.617 ms, 4,823.868 ms, 3,667.61 ms, 4,457.072 ms | p90 12,296.4 -> 4,889.57 ms | -60.236% |
| End-to-end wall time | 24,830 ms, 14,562 ms, 24,449 ms, 15,159 ms, 18,624 ms | 4,955 ms, 4,256 ms, 4,842 ms, 3,684 ms, 4,475 ms | p90 24,677.6 -> 4,909.8 ms | -80.104% |

Baseline AI units totaled 0.53858 across five samples. The direct provider did
not report comparable AI units, premium requests, or cache-write tokens, so no
cross-provider cost claim is made.

## Replication comparison

The v0.7 three-sample result and this five-sample result agree closely on the
main effects:

| Metric | `n=3` change | `n=5` change |
|---|---:|---:|
| Input-token p50 | -79.764% | -79.781% |
| Output-token p50 | -4.984% | -1% |
| API-time p50 | -11.924% | -13.236% |
| Wall-time p50 | -75.492% | -75.972% |
| Wall-time p90 | -93.823% | -80.104% |

The 94,997 ms Copilot outlier from v0.7 did not repeat. The replicated Copilot
maximum was 24,830 ms, but direct wall-time p90 was still about one fifth of
the Copilot value.

At p50, Copilot end-to-end wall time exceeded its model API time by 13,487 ms.
The direct composite exceeded its API time by about 18 ms. These gaps include
the shared deterministic stages, but those stages were identical and small;
the remaining difference is consistent with substantial host/session
lifecycle overhead.

## Evidence boundaries

- The selected model name matched, but Copilot did not expose a model version.
- Strict structured output remained part of the direct treatment.
- Direct billing fields remained incomplete.
- Five samples improve descriptive stability but do not establish statistical
  significance.

## Evidence bindings

- Source commit: `e93f829bdc51dc710c6d5b5505b93a6dca05107d`
- Replay receipt: `sha256:15017a2586286ac1`
- Comparison receipt: `sha256:1f6cdc4cb65025e9`
- Workload: `sha256:5e735f499a2c3de729efb9d4923e87122a557de64f66608a2e121f1a94f447ae`
- Source revision: `sha256:d65cf9d50fc9f2da015bebeafbcea4a226aff09e3802f925ae3d073a7bb14184`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:303becc7b0b3c5ef8226fe34900c2c7737671cbc9456517c2618f2bda64fafdd`
- Candidate configuration: `sha256:c1361041a30828971804203f768fc5f5bd37cb4b8bde038244900ddab6f61b15`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.

## Interpretation

The direct structured boundary's input and median wall-time effects replicated
almost exactly. The extreme v0.7 tail did not, but the direct boundary remained
materially faster at both median and p90 with unchanged reasoning and exact
quality.

This is stronger evidence that fixed host scaffold and lifecycle dominate this
bounded one-call residual. It is still not evidence for replacing multi-turn or
tool-using agents.
