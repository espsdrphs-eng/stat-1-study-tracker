import type {Attempt} from './types.ts';
import type {CapabilityEvidence,CapabilityErrorTrace} from './capabilityEvidence.ts';

export const theoryAspects={derivation:'導出・操作',concept:'意味・条件',transfer:'異構造への転移',retention:'時間を空けた保持'} as const;
export type TheoryAspect=keyof typeof theoryAspects;
export const theoryAspectKeys=Object.keys(theoryAspects) as TheoryAspect[];
export const conceptFocusLabels={meaning:'式・概念の意味',justification:'成立理由',assumption:'仮定・条件',limit:'適用限界',distinction:'似た概念との区別',mathematization:'要求の数式化'} as const;
export type ConceptFocus=keyof typeof conceptFocusLabels;
export const theoryStatuses={unconfirmed:'未確認',success:'成功',failure:'未達'} as const;
export type TheoryStatus=keyof typeof theoryStatuses;
export const retentionMilestones=[7,30,90] as const;
export type RetentionMilestone=(typeof retentionMilestones)[number];
const dayMs=86400000;

/** Learning days are calendar dates in the record, not import/save timestamps. */
function dayTime(date:string|undefined){
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return NaN;
 const t=Date.parse(date);
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===date?t:NaN;
}
export function calendarDaysBetween(earlier:string|undefined,later:string|undefined){
 const days=(dayTime(later)-dayTime(earlier))/dayMs;
 return Number.isFinite(days)?days:null;
}
export function theoryAddDays(date:string,days:number){
 const t=dayTime(date);
 return Number.isFinite(t)?new Date(t+days*dayMs).toISOString().slice(0,10):null;
}
export type LearningInterval={calendarDays:number;minimumDays:number;exactDays:number|null};
export function learningInterval(from:{date:string;at?:string},to:{date:string;at?:string}):LearningInterval|null{
 const calendarDays=calendarDaysBetween(from.date,to.date);
 if(calendarDays===null||calendarDays<0)return null;
 const exactDays=(Date.parse(to.at||'')-Date.parse(from.at||''))/dayMs;
 if(Number.isFinite(exactDays))return exactDays<0?null:{calendarDays,minimumDays:Math.floor(exactDays),exactDays};
 // At worst the first answer was just before midnight and the next at midnight.
 return {calendarDays,minimumDays:Math.max(0,calendarDays-1),exactDays:null};
}
export const milestoneAt=(days:number)=>retentionMilestones.filter(t=>t<=days).at(-1)??null;

export type TheoryObservation={
 aspect:TheoryAspect;status:TheoryStatus;link:CapabilityEvidence;attempt?:Attempt;baseline?:Attempt;evaluatedAt:string;reason:string;
 interval?:LearningInterval;relation?:'same_problem'|'different_structure'|'different_problem_unverified';
};
export type TheoryAxis={status:TheoryStatus;latest?:TheoryObservation;history:TheoryObservation[]};
export type TheoryAxes=Record<TheoryAspect,TheoryAxis>;
export type IndependentTheoryAnswer={attempt:Attempt;link:CapabilityEvidence;evaluatedAt:string;answeredAt?:string};
export type TheoryEvidence={
 aspects:TheoryAxes;lastIndependent?:IndependentTheoryAnswer;lastOperation?:IndependentTheoryAnswer;milestone:RetentionMilestone|null;
 errorTrace?:CapabilityErrorTrace;failureAttemptIds:number[];failureProblemCount:number;
};
export const theoryAttemptOrder=(a:Attempt,b:Attempt)=>a.date.localeCompare(b.date)||a.id-b.id;

export function summarizeTheoryEvidence(observations:TheoryObservation[]){
 const aspects=Object.fromEntries(theoryAspectKeys.map(aspect=>{
  const history=observations.filter(o=>o.aspect===aspect).sort((a,b)=>
   // Physical answer date first; a re-evaluation does not reset the retention clock.
   (b.attempt?.date||'').localeCompare(a.attempt?.date||'')||(b.attempt?.id||0)-(a.attempt?.id||0)||
   Date.parse(b.evaluatedAt)-Date.parse(a.evaluatedAt)||(a.status==='failure'?-1:0)-(b.status==='failure'?-1:0));
  const valid=history.filter(o=>o.status!=='unconfirmed');
  let latest=valid[0];
  if(aspect==='concept'&&latest?.status==='success'){
   // Explaining the formula does not repair a separately observed error
   // about when it applies. A later result supersedes only the same focus.
   const byFocus=new Map<ConceptFocus,TheoryObservation>();
   for(const o of valid)if(o.link.concept_focus&&!byFocus.has(o.link.concept_focus))byFocus.set(o.link.concept_focus,o);
   latest=[...byFocus.values()].find(o=>o.status==='failure')??latest;
  }
  return [aspect,{status:latest?.status??'unconfirmed',latest,history} satisfies TheoryAxis];
 })) as TheoryAxes;
 // Historical evidence stays available after a relapse, but repeated use of
 // the same saved result is not a second sample or a longer interval.
 const effectiveRetention=new Map<number,TheoryObservation>();
 for(const o of aspects.retention.history)if(o.attempt&&o.status!=='unconfirmed'&&!effectiveRetention.has(o.attempt.id))effectiveRetention.set(o.attempt.id,o);
 const held=[...effectiveRetention.values()].filter(o=>o.status==='success'&&o.relation==='different_structure'&&o.interval);
 const milestone=milestoneAt(Math.max(0,...held.map(o=>o.interval!.minimumDays)));
 return {aspects,milestone};
}
