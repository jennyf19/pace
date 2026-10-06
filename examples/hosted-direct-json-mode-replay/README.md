# Hosted direct JSON-mode replay

This scenario tests a middle response contract inside the same direct model
boundary. Both cohorts use the same private endpoint and deployment, declared
`gpt-5-mini` model, `low` reasoning effort, inline prompt, residual JSON,
deterministic preprocess and merge, exact evaluator, and composite accounting.

- **baseline:** strict JSON schema with all route IDs and owners;
- **candidate:** lightweight JSON-object mode with no repeated shape schema.

Use the same private provider file described by
`../hosted-direct-model-boundary-replay/provider-config.example.json`. Supply a
short-lived bearer token only through the environment:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = az account get-access-token `
  --resource https://cognitiveservices.azure.com/ `
  --query accessToken -o tsv

node .\examples\hosted-direct-json-mode-replay\run-hosted-direct-json-mode-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-json-mode-v1" `
  --samples 3

Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

The candidate is acceptable only if JSON-object mode preserves exact route
quality while reducing at least one declared metric without increasing median
output. Provider billing fields remain incomplete on both sides.

The first three-sample measured result is in
`measured-result-2026-10-06.md`. It returned `revise`: JSON-object mode saved
input but increased median output and tail latency.

Only files under `receipts/` are intended to be shareable. Raw responses,
provider configuration, component profiles, usage files, prompts, and
intermediate manifests may contain local or provider-specific content.
