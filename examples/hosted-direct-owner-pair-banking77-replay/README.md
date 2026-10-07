# BANKING77 explicit owner-pair replay

This scenario tests explicit `[finding_id, owner]` pairs on an externally
labeled intent-classification corpus.

## Upstream source

- Dataset: BANKING77
- Curator: PolyAI
- Upstream repository:
  https://github.com/PolyAI-LDN/task-specific-datasets
- Pinned commit:
  `57ec275d8078af65b7731c2a98be812d844a6d6b`
- Split: official test split
- License: Creative Commons Attribution 4.0 International

The deterministic selection rule uses official category indexes
`0, 15, 30, 45, 60`, then takes the first eight test examples for each label in
upstream order. This produces 40 frozen utterances across:

- `card_arrival`;
- `top_up_by_bank_transfer_charge`;
- `unable_to_verify_identity`;
- `declined_card_payment`;
- `getting_spare_card`.

Source hashes, selection details, attribution, and modifications are recorded
in `source-manifest.json` and `BANKING77-ATTRIBUTION.md`.

## Treatment

- baseline: 40 `{id, owner}` route objects;
- candidate: 40 `[finding_id, owner]` pairs;
- one direct request per sample;
- exact upstream intent labels;
- strict schemas;
- deterministic ID validation and exact final merge.

The full-object baseline must pass exact quality before candidate performance
is eligible.

The first balanced `n=3` cohort returned `keep`. Both arms passed exact quality
3/3; input-token p50 fell 0.512%, output-token p50 fell 11.613%, and wall-time
p90 fell 26.600%. The v2 treatment was an unchanged balanced `n=5`
replication under fresh identities.

The first v2 attempt completed nine requests and failed on the tenth at
transport. Two fresh-output retries also failed at transport before balanced
cohorts existed. All partial attempts are preserved and excluded. The current
v3 treatment keeps the same request semantics while adding privacy-safe fetch
cause codes for diagnosis under fresh source identities.

The fresh v3 balanced `n=5` replication returned `keep`. Both arms passed exact
quality 5/5; input-token p50 fell 0.512%, output-token p50 fell 22.874%, and
wall-time p90 fell 4.001%. See `measured-result-2026-10-07.md`.

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-owner-pair-banking77-replay\run-hosted-direct-owner-pair-banking77-replay.mjs `
  --out <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 5
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```
