# Measured result: deterministic triage prefilter

- **Date:** September 25, 2026
- **Status:** Discovery receipt; descriptive `n=2` per cohort
- **Disposition:** `keep` for this frozen experiment

> Historical intermediate: this candidate still invoked a model to copy the
> deterministic result. The true model-free successor is
> `model-free-result-2026-10-01.md`.

## Experiment

Both cohorts used GitHub Copilot CLI `1.0.87-0`, `gpt-5-mini`, one read-only
`view` tool, context tier `default`, reasoning effort `medium`, the same
30-item synthetic corpus, and the same exact evaluator. Execution order was
balanced as `baseline-1`, `candidate-1`, `candidate-2`, `baseline-2`.

- **Baseline:** the model applied the fixed filtering rule.
- **Candidate:** deterministic code applied the rule; the model copied the
  prepared result.
- **Quality:** baseline 2/2 passed; candidate 2/2 passed; no regressions or lost
  findings.
- **Billing:** zero premium requests; 1.23502 AI units across all four sessions.

## Results

| Metric | Baseline samples | Candidate samples | Comparison | Change |
|---|---:|---:|---:|---:|
| AI units | 0.331185, 0.336545 | 0.30252, 0.26477 | p50 0.333865 → 0.283645 | -15.042% |
| Logical input tokens | 5,897, 5,889 | 4,808, 4,810 | p50 5,893 → 4,809 | -18.395% |
| Non-cached input tokens | 3,593, 2,561 | 1,480, 1,482 | p50 3,077 → 1,481 | -51.869% |
| Output tokens | 1,178, 1,321 | 1,286, 1,097 | p50 1,249.5 → 1,191.5 | -4.642% |
| Reasoning tokens | 896, 1,024 | 1,024, 832 | p50 960 → 928 | -3.333% |
| End-to-end wall time | 14,889 ms, 47,813 ms | 15,989 ms, 42,655 ms | p90 44,520.6 → 39,988.4 ms | -10.180% |
| API time | 10,252 ms, 43,185 ms | 11,338 ms, 37,624 ms | p90 39,891.7 → 34,995.4 ms | -12.274% |

## Evidence bindings

- Workload: `sha256:fea16f04e0f6b03ac229f55317d68b13a626f5f378aadc30e57bcbad5cfc8c26`
- Source revision: `sha256:6ebaeba36bb651ae232cca1af610af3539ddc1caad8e4da8ba6d1bbb3d291307`
- Evaluator identity: `sha256:615a7e870f75bdf8836f2bfeb8d238483de39c005715747f69740c9376a3eced`
- Evaluator implementation: `sha256:682d1d795ce5767007f7439ab607d90e84de113c38eebdd01f740cd0a7ef142a`
- Baseline configuration: `sha256:9f672bab410e98d5bde9d4ccab211e4aed9da668569be1ff4cffc09dc0d118d7`
- Candidate configuration: `sha256:b964c541e07854bae7255d4ee6a5154e51a18d7eccf33af03fd4e31faa4cac64`

Every quality result is also bound to the full SHA-256 of its exact run-profile
JSON.

## Interpretation

The deterministic prefilter reduced median AI units, logical input, non-cached
input, output, and reasoning tokens while preserving exact quality. Both
wall-time and API-time p90 also improved in this small cohort, but the
per-sample spread remains large and is retained in the table.

This is not a statistical-significance claim. Two samples per cohort are enough
to prove the replay and accounting path and to justify replication, not to
estimate a stable production effect.
