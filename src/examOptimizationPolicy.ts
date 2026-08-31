import type {AssessmentTiming,Attempt,GradedPartContract,LearningPurpose,Review,Task} from "./types.ts";
import {addCalendarDays} from "./reviewSchedulePolicy.ts";

export type ExamHorizonPhase="foundation_to_A"|"A_and_past_parallel"|"past_exam_main"|"final_stabilization";
export type FailureStrength="standard"|"strong"|"level1_collapse";

export type ExamHorizonPolicy={
  phase:ExamHorizonPhase;pastExamShareMin:number;pastExamShareMax:number;
  allowNewWhitebook:boolean;pastExamIsPrimary:boolean;
};

export type LearningPolicy=ExamHorizonPolicy&{
  examPracticeTargetRange:{min:number;max:number};
  requiredRepairPolicy:"evidence_linked_major_only";
  maintenancePolicy:"required"|"optional_deferred";
  sessionPolicy:"problem_drill"|"scan_plus_individual"|"past_exam_session"|"simulation";
  holdoutPolicy:{years:number[];released:boolean};
};

/** Canonical learning policy used by Today, all forecasts, Dashboard and audit. */
export function deriveLearningPolicy(daysRemaining:number,_evidence?:unknown):LearningPolicy{
  const base=daysRemaining>=91?
    {phase:"foundation_to_A" as const,min:.1,max:.3,allowNewWhitebook:true,pastExamIsPrimary:false,sessionPolicy:"problem_drill" as const}:
    daysRemaining>=81?
      {phase:"A_and_past_parallel" as const,min:.3,max:.4,allowNewWhitebook:true,pastExamIsPrimary:false,sessionPolicy:"scan_plus_individual" as const}:
      daysRemaining>=31?
        {phase:"past_exam_main" as const,min:.65,max:.7,allowNewWhitebook:false,pastExamIsPrimary:true,sessionPolicy:"past_exam_session" as const}:
        {phase:"final_stabilization" as const,min:.7,max:.9,allowNewWhitebook:false,pastExamIsPrimary:true,sessionPolicy:"simulation" as const};
  return {...base,pastExamShareMin:base.min,pastExamShareMax:base.max,
    examPracticeTargetRange:{min:base.min,max:base.max},requiredRepairPolicy:"evidence_linked_major_only",
    maintenancePolicy:base.pastExamIsPrimary?"optional_deferred":"required",
    holdoutPolicy:{years:[2024,2025],released:daysRemaining<=30}};
}

/** Backward-compatible facade. There is still only one underlying policy. */
export function examHorizonPolicy(daysRemaining:number):ExamHorizonPolicy{
  const policy=deriveLearningPolicy(daysRemaining);
  return {phase:policy.phase,pastExamShareMin:policy.pastExamShareMin,pastExamShareMax:policy.pastExamShareMax,
    allowNewWhitebook:policy.allowNewWhitebook,pastExamIsPrimary:policy.pastExamIsPrimary};
}

export function classifyFailureStrength(args:{masteryLevel:1|2|3;unresolvedTargetCount:number;
  repeatedFailureCount?:number;errorTypes?:string[]}):FailureStrength{
  if(args.masteryLevel===1||(args.errorTypes||[]).includes("K"))return "level1_collapse";
  if(args.unresolvedTargetCount>=2||Number(args.repeatedFailureCount||0)>0)return "strong";
  return "standard";
}

export type RetentionWindowDecision={
  earliestDate:string;preferredDate:string;latestDate:string;scheduleSameProblem:boolean;reason:string;
};

/**
 * Feedback is immediate, but the graded test is delayed. The window depends on
 * learning evidence and exam horizon; no prompt or UI owns a fixed interval.
 */
