# Hosted repeated replay

This publication-safe experiment measures one deterministic-first change:

- **baseline:** the model reads 30 synthetic findings and applies a fixed
  filtering rule;
- **candidate:** deterministic code applies the same rule and returns the final
  result without starting a model session.

The baseline uses an explicit Copilot model. The candidate uses the
hash-bound deterministic JSON runner. Both paths use the same exact-output
evaluator. The runner profiles each execution, freezes a replay receipt, and
compares AI-unit p50, input-token p50, and wall-time p90. Baseline quality is
scored from the final `assistant.message`; candidate quality is scored from the
exact deterministic result file.

The intermediate model-copy result is in `measured-result-2026-09-25.md`. The
true model-free result is in `model-free-result-2026-10-01.md`.

Run from the Agent Performance Engineering desk and keep raw artifacts outside
the repository:

```powershell
node .\pace\examples\hosted-replay\run-hosted-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-triage-model-free-v2"
```

The command uses two samples per cohort by default. Only baseline samples have
the Copilot CLI's minimum 30-credit ceiling; deterministic candidate samples
have no model-credit path. Inspect actual receipts rather than treating the
ceiling as spend. Runs are balanced in ABBA order (`baseline-1`,
`candidate-1`, `candidate-2`, `baseline-2`) to reduce simple warmup/order bias.
Context tier `default` and reasoning effort `medium` are passed explicitly to
the baseline.

The deterministic receipt binds the Pace runner, transform implementation,
input, and output. It verifies implementation hashes before and after the
synchronous transform. This is an auditable execution contract, not an OS
sandbox.

Only files under `receipts/` are intended to be shareable. The raw directory,
usage files, and intermediate run manifests may contain local paths.
