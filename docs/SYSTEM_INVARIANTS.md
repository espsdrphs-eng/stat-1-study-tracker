# Study Tracker system invariants

This document is the implementation-level source of truth for data integrity. Learning policy remains defined by
`STABLE_LEARNING_SPEC.md`; these invariants describe how that policy is persisted and executed.

- Verified core past-exam records are hydrated idempotently into both new and existing local databases.
- The active past-exam catalog contains only schedulable `verified_problem` records; metadata-only and no-exam years never enter study selection.
- Reference-pack hydration never deletes or rewrites Attempt, Review, pastSession, exposure, or todayPlanSnapshot history.
- Reapplying the same pack does not create duplicate problem records.
- The verified 2016-2018 supplement upgrades exactly 15 existing canonical catalog rows, starts them at unknown
  exposure, and never changes saved exposure or learning history.
- UI year lists and planner candidates come from the active normalized catalog, not a fixed year array.
- Adaptive suggestions never mutate the current Today Plan. An additional candidate enters the current snapshot only
  after an explicit user action, and its candidate key is idempotent.
- Review portfolio totals, due buckets, transition counts, and duplicate warnings use the same
  `reviewExecutionState` and logical Review identity used by integrity diagnostics.
- Phase diagnostics and planner simulations are pure reads: they do not change
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
- Current unresolved targets are reconstructed per stable target identity from the newest evidence that actually graded
  that target. The identity comes from a known grading slot or explicit Review lineage, never an Attempt ID, fuzzy text,
  or error-type similarity. A newer targeted Attempt never resolves omitted targets by implication.
- An active error repair contains at most one item per stable target identity. Attempt-specific graded-part IDs remain
  immutable history and may be backfilled only into the current contract through deterministic lineage.
- A partially stale repair is kept as immutable history and replaced by one Review containing only still-unassessed or
  currently unresolved parts. Old action prose and derived fields are not copied into the replacement.
- Reconciliation runs after Attempt save/import/edit/delete and Review completion. It is idempotent and keeps at most
  one active error-repair state per problem; identical input cannot grow Review rows.
- `scan_only` is not mathematical graded evidence. Past-exam full/timed Attempts use the same part-level reconciliation
  as whitebook Attempts without weakening simulation protection.
- A saved Today Plan keeps its problem slot, order, triage, and initial minutes. Its purpose, graded parts, and action
  text are a read-only overlay from the current active Review; the stored snapshot is not rewritten.
- A Review contradicted or superseded by newer graded evidence cannot reveal references, create a grading prompt,
  complete, or save an Attempt. Current evidence is checked again immediately before each operation.
- A retrieval Review graduates without a successor only after deterministic delayed, no-reference, no-hint,
  all-parts-resolved evidence. Historical marks are not rewritten and same-session success never graduates.
- Mark is an app-owned learning-state result, independent of score bands: repair success is `○`, while only an
  objectively successful delayed retrieval is `◎`. Prompt examples never prefill outcome-like values.
- A clean past-exam full/timed performance does not create a recurring same-problem Review. SCAN5 remains outside
  Attempt, mathematical error, mastery, and graduation transitions.
- Attempt insertion, source Review completion, stale Review supersession, next Review upsert, and correction logging are one transaction.
- SCAN5/past-session rules and the K/W/N/C learning policy are outside integrity repair and are not rewritten by it.
- Importing the normalized exam reference pack is idempotent by pack SHA-256 and never mutates Attempts,
  Reviews, past sessions, or Today Plan snapshots.
- New daily snapshots use the adaptive planner as the sole normal generation source. A pre-existing current-day
  snapshot is preserved across an app update. Same-day activation requires a preview and explicit confirmation.
- Planner rollback affects future snapshot generation only; it never rewinds data or saved snapshots.
- Confirmed plan time, completed time, confirmed remaining time, target remaining time, additional capacity,
  and postponed time are calculated by the shared Today time summary.
- Formal planner diagnostics declare `adaptive` as their source; legacy comparisons never contribute to formal
  plan counts, phase quotas, or diagnostic-pack planner totals.

Any code path that writes Attempts or Reviews must preserve these invariants. A new one-off repair must not be added
when the condition belongs in `runIntegrityAudit` and the unified repair transaction.
