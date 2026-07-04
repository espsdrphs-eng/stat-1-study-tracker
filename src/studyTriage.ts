import type { Problem, Task } from "./types.ts";

export type TriageKey="must"|"if_time"|"tomorrow";

function errorsFor(task:Task){
  return new Set([...(task.previous_errors||[]),task.error_type||""].filter(Boolean));
}

export function taskPriority(task:Task,problem?:Problem){
  const errors=errorsFor(task);
  if(errors.has("K")) return 0;
  if(errors.has("N")) return 1;
  const linkedPast=!!problem&&(problem.category==="A")&&(
    problem.strategy_rank==="A+"||!!problem.linked_past_exam_ids?.length||!!problem.linked_past_exams
  );
  if(linkedPast) return 2;
  if(errors.has("W")) return 3;
  if(errors.has("C")) return 4;
  if(task.kind.includes("S")) return 6;
  return 5;
}

export function triageTodayTasks(tasks:Task[],targetMinutes:number,problems:Problem[]){
  const problemMap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  if(tasks.reduce((sum,task)=>sum+task.minutes,0)<=targetMinutes){
    const assigned=tasks.map(task=>({...task,triage:"must" as TriageKey}));
    return {tasks:assigned,minutes:{must:assigned.reduce((sum,task)=>sum+task.minutes,0),if_time:0,tomorrow:0}};
  }
  const ranked=tasks.map((task,index)=>({task,index,priority:taskPriority(task,problemMap.get(task.problem_id))}))
    .sort((a,b)=>a.priority-b.priority||a.index-b.index);
  const buckets=new Map<number,TriageKey>();
  let mustMinutes=0,ifTimeMinutes=0,tomorrowMinutes=0;
  let lowerPriorityDeferred=false;
  for(const row of ranked){
    if(row.priority<=2){
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
  return {
    tasks:tasks.map((task,index)=>({...task,triage:buckets.get(index)||"tomorrow"})),
    minutes:{must:mustMinutes,if_time:ifTimeMinutes,tomorrow:tomorrowMinutes}
  };
}