export function retentionWindow(args:{
  sourceDate:string;daysRemaining:number;masteryLevel:1|2|3;failureStrength:FailureStrength;
  repeatedFailureCount?:number;examRelevance?:"low"|"medium"|"high";
  strategyRank?:string;alternativeTransferOpportunity?:boolean;transferAlreadySucceeded?:boolean;
}):RetentionWindowDecision{
  if(args.transferAlreadySucceeded)return {earliestDate:"",preferredDate:"",latestDate:"",scheduleSameProblem:false,
    reason:"別問題・本番形式で同じ能力のtransfer成功を確認済み"};
  const lowValue=args.examRelevance==="low"&&!['S','SS','A+'].includes(String(args.strategyRank||""));
  if(lowValue&&args.alternativeTransferOpportunity)return {earliestDate:"",preferredDate:"",latestDate:"",
    scheduleSameProblem:false,reason:"低ROIのsame-problem反復より別問題のtransferを優先"};
  const urgent=args.failureStrength!=="standard"||Number(args.repeatedFailureCount||0)>0||args.examRelevance==="high";
  let early:number,preferred:number,late:number;
  if(urgent){[early,preferred,late]=[1,2,3];}
  else if(args.daysRemaining<=30){[early,preferred,late]=[1,2,4];}
  else if(args.daysRemaining<=80){[early,preferred,late]=[2,4,6];}
  else {[early,preferred,late]=[3,5,7];}
  return {earliestDate:addCalendarDays(args.sourceDate,early),preferredDate:addCalendarDays(args.sourceDate,preferred),
    latestDate:addCalendarDays(args.sourceDate,late),scheduleSameProblem:true,
    reason:urgent?"強い失敗または高い本番関連度のため短い保持確認window":
      "即時訂正とは分離し、時間を空けた保持確認window"};
}

export function correctiveFeedbackAvailable(attempt:Partial<Attempt>){
  return !!attempt.saved_gpt_feedback||!!attempt.gpt_explanation||!!attempt.auto_imported||
    !!String(attempt.next_action||"").trim()||!!String(attempt.corrected_answer||"").trim()||
    !!attempt.observed_out_of_scope_findings?.some(row=>row.stable_target_key);
}

/** Existing explicitly graded repair remains valid; automatic new failures skip same-session retesting. */
export function reviewPurposeAfterCorrection(args:{attempt:Partial<Attempt>;explicitSameSessionRequested?:boolean}):LearningPurpose{
  void args;
  // Feedback describes the correction; it is never proof that the learner
  // reproduced it. A later explicit success event performs the transition.
  return "error_repair";
}

export function isSuccessfulTransferForProblem(attempt:Attempt,problemId:string){
  const clean=(attempt.error_types||[attempt.error_type]).every(error=>!['K','W','N','C'].includes(String(error)));
  return attempt.source_problem_id===problemId&&attempt.transfer_evidence===true&&clean&&
    attempt.review_outcome==="success"&&Number(attempt.actual_reference_level||0)===0;
}

const partKeys=(review?:Partial<Review>)=>[...(review?.grading_contract?.gradedParts||[])]
  .map(part=>part.stableTargetKey||part.stable_target_key||part.id).filter(Boolean).sort();

/** React/selectors must distinguish a stage transition on the same problem. */
export function currentActionFingerprint(task:Partial<Task>,review?:Partial<Review>){
  const purpose=review?.grading_contract?.learningPurpose||review?.learning_purpose||task.learning_purpose||task.purpose_label||task.kind||"";
  const mode=review?.grading_contract?.mode||review?.effective_mode||task.effective_mode||task.mode||"";
  const level=review?.grading_contract?.gradedParts?.map(part=>part.masteryLevel).filter(Boolean).sort().join(",")||task.mastery_level||"";
  // Persisted row IDs are generation identity, not learning-action identity.
  // Legacy rows without a logical key fall back to immutable contract content.
  const logical=review?.logical_review_key||task.logical_review_key||review?.grading_contract?.contractHash||review?.contract_hash||"";
  const session=task.stable_session_key||[task.past_exam_task_type||"",task.past_exam_year||"",...(task.session_problem_ids||[])].join(":");
  const problemIdentity=task.stable_session_key?"past_exam_session":task.problem_id;
  return [problemIdentity,logical,level,purpose,mode,partKeys(review).join(","),session].join("|");
}

export function learningEventKind(args:{purpose?:LearningPurpose;timing?:AssessmentTiming;transferEvidence?:boolean;
  isAssessment?:boolean}):"assessment"|"corrective_feedback"|"delayed_retrieval"|"transfer"{
  if(args.transferEvidence||args.purpose==="transfer_check")return "transfer";
  if(args.timing==="delayed_retrieval"||args.purpose==="retrieval_check")return "delayed_retrieval";
  if(args.timing==="same_session_correction"||args.purpose==="error_repair"&&!args.isAssessment)return "corrective_feedback";
  return "assessment";
}

export function masteryLevelForTargets(parts:GradedPartContract[],errors:string[]):1|2|3{
  if(parts.some(part=>part.masteryLevel===1)||errors.includes("K"))return 1;
  if(parts.some(part=>part.masteryLevel===3))return 3;
  return 2;
}
