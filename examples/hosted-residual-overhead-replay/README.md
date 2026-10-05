# Hosted residual overhead replay

This scenario keeps the hybrid semantic workload fixed and changes only how
the eight residual cases reach Copilot:

- **baseline:** write `residual-input.json`, expose only the `view` tool, and
  ask Copilot to read the file;
- **candidate:** append the identical residual JSON directly to the prompt and
  expose an explicit empty tool set using a frozen nonexistent allowlist
  sentinel.

Both cohorts use the same deterministic preprocess and merge code, model,
reasoning effort, context tier, semantic input, exact evaluator, and composite
run accounting.

The CLI's zero-value `--available-tools` form falls back to the default tool
set. This scenario therefore binds the sentinel value in candidate
configuration and verifies the result through measured
`tool_definition_tokens`.

Run a balanced three-sample cohort from the repository root:

```powershell
node .\examples\hosted-residual-overhead-replay\run-hosted-residual-overhead-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-residual-overhead-v1" `
  --samples 3
```

Only files under `receipts/` are intended to be shareable. Raw sessions,
component profiles, usage files, inline prompts, and intermediate manifests may
contain local or task content.
