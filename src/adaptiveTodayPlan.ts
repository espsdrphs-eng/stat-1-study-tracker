import type { AdaptivePlanDay, Problem, ProblemAlias, Review, Task } from "./types.ts";
import { taskFieldsFromContract } from "./gradingContract.ts";
import { reviewExecutionState } from "./integrityEngine.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import {currentActionFingerprint} from "./examOptimizationPolicy.ts";
import {todayLearningCategory,whyToday} from "./todayLearningPolicy.ts";

export const ADAPTIVE_PLANNER_VERSION="adaptive-v1";

function taskMode(kind:AdaptivePlanDay["tasks"][number]["kind"]){
  if(kind==="scan5")return "scan5";
  if(kind==="timed")return "full";
  if(kind==="full"||kind==="past_exam")return "full";
  return "skeleton";
}

function logicalKey(task:Task){
  return currentActionFingerprint(task,task.id&&task.review_type?task:undefined);
}

/**
 * Converts one immutable adaptive-plan day into the only task representation
 * persisted in TodayPlanSnapshot. It never re-resolves a Review contract.
 */
export function adaptivePlanDayToTasks(args:{
  day:AdaptivePlanDay|undefined;problems:Problem[];reviews:Review[];today:string;
}):Task[]{
  if(!args.day)return [];
  const problemMap=new Map(args.problems.map(problem=>[problem.problem_id,problem]));
  const reviewMap=new Map(args.reviews.map(review=>[review.id,review]));
  const result:Task[]=[];
  for(const item of args.day.tasks){
    if(item.kind==="exposure_confirmation"||item.requiresUserSelection&&item.kind!=="review")continue;
    if(item.kind==="review"){
      const review=item.reviewId?reviewMap.get(item.reviewId):
        args.reviews.filter(row=>row.problem_id===item.problemId&&reviewExecutionState(row,args.today)==="actionable")
          .sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id-b.id)[0];
      if(!review||reviewExecutionState(review,args.today)!=="actionable")continue;
      const problem=problemMap.get(review.problem_id);
      const contract=review.grading_contract;
      const projected={
        ...review,
        ...(contract?taskFieldsFromContract(contract):{}),
        problem_id:review.problem_id,
        title:problem?.display_label||problem?.title||review.problem_id,
        theme:problem?.theme||"",
        canonical_problem_type:problem?.canonical_problem_type||problem?.theme||"",
        kind:"局所補修",
        reason:item.reason,
        mode:contract?.mode||review.effective_mode||review.inferred_mode||"check",
        minutes:item.minutes,
        load:0,
        triage:item.slot==="repair"?"must":"if_time",
        plan_origin:"adaptive_planner",
        purpose_label:item.slot==="repair"?"補修・再発防止":"追加の維持確認",
        review_planning_tier:item.reviewPlanningTier,
        repair_lineage:item.repairLineage,
        action_class:item.actionClass,
        today_category:item.todayCategory||"repair",
        why_today:item.whyToday||item.reason,
      } as Task;
      result.push(projected);
      continue;
    }
    if(!item.problemId)continue;
    const problem=problemMap.get(item.problemId);
    if(!problem)continue;
    const sessionTask=!!item.stableSessionKey||item.pastExamTaskType==="timed_three_question_session"||
      item.pastExamTaskType==="simulation";
    const mode=sessionTask?"exam_90min":(item.mode||taskMode(item.kind));
    const projected={
      problem_id:item.problemId,
      title:sessionTask?item.label:(problem.display_label||problem.title||item.label),
      theme:problem.theme,
      canonical_problem_type:problem.canonical_problem_type||problem.theme,
      canonical_keywords:problem.canonical_keywords||[],
      kind:item.slot==="score_building"?"得点形成":"維持・選択",
      reason:item.reason,
      mode,
      effective_mode:mode,
      minutes:item.minutes,
      load:0,
      triage:item.slot==="score_building"?"must":"if_time",
      plan_origin:"adaptive_planner",
      additional_candidate_key:item.taskKey,
      purpose_label:item.purposeLabel||(item.slot==="score_building"?"得点形成":"維持・選択"),
      past_exam_task_type:item.pastExamTaskType,
      past_exam_year:item.pastExamYear,
      session_problem_ids:item.sessionProblemIds,
      clean_selection_evidence:item.cleanSelectionEvidence,
      stable_session_key:item.stableSessionKey,
      past_exam_session_state:item.pastExamSessionState,
      session_workflow:item.sessionWorkflow,
      selected_year_reason:item.selectedYearReason,
      unseen_individual_problem_ids:item.unseenIndividualProblemIds,
      repair_lineage:item.repairLineage,
      today_category:item.todayCategory,
      why_today:item.whyToday,
    } as Task;
    projected.today_category=projected.today_category||todayLearningCategory(projected);
    projected.why_today=projected.why_today||whyToday(projected);
    result.push(projected);
  }
  const seen=new Set<string>();
  return result.filter(task=>{
    const key=logicalKey(task);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

const projectionKey=(task:Task)=>`${task.plan_origin||""}|${currentActionFingerprint(task,task.id&&task.review_type?task:undefined)}`;
const projectionSlot=(task:Task)=>task.id&&task.review_type?"repair":task.triage==="if_time"?"maintenance":"score";

/**
 * Keeps the immutable morning snapshot as history while replacing only tasks
 * whose current eligibility changed. Completed slots and explicit additional
 * tasks are retained; current Review placements are always added exactly once.
 */
export function projectAdaptiveSnapshotTasks(args:{
  snapshotTasks:Task[];generatedTasks:Task[];reviews:Review[];today:string;aliases?:ProblemAlias[];
  isCompleted?:(task:Task)=>boolean;
}){
  const aliases=args.aliases||[];
  const canonical=(id:string)=>resolveCanonicalProblemId(id,aliases);
  const activeReviews=args.reviews.filter(review=>reviewExecutionState(review,args.today)==="actionable"&&
    String(review.earliest_date||review.due_date)<=args.today);
  const activeReviewProblems=new Set(activeReviews.map(review=>canonical(review.problem_id)));
  const generated=[...args.generatedTasks],used=new Set<string>();
  const take=(predicate:(task:Task)=>boolean)=>{
    const row=generated.find(task=>!used.has(projectionKey(task))&&predicate(task));
    if(row)used.add(projectionKey(row));
    return row;
  };
  const projected:Task[]=[];
  for(const saved of args.snapshotTasks){
    if(saved.id&&saved.review_type){
      const exact=take(task=>task.id===saved.id);
      const replacement=exact||take(task=>!!task.id&&!!task.review_type&&canonical(task.problem_id)===canonical(saved.problem_id));
      if(replacement)projected.push(replacement);
      continue;
    }
    if(args.isCompleted?.(saved)||saved.plan_origin==="adaptive_additional"){
      projected.push(saved);continue;
    }
    const conflictsWithReview=activeReviewProblems.has(canonical(saved.problem_id));
    const exact=take(task=>projectionKey(task)===projectionKey(saved));
    if(exact&&!conflictsWithReview){projected.push(exact);continue;}
    const replacement=take(task=>projectionSlot(task)===projectionSlot(saved)&&
      !activeReviewProblems.has(canonical(task.problem_id)));
    if(replacement)projected.push(replacement);
  }
  // A newly urgent Review is current state, even if the morning snapshot had
  // no Review slot. It precedes generic work without mutating snapshot history.
  const missingGenerated=generated.filter(task=>!used.has(projectionKey(task)));
  for(const generatedTask of missingGenerated){
    used.add(projectionKey(generatedTask));
    if(generatedTask.id&&generatedTask.review_type)projected.unshift(generatedTask);
    else projected.push(generatedTask);
  }
  const openReviewProblems=new Set(projected.filter(task=>!args.isCompleted?.(task)&&task.id&&task.review_type)
    .map(task=>canonical(task.problem_id)));
  const seenGenericProblems=new Set<string>(),seenReviewIds=new Set<number>();
  return projected.filter(task=>{
    if(args.isCompleted?.(task))return true;
    const problemId=canonical(task.problem_id);
    if(task.id&&task.review_type){
      if(seenReviewIds.has(task.id))return false;
      seenReviewIds.add(task.id);return true;
    }
    if(openReviewProblems.has(problemId)||seenGenericProblems.has(problemId))return false;
    seenGenericProblems.add(problemId);
    return true;
  });
}
