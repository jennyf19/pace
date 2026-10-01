# Pace accounting invariants

These rules are part of the measurement contract, not report formatting.

## Session snapshots

1. **The latest `session.shutdown` snapshot wins.** Shutdown snapshots can recur
   after a session resumes. They are never summed.
2. **Earlier snapshots are retained only as lifecycle evidence.** Some metrics
   are cumulative, but observed AI-unit and API-duration values are not
   guaranteed to increase monotonically across every resume.
3. **A shutdown snapshot is final only when no later activity exists.** If the
   session resumes or emits later work without another shutdown, additive totals
   become `null`; the last snapshot remains available only as a known subtotal.
4. **A live or interrupted session falls back to model-call receipts.** The
   report must say that shutdown totals are absent.

## Attribution

1. **Top-level session totals are counted once.**
2. **Model and agent metrics are attribution views of those totals.** They are
   not additional usage.
3. **Tool duration is another view.** Tool, agent, and model rows can overlap in
   time and must not be added across kinds.
4. **Every attribution view is reconciled against the top-level total.** A
   residual remains explicit; it is never forced to zero or silently assigned.
5. **Subagent metrics embedded in the parent shutdown are already included.**
   Exporting the same subagent as another artifact does not make it independently
   billable.

## Time

1. **A continuously observed session can report active wall time.**
2. **A resumed session reports elapsed span, not active wall time.** Resume
   events do not provide reliable pause intervals, so active wall time is
   `null`.
3. **A run set reports end-to-end span.** It uses the earliest contributing
   start and latest contributing end; it never sums session durations.

## Run manifests

Each session declares one billing role:

- `independent`: contributes once to run totals;
- `included`: remains visible but contributes zero because another independent
  session already contains its usage.

An included session must identify its independent owner with `included_in`.
Duplicate artifact paths and duplicate profiled session IDs fail validation.

## Missing data

1. **Missing is `null`, never zero.**
2. **Additive run metrics fail closed.** If any contributing independent session
   lacks a metric, the aggregate value is `null`; Pace reports the known
   subtotal and the sessions that are missing data.
3. **Coverage follows the weakest contributing session.** A run cannot claim a
   higher evidence level than its least-observed independent component.

## Deterministic execution

1. **Zero requires an explicit execution contract.** Missing provider telemetry
   is `null`; it never becomes zero. A deterministic run can report zero model
   calls, tokens, AI units, API time, and premium requests only when its
   zero-usage contract is complete.
2. **The runner and implementation are hash-bound.** The receipt includes the
   Pace runner, every declared implementation file, and exact input/output byte
   hashes. Implementation hashes are verified before and after execution.
3. **The transform is synchronous.** Promise-returning transforms fail rather
   than widening the contract to unobserved asynchronous work.
4. **The proof boundary stays explicit.** The receipt is an auditable contract
   over the hash-bound runner and declared transform. It is not an OS sandbox,
   network monitor, or supply-chain attestation.
5. **Deterministic receipts are L3 stage evidence.** They include explicit
   execution timing and a deterministic stage. Mixed model/deterministic
   comparisons still use the weakest cohort evidence level.

## Composite runs

1. **Each component run contributes once.** Composite totals sum top-level
   component totals; nested sessions remain evidence and attribution views.
2. **Contributing evidence is unique across components.** Duplicate profile
   paths, run IDs, or nested session evidence fail validation.
3. **Wall time is end to end.** A composite uses the earliest contributing
   component-session start and latest contributing component-session end rather
   than summing component durations.
4. **Missing component metrics fail closed.** A composite metric is `null` when
   any component is incomplete. Known component subtotals remain visible.
5. **Runtime matching sees every component.** Replay configuration must declare
   the complete unique runtime set observed across deterministic and model
   sessions.

## Comparisons

1. **Baseline and candidate identities are bound to their quality evidence.**
   Quality run IDs and full run-profile SHA-256 values must match the emitted
   profiles. Corpus and evaluator identities must match across both sides or
   the comparison is invalid.
2. **Decision metrics are explicit.** Pace reports every supported metric but
   evaluates disposition only against the metrics and goals declared in the
   comparison manifest.
3. **Selected missing data fails closed.** A decision metric with incomplete
   coverage on either side makes the result `unproven`. Known subtotals remain
   visible but are not compared as final totals.
4. **Selected attribution residuals fail closed.** A non-zero model or agent
   attribution residual on a decision metric makes the result `unproven`.
   Residuals on other metrics remain visible without widening the claim.
5. **Quality is external and same-evaluator.** Incomplete quality evidence makes
   the result `unproven`. A known regression, failed candidate, or lost finding
   makes the result `reject`.
6. **`keep` requires a measured win.** Every declared goal must pass and at
   least one decision metric must improve strictly. A complete comparison with
   no strict improvement or a missed performance goal returns `revise`.
7. **Zero baselines do not produce percentages.** When a complete baseline is
   zero and the candidate is non-zero, the absolute delta remains valid but
   percentage change is `null` with a `zero_baseline` status.
8. **Single-run goals are exact.** Version 0.1 applies no implicit noise
   tolerance and makes no statistical-confidence claim. Tolerance policy must
   follow repeated-run evidence rather than masking variance with an arbitrary
   threshold.

## Repeated-run comparisons

1. **Both sides retain the same sample count.** Version 0.1 requires at least
   two baseline and two candidate run profiles with equal counts. Duplicate
   paths, duplicate run IDs, and duplicate contributing session evidence fail
   validation; relabeling one artifact cannot create another sample.
2. **Every sample is quality-bound.** Each run profile must have exactly one
   quality entry with its exact file SHA-256, and all entries must share one
   corpus and evaluator identity.
3. **Missing samples are never dropped.** If any run lacks a selected metric,
   the final distribution and selected statistic are `null`. Pace preserves the
   complete-sample distribution, the incomplete run identity, and its known
   subtotal separately.
4. **Percentiles are deterministic.** p50 and p90 use linear interpolation at
   `(sample_count - 1) * percentile`; reports also include count, min, max, and
   mean.
5. **Decision statistics are explicit.** Each decision metric selects `min`,
   `max`, `mean`, `p50`, or `p90` plus a directional goal.
6. **Selected residuals still fail closed.** A non-zero attribution residual on
   a decision metric in any sample makes the repeated comparison `unproven`.
7. **Distributions are descriptive.** Version 0.1 makes no confidence-interval,
   significance, or implicit-tolerance claim.

## Replay manifests

1. **Workload, evaluator, and configuration hashes are predeclared.** Every
   referenced file carries a full SHA-256 digest. Current contents must match
   before a replay receipt or repeated comparison can be produced.
2. **Source revision is explicit.** The manifest binds an exact source revision
   string into the workload receipt rather than relying on the current
   checkout.
3. **Runtime signatures are exact.** Every contributing session must match its
   cohort's frozen set of runtime name, runtime version, producer, and selected
   model values, context tier, observed reasoning efforts, and complete
   observed model set. A hidden fallback model or inherited context/reasoning
   change is configuration drift.
4. **Cohort membership is singular.** Paths, top-level run IDs, and
   contributing session evidence must be unique across both cohorts.
5. **Quality identity follows the replay.** Repeated quality results must match
   the replay's corpus and evaluator identities in addition to binding every
   run ID.
6. **Receipts are privacy-safe.** Paths, file contents, and raw configuration
   values are excluded. Reports retain content hashes, binding hashes, runtime
   fingerprints, and protected identifiers.
