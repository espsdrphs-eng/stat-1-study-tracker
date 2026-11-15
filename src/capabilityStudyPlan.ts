import type {CapabilityCheck,projectCapabilityMap} from './capabilityEvidence.ts';
import {calendarDaysBetween,summarizeTheoryEvidence,theoryAddDays,theoryAspects,theoryAttemptOrder,type TheoryAspect,type TheoryObservation,type RetentionMilestone} from './capabilityTheory.ts';

type MapView=ReturnType<typeof projectCapabilityMap>;
type Ability=MapView['abilities'][number];
type PlanOptions={today:string;examDate?:string;focusExam?:boolean;minutes?:number};
export type CapabilityStudyCandidate={
 ability:Ability;kind:'repair'|'transfer'|'retention'|'check'|'exam';aspect?:TheoryAspect;
 task:string;successCondition:string;minutes:number;dueDate:string|null;timing:'ready'|'overdue'|'upcoming'|'needs_anchor';
 reason:string;source:'gpt'|'suggestion';intervalDays?:number;
};
const defaultMinutes={diagnostic:8,local_repair:10,immediate_reproduction:5,delayed_transfer:12,exam:90};
const maxRecommendations=3;
export const nextRetentionInterval=(tier:RetentionMilestone|null)=>tier===null?7:tier===7?30:90;
export const theoryExamIsFocus=({today,examDate,focusExam}:PlanOptions)=>focusExam===true&&(calendarDaysBetween(today,examDate)??-1)>=0;
type AnswerLink=Pick<TheoryObservation,'attempt'|'link'>;
const laterAnswer=(answer:AnswerLink|undefined,baseline:AnswerLink|undefined)=>!!answer?.attempt&&!!baseline?.attempt&&theoryAttemptOrder(answer.attempt,baseline.attempt)>0;
function planningHistory(a:Ability,proposedAt?:string){
 const at=proposedAt?Date.parse(proposedAt):Infinity;
 const axes=['transfer','retention'] as const;
 const definitive=axes.map(key=>{
  const seen=new Set<number>();
  return a.theory.aspects[key].history.filter(o=>{
   if(o.status==='unconfirmed'||!o.attempt||Date.parse(o.evaluatedAt)>at||seen.has(o.attempt.id))return false;
   seen.add(o.attempt.id);return true;
  });
 });
 const lapse=definitive.flat().filter(o=>o.status==='failure').sort((p,q)=>theoryAttemptOrder(q.attempt!,p.attempt!))[0];
 const milestone=summarizeTheoryEvidence(definitive[1].filter(o=>!lapse||laterAnswer(o,lapse))).milestone;
 return {lapse,milestone};
}
function repaired(a:Ability,failure:TheoryObservation|undefined){
 const isRepair=(proof:AnswerLink|undefined)=>laterAnswer(proof,failure)&&proof!.link.kind==='immediate_reproduction'&&proof!.link.baseline_attempt_id===failure!.attempt!.id;
 // Do not dismiss a failed retest because an unrelated task was correct.
 // Keep the failed observation visible, but allow another check after an
 // independently verified repair of that very answer or a fresh transfer.
 return isRepair(a.theory.lastOperation)||a.theory.aspects.derivation.history.some(o=>o.status==='success'&&isRepair(o))||
  (['transfer','retention'] as const).some(k=>a.theory.aspects[k].latest?.status==='success'&&laterAnswer(a.theory.aspects[k].latest,failure));
}
function suggestedInterval(a:Ability,check?:CapabilityCheck){
 if(check?.interval_days)return check.interval_days;
 const proposedAt=a.proposalSource?.record.wire.evaluated_at;
 // A later successful attempt fulfills the interval that was proposed at the
 // time, not the longer interval that the same success will now recommend.
 return nextRetentionInterval(planningHistory(a,check?proposedAt:undefined).milestone);
}

/** This is a suggested window, not a new Review or an alteration of GPT's
 * saved proposal. Date-only deadlines allow one day of safety for the clock. */
