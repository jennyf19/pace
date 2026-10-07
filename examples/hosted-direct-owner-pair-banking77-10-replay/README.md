# BANKING77 ten-intent explicit owner-pair replay

This scenario holds payload size at 40 utterances while increasing BANKING77
label cardinality from five to ten.

The deterministic selection rule uses official category indexes
`0, 8, 16, 24, 32, 40, 48, 56, 64, 72`, then takes the first four test
examples for each label in upstream order.

The selected intents are:

- `card_arrival`;
- `automatic_top_up`;
- `pending_top_up`;
- `card_acceptance`;
- `visa_or_mastercard`;
- `pending_card_payment`;
- `card_swallowed`;
- `receiving_money`;
- `wrong_exchange_rate_for_cash_withdrawal`;
- `cash_withdrawal_charge`.

Upstream commit, file hashes, CC BY 4.0 attribution, and source-row IDs use the
same pinned BANKING77 source as the five-intent scenario.

The treatment remains unchanged:

- baseline: 40 `{id, owner}` route objects;
- candidate: 40 `[finding_id, owner]` pairs;
- one direct request per sample;
- exact upstream intent labels;
- strict schemas;
- deterministic ID validation and exact final merge.

The full-object baseline must pass exact quality before pair performance is
eligible.

```powershell
$env:PACE_DIRECT_ACCESS_TOKEN = "<short-lived-token>"
node examples\hosted-direct-owner-pair-banking77-10-replay\run-hosted-direct-owner-pair-banking77-10-replay.mjs `
  --out <new-output-directory> `
  --provider-config <private-provider-config.json> `
  --model gpt-5-mini `
  --samples 3
Remove-Item Env:PACE_DIRECT_ACCESS_TOKEN
```
