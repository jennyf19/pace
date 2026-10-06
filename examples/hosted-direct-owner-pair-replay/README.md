# Hosted direct explicit owner-pair replay

This scenario compares two single-call direct strict-schema representations of
the validated 64-finding, four-owner routing workload:

- baseline: 64 `{id, owner}` route objects;
- candidate: 64 compact `[finding_id, owner]` pairs.

Both arms preserve every explicit finding ID, full semantic owner names, the
same finding order, taxonomy, provider deployment, model, `low` reasoning
effort, and exact final evaluator.

The candidate removes repeated `id` and `owner` field names without using
positional-only decoding. Deterministic code requires exactly 64 pairs,
requires each pair's ID to match the corresponding frozen residual finding,
validates the owner vocabulary, and fails closed before final merge.

The candidate must preserve exact quality, reduce input-token p50, reduce
output-token p50, and avoid increasing wall-time p90.

Run after supplying the private provider configuration and a short-lived token:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-owner-pair-replay\run-hosted-direct-owner-pair-replay.mjs `
  --out <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 3
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

Commit and push source, configuration identities, and tests before model calls.
Only privacy-safe receipts and aggregate result documents belong in the
repository.
