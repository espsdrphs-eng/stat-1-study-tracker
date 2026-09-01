import type {Attempt,PastSession,ProblemAlias,Task,TodayPlanSnapshot} from "./types.ts";
import {resolveCanonicalProblemId} from "./examReadiness.ts";
import {summarizeTodayTime} from "./todayPlan.ts";
import {prioritizeCurrentTodayTasks} from "./todayLearningPolicy.ts";
import {pastExamSessionKey,pastExamSessionPurpose} from "./pastExamPlanning.ts";

const scanModes=new Set(["scan","scan5","scan_only"]);

/** One shared mode relation for every Attempt -> Today Task projection. */
export function attemptModeSatisfiesTask(plannedMode:unknown,attemptMode:unknown){
  const planned=String(plannedMode||"check"),actual=String(attemptMode||"");
  const allowed:Record<string,Set<string>>={
    check:new Set(["check","skeleton","main_calc","full","exam_90min","timed"]),
    skeleton:new Set(["skeleton","main_calc","full","exam_90min","timed"]),
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

export function matchingPastSessionForTodayTask(args:{task:Task;pastSessions?:PastSession[];snapshot:TodayPlanSnapshot}){
  if(!args.task.past_exam_task_type)return undefined;
  const sameYear=(args.pastSessions||[]).filter(session=>Number(session.year||0)===Number(args.task.past_exam_year||0));
  const exact=args.task.stable_session_key?sameYear.filter(session=>pastExamSessionKey(session)===args.task.stable_session_key):[];
  const expectedPurposes=args.task.past_exam_task_type==="clean_scan5"||args.task.past_exam_task_type==="practice_scan5"?
    new Set(["clean_scan5","practice_scan5"]):new Set([args.task.past_exam_task_type]);
  const semantic=sameYear.filter(session=>expectedPurposes.has(pastExamSessionPurpose(session)))
    .sort((left,right)=>String(right.attempt_completed_at||right.date).localeCompare(String(left.attempt_completed_at||left.date))||right.id-left.id);
  return (exact.length?exact:semantic)[0];
}

export function qualifyingPastSessionForTodayTask(args:{task:Task;pastSessions?:PastSession[];snapshot:TodayPlanSnapshot}){
  const session=matchingPastSessionForTodayTask(args);
  if(!session)return undefined;
  if(args.task.past_exam_task_type==="clean_scan5"||args.task.past_exam_task_type==="practice_scan5")
    return Number(session.scan_minutes||0)>0?session:undefined;
  if(args.task.past_exam_task_type==="timed_three_question_session"||args.task.past_exam_task_type==="simulation")
    return session.session_kind==="selected_three_timed"&&
      Number(session.actual_total_minutes||0)>0&&(session.questions||[]).filter(row=>row.completed).length===3?session:undefined;
  return undefined;
}

export function projectTodayTaskChecked(args:{
  task:Task;attempts:Attempt[];pastSessions?:PastSession[];snapshot:TodayPlanSnapshot;aliases?:ProblemAlias[];manuallyChecked?:boolean;
}){
  // `task.checked` inside a persisted snapshot is historical display state,
  // not current execution evidence. Explicit completion metadata and a
  // qualifying Attempt are the only current sources of truth.
  if(args.manuallyChecked)return true;
  if(qualifyingPastSessionForTodayTask(args))return true;
  return !!qualifyingAttemptForTodayTask(args);
}

export function selectNextCurrentTodayTask(tasks:Task[]){
  const open=tasks.filter(task=>!task.checked&&task.triage!=="tomorrow");
  return open.find(task=>task.triage==="must")||open.find(task=>task.triage==="if_time")||open[0];
}

/** Canonical current projection consumed by Today, Dashboard, time totals and audit. */
export function deriveCurrentTodayState(args:{
  tasks:Task[];attempts:Attempt[];pastSessions?:PastSession[];snapshot:TodayPlanSnapshot;aliases?:ProblemAlias[];
  manuallyChecked?:(task:Task)=>boolean;completedMinutes:number;targetMinutes:number;
}){
  const tasks=prioritizeCurrentTodayTasks(args.tasks.map(task=>({...task,checked:projectTodayTaskChecked({
    task,attempts:args.attempts,pastSessions:args.pastSessions,snapshot:args.snapshot,aliases:args.aliases,
    manuallyChecked:args.manuallyChecked?.(task),
  })})),args.snapshot.date);
  const timeSummary=summarizeTodayTime(tasks,args.completedMinutes,args.targetMinutes,args.snapshot.start_of_day_planned_minutes);
  return {
    tasks,
    completedTasks:tasks.filter(task=>task.checked),
    remainingTasks:tasks.filter(task=>!task.checked),
    currentTask:selectNextCurrentTodayTask(tasks),
    timeSummary,
  };
}
