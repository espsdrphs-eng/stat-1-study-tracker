import type { Attempt, Problem, Review } from "./types.ts";
import { LEARNING_POLICY_VERSION, resolveLearningPolicy } from "./learningPolicyResolver.ts";
import { classifyKPolicyValidity, type KPolicyValidity } from "./legacyKPolicy.ts";
import { taskDraftFromPrescription } from "./taskScheduler.ts";

export type LegacyKAttemptClassification={attemptId:number;problemId:string;validity:KPolicyValidity};
export type LegacyKTaskAction={
  reviewId:number;action:"supersede"|"resolve";sourceAttemptId:number;patch:Partial<Review>;
};
export type LegacyKReorganization={
  classifications:LegacyKAttemptClassification[];
  invalidLegacyKCount:number;needsReviewCount:number;supersededTaskCount:number;resolvedTaskCount:number;
  taskActions:LegacyKTaskAction[];
};

const pendingStatus=(status:string)=>!["done","completed","cancelled","ignored","superseded"].includes(status);
const intervalDays=(from:string,to:string)=>Math.max(0,Math.round((Date.parse(`${to}T12:00:00Z`)-Date.parse(`${from}T12:00:00Z`))/86400000));

export function analyzeLegacyKReorganization(args:{attempts:Attempt[];reviews:Review[];problems:Problem[]}):LegacyKReorganization{
  const classifications=args.attempts.filter(attempt=>[...(attempt.error_types||[]),attempt.primary_error_type||attempt.error_type].includes("K"))
    .map(attempt=>({attemptId:attempt.id,problemId:attempt.problem_id,validity:classifyKPolicyValidity(attempt)}));
  const validityByAttempt=new Map(classifications.map(row=>[row.attemptId,row.validity]));
  const attemptById=new Map(args.attempts.map(attempt=>[attempt.id,attempt]));
  const problemById=new Map(args.problems.map(problem=>[problem.problem_id,problem]));
  const taskActions:LegacyKTaskAction[]=[];
  const seenKeys=new Set<string>();
  for(const review of args.reviews.filter(review=>pendingStatus(review.status))){
    const sourceAttemptId=Number(review.source_attempt_id||review.generated_from_attempt_id||0);
    const source=attemptById.get(sourceAttemptId),validity=validityByAttempt.get(sourceAttemptId);
    if(!source||validity!=="invalid_legacy_k")continue;
    const problem=problemById.get(review.problem_id);
    if(!problem)continue;
    const prescription=resolveLearningPolicy({problemId:review.problem_id,problem,source:{...source,...review,
      policy_validity:validity,learning_purpose:review.learning_purpose||"error_repair",
      assessment_timing:review.assessment_timing||"delayed_retrieval"},
      learningPurpose:review.learning_purpose||"error_repair",assessmentTiming:review.assessment_timing||"delayed_retrieval"});
    if(!prescription.effectiveErrorTypes.length){
      taskActions.push({reviewId:review.id,action:"supersede",sourceAttemptId,patch:{status:"superseded",
        policy_validity:validity,exclude_from_planning:true,exclude_from_recurrence_metrics:true,
        superseded_by_policy_version:LEARNING_POLICY_VERSION,superseded_reason:"旧ルーブリックの根拠なしKだけを根拠とする未完了タスク"}});
      continue;
    }
    const draft=taskDraftFromPrescription({prescription,sourceAttemptId,sourceDate:source.date,errors:prescription.effectiveErrorTypes});
    const alreadyResolved=review.policy_version===prescription.policyVersion&&review.deduplication_key===draft.deduplicationKey&&
      review.target_kind===prescription.targetKind&&review.review_scope===prescription.reviewScope&&
      JSON.stringify(review.targeted_parts||[])===JSON.stringify(prescription.targetedParts)&&review.due_date===draft.dueDate;
    if(alreadyResolved){seenKeys.add(draft.deduplicationKey);continue}
    if(seenKeys.has(draft.deduplicationKey)){
      taskActions.push({reviewId:review.id,action:"supersede",sourceAttemptId,patch:{status:"superseded",
        policy_validity:validity,exclude_from_planning:true,exclude_from_recurrence_metrics:true,
        superseded_by_policy_version:LEARNING_POLICY_VERSION,superseded_reason:"現行ポリシーで同一の未完了修復タスクが既に存在する"}});
      continue;
    }
    seenKeys.add(draft.deduplicationKey);
    const interval=intervalDays(source.date,draft.dueDate);
    const targetText=prescription.targetedParts.join("、");
    taskActions.push({reviewId:review.id,action:"resolve",sourceAttemptId,patch:{
      status:review.status==="overdue"&&draft.dueDate>source.date?"pending":review.status,
      due_date:draft.dueDate,review_type:prescription.reviewScope,duration_minutes:prescription.estimatedMinutes,
      estimated_minutes:prescription.estimatedMinutes,interval_days:interval,
      reason:`現行ポリシーで${targetText}だけを局所補修する`,review_reason:`現行ポリシーで${targetText}だけを局所補修する`,
      review_method:prescription.mode==="main_calc"?"主要計算の局所補修":"局所数式補修",
      review_instruction:`${targetText}だけを確認し、骨格見出しや指定範囲外は採点しない。`,
      review_steps:prescription.targetedParts.map(part=>`${part}を自力で再現する`),
      review_scope:prescription.reviewScope,effective_review_scope:prescription.reviewScope,
      targeted_parts:prescription.targetedParts,scope_completion_conditions:prescription.completionConditions,
      inferred_mode:prescription.mode==="exam_90min"?"full":prescription.mode,
      effective_mode:prescription.mode==="exam_90min"?"full":prescription.mode,
      sheet_type:prescription.sheetType,target_kind:prescription.targetKind,
      required_evidence:prescription.requiredEvidence,learning_purpose:prescription.learningPurpose,
      learning_stage:prescription.learningStage,assessment_timing:prescription.assessmentTiming,
      policy_version:prescription.policyVersion,deduplication_key:draft.deduplicationKey,
      earliest_date:draft.window.earliestDate,preferred_date:draft.window.preferredDate,latest_date:draft.window.latestDate,
      policy_validity:validity,exclude_from_planning:false,exclude_from_recurrence_metrics:true,
      superseded_by_policy_version:LEARNING_POLICY_VERSION,derived_stale:true,
    }});
  }
  return {classifications,invalidLegacyKCount:classifications.filter(row=>row.validity==="invalid_legacy_k").length,
    needsReviewCount:classifications.filter(row=>row.validity==="needs_review").length,
    supersededTaskCount:taskActions.filter(row=>row.action==="supersede").length,
    resolvedTaskCount:taskActions.filter(row=>row.action==="resolve").length,taskActions};
}
