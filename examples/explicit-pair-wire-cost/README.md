# Explicit-pair wire-cost analysis

This model-free analysis reconstructs the exact prompts, strict response
schemas, and expected minified outputs used by Pace's three qualified
route-object versus explicit-pair scenarios.

It answers a narrow question:

> How much UTF-8 wire structure disappears when
> `{"id":"H001","owner":"identity"}` becomes
> `["H001","identity"]`?

Run it with Node.js 22 or later:

```powershell
node examples\explicit-pair-wire-cost\analyze-explicit-pair-wire-cost.mjs `
  --out examples\explicit-pair-wire-cost\wire-cost-result.json
```

The analysis makes no provider request and needs no private configuration.
Both representations must deterministically reproduce each scenario's frozen
expected result before their sizes are reported.

The result can rank representations for later model experiments. It cannot
predict tokenizer behavior, latency, or semantic quality, and it cannot replace
the exact-quality gate.
