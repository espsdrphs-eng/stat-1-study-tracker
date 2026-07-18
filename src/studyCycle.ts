import type { Attempt, Problem, StudyUpdate } from "./types.ts";
import { reviewDaysForErrors, sanitizeStudyUpdateTiming } from "./reviewTiming.ts";
import { todayString } from "./importParser.ts";
import { effectiveErrorsForAutomation } from "./reviewScopeResolver.ts";
import { classifyKPolicyValidity } from "./legacyKPolicy.ts";

export type ProblemType = "S" | "A" | "past_exam";

export type StudyMode =
  | "check"
  | "skeleton"
  | "main_calc"
  | "full"
  | "scan5"
  | "exam90";

export type TaskOrigin =
  | "first_attempt"
  | "review_attempt"
  | "linked_s_check"
  | "related_drill"
  | "past_exam_followup";

export type ErrorType = "K" | "W" | "N" | "C" | "none";

export type TaskStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "postponed"
  | "review_needed"
  | "cancelled";

export type TodayBucket =
  | "must_do"
  | "optional"
  | "postpone_candidate"
  | "completed";

export interface CanonicalProblem {
  problemId: string;
  displayLabel: string;
  source: string;
  type: ProblemType;
  chapter?: number;
  problemNumber?: number;
  theme: string;
  canonicalProblemType?: string;
  canonicalKeywords: string[];
  roadmapRank?: string;
  relatedProblemIds: string[];
  answerAvailable: boolean;
  answerRef?: string;
  updatedAt: string;
}

