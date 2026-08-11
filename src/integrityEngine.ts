import type { Attempt, GradingContractSnapshot, ProblemAlias, Review, TodayPlanSnapshot } from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { addCalendarDays, resolveReviewSchedule } from "./reviewSchedulePolicy.ts";
import { isActionableReview, validateGradingContract } from "./gradingContract.ts";
import { analyzeReviewReconciliation, type ReconciliationAudit } from "./reviewReconciliation.ts";
import {buildStableTargetIndex,isValidStableTargetKey} from "./stableTargetIdentity.ts";
import {currentTargetDisplay,currentTargetLabels} from "./currentTargetPayload.ts";

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

export function canonicalAttemptId(attempt: Attempt | undefined) {
  return attempt?.canonical_attempt_id || attempt?.duplicate_of_attempt_id || attempt?.id || 0;
}

export function logicalReviewKey(args: {
  review: Partial<Review>;
  aliases?: ProblemAlias[];
  sourceAttempt?: Attempt;
}) {
  const { review, aliases = [], sourceAttempt } = args;
  const problemId = resolveCanonicalProblemId(String(review.problem_id || review.target_problem_id || ""), aliases);
  const contract = review.grading_contract;
  const purpose = contract?.learningPurpose || review.learning_purpose || "";
  const timing = review.assessment_timing || "delayed_retrieval";
  const mode = contract?.mode || review.effective_mode || review.inferred_mode || "";
  const scope = contract?.reviewScope || review.effective_review_scope || review.review_scope || "";
  const targetKind = contract?.targetKind || review.target_kind || "";
  const gradedPartIds = [...(contract?.gradedParts.map((part) => part.stableTargetKey||part.stable_target_key||part.id) || review.graded_part_ids || [])].sort();
  const sourceKey = sourceAttempt?.submission_id
    ? `submission:${sourceAttempt.submission_id}`
    : `attempt:${canonicalAttemptId(sourceAttempt) || review.source_attempt_id || review.generated_from_attempt_id || 0}`;
  return [
    problemId, purpose, timing, mode, scope, targetKind, gradedPartIds.join(","),
    sourceKey, review.policy_version || contract?.contractVersion || "",
  ].join("|");
}

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

export type ReviewExecutionState =
  | "actionable" | "completed" | "superseded" | "invalid" | "expired_same_session"
  | "needs_review" | "stale" | "missing";

export function reviewExecutionState(review: Review | undefined, today: string): ReviewExecutionState {
  if (!review) return "missing";
  const row=review as Review&{review_needed?:boolean};
  if (["done", "completed"].includes(review.status)) return "completed";
  if (["superseded", "cancelled", "ignored"].includes(review.status)) return "superseded";
  if (review.policy_validity === "invalid_legacy_k" || review.exclude_from_planning === true) return "invalid";
  if (review.assessment_timing === "same_session_correction" && review.due_date < today) return "expired_same_session";
  if (review.origin_verified === false || row.review_needed || ["review_needed", "id_review_needed"].includes(review.status)) return "needs_review";
  return isActionableReview(review, review.grading_contract, today) ? "actionable" : "stale";
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

export function reviewExecutionMessage(state: ReviewExecutionState, review?: Partial<Review>) {
  if (state === "completed") return "この復習課題はすでに完了しています";
  if (state === "superseded") return "この復習課題は、より新しい答案または現行ポリシーにより終了しました";
  if (state === "invalid") return review?.policy_validity === "invalid_legacy_k"
    ? "旧ポリシー由来のため現在の計画から除外されています"
    : "この復習課題は現在の計画から除外されています";
  if (state === "expired_same_session") return "この同日補修課題は有効期限を過ぎています";
  if (state === "needs_review") return "問題情報または復習履歴の確認が必要なため、現在は実行できません";
  if (state === "missing") return "復習課題が見つかりません";
  if (state === "stale") return "画面と採点契約が一致しないため、現在は実行できません";
  return "現在実行できます";
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
  | "stale_target_payload" | "current_target_display_mismatch";

export type IntegrityIssue = {
  category: IntegrityCategory;
  severity: "active" | "history";
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
  reconciliation: ReconciliationAudit;
};

export function runIntegrityAudit(args: {
  attempts: Attempt[];
  reviews: Review[];
  aliases?: ProblemAlias[];
  today: string;
  todayPlanSnapshots?: TodayPlanSnapshot[];
  validCrossTargetReviewIds?: number[];
}): IntegrityAudit {
  const { attempts, reviews, aliases = [], today, todayPlanSnapshots = [], validCrossTargetReviewIds = [] } = args;
  const validCrossTarget=new Set(validCrossTargetReviewIds);
  const issues: IntegrityIssue[] = [];
  const attemptsById = new Map(attempts.map((row) => [row.id, row]));
  const reviewsById = new Map(reviews.map((row) => [row.id, row]));
  const active = reviews.filter((row) => ACTIVE_REVIEW_STATUSES.has(row.status));
  const reconciliation=analyzeReviewReconciliation({attempts,reviews,aliases,today,todayPlanSnapshots});
  const stableTargets=buildStableTargetIndex({attempts,reviews,aliases});

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

    if (!source) issues.push({ category: "orphan_reference", severity: "active", reviewIds: [review.id],
      detail: `Review ${review.id} source Attempt is missing`, repairable: false });
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
  ];
  const counts = Object.fromEntries(categories.map((category) =>
    [category, issues.filter((issue) => issue.category === category).length])) as Record<IntegrityCategory, number>;
  return {
    generatedAt: new Date().toISOString(), issues, counts,
    activeIssueCount: issues.filter((issue) => issue.severity === "active").length,
    historyWarningCount: issues.filter((issue) => issue.severity === "history").length,reconciliation,
  };
}
