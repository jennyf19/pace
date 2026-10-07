# Measured result: explicit-pair wire cost

- **Date:** October 7, 2026
- **Status:** Deterministic model-free analysis
- **Disposition:** `keep` as an experiment-prioritization tool

## Question

Pace's explicit `[finding_id, owner]` representation preserved exact item
identity across two replicated workloads and one valid discovery cohort. This
analysis asked how much of the measured saving can be explained before another
model call by deterministic request and response structure alone.

The analysis reconstructs each frozen cohort's:

- complete inline prompt;
- residual input;
- strict response schema;
- serialized Responses request using one shared deployment placeholder;
- route-object expected output;
- explicit-pair expected output.

Both representations must deterministically reproduce the frozen expected
result before any size is reported.

## Result

| Scenario | Items | Labels | Request bytes saved | Expected output bytes saved | Observed input tokens saved | Observed visible tokens saved |
|---|---:|---:|---:|---:|---:|---:|
| Synthetic routing | 64 | 4 | 90 (0.917%) | 833 (39.090%) | 11 | 151 |
| BANKING77 five-intent | 40 | 5 | 79 (1.192%) | 521 (25.502%) | 8 | 63 |
| BANKING77 ten-intent | 40 | 10 | 79 (1.084%) | 521 (26.925%) | 8 | 103 |

The output saving is exact for minified JSON:

> `13 * item_count + 1` UTF-8 bytes

Each route object repeats `"id":` and `"owner":`, which together cost 13
bytes. Pairs retain the same quoted ID, quoted owner, comma, and two container
characters. The remaining one-byte saving comes from `"pairs"` being shorter
than `"routes"`.

For the request, the explicit-pair prompt is seven bytes longer in every
scenario. Its strict response schema is 82 to 93 bytes shorter, producing a
net serialized-request saving of 79 to 90 bytes.

## Calibration against observed tokens

The static byte direction matched all three prior exact-quality cohorts:

- request bytes fell and observed input-token p50 fell;
- expected output bytes fell and observed visible-answer-token p50 fell.

The conversion was not stable enough to predict token magnitude:

| Scenario | Request bytes per observed input token saved | Output bytes per observed visible token saved |
|---|---:|---:|
| Synthetic routing | 8.182 | 5.517 |
| BANKING77 five-intent | 9.875 | 8.270 |
| BANKING77 ten-intent | 9.875 | 5.058 |

Tokenizer behavior and the model's realized output still matter. Static bytes
are therefore a screening signal, not a substitute metric.

## Interpretation

The model-free low-hanging win is to calculate structural output savings before
funding a semantic cohort:

1. preserve explicit item identity and local label association;
2. construct both deterministic expected representations;
3. reject any representation that cannot reproduce the same frozen result;
4. rank surviving candidates by request and output bytes;
5. run the model experiment and require exact quality before considering
   performance.

This adds a cheap prioritization step without weakening the evidence ladder.
It explains why explicit pairs have a linear output advantage, but it does not
show that a model will follow the schema correctly.

## Evidence boundaries

- UTF-8 byte counts are not tokenizer counts.
- The expected outputs are minified because all three prompts require minified
  JSON.
- The shared deployment placeholder cancels from every request delta; no
  private provider value is used.
- Existing exact-quality receipts are calibration evidence, not new model
  samples.
- The ten-intent scenario remains a valid `n=3` discovery with its `n=5`
  replication transport-blocked.
- No provider request was made for this analysis.

## Evidence bindings

- Remote source commit:
  `a43e0a56cb4ac783306c8da837587145a5204026`
- Source tree:
  `3792c2f2586a49aecf79e00485cc57d5bde6f75d`
- Analyzer:
  `sha256:0bfc572da962f027c84e47b187da33e9135c740f11150e157c0f6b0063f5df52`
- Generated result:
  `sha256:f272e97a7bb7ff89373c72de32a76161d00d3616d73074af407dd512e18e2d3b`
- Synthetic `n=5` comparison:
  `sha256:512082b98c889136`
- BANKING77 five-intent `n=5` comparison:
  `sha256:c04712d51628cc68`
- BANKING77 ten-intent `n=3` comparison:
  `sha256:95351833bcad999d`
