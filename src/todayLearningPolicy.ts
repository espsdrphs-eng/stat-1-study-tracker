import type {Attempt,ConceptWeaknessInsight,Problem,Review,Task} from "./types.ts";
import {isSuccessfulTransferForProblem} from "./examOptimizationPolicy.ts";
import {resolvePersistedAttemptLifecycle} from "./reviewTransition.ts";

export type TodayLearningCategory="exam_practice"|"repair";
export type ReviewPlanningTier="high_value_repair"|"exceptional_maintenance"|"deferred_maintenance";

const errorTypes=(attempt?:Attempt)=>new Set([
  ...(attempt?.effective_error_types||attempt?.error_types||[]),attempt?.primary_error_type||attempt?.error_type||""
].filter(value=>["K","W","N","C"].includes(String(value))));

const reviewPurpose=(review:Partial<Review>)=>review.grading_contract?.learningPurpose||review.learning_purpose;

export function isExamPracticeTask(task:Partial<Task>){
  return !!task.past_exam_task_type||/^PY-/.test(String(task.problem_id||""))||
    ["transfer_check","exam_performance"].includes(String(task.learning_purpose||""))||
    /(?:過去問|本番|scan|timed|初見|転移)/i.test(`${task.kind||""} ${task.purpose_label||""}`);
}

export function todayLearningCategory(task:Partial<Task>):TodayLearningCategory{
  return isExamPracticeTask(task)?"exam_practice":"repair";
}

export function whyToday(task:Partial<Task>){
  if(todayLearningCategory(task)==="exam_practice")return "初見・選題・時間内完遂・別問題への転移を測るため";
  if(task.review_type||task.learning_purpose)return "本番失点につながる弱点を局所補修し、再発を防ぐため";
  return "過去問・答案証拠で確認された弱点だけを補修するため";
}

/**
 * Review history and lifecycle remain immutable. This decision only controls
 * whether an actionable Review consumes the current planner's required repair
 * budget. Elapsed time alone is never enough to make maintenance required.
 */
export function reviewPlanningDecision(args:{
  review:Review;attempts:Attempt[];problems:Problem[];weaknesses:ConceptWeaknessInsight[];
}):{tier:ReviewPlanningTier;scheduleAsRequired:boolean;reason:string}{
  const {review}=args,purpose=reviewPurpose(review);
  const sourceId=review.grading_contract?.sourceAttemptId||review.source_attempt_id||review.generated_from_attempt_id;
  const source=args.attempts.find(attempt=>attempt.id===sourceId);
  const problem=args.problems.find(row=>row.problem_id===review.problem_id);
  const conceptIds=new Set(problem?.fine_concept_ids||[]);
  const related=args.weaknesses.filter(row=>conceptIds.has(row.conceptId));
  const recurrence=related.some(row=>row.recurrenceCount>0||row.state==="relapsed");
  const highExamValue=related.some(row=>row.pastExamFailureCount>0||row.examImportance>=60);
  const transferSucceeded=args.attempts.some(attempt=>
    (!source||attempt.date>=source.date)&&isSuccessfulTransferForProblem(attempt,review.problem_id)
  )||related.some(row=>row.state==="resolved"&&row.transferSuccesses>0);
  const graduated=!!source&&resolvePersistedAttemptLifecycle(source).graduated;
  const sourceMajor=errorTypes(source).size>0||source?.review_outcome==="failed"||
    !!source?.observed_out_of_scope_findings?.some(row=>row.materiality==="major"&&row.confidence!=="low");
  const pastExamOrigin=!!review.generated_from_past_session_id||!!review.parent_past_session_id||
    !!source?.parent_past_session_id||problem?.source_type==="past_exam";
  const activeTargets=review.grading_contract?.gradedParts?.length||review.graded_part_ids?.length||review.targeted_parts?.length||0;
  const retentionPending=purpose==="retrieval_check"&&activeTargets>0&&
    (review.retention_pending===true||review.correction_provided===true||source?.mark==="○"||sourceMajor);

  if(review.triage_override==="must")return {tier:"high_value_repair",scheduleAsRequired:true,
    reason:"ユーザーが今日必須へ明示指定"};
  if(transferSucceeded)return {tier:"deferred_maintenance",scheduleAsRequired:false,
    reason:"別問題・本番形式の参照なし成功をmaintenance代替証拠として採用"};
  if(graduated&&purpose!=="error_repair")return {tier:"deferred_maintenance",scheduleAsRequired:false,
    reason:"保持済みでcurrent major targetがなく、経過日数だけでは必須化しない"};
  if(purpose==="error_repair")return {tier:"high_value_repair",scheduleAsRequired:true,
    reason:"未解決targetの局所補修"};
  if(retentionPending)return {tier:"high_value_repair",scheduleAsRequired:true,
    reason:pastExamOrigin?"過去問由来major targetの遅延保持を未確認":"major targetの修復後保持を未確認"};
  if((recurrence||pastExamOrigin||highExamValue)&&activeTargets>0)return {
    tier:"exceptional_maintenance",scheduleAsRequired:true,
    reason:recurrence?"独立問題で同じ弱点が再発":"本番関連度の高いcurrent targetを再確認"
  };
  return {tier:"deferred_maintenance",scheduleAsRequired:false,
    reason:"日数経過だけの一般maintenanceは本番演習・確認済み補修より後方へ送る"};
}
