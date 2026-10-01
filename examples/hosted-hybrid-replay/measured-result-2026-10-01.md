# Measured result: hybrid deterministic mechanics with semantic residual

- **Date:** October 1, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `keep` for this frozen experiment

## Experiment

Both cohorts used the same 24-finding synthetic corpus, owner taxonomy, exact
output contract, exact evaluator, and balanced alternating execution order.

- **Baseline:** GitHub Copilot CLI `1.0.88`, `gpt-5-mini`, one read-only `view`
  tool, context tier `default`, and reasoning effort `medium` routed all 24
  findings.
- **Candidate:** deterministic preprocessing accepted 16 owner hints at or
  above the frozen confidence threshold; Copilot routed only 8 ambiguous
  descriptions; deterministic merge produced the final owner batches.
- **Accounting:** every candidate was one composite Pace run containing
  deterministic preprocess, residual model, and deterministic merge profiles.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or lost
  findings.
- **Billing:** baseline used 1.95664 AI units in total; candidate used
  0.687395, a 64.87% reduction. All six model sessions reported zero premium
  requests.

The runtime probe reported CLI `1.0.88`; session profiles retained the separate
`1.0.87-0` telemetry version and mismatch warning.

## Performance results

| Metric | Baseline samples | Candidate samples | Comparison | Change |
|---|---:|---:|---:|---:|
| AI units | 0.680885, 0.70139, 0.574365 | 0.25553, 0.22852, 0.203345 | p50 0.680885 -> 0.22852 | -66.438% |
| Logical input tokens | 5,957, 5,966, 5,981 | 5,138, 5,128, 5,129 | p50 5,966 -> 5,129 | -14.030% |
| Non-cached input tokens | 3,653, 2,510, 2,525 | 3,986, 1,800, 1,801 | p50 2,525 -> 1,801 | -28.673% |
| Output tokens | 2,919, 3,150, 2,513 | 765, 876, 750 | p50 2,919 -> 765 | -73.792% |
| Reasoning tokens | 2,496, 2,752, 2,112 | 576, 640, 512 | p50 2,496 -> 576 | -76.923% |
| API time | 23,082 ms, 28,080 ms, 14,334 ms | 18,022 ms, 9,723 ms, 9,184 ms | p90 27,080.4 -> 16,362.2 ms | -39.579% |
| End-to-end wall time | 30,091 ms, 35,970 ms, 29,004 ms | 30,297 ms, 21,235 ms, 21,122 ms | p90 34,794.2 -> 28,484.6 ms | -18.134% |
| Premium requests | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |

## Counterevidence retained

Candidate non-cached-input p90 was 3,549 tokens versus 3,427.4 for baseline,
3.55% worse. One candidate sample used 3,986 non-cached input tokens while the
other two used about 1,800. The final disposition remains `keep` because the
declared logical-input p50, AI-unit p50, and wall-time p90 goals passed with
exact quality, but the cold-cache variance remains part of the receipt.

## Evidence bindings

- Source commit: `103dd3303ef47bdc8faef1acb84ca9eeb916b0e8`
- Replay receipt: `sha256:a7ce59240a3666fa`
- Comparison receipt: `sha256:d89c81ce3c530a8c`
- Workload: `sha256:39a743989b4dd4e7a5261cad1062fdf8ce70049bde645bf615864833fa4a30e2`
- Source revision: `sha256:73468562856f41208fdf91041085211f3b01b0d2b538e2a126d7b17ea31afb85`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:458f1a3976117f4e088e0111db7d02f3637059485b043b33aed487e23b4cbfa9`
- Candidate configuration: `sha256:ed2e7bea14097a292647c547c5f3313789ac3de0b7823606f8cb9b12471db464`
- Hybrid orchestrator: `sha256:163dfdb5bf7bb8d4b7126842f331e48ab780b2478419acd2384020279eb1331b`
- Profiled Copilot helper: `sha256:99e8b1f062f8a14565719d60d4ddfd1202261264f6a08e1464dde46bf6196ea8`
- Composite run profiler: `sha256:453c8f37c1a612a5644fab8d2435ea64efa060ae75d9108e0ae23d8a056b30ea`
- Deterministic runner: `sha256:ec49fbc3586d5684c538e29a19379c34c1efbd2ce1d09ec846f679a8427a97ca`
- Hybrid implementation: `sha256:cb25e61545597e7c616bc89505573395158a911d64c1708d5c7424c29feeda2d`

Every candidate quality result is bound to the exact composite run-profile
SHA-256. Each composite profile also binds all three component profile hashes
and their unique contributing session evidence.

The final replay and comparison receipts contain no local paths, user identity,
prompt text, or private repository domains.

## Interpretation

This is the first Pace receipt that preserves a genuine semantic model role
instead of eliminating the model entirely. Moving fixed partitioning and merge
mechanics to code reduced median AI units by 66.4%, output tokens by 73.8%, and
reasoning tokens by 76.9% while exact quality remained unchanged.

Logical input tokens fell only 14.0% because the residual session still carries
the agent/runtime scaffold and taxonomy. That gap identifies the next
optimization target: reduce fixed residual-session overhead without weakening
the semantic evidence available for the eight ambiguous cases.

Three samples remain descriptive evidence, not a confidence-interval or
significance claim.
