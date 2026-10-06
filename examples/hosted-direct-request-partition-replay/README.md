# Hosted direct request partition replay

This scenario compares two direct strict-schema executions of the validated
64-finding, four-owner routing workload:

- baseline: one monolithic request containing all 64 findings;
- candidate: four contiguous 16-finding requests launched concurrently.

Both arms use the same provider deployment, model, `low` reasoning effort,
full owner names, prompt template, taxonomy, finding order, 2,048-token output
ceiling per request, deterministic final merge, and exact evaluator.

The candidate is not allowed to hide its extra calls:

- input, output, reasoning, cache, and API-time metrics sum all four requests;
- wall time measures the actual span from deterministic partitioning through
  the last parallel response and deterministic merge;
- every partition must cover exactly its own IDs;
- the final result must match the same frozen expected output.

The candidate must preserve exact quality, avoid increasing input-token p50,
reduce output-token p50, and reduce wall-time p90.

Run after supplying the private provider configuration and a short-lived token:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-request-partition-replay\run-hosted-direct-request-partition-replay.mjs `
  --output <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 3
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

Commit and push source, configuration identities, and tests before model calls.
Only privacy-safe receipts and aggregate result documents belong in the
repository.
