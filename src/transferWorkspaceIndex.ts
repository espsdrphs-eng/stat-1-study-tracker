import type {Attempt,Problem} from './types.ts';
import type {TransferGenerationRecord,TransferTrainingLineage} from './generatedTransfer.ts';
import {attemptPlanningEligible} from './legacyKPolicy.ts';
import {abilityTrainingOutcome} from './abilityTraining.ts';
import {transferTrainingOutcome} from './skillEvidence.ts';

export type TransferAssignment={problemId:string;lineage:TransferTrainingLineage;answerSubmitted:boolean};
export type TransferWorkspaceItem={key:string;title:string;createdAt:string;kind:'generated'|'existing';phase:'generation'|'quality'|'answer'|'grading'|'result'|'pending';
 sourceProblemId:string;sourceAttemptId:number;latestSourceAttemptId?:number;sourceChanged:boolean;sourceMissing:boolean;registered:boolean;
 problemId?:string;attemptId?:number;outcome?:string;reason?:string};
/** Index existing records only. Never change a historical lineage to match a new
 * profile, expose an answer key, or count a pending draft as a transfer result. */
export function transferWorkspaceItems(records:TransferGenerationRecord[],problems:Problem[],attempts:Attempt[],assignments:TransferAssignment[]=[]):TransferWorkspaceItem[]{
 const facts=attempts.filter(attemptPlanningEligible).filter(a=>!a.exclude_from_metrics&&!a.duplicate_of_attempt_id);
 const entries=new Map(records.map(r=>[r.key,r]));
 for(const p of problems){const c=p.generated_transfer;if(c&&!entries.has(c.lineage.key))entries.set(c.lineage.key,{key:c.lineage.key,lineage:c.lineage,createdAt:c.created_at,status:'registered',problemId:p.problem_id,rounds:[]});}
 for(const c of assignments)if(!entries.has(c.lineage.key))entries.set(c.lineage.key,{key:c.lineage.key,lineage:c.lineage,createdAt:'',status:'registered',problemId:c.problemId,rounds:[]});
 for(const a of facts)if(a.transfer_lineage&&!entries.has(a.transfer_lineage.key))entries.set(a.transfer_lineage.key,{key:a.transfer_lineage.key,lineage:a.transfer_lineage,createdAt:a.date,status:'registered',problemId:a.problem_id,rounds:[]});
 return [...entries.values()].map(r=>{
  const l=r.lineage,p=problems.find(p=>p.generated_transfer?.lineage.key===r.key)||problems.find(p=>p.problem_id===r.problemId),a=facts.filter(a=>a.transfer_lineage?.key===r.key).sort((a,b)=>b.id-a.id)[0];
  const source=facts.find(a=>a.id===l.sourceAttemptId&&a.problem_id===l.sourceProblemId),latest=facts.filter(a=>a.problem_id===l.sourceProblemId).sort((a,b)=>b.id-a.id)[0];
  const phase:TransferWorkspaceItem['phase']=a?'result':r.status==='pending'||r.problemIssue&&!r.problemIssue.resolvedAt?'pending':p?.generated_transfer?.answer_submission||assignments.some(c=>c.lineage.key===r.key&&c.answerSubmitted)?'grading':p?'answer':r.status==='validation_pending'?'quality':'generation';
  const kind:TransferWorkspaceItem['kind']=p&&!p.generated_transfer?'existing':'generated';
  return {key:r.key,title:l.abilityProfile?.name||l.successCriteria||'対象操作の転移訓練',createdAt:a?.date||r.createdAt,kind,phase,
   sourceProblemId:l.sourceProblemId,sourceAttemptId:l.sourceAttemptId,latestSourceAttemptId:latest?.id,sourceChanged:!!latest&&latest.id!==l.sourceAttemptId,sourceMissing:!source,registered:!!p,
   ...(p?{problemId:p.problem_id}:{}),...(a?{attemptId:a.id,outcome:l.abilityProfile?abilityTrainingOutcome(a):transferTrainingOutcome(a)}:{}),...(r.pendingReason?{reason:r.pendingReason}:{})};
 }).sort((a,b)=>Number(a.phase==='result')-Number(b.phase==='result')||b.createdAt.localeCompare(a.createdAt)||a.key.localeCompare(b.key));
}
