import type { Problem, Task } from "./types.ts";

export type TriageKey="must"|"if_time"|"tomorrow";

function errorsFor(task:Task){
  return new Set([...(task.previous_errors||[]),task.error_type||""].filter(Boolean));
}

function overdueDays(task:Task,today:string){
  if(!today||!task.due_date||task.due_date>=today) return 0;
  return Math.max(1,Math.floor((new Date(`${today}T12:00:00`).getTime()-new Date(`${task.due_date}T12:00:00`).getTime())/86400000));
}

export function taskPriority(task:Task,problem?:Problem,today="",sourceProblem?:Problem){
  if(task.triage_override==="must") return -1;
  const errors=errorsFor(task);
  if(errors.has("K")) return 0;
  if(errors.has("N")) return 1;
  if(task.task_origin==="linked_s_check"){
    const urgentSource=sourceProblem&&(sourceProblem.strategy_rank==="A+"||!!sourceProblem.linked_past_exam_ids?.length||!!sourceProblem.linked_past_exams);
    return urgentSource?2:8;
  }
  const linkedPast=!!problem&&(problem.category==="A")&&(
    problem.strategy_rank==="A+"||!!problem.linked_past_exam_ids?.length||!!problem.linked_past_exams
  );
  if(linkedPast) return 2;
  if(overdueDays(task,today)>0) return 3;
  if(errors.has("W")) return 4;
  if(errors.has("C")) return 5;
  if(task.kind.includes("S")) return 7;
  return 6;
}

export function triageTodayTasks(tasks:Task[],targetMinutes:number,problems:Problem[],today=""){
  const problemMap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const enforceDailyLimits=(assigned:Task[])=>{
    let mainCount=0,longMustCount=0;
    return assigned.map(task=>{
      const priority=taskPriority(task,problemMap.get(task.problem_id),today,task.source_problem_id?problemMap.get(task.source_problem_id):undefined);
      const isMain=["full","exam_90min"].includes(task.mode)||task.minutes>=25;
      const isLong=task.minutes>=35;
      if(task.triage!=="must") return task;
      if(task.task_origin==="related_drill"&&priority>2) return {...task,triage:"tomorrow" as TriageKey};
      if(priority<=1) return task;
      if(isMain){
        mainCount++;
        if(mainCount>2) return {...task,triage:"if_time" as TriageKey};
      }
      if(isLong){
        longMustCount++;
        if(longMustCount>=3) return {...task,triage:"if_time" as TriageKey};
      }
      return task;
    });
  };
  if(tasks.reduce((sum,task)=>sum+task.minutes,0)<=targetMinutes){
    const assigned=enforceDailyLimits(tasks.map(task=>{
      const priority=taskPriority(task,problemMap.get(task.problem_id),today,task.source_problem_id?problemMap.get(task.source_problem_id):undefined);
      return {...task,triage:(priority<=3?"must":priority>=7?"tomorrow":"if_time") as TriageKey};
    }));
    return {tasks:assigned,minutes:{
      must:assigned.filter(task=>task.triage==="must").reduce((sum,task)=>sum+task.minutes,0),
      if_time:assigned.filter(task=>task.triage==="if_time").reduce((sum,task)=>sum+task.minutes,0),
      tomorrow:assigned.filter(task=>task.triage==="tomorrow").reduce((sum,task)=>sum+task.minutes,0)
    }};
  }
  const ranked=tasks.map((task,index)=>({task,index,priority:taskPriority(task,problemMap.get(task.problem_id),today,task.source_problem_id?problemMap.get(task.source_problem_id):undefined),overdue:overdueDays(task,today)}))
    .sort((a,b)=>a.priority-b.priority||b.overdue-a.overdue||a.index-b.index);
  const buckets=new Map<number,TriageKey>();
  let mustMinutes=0,ifTimeMinutes=0,tomorrowMinutes=0;
  let lowerPriorityDeferred=false;
  for(const row of ranked){
    if(row.priority<=1||row.priority===2&&row.task.minutes<=30){
      buckets.set(row.index,"must");mustMinutes+=row.task.minutes;
      continue;
    }
    if(!lowerPriorityDeferred&&mustMinutes+ifTimeMinutes+row.task.minutes<=targetMinutes){
      buckets.set(row.index,"if_time");ifTimeMinutes+=row.task.minutes;
    }else{
      lowerPriorityDeferred=true;
      buckets.set(row.index,"tomorrow");tomorrowMinutes+=row.task.minutes;
    }
  }
  const assigned=enforceDailyLimits(tasks.map((task,index)=>({...task,triage:buckets.get(index)||"tomorrow"})));
  return {
    tasks:assigned,
    minutes:{
      must:assigned.filter(task=>task.triage==="must").reduce((sum,task)=>sum+task.minutes,0),
      if_time:assigned.filter(task=>task.triage==="if_time").reduce((sum,task)=>sum+task.minutes,0),
      tomorrow:assigned.filter(task=>task.triage==="tomorrow").reduce((sum,task)=>sum+task.minutes,0)
    }
  };
}
