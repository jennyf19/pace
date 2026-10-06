# Pace session profiler

This dependency-free Pace MVP parses GitHub Copilot CLI `events.jsonl`
artifacts and hash-bound deterministic executions into provider-neutral
session and run profiles with human-readable Markdown reports.

Requires Node.js 22 or later. Pace has no runtime package dependencies.

## Profile one session

```powershell
node .\profile-session.mjs "$HOME\.copilot\session-state\<session-id>" `
  --out .\pace-output
```

The profiler:

- uses `session.shutdown` totals when present;
- falls back to per-model-call token receipts for live or interrupted sessions;
- reports logical input tokens and non-cached input tokens separately;
- records tool-definition tokens separately from other logical input;
- correlates tool start/completion events and subagent lifecycle events;
- attributes shutdown model and agent metrics without adding them to totals;
- selects the latest shutdown snapshot after resumes rather than summing;
- treats activity after the latest shutdown as incomplete and retains that
  snapshot only as a known subtotal;
- reports active wall time only for continuous sessions and keeps resumed active
  wall time `null`;
- hashes the session identifier by default;
- excludes prompts, messages, code, tool arguments/results, and working
  directories.

Use `--include-identifiers` only for a private local investigation that needs
the raw session ID.

## Profile a run set

Create a manifest:

```json
{
  "schema_version": "0.1",
  "run_id": "review-001",
  "sessions": [
    {
      "id": "main",
      "role": "primary",
      "artifact": "../artifacts/main",
      "billing": "independent"
    },
    {
      "id": "classification",
      "role": "classification",
      "artifact": "../artifacts/classification",
      "billing": "independent"
    },
    {
      "id": "subagent-export",
      "role": "diagnostic-copy",
      "artifact": "../artifacts/subagent",
      "billing": "included",
      "included_in": "main"
    }
  ]
}
```

Then run:

```powershell
node .\profile-run.mjs .\run-set.json --out .\pace-output
```

Independent sessions contribute exactly once. Included sessions remain visible
but contribute zero. Missing additive metrics make the aggregate `null`, with a
known subtotal and explicit missing-session list. Run wall time is the
earliest-start-to-latest-end span, never a sum of session durations.

When a runtime probe such as `copilot --version` is frozen before execution,
set `declared_runtime_version` on the session entry. Pace retains the
`session.start` value separately as `telemetry_version` and warns when the two
values differ.

See `accounting-invariants.md` for the full contract.

## Profile a deterministic JSON run

Use `profileDeterministicJsonTransform` for a synchronous local transform whose
implementation, input, and output can be hash-bound:

```javascript
import {
  profileDeterministicJsonTransform
} from "./profile-deterministic-run.mjs";
import { writeRunArtifacts } from "./profile-run.mjs";

const { profile } = await profileDeterministicJsonTransform({
  runId: "candidate-001",
  input: { id: "workload", path: "./workload.json" },
  output: { id: "result", path: "./result.json" },
  transform,
  implementationFiles: [
    { id: "transform", path: "./transform.mjs" }
  ]
});

