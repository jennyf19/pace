# Frozen comparison example

This public-safe synthetic experiment exercises the full Pace path:

1. profile a complete baseline session;
2. profile a complete candidate session;
3. evaluate both results against one frozen corpus with a deterministic exact
   evaluator;
4. bind the quality receipt to the emitted run IDs;
5. compare selected performance metrics and emit a disposition.

No source code, prompts, messages, identities, repository names, or production
telemetry are present in the example.

Run from the Agent Performance Engineering desk:

```powershell
node .\pace\examples\frozen-comparison\run-example.mjs `
  --out .\pace-output\frozen-comparison
```

The expected disposition is `keep`. The candidate preserves the exact result
while reducing:

- AI units from 2.4 to 1.4;
- input tokens from 120 to 80;
- end-to-end wall time from 10 seconds to 6 seconds.

The v0.1 comparison is intentionally exact. It does not apply noise tolerance
or statistical confidence to a single run.
