import type {CanonicalStudyPlan,Task} from "./types.ts";
import {deriveCurrentActionClass,prioritizeCurrentTodayTasks} from "./todayLearningPolicy.ts";
import {currentActionFingerprint} from "./examOptimizationPolicy.ts";

const stableHash=(value:string)=>[...value].reduce((hash,char)=>Math.imul(hash^char.charCodeAt(0),16777619)>>>0,2166136261).toString(16);

/**
 * The sole user-facing action projection. It does not mutate the immutable
 * start-of-day snapshot; it classifies and orders current eligible tasks.
 */
export function deriveCanonicalStudyPlan(args:{tasks:Task[];today:string;generatedAt?:string}):CanonicalStudyPlan{
  const tasks=prioritizeCurrentTodayTasks(args.tasks,args.today);
  const open=tasks.filter(task=>!task.checked);
  const examPractice=open.filter(task=>deriveCurrentActionClass(task)==="exam_practice"&&task.triage!=="tomorrow");
  const requiredRepairs=open.filter(task=>deriveCurrentActionClass(task)==="targeted_repair"&&task.triage!=="tomorrow");
  const optionalMaintenance=open.filter(task=>deriveCurrentActionClass(task)==="maintenance");
  const optionalExtras=open.filter(task=>task.triage==="tomorrow"&&deriveCurrentActionClass(task)!=="maintenance");
  const primaryAction=open.find(task=>task.triage!=="tomorrow")||null;
  const examPracticeMinutes=examPractice.reduce((sum,task)=>sum+Number(task.minutes||0),0);
  const requiredRepairMinutes=requiredRepairs.reduce((sum,task)=>sum+Number(task.minutes||0),0);
  const optionalMinutes=[...optionalMaintenance,...optionalExtras].reduce((sum,task)=>sum+Number(task.minutes||0),0);
  const requiredTotal=examPracticeMinutes+requiredRepairMinutes;
  const sourceStateVersion=stableHash(tasks.map(task=>[
    currentActionFingerprint(task,task.id&&task.review_type?task:undefined),task.checked?1:0,task.triage||""
  ].join(":")).join("|"));
  return {primaryAction,examPractice,requiredRepairs,optionalMaintenance,optionalExtras,
    rollingAllocation:{examPracticeMinutes,requiredRepairMinutes,optionalMinutes,
      examPracticeShare:requiredTotal?examPracticeMinutes/requiredTotal:null},
    reasons:[primaryAction?String(primaryAction.why_today||primaryAction.reason||""):"現在の必須課題はありません"],
    generatedAt:args.generatedAt||new Date().toISOString(),sourceStateVersion};
}
