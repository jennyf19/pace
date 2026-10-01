# Measured result: model-free deterministic triage

- **Date:** October 1, 2026
- **Status:** Discovery receipt; descriptive `n=2` per cohort
- **Disposition:** `keep` for this frozen experiment

## Experiment

Both cohorts used the same 30-item synthetic corpus, exact result schema, exact
evaluator, and balanced execution order: `baseline-1`, `candidate-1`,
`candidate-2`, `baseline-2`.

- **Baseline:** GitHub Copilot CLI `1.0.88`, `gpt-5-mini`, one read-only `view`
  tool, context tier `default`, and reasoning effort `medium`.
- **Candidate:** Node.js `v22.14.0` executed one synchronous deterministic JSON
  transform. It started no Copilot session and reported zero model calls,
  tokens, AI units, API time, and premium requests under the explicit
  deterministic execution contract.
- **Quality:** baseline 2/2 passed; candidate 2/2 passed; no regressions or lost
  findings.
- **Billing:** baseline used 0.629135 AI units in total; candidate used zero.
  All four samples reported zero premium requests.

The baseline runtime probe reported CLI `1.0.88`; both session-start events
reported telemetry version `1.0.87-0`. Pace retained both values and emitted a
warning instead of collapsing the mismatch.

## Results

| Metric | Baseline samples | Candidate samples | Comparison | Change |
|---|---:|---:|---:|---:|
| AI units | 0.322015, 0.30712 | 0, 0 | p50 0.3145675 -> 0 | -100% |
| Logical input tokens | 5,823, 5,824 | 0, 0 | p50 5,823.5 -> 0 | -100% |
| Non-cached input tokens | 3,647, 2,496 | 0, 0 | p50 3,071.5 -> 0 | -100% |
| Output tokens | 1,127, 1,182 | 0, 0 | p50 1,154.5 -> 0 | -100% |
| Reasoning tokens | 896, 896 | 0, 0 | p50 896 -> 0 | -100% |
| API time | 66,407 ms, 13,447 ms | 0 ms, 0 ms | p90 61,111 -> 0 ms | -100% |
| End-to-end wall time | 78,833 ms, 24,562 ms | 65.598 ms, 12.403 ms | p90 73,405.9 -> 60.279 ms | -99.918% |
| Premium requests | 0, 0 | 0, 0 | p50 0 -> 0 | unchanged |

## Evidence bindings

- Source tag: `v0.1.0`
- Source commit: `e56a93d47390519cdb000e01ccad1357176fa24a`
- Replay receipt: `sha256:5477c8f6241d1a6c`
- Comparison receipt: `sha256:fdf851461e69e6bf`
- Workload: `sha256:b6e64a41827dc38c5b36c7cde517b95549c72461bd5f70dad4744c326cb231f8`
- Source revision: `sha256:7d0aad9d986c96c3ac564956fbc4a7de33719adb5e183301174ac38bf98ec0be`
- Evaluator: `sha256:682d1d795ce5767007f7439ab607d90e84de113c38eebdd01f740cd0a7ef142a`
- Baseline configuration: `sha256:4101b0f4ef53fc87a2e14390dda32a24cbd0fcc3f24e2c1d776cff2a22c5b884`
- Candidate configuration: `sha256:f46e4851f672800b4a466971be567cd276540a129c039258875e338b56378557`
- Orchestrator: `sha256:b08576b9eeff80d94d281e467e741788d9f075ed0d6b71856ed8e0d181cc8ee7`
- Deterministic runner: `sha256:c86f5879d44fa964021a74c0fdc155eaecd44bfc2a365f91971cf48c3ccca189`
- Transform implementation: `sha256:7ef9c2ad21f277787e58532472336df61d0c32c79c7e27e9d786f9e49cbfd82e`

Every quality result is also bound to the full SHA-256 of its exact run-profile
JSON.

## Interpretation

The fixed selection rule no longer needs a model after deterministic code can
produce the final contract directly. The 100% token and AI-unit reduction is a
structural result for this frozen candidate, not an estimate inferred from
missing telemetry.

The wall-time distribution remains descriptive. Two baseline samples have
large variance, and two local samples are not enough to estimate stable tail
latency across machines. The next experiment is a larger balanced cohort plus
a second workload shape before generalizing beyond this exact deterministic
filter.

The zero-usage receipt is auditable but bounded: it hash-binds the Pace runner
and declared synchronous implementation. It is not an OS sandbox, network
monitor, or supply-chain attestation.

## Line-ending boundary

This v2 receipt predates the repository's `.gitattributes` policy. Its source
hashes reflect the original Windows checkout bytes at tag `v0.1.0`. Beginning
with commit `47a1ecdacaa3628b1338feaacbecc89b194b0e41`, Pace enforces LF for
portable byte-level replay hashes.
