# Stable review-origin and scan5 specification

This document extends `STABLE_LEARNING_SPEC.md`. It is normative, and implementations must use the shared resolvers instead of recreating these rules in UI components.

## Review origin

- `direct_attempt` and `past_exam_attempt` require the canonical source Attempt problem ID to equal the canonical target ID.
- A different source and target require a confirmed or verified `prerequisite`, `remediation`, or `extension` relation. Chapter, theme similarity, legacy K, and unconfirmed GPT suggestions are insufficient.
- `integration_schedule` stays on the same problem. `transfer_schedule` needs a verified relation or verified problem type.
- Source Attempts are provenance only for linked work. They never become the target problem's previous Attempt, errors, or derived guidance.
- Mismatched pending plans are superseded, never rebound. A replacement may only be built independently from the target's own valid Attempt or from a verified relation's `targetFocus`.
- Repair is idempotent and does not change completed records or `todayPlanSnapshot`.

The single source of truth is `reviewOrigin.ts` (`resolveReviewOrigin` and `analyzeSourceMismatchRepair`).

## Past-exam and scan5 workflow

`pastSessions` stores four distinct session kinds:

- `scan_only`: scan evidence only; no Attempt, K/W/N/C, ReviewPlan, or exam score.
- `scan_plus_one`: scan evidence plus at most one solved problem. Only that problem can enter the normal Attempt/review path.
- `selected_three_timed`: five scanned, exactly three selected and solved. Exam scoring is eligible only with three scored answers, no hint/reference/answer exposure, and a recorded 90-minute condition.
- `retrospective_review`: analysis only; no new Attempt or exam score.

`STAT1-SCAN5-v1` is the only grading rubric for scan analysis. It does not output K/W/N/C and stores its result on the PastSession, not as a normal Review.

Selection success is `null` unless all five problems have comparable evidence or an explicit eligible optimal-three evaluation with its basis. Unanswered scores and unmeasured rates remain `null`, never zero.

Exposure is derived from timestamps/events (`promptScannedAt`, attempt start/completion, answer view, simulation completion). Unknown history remains `unknown`; it is not treated as unseen. With at least 61 days remaining, the newest two unknown/unseen registered years are protected from automatic recommendation.

Time aggregation is exclusive:

- scan only = scan minutes;
- scan plus one = scan minutes + linked Attempt minutes once;
- selected three timed = session total only;
- retrospective review = review minutes.

Scan5 is a weekly soft-quota candidate, not an overdue K/W/N/C ReviewPlan. It never regenerates `todayPlanSnapshot` and never creates more than one optional problem-specific review candidate.

The single source of truth is `pastExamWorkflow.ts`. UI, diagnostics, readiness metrics, and scheduling consume its pure functions.
