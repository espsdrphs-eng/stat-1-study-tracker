import type {Attempt,ProblemAlias,Review} from "./types.ts";
import {resolveCanonicalProblemId} from "./examReadiness.ts";
import {isActionableReview} from "./gradingContract.ts";

export function canonicalAttemptId(attempt:Attempt|undefined){
  return attempt?.canonical_attempt_id||attempt?.duplicate_of_attempt_id||attempt?.id||0;
}

export function logicalReviewKey(args:{review:Partial<Review>;aliases?:ProblemAlias[];sourceAttempt?:Attempt}){
  const {review,aliases=[],sourceAttempt}=args;
  const problemId=resolveCanonicalProblemId(String(review.problem_id||review.target_problem_id||""),aliases);
  const contract=review.grading_contract;
  const purpose=contract?.learningPurpose||review.learning_purpose||"";
  const timing=review.assessment_timing||"delayed_retrieval";
  const mode=contract?.mode||review.effective_mode||review.inferred_mode||"";
  const scope=contract?.reviewScope||review.effective_review_scope||review.review_scope||"";
  const targetKind=contract?.targetKind||review.target_kind||"";
  const gradedPartIds=[...(contract?.gradedParts.map(part=>part.stableTargetKey||part.stable_target_key||part.id)||review.graded_part_ids||[])].sort();
  const sourceKey=sourceAttempt?.submission_id
    ?`submission:${sourceAttempt.submission_id}`
    :`attempt:${canonicalAttemptId(sourceAttempt)||review.source_attempt_id||review.generated_from_attempt_id||0}`;
  return [problemId,purpose,timing,mode,scope,targetKind,gradedPartIds.join(","),sourceKey,
    review.policy_version||contract?.contractVersion||""].join("|");
}

export type ReviewExecutionState="actionable"|"completed"|"superseded"|"invalid"|"expired_same_session"|
  "needs_review"|"stale"|"missing";

export function reviewExecutionState(review:Review|undefined,today:string):ReviewExecutionState{
  if(!review)return "missing";
  const row=review as Review&{review_needed?:boolean};
  if(["done","completed"].includes(review.status))return "completed";
  if(["superseded","cancelled","ignored"].includes(review.status))return "superseded";
  if(review.policy_validity==="invalid_legacy_k"||review.exclude_from_planning===true)return "invalid";
  if(review.assessment_timing==="same_session_correction"&&review.due_date<today)return "expired_same_session";
  if(review.origin_verified===false||row.review_needed||["review_needed","id_review_needed"].includes(review.status))return "needs_review";
  return isActionableReview(review,review.grading_contract,today)?"actionable":"stale";
}

export function reviewExecutionMessage(state:ReviewExecutionState,review?:Partial<Review>){
  if(state==="completed")return "この復習課題はすでに完了しています";
  if(state==="superseded")return "この復習課題は、より新しい答案または現行ポリシーにより終了しました";
  if(state==="invalid")return review?.policy_validity==="invalid_legacy_k"
    ?"旧ポリシー由来のため現在の計画から除外されています":"この復習課題は現在の計画から除外されています";
  if(state==="expired_same_session")return "この同日補修課題は有効期限を過ぎています";
  if(state==="needs_review")return "問題情報または復習履歴の確認が必要なため、現在は実行できません";
  if(state==="missing")return "復習課題が見つかりません";
  if(state==="stale")return "画面と採点契約が一致しないため、現在は実行できません";
  return "現在実行できます";
}
