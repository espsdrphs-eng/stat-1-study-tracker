# Study Tracker system invariants

This document is the implementation-level source of truth for data integrity. Learning policy remains defined by
`STABLE_LEARNING_SPEC.md`; these invariants describe how that policy is persisted and executed.

## Problem mastery projection

- `skeleton` / `check` / `main_calc` / `full` are exercise modes, Review purpose/stage is lifecycle, and Level 1/2/3 is the user-facing mastery projection. They are not interchangeable.
- Level 1 is skeleton retention, Level 2 is main-calculation completion, and Level 3 is transfer on another problem or condition.
- Score and mark grade only the immutable GradingContract scope. A major error observed in an actually written out-of-scope portion never lowers that in-scope score.
- Out-of-scope observations are evidence candidates. Only app-validated `major` + `high` confidence candidates may receive a new stable target root. Minor, self-corrected, stylistic, speculative, or duplicate observations never become active targets.
- A retained lower level is not rolled back when a higher-level target is discovered. A Level 1 collapse may make higher levels `needs_recheck`, but historical evidence is never deleted.
- A delayed check updates only targets present in its contract. Successful targets remain retained; failed targets alone return to repair.
- Same-problem normal Review ends when every current target has passed delayed retention and no normal pending Review remains. Level 3 being unconfirmed never keeps the source problem in a same-problem Review loop.
- Problem, Review, and coach views consume the same pure mastery projection derived from Attempt evidence, stable targets, Review lifecycle, retention, and transfer evidence.

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
- GPT import preview, Attempt persistence, Review completion, and reload reconciliation use the same canonical
  lifecycle projection. `assessment_timing` records when evidence was collected and never promotes an
  `error_repair` execution into graduation; only the persisted Review phase can make retrieval graduation eligible.
- A saved Today task's historical `checked` copy is not current execution evidence. Current completion comes from an
  explicit completion record or a qualifying Attempt after the snapshot; Dashboard NEXT ACTION consumes that projection.
- Today, Dashboard NEXT ACTION, time totals, and integrity status consume one current projection. For normal tasks,
  completion means execution rather than mastery: `skeleton` accepts `skeleton`/`main_calc`/`full`, `main_calc` accepts
  `main_calc`/`full`, and `full` accepts `full`; a low score may create a separate Review without reopening the plan slot.
- A start-of-day snapshot records the morning plan, not current eligibility. Current Today overlays the latest Attempts
  and active Reviews, adds newly due formal Reviews, replaces terminal Review generations by their current logical
  generation, and never mutates the stored snapshot.
- Review IDs and `contractId` values identify persisted generations, not the logical learning task. Attempt deletion may
  leave a completed generation as history and create a new pending generation for the same logical Review.
- A GPT result for a terminal generation may be rebound only after an explicit preview and only when problem, logical
  Review key, contract hash, source lineage, stable target set, scope, and reference policy are identical and no newer
  grading evidence changed the semantics. Otherwise current-prompt regeneration is mandatory.
- The active `GradingContractSnapshot` is the only source for purpose, mode, scope, sheet, minutes, and graded parts.
- Diagnostic, preview, repair, and post-repair verification use the same `runIntegrityAudit` classifier.
- Rebuild and repair operations are idempotent and do not create a new Review when an active logical key exists.
- An exact duplicate Attempt remains as history, is linked to its canonical Attempt, and does not generate new planning or metrics.
- A successful newer Attempt supersedes only older pending repair/retrieval Reviews for the same covered graded parts.
- Current unresolved targets are reconstructed per stable target identity from the newest evidence that actually graded
  that target. The identity comes from a known grading slot or explicit Review lineage, never an Attempt ID, fuzzy text,
  or error-type similarity. A newer targeted Attempt never resolves omitted targets by implication.
- A persisted dynamic stable target uses `target:<problemId>:root:<opaque UUID>`. Its value contains no Review,
  Attempt, submission, or Attempt-specific graded-part identity. `target:<problemId>:review:...`, `:attempt:...`, and
  `:submission:...` are legacy-invalid keys: they are audit evidence only and never lineage anchors.
- An existing target inherits the exact same root through Review -> Attempt -> successor Review for every generation.
  A new root may be issued only for a genuinely new target and only at the persistence boundary; pure audit, resolver,
  prompt, and render paths never issue roots.
- An active error repair contains at most one item per stable target identity. Attempt-specific graded-part IDs remain
  immutable history. Explicit lineage components without a valid root are backfilled into the current contract with one
  opaque root only after preview and explicit safe repair; ambiguous components are not merged.
- Stable target identity is immutable, but its current payload is not. The current label, evidence, error type, correction,
  source Attempt, and evidence timestamp come from the newest eligible finding that explicitly graded that root. A resolved
  finding removes the root; an omitted root retains its previous payload. Ancestor Review prose is never reused as current text.
- Current UI summaries are derived from the active contract payload. “Only” is valid for exactly one unresolved target;
  capped action lists disclose the omitted count, and completion criteria state the same target cardinality.
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
- Coach diagnoses are an append-only interpretation layer stored separately from Attempt, Review, problem master,
  and concept evidence facts. A diagnosis records its Attempt cutoff; newer eligible Attempts make it visibly stale
  until an explicit GPT review is previewed and confirmed. Coach output never schedules or rewrites a Today Plan.

Any code path that writes Attempts or Reviews must preserve these invariants. A new one-off repair must not be added
when the condition belongs in `runIntegrityAudit` and the unified repair transaction.