writeRunArtifacts(profile, "./pace-output");
```

The receipt reports zero model calls, tokens, AI units, API time, and premium
requests only when the explicit deterministic execution contract is complete.
It hashes the Pace runner plus every declared implementation file, verifies
those hashes again after execution, binds the exact input/output bytes, and
rejects asynchronous transforms. Missing provider telemetry alone can never
produce zero.

This is an auditable execution contract, not an operating-system sandbox or
supply-chain attestation. Its proof scope is the hash-bound runner and declared
synchronous implementation.

## Compose a hybrid run

Use `compose-run-profiles.mjs` when one logical run contains multiple measured
components, such as deterministic preprocessing, a residual model session, and
deterministic merge:

```json
{
  "schema_version": "0.1",
  "run_id": "hybrid-001",
  "components": [
    {
      "id": "preprocess",
      "role": "deterministic-preprocess",
      "profile": "./preprocess.run-profile.json"
    },
    {
      "id": "residual-model",
      "role": "semantic-residual",
      "profile": "./residual.run-profile.json"
    },
    {
      "id": "merge",
      "role": "deterministic-merge",
      "profile": "./merge.run-profile.json"
    }
  ]
}
```

```powershell
node .\compose-run-profiles.mjs .\hybrid-run.json --out .\pace-output
```

Component totals contribute once. Nested session evidence remains visible for
runtime matching and residual checks. Duplicate run IDs, profile paths, or
contributing session evidence fail validation. Missing component metrics make
the composite total `null`.

## Compare baseline and candidate runs

Create an external quality result whose run IDs and full profile hashes exactly
match the emitted run profiles:

```json
{
  "schema_version": "0.1",
  "baseline": {
    "run_id": "sha256:1111111111111111",
    "run_profile_sha256": "sha256:<64 hex>",
    "corpus_id": "corpus-v1",
    "evaluator_id": "evaluator-v1",
    "complete": true,
    "passed": true,
    "score": 0.98
  },
  "candidate": {
    "run_id": "sha256:2222222222222222",
    "run_profile_sha256": "sha256:<64 hex>",
    "corpus_id": "corpus-v1",
    "evaluator_id": "evaluator-v1",
    "complete": true,
    "passed": true,
    "score": 0.98
  },
  "regressions": [],
  "lost_findings": []
}
```

Then create a comparison manifest:

```json
{
  "schema_version": "0.1",
  "comparison_id": "experiment-001",
  "baseline_profile": "./baseline.run-profile.json",
  "candidate_profile": "./candidate.run-profile.json",
  "quality_result": "./quality.json",
  "decision_metrics": [
    {
      "metric": "ai_units",
      "goal": "decrease"
    },
    {
      "metric": "wall_time_ms",
      "goal": "not_increase"
    }
  ]
}
```

Run:

```powershell
node .\compare-runs.mjs .\comparison.json --out .\pace-output
```

Supported goals are `decrease`, `increase`, `not_increase`, and
`not_decrease`. The comparison reports every run metric, but only explicitly
declared decision metrics can justify `keep`.

The comparison:

- rejects mismatched run, corpus, or evaluator identities;
- carries each side's incomplete metric coverage and known subtotal forward;
- treats non-zero attribution residuals on decision metrics as incomplete
  accounting;
- returns `unproven` when selected accounting or quality evidence is
  incomplete;
- returns `reject` for a known quality regression or lost finding;
- returns `revise` when a measured candidate misses a goal or produces no
  strict improvement;
- returns `keep` only when quality passes, selected accounting is complete,
  every declared goal is met, and at least one decision metric improves.

Percentage change is marked `n/a (zero baseline)` when a complete baseline is
zero and the candidate is non-zero; the absolute delta remains available. The
v0.1 decision is an exact single-run comparison and does not claim statistical
confidence or apply a noise tolerance.

## Run the frozen end-to-end example

The public-safe synthetic example profiles both sides, runs a deterministic
external evaluator, writes the quality receipt, and produces the comparison:

```powershell
node .\examples\frozen-comparison\run-example.mjs `
  --out .\pace-output\frozen-comparison
```

The expected disposition is `keep`. See
`examples/frozen-comparison/README.md` for the frozen corpus and measured
deltas.

## Run the hosted measured example

The hosted example compares independent Copilot CLI baseline sessions with
local deterministic candidate executions:

```powershell
node .\examples\hosted-replay\run-hosted-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-triage-model-free-v3"
```

It compares model-side filtering with a fully model-free deterministic
transform over a synthetic corpus. Candidate samples do not start Copilot.
The runner uses balanced ABBA order, scores both paths with one frozen
evaluator, binds quality to the exact SHA-256 of every run profile, and includes
the orchestration source in both cohort configurations.

See `examples/hosted-replay/measured-result-2026-09-25.md` for the intermediate
model-copy result and
`examples/hosted-replay/model-free-result-2026-10-01.md` for the true zero-model
receipt. The measured v2 sources are frozen at tag `v0.1.0`; the current v3
entrypoint uses the shared hosted model-free runner.

## Run the second hosted workload shape

The routing scenario adds duplicate winner selection, owner grouping, aggregate
counts, and stable batch ordering:

```powershell
node .\examples\hosted-routing-replay\run-hosted-routing-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-routing-v1" `
  --samples 5
```

The baseline asks the model to perform the full transformation. The candidate
uses the same deterministic receipt contract and starts no model session.
See
`examples/hosted-routing-replay/measured-result-2026-10-01.md` for the
five-sample result.

## Run the hybrid semantic-residual workload

The hybrid scenario keeps 16 high-confidence routes in deterministic code and
sends only 8 ambiguous descriptions to Copilot:

```powershell
node .\examples\hosted-hybrid-replay\run-hosted-hybrid-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-hybrid-v1" `
  --samples 3
