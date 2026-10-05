# Hosted reasoning-effort replay

This scenario keeps the hybrid semantic workload, residual transport, visible
tools, model, context tier, deterministic preprocess and merge, exact
evaluator, and composite accounting fixed. It changes only Copilot reasoning
effort:

- **baseline:** inline residual JSON, zero visible tools, `medium` reasoning;
- **candidate:** inline residual JSON, zero visible tools, `low` reasoning.

The eight ambiguous descriptions and taxonomy are identical in both cohorts.
The candidate is acceptable only if exact routing quality is preserved.

The initial v1 treatment used `minimal`, but `gpt-5-mini` rejected that effort
before its first model request on October 5, 2026. That incomplete run is not
comparison evidence. V2 uses the smallest effort accepted by the measured
model/runtime.

The corrected three-sample measured result is in
`measured-result-2026-10-05.md`.

Run a balanced three-sample cohort from the repository root:

```powershell
node .\examples\hosted-reasoning-effort-replay\run-hosted-reasoning-effort-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-reasoning-effort-v2" `
  --samples 3
```

Only files under `receipts/` are intended to be shareable. Raw sessions,
component profiles, usage files, inline prompts, and intermediate manifests may
contain local or task content.
