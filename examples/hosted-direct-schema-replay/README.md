# Hosted direct schema replay

This scenario isolates strict structured output inside the direct model
boundary. Both cohorts use the same private Responses endpoint and deployment,
declared `gpt-5-mini` model, `low` reasoning effort, inline prompt, residual
JSON, deterministic preprocess and merge, exact evaluator, and composite
accounting.

- **baseline:** strict JSON schema through `text.format`;
- **candidate:** prompt-only JSON instructions with no response format.

Use the same private provider file described by
`../hosted-direct-model-boundary-replay/provider-config.example.json`. Supply a
short-lived bearer token only through the environment:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = az account get-access-token `
  --resource https://cognitiveservices.azure.com/ `
  --query accessToken -o tsv

node .\examples\hosted-direct-schema-replay\run-hosted-direct-schema-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-schema-v1" `
  --samples 3

Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

The candidate is acceptable only if the existing prompt preserves exact route
quality while reducing at least one declared performance metric. Provider
billing fields remain incomplete on both sides.

The first three-sample measured result is in
`measured-result-2026-10-06.md`. It returned `revise`: prompt-only output saved
input but increased median output and reasoning tokens.

Only files under `receipts/` are intended to be shareable. Raw responses,
provider configuration, component profiles, usage files, prompts, and
intermediate manifests may contain local or provider-specific content.
