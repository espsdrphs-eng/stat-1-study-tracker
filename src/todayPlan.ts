import type { Task } from "./types.ts";

export function summarizeTodayTime(tasks:Task[],completedMinutes:number,targetMinutes:number,startOfDayMinutes:number){
  const activeRemainingMinutes=tasks
    .filter(task=>!task.checked&&task.triage!=="tomorrow")
    .reduce((sum,task)=>sum+task.minutes,0);
  const postponeCandidateMinutes=tasks
    .filter(task=>!task.checked&&task.triage==="tomorrow")
    .reduce((sum,task)=>sum+task.minutes,0);
  const activeTotalIfDone=completedMinutes+activeRemainingMinutes;
  const excess=activeTotalIfDone-targetMinutes;
  return {
    startOfDayMinutes,completedMinutes,activeRemainingMinutes,postponeCandidateMinutes,
    activeTotalIfDone,capacityPercent:Math.round(activeTotalIfDone/targetMinutes*100),
    warning:excess>10
      ?`完了${completedMinutes}分 + 今日これから${activeRemainingMinutes}分 = ${activeTotalIfDone}分です。目標${targetMinutes}分を${excess}分超えます。必ずやる問題を1件明日に送ると目標内に近づきます。`
      :"",
    guidance:`完了${completedMinutes}分、今日これから${activeRemainingMinutes}分です。先送り候補${postponeCandidateMinutes}分は今日の実行予定に含めていません。`
  };
}