export function retentionCheckDate(a:Ability,check?:CapabilityCheck){
 const anchor=a.theory.lastOperation?.attempt;
 if(!anchor)return null;
 const interval=suggestedInterval(a,check);
 const earliest=theoryAddDays(anchor.date,interval+1);
 return earliest&&check?.due_date&&check.due_date>earliest?check.due_date:earliest;
}
function assessmentAfterProposal(a:Ability,attempt:{id:number;date:string},evaluatedAt:string){
 const p=a.proposalSource?.record;
 if(!p||Date.parse(evaluatedAt)<=Date.parse(p.wire.evaluated_at))return false;
 const cutoff=p.sourceCutoffAttemptId;
 return cutoff!==undefined&&attempt.id>cutoff;
}
const retentionSuccessFor=(o:TheoryObservation,days:number)=>o.status==='success'&&o.relation==='different_structure'&&(o.interval?.minimumDays??0)>=days;
function proposalAlreadyChecked(a:Ability,check:CapabilityCheck){
 const checked=(o:TheoryObservation)=>!!o.attempt&&o.status==='success'&&assessmentAfterProposal(a,o.attempt,o.evaluatedAt);
 if(check.aspect==='retention')return a.theory.aspects.retention.history.some(o=>checked(o)&&retentionSuccessFor(o,suggestedInterval(a,check)));
 if(check.aspect)return a.theory.aspects[check.aspect].history.some(o=>checked(o)&&(check.kind==='diagnostic'||o.link.kind===check.kind||
  check.aspect==='derivation'&&check.kind==='local_repair'&&o.link.kind==='immediate_reproduction'));
 if(check.kind==='delayed_transfer')return a.theory.aspects.transfer.history.some(checked);
 const proof=a.theory.lastOperation;
 return !!proof&&assessmentAfterProposal(a,proof.attempt,proof.evaluatedAt)&&(
  ['local_repair','immediate_reproduction'].includes(check.kind)&&a.stages.immediate_reproduction||check.kind==='exam'&&a.stages.exam||
  check.kind==='diagnostic'&&a.theory.aspects.derivation.status==='success');
}
function issue(a:Ability){
 const aspect=a.theory.aspects;
 if(aspect.derivation.status==='failure')return 'derivation' as const;
 if(aspect.concept.status==='failure')return 'concept' as const;
 if(aspect.transfer.status==='failure'&&!repaired(a,aspect.transfer.latest))return 'transfer' as const;
 if(aspect.retention.status==='failure'&&!repaired(a,aspect.retention.latest))return 'retention' as const;
 if(a.state==='unrepaired'&&(a.theory.failureAttemptIds.length||!a.theory.lastOperation))return 'derivation' as const;
}
function dueStatus(dueDate:string|null,today:string){
 return !dueDate||dueDate===today?'ready':dueDate<today?'overdue':'upcoming';
}
function candidate(a:Ability,today:string,examFocus:boolean):CapabilityStudyCandidate|undefined{
 const original=a.proposalSource?.item.next_check,hasChecked=original&&proposalAlreadyChecked(a,original);
 const {lapse,milestone}=planningHistory(a);
 const obsolete=original?.kind==='delayed_transfer'&&lapse?.attempt&&assessmentAfterProposal(a,lapse.attempt,lapse.evaluatedAt);
 const saved=original&&!hasChecked&&!obsolete?original:undefined;
 const concern=issue(a),anchor=a.theory.lastOperation?.attempt;
 const repeated=a.theory.failureProblemCount>1,trace=a.theory.errorTrace;
 const need=concern?[
  repeated?`異なる問題${a.theory.failureProblemCount}問に未解消の根拠。前提の小さな操作を先に確認します。`:'保存した採点項目に未解消の誤りがあります。',
  trace?.affected_part_ids.length?`GPTが、最初の誤りから採点項目${trace.affected_part_ids.length}件への波及を記録。`:'',
 ].filter(Boolean).join(' '):'';
 const repairProposal=saved&&['local_repair','immediate_reproduction'].includes(saved.kind)&&(!saved.aspect||saved.aspect===concern);
 if(concern){
  const dueDate=repairProposal?saved.due_date:null;
  return {ability:a,kind:'repair',aspect:concern,dueDate,timing:dueStatus(dueDate,today),minutes:repairProposal?saved.estimated_minutes??defaultMinutes[saved.kind]:concern==='concept'?6:10,
   task:repairProposal?saved.task:concern==='concept'?'意味・仮定の取り違えを1点だけ補修':repeated?'繰り返した誤りを、より小さな前提操作から補修':'最初に止まった操作を1つだけ補修',
   successCondition:repairProposal?saved.success_condition:concern==='concept'?'式の意味・必要な条件を、解説を見ずに自分の言葉で説明できる。':'参照を閉じて、誤った箇所から必要な式と判断を自力で再現できる。',
   reason:need,source:repairProposal?'gpt':'suggestion'};
 }
 if(saved&&(saved.kind!=='exam'||examFocus)){
  const retention=saved.aspect==='retention',transfer=saved.kind==='delayed_transfer';
  const intervalDays=retention?suggestedInterval(a,saved):undefined;
  const dueDate=retention?retentionCheckDate(a,saved):saved.due_date;
  return {ability:a,kind:retention?'retention':transfer?'transfer':saved.kind==='exam'?'exam':'check',aspect:saved.aspect,
   dueDate,intervalDays,timing:retention&&!anchor?'needs_anchor':dueStatus(dueDate,today),minutes:saved.estimated_minutes??defaultMinutes[saved.kind],
   task:saved.task,successCondition:saved.success_condition,source:'gpt',
   reason:retention&&!anchor?'基準になる自力成功の答案を先に確認してください。':retention?'最新の操作確認を起点にした、異なる構造での非誘導確認です。':'保存済みのGPT提案。完了には対象の答案と評価が必要です。'};
 }
 if(!anchor)return undefined;
 const lastTransfer=a.theory.aspects.transfer.latest;
 if(!(lastTransfer?.status==='success'&&(!lapse||laterAnswer(lastTransfer,lapse)))&&milestone===null){
  const dueDate=theoryAddDays(anchor.date,2);
  return {ability:a,kind:'transfer',aspect:'transfer',dueDate,timing:dueStatus(dueDate,today),minutes:defaultMinutes.delayed_transfer,source:'suggestion',
   task:'異なる構造で、方法を指定しない初期転移を確認',successCondition:'別の問題で必要な操作を自分で選び、参照なしで実行できる。',
   reason:'自力の操作は記録されていますが、異構造での成功は未確認です。24〜72時間は目安です。'};
 }
 const intervalDays=nextRetentionInterval(milestone),dueDate=retentionCheckDate(a);
 return {ability:a,kind:'retention',aspect:'retention',intervalDays,dueDate,timing:dueStatus(dueDate,today),minutes:defaultMinutes.delayed_transfer,source:'suggestion',
  task:`約${intervalDays}日後の保持を、異なる構造で確認`,successCondition:'方法・解答を知らない別問題で、必要な操作と適用条件を自力で示せる。',
  reason:'成功した保持間隔に合わせた目安。日は変更でき、期限経過だけでは未達にしません。'};
}

