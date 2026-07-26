# Study Tracker system invariants

This document is the implementation-level source of truth for data integrity. Learning policy remains defined by
`STABLE_LEARNING_SPEC.md`; these invariants describe how that policy is persisted and executed.

- One answer submission creates at most one Attempt. `submission_id` is the idempotency key.
- One logical review task has at most one active Review.
- `contractId` identifies one persisted Review execution and is unique among active Reviews.
- `contractHash` identifies contract content. Equal content may legitimately have different `contractId` values.
- Done, superseded, invalid, cancelled, ignored, and expired same-session Reviews are never actionable.
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

Any code path that writes Attempts or Reviews must preserve these invariants. A new one-off repair must not be added
when the condition belongs in `runIntegrityAudit` and the unified repair transaction.
