# Hosted hybrid semantic-residual replay

This scenario compares:

- **baseline:** Copilot routes all 24 findings;
- **candidate:** deterministic code resolves 16 high-confidence owner hints,
  Copilot routes only 8 ambiguous descriptions, and deterministic code merges
  the final batches.

The candidate is measured as one composite run containing deterministic
preprocess, residual model, and deterministic merge component profiles.

The first three-sample measured result is in
`measured-result-2026-10-01.md`.

Run a balanced three-sample cohort from the repository root:

```powershell
node .\examples\hosted-hybrid-replay\run-hosted-hybrid-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-hybrid-v1" `
  --samples 3
```

Only files under `receipts/` are intended to be shareable. Raw sessions,
component profiles, usage files, and intermediate manifests may contain local
paths.
