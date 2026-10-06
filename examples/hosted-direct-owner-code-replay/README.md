# Hosted direct owner-code replay

This scenario targets the first measured 64-finding output regression. Both
cohorts use the same direct provider, deployment, declared `gpt-5-mini` model,
`low` reasoning effort, 64 findings, taxonomy meanings, strict structure,
deterministic stages, exact evaluator, and composite accounting.

- **baseline:** routes use full owner names: `identity`, `storage`, `compute`,
  and `messaging`;
- **candidate:** routes use one-character codes: `i`, `s`, `c`, and `m`, then
  deterministic code decodes them before the final merge.

The candidate residual input preserves every finding and taxonomy description.
Only the taxonomy keys, allowed-owner values, prompt example, and strict owner
enum use the compact representation. Unknown codes fail closed.

Copy `provider-config.example.json` outside the repository and replace its
placeholders. Supply a short-lived bearer token only through the environment:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = az account get-access-token `
  --resource https://cognitiveservices.azure.com/ `
  --query accessToken -o tsv

node .\examples\hosted-direct-owner-code-replay\run-hosted-direct-owner-code-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-owner-code-v1" `
  --samples 3

Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

The candidate must preserve exact final quality, reduce output-token p50, and
avoid increasing input-token p50 or wall-time p90.

The first three-sample result preserved exact quality while reducing
output-token p50 by 16.67%, reasoning-token p50 by 26.32%, and wall-time p90
by 11.72%. See `measured-result-2026-10-06.md`.

The provider may bill direct requests independently of Copilot. Pace leaves
provider AI-unit, premium-request, and cache-write fields incomplete rather
than inventing zeros.

Only files under `receipts/` are intended to be shareable. Raw responses,
provider configuration, component profiles, usage files, prompts, and
intermediate manifests may contain local or provider-specific content.
