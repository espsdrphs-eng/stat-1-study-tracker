# Study Tracker system invariants

This document is the implementation-level source of truth for data integrity. Learning policy remains defined by
`STABLE_LEARNING_SPEC.md`; these invariants describe how that policy is persisted and executed.

- Verified core past-exam records are hydrated idempotently into both new and existing local databases.
- The active past-exam catalog contains only schedulable `verified_problem` records; metadata-only and no-exam years never enter study selection.
- Reference-pack hydration never deletes or rewrites Attempt, Review, pastSession, exposure, or todayPlanSnapshot history.
- Reapplying the same pack does not create duplicate problem records.
- UI year lists and planner candidates come from the active normalized catalog, not a fixed year array.
- Shadow suggestions never mutate the current Today Plan. An additional candidate enters the current snapshot only
  after an explicit user action, and its candidate key is idempotent.
- Review portfolio totals, due buckets, transition counts, and duplicate warnings use the same
  `reviewExecutionState` and logical Review identity used by integrity diagnostics.
- Phase diagnostics and shadow simulations are pure reads: they do not change the observation start date,
  Review dates, exposure state, or any todayPlanSnapshot.
- One answer submission creates at most one Attempt. `submission_id` is the idempotency key.
- One logical review task has at most one active Review.
- `contractId` identifies one persisted Review execution and is unique among active Reviews.
- `contractHash` identifies contract content. Equal content may legitimately have different `contractId` values.
- Done, superseded, invalid, cancelled, ignored, and expired same-session Reviews are never actionable.
- `reviewExecutionState` is the single current-state classifier. Problem detail, Today Plan, GPT import,
  review counts, and remaining-time calculations must use it; array order or due date alone never selects a current Review.
- Problem-level current selection returns every actionable Review with a distinct learning purpose. Terminal Reviews
  remain immutable history and never expose sheets, completion controls, reference controls, prompts, or save actions.
- Same-session corrections are actionable only on their local calendar date.
- Policy schedules persist `sourceDate`, `reviewAfterDays`, `reviewDate`, `scheduleOrigin`, and `policyVersion` together.
- A manual schedule is preserved and is not diagnosed as a policy date mismatch.
- Today Plan snapshots are immutable history. The UI rechecks the current Review before enabling an action.
- The active `GradingContractSnapshot` is the only source for purpose, mode, scope, sheet, minutes, and graded parts.
- Diagnostic, preview, repair, and post-repair verification use the same `runIntegrityAudit` classifier.
- Rebuild and repair operations are idempotent and do not create a new Review when an active logical key exists.
- An exact duplicate Attempt remains as history, is linked to its canonical Attempt, and does not generate new planning or metrics.
- A successful newer Attempt supersedes only older pending repair/retrieval Reviews for the same covered graded parts.
- Attempt insertion, source Review completion, stale Review supersession, next Review upsert, and correction logging are one transaction.
- SCAN5/past-session rules and the K/W/N/C learning policy are outside integrity repair and are not rewritten by it.
- Importing the normalized exam reference pack is idempotent by pack SHA-256 and never mutates Attempts,
  Reviews, past sessions, or Today Plan snapshots.
- Concept weakness and adaptive plans are derived, read-only views. Shadow planning never becomes the current
  plan or rewrites a snapshot without a separate explicit activation flow.

Any code path that writes Attempts or Reviews must preserve these invariants. A new one-off repair must not be added
when the condition belongs in `runIntegrityAudit` and the unified repair transaction.
