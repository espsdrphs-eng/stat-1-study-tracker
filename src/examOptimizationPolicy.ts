import type {AssessmentTiming,Attempt,GradedPartContract,LearningPurpose,Review,Task} from "./types.ts";
import {addCalendarDays} from "./reviewSchedulePolicy.ts";

export type ExamHorizonPhase="foundation_to_A"|"A_and_past_parallel"|"past_exam_main"|"final_stabilization";
export type FailureStrength="standard"|"strong"|"level1_collapse";

export type ExamHorizonPolicy={
  phase:ExamHorizonPhase;pastExamShareMin:number;pastExamShareMax:number;
  allowNewWhitebook:boolean;pastExamIsPrimary:boolean;
};

/** The single exam-horizon policy used by planning, diagnostics and audits. */
export function examHorizonPolicy(daysRemaining:number):ExamHorizonPolicy{
  if(daysRemaining>=91)return {phase:"foundation_to_A",pastExamShareMin:.1,pastExamShareMax:.3,
    allowNewWhitebook:true,pastExamIsPrimary:false};
  if(daysRemaining>=81)return {phase:"A_and_past_parallel",pastExamShareMin:.3,pastExamShareMax:.4,
    allowNewWhitebook:true,pastExamIsPrimary:false};
  if(daysRemaining>=31)return {phase:"past_exam_main",pastExamShareMin:.6,pastExamShareMax:.65,
    allowNewWhitebook:true,pastExamIsPrimary:true};
  return {phase:"final_stabilization",pastExamShareMin:.7,pastExamShareMax:.9,
    allowNewWhitebook:false,pastExamIsPrimary:true};
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
  if(args.explicitSameSessionRequested)return "error_repair";
  return correctiveFeedbackAvailable(args.attempt)?"retrieval_check":"error_repair";
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
  const session=[task.past_exam_task_type||"",task.past_exam_year||"",...(task.session_problem_ids||[])].join(":");
  return [task.problem_id,logical,level,purpose,mode,partKeys(review).join(","),session].join("|");
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
