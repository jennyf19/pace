# Hosted direct symbolic-label replay

This scenario generalizes compact response vocabularies from four owner labels
to eight semantic labels. It preserves the same 64 finding IDs, severities,
and descriptions while splitting each original domain into two finer labels:

- `identity-access` and `identity-governance`;
- `storage-access` and `storage-lifecycle`;
- `compute-runtime` and `compute-capacity`;
- `messaging-control` and `messaging-delivery`.

Each label has eight ground-truth findings.

Both cohorts use the same direct provider, deployment, declared
`gpt-5-mini` model, `low` reasoning effort, 64 findings, taxonomy meanings,
strict structure, deterministic stages, exact evaluator, and composite
accounting:

- **baseline:** emits the eight full semantic labels;
- **candidate:** emits symbols `a` through `h`, then decodes them
  deterministically before final merge.

Unknown symbols fail closed. The workload builder, symbolic projection,
decoder, and imported hybrid transform are hash-bound.

Copy `provider-config.example.json` outside the repository and replace its
placeholders. Supply a short-lived bearer token only through the environment:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = az account get-access-token `
  --resource https://cognitiveservices.azure.com/ `
  --query accessToken -o tsv

node .\examples\hosted-direct-symbolic-label-replay\run-hosted-direct-symbolic-label-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-symbolic-label-v3" `
  --samples 3

Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

The candidate must preserve exact final quality, reduce output-token p50, and
avoid increasing input-token p50 or wall-time p90.

The first v1 baseline request exhausted the shared 2,048-token output ceiling
and returned `incomplete` before a balanced cohort existed. The v2 source
raised the ceiling to 4,096 for both cohorts and used fresh source,
configuration, replay, and comparison identities.

The completed v2 cohort was rejected: full labels passed 3/3, while bare
symbols passed 0/3 and repeatedly confused finer semantic boundaries. The
current v3 candidate keeps each full label name once in its taxonomy value
while still emitting one-character symbols in all 64 routes. It uses fresh
source, configuration, replay, and comparison identities.

The provider may bill direct requests independently. Pace leaves AI-unit,
premium-request, and cache-write fields incomplete rather than inventing
zeros.

Only files under `receipts/` are intended to be shareable. Raw responses,
provider configuration, component profiles, usage files, prompts, and
intermediate manifests may contain local or provider-specific content.
