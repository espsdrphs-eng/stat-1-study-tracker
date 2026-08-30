import type {Attempt,ConceptWeaknessInsight,Problem,Review,Task} from "./types.ts";
import {isSuccessfulTransferForProblem} from "./examOptimizationPolicy.ts";
import {resolvePersistedAttemptLifecycle} from "./reviewTransition.ts";

export type TodayLearningCategory="exam_practice"|"repair";
export type CurrentActionClass="exam_practice"|"targeted_repair"|"maintenance";
export type ReviewDueState="upcoming"|"due_window"|"hard_overdue";
export type ReviewPlanningTier="high_value_repair"|"exceptional_maintenance"|"deferred_maintenance";

const errorTypes=(attempt?:Attempt)=>new Set([
  ...(attempt?.effective_error_types||attempt?.error_types||[]),attempt?.primary_error_type||attempt?.error_type||""
].filter(value=>["K","W","N","C"].includes(String(value))));

const reviewPurpose=(review:Partial<Review>)=>review.grading_contract?.learningPurpose||review.learning_purpose;

const isReviewTask=(task:Partial<Task>)=>!!task.review_type||!!task.id&&!!(
  task.grading_contract||task.learning_purpose||task.review_scope
);

export function reviewDueState(review:Partial<Review|Task>,today:string):ReviewDueState{
  const preferred=String(review.preferred_date||review.due_date||"");
  const latest=String(review.latest_date||preferred);
  if(preferred&&today<preferred)return "upcoming";
  if(latest&&today>latest)return "hard_overdue";
  return "due_window";
}

/**
 * Canonical user-facing meaning of an action. A problem's source is never
 * sufficient to classify a Review: a past-exam retrieval is still repair or
 * maintenance, not a new exam-performance event.
 */
export function deriveCurrentActionClass(task:Partial<Task>):CurrentActionClass{
  const purpose=String(task.grading_contract?.learningPurpose||task.learning_purpose||"");
  if(isReviewTask(task)){
    if(task.review_planning_tier==="deferred_maintenance")return "maintenance";
    if(purpose==="error_repair")return "targeted_repair";
    if(purpose==="retrieval_check")return task.review_planning_tier==="high_value_repair"||
      task.review_planning_tier==="exceptional_maintenance"||task.retention_pending===true||
      task.correction_provided===true||!!task.lifecycle_success_evidence_id?"targeted_repair":"maintenance";
    return "targeted_repair";
  }
  if(!!task.past_exam_task_type||["transfer_check","exam_performance"].includes(purpose)||
    ["past_exam","scan5","timed"].includes(String(task.kind||"")))return "exam_practice";
  return "targeted_repair";
}

export function isExamPracticeTask(task:Partial<Task>){
  return deriveCurrentActionClass(task)==="exam_practice";
}

export function todayLearningCategory(task:Partial<Task>):TodayLearningCategory{
  return deriveCurrentActionClass(task)==="exam_practice"?"exam_practice":"repair";
}

export function whyToday(task:Partial<Task>){
  const actionClass=deriveCurrentActionClass(task);
  if(actionClass==="exam_practice")return "初見・選題・時間内完遂・別問題への転移を測るため";
  if(actionClass==="maintenance")return "現在の本番演習と重要補修の後に、余力があれば保持を確認するため";
  if(task.review_type||task.learning_purpose)return "本番失点につながる弱点を局所補修し、再発を防ぐため";
  return "過去問・答案証拠で確認された弱点だけを補修するため";
}

/** Shared ordering for Current Today, Dashboard and planner diagnostics. */
export function deriveActionPriority(task:Partial<Task>,today:string){
  const actionClass=deriveCurrentActionClass(task);
  const purpose=String(task.grading_contract?.learningPurpose||task.learning_purpose||"");
  const hardOverdue=isReviewTask(task)&&reviewDueState(task,today)==="hard_overdue";
  const majorRepair=actionClass==="targeted_repair"&&(
    purpose==="error_repair"||task.review_planning_tier==="high_value_repair"
  );
  if(hardOverdue&&majorRepair)return 100;
  if(actionClass==="exam_practice"&&purpose!=="transfer_check")return 200;
  if(actionClass==="targeted_repair"&&isReviewTask(task))return 300;
  if(purpose==="transfer_check")return 400;
  if(actionClass==="maintenance")return 500;
  return 600;
}

export function projectCanonicalActionTask(task:Task,today:string):Task{
  const actionClass=deriveCurrentActionClass(task),maintenance=actionClass==="maintenance";
  return {...task,action_class:actionClass,
    review_due_state:isReviewTask(task)?reviewDueState(task,today):undefined,
    today_category:actionClass==="exam_practice"?"exam_practice":"repair",
    why_today:whyToday({...task,action_class:actionClass}),
    triage:maintenance&&task.triage_override!=="must"?"tomorrow":task.triage};
}

export function prioritizeCurrentTodayTasks(tasks:Task[],today:string){
  const projected=tasks.map((task,index)=>({task:projectCanonicalActionTask(task,today),index}));
  const open=projected.filter(row=>!row.task.checked).sort((left,right)=>{
      const leftOptional=left.task.triage==="tomorrow"?1:0,rightOptional=right.task.triage==="tomorrow"?1:0;
      return leftOptional-rightOptional||
        deriveActionPriority(left.task,today)-deriveActionPriority(right.task,today)||left.index-right.index;
    });
  let cursor=0;
  // Completed rows retain their historical slot while every still-open slot is
  // filled from the one canonical priority order consumed by Today/Dashboard.
  return projected.map(row=>row.task.checked?row.task:open[cursor++].task);
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
  const sourceErrors=errorTypes(source);
  const isolatedMinorC=sourceErrors.size===1&&sourceErrors.has("C")&&source?.review_outcome!=="failed"&&
    !recurrence&&!source?.observed_out_of_scope_findings?.some(row=>row.materiality==="major"&&row.confidence!=="low");
  const pastExamOrigin=!!review.generated_from_past_session_id||!!review.parent_past_session_id||
    !!source?.parent_past_session_id||problem?.source_type==="past_exam";
  const activeTargets=review.grading_contract?.gradedParts?.length||review.graded_part_ids?.length||review.targeted_parts?.length||0;
  const explicitRetentionEvidence=!!review.lifecycle_success_evidence_id||
    /success|transfer|reproduction/.test(String(review.lifecycle_transition_provenance||""));
  const retentionPending=purpose==="retrieval_check"&&activeTargets>0&&
    (explicitRetentionEvidence||sourceMajor);

  if(review.triage_override==="must")return {tier:"high_value_repair",scheduleAsRequired:true,
    reason:"ユーザーが今日必須へ明示指定"};
  if(transferSucceeded)return {tier:"deferred_maintenance",scheduleAsRequired:false,
    reason:"別問題・本番形式の参照なし成功をmaintenance代替証拠として採用"};
  if(graduated&&purpose!=="error_repair")return {tier:"deferred_maintenance",scheduleAsRequired:false,
    reason:"保持済みでcurrent major targetがなく、経過日数だけでは必須化しない"};
  if(purpose==="error_repair"&&isolatedMinorC)return {tier:"deferred_maintenance",scheduleAsRequired:false,
    reason:"単発の表記・記号Cは本番得点を変える再発証拠がないため任意の短時間確認へ送る"};
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
