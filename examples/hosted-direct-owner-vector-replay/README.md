# Hosted direct owner-vector replay

This scenario compares two single-call direct strict-schema representations of
the validated 64-finding, four-owner routing workload:

- baseline: 64 `{id, owner}` route objects;
- candidate: one 64-position owner array.

Both arms use the same findings, full semantic owner names, taxonomy, provider
deployment, model, `low` reasoning effort, and exact final evaluator.

The candidate removes only repeated response structure. The
`residual_findings` order is frozen and authoritative. Deterministic code
requires exactly 64 allowed owner names, zips each position back to its frozen
finding ID, and fails closed before final merge.

The candidate must preserve exact quality, reduce input-token p50, reduce
output-token p50, and avoid increasing wall-time p90.

Run after supplying the private provider configuration and a short-lived token:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-owner-vector-replay\run-hosted-direct-owner-vector-replay.mjs `
  --out <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 3
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

Commit and push source, configuration identities, and tests before model calls.
Only privacy-safe receipts and aggregate result documents belong in the
repository.
