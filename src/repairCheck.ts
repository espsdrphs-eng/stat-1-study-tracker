import type {RepairCheck,Task} from './types.ts';
import {currentTaskIdentity} from './examOptimizationPolicy.ts';
export const repairStages={structure:'構造把握',recall:'知識想起',selection:'解法選択',calculation:'計算・記述',unknown:'未判定'} as const;
export function repairTaskKey(task:Partial<Task>){return task.id?`review:${task.id}`:`${currentTaskIdentity(task as Task)}:${task.grading_contract?.contractId||''}:${task.grading_contract?.sourceAttemptId||task.source_attempt_id||''}:${task.grading_contract?.contractHash||''}`;}
export function repairStageLabel(check?:Pick<RepairCheck,'stage'>){return check?repairStages[check.stage]||repairStages.unknown:repairStages.unknown;}
/** A learner observation, NOT a mastery or transfer-success judgement. */
export function buildRepairCheck(input:unknown,task:Partial<Task>,referenceLevel:number,recordedAt=new Date().toISOString()):RepairCheck{
 const value=input as Record<string,unknown>;
 if(!value||typeof value!=='object'||!Object.hasOwn(repairStages,String(value.stage)))throw new Error('詰まった段階を選択してください。');
 const text=(key:string)=>{if(typeof value[key]!=='string'||(value[key] as string).length>2000)throw new Error('骨格チェックは各項目2000文字以内で記録してください。');return(value[key] as string).trim();};
 if(!task.problem_id)throw new Error('骨格チェックの対象課題を確認してください。');
 return {taskIdentity:repairTaskKey(task),problemId:task.problem_id,clue:text('clue'),knowledge:text('knowledge'),approach:text('approach'),reason:text('reason'),stage:value.stage as RepairCheck['stage'],recordedAt,beforeAssistance:referenceLevel===0,selfReported:true};
}
export function repairCheckForTask(check:RepairCheck|undefined,task:Partial<Task>|undefined){return check&&task&&check.problemId===task.problem_id&&check.taskIdentity===repairTaskKey(task)?check:undefined;}
export function repairCheckPrompt(check?:RepairCheck){return check?`\n【30秒骨格チェック・学習者の自己申告】\n${JSON.stringify({clue:check.clue,knowledge:check.knowledge,approach:check.approach,reason:check.reason,stuck_stage:repairStageLabel(check),before_assistance:check.beforeAssistance})}\n自己申告だけから骨格成功・計算成功・転移成功を推測しない。紙／Goodnotesの答案画像と照合し、採点対象内の骨格と主要計算を別々に既存のgraded_findingsへ記録する。確認できなければ判定不能とする。\n`:'';}
