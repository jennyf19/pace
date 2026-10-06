# Hosted direct-model boundary replay

This scenario keeps the hybrid semantic workload, inline prompt, model,
reasoning effort, deterministic preprocess and merge, exact evaluator, and
composite accounting fixed. It changes the model host boundary:

- **baseline:** Copilot CLI with zero visible tools, `gpt-5-mini`, and `low`
  reasoning;
- **candidate:** one OpenAI-compatible Responses API call using the same model
  and effort, with a strict JSON schema for the existing residual-route shape.

The direct provider configuration is private runtime input. Copy
`provider-config.example.json` outside the repository and replace its
placeholders. The file must contain:

```json
{
  "endpoint": "https://<resource>.cognitiveservices.azure.com",
  "deployment": "<deployment-name>",
  "model": "gpt-5-mini",
  "model_version": "2025-08-07"
}
```

Supply a short-lived bearer token only through the environment:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = az account get-access-token `
  --resource https://cognitiveservices.azure.com/ `
  --query accessToken -o tsv

node .\examples\hosted-direct-model-boundary-replay\run-hosted-direct-model-boundary-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-model-boundary-v2" `
  --samples 5

Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

The provider may bill direct requests independently of Copilot. Pace leaves
provider AI-unit and premium-request fields incomplete rather than inventing
cross-provider zeros. The decision therefore uses exact quality, logical input,
output, and latency metrics available on both sides.

The first three-sample measured result is in
`measured-result-2026-10-05.md`. It compares the same declared model name, not
proven-identical model weights or serving stacks.

The current v2 entrypoint repeats the same treatment with a balanced
five-sample cohort and fresh replay/configuration identities.

The five-sample replication is in
`replication-result-2026-10-06.md`.

Only files under `receipts/` are intended to be shareable. Raw responses,
provider configuration, component profiles, usage files, prompts, and
intermediate manifests may contain local or provider-specific content.
