# Measured result: parallel request partitioning

- **Date:** October 6, 2026
- **Status:** Two descriptive `n=3` cohorts
- **Final disposition:** `revise`

## Question

The 64-finding direct boundary showed its first measured regression in generated
work. This experiment asked whether smaller concurrent requests could preserve
exact quality while reducing generation and tail latency.

Both arms used the validated four-owner workload, full owner names, the same
direct provider deployment, `gpt-5-mini`, `low` reasoning effort, strict
schemas, deterministic merge, and exact evaluator.

The baseline used one 64-finding request. Two candidate topologies were tested
under fresh identities:

- v1: four parallel contiguous requests of 16 findings;
- v2: two parallel contiguous requests of 32 findings.

All token and API-time metrics sum every candidate request. Wall time measures
the actual concurrent span through deterministic final merge.

## Results

Both topologies preserved exact quality 3/3 with no lost findings, regressions,
or accounting residuals.

| Candidate topology | Input p50 | Output p50 | Reasoning p50 | Summed API-time p50 | Wall-time p50 | Wall-time p90 | Disposition |
|---|---:|---:|---:|---:|---:|---:|---|
| Four by 16 | +45.416% | +14.949% | +6.250% | +43.028% | -60.573% | -64.013% | `revise` |
| Two by 32 | +15.174% | +6.856% | 0.000% | +21.213% | -35.802% | -42.052% | `revise` |

### v1: four by 16

| Metric | Monolithic | Four parallel requests | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,865 | 2,712 | +45.416% |
| Output-token p50 | 1,679 | 1,930 | +14.949% |
| Reasoning-token p50 | 1,024 | 1,088 | +6.250% |
| API-time p50 | 13,247.350 ms | 18,947.419 ms | +43.028% |
| Wall-time p50 | 13,270 ms | 5,232 ms | -60.573% |
| Wall-time p90 | 15,572.4 ms | 5,604 ms | -64.013% |

### v2: two by 32

| Metric | Monolithic | Two parallel requests | Change |
|---|---:|---:|---:|
| Input-token p50 | 1,865 | 2,148 | +15.174% |
| Output-token p50 | 1,517 | 1,621 | +6.856% |
| Reasoning-token p50 | 896 | 896 | 0.000% |
| API-time p50 | 15,254.060 ms | 18,489.911 ms | +21.213% |
| Wall-time p50 | 15,287 ms | 9,814 ms | -35.802% |
| Wall-time p90 | 19,448.6 ms | 11,270 ms | -42.052% |

## Interpretation

Parallel partitioning is a latency-through-concurrency trade, not an
efficiency optimization.

The logical input penalty was almost exactly 283 tokens per additional
request:

- two by 32 added 283 tokens for one extra request;
- four by 16 added 847 tokens across three extra requests, or 282.3 each.

That repeated prompt, taxonomy, schema, and response framing also increased
output and total API work. The smaller two-request treatment improved the
frontier materially, but no partitioned topology can remove the fixed cost of
an additional request without changing the transport contract.

The supported product interpretation is:

> Parallel partitioning may be an explicit latency mode when lower elapsed
> time is worth more requests and more total model work. It should not be the
> default efficiency path.

No third partition count is needed for the current decision. It would tune the
same measured curve rather than challenge the conclusion.

## Cache counterevidence

Cache-read behavior reversed between cohorts:

- v1 baseline p50 read 1,792 cached tokens while the candidate read zero;
- v2 baseline p50 read zero while the candidate read 1,024.

Logical input totals remained complete, but non-cached input and any implied
billing benefit were not stable enough to support a cache-cost claim.

## Evidence boundaries

- Both cohorts used one direct provider deployment and model version
  `2025-08-07`.
- Three-sample cohorts are descriptive, not statistically significant.
- Parallel calls increase provider concurrency and may encounter different
  quotas or contention in another environment.
- AI units, premium requests, cache-write tokens, and direct billing remained
  unavailable.
- Performance distributions do not establish serving-stack behavior beyond
  this provider, deployment, workload, and date.

## Evidence bindings

### v1: four by 16

- Source commit: `20b39c345a717c99085403b8dd8cf288e6deca91`
- Replay receipt: `sha256:7f067e898c43a09b`
- Comparison receipt: `sha256:f421383b270e57d7`
- Workload: `sha256:0b81aac40f79619ea44b23e74aef5a0925e27e947b1244479cc2aab88c5606c8`
- Source revision: `sha256:25e49dfda2eb7559b9d082860e9fdc6912e4fcaa1879fa5a4c488dd30e861961`
- Baseline configuration: `sha256:7cc882c7ef4f61d2c54510d518696def505ea8a6742f529c1223dadf9691c55a`
- Candidate configuration: `sha256:6f5bfb0156a26b90b7b7c58d987016dcbef209ab0bad443a0e3c820f29b3660c`

### v2: two by 32

- Source commit: `b7de39401587fb6bf808277df40d7dd55d337350`
- Replay receipt: `sha256:edd360b810b5ec51`
- Comparison receipt: `sha256:c8867e11700b2891`
- Workload: `sha256:1b5d3f8f562b8eb1f565c5a1d197b5dbf4aeef4ae4b63d1baa5609fd6d415429`
- Source revision: `sha256:3229384b921354c01acee0c73116136da556eaf15db29cbb1429f6d8dde72c7b`
- Baseline configuration: `sha256:1787f7c4ff43d0c4b503b475d1613e328af80334df13fc1e808e00477cf4645c`
- Candidate configuration: `sha256:097879510d0e399eda198795514331f1ff5df16db36824c06a2764c1f84a6c81`

Shared evaluator implementation:
`sha256:93fb5f3ef80ac91ebc98e8806aa3c62916edae1c71822860f7402fe3610a2107`.

Private provider configuration:
`sha256:ba64dc7bdd3a8ce26edc280b9ed23b2f42073265b30af0c954e747c5f7868ccf`.

The receipts contain no local paths, user identity, prompt text, provider
endpoint, deployment name, bearer token, or private repository domains.
