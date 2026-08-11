import type {Attempt,ProblemAlias,Task,TodayPlanSnapshot} from "./types.ts";
import {resolveCanonicalProblemId} from "./examReadiness.ts";

const scanModes=new Set(["scan","scan5","scan_only"]);

/** One shared mode relation for every Attempt -> Today Task projection. */
export function attemptModeSatisfiesTask(plannedMode:unknown,attemptMode:unknown){
  const planned=String(plannedMode||"check"),actual=String(attemptMode||"");
  const allowed:Record<string,Set<string>>={
    check:new Set(["check","skeleton","main_calc","full","exam_90min","timed"]),
    skeleton:new Set(["skeleton","full","exam_90min","timed"]),
    main_calc:new Set(["main_calc","full","exam_90min","timed"]),
    full:new Set(["full","exam_90min","timed"]),
    exam_90min:new Set(["exam_90min","timed"]),
    timed:new Set(["exam_90min","timed"]),
    scan5:new Set(["scan5","scan","scan_only"]),
  };
  return (allowed[planned]||new Set([planned])).has(actual);
}

function savedAfterSnapshot(attempt:Attempt,snapshot:TodayPlanSnapshot){
  const created=Date.parse(snapshot.created_at),saved=Date.parse(String(attempt.saved_at||""));
  if(Number.isFinite(created)&&Number.isFinite(saved))return saved>=created;
  // Legacy backups may not have saved_at. The local calendar date is their
  // only non-destructive evidence for rebuilding the current projection.
  return attempt.date===snapshot.date;
}

function coversReviewContract(task:Task,attempt:Attempt){
  const reviewId=Number(task.id||0);
  if(Number(attempt.source_review_id||attempt.generated_from_review_id||0)!==reviewId)return false;
  if(task.contract_hash&&attempt.contract_hash&&task.contract_hash!==attempt.contract_hash)return false;
  const required=new Set(task.grading_contract?.gradedParts.map(part=>part.id)||task.graded_part_ids||[]);
  const evaluated=new Set((attempt.graded_findings||[]).map(row=>row.graded_part_id));
  if(!evaluated.size)for(const id of attempt.graded_part_ids||[])evaluated.add(id);
  return [...required].every(id=>evaluated.has(id));
}

export function qualifyingAttemptForTodayTask(args:{
  task:Task;attempts:Attempt[];snapshot:TodayPlanSnapshot;aliases?:ProblemAlias[];
}){
  const aliases=args.aliases||[],taskProblem=resolveCanonicalProblemId(args.task.problem_id,aliases);
  return args.attempts.filter(attempt=>!attempt.duplicate_of_attempt_id&&
    resolveCanonicalProblemId(attempt.problem_id,aliases)===taskProblem&&attempt.date===args.snapshot.date&&
    savedAfterSnapshot(attempt,args.snapshot)&&attemptModeSatisfiesTask(args.task.mode,attempt.mode)&&
    (!scanModes.has(String(attempt.mode||""))||scanModes.has(String(args.task.mode||"")))&&
    (!args.task.review_type||coversReviewContract(args.task,attempt)))
    .sort((left,right)=>right.id-left.id)[0];
}

export function projectTodayTaskChecked(args:{
  task:Task;attempts:Attempt[];snapshot:TodayPlanSnapshot;aliases?:ProblemAlias[];manuallyChecked?:boolean;
}){
  return !!args.manuallyChecked||!!args.task.checked||!!qualifyingAttemptForTodayTask(args);
}
