import type { Attempt, Problem, ProblemAlias, ProblemRelation, Review, ReviewOrigin } from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { resolveLearningPolicy } from "./learningPolicyResolver.ts";
import { classifyKPolicyValidity, planningErrorsForSource } from "./legacyKPolicy.ts";
import { taskDraftFromPrescription } from "./taskScheduler.ts";

export const REVIEW_ORIGIN_POLICY_VERSION="STAT1-ORIGIN-v1";

export type ReviewOriginResolution={
  origin:ReviewOrigin;valid:boolean;reason:string;sourceAttempt?:Attempt;relation?:ProblemRelation;
  sourceProblemId:string;targetProblemId:string;
};

const canonical=(id:string,aliases:ProblemAlias[])=>resolveCanonicalProblemId(String(id||""),aliases);
const verifiedRelation=(relations:ProblemRelation[],source:string,target:string,aliases:ProblemAlias[])=>relations.find(relation=>
  ["confirmed","verified"].includes(String(relation.status))&&
  ["prerequisite","remediation","extension"].includes(relation.relationType)&&
  canonical(relation.sourceProblemId,aliases)===source&&canonical(relation.targetProblemId,aliases)===target);

export function resolveReviewOrigin(args:{review:Review;attempts:Attempt[];aliases:ProblemAlias[];relations:ProblemRelation[]}):ReviewOriginResolution{
  const {review,attempts,aliases,relations}=args;
  const sourceAttemptId=Number(review.source_attempt_id||review.generated_from_attempt_id||0);
  const sourceAttempt=attempts.find(row=>row.id===sourceAttemptId);
  const target=canonical(review.target_problem_id||review.problem_id,aliases);
  const source=canonical(review.source_problem_id||sourceAttempt?.problem_id||"",aliases);
  const relation=source&&target&&source!==target?verifiedRelation(relations,source,target,aliases):undefined;
  const scheduledIntegration=review.learning_purpose==="integration_check";
  const scheduledTransfer=review.learning_purpose==="transfer_check";
  if(review.generated_from_past_session_id||review.parent_past_session_id){
    return {origin:"past_exam_attempt",valid:!!sourceAttempt&&source===target,
      reason:sourceAttempt&&source===target?"過去問セッション内の同一問題Attempt":"過去問Attemptと対象問題が一致しない",sourceAttempt,sourceProblemId:source,targetProblemId:target};
  }
  if(scheduledIntegration){
    return {origin:"integration_schedule",valid:!sourceAttempt||source===target,
      reason:!sourceAttempt||source===target?"同一問題の後日統合確認":"integrationのsourceとtargetが一致しない",sourceAttempt,sourceProblemId:source,targetProblemId:target};
  }
  if(scheduledTransfer){
    const valid=source===target||!!relation;
    return {origin:"transfer_schedule",valid,reason:valid?"同一問題またはverified relationによる転移":"転移先を裏付けるverified relationがない",
      sourceAttempt,relation,sourceProblemId:source,targetProblemId:target};
  }
  if(source&&source!==target){
    return {origin:"verified_linked_problem",valid:!!relation,reason:relation?"verified relationによる関連補修":"異なる問題を結ぶverified relationがない",
      sourceAttempt,relation,sourceProblemId:source,targetProblemId:target};
  }
  return {origin:"direct_attempt",valid:!!sourceAttempt&&source===target,
    reason:sourceAttempt&&source===target?"sourceとtargetのcanonical IDが一致":"direct attemptのsourceがないか対象と不一致",
    sourceAttempt,sourceProblemId:source,targetProblemId:target};
}

export type SourceRepairAction={
  reviewId:number;action:"keep"|"supersede"|"regenerate"|"needs_review";reason:string;
  patch?:Partial<Review>;replacement?:Omit<Review,"id">;
};
export type SourceRepairPreview={
  mismatchCount:number;verifiedRelationCount:number;supersededCount:number;regeneratedCount:number;
  needsReviewCount:number;unchangedCompletedCount:number;actions:SourceRepairAction[];
};

const incomplete=(status:string)=>!["done","completed","cancelled","superseded"].includes(String(status));
function latestOwnAttempt(target:string,attempts:Attempt[],aliases:ProblemAlias[]){
  return attempts.filter(row=>canonical(row.problem_id,aliases)===target)
    .sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
}