```

Each candidate sample is one composite Pace run: deterministic preprocess,
residual model classification, and deterministic merge.
See
`examples/hosted-hybrid-replay/measured-result-2026-10-01.md` for the first
three-sample result.

## Run the residual overhead isolation

The overhead scenario keeps the hybrid workload and semantic residual fixed,
then compares file+`view` transport with inline JSON and an explicit empty tool
set:

```powershell
node .\examples\hosted-residual-overhead-replay\run-hosted-residual-overhead-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-residual-overhead-v1" `
  --samples 3
```

Both cohorts remain composite runs with the same deterministic preprocess and
merge implementation.

Pace implements the empty tool set with a frozen nonexistent sentinel in
`--available-tools`. Passing the option with zero values falls back to the
default tool set in the current CLI and is not a valid tool-less treatment.
See
`examples/hosted-residual-overhead-replay/measured-result-2026-10-05.md` for
the corrected three-sample result.

## Run the reasoning-effort isolation

The reasoning scenario keeps the inline residual JSON, zero visible tools,
model, context tier, deterministic stages, and exact evaluator fixed. It
compares `medium` with `low` reasoning:

```powershell
node .\examples\hosted-reasoning-effort-replay\run-hosted-reasoning-effort-replay.mjs `
  --out "$HOME\.copilot\pace-runs\hosted-reasoning-effort-v2" `
  --samples 3
```

The candidate is accepted only if exact routing quality is preserved. See
`examples/hosted-reasoning-effort-replay/README.md` for the frozen treatment
contract. An initial `minimal` treatment was invalidated before its first
model request because `gpt-5-mini` did not support that effort.

The corrected three-sample result preserved exact quality while cutting
reasoning-token p50 by 50%, AI-unit p50 by 28.57%, and wall-time p90 by
18.20%. See
`examples/hosted-reasoning-effort-replay/measured-result-2026-10-05.md`.

## Run the direct-model boundary isolation

The direct-boundary scenario keeps the same inline residual payload,
`gpt-5-mini`, `low` reasoning, deterministic stages, and exact evaluator. It
compares the zero-tool Copilot CLI host with one provider-neutral structured
Responses API call:

```powershell
node .\examples\hosted-direct-model-boundary-replay\run-hosted-direct-model-boundary-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-model-boundary-v1" `
  --samples 3
```

The private provider file and bearer token remain outside the repository and
shareable receipts. See
`examples/hosted-direct-model-boundary-replay/README.md` for setup and
accounting boundaries.

The first three-sample result preserved exact quality while reducing
logical-input p50 by 79.76%, output-token p50 by 4.98%, and wall-time p90 by
93.82%. Provider billing remained intentionally unmeasured. See
`examples/hosted-direct-model-boundary-replay/measured-result-2026-10-05.md`.

The balanced five-sample replication preserved exact quality and reproduced
the input-token p50 reduction at 79.78%, wall-time p50 at 75.97%, and wall-time
p90 at 80.10%. See
`examples/hosted-direct-model-boundary-replay/replication-result-2026-10-06.md`.

## Scale the direct boundary to 24 semantic findings

The scaling scenario removes every deterministic owner hint from the original
24-finding corpus. All 24 findings cross the same semantic boundary while the
prompt, model, effort, strict schema, evaluator, and deterministic merge stay
fixed:

```powershell
node .\examples\hosted-direct-boundary-scaling-replay\run-hosted-direct-boundary-scaling-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-boundary-scale-24-v1" `
  --samples 3
```

See `examples/hosted-direct-boundary-scaling-replay/README.md` for the frozen
workload, treatment contract, and private-provider boundary.

The first three-sample result preserved exact quality while reducing
input-token p50 by 68.15%, API-time p50 by 46.87%, and wall-time p90 by
80.57%. The absolute input gap remained 1,838 tokens after tripling the
semantic residual. See
`examples/hosted-direct-boundary-scaling-replay/measured-result-2026-10-06.md`.

## Scale the direct boundary to 64 semantic findings

The 64-finding scenario preserves the first 24 cases and adds 40 distinct
findings with balanced owner and severity distributions:

```powershell
node .\examples\hosted-direct-boundary-scaling-64-replay\run-hosted-direct-boundary-scaling-64-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-boundary-scale-64-v2" `
  --samples 3
