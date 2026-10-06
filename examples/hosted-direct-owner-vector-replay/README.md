# Hosted direct owner-vector replay

This scenario compares two single-call direct strict-schema representations of
the validated 64-finding, four-owner routing workload:

- baseline: 64 `{id, owner}` route objects;
- v1 candidate: one 64-position owner array;
- current v2 candidate: eight owner arrays of eight, each anchored by the
  first finding ID in its block.

Both arms use the same findings, full semantic owner names, taxonomy, provider
deployment, model, `low` reasoning effort, and exact final evaluator.

V1 removed all ID anchors. It reduced input-token p50 10.932%, output-token p50
34.101%, and wall-time p90 21.216%, but passed exact quality only 2/3. One
sample duplicated the owner at position 38, shifted every remaining label by
one, and misrouted 27 findings while still satisfying the 64-item schema. Pace
returned `reject`.

V2 preserves most structural compression while bounding alignment failures.
The `residual_findings` order remains frozen and authoritative, but every
eight-position block is anchored by its first finding ID. Deterministic code
requires all eight blocks and exactly eight allowed owners per block, maps each
position back to its frozen ID, and fails closed before final merge.

V2 restored exact quality 3/3 and reduced output-token p50 30.466%,
reasoning-token p50 12.500%, and wall-time p90 30.981%. Its 77-word prompt was
30 words longer than baseline, and input-token p50 rose by only 16 tokens
(0.857%), so Pace returned `revise`.

The current v3 treatment keeps the identical anchored schema and deterministic
decode while reducing the prompt to 46 words under fresh source,
configuration, replay, and comparison identities. It must preserve exact
quality, reduce input-token p50, reduce output-token p50, and avoid increasing
wall-time p90.

V3 returned `keep`: exact quality remained 3/3, input-token p50 fell 0.804%,
output-token p50 fell 26.322%, visible-answer p50 fell 61.453%, and wall-time
p90 fell 9.451%. See `measured-result-2026-10-06.md`.

The current v4 treatment is an unchanged balanced `n=5` replication under
fresh source, configuration, replay, and comparison identities.

Run after supplying the private provider configuration and a short-lived token:

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-owner-vector-replay\run-hosted-direct-owner-vector-replay.mjs `
  --out <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 5
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

Commit and push source, configuration identities, and tests before model calls.
Only privacy-safe receipts and aggregate result documents belong in the
repository.
