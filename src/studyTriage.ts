import type { Problem, Task } from "./types.ts";

export type TriageKey="must"|"if_time"|"tomorrow";

function errorsFor(task:Task){return new Set([...(task.previous_errors||[]),task.error_type||""].filter(Boolean))}
function overdueDays(task:Task,today:string){
  if(!today||!task.due_date||task.due_date>=today)return 0;
  return Math.max(1,Math.floor((new Date(`${today}T12:00:00`).getTime()-new Date(`${task.due_date}T12:00:00`).getTime())/86400000));
}

export function taskPriority(task:Task,problem?:Problem,today="",sourceProblem?:Problem){
  if(task.triage_override==="must")return -1;
  const errors=errorsFor(task);
  if(errors.has("K"))return 0;
  if(errors.has("N"))return 1;
  if(task.task_origin==="linked_s_check"){
    const urgent=sourceProblem&&(sourceProblem.strategy_rank==="A+"||!!sourceProblem.linked_past_exam_ids?.length||!!sourceProblem.linked_past_exams);
    return urgent?2:8;
  }
  if(problem?.category==="A"&&(problem.strategy_rank==="A+"||!!problem.linked_past_exam_ids?.length||!!problem.linked_past_exams))return 2;
  if(overdueDays(task,today)>0)return 3;
  if(errors.has("W"))return 4;
  if(errors.has("C"))return 5;
  if(task.kind.includes("S"))return 7;
  return 6;
}

/** 期限到来一覧は全件保持し、当日実行枠だけを現実的な上限へ分類する。 */
export function triageTodayTasks(tasks:Task[],targetMinutes:number,problems:Problem[],today=""){
  const problemMap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const ranked=tasks.map((task,index)=>({task,index,
    priority:taskPriority(task,problemMap.get(task.problem_id),today,task.source_problem_id?problemMap.get(task.source_problem_id):undefined),
    overdue:overdueDays(task,today)
  })).sort((a,b)=>a.priority-b.priority||b.overdue-a.overdue||a.index-b.index);
  const bucket=new Map<number,TriageKey>();
  const mustLimit=Math.max(0,Math.floor(targetMinutes*.9));
  let mustCount=0,optionalCount=0,mustMinutes=0,optionalMinutes=0,activeLinked=0,activeMain=0,activeSupplement=0,activeShort=0;
  const traits=(task:Task)=>{
    const problem=problemMap.get(task.problem_id),errors=errorsFor(task);
    return {
      linked:task.task_origin==="linked_s_check",
      main:problem?.category==="A"||problem?.category==="past_exam"||["full","exam_90min"].includes(task.mode)||task.minutes>=25,
      supplement:(errors.has("K")||errors.has("N")||errors.has("W"))&&task.minutes<25,
      short:task.mode==="check"||task.mode==="scan5"||task.minutes<=10,
    };
  };
  const allowedByMix=(task:Task)=>{
    const row=traits(task);
    return (!row.linked||activeLinked<1)&&(!row.main||activeMain<2)&&(!row.supplement||activeSupplement<1)&&(!row.short||activeShort<1);
  };
  const activate=(task:Task)=>{const row=traits(task);if(row.linked)activeLinked++;if(row.main)activeMain++;if(row.supplement)activeSupplement++;if(row.short)activeShort++};
  for(const row of ranked){
    const {task}=row;
    const canMust=mustCount<3&&mustMinutes+task.minutes<=mustLimit&&allowedByMix(task)&&row.priority<=4;
    if(canMust){bucket.set(row.index,"must");mustCount++;mustMinutes+=task.minutes;activate(task);continue}
    const canOptional=optionalCount<2&&mustMinutes+optionalMinutes+task.minutes<=targetMinutes&&allowedByMix(task);
    if(canOptional){bucket.set(row.index,"if_time");optionalCount++;optionalMinutes+=task.minutes;activate(task);continue}
    bucket.set(row.index,"tomorrow");
  }
  const assigned=tasks.map((task,index)=>({...task,triage:bucket.get(index)||"tomorrow"}));
  return {tasks:assigned,minutes:{must:mustMinutes,if_time:optionalMinutes,
    tomorrow:assigned.filter(task=>task.triage==="tomorrow").reduce((sum,task)=>sum+task.minutes,0)}};
}