```

See `examples/hosted-direct-boundary-scaling-64-replay/README.md` for the
frozen workload and treatment contract. The first v1 cohort was rejected after
one direct sample misrouted an ambiguous legal-hold finding; its counterevidence
is preserved in
`examples/hosted-direct-boundary-scaling-64-replay/measured-result-2026-10-06.md`.

The clarified v2 cohort restored exact quality but returned `revise`:
input-token p50 fell 47.89% and wall-time p90 fell 74.08%, while output-token
p50 rose 7.22%. See
`examples/hosted-direct-boundary-scaling-64-replay/revised-result-2026-10-06.md`.

## Compress owner encoding at 64 findings

The owner-code scenario stays entirely on the direct provider. It replaces
the repeated full owner names with one-character codes and decodes them
deterministically before the final merge:

```powershell
node .\examples\hosted-direct-owner-code-replay\run-hosted-direct-owner-code-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-owner-code-v1" `
  --samples 3
```

See `examples/hosted-direct-owner-code-replay/README.md` for the frozen
treatment and quality contract.

## Isolate strict structured output

The schema scenario stays entirely inside the direct boundary. It compares the
strict route schema with the identical prompt and payload using no
`text.format`:

```powershell
node .\examples\hosted-direct-schema-replay\run-hosted-direct-schema-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-schema-v1" `
  --samples 3
```

See `examples/hosted-direct-schema-replay/README.md` for the frozen treatment
and private-provider boundary.

The first three-sample result preserved exact quality but returned `revise`:
prompt-only output reduced input-token p50 20% while increasing output-token
p50 3.47% and reasoning-token p50 50%. See
`examples/hosted-direct-schema-replay/measured-result-2026-10-06.md`.

## Test lightweight JSON-object mode

The JSON-mode scenario keeps the direct provider path fixed and replaces the
full route schema with JSON syntax enforcement only:

```powershell
node .\examples\hosted-direct-json-mode-replay\run-hosted-direct-json-mode-replay.mjs `
  --provider-config "$HOME\.copilot\pace-direct-provider.private.json" `
  --out "$HOME\.copilot\pace-runs\hosted-direct-json-mode-v1" `
  --samples 3
```

See `examples/hosted-direct-json-mode-replay/README.md` for the frozen
treatment and private-provider boundary.

The first three-sample result preserved exact quality but returned `revise`:
JSON-object mode reduced input-token p50 20% while increasing output-token p50
3.41% and wall-time p90 22.48%. See
`examples/hosted-direct-json-mode-replay/measured-result-2026-10-06.md`.

## Analyze context snapshots

`analyze-context-snapshots.mjs` compares final session context composition
without treating snapshot counters as additive usage:

```json
{
  "schema_version": "0.1",
  "analysis_id": "residual-context-v1",
  "source": {
    "replay_receipt": "sha256:1111111111111111",
    "comparison_receipt": "sha256:2222222222222222",
    "experiment_source_commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "analysis_source_commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "cohorts": {
    "baseline": [
      {
        "id": "baseline-1",
        "artifact": "../sessions/baseline-1",
        "declared_runtime_version": "1.0.88"
      }
    ],
    "candidate": [
      {
        "id": "candidate-1",
        "artifact": "../sessions/candidate-1",
        "declared_runtime_version": "1.0.88"
      }
    ]
  }
}
```

```powershell
node .\analyze-context-snapshots.mjs .\context-analysis.json `
  --out .\pace-output
```

The analysis binds each raw `events.jsonl` artifact by SHA-256 and reports
system, conversation, tool-definition, classified, unclassified, request, tool
invocation, cache, usage, and latency distributions.

See
`examples/hosted-residual-overhead-replay/context-analysis-2026-10-05.md` for
the v0.4 residual cohort decomposition.

## Compare repeated run sets

First freeze the workload, source revision, configuration files, expected
runtime signatures, and cohort membership. File hashes are full SHA-256 values
computed before the replay:

```json
{
  "schema_version": "0.1",
  "replay_id": "experiment-replay-001",
  "evaluator": {
    "id": "evaluator-v1",
    "files": [
      {
        "id": "evaluator",
        "path": "./evaluate.mjs",
        "sha256": "sha256:<64 hex>"
      }
    ]
  },
  "workload": {
    "corpus_id": "corpus-v1",
    "source_revision": "source-revision-v1",
    "files": [
      {
        "id": "corpus",
        "path": "./corpus.json",
        "sha256": "sha256:<64 hex>"
      }
    ]
  },
  "cohorts": {
    "baseline": {
      "configuration": {
        "id": "baseline-config-v1",
        "files": [
          {
            "id": "configuration",
            "path": "./baseline-config.json",
            "sha256": "sha256:<64 hex>"
          }
        ],
        "expected_runtime": [
          {
            "name": "github-copilot-cli",
            "version": "1.0.87-0",
            "producer": "copilot-cli",
            "selected_model": "model-id",
            "context_tier": "default",
            "reasoning_efforts": [
              "medium"
            ],
            "models": [
              "model-id"
            ]
          }
        ]
      },
      "profiles": [
        "./baseline-1.run-profile.json",
        "./baseline-2.run-profile.json"
      ]
    },
    "candidate": {
      "configuration": {
        "id": "candidate-config-v1",
        "files": [
          {
            "id": "configuration",
            "path": "./candidate-config.json",
            "sha256": "sha256:<64 hex>"
          }
        ],
        "expected_runtime": [
          {
            "name": "github-copilot-cli",
            "version": "1.0.87-0",
            "producer": "copilot-cli",
            "selected_model": "model-id",
            "context_tier": "default",
            "reasoning_efforts": [
              "medium"
            ],
            "models": [
              "model-id"
            ]
          }
        ]
      },
      "profiles": [
        "./candidate-1.run-profile.json",
        "./candidate-2.run-profile.json"
      ]
    }
  }
}
```

Validate it and write a privacy-safe receipt:

```powershell
node .\build-replay-manifest.mjs .\replay.json `
  --out .\pace-output
```

