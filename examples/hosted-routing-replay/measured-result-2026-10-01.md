# Measured result: deterministic deduplication and owner routing

- **Date:** October 1, 2026
- **Status:** Discovery receipt; descriptive `n=5` per cohort
- **Disposition:** `keep` for this frozen experiment

## Experiment

Both cohorts used the same 47-finding synthetic corpus, exact output contract,
exact evaluator, and balanced alternating execution order.

- **Baseline:** GitHub Copilot CLI `1.0.88`, `gpt-5-mini`, one read-only `view`
  tool, context tier `default`, and reasoning effort `medium`.
- **Candidate:** Node.js `v22.14.0` executed one synchronous deterministic
  transform. It filtered eligible findings, selected one winner per
  fingerprint, grouped winners by owner, aggregated severity counts, and
  sorted findings and batches without starting a model session.
- **Quality:** baseline 5/5 passed; candidate 5/5 passed; no regressions or lost
  findings.
- **Billing:** baseline used 4.73923 AI units in total; candidate used zero.
  All ten samples reported zero premium requests.

The baseline runtime probe reported CLI `1.0.88`; all session profiles retained
the separate `1.0.87-0` telemetry version and the mismatch warning.

## Workload result

The frozen transform reduced 47 input findings to 39 eligible findings, chose
16 fingerprint winners, removed 23 eligible duplicates, and produced four
owner batches with exact severity aggregates.

## Performance results

| Metric | Baseline samples | Candidate samples | Comparison | Change |
|---|---:|---:|---:|---:|
| AI units | 0.987125, 0.94784, 1.040765, 0.888135, 0.875365 | 0, 0, 0, 0, 0 | p50 0.94784 -> 0 | -100% |
| Logical input tokens | 6,909, 6,920, 6,925, 6,903, 6,893 | 0, 0, 0, 0, 0 | p50 6,909 -> 0 | -100% |
| Non-cached input tokens | 6,909, 3,464, 3,469, 4,599, 3,437 | 0, 0, 0, 0, 0 | p50 3,469 -> 0 | -100% |
| Output tokens | 4,072, 4,263, 4,727, 3,837, 3,904 | 0, 0, 0, 0, 0 | p50 4,072 -> 0 | -100% |
| Reasoning tokens | 3,648, 3,840, 4,288, 3,392, 3,520 | 0, 0, 0, 0, 0 | p50 3,648 -> 0 | -100% |
| API time | 41,971 ms, 34,252 ms, 45,400 ms, 27,986 ms, 27,752 ms | 0 ms x5 | p90 44,028.4 -> 0 ms | -100% |
| End-to-end wall time | 56,476 ms, 46,054 ms, 52,456 ms, 37,278 ms, 35,284 ms | 10.638 ms, 9.666 ms, 13.839 ms, 12.001 ms, 10.680 ms | p90 54,868 -> 13.103 ms | -99.976% |
| Premium requests | 0, 0, 0, 0, 0 | 0, 0, 0, 0, 0 | p50 0 -> 0 | unchanged |

## Evidence bindings

- Source commit: `47a1ecdacaa3628b1338feaacbecc89b194b0e41`
- Replay receipt: `sha256:a7dd421d5c53cda1`
- Comparison receipt: `sha256:8d778a3028471e0b`
- Workload: `sha256:d982e5daac1446e69ed5ee27dbfeed67dcd29e8738abbe0c84e3de8ecd359973`
- Source revision: `sha256:6909c651c97c99fb0903eccc435cadee5304a7fa9cbfdb5fb365cb40368bf942`
- Evaluator: `sha256:2640b89248c260b7b51b4acacadd7306f331c0b9a1594d7976d5735919f9f786`
- Baseline configuration: `sha256:a7ec59993c58e89b40355556bb0211b19c817d6cd0829334818dcd069f44259f`
- Candidate configuration: `sha256:27bbd3fb5f50812a36d355b5f4c79840824b0a9c04279cc0a071c75c33f47ada`
- Shared hosted runner: `sha256:704a04b83fe22561ac2d71b06ae456b73abf9cf1ef5e4374471a1bf80c88d05b`
- Scenario entrypoint: `sha256:d2d0d4e9d3cb8f93efa448037361138064446e3ea6949983de067a09a3424feb`
- Deterministic runner: `sha256:ec49fbc3586d5684c538e29a19379c34c1efbd2ce1d09ec846f679a8427a97ca`
- Transform implementation: `sha256:3e2aa152d0d317830d1e8734bc27938ba66688a3b3e6a20986fd21cc6bf891ad`

Every quality result is also bound to the full SHA-256 of its exact run-profile
JSON. The final replay and comparison receipts contain no local paths, user
identity, prompt text, or private repository domains.

## Interpretation

The second workload shape confirms that explicit zero-model accounting is not
limited to one simple filter. A deterministic candidate can also replace model
work for deduplication, tie-breaking, grouping, aggregation, and stable
ordering when the rules and output contract are fully specified.

The result does not imply that semantic triage or ambiguous ownership decisions
should be converted to code. It establishes a stronger routing rule: first
separate fixed mechanics from semantic judgment, then measure only the model
work that remains.

Five samples provide a more useful descriptive latency distribution than the
earlier two-sample receipt, but this is still not a confidence-interval or
significance claim.
