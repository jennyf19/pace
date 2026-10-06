# Hosted direct-boundary scaling replay

This scenario scales the proven direct-boundary treatment from 8 to 24
semantic residual findings. It preserves the original corpus descriptions,
severities, IDs, owner taxonomy, and final owner routes, but removes every
owner hint so deterministic preprocessing resolves zero findings.

The two cohorts keep the payload, prompt, `gpt-5-mini`, `low` reasoning,
strict route schema, deterministic preprocess and merge, exact evaluator, and
composite accounting fixed:

- **baseline:** Copilot CLI with zero visible tools;
- **candidate:** one OpenAI-compatible Responses API call.

The strict schema is derived from the frozen residual payload and requires one
route for each ID from `H001` through `H024`.

Copy `provider-config.example.json` outside the repository and replace its
placeholders. Supply a short-lived bearer token only through the environment:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = az account get-access-token `
  --resource https://cognitiveservices.azure.com/ `
  --query accessToken -o tsv

node .\examples\hosted-direct-boundary-scaling-replay\run-hosted-direct-boundary-scaling-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-boundary-scale-24-v1" `
  --samples 3

Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

The provider may bill direct requests independently of Copilot. Pace leaves
provider AI-unit and premium-request fields incomplete rather than inventing
cross-provider zeros. The result compares the same declared model name, not
proven-identical model weights, deployments, or serving stacks.

Only files under `receipts/` are intended to be shareable. Raw responses,
provider configuration, component profiles, usage files, prompts, and
intermediate manifests may contain local or provider-specific content.
