# Measured result: residual file-view versus inline tool-less transport

- **Date:** October 5, 2026
- **Status:** Discovery receipt; descriptive `n=3` per cohort
- **Disposition:** `keep` for the corrected frozen experiment

## Experiment

Both cohorts used the same eight semantic residual findings, deterministic
preprocess and merge implementation, `gpt-5-mini`, reasoning effort `medium`,
context tier `default`, exact evaluator, and composite run accounting.

- **Baseline:** wrote `residual-input.json`, exposed only the `view` tool, and
  asked Copilot to read the file.
- **Candidate:** appended the identical residual JSON directly to the prompt
  and exposed zero model-visible tools through the frozen
  `__pace_no_tools__` allowlist sentinel.
- **Quality:** baseline 3/3 passed; candidate 3/3 passed; no regressions or lost
  findings.
- **Billing:** baseline used 0.71989 AI units in total; candidate used 0.46201,
  a 35.82% reduction. All six sessions reported zero premium requests.

## Invalidated first probe

The first attempted tool-less run passed `--available-tools` with zero values.
The CLI treated that as the default tool set rather than an empty set. Raw
telemetry reported 71,608 tool-definition tokens and approximately 69,578
logical input tokens per candidate run. That `revise` result is a treatment
failure, not experiment evidence.

A live sentinel canary then measured zero tool-definition tokens. Only the
sentinel-backed rerun below is included in the Pace result.

## Performance results

| Metric | File + `view` samples | Inline tool-less samples | Comparison | Change |
|---|---:|---:|---:|---:|
| Tool-definition tokens | 203, 203, 203 | 0, 0, 0 | p50 203 -> 0 | -100% |
| AI units | 0.214795, 0.25921, 0.245885 | 0.165775, 0.143385, 0.15285 | p50 0.245885 -> 0.15285 | -37.837% |
| Logical input tokens | 5,147, 5,138, 5,149 | 2,343, 2,345, 2,346 | p50 5,147 -> 2,345 | -54.439% |
| Non-cached input tokens | 1,819, 2,834, 2,845 | 2,343, 1,321, 2,346 | p50 2,834 -> 2,343 | -17.325% |
| Output tokens | 805, 913, 845 | 536, 539, 471 | p50 845 -> 536 | -36.568% |
| Reasoning tokens | 512, 704, 576 | 384, 384, 320 | p50 576 -> 384 | -33.333% |
| API time | 13,831 ms, 12,472 ms, 16,666 ms | 8,091 ms, 8,420 ms, 11,993 ms | p90 16,099 -> 11,278.4 ms | -29.944% |
| End-to-end wall time | 24,419 ms, 27,718 ms, 29,201 ms | 20,096 ms, 21,573 ms, 22,456 ms | p90 28,904.4 -> 22,279.4 ms | -22.920% |
| Premium requests | 0, 0, 0 | 0, 0, 0 | p50 0 -> 0 | unchanged |

Cache-read p50 fell from 2,304 tokens to zero; cache-read p90 fell 73.77%.

## Evidence bindings

- Source commit: `a4d03c83cb8e2c3460cbc0122741609d50b4004c`
- Replay receipt: `sha256:75f126bad461db6b`
- Comparison receipt: `sha256:49dd43b55b4c3594`
- Workload: `sha256:fddb3dcca8d3b6f98dd133cc039db7383e7aa7bb874f21d5bdd3686c5b538673`
- Source revision: `sha256:15c9aa38b7609627f2cab882643ce357d004f272e14f8bb102ac9bc753c5ea5e`
- Evaluator: `sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`
- Baseline configuration: `sha256:77b3758bf92f2f9236f6b2849f7320bd169e8581ff0204c516b599dfe16b6b9e`
- Candidate configuration: `sha256:d2075651e6437af8284fda18840195a5f0935d594b87a1a5f956c593a6192274`
- Residual orchestrator: `sha256:a94330a65989aea50b3fa89133168281e7c8ce96b4267cbecc7d9ed41525d39e`
- Profiled Copilot helper: `sha256:694db889c121e7dfa6cfd749e03284bc7e1a3b0ed6cf71d038361ea873e65480`
- Hybrid sample runner: `sha256:5bef59f7f12bc914a451859f5ee1135062141a8e8b924743525590a6757722d2`
- Composite run profiler: `sha256:453c8f37c1a612a5644fab8d2435ea64efa060ae75d9108e0ae23d8a056b30ea`
- Deterministic runner: `sha256:ccfe5c745fda9dbc3b9053e328dd70fc51f3905d30c277a6ffd3f0c0dcd124e3`

The final replay and comparison receipts contain no local paths, user identity,
prompt text, or private repository domains.

## Interpretation

For this frozen residual workload, removing file/tool transport cut more than
half of logical input and eliminated all tool-definition tokens without
removing semantic evidence or changing quality. The remaining 2,345 median
logical input tokens are now mostly runtime/system scaffold plus the inline
taxonomy and eight descriptions.

The most important result is methodological: tool visibility must be verified
from telemetry. A syntactically accepted CLI option can still produce the
opposite treatment.

Three samples remain descriptive evidence, not a confidence-interval or
significance claim.

The separately bound context snapshot analysis is in
`context-analysis-2026-10-05.md`.
