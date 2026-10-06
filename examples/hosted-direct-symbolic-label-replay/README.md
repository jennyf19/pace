# Hosted direct symbolic-label replay

This scenario generalizes compact response vocabularies from four owner labels
to eight semantic labels. It preserves the same 64 finding IDs, severities,
and descriptions while splitting each original domain into two finer labels:

- `identity-access` and `identity-governance`;
- `storage-access` and `storage-lifecycle`;
- `compute-runtime` and `compute-capacity`;
- `messaging-control` and `messaging-delivery`.

The first six labels have eight findings; `compute-runtime` has seven and
`compute-capacity` has nine. The initial balanced split placed one scheduler
finding in the wrong semantic bucket, so v4 preserves semantic fit rather than
artificial symmetry.

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
  --out "$HOME\.copilot\pace-runs\hosted-direct-symbolic-label-v4" `
  --samples 3

Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

The candidate must preserve exact final quality, reduce output-token p50, and
avoid increasing input-token p50 or wall-time p90.

The final v4 cohort returned `reject`. Full labels passed 1/3 and named symbols
passed 2/3; the fine-grained taxonomy remained unstable even after removing
forced balance and clarifying one description. Descriptive output and latency
improved, but quality did not. See `measured-result-2026-10-06.md`.

The first v1 baseline request exhausted the shared 2,048-token output ceiling
and returned `incomplete` before a balanced cohort existed. The v2 source
raised the ceiling to 4,096 for both cohorts and used fresh source,
configuration, replay, and comparison identities.

The completed v2 cohort was rejected: full labels passed 3/3, while bare
symbols passed 0/3 and repeatedly confused finer semantic boundaries. The
v3 candidate kept each full label name once in its taxonomy value, but the
benchmark itself still contained one forced compute mapping and one ambiguous
checkpoint description. The current v4 corpus moves the scheduler finding to
`compute-capacity`, clarifies “checkpoint access-control,” and uses fresh
corpus, source, configuration, replay, and comparison identities.

The provider may bill direct requests independently. Pace leaves AI-unit,
premium-request, and cache-write fields incomplete rather than inventing
zeros.

Only files under `receipts/` are intended to be shareable. Raw responses,
provider configuration, component profiles, usage files, prompts, and
intermediate manifests may contain local or provider-specific content.