The replay fails if workload, evaluator, or configuration contents drift; a
contributing runtime does not match its cohort; sample counts differ; or
profile/session evidence is reused. Paths and file contents are never emitted.

Repeated comparisons then require one quality record bound to every replay run:

```json
{
  "schema_version": "0.1",
  "baseline": [
    {
      "run_id": "sha256:1111111111111111",
      "run_profile_sha256": "sha256:<64 hex>",
      "corpus_id": "corpus-v1",
      "evaluator_id": "evaluator-v1",
      "complete": true,
      "passed": true,
      "score": 1
    },
    {
      "run_id": "sha256:3333333333333333",
      "run_profile_sha256": "sha256:<64 hex>",
      "corpus_id": "corpus-v1",
      "evaluator_id": "evaluator-v1",
      "complete": true,
      "passed": true,
      "score": 1
    }
  ],
  "candidate": [
    {
      "run_id": "sha256:2222222222222222",
      "run_profile_sha256": "sha256:<64 hex>",
      "corpus_id": "corpus-v1",
      "evaluator_id": "evaluator-v1",
      "complete": true,
      "passed": true,
      "score": 1
    },
    {
      "run_id": "sha256:4444444444444444",
      "run_profile_sha256": "sha256:<64 hex>",
      "corpus_id": "corpus-v1",
      "evaluator_id": "evaluator-v1",
      "complete": true,
      "passed": true,
      "score": 1
    }
  ],
  "regressions": [],
  "lost_findings": []
}
```

The comparison manifest uses the replay as its only cohort source and selects
the statistic used by each decision metric:

```json
{
  "schema_version": "0.1",
  "comparison_id": "experiment-repeated-001",
  "replay_manifest": "./replay.json",
  "quality_result": "./quality-repeated.json",
  "decision_metrics": [
    {
      "metric": "ai_units",
      "statistic": "p50",
      "goal": "decrease"
    },
    {
      "metric": "wall_time_ms",
      "statistic": "p90",
      "goal": "not_increase"
    }
  ]
}
```

Run:

```powershell
node .\compare-run-sets.mjs .\comparison-repeated.json `
  --out .\pace-output
```

Pace reports count, min, max, mean, p50, and p90 using linear interpolation at
`(sample_count - 1) * percentile`. If one selected sample is incomplete, the
final distribution is `null`; Pace retains the complete-sample distribution
and per-run known subtotal without silently dropping the missing run.
The comparison revalidates the replay and rejects quality evidence whose corpus
or evaluator identity does not match it, or whose run-profile SHA-256 does not
match the exact measured artifact.
Repeated-run output is descriptive only and does not claim confidence,
significance, or an implicit tolerance.

## Validate

```powershell
npm test
```

The tests use synthetic artifacts only.

## Current boundary

This slice profiles individual Copilot CLI sessions, explicitly declared run
sets, hash-bound deterministic JSON runs, composite hybrid runs, and
baseline/candidate pairs with an external same-evaluator quality result. It
also compares equal-size repeated run sets with descriptive distribution
statistics bound to frozen replay receipts. It does not infer undeclared
cross-session relationships, provide OS-level isolation for deterministic
transforms, classify model/tool stages automatically, calculate confidence
intervals or statistical significance, apply noise tolerances, analyze
scaling, or monitor drift. Structural model/tool stages intentionally remain
`unknown` until a human classifies them.
