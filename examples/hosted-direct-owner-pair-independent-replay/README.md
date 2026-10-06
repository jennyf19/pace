# Independent explicit owner-pair replay

This scenario tests the replicated explicit ID-owner pair representation on a
fresh public-safe semantic workload rather than another subset of the original
64 findings.

The frozen workload contains 40 interleaved findings across five orthogonal
operational domains:

- network;
- database;
- frontend;
- observability;
- deployment.

Descriptions do not contain the exact owner labels. One deterministic builder
produces the source input, ground-truth routes, and expected final result before
any model call.

The treatment remains unchanged:

- baseline: 40 `{id, owner}` route objects;
- candidate: 40 `[finding_id, owner]` pairs;
- one direct request per sample;
- full semantic owner names;
- strict schemas;
- deterministic ID validation and final merge;
- exact quality gate.

The candidate must preserve exact quality, reduce input-token p50, reduce
output-token p50, and avoid increasing wall-time p90.

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-owner-pair-independent-replay\run-hosted-direct-owner-pair-independent-replay.mjs `
  --out <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 3
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```

Commit and push the generated workload, runner, configuration identities, and
tests before model calls.
