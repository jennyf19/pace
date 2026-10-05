# Hosted residual overhead replay

This scenario keeps the hybrid semantic workload fixed and changes only how
the eight residual cases reach Copilot:

- **baseline:** write `residual-input.json`, expose only the `view` tool, and
  ask Copilot to read the file;
- **candidate:** append the identical residual JSON directly to the prompt and
  expose an explicit empty tool set.

Both cohorts use the same deterministic preprocess and merge code, model,
reasoning effort, context tier, semantic input, exact evaluator, and composite
run accounting.

Run a balanced three-sample cohort from the repository root:

```powershell
node .\examples\hosted-residual-overhead-replay\run-hosted-residual-overhead-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-residual-overhead-v1" `
  --samples 3
```

Only files under `receipts/` are intended to be shareable. Raw sessions,
component profiles, usage files, inline prompts, and intermediate manifests may
contain local or task content.
