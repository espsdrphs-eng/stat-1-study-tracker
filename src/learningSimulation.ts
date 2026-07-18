import type { Problem, Task } from "./types.ts";
import { triageTodayTasks } from "./studyTriage.ts";
import { addCalendarDays, weeklySoftQuota } from "./taskScheduler.ts";

export function simulateThirtyDays(args:{startDate:string;tasks:Task[];problems:Problem[];targetMinutes:number;pastSessions?:Array<Record<string,unknown>>}){
  const seenKeys=new Set<string>();
  const completedTaskKeys=new Set<string>();
  let duplicateTransitions=0,maxMust=0,maxOptional=0,limitViolations=0;
  const purposeCounts={fullSkeleton:0,timedFull:0,scan5:0};
  for(const task of args.tasks){
    if(!task.deduplication_key)continue;
    if(seenKeys.has(task.deduplication_key))duplicateTransitions++;else seenKeys.add(task.deduplication_key);
  }
  for(let offset=0;offset<30;offset++){
    const date=addCalendarDays(args.startDate,offset);
    const due=args.tasks.filter((task,index)=>(!task.due_date||task.due_date<=date)&&!completedTaskKeys.has(String(task.id??task.deduplication_key??index)));
    const triage=triageTodayTasks(due,args.targetMinutes,args.problems,date);
    const must=triage.tasks.filter(task=>task.triage==="must"),optional=triage.tasks.filter(task=>task.triage==="if_time");
    maxMust=Math.max(maxMust,must.length);maxOptional=Math.max(maxOptional,optional.length);
    if(triage.minutes.must+triage.minutes.if_time>args.targetMinutes)limitViolations++;
    for(const task of [...must,...optional]){
      completedTaskKeys.add(String(task.id??task.deduplication_key??args.tasks.indexOf(task)));
      if(task.review_scope==="full_skeleton")purposeCounts.fullSkeleton++;
      if(["full","exam_90min"].includes(task.mode))purposeCounts.timedFull++;
      if(task.mode==="scan5")purposeCounts.scan5++;
    }
  }
  const quotas=weeklySoftQuota({attempts:[],pastSessions:args.pastSessions||[],weekStart:args.startDate});
  return {days:30,maxMust,maxOptional,limitViolations,duplicateTransitions,purposeCounts,softQuotaObservation:quotas};
}
