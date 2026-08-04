import type { AdaptivePlanDay, Problem, Review, Task } from "./types.ts";
import { taskFieldsFromContract } from "./gradingContract.ts";
import { reviewExecutionState } from "./integrityEngine.ts";

export const ADAPTIVE_PLANNER_VERSION="adaptive-v1";

function taskMode(kind:AdaptivePlanDay["tasks"][number]["kind"]){
  if(kind==="scan5")return "scan5";
  if(kind==="timed")return "full";
  if(kind==="full"||kind==="past_exam")return "full";
  return "skeleton";
}

function logicalKey(task:Task){
  return task.id?`review:${task.id}`:
    `${task.problem_id}|${task.learning_purpose||task.purpose_label||task.kind}|${task.mode}|${task.triage}`;
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
    if(item.kind==="exposure_confirmation"||item.requiresUserSelection)continue;
    if(item.kind==="review"){
      const review=item.reviewId?reviewMap.get(item.reviewId):
        args.reviews.filter(row=>row.problem_id===item.problemId&&reviewExecutionState(row,args.today)==="actionable")
          .sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id-b.id)[0];
      if(!review||reviewExecutionState(review,args.today)!=="actionable")continue;
      const problem=problemMap.get(review.problem_id);
      const contract=review.grading_contract;
      result.push({
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
        triage:"must",
        plan_origin:"adaptive_planner",
        purpose_label:"局所補修",
      });
      continue;
    }
    if(!item.problemId)continue;
    const problem=problemMap.get(item.problemId);
    if(!problem)continue;
    const mode=item.mode||taskMode(item.kind);
    result.push({
      problem_id:item.problemId,
      title:problem.display_label||problem.title||item.label,
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
    });
  }
  const seen=new Set<string>();
  return result.filter(task=>{
    const key=logicalKey(task);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