export function deriveCapabilityStudyPlan(map:MapView,options:PlanOptions){
 const examFocus=theoryExamIsFocus(options);
 const minutes=Number.isFinite(options.minutes)&&options.minutes!>0?Math.floor(options.minutes!):30;
 const prioritization=new Map(map.priorities.map((a,i)=>[a.id,i]));
 const rank=(a:CapabilityStudyCandidate)=>a.kind==='repair'?0:a.kind==='exam'&&examFocus?1:a.kind==='retention'?2:a.kind==='transfer'?3:a.kind==='check'?4:5;
 const queue=map.abilities.flatMap(a=>{const c=candidate(a,options.today,examFocus);return c?[c]:[]})
  .sort((a,b)=>rank(a)-rank(b)||
   (a.kind==='repair'&&b.kind==='repair'?
    Number(b.ability.theory.failureProblemCount>1)-Number(a.ability.theory.failureProblemCount>1)||
    (b.ability.theory.errorTrace?.affected_part_ids.length??0)-(a.ability.theory.errorTrace?.affected_part_ids.length??0)||
    a.minutes-b.minutes||
    (prioritization.get(a.ability.id)??Infinity)-(prioritization.get(b.ability.id)??Infinity):0)||
   (a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.ability.id.localeCompare(b.ability.id));
 const {recommended,unselected,usedMinutes}=takeCapabilityStudyCandidates(queue.filter(c=>c.timing==='ready'||c.timing==='overdue'),minutes);
 const upcoming=queue.filter(c=>c.timing==='upcoming').sort((a,b)=>a.dueDate!.localeCompare(b.dueDate!));
 const waiting=queue.filter(c=>c.timing==='needs_anchor');
 const stale=map.abilities.flatMap(a=>{
  const days=calendarDaysBetween(a.theory.lastIndependent?.attempt.date,options.today);
  return days!==null&&days>=90?[{ability:a,days}]:[];
 }).sort((a,b)=>Number(!!issue(b.ability))-Number(!!issue(a.ability))||
  b.ability.theory.failureProblemCount-a.ability.theory.failureProblemCount||b.days-a.days);
 return {queue,recommended,unselected,upcoming,waiting,stale,usedMinutes,minutes,examFocus};
}

export function takeCapabilityStudyCandidates(candidates:CapabilityStudyCandidate[],minutes:number){
 const recommended:CapabilityStudyCandidate[]=[],unselected:CapabilityStudyCandidate[]=[];
 let usedMinutes=0;
 for(const c of candidates){if(recommended.length>=maxRecommendations||usedMinutes+c.minutes>minutes)unselected.push(c);
  else{recommended.push(c);usedMinutes+=c.minutes}}
 return {recommended,unselected,usedMinutes};
}

export function capabilityStudyTaskLabel(c:CapabilityStudyCandidate){
 return c.kind==='repair'?c.aspect==='concept'?'概念の局所補修':'局所補修':
  c.kind==='retention'?`保持 · 約${c.intervalDays}日`:c.kind==='transfer'?'初期転移':c.kind==='exam'?'本番形式':c.aspect?theoryAspects[c.aspect]:'次回確認';
}
