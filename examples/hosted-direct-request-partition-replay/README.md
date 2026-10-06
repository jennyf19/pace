# Hosted direct request partition replay

This scenario compares two direct strict-schema executions of the validated
64-finding, four-owner routing workload:

- baseline: one monolithic request containing all 64 findings;
- candidate: two contiguous 32-finding requests launched concurrently.

Both arms use the same provider deployment, model, `low` reasoning effort,
full owner names, prompt template, taxonomy, finding order, 2,048-token output
ceiling per request, deterministic final merge, and exact evaluator.

The candidate is not allowed to hide its extra calls:

- input, output, reasoning, cache, and API-time metrics sum both requests;
- wall time measures the actual span from deterministic partitioning through
  the last parallel response and deterministic merge;
- every partition must cover exactly its own IDs;
- the final result must match the same frozen expected output.

The v1 four-by-16 discovery preserved exact quality and cut wall-time p90
64.013%, but increased input-token p50 45.416%, output-token p50 14.949%, and
summed API-time p50 43.027%. Pace returned `revise`.

The current v2 treatment tests the principled midpoint: two parallel
32-finding requests under fresh source, configuration, replay, and comparison
identities. It must preserve exact quality, avoid increasing input-token p50,
reduce output-token p50, and reduce wall-time p90.

V2 also returned `revise`. Exact quality remained 3/3 and wall-time p90 fell
42.052%, but input-token p50 rose 15.174%, output-token p50 rose 6.856%, and
summed API-time p50 rose 21.213%.

The two measured points establish a latency-through-concurrency frontier, not
an efficiency win. See `measured-result-2026-10-06.md`.

Run after supplying the private provider configuration and a short-lived token:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-request-partition-replay\run-hosted-direct-request-partition-replay.mjs `
  --out <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 3
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

Commit and push source, configuration identities, and tests before model calls.
Only privacy-safe receipts and aggregate result documents belong in the
repository.