export function analyzeSourceMismatchRepair(args:{
  reviews:Review[];attempts:Attempt[];problems:Problem[];aliases:ProblemAlias[];relations:ProblemRelation[];
}):SourceRepairPreview{
  const {reviews,attempts,problems,aliases,relations}=args,actions:SourceRepairAction[]=[];
  let mismatchCount=0,verifiedRelationCount=0,supersededCount=0,regeneratedCount=0,needsReviewCount=0,unchangedCompletedCount=0;
  const pendingKeys=new Set(reviews.filter(row=>incomplete(row.status)).map(row=>row.deduplication_key).filter(Boolean));
  for(const review of reviews){
    if(!incomplete(review.status)){unchangedCompletedCount++;continue}
    const resolution=resolveReviewOrigin({review,attempts,aliases,relations});
    if(resolution.valid){
      if(resolution.origin==="verified_linked_problem"){
        verifiedRelationCount++;
        const relation=resolution.relation;
        const alreadyCurrent=review.origin==="verified_linked_problem"&&review.relation_id===relation?.relationId&&
          review.policy_version===REVIEW_ORIGIN_POLICY_VERSION&&review.targeted_parts?.length===1&&
          review.targeted_parts[0]===relation?.targetFocus;
        if(!alreadyCurrent&&relation){
          const deduplicationKey=`${resolution.targetProblemId}|verified_linked_problem|${relation.relationId}|${review.source_attempt_id||review.generated_from_attempt_id||0}|${REVIEW_ORIGIN_POLICY_VERSION}`;
          const supersedePatch:Partial<Review>={status:"superseded",exclude_from_planning:true,
            superseded_reason:"verified relationを現行ポリシーで再生成",superseded_by_policy_version:REVIEW_ORIGIN_POLICY_VERSION,
            origin:"verified_linked_problem"};
          if(pendingKeys.has(deduplicationKey)){
            supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:"現行ポリシーの関連補修が既にあります",patch:supersedePatch});
          }else{
            pendingKeys.add(deduplicationKey);regeneratedCount++;
            const replacement:Omit<Review,"id">={problem_id:resolution.targetProblemId,target_problem_id:resolution.targetProblemId,
              source_problem_id:resolution.sourceProblemId,relation_id:relation.relationId,origin:"verified_linked_problem",
              due_date:review.due_date,review_type:"targeted_patch",status:"pending",
              generated_from_attempt_id:review.source_attempt_id||review.generated_from_attempt_id,
              source_attempt_id:review.source_attempt_id||review.generated_from_attempt_id,
              duration_minutes:5,estimated_minutes:5,reason:relation.reason,task_origin:"related_drill",attempt_exists:false,
              review_scope:"targeted_patch",effective_review_scope:"targeted_patch",targeted_parts:[relation.targetFocus],
              scope_completion_conditions:[`${relation.targetFocus}を参照なしで確認した`],effective_mode:"check",sheet_type:"check_sheet",
              learning_purpose:"error_repair",learning_stage:"repair",assessment_timing:"delayed_retrieval",
              target_kind:"mathematical_patch",required_evidence:[relation.targetFocus],policy_version:REVIEW_ORIGIN_POLICY_VERSION,
              deduplication_key:deduplicationKey,generated_at:new Date().toISOString(),retention_eligible:true};
            actions.push({reviewId:review.id,action:"regenerate",reason:"verified relationのtargetFocusだけから再生成",
              patch:supersedePatch,replacement});
          }
        }
      }
      continue;
    }
    mismatchCount++;
    const target=resolution.targetProblemId,problem=problems.find(row=>canonical(row.problem_id,aliases)===target);
    const own=latestOwnAttempt(target,attempts,aliases);
    const supersedePatch:Partial<Review>={status:"superseded",exclude_from_planning:true,
      superseded_reason:resolution.reason,superseded_by_policy_version:REVIEW_ORIGIN_POLICY_VERSION};
    if(!problem||!own){
      supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:resolution.reason,patch:supersedePatch});continue;
    }
    const validity=classifyKPolicyValidity(own);
    if(validity==="needs_review"){
      needsReviewCount++;actions.push({reviewId:review.id,action:"needs_review",reason:"対象問題自身のK根拠を自動判定できない",patch:{...supersedePatch,review_needed_reason:"対象問題自身のK根拠を確認してください"}});continue;
    }
    const errors=planningErrorsForSource(own);
    if(!errors.length){
      supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:"対象問題自身に現行計画へ使える弱点がない",patch:supersedePatch});continue;
    }
    const prescription=resolveLearningPolicy({problemId:target,problem,source:{...own,learning_purpose:"error_repair",assessment_timing:"delayed_retrieval"}});
    if(!prescription.effectiveErrorTypes.length){
      supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:"invalid legacy K以外の有効な弱点がない",patch:supersedePatch});continue;
    }
    const draft=taskDraftFromPrescription({prescription,sourceAttemptId:own.id,sourceDate:own.date,errors:prescription.effectiveErrorTypes});
    if(pendingKeys.has(draft.deduplicationKey)){
      supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:"対象問題自身から生成済みの現行タスクがある",patch:supersedePatch});continue;
    }
    pendingKeys.add(draft.deduplicationKey);regeneratedCount++;
    const replacement:Omit<Review,"id">={problem_id:target,target_problem_id:target,due_date:draft.dueDate,
      review_type:prescription.reviewScope,status:"pending",generated_from_attempt_id:own.id,source_attempt_id:own.id,
      duration_minutes:prescription.estimatedMinutes,estimated_minutes:prescription.estimatedMinutes,
      reason:prescription.schedulingReason,task_origin:"review_attempt",attempt_exists:true,origin:"direct_attempt",
      review_scope:prescription.reviewScope,effective_review_scope:prescription.reviewScope,targeted_parts:prescription.targetedParts,
      scope_completion_conditions:prescription.completionConditions,effective_mode:prescription.mode==="exam_90min"?"full":prescription.mode,
      sheet_type:prescription.sheetType,learning_purpose:prescription.learningPurpose,learning_stage:prescription.learningStage,
      assessment_timing:prescription.assessmentTiming,target_kind:prescription.targetKind,required_evidence:prescription.requiredEvidence,
      policy_version:prescription.policyVersion,deduplication_key:draft.deduplicationKey,earliest_date:draft.window.earliestDate,
      preferred_date:draft.window.preferredDate,latest_date:draft.window.latestDate,generated_at:new Date().toISOString(),
      retention_eligible:true,success_transition:prescription.successTransition,failure_transition:prescription.failureTransition};
    actions.push({reviewId:review.id,action:"regenerate",reason:"誤ったsourceを継承せず対象問題自身の最新Attemptから独立再生成",
      patch:supersedePatch,replacement});
  }
  return {mismatchCount,verifiedRelationCount,supersededCount,regeneratedCount,needsReviewCount,unchangedCompletedCount,actions};
}
