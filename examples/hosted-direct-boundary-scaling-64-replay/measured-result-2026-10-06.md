# Measured result: first 64-finding scale attempt

- **Date:** October 6, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `reject`

## Experiment

This extended the 24-finding semantic-routing workload to 64 distinct
findings. Every owner hint was absent, so all 64 findings crossed the semantic
boundary.

Both cohorts used the same payload, inline prompt, declared `gpt-5-mini` model
name, `low` reasoning effort, route shape, deterministic preprocess and merge,
exact evaluator, and composite accounting.

- **Baseline:** Copilot CLI with zero visible tools.
- **Candidate:** one direct Responses API call with a strict 64-ID route
  schema.
- **Quality:** baseline 3/3 passed; candidate 2/3 passed.

The direct deployment reported model version `2025-08-07`. Copilot exposed the
same selected model name but not an underlying version, so identical model
weights and serving stacks remain unproven.

## Quality rejection

The failed candidate response was structurally complete: all 64 IDs were
present, the strict schema passed, and there were no lost findings. It
misrouted one case:

| Finding | Description | Expected | Actual |
|---|---|---|---|
| `H034` | A legal hold can be removed without a second approver. | storage | identity |

The wording contains a storage concept, “legal hold,” and an identity/policy
concept, “approver,” without an explicit object-storage anchor. The other two
candidate samples and all three baseline samples routed it to storage.

This is evidence of an ambiguous synthetic item and stochastic quality, not
evidence of truncation. Pace correctly rejected the treatment instead of
averaging the failure away.

## Descriptive performance

Performance was not eligible for a `keep` decision because quality failed.
The measurements remain useful counterevidence:

| Metric | Copilot host | Direct structured | Change | Goal |
|---|---:|---:|---:|---|
| Input-token p50 | 3,579 | 1,860 | -48.030% | met |
| Output-token p50 | 1,674 | 1,751 | +4.600% | missed |
| Wall-time p90 | 60,689.4 ms | 16,039 ms | -73.572% | met |

Full distributions:

| Metric | Copilot host samples | Direct structured samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Logical input tokens | 3,579, 3,575, 3,581 | 1,860, 1,860, 1,860 | p50 3,579 -> 1,860 | -48.030% |
| Non-cached input tokens | 3,579, 3,575, 2,557 | 1,860, 68, 1,860 | p50 3,575 -> 1,860 | -47.972% |
| Cache-read tokens | 0, 0, 1,024 | 0, 1,792, 0 | p50 0 -> 0 | unchanged |
| Output tokens | 1,687, 1,609, 1,674 | 1,751, 1,989, 1,638 | p50 1,674 -> 1,751 | +4.600% |
| Reasoning tokens | 1,024, 960, 1,024 | 1,088, 1,344, 960 | p50 1,024 -> 1,088 | +6.250% |
| Tool-definition tokens | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |
| API time | 24,728 ms, 50,190 ms, 26,620 ms | 15,984.072 ms, 14,759.922 ms, 15,970.545 ms | p50 26,620 -> 15,970.545 ms | -40.005% |
| End-to-end wall time | 40,431 ms, 65,754 ms, 39,698 ms | 16,042 ms, 14,794 ms, 16,027 ms | p50 40,431 -> 16,027 ms | -60.360% |

Baseline AI-unit p50 was 0.411175. The direct provider did not report
comparable AI units, premium requests, or cache-write tokens, so no
cross-provider cost claim is made.

## Scale signal

The absolute input gap remained 1,719 tokens at 64 findings. From 24 to 64
findings, it narrowed by 119 tokens, or about 2.98 tokens per added finding.
That remains close to the 3.5-token per-finding narrowing observed from 8 to
24 findings.

The first clear crossover occurred in generated work, not input: direct output
p50 rose 4.6% above the Copilot host and direct reasoning p50 rose 6.25%.
Because quality also failed, this point establishes a boundary to investigate,
not an optimization to keep.

## Revision

The next experiment changes exactly one semantic input:

> A legal hold can be removed without a second approver.

becomes:

> An object-storage legal hold can be removed without a second approver.

The revised corpus, source revision, configuration identities, replay ID, and
comparison ID are all versioned independently. The rejected v1 evidence
remains bound to its original source commit.

## Evidence boundaries

- The selected model name matched, but Copilot did not expose a model version.
- Strict structured output remained part of the direct treatment.
- Direct billing fields remained incomplete.
- Three samples are descriptive evidence, not a confidence interval or
  significance claim.
- The performance distributions cannot override the failed quality gate.

## Evidence bindings

- Source commit: `df13551a9b8884de1de6de892790f30862b96a6b`
- Replay receipt: `sha256:794a91488b17fd2f`
- Comparison receipt: `sha256:5a0f1a04afd1c3f1`
- Workload: `sha256:f511bfe30019d54f1bf2fae1fd94969146d3bb49c28d0d52c8db2ef117231bb4`
- Source revision: `sha256:0c9aafe6626a71bf034baa91a43fbdeb0bed50ef26934ba5edaaa766c6317a55`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:b9c6e59078c2a1ab73f27c557f65477b89f909722d83aaf6470b5a18d478b34b`
- Candidate configuration: `sha256:0047b45b4da0909724ea84dba09efe9200b3fb87e58f205c88b57e96c0811db2`
- Private provider configuration: `sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, provider endpoint, deployment name, bearer token, or private
repository domains.
