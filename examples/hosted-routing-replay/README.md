# Hosted deduplication and routing replay

This publication-safe scenario tests a different deterministic workload shape:

- filter eligible synthetic findings;
- deduplicate by fingerprint with severity/confidence/ID tie-breaking;
- route winners to owners;
- aggregate severity counts;
- sort findings and owner batches deterministically.

The baseline asks `gpt-5-mini` to perform the complete transformation. The
candidate runs the hash-bound synchronous implementation directly and starts no
model session. Both paths use the same exact evaluator.

The first five-sample measured result is in
`measured-result-2026-10-01.md`.

Run a larger balanced cohort from the repository root:

```powershell
node .\examples\hosted-routing-replay\run-hosted-routing-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-routing-v1" `
  --samples 5
```

Only files under `receipts/` are intended to be shareable. Raw sessions, usage
files, and intermediate manifests may contain local paths.
