import type {Attempt,PastSession,ProblemAlias,Review,Task,TodayPlanSnapshot} from "./types.ts";
import {projectAdaptiveSnapshotTasks} from "./adaptiveTodayPlan.ts";
import {deriveCurrentTodayState,qualifyingAttemptForTodayTask,qualifyingPastSessionForTodayTask} from "./todayTaskProjection.ts";
import {reviewExecutionState} from "./reviewCurrentState.ts";
import {resolveCurrentTaskSelection,currentTaskIdentity} from "./examOptimizationPolicy.ts";
import {resolveCanonicalProblemId} from "./examReadiness.ts";

/** Canonical read-time projection. The start-of-day snapshot is never mutated. */
export function deriveCurrentTodayProjection(args:{
  snapshot:TodayPlanSnapshot;generatedTasks:Task[];attempts:Attempt[];pastSessions?:PastSession[];reviews:Review[];today:string;
  aliases?:ProblemAlias[];completedMinutes:number;targetMinutes:number;
  manuallyChecked?:(task:Task)=>boolean;hydrateTask?:(task:Task)=>Task;adaptive?:boolean;ranked?:boolean;
  includeTask?:(task:Task)=>boolean;
}){
  const isCompleted=(task:Task)=>!!args.manuallyChecked?.(task)||!!qualifyingAttemptForTodayTask({
    task,attempts:args.attempts,snapshot:args.snapshot,aliases:args.aliases,
  })||!!qualifyingPastSessionForTodayTask({task,pastSessions:args.pastSessions,snapshot:args.snapshot});
  // In ranked mode the snapshot is only history, never eligibility or order.
  // Completed historical rows can be displayed, but cannot become executable.
  const selected=args.ranked?[...args.generatedTasks,...args.snapshot.tasks.filter(task=>isCompleted(task)&&
    !args.generatedTasks.some(t=>currentTaskIdentity(t)===currentTaskIdentity(task)))]:args.adaptive===false?args.snapshot.tasks:projectAdaptiveSnapshotTasks({
    snapshotTasks:args.snapshot.tasks,generatedTasks:args.generatedTasks,reviews:args.reviews,today:args.today,
    aliases:args.aliases,isCompleted,
  });
  const reviewMap=new Map(args.reviews.map(review=>[review.id,review]));
  const tasks=selected.filter(task=>(args.ranked&&isCompleted(task)||!task.id||!task.review_type||reviewExecutionState(reviewMap.get(task.id),args.today)==="actionable")&&
    (args.includeTask?.(task)??true)).map(task=>args.ranked?task:args.hydrateTask?.(task)||task);
  const exclusions=resolveCurrentTaskSelection(args.generatedTasks,id=>resolveCanonicalProblemId(id,args.aliases||[]),isCompleted).exclusions;
  return {...deriveCurrentTodayState({tasks,attempts:args.attempts,pastSessions:args.pastSessions,snapshot:args.snapshot,aliases:args.aliases,
    manuallyChecked:args.manuallyChecked,completedMinutes:args.completedMinutes,targetMinutes:args.targetMinutes}),exclusions};
}
