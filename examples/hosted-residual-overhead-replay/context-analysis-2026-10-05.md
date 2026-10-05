# Context analysis: what remained after tool removal

- **Date:** October 5, 2026
- **Status:** Bound descriptive analysis of the v0.4.0 `n=3` cohorts
- **New model calls:** none

## Evidence boundary

This analysis re-profiled the six original residual-session `events.jsonl`
artifacts. Each raw artifact is bound by SHA-256. Context counters describe the
latest final shutdown snapshot and are explicitly non-additive to logical or
billed input usage.

- Context analysis: `sha256:6c602e58e0582f79`
- Replay: `sha256:75f126bad461db6b`
- Comparison: `sha256:49dd43b55b4c3594`
- Experiment source commit: `a4d03c83cb8e2c3460cbc0122741609d50b4004c`
- Analysis source commit: `f7b959c243d9743f9d4321266aff9d619abeb63e`
- Analyzer implementation: `sha256:53fda93478fed0dc5a3f64cbd810142f95c36c3e206eb24cdafd06bd39bfa4c1`

## Median context composition

| Metric | File + `view` | Inline tool-less | Change |
|---|---:|---:|---:|
| Current context tokens | 3,020 | 3,062 | +1.391% |
| System tokens | 1,962 | 1,890 | -3.670% |
| Conversation tokens | 851 | 1,169 | +37.368% |
| Tool-definition tokens | 203 | 0 | -100% |
| Classified context tokens | 3,017 | 3,059 | +1.392% |
| Unclassified framing tokens | 3 | 3 | unchanged |
| Model requests | 2 | 1 | -50% |
| Tool invocations | 1 | 0 | -100% |

The file+`view` context was approximately 64.97% system, 28.18%
conversation, 6.72% tool definitions, and 0.10% unclassified framing. The
inline tool-less context was approximately 61.72% system, 38.18%
conversation, 0% tool definitions, and 0.10% unclassified framing.

## Relationship to usage

| Usage metric | File + `view` p50 | Inline tool-less p50 | Change |
|---|---:|---:|---:|
| Logical input tokens | 5,147 | 2,345 | -54.439% |
| Non-cached input tokens | 2,834 | 2,343 | -17.325% |
| Cache-read tokens | 2,304 | 0 | -100% |
| AI units | 0.245885 | 0.15285 | -37.837% |

The candidate final context did not shrink; it grew by 42 tokens. Logical input
fell because the treatment collapsed two model requests to one, removed the
tool round-trip, and eliminated replay of cached context. The result is
topological rather than a simple prompt-length reduction.

## Interpretation

After tool definitions reached zero, the largest visible fixed component was
the 1,890-token system scaffold. The 1,169 conversation tokens contain the
inline taxonomy, eight descriptions, instructions, and generated exchange
state. Only three context tokens remained unclassified.

The next experiment should not trim semantic descriptions blindly. It should
compare the same inline payload across a smaller Copilot context tier or a
provider-neutral direct structured model boundary, while preserving the exact
evaluator and residual cases.

The privacy-safe context receipt contains no artifact paths, prompts, messages,
tool arguments, user identity, or private repository domains.
