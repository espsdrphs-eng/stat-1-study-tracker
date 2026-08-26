import type {Attempt,PastSession,ProblemAlias,Review,Task,TodayPlanSnapshot} from "./types.ts";
import {projectAdaptiveSnapshotTasks} from "./adaptiveTodayPlan.ts";
import {deriveCurrentTodayState,qualifyingAttemptForTodayTask,qualifyingPastSessionForTodayTask} from "./todayTaskProjection.ts";
import {reviewExecutionState} from "./reviewCurrentState.ts";

/** Canonical read-time projection. The start-of-day snapshot is never mutated. */
export function deriveCurrentTodayProjection(args:{
  snapshot:TodayPlanSnapshot;generatedTasks:Task[];attempts:Attempt[];pastSessions?:PastSession[];reviews:Review[];today:string;
  aliases?:ProblemAlias[];completedMinutes:number;targetMinutes:number;
  manuallyChecked?:(task:Task)=>boolean;hydrateTask?:(task:Task)=>Task;adaptive?:boolean;
  includeTask?:(task:Task)=>boolean;
}){
  const isCompleted=(task:Task)=>!!args.manuallyChecked?.(task)||!!qualifyingAttemptForTodayTask({
    task,attempts:args.attempts,snapshot:args.snapshot,aliases:args.aliases,
  })||!!qualifyingPastSessionForTodayTask({task,pastSessions:args.pastSessions,snapshot:args.snapshot});
  const selected=args.adaptive===false?args.snapshot.tasks:projectAdaptiveSnapshotTasks({
    snapshotTasks:args.snapshot.tasks,generatedTasks:args.generatedTasks,reviews:args.reviews,today:args.today,
    aliases:args.aliases,isCompleted,
  });
  const reviewMap=new Map(args.reviews.map(review=>[review.id,review]));
  const tasks=selected.filter(task=>(!task.id||!task.review_type||reviewExecutionState(reviewMap.get(task.id),args.today)==="actionable")&&
    (args.includeTask?.(task)??true)).map(task=>args.hydrateTask?.(task)||task);
  return deriveCurrentTodayState({tasks,attempts:args.attempts,pastSessions:args.pastSessions,snapshot:args.snapshot,aliases:args.aliases,
    manuallyChecked:args.manuallyChecked,completedMinutes:args.completedMinutes,targetMinutes:args.targetMinutes});
}
