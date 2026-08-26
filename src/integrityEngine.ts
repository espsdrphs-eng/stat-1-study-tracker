import type { AdditionalStudyCandidate, AdaptivePlanSummary, Attempt, ExamReferenceCatalogItem, GradingContractSnapshot, Problem, ProblemAlias, Review, StudyUpdate, Task, TodayPlanSnapshot } from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { addCalendarDays, resolveReviewSchedule } from "./reviewSchedulePolicy.ts";
import { validateGradingContract } from "./gradingContract.ts";
import { analyzeReviewReconciliation, type ReconciliationAudit } from "./reviewReconciliation.ts";
import {buildStableTargetIndex,isValidStableTargetKey} from "./stableTargetIdentity.ts";
import {currentTargetDisplay,currentTargetLabels} from "./currentTargetPayload.ts";
import {projectTodayTaskChecked,selectNextCurrentTodayTask} from "./todayTaskProjection.ts";
import {buildReviewGradingPrompt} from "./gradingPrompt.ts";
import {currentActionFingerprint,examHorizonPolicy,isSuccessfulTransferForProblem} from "./examOptimizationPolicy.ts";
import {daysUntilExam} from "./studyProgress.ts";
import {resolvePersistedAttemptLifecycle} from "./reviewTransition.ts";
import {canonicalAttemptId,logicalReviewKey,reviewExecutionMessage,reviewExecutionState,type ReviewExecutionState} from "./reviewCurrentState.ts";
import {resolveSemanticReviewGeneration} from "./reviewGeneration.ts";
import {WHOLE_ANSWER_DIAGNOSTIC_VERSION,wholeAnswerDiagnosticIssues} from "./wholeAnswerDiagnostic.ts";