export interface StudyTask {
  taskId: string;
  problemId: string;
  taskOrigin: TaskOrigin;
  mode: StudyMode;
  scope: string;
  dueDate: string;
  status: TaskStatus;
  reason: string;
  estimatedMinutes: number;
  sourceAttemptId?: string;
  sourceProblemId?: string;
  priorityGroup?: string;
  todayBucket?: TodayBucket;
  postponeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyAttemptRecord {
  attemptId: string;
  taskId: string;
  problemId: string;
  date: string;
  modeUsed: StudyMode;
  actualMinutes?: number;
  allowedReferenceLevel?: number;
  actualReferenceLevel?: number;
  afterReferenceReproduced?: boolean;
  answerSaved?: boolean;
  createdAt: string;
}

export interface Evaluation {
  evaluationId: string;
  attemptId: string;
  problemId: string;
  scoreNumeric: number;
  mark: "◎" | "○" | "△" | "×";
  errorTypes: ErrorType[];
  primaryErrorType: ErrorType;
  resultSummary: string;
  errorPoint?: string;
  nextAction: string;
  weakNotes: string[];
  gradingConfidence?: number;
  evaluationScope?: string;
  rawGptText?: string;
  createdAt: string;
}

export interface ReviewPlanRecord {
  reviewPlanId: string;
  problemId: string;
  sourceAttemptId: string;
  sourceEvaluationId: string;
  nextDueDate: string;
  nextMode: StudyMode;
  nextScope: string;
  reason: string;
  status: "scheduled" | "completed" | "cancelled";
  createdAt: string;
}

export interface StableTodayPlanSnapshot {
  date: string;
  targetMinutes: number;
  createdAt: string;
  locked: boolean;
  entries: StableTodayPlanEntry[];
}

export interface StableTodayPlanEntry {
  taskId: string;
  problemId: string;
  initialBucket: TodayBucket;
  currentBucket: TodayBucket;
  initialEstimatedMinutes: number;
  currentEstimatedMinutes: number;
  sortOrder: number;
}

export const GPT_EVALUATION_FIELDS = [
  "score_numeric",
  "mark",
  "error_types",
  "primary_error_type",
  "result_summary",
  "error_point",
  "next_action",
  "weak_notes",
  "grading_confidence",
  "evaluation_scope"
] as const;

export const APP_OWNED_FIELDS = [
  "problem_id",
  "display_label",
  "task_origin",
  "date",
  "actual_minutes",
  "estimated_minutes",
  "review_after_days",
  "next_due_date",
  "review_method",
  "today_priority",
  "today_bucket",
  "linked_problem_confirmation"
] as const;

const priority:ErrorType[] = ["K", "N", "W", "C", "none"];

export function normalizedErrorTypes(update:Pick<StudyUpdate, "error_types" | "primary_error_type" | "error_type">):ErrorType[] {
  const raw = update.error_types?.length ? update.error_types : [update.primary_error_type || update.error_type || "none"];
  const errors = [...new Set(raw.map(String).map(value => value.toUpperCase()).filter(value => priority.includes(value as ErrorType)))] as ErrorType[];
  const real = errors.filter(error => error !== "none");
  const normalized:ErrorType[] = real.length ? real : ["none"];
  return normalized.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
}

export function reviewMethodForErrors(errors:ErrorType[]):"check" | "skeleton" | "main_calc" {
  if (errors.includes("K") || errors.includes("N")) return "skeleton";
  if (errors.includes("W")) return "main_calc";
  return "check";
}

export function inferTaskOrigin(problemId:string, attempts:Attempt[], generatedFromReviewId?:number):TaskOrigin {
  if (generatedFromReviewId) return "review_attempt";
  return attempts.some(attempt => attempt.problem_id === problemId) ? "review_attempt" : "first_attempt";
}

export function normalizeStudyMode(value:string | undefined):string {
  if (value === "scan5") return "scan";
  if (value === "exam90") return "exam_90min";
  return value || "full";
}

export function prepareImportedStudyUpdate(
  update:StudyUpdate,
  context:{ attempts:Attempt[]; today?:string; selectedProblem?:Problem }
):StudyUpdate {
  const date = context.today || todayString();
  const problemId = context.selectedProblem?.problem_id || update.problem_id;
  const taskOrigin = update.task_origin || inferTaskOrigin(problemId, context.attempts, update.generated_from_review_id);
  return finalizeStudyUpdateForSave({
    ...update,
    problem_id: problemId,
    date,
    task_origin: taskOrigin,
    mode: normalizeStudyMode(update.mode),
    display_label: context.selectedProblem?.display_label || update.display_label,
    correction_fields: [...new Set([...(update.correction_fields || []), ...(update.date !== date ? ["date"] : []), ...(!update.task_origin ? ["task_origin"] : [])])]
  });
}

export function finalizeStudyUpdateForSave(update:StudyUpdate):StudyUpdate {
  const errors = normalizedErrorTypes(update);
  const effective = effectiveErrorsForAutomation(errors.filter(error => error !== "none"),update.rubric_version,update.k_evidence,update);
  const automationErrors = (effective.length ? effective : ["none"]) as ErrorType[];
  const days = reviewDaysForErrors(effective);
  const primary = errors.find(error => error !== "none") || "none";
  const reviewMethod = reviewMethodForErrors(automationErrors);
  const timed = sanitizeStudyUpdateTiming({
    ...update,
    mode: normalizeStudyMode(update.mode),
    error_types: errors,
    error_type: primary,
    primary_error_type: primary,
    review_after_days: days,
    review_method: reviewMethod,
    error_point: primary === "none" && !String(update.error_point || "").trim() ? "大きな問題なし" : update.error_point,
    weak_notes: primary === "none" ? [] : update.weak_notes,
    effective_error_types: automationErrors,
    k_evidence_valid: !errors.includes("K") || classifyKPolicyValidity({...update,error_types:errors})==="valid"
  });
  return {
    ...timed,
    review_after_days: days,
    review_method: reviewMethod,
    error_types: errors,
    effective_error_types: automationErrors,
    error_type: primary,
    primary_error_type: primary
  };
}

export function toCanonicalProblem(problem:Problem, updatedAt:string):CanonicalProblem {
  return {
    problemId: problem.problem_id,
    displayLabel: problem.display_label || problem.title || problem.problem_id,
    source: problem.source_type,
    type: problem.category as ProblemType,
    chapter: problem.chapter ?? undefined,
    problemNumber: problem.problem_number,
    theme: problem.theme,
    canonicalProblemType: problem.canonical_problem_type,
    canonicalKeywords: problem.canonical_keywords || [],
    roadmapRank: problem.roadmap_rank || problem.strategy_rank,
    relatedProblemIds: [...new Set([
      ...(problem.related_s_problem_ids || []),
      ...(problem.related_a_problem_ids || []),
      ...(problem.related_past_exam_ids || [])
    ])],
    answerAvailable: !!problem.answer_available,
    answerRef: problem.official_answer_url || problem.official_answer,
    updatedAt
  };
}
