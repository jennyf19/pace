# Hosted direct-boundary 64-finding scaling replay

This scenario extends the 24-finding semantic-routing workload to 64 distinct
findings. The original 24 cases remain unchanged. Forty new cases preserve the
same four-owner taxonomy and produce balanced final batches of 16 findings per
owner, each with 4 critical, 7 high, 4 medium, and 1 low finding.

Every owner hint is absent, so all 64 findings cross the semantic boundary.
The two cohorts keep the payload, prompt, `gpt-5-mini`, `low` reasoning,
strict route schema, deterministic preprocess and merge, exact evaluator, and
composite accounting fixed:

- **baseline:** Copilot CLI with zero visible tools;
- **candidate:** one OpenAI-compatible Responses API call.

Copy `provider-config.example.json` outside the repository and replace its
placeholders. Supply a short-lived bearer token only through the environment:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = az account get-access-token `
  --resource https://cognitiveservices.azure.com/ `
  --query accessToken -o tsv

node .\examples\hosted-direct-boundary-scaling-64-replay\run-hosted-direct-boundary-scaling-64-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-boundary-scale-64-v1" `
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