export const ACTIVE_REVIEW_STATUSES = new Set(["pending", "overdue"]);

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, row]) => `${JSON.stringify(key)}:${stable(row)}`).join(",")}}`;
}

function hash(value: string) {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

const ATTEMPT_FINGERPRINT_IGNORED = new Set([
  "id", "saved_at", "canonical_attempt_id", "duplicate_of_attempt_id",
  "exclude_from_planning", "exclude_from_metrics", "duplicate_reason",
]);

export function attemptFingerprint(attempt: Partial<Attempt>) {
  const payload = Object.fromEntries(Object.entries(attempt)
    .filter(([key]) => !ATTEMPT_FINGERPRINT_IGNORED.has(key)));
  return `attempt:${hash(stable(payload))}`;
}

export function classifyExactDuplicateAttempts(attempts: Attempt[]) {
  const groups = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const fingerprint = attemptFingerprint(attempt);
    groups.set(fingerprint, [...(groups.get(fingerprint) || []), attempt]);
  }
  return [...groups.entries()].flatMap(([fingerprint, rows]) => {
    if (rows.length < 2) return [];
    const ordered = [...rows].sort((a, b) => a.id - b.id);
    return ordered.slice(1).map((duplicate) => ({
      fingerprint,
      canonicalAttemptId: ordered[0].id,
      duplicateAttemptId: duplicate.id,
    }));
  });
}

export {canonicalAttemptId,logicalReviewKey,reviewExecutionMessage,reviewExecutionState};
export type {ReviewExecutionState};

export function contractIdForReview(reviewId: number, revision = 1) {
  return `review:${reviewId}:${revision}`;
}

export function bindContractToReview(
  contract: GradingContractSnapshot,
  reviewId: number,
  revision = 1,
): GradingContractSnapshot {
  return { ...contract, reviewId, sourceReviewId: reviewId, contractId: contractIdForReview(reviewId, revision) };
}

const PURPOSE_ORDER = ["error_repair", "retrieval_check", "integration_check", "transfer_check", "exam_performance"];
const purposeRank=(review:Review)=>{
  const index=PURPOSE_ORDER.indexOf(String(review.grading_contract?.learningPurpose||review.learning_purpose||""));
  return index<0?PURPOSE_ORDER.length:index;
};

export type CurrentProblemReviews = {
  canonicalProblemId: string;
  current: Review[];
  history: Array<{ review: Review; state: Exclude<ReviewExecutionState, "actionable"> }>;
};

/**
 * Problem detail, today plan, import validation and counts must all select Reviews
 * through this lifecycle classification. Array position and due date never make an
 * inactive Review current.
 */
export function selectCurrentReviewsForProblem(args: {
  reviews: Review[];
  problemId: string;
  aliases?: ProblemAlias[];
  today: string;
}): CurrentProblemReviews {
  const aliases = args.aliases || [];
  const canonicalProblemId = resolveCanonicalProblemId(args.problemId, aliases);
  const matching = args.reviews.filter((review) =>
    resolveCanonicalProblemId(review.problem_id, aliases) === canonicalProblemId);
  const current = matching.filter((review) => reviewExecutionState(review, args.today) === "actionable")
    .sort((a, b) => a.due_date.localeCompare(b.due_date) ||
      purposeRank(a)-purposeRank(b) ||
      a.id - b.id);
  const history = matching.flatMap((review) => {
    const state = reviewExecutionState(review, args.today);
    return state === "actionable" ? [] : [{ review, state }];
  }).sort((a, b) => b.review.due_date.localeCompare(a.review.due_date) || b.review.id - a.review.id);
  return { canonicalProblemId, current, history };
}

export type IntegrityCategory =
  | "orphan_reference" | "exact_duplicate_attempt" | "duplicate_logical_review"
  | "duplicate_contract_id" | "repeated_deduplication_key" | "inactive_pending"
  | "expired_same_session" | "date_interval_mismatch" | "source_target_mismatch"
  | "contract_top_level_mismatch" | "stale_today_snapshot" | "unstable_graded_part"
  | "stale_review_after_success" | "partially_stale_review" | "stale_delayed_check"
  | "graduated_but_pending" | "obsolete_today_action" | "duplicate_stable_target"
  | "stale_stable_target" | "current_review_target_mismatch" | "orphan_active_target"
  | "invalid_stable_target_key" | "duplicate_active_target_label"
  | "stale_target_payload" | "current_target_display_mismatch"
  | "today_task_completion_mismatch" | "inactive_review_current_task" | "today_next_action_mismatch"
  | "duplicate_problem_task" | "current_planner_eligibility_mismatch" | "review_window_violation"
  | "overdue_starvation" | "optional_extra_priority_violation" | "actionable_review_prompt_missing"
  | "graduated_mark_mismatch" | "graduated_but_rescheduled" | "lifecycle_status_mismatch"
  | "current_today_missing_active_review" | "current_today_stale_review"
  | "formal_plan_current_projection_mismatch" | "deleted_attempt_active_descendant"
  | "stale_contract_equivalent_replacement" | "current_action_identity_mismatch"
  | "past_exam_share_below_phase_target" | "whitebook_backlog_suppressing_past_exam"
  | "same_session_review_from_successful_out_of_scope_only" | "unnecessary_same_problem_review_after_transfer"
  | "attached_full_reference_downgraded_by_app_metadata" | "written_answer_region_unaccounted"
  | "readable_region_not_evaluated" | "material_uncertainty_not_surfaced"
  | "whole_scan_empty_with_material_uncertainty" | "same_root_duplicate_target"
  | "independent_major_finding_not_promoted" | "contract_confidence_used_as_whole_scan_confidence"
  | "rediagnosis_changed_original_score" | "rediagnosis_changed_original_mark"
  | "rediagnosis_duplicate_target" | "rediagnosis_duplicate_review" | "problem_specific_whole_scan_branch"
  | "eligible_past_exam_but_confirmation_scheduled" | "past_exam_candidate_false_negative"
  | "repeated_material_selection_confirmation" | "past_exam_share_counted_from_non_exam_task"
  | "current_plan_zero_past_exam_when_phase_requires" | "protected_past_exam_scheduled_without_release"
  | "single_problem_ninety_minute_session" | "past_exam_session_shape_mismatch" | "clean_scan_year_skipped"
  | "generic_whitebook_in_past_exam_main"
  | "coach_update_parse_failed" | "coach_update_schema_invalid" | "coach_diff_generated_from_invalid_update";

export type IntegrityIssue = {
  category: IntegrityCategory;
  severity: "active" | "history" | "informational";
  reviewIds?: number[];
  attemptIds?: number[];
  detail: string;
  repairable: boolean;
};

export type IntegrityAudit = {
  generatedAt: string;
  issues: IntegrityIssue[];
  counts: Record<IntegrityCategory, number>;
  activeIssueCount: number;
  historyWarningCount: number;
  informationalHistoryCount: number;
  reconciliation: ReconciliationAudit;
};

export function deriveSystemHealth(audit:Pick<IntegrityAudit,"generatedAt"|"issues"|"activeIssueCount"|"historyWarningCount"|"informationalHistoryCount">){
  const categories=(severity:IntegrityIssue["severity"])=>[...new Set(audit.issues.filter(issue=>issue.severity===severity).map(issue=>issue.category))];
  return {status:audit.activeIssueCount>0?"needs_attention" as const:"healthy" as const,
    generatedAt:audit.generatedAt,activeIssueCount:audit.activeIssueCount,historicalWarningCount:audit.historyWarningCount,
    informationalHistoryCount:audit.informationalHistoryCount,activeCategories:categories("active"),
    historicalCategories:categories("history"),informationalCategories:categories("informational")};
}

export function runIntegrityAudit(args: {
  attempts: Attempt[];
  reviews: Review[];
  problems?: Problem[];
  aliases?: ProblemAlias[];
  today: string;
  todayPlanSnapshots?: TodayPlanSnapshot[];
  validCrossTargetReviewIds?: number[];
  /** Current UI projection. Saved snapshots remain immutable history. */
  currentTodayTasks?: Task[];
  currentNextTask?:Task;
  currentPlanSummary?:AdaptivePlanSummary;
  additionalCandidates?:AdditionalStudyCandidate[];
  eligibleTodayTasks?:Task[];
  pendingImportUpdates?:StudyUpdate[];
  examDate?:string;
  pastExamCatalog?:ExamReferenceCatalogItem[];
}): IntegrityAudit {
  const { attempts, reviews, problems = [], aliases = [], today, todayPlanSnapshots = [], validCrossTargetReviewIds = [],
    currentTodayTasks, currentNextTask, currentPlanSummary, additionalCandidates=[],eligibleTodayTasks,pendingImportUpdates=[] } = args;
  const validCrossTarget=new Set(validCrossTargetReviewIds);
  const issues: IntegrityIssue[] = [];
  const attemptsById = new Map(attempts.map((row) => [row.id, row]));
  const reviewsById = new Map(reviews.map((row) => [row.id, row]));
  const active = reviews.filter((row) => ACTIVE_REVIEW_STATUSES.has(row.status));
  const reconciliation=analyzeReviewReconciliation({attempts,reviews,aliases,today,todayPlanSnapshots});
  const stableTargets=buildStableTargetIndex({attempts,reviews,aliases});
  const problemById=new Map(problems.map(problem=>[resolveCanonicalProblemId(problem.problem_id,aliases),problem]));

  for(const attempt of attempts.filter(row=>row.whole_answer_diagnostic_version===WHOLE_ANSWER_DIAGNOSTIC_VERSION)){
    const scan=attempt.whole_answer_scan,findings=attempt.observed_out_of_scope_findings||[],uncertainties=attempt.diagnostic_uncertainties||[];
    const hasFullProblem=scan?.attachments.some(row=>row.kind==="problem_statement"&&row.coverage==="full");
    const hasFullOfficial=scan?.attachments.some(row=>row.kind==="official_reference_answer"&&row.coverage==="full");
    if(hasFullProblem&&hasFullOfficial&&scan?.effective_reference_coverage!=="full")issues.push({
      category:"attached_full_reference_downgraded_by_app_metadata",severity:"active",attemptIds:[attempt.id],
      detail:`Attempt ${attempt.id} has complete attached reference but effective coverage is not full`,repairable:true});
    for(const diagnostic of wholeAnswerDiagnosticIssues(scan,findings,uncertainties))issues.push({
      category:diagnostic.category,severity:"active",attemptIds:[attempt.id],detail:`Attempt ${attempt.id}: ${diagnostic.detail}`,repairable:true});
    const rootsWithTarget=new Set(attempts.flatMap(row=>row.observed_out_of_scope_findings||[])
      .filter(row=>!!row.stable_target_key).map(row=>row.root_cause_key).filter(Boolean));
    for(const row of findings)if(row.materiality==="major"&&row.confidence==="high"&&row.create_target_candidate&&
      !row.stable_target_key&&(!row.root_cause_key||!rootsWithTarget.has(row.root_cause_key)))issues.push({
        category:"independent_major_finding_not_promoted",severity:"active",attemptIds:[attempt.id],
        detail:`Attempt ${attempt.id} major finding ${row.finding_id||row.finding} was not promoted`,repairable:true});
    const baseline=attempt.whole_answer_diagnostic_baseline;
    if(baseline&&baseline.scoreNumeric!==(attempt.score_numeric??null)||baseline&&baseline.scoreLabel!==attempt.score_label)issues.push({
      category:"rediagnosis_changed_original_score",severity:"active",attemptIds:[attempt.id],detail:`Attempt ${attempt.id} original score changed after rediagnosis`,repairable:false});
    if(baseline&&baseline.mark!==attempt.mark)issues.push({category:"rediagnosis_changed_original_mark",severity:"active",attemptIds:[attempt.id],
      detail:`Attempt ${attempt.id} original mark changed after rediagnosis`,repairable:false});
  }

  for(const review of active){
    const source=attemptsById.get(Number(review.source_attempt_id||review.generated_from_attempt_id||0));
    if(review.assessment_timing==="same_session_correction"&&source&&
      resolvePersistedAttemptLifecycle(source).reviewOutcome==="success"&&
      !!source.observed_out_of_scope_findings?.some(row=>row.stable_target_key))issues.push({
      category:"same_session_review_from_successful_out_of_scope_only",severity:"active",reviewIds:[review.id],
      attemptIds:[source.id],detail:`Review ${review.id} repeats a successful assessment in the same session instead of scheduling retention`,repairable:true,
    });
    if(source&&attempts.some(attempt=>isSuccessfulTransferForProblem(attempt,review.problem_id)&&
      (attempt.id>source.id||attempt.date>source.date)))issues.push({
      category:"unnecessary_same_problem_review_after_transfer",severity:"active",reviewIds:[review.id],
      attemptIds:[source.id],detail:`Review ${review.id} remains after explicit cross-problem transfer success`,repairable:true,
    });
  }

  if(currentTodayTasks&&currentNextTask){
    const first=currentTodayTasks.find(task=>!task.checked);
    if(first&&currentActionFingerprint(first,first.id&&first.review_type?reviewsById.get(first.id):undefined)!==
      currentActionFingerprint(currentNextTask,currentNextTask.id&&currentNextTask.review_type?reviewsById.get(currentNextTask.id):undefined))issues.push({
      category:"current_action_identity_mismatch",severity:"active",
      detail:"Dashboard current action fingerprint differs from the canonical Current Today action",repairable:false,
    });
  }

  if(currentPlanSummary&&currentPlanSummary.plan.length>=7){
    const week=currentPlanSummary.plan.slice(0,7),tasks=week.flatMap(day=>day.tasks);
    const total=tasks.reduce((sum,row)=>sum+row.minutes,0);
    const concrete=tasks.filter(row=>["past_exam","scan5","timed"].includes(row.kind)&&!!row.referenceProblemId);
    const past=concrete.reduce((sum,row)=>sum+row.minutes,0);
    const horizon=examHorizonPolicy(daysUntilExam(today,args.examDate||"2026-11-15")),share=total?past/total:0;
    if(currentPlanSummary.counts.pastExam>0&&share+1e-9<horizon.pastExamShareMin)issues.push({category:"past_exam_share_below_phase_target",severity:"active",
      detail:`rolling 7-day past-exam share ${Math.round(share*100)}% is below phase target ${Math.round(horizon.pastExamShareMin*100)}%`,repairable:false});
    const whitebookReviews=active.filter(review=>problems.find(problem=>problem.problem_id===review.problem_id)?.source_type!=="past_exam");
    if(currentPlanSummary.counts.pastExam>0&&share<horizon.pastExamShareMin&&whitebookReviews.length)issues.push({category:"whitebook_backlog_suppressing_past_exam",severity:"active",
      reviewIds:whitebookReviews.map(review=>review.id),detail:"whitebook Review backlog is suppressing the exam-horizon past-exam floor",repairable:false});
    const confirmations=tasks.filter(row=>row.kind==="exposure_confirmation");
    const remaining=daysUntilExam(today,args.examDate||"2026-11-15");
    const eligible=(args.pastExamCatalog||[]).filter(row=>row.availability==="verified_problem"&&row.schedulable&&row.gradable&&
      !(remaining>30&&row.simulationProtected));
    if(confirmations.length>1)issues.push({category:"repeated_material_selection_confirmation",severity:"active",
      detail:`material selection confirmation is repeated ${confirmations.length} times`,repairable:false});
    if(confirmations.some(row=>row.minutes>0))issues.push({category:"past_exam_share_counted_from_non_exam_task",severity:"active",
      detail:"material/exposure confirmation consumes planned learning minutes",repairable:false});
    if(eligible.length&&confirmations.length)issues.push({category:"eligible_past_exam_but_confirmation_scheduled",severity:"active",
      detail:`${eligible.length} eligible past-exam problems exist but a material confirmation was scheduled`,repairable:false});
    if(eligible.length&&!concrete.length){
      issues.push({category:"past_exam_candidate_false_negative",severity:"active",
        detail:`${eligible.length} eligible past-exam problems resolved to zero concrete candidates`,repairable:false});
      if(horizon.pastExamShareMin>0)issues.push({category:"current_plan_zero_past_exam_when_phase_requires",severity:"active",
        detail:"exam-horizon phase requires past-exam minutes but the rolling plan has zero",repairable:false});
    }
    const catalogByReference=new Map((args.pastExamCatalog||[]).map(row=>[row.referenceProblemId,row]));
    const protectedRows=concrete.filter(task=>{
      const row=catalogByReference.get(task.referenceProblemId!);return !!row?.simulationProtected&&remaining>30;
    });
    if(protectedRows.length)issues.push({category:"protected_past_exam_scheduled_without_release",severity:"active",
      detail:`${protectedRows.length} protected past-exam tasks were scheduled before the release phase`,repairable:false});
    const badNinety=tasks.filter(row=>row.minutes===90&&!["timed_three_question_session","simulation"].includes(String(row.pastExamTaskType||"")));
    if(badNinety.length)issues.push({category:"single_problem_ninety_minute_session",severity:"active",
      detail:`${badNinety.length} 90-minute tasks are not three-question sessions`,repairable:false});
    const malformedSessions=tasks.filter(row=>["timed_three_question_session","simulation"].includes(String(row.pastExamTaskType||""))&&
      Number(row.sessionProblemIds?.length||0)!==5);
    if(malformedSessions.length)issues.push({category:"past_exam_session_shape_mismatch",severity:"active",
      detail:`${malformedSessions.length} exam sessions do not carry a five-question scan set`,repairable:false});
    const cleanYears=[...new Set((args.pastExamCatalog||[]).filter(row=>!row.simulationProtected&&row.exposure==="unseen")
      .map(row=>row.year))].filter(year=>(args.pastExamCatalog||[]).filter(row=>row.year===year&&row.exposure==="unseen").length>=5).sort((a,b)=>a-b);
    const firstSession=tasks.find(row=>["clean_scan5","timed_three_question_session"].includes(String(row.pastExamTaskType||"")));
    if(remaining<=80&&cleanYears.length&&firstSession?.pastExamYear!==cleanYears[0])issues.push({category:"clean_scan_year_skipped",severity:"active",
      detail:`clean year ${cleanYears[0]} was skipped for ${firstSession?.pastExamYear||"no session"}`,repairable:false});
    const genericWhitebook=tasks.filter(row=>horizon.pastExamIsPrimary&&row.kind==="whitebook"&&!row.conceptId);
    if(genericWhitebook.length)issues.push({category:"generic_whitebook_in_past_exam_main",severity:"active",
      detail:`${genericWhitebook.length} whitebook tasks lack past-exam/concept repair evidence`,repairable:false});
  }

  for(const state of reconciliation.problems.filter(row=>row.graduated&&row.graduationAttemptId)){
    const attempt=attemptsById.get(state.graduationAttemptId!);
    if(!attempt)continue;
    const lifecycle=resolvePersistedAttemptLifecycle(attempt);
    if(lifecycle.graduated&&attempt.mark!==lifecycle.mark)issues.push({
      category:"graduated_mark_mismatch",severity:"active",attemptIds:[attempt.id],
      detail:`${state.problemId} graduated at Attempt ${attempt.id} but mark is ${attempt.mark}`,
      repairable:true,
    });
    const problem=problemById.get(state.problemId);
    if(problem&&problem.completion_status!=="completed")issues.push({
      category:"lifecycle_status_mismatch",severity:"active",attemptIds:[attempt.id],
      detail:`${state.problemId} is graduated but completion_status is ${problem.completion_status}`,
      repairable:true,
    });
    const cooldownEnd=addCalendarDays(attempt.date,45);
    const pending=active.filter(review=>resolveCanonicalProblemId(review.problem_id,aliases)===state.problemId&&
      ["error_repair","retrieval_check"].includes(String(review.grading_contract?.learningPurpose||review.learning_purpose||"")));
    const currentGeneric=(currentTodayTasks||[]).filter(task=>!task.checked&&!task.review_type&&
      resolveCanonicalProblemId(task.problem_id,aliases)===state.problemId&&today<=cooldownEnd);
    const plannedGeneric=(currentPlanSummary?.plan||[]).flatMap(day=>day.date<=cooldownEnd?day.tasks:[])
      .filter(task=>task.problemId===state.problemId&&task.slot==="score_building"&&task.purpose!=="transfer_check");
    if(pending.length||currentGeneric.length||plannedGeneric.length)issues.push({
      category:"graduated_but_rescheduled",severity:"active",attemptIds:[attempt.id],
      reviewIds:pending.map(review=>review.id),
      detail:`${state.problemId} graduated but has ${pending.length} normal Reviews and ${currentGeneric.length+plannedGeneric.length} same-problem tasks inside cooldown`,
      repairable:pending.length>0,
    });
  }

  for (const duplicate of classifyExactDuplicateAttempts(attempts)) {
    const classified = attemptsById.get(duplicate.duplicateAttemptId)?.duplicate_of_attempt_id === duplicate.canonicalAttemptId;
    if (!classified) issues.push({
      category: "exact_duplicate_attempt", severity: "active",
      attemptIds: [duplicate.canonicalAttemptId, duplicate.duplicateAttemptId],
      detail: `Attempt ${duplicate.duplicateAttemptId} duplicates ${duplicate.canonicalAttemptId}`, repairable: true,
    });
  }

  const logicalGroups = new Map<string, Review[]>();
  const contractGroups = new Map<string, Review[]>();
  const dedupGroups = new Map<string, Review[]>();
  for (const review of active) {
    const source = attemptsById.get(review.source_attempt_id || review.generated_from_attempt_id);
    const key = review.logical_review_key || logicalReviewKey({ review, aliases, sourceAttempt: source });
    logicalGroups.set(key, [...(logicalGroups.get(key) || []), review]);
    if (review.contract_id) contractGroups.set(review.contract_id, [...(contractGroups.get(review.contract_id) || []), review]);
    if (review.deduplication_key) dedupGroups.set(review.deduplication_key, [...(dedupGroups.get(review.deduplication_key) || []), review]);

    if (!source) {
      issues.push({ category: "orphan_reference", severity: "active", reviewIds: [review.id],
        detail: `Review ${review.id} source Attempt is missing`, repairable: false });
      issues.push({category:"deleted_attempt_active_descendant",severity:"active",reviewIds:[review.id],
        attemptIds:[Number(review.source_attempt_id||review.generated_from_attempt_id||0)].filter(Boolean),
        detail:`Review ${review.id} remains active after its source Attempt disappeared`,repairable:true});
    }
    else if (!validCrossTarget.has(review.id)&&!["verified_linked_problem", "transfer_schedule"].includes(String(review.origin || "")) &&
      resolveCanonicalProblemId(source.problem_id, aliases) !== resolveCanonicalProblemId(review.problem_id, aliases)) {
      issues.push({ category: "source_target_mismatch", severity: "active", reviewIds: [review.id],
        attemptIds: [source.id], detail: `Review ${review.id} source and target differ`, repairable: true });
    }

    const state = reviewExecutionState(review, today);
    if (state === "expired_same_session") issues.push({ category: "expired_same_session", severity: "active",
      reviewIds: [review.id], detail: `Review ${review.id} same-session task expired`, repairable: true });
    if (state === "invalid" && ACTIVE_REVIEW_STATUSES.has(review.status)) issues.push({
      category: "inactive_pending", severity: "active", reviewIds: [review.id],
      detail: `Review ${review.id} is pending but invalid`, repairable: true,
    });
    if(state==="actionable"){
      try{
        const prompt=buildReviewGradingPrompt({reviewId:review.id,problemId:review.problem_id,date:today,
          mode:review.grading_contract?.mode||review.effective_mode||review.inferred_mode||"check",
          timeMinutes:Number(review.grading_contract?.estimatedMinutes||review.estimated_minutes||5),
          gradingContract:review.grading_contract});
        if(!prompt.trim())throw new Error("empty prompt");
      }catch(error){
        issues.push({category:"actionable_review_prompt_missing",severity:"active",reviewIds:[review.id],
          detail:`Review ${review.id} cannot produce its canonical grading prompt: ${error instanceof Error?error.message:String(error)}`,repairable:false});
      }
    }

    const schedule = resolveReviewSchedule(review, source);
    if (schedule.scheduleOrigin === "policy" && schedule.sourceDate && schedule.reviewAfterDays != null &&
      review.due_date !== addCalendarDays(schedule.sourceDate, schedule.reviewAfterDays)) {
      issues.push({ category: "date_interval_mismatch", severity: "active", reviewIds: [review.id],
        detail: `Review ${review.id} due date does not match policy interval`, repairable: true });
    }

    const contract = review.grading_contract;
    if (contract) {
      const mismatch = validateGradingContract(contract).length > 0 ||
        review.contract_id !== contract.contractId || review.contract_hash !== contract.contractHash ||
        review.learning_purpose !== contract.learningPurpose ||
        review.effective_mode !== contract.mode || review.review_scope !== contract.reviewScope ||
        review.sheet_type !== contract.sheetType;
      if (mismatch) issues.push({ category: "contract_top_level_mismatch", severity: "active",
        reviewIds: [review.id], detail: `Review ${review.id} contract and top-level fields differ`, repairable: true });
      for (const part of contract.gradedParts) {
        if (/^target_[a-z0-9]+$/.test(part.id)) issues.push({ category: "unstable_graded_part", severity: "history",
          reviewIds: [review.id], detail: `Review ${review.id} retains fixed legacy part id ${part.id}`, repairable: false });
      }
      const stableRows=stableTargets.reviewParts(review.id);
      const stableKeys=stableRows.map(row=>row.identityKey).filter((key):key is string=>!!key);
      if(stableRows.some(row=>row.ambiguous))issues.push({category:"orphan_active_target",severity:"active",
        reviewIds:[review.id],detail:`Review ${review.id} has a target without explicit lineage`,repairable:false});
      if(new Set(stableKeys).size<stableKeys.length)issues.push({category:"duplicate_stable_target",severity:"active",
        reviewIds:[review.id],detail:`Review ${review.id} contains multiple generations of the same stable target`,repairable:true});
      const invalidKeys=contract.gradedParts.flatMap(part=>{
        const key=part.stableTargetKey||part.stable_target_key;
        return key&&!isValidStableTargetKey(review.problem_id,key)?[key]:[];
      });
      if(invalidKeys.length)issues.push({category:"invalid_stable_target_key",severity:"active",reviewIds:[review.id],
        detail:`Review ${review.id} contains Review/Attempt-dependent stable keys: ${[...new Set(invalidKeys)].join(", ")}`,repairable:true});
      const labels=contract.gradedParts.map(part=>part.label.trim()).filter(Boolean);
      const duplicateLabels=[...new Set(labels.filter((label,index)=>labels.indexOf(label)!==index))];
      if(duplicateLabels.length)issues.push({category:"duplicate_active_target_label",severity:"active",reviewIds:[review.id],
        detail:`Review ${review.id} repeats exact target labels: ${duplicateLabels.join(", ")}`,repairable:true});
      if(contract.learningPurpose==="error_repair"){
        const currentLabels=currentTargetLabels(contract.gradedParts);
        const expectedDisplay=currentTargetDisplay(contract.gradedParts);
        const same=(left:string[]|undefined,right:string[])=>JSON.stringify(left||[])===JSON.stringify(right);
        const countText=contract.completionConditions.join(" ").match(/指定された(\d+)点/);
        const completionCount=countText?Number(countText[1]):currentLabels.length;
        const storedHint=review.derived_fields?.oneLineHint?.value;
        const storedActions=review.derived_fields?.todayActions?.value;
        if((review.targeted_parts!==undefined&&!same(review.targeted_parts,currentLabels))||
          (review.graded_parts!==undefined&&!same(review.graded_parts,currentLabels))||
          (review.required_evidence!==undefined&&!same(review.required_evidence,currentLabels))||
          (typeof storedHint==="string"&&storedHint!==expectedDisplay.oneLineHint)||
          (Array.isArray(storedActions)&&!same(storedActions,expectedDisplay.todayActions))||
          completionCount!==currentLabels.length){
          issues.push({category:"current_target_display_mismatch",severity:"active",reviewIds:[review.id],
            detail:`Review ${review.id} display payload does not cover all ${currentLabels.length} current targets`,repairable:true});
        }
      }
    }
  }

  // Terminal rows remain immutable history, but their invalid identity format
  // is reported separately instead of being accepted as a stable anchor.
  for(const review of reviews.filter(row=>!ACTIVE_REVIEW_STATUSES.has(row.status))){
    const invalid=(review.grading_contract?.gradedParts||[]).flatMap(part=>{
      if(typeof part==="string")return [];
      const key=part.stableTargetKey||part.stable_target_key;
      return key&&!isValidStableTargetKey(review.problem_id,key)?[key]:[];
    });
    if(invalid.length)issues.push({category:"invalid_stable_target_key",severity:"history",reviewIds:[review.id],
      detail:`Historical Review ${review.id} retains legacy target identity`,repairable:false});
  }
  for(const attempt of attempts){
    const invalid=(attempt.grading_contract?.gradedParts||[]).flatMap(part=>{
      if(typeof part==="string")return [];
      const key=part.stableTargetKey||part.stable_target_key;
      return key&&!isValidStableTargetKey(attempt.problem_id,key)?[key]:[];
    });
    if(invalid.length)issues.push({category:"invalid_stable_target_key",severity:"history",attemptIds:[attempt.id],
      detail:`Historical Attempt ${attempt.id} retains legacy target identity`,repairable:false});
  }

  for (const rows of logicalGroups.values()) if (rows.length > 1) issues.push({
    category: "duplicate_logical_review", severity: "active", reviewIds: rows.map((row) => row.id),
    detail: `${rows.length} active Reviews share a logical key`, repairable: true,
  });
  for (const rows of contractGroups.values()) if (rows.length > 1) issues.push({
    category: "duplicate_contract_id", severity: "active", reviewIds: rows.map((row) => row.id),
    detail: `${rows.length} active Reviews share contractId ${rows[0].contract_id}`, repairable: true,
  });
  for (const rows of dedupGroups.values()) if (rows.length > 1) issues.push({
    category: "repeated_deduplication_key", severity: "active", reviewIds: rows.map((row) => row.id),
    detail: `${rows.length} active Reviews share deduplication_key`, repairable: true,
  });

  for (const snapshot of todayPlanSnapshots) for (const task of snapshot.tasks) {
    if (!task.id || !task.review_type) continue;
    const state = reviewExecutionState(reviewsById.get(task.id), today);
    if (state !== "actionable") issues.push({ category: "stale_today_snapshot", severity: "history",
      reviewIds: [task.id], detail: `${snapshot.date} snapshot refers to ${state} Review ${task.id}`, repairable: false });
  }

  // Validate the projection actually consumed by Today/Dashboard separately
  // from the immutable snapshot rows. This catches a missed post-save refresh
  // without treating historical `checked` values as writable state.
  const currentSnapshot=todayPlanSnapshots.find(snapshot=>snapshot.date===today);
  if(currentSnapshot&&currentTodayTasks){
    const openByProblem=new Map<string,Task[]>();
    for(const task of currentTodayTasks.filter(row=>!row.checked&&row.triage!=="tomorrow")){
      const key=resolveCanonicalProblemId(task.problem_id,aliases);
      openByProblem.set(key,[...(openByProblem.get(key)||[]),task]);
    }
    for(const [problemId,tasks] of openByProblem){
      const generic=tasks.filter(task=>!task.review_type),reviewTasks=tasks.filter(task=>!!task.review_type);
      const duplicateReviewIds=reviewTasks.filter((task,index)=>reviewTasks.findIndex(row=>row.id===task.id)!==index);
      if(generic.length&&reviewTasks.length||generic.length>1||duplicateReviewIds.length)issues.push({
        category:"duplicate_problem_task",severity:"active",
        reviewIds:reviewTasks.flatMap(task=>task.id?[task.id]:[]),
        detail:`${problemId} has duplicate generic/Review tasks in the current plan`,repairable:false});
    }
    for(const task of currentTodayTasks){
      const expectedChecked=projectTodayTaskChecked({task,attempts,snapshot:currentSnapshot,aliases});
      if(expectedChecked&&!task.checked)issues.push({
        category:"today_task_completion_mismatch",severity:"active",
        reviewIds:task.review_type&&task.id?[task.id]:undefined,
        detail:`${task.problem_id} has a qualifying Attempt but its current Today task is incomplete`,repairable:false,
      });
      if(task.review_type&&task.id){
        const state=reviewExecutionState(reviewsById.get(task.id),today);
        if(state!=="actionable")issues.push({
          category:"inactive_review_current_task",severity:"active",reviewIds:[task.id],
          detail:`Current Today projection still contains ${state} Review ${task.id}`,repairable:false,
        });
        if(state!=="actionable")issues.push({category:"current_today_stale_review",severity:"active",reviewIds:[task.id],
          detail:`Current Today refers to ${state} Review ${task.id}`,repairable:false});
      }
    }
    if(Object.prototype.hasOwnProperty.call(args,"currentNextTask")){
      const expectedNext=selectNextCurrentTodayTask(currentTodayTasks);
      const taskKey=(task:Task|undefined)=>task?`${task.id?`review:${task.id}`:`problem:${task.problem_id}`}|${task.kind}|${task.mode}`:"";
      if(taskKey(expectedNext)!==taskKey(currentNextTask))issues.push({
        category:"today_next_action_mismatch",severity:"active",
        reviewIds:currentNextTask?.review_type&&currentNextTask.id?[currentNextTask.id]:undefined,
        detail:`Dashboard NEXT ACTION does not match the canonical current Today projection`,repairable:false,
      });
    }
  }

  if(currentPlanSummary&&currentTodayTasks){
    const todayPlacements=currentPlanSummary.reviewSchedule.placements.filter(row=>row.date===today);
    const currentReviewIds=new Set(currentTodayTasks.filter(task=>!task.checked&&task.review_type&&task.id).map(task=>task.id as number));
    for(const placement of currentPlanSummary.reviewSchedule.placements){
      if(placement.status==="within_window"&&placement.date>placement.latestDate)issues.push({
        category:"review_window_violation",severity:"active",reviewIds:[placement.reviewId],
        detail:`Review ${placement.reviewId} is placed ${placement.date} after latest ${placement.latestDate}`,repairable:false});
    }
    for(const placement of todayPlacements){
      if(!currentReviewIds.has(placement.reviewId))issues.push({category:"current_planner_eligibility_mismatch",severity:"active",
        reviewIds:[placement.reviewId],detail:`Review ${placement.reviewId} is scheduled today but missing from the current projection`,repairable:false});
      if(!currentReviewIds.has(placement.reviewId))issues.push({category:"current_today_missing_active_review",severity:"active",
        reviewIds:[placement.reviewId],detail:`Current Today is missing formal Review ${placement.reviewId}`,repairable:false});
      if(!currentReviewIds.has(placement.reviewId))issues.push({category:"formal_plan_current_projection_mismatch",severity:"active",
        reviewIds:[placement.reviewId],detail:`Formal planner Review ${placement.reviewId} differs from Current Today`,repairable:false});
    }
    const urgentConflicts=currentPlanSummary.reviewSchedule.capacityConflicts.filter(row=>row.preferredDate<=today||row.latestDate<=today);
    for(const conflict of urgentConflicts)issues.push({category:"overdue_starvation",severity:"active",reviewIds:[conflict.reviewId],
      detail:`Review ${conflict.reviewId} could not be placed before score-building/optional work (${conflict.reason})`,repairable:false});
    if(urgentConflicts.length&&additionalCandidates.length)issues.push({category:"optional_extra_priority_violation",severity:"active",
      reviewIds:urgentConflicts.map(row=>row.reviewId),detail:"Optional extra is visible while an urgent Review remains unplaced",repairable:false});
    const activeReviewProblems=new Set(reviews.filter(review=>reviewExecutionState(review,today)==="actionable"&&
      String(review.earliest_date||review.due_date)<=today)
      .map(review=>resolveCanonicalProblemId(review.problem_id,aliases)));
    for(const task of currentTodayTasks.filter(row=>!row.checked&&!row.review_type&&activeReviewProblems.has(resolveCanonicalProblemId(row.problem_id,aliases))))
      issues.push({category:"current_planner_eligibility_mismatch",severity:"active",detail:
        `${task.problem_id} is a generic current task while an active Review exists`,repairable:false});
  }
  if(currentTodayTasks&&eligibleTodayTasks){
    const eligibilityKey=(task:Task)=>task.id&&task.review_type?`review:${task.id}`:
      `problem:${resolveCanonicalProblemId(task.problem_id,aliases)}`;
    const currentKeys=new Set(currentTodayTasks.filter(task=>task.plan_origin!=="adaptive_additional").map(eligibilityKey));
    const eligibleKeys=new Set(eligibleTodayTasks.map(eligibilityKey));
    for(const key of eligibleKeys)if(!currentKeys.has(key)){
      issues.push({category:"current_planner_eligibility_mismatch",severity:"active",
        detail:`Eligible task ${key} is missing from the current projection`,repairable:false});
      issues.push({category:"formal_plan_current_projection_mismatch",severity:"active",
        detail:`Formal eligible task ${key} is missing from Current Today`,repairable:false});
      if(key.startsWith("review:"))issues.push({category:"current_today_missing_active_review",severity:"active",
        reviewIds:[Number(key.slice(7))],detail:`Current Today is missing active ${key}`,repairable:false});
    }
    for(const task of currentTodayTasks.filter(row=>!row.checked&&row.plan_origin!=="adaptive_additional")){
      const key=eligibilityKey(task);
      if(!eligibleKeys.has(key))issues.push({category:"current_planner_eligibility_mismatch",severity:"active",
        reviewIds:task.review_type&&task.id?[task.id]:undefined,detail:`Current task ${key} is not eligible in the canonical planner`,repairable:false});
    }
  }

  for(const update of pendingImportUpdates){
    const generation=resolveSemanticReviewGeneration({update,reviews,attempts,aliases,today});
    if(generation.kind==="rebound")issues.push({category:"stale_contract_equivalent_replacement",severity:"active",
      reviewIds:[generation.oldReview!.id,generation.currentReview!.id],
      detail:generation.message||"A stale GPT result can be rebound to the current semantic Review",repairable:true});
  }

  const reviewMap=new Map(reviews.map(row=>[row.id,row]));
  for(const problem of reconciliation.problems){
    if(problem.stalePayloadCount>0)issues.push({category:"stale_target_payload",severity:"active",
      reviewIds:problem.activeRepairReviewIds,attemptIds:problem.desiredSourceAttemptId?[problem.desiredSourceAttemptId]:undefined,
      detail:`${problem.problemId} has ${problem.stalePayloadCount} target payloads older than latest eligible evidence`,repairable:true});
    if(problem.multiGenerationDuplicateCount>0&&!issues.some(issue=>issue.category==="duplicate_stable_target"&&
      issue.reviewIds?.some(id=>problem.activeRepairReviewIds.includes(id))))issues.push({category:"duplicate_stable_target",severity:"active",
      reviewIds:problem.activeRepairReviewIds,detail:`${problem.problemId} has ${problem.multiGenerationDuplicateCount} duplicate target generations`,repairable:true});
    if(problem.replacementRequired)issues.push({category:"current_review_target_mismatch",severity:"active",
      reviewIds:problem.activeRepairReviewIds,attemptIds:problem.desiredSourceAttemptId?[problem.desiredSourceAttemptId]:undefined,
      detail:`${problem.problemId} current Review does not match the unresolved stable target set`,repairable:true});
    // Independent cardinality sanity check: even if the lineage reconciler's
    // identity comparison regresses, the raw active contract cannot claim a
    // different number of targets than the replayed unresolved set.
    if(!problem.ambiguousReasons.length&&problem.activeRepairReviewIds.length&&
      problem.activeReviewTargetCount!==problem.desiredRepairParts.length&&
      !issues.some(issue=>issue.category==="current_review_target_mismatch"&&
        issue.reviewIds?.some(id=>problem.activeRepairReviewIds.includes(id))))issues.push({
      category:"current_review_target_mismatch",severity:"active",reviewIds:problem.activeRepairReviewIds,
      attemptIds:problem.desiredSourceAttemptId?[problem.desiredSourceAttemptId]:undefined,
      detail:`${problem.problemId} active target count ${problem.activeReviewTargetCount} differs from current unresolved count ${problem.desiredRepairParts.length}`,
      repairable:true,
    });
    for(const reason of problem.ambiguousReasons)if(!issues.some(issue=>issue.category==="orphan_active_target"&&
      issue.reviewIds?.some(id=>problem.activeRepairReviewIds.includes(id))))issues.push({category:"orphan_active_target",severity:"active",
        reviewIds:problem.activeRepairReviewIds,detail:`${problem.problemId}: ${reason}`,repairable:false});
    for(const action of problem.reviewsToSupersede){
    const review=reviewMap.get(action.reviewId);
    const category:IntegrityCategory=action.category==="partially_stale_repair"?"partially_stale_review":
      action.category==="stale_delayed_check"?"stale_delayed_check":
        action.category==="graduated_but_pending"?"graduated_but_pending":"stale_review_after_success";
    if(issues.some(issue=>issue.category===category&&issue.reviewIds?.includes(action.reviewId)))continue;
    issues.push({category,severity:"active",reviewIds:[action.reviewId],
      attemptIds:[Number(review?.source_attempt_id||review?.generated_from_attempt_id||0),problem.desiredSourceAttemptId||0].filter(Boolean),
      detail:`${problem.problemId} / Review ${action.reviewId}: ${action.reason}`,repairable:action.category!=="orphan_review"});
    if(["stale_repair","partially_stale_repair","contradictory_review"].includes(action.category))issues.push({
      category:"stale_stable_target",severity:"active",reviewIds:[action.reviewId],
      detail:`${problem.problemId} active Review retains a target contradicted by stable evidence`,repairable:true});
    }
  }
  for(let index=0;index<reconciliation.staleTodayActions;index++)issues.push({
    category:"obsolete_today_action",severity:"active",detail:"Today Planの保存枠を現在のactive Reviewへ表示同期する必要があります",repairable:false,
  });

  const categories: IntegrityCategory[] = [
    "orphan_reference", "exact_duplicate_attempt", "duplicate_logical_review", "duplicate_contract_id",
    "repeated_deduplication_key", "inactive_pending", "expired_same_session", "date_interval_mismatch",
    "source_target_mismatch", "contract_top_level_mismatch", "stale_today_snapshot",
    "unstable_graded_part", "stale_review_after_success", "partially_stale_review",
    "stale_delayed_check", "graduated_but_pending", "obsolete_today_action",
    "duplicate_stable_target", "stale_stable_target", "current_review_target_mismatch", "orphan_active_target",
    "invalid_stable_target_key", "duplicate_active_target_label", "stale_target_payload", "current_target_display_mismatch",
    "today_task_completion_mismatch", "inactive_review_current_task", "today_next_action_mismatch",
    "duplicate_problem_task", "current_planner_eligibility_mismatch", "review_window_violation",
    "overdue_starvation", "optional_extra_priority_violation", "actionable_review_prompt_missing",
    "graduated_mark_mismatch", "graduated_but_rescheduled", "lifecycle_status_mismatch",
    "current_today_missing_active_review", "current_today_stale_review", "formal_plan_current_projection_mismatch",
    "deleted_attempt_active_descendant", "stale_contract_equivalent_replacement",
    "current_action_identity_mismatch", "past_exam_share_below_phase_target", "whitebook_backlog_suppressing_past_exam",
    "same_session_review_from_successful_out_of_scope_only", "unnecessary_same_problem_review_after_transfer",
    "attached_full_reference_downgraded_by_app_metadata", "written_answer_region_unaccounted",
    "readable_region_not_evaluated", "material_uncertainty_not_surfaced", "whole_scan_empty_with_material_uncertainty",
    "same_root_duplicate_target", "independent_major_finding_not_promoted", "contract_confidence_used_as_whole_scan_confidence",
    "rediagnosis_changed_original_score", "rediagnosis_changed_original_mark", "rediagnosis_duplicate_target",
    "rediagnosis_duplicate_review", "problem_specific_whole_scan_branch",
    "eligible_past_exam_but_confirmation_scheduled", "past_exam_candidate_false_negative",
    "repeated_material_selection_confirmation", "past_exam_share_counted_from_non_exam_task",
    "current_plan_zero_past_exam_when_phase_requires", "protected_past_exam_scheduled_without_release",
    "single_problem_ninety_minute_session", "past_exam_session_shape_mismatch", "clean_scan_year_skipped",
    "generic_whitebook_in_past_exam_main",
    "coach_update_parse_failed", "coach_update_schema_invalid", "coach_diff_generated_from_invalid_update",
  ];
  const counts = Object.fromEntries(categories.map((category) =>
    [category, issues.filter((issue) => issue.category === category).length])) as Record<IntegrityCategory, number>;
  return {
    generatedAt: new Date().toISOString(), issues, counts,
    activeIssueCount: issues.filter((issue) => issue.severity === "active").length,
    historyWarningCount: issues.filter((issue) => issue.severity === "history").length,
    informationalHistoryCount:issues.filter((issue)=>issue.severity==="informational").length,reconciliation,
  };
}
