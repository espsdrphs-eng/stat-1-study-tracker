import type {Attempt,GradingContractSnapshot,GradedFinding,Problem,StudyUpdate} from './types.ts';
import {buildInitialGradingContract,computeContractHash,taskFieldsFromContract,validateGradingContract} from './gradingContract.ts';
import {buildOriginalExercise} from './originalExercise.ts';
import {CAPABILITY_CATALOG_VERSION} from './capabilityCatalog.ts';
import {capabilityDailyContextVersion,canonicalValue,planCapabilityImport,projectCapabilityMap,type CapabilityEvaluation,type CapabilityEvidence,type CapabilityFacts,type CapabilityImportPlan,type CapabilityRecord,type CapabilityWire} from './capabilityEvidence.ts';
import {DAILY_LEARNING_VERSION,dailyFail,dailyHash,decodeDailyLearning,observedFailure,observedPart,qualityBeforeAnswer,type DailyAnswer,type DailyAssessmentDiff,type DailyEvaluation,type DailyLearningPackage,type DailyProblem,type DailyReceipt,type DailyRef,type StoredDailyAnswer} from './dailyLearningContract.ts';

type DbFacts=CapabilityFacts & {issues?:string[]};
type MapView=ReturnType<typeof projectCapabilityMap>;
type Adapter={facts:()=>Promise<DbFacts>;hasAlias:(id:string)=>Promise<boolean>;addProblem:(p:Problem)=>Promise<unknown>;
 saveAttempt:(input:StudyUpdate,binding:DailyAttemptBinding)=>Promise<number>;getAttempt:(id:number)=>Promise<Attempt|undefined>;
 wait:<T>(p:Promise<T>)=>Promise<T>};
export type DailyAttemptBinding={contract:GradingContractSnapshot;answer:StoredDailyAnswer};

export async function prepareDailyLearning(text:unknown,now:string){
 const wire=decodeDailyLearning(text,now),newProblems=new Map<string,Problem>();
 for(const p of wire.problems)if(!p.existing_problem_id)newProblems.set(p.ref,await buildOriginalExercise({title:p.title,statement:p.statement,theme:p.theme,parts:p.parts!.map(x=>x.label)}));
 return {wire,newProblems,hash:await dailyHash(canonicalValue(wire)),can_confirm_noncued:wire.source_status==='observed'&&wire.answers.some(a=>qualityBeforeAnswer(wire.problems.find(p=>p.ref===a.problem_ref)!,a))};
}

type Prepared=Awaited<ReturnType<typeof prepareDailyLearning>>;
const activeAnswer=(a:Attempt)=>!a.invalidated_at&&!a.superseded_by_attempt_id&&!a.duplicate_of_attempt_id&&!a.exclude_from_metrics;
const byAnswer=(a:Attempt,b:Attempt)=>a.date.localeCompare(b.date)||a.id-b.id;
const nonBlank=(a:Attempt,ids:string[])=>ids.some(id=>a.graded_findings?.some(f=>f.graded_part_id===id&&f.evidence?.trim()&&(f.resolved||f.error_type!=='none')));
const submissionProof=(a:Pick<DailyAnswer,'parts'>)=>canonicalValue(a.parts.filter(p=>p.quote!==null&&observedPart(p)).map(p=>[p.part_id,p.quote]).sort(([id],[other])=>id!.localeCompare(other!)));
type Link={problem:DailyProblem;stored:Problem;fresh:boolean};

function dailyContract(problem:Problem,answer:DailyAnswer,baseline:Attempt|undefined,sessionId:string,date:string,fresh:boolean):GradingContractSnapshot{
 const standard=buildInitialGradingContract({problem,mode:'full',createdAt:date}),ids=new Set(answer.parts.map(f=>f.part_id));
 // Existing problems may already have stable locally-issued narrow slots. A
 // scoped follow-up can only use those or the existing master slots.
 const available=new Map([...standard.gradedParts,...(baseline?.problem_id===problem.problem_id?baseline.grading_contract?.gradedParts||[]:[])].map(p=>[p.id,p]));
 if([...ids].some(id=>!available.has(id)))dailyFail(`答案 ${answer.ref}`,'問題マスターまたは元答案で確定した採点範囲にない項目があります。');
 if(fresh&&!baseline&&standard.gradedParts.some(p=>!ids.has(p.id)))dailyFail(`答案 ${answer.ref}`,'初回答案の採点項目が欠けています。未着手・判定不能は明示してください。');
 if(baseline&&['local_repair','immediate_reproduction'].includes(answer.kind)&&!nonBlank(baseline,[...ids]))dailyFail(`答案 ${answer.ref}`,'基準答案に今回補修・再現する採点対象の実施記録がありません。');
 const gradedParts=[...available.values()].filter(p=>ids.has(p.id)),learningPurpose=answer.kind==='local_repair'||answer.kind==='immediate_reproduction'?'error_repair':answer.kind==='delayed_transfer'?'transfer_check':'integration_check';
 const {contractId:_id,contractHash:_hash,createdAt:_at,...base}=standard;
 const payload={...base,learningPurpose,learningStage:learningPurpose==='error_repair'?'repair':learningPurpose==='transfer_check'?'transfer':'acquisition',
  ...(baseline?{sourceAttemptId:baseline.id}:{}),gradedParts,reviewScope:gradedParts.length===standard.gradedParts.length&&!baseline?'full_answer':'targeted_patch',
  completionCriteria:standard.completionCriteria.filter(c=>gradedParts.some(p=>p.completionCriterionId===c.id)),targetedParts:gradedParts.map(p=>p.label),requiredEvidence:gradedParts.map(p=>p.label),
  explicitlyOutOfScopePartIds:[...available.keys()].filter(id=>!ids.has(id)),explicitlyOutOfScopeParts:[...available.values()].filter(p=>!ids.has(p.id)).map(p=>p.label),
  completionConditions:gradedParts.map(p=>`${p.label}の実施を答案の該当部分から確認`)} satisfies Omit<GradingContractSnapshot,'contractId'|'contractHash'|'createdAt'>;
 const contract={...payload,contractId:`daily:${sessionId}:${answer.ref}`,contractHash:computeContractHash(payload),createdAt:date};
 const errors=validateGradingContract(contract);if(errors.length)dailyFail(`答案 ${answer.ref}`,errors.join(' / '));
 return contract;
}

function dailyAttemptInput(w:DailyLearningPackage,a:DailyAnswer,c:GradingContractSnapshot,submissionId:string):StudyUpdate{
 const findings:GradedFinding[]=a.parts.map(f=>({graded_part_id:f.part_id,error_type:f.error_type,resolved:f.status==='correct',
  evidence:f.quote===null?f.finding:`${f.finding}\n答案からの引用：${f.quote}`,...(f.concept_focus?{concept_focus:f.concept_focus}:{})}));
 const errors=[...new Set(a.parts.filter(observedFailure).map(p=>p.error_type))],primary=errors[0]||'none',first=a.parts.find(p=>p.part_id===a.first_error_part_id);
 const refKnown=a.reference.level!==null&&a.reference.hint_used!==null;
 const timing=a.kind==='local_repair'||a.kind==='immediate_reproduction'?'same_session_correction':a.kind==='delayed_transfer'?'delayed_retrieval':'independent_performance';
 return {...taskFieldsFromContract(c),problem_id:c.problemId,date:w.learning_date,problem_id_confirmed:true,problem_id_source:'manual',
  mark:'',score_label:'',score_text:a.score?`${a.score.points}/${a.score.max}`:'',score_numeric:a.score?.points??null,score_max:a.score?.max??null,
  grading_confidence:a.grading_confidence===null?null:a.grading_confidence/100,actual_minutes:a.minutes??null,
  submission_id:submissionId,source_attempt_id:c.sourceAttemptId,source_problem_id:undefined,
  graded_findings:findings,reference_conditions_known:refKnown,actual_reference_level:a.reference.level??undefined,hint_used:a.reference.hint_used??undefined,
  reference_closed_reproduction:a.kind==='immediate_reproduction'&&a.reference.closed_reproduction===true,
  error_type:primary,primary_error_type:primary,error_types:errors.length?errors:['none'],error_point:first?.finding||findings.find(f=>f.error_type!=='none')?.evidence||'',
  next_action:'',result_summary:a.parts.map(p=>`${p.part_id}: ${p.finding}`).join('\n'),rubric_version:'STAT1-GRADE-v5',
  k_evidence:a.parts.filter(f=>f.error_type==='K').map(f=>f.k_evidence!),assessment_timing:timing,
  review_outcome:findings.every(f=>f.resolved)?'success':findings.some(f=>f.resolved)||a.parts.some(p=>p.status==='partial')?'partial':findings.some(f=>f.error_type!=='none')?'failed':undefined,
  ...(a.repair?{improvement_guidance:a.repair.guidance,required_derivation:a.repair.target}:{}),
  ignored_parts:a.parts.filter(p=>!observedPart(p)).map(p=>p.part_id)};
}

function lookupRef(id:DailyRef|undefined|null,byRef:Map<string,Attempt>,old:Map<number,Attempt>,path:string){
 if(id==null)return undefined;
 const actual=typeof id==='number'?old.get(id):byRef.get(id);
 if(!actual||!activeAnswer(actual))return dailyFail(path,`有効な元答案 ${id} が見つかりません。IDを推測せず、ChatGPTに照合を依頼してください。`);
 return actual;
}

function proposedEvaluation(e:DailyEvaluation,byRef:Map<string,Attempt>,old:Map<number,Attempt>):CapabilityEvaluation{
 const expanded=e.evidence.map(link=>{
  const a=lookupRef(link.answer_ref,byRef,old,e.ability_id)!,d=a.daily_answer!;
  if(link.part_ids.some(id=>!d.parts.some(p=>p.part_id===id)))dailyFail(`${e.ability_id}・答案 ${d.ref}`,`採点項目 ${link.part_ids.join(' / ')} が答案に存在しません。`);
  if(link.comparison){const b=lookupRef(link.comparison.against,byRef,old,`${e.ability_id} の比較基準`)!;
   if(byAnswer(b,a)>=0)dailyFail(`${e.ability_id} の比較基準`,'基準答案は対象答案より前の実施記録にしてください。');}
  const b=d.baseline_attempt_id===null?undefined:old.get(d.baseline_attempt_id)??[...byRef.values()].find(x=>x.id===d.baseline_attempt_id);
  const evidence:CapabilityEvidence={attempt_id:a.id,part_ids:link.part_ids,kind:d.kind,outcome:link.outcome,baseline_attempt_id:d.baseline_attempt_id,observation:link.observation,
   aspect:link.aspect,...(link.concept_focus?{concept_focus:link.concept_focus}:{}),
   ...(link.aspect==='derivation'?{method_not_cued:d.reference.method_cued===false&&d.shown.length===1&&d.shown[0]==='statement'}:{}),
   ...(d.kind==='delayed_transfer'?{transfer_conditions:{different_structure:!!b&&b.problem_id!==a.problem_id&&!!link.structure_difference,
    method_not_cued:d.reference.method_cued===false&&d.shown.length===1&&d.shown[0]==='statement'}}:{})};
  return {a,d,link,evidence};
 });
 const traced=expanded.find(({d,link})=>d.first_error_part_id&&link.part_ids.includes(d.first_error_part_id)&&['failure','partial'].includes(link.outcome));
 const first=traced?.d.parts.find(p=>p.part_id===traced.d.first_error_part_id);
 const next=e.next_check&&(({basis:_,...check})=>check)(e.next_check);
 return {ability_id:e.ability_id,state:e.state,certainty:e.certainty,judgement:e.judgement,first_error:first?.finding||null,cause_hypothesis:e.cause_hypothesis??null,
  evidence:expanded.map(x=>x.evidence),next_check:next??null,...(traced&&first?{error_trace:{attempt_id:traced.a.id,first_part_id:first.part_id,affected_part_ids:traced.d.affected_part_ids}}:{})};
}

function observationDiff(raw:DailyEvaluation,wire:CapabilityEvaluation,after:MapView['abilities'][number],id:string|undefined,all:Map<number,Attempt>,oldByRef:Map<string,Attempt>,hold:string|undefined){
 const current=after.history.find(h=>h.record.id===id),recent=after.theory.entries.filter(o=>o.recordId===id);
 return wire.evidence.map((e,i):DailyAssessmentDiff['observations'][number]=>{
  const source=raw.evidence[i],partKey=canonicalValue([...e.part_ids].sort()),find=(o:CapabilityEvidence)=>o.attempt_id===e.attempt_id&&o.kind===e.kind&&o.aspect===e.aspect&&o.concept_focus===e.concept_focus&&canonicalValue([...o.part_ids].sort())===partKey;
  const applied=recent.find(o=>find(o.link)),finding=current?.observations.find(o=>find(o.link)),comparison=source.comparison;
  const status=applied?.status??'unconfirmed',reason=applied?.reason??finding?.warnings.join(' ')??hold??'今回の採点根拠は原文付きで保持します。';
  let checked:DailyAssessmentDiff['observations'][number]['comparison'];
  if(comparison){
   const a=all.get(e.attempt_id)!,b=(typeof comparison.against==='number'?all.get(comparison.against):oldByRef.get(comparison.against))!;
   const prior=after.history.flatMap(h=>h.observations).find(o=>o.attempt?.id===b.id&&o.direct&&o.certainty==='confirmed'&&
    (o.link.aspect===e.aspect||!o.link.aspect&&e.aspect==='derivation')&&(!e.concept_focus||o.link.concept_focus===e.concept_focus)&&
    (a.problem_id!==b.problem_id||o.link.part_ids.some(p=>e.part_ids.includes(p)))&&o.link.outcome!=='uncertain');
   const priorFailure=prior?.link.outcome==='failure'||prior?.link.outcome==='partial';
   const accepted=comparison.result==='improved'?!!priorFailure&&status==='success'&&e.kind!=='local_repair':
    comparison.result==='recurrence'?!!prior&&status==='failure'&&e.kind!=='local_repair':
    comparison.result==='partial_repair'?!!priorFailure&&b.id===a.daily_answer?.baseline_attempt_id&&e.kind==='local_repair'&&!!finding?.direct&&finding.certainty==='confirmed'&&e.outcome==='success':false;
   checked={result:comparison.result,against_attempt_id:b.id,accepted,reason:accepted?comparison.reason:'同じ観点の以前の根拠または今回の確認条件が不足。成長・再発としては扱いません。'};
  }
  return {attempt_id:e.attempt_id,kind:e.kind,outcome:e.outcome,aspect:e.aspect!,part_ids:e.part_ids,status,reason:reason||'答案と採点範囲を確認しました。',...(checked?{comparison:checked}:{})};
 });
}

function frequencyDiff(trend:NonNullable<DailyEvaluation['recurrence_comparison']>,ability:MapView['abilities'][number],byRef:Map<string,Attempt>,old:Map<number,Attempt>):DailyAssessmentDiff['recurrence_comparison']{
 const read=(refs:DailyRef[])=>refs.map(r=>lookupRef(r,byRef,old,`${ability.id} の再発比較`)!);
 const before=read(trend.before),after=read(trend.after);
 if(before.some(a=>after.some(b=>byAnswer(a,b)>=0)))dailyFail(`${ability.id} の再発比較`,'比較の前半はすべて後半より前の答案にしてください。');
 const observations=[...before,...after].map(a=>ability.theory.aspects[trend.aspect].history.find(o=>o.attempt?.id===a.id&&o.status!=='unconfirmed'));
 const first=observations[0],comparable=!!first&&observations.every(o=>o?.link.kind===first.link.kind&&o.link.concept_focus===first.link.concept_focus&&
  o.attempt?.reference_conditions_known!==false&&(o.attempt?.actual_reference_level??o.attempt?.reference_level)===0&&o.attempt?.hint_used===false&&
  ['diagnostic','delayed_transfer'].includes(o.link.kind)&&(!o.attempt.daily_answer||o.attempt.daily_answer.reference.method_cued===false));
 const counts=(rows:typeof observations)=>rows.filter(o=>o?.status==='failure').length;
 return {before:before.map(a=>a.id),after:after.map(a=>a.id),before_failures:comparable?counts(observations.slice(0,before.length)):null,after_failures:comparable?counts(observations.slice(before.length)):null,
  reason:comparable?trend.reason:'同じ観点・種別・参照条件で照合できた観測が不足し、再発頻度は比較できません。'};
}

/** This function runs within one caller-owned transaction, both for the rolled
 * back preview and for the actual commit. It never updates any old row. */
export async function stageDailyLearning(p:Prepared,db:Adapter,base:DbFacts,acceptedNoncued:boolean){
 const w=p.wire,before=projectCapabilityMap(base),currentProblems=new Map(base.problems.map(x=>[x.problem_id,x])),available=new Map(base.attempts.map(a=>[a.id,a])),links=new Map<string,Link>(),seenProblemIds=new Set<string>();
 for(const row of w.problems){
  const newProblem=p.newProblems.get(row.ref),pid=row.existing_problem_id??newProblem!.problem_id,previous=currentProblems.get(pid);
  if(seenProblemIds.has(pid))dailyFail(`問題 ${row.ref}`,`同じ問題 ${pid} がパッケージに2回あります。同一問題の答案は同じ仮問題IDで参照してください。`);
  seenProblemIds.add(pid);
  if(row.existing_problem_id&&!previous)dailyFail(`問題 ${row.ref}`,`${pid} は登録済み問題にありません。`);
  if(newProblem&&(await db.hasAlias(pid)||previous&&(previous.source_type!=='original'||canonicalValue(previous.original_exercise)!==canonicalValue(newProblem.original_exercise))))dailyFail(`問題 ${row.ref}`,`同じIDに違う問題文または採点項目があります（${pid}）。上書きしません。`);
  const stored=previous??newProblem!;links.set(row.ref,{problem:row,stored,fresh:!previous});
  if(!previous)await db.addProblem(stored);
 }
 const byRef=new Map<string,Attempt>(),sameExerciseDay=new Set<string>();
 const mapped:DailyReceipt['answers']=[];
 for(const answer of w.answers){
  const {problem,stored,fresh}=links.get(answer.problem_ref)!,pid=stored.problem_id;
  const b=lookupRef(answer.baseline,byRef,available,`答案 ${answer.ref} の基準答案`);
  if(b&&(b.date>w.learning_date||b.date===w.learning_date&&b.daily_answer?.answered_at&&answer.answered_at&&Date.parse(b.daily_answer.answered_at)>=Date.parse(answer.answered_at)))dailyFail(`答案 ${answer.ref}`,'基準答案は今回の答案より前でなければなりません。');
  if(['local_repair','immediate_reproduction'].includes(answer.kind)&&(!b||b.problem_id!==pid||b.date!==w.learning_date))dailyFail(`答案 ${answer.ref}`,'補修・直後再現の基準は、同じ日に同じ問題を解いた別答案です。');
  if(answer.kind==='delayed_transfer'&&(!b||b.date>=w.learning_date))dailyFail(`答案 ${answer.ref}`,'後日の確認には今回より前の日の基準答案が必要です。同日補修とは別です。');
  if(!b&&problem.familiarity==='unseen'&&[...available.values(),...byRef.values()].some(a=>a.problem_id===pid&&a.date<=w.learning_date))dailyFail(`答案 ${answer.ref}`,'先行答案のある問題を初見とは記録できません。');
  if(fresh&&!b&&sameExerciseDay.has(pid))dailyFail(`答案 ${answer.ref}`,'同じ新規問題の追加答案には区分と基準答案が必要です。');
  const quoted=submissionProof(answer);
  if(quoted!=='[]'&&[...available.values(),...byRef.values()].some(a=>a.problem_id===pid&&a.date===w.learning_date&&a.daily_answer?.kind===answer.kind&&
    (!a.daily_answer.answered_at||!answer.answered_at||Date.parse(a.daily_answer.answered_at)===Date.parse(answer.answered_at))&&submissionProof(a.daily_answer)===quoted))
   dailyFail(`答案 ${answer.ref}`,'同じ問題・区分・提出内容の答案がすでにあります。別セッション名を付けても同じ成果を二重に数えません。');
  sameExerciseDay.add(pid);
  const contract=dailyContract(stored,answer,b,w.session_id,w.learning_date,fresh);
  const noncued=acceptedNoncued&&w.source_status==='observed'&&fresh&&b&&b.problem_id!==pid&&qualityBeforeAnswer(problem,answer)&&
   ![...available.values(),...byRef.values()].some(a=>a.problem_id===pid&&a.date<=w.learning_date);
  const {problem_ref:_,baseline:_b,score:_score,grading_confidence:_grading,minutes:_m,...evidence}=answer;
  const proof:StoredDailyAnswer={...evidence,session_id:w.session_id,baseline_attempt_id:b?.id??null,
   familiarity:problem.familiarity,shown:problem.shown,target_ability_ids:problem.target_ability_ids,source_status:w.source_status,
   ...(noncued?{noncued_quality:{validator_pass_id:problem.quality!.validator_pass_id,ability_ids:problem.target_ability_ids}}:{})};
  const id=await db.saveAttempt(dailyAttemptInput(w,answer,contract,`daily:${w.session_id}:${answer.ref}`),{contract,answer:proof}),actual=await db.getAttempt(id);
  if(!actual||available.has(actual.id)||actual.problem_id!==pid||canonicalValue(actual.daily_answer)!==canonicalValue(proof))return dailyFail(`答案 ${answer.ref}`,'確定した正式ID・採点範囲・証拠と一致しません。');
  byRef.set(answer.ref,actual);mapped.push({ref:answer.ref,attempt_id:id,problem_id:pid,kind:answer.kind,baseline_attempt_id:b?.id??null,score:answer.score,part_ids:actual.graded_part_ids||[]});
 }
 const staged=w.evaluations.length?await db.facts():{...base,problems:[...base.problems,...[...links.values()].filter(x=>x.fresh).map(x=>x.stored)],attempts:[...available.values(),...byRef.values()]};
 const assessment_context_version=await db.wait(capabilityDailyContextVersion(staged));
 const original=w.evaluations.map(e=>proposedEvaluation(e,byRef,available)),pending=new Map<string,string>();
 const plan=(rows:CapabilityEvaluation[]):Promise<CapabilityImportPlan>=>{
  const wire:CapabilityWire={schema_version:'stat1-capability-v1',catalog_version:CAPABILITY_CATALOG_VERSION,context_version:assessment_context_version,evaluated_at:w.created_at,evaluations:rows};
  return db.wait(planCapabilityImport(JSON.stringify(wire),staged));
 };
 let record:CapabilityRecord|null=null,proposal=original;
 if(proposal.length){
  let result=await plan(proposal);
  const blockers=result.entries.filter(r=>r.status==='rejected'||r.status==='conflict');
  for(const row of blockers)pending.set(row.abilityId,row.reason||'保存済みの評価と照合できません。原文を保留します。');
  proposal=proposal.filter(r=>!pending.has(r.ability_id));
  if(proposal.length&&blockers.length)result=await plan(proposal);
  const fallback=new Map<string,CapabilityEvaluation>();
  const checkBasics=projectCapabilityMap(staged,result.record?[...(staged.records||[]),result.record]:staged.records);
  const bases=new Map(w.evaluations.map(e=>[e.ability_id,e.next_check?.basis]));
  for(const row of result.entries){
   const e=original.find(v=>v.ability_id===row.abilityId)!;
   if(row.status==='rejected'||row.status==='conflict')continue;
   const b=bases.get(e.ability_id),a=checkBasics.abilities.find(v=>v.id===e.ability_id)!,history=a.history.find(h=>h.record.id===result.record?.id);
   const basisValid=!b||history?.observations.some(o=>o.attempt?.id===byRef.get(String(b))?.id&&o.direct&&o.certainty==='confirmed'&&
    (o.link.outcome!=='success'||a.theory.entries.some(t=>t.recordId===history.record.id&&t.link.attempt_id===o.link.attempt_id&&t.status==='success')));
   const warnings=history?.validation.warnings??[];
   if(e.certainty!=='confirmed'||e.state!=='unconfirmed'&&(row.afterState!==e.state||warnings.length>0)){
    pending.set(e.ability_id,warnings.join(' ')||row.stateReason||'提案した段階を実答案から確認できません。');
    fallback.set(e.ability_id,{...e,state:'unconfirmed',next_check:basisValid?e.next_check:null});
   }else if(!basisValid){
    pending.set(e.ability_id,'次回提案を支える採点根拠を確認できません。以前の予定を置き換えません。');
    fallback.set(e.ability_id,{...e,next_check:null});
   }
  }
  proposal=proposal.map(e=>fallback.get(e.ability_id)||e);
  if(proposal.length){const revised=fallback.size?await plan(proposal):result;
   for(const e of revised.entries)if(e.status==='rejected'||e.status==='conflict')dailyFail(e.abilityId,e.reason||'保留の根拠を照合できません。');
   record=revised.record;
  }
 }
 const after=projectCapabilityMap(staged,record?[...(staged.records||[]),record]:staged.records),all=new Map(staged.attempts.map(a=>[a.id,a]));
 const coaching_without_answer=w.coaching_without_answer.map(({baseline,...coaching})=>{
  const a=lookupRef(baseline,byRef,available,'答案を伴わない指導の元答案')!;
  if(a.date>w.learning_date)dailyFail('coaching_without_answer','指導より未来の答案を基準にできません。');
  return {...coaching,baseline_attempt_id:a.id};
 });
 const evaluations=after.abilities.flatMap<DailyAssessmentDiff>(next=>{
  const prev=before.abilities.find(a=>a.id===next.id)!,raw=w.evaluations.find(r=>r.ability_id===next.id),v=original.find(r=>r.ability_id===next.id),held=pending.get(next.id),
   savedPlan=next.proposalSource?.record.id===record?.id?next.proposalSource?.item.next_check:undefined;
  if(!raw||!v){return prev.state===next.state?[]:[{ability_id:next.id,before:prev.state,after:next.state,proposed:null,status:'revalidated',reason:next.stateReason,attempt_ids:[],observations:[]}];}
  const observations=observationDiff(raw,v,next,record?.id,all,byRef,held);
  return [{ability_id:next.id,before:prev.state,after:next.state,proposed:raw.state,status:held?'held':raw.state==='unconfirmed'?'evidence_only':'adopted',
   reason:held??next.stateReason,attempt_ids:[...new Set(v.evidence.map(e=>e.attempt_id))],observations,...(savedPlan?{next_check:savedPlan}:{}),
   ...(raw.recurrence_comparison?{recurrence_comparison:frequencyDiff(raw.recurrence_comparison,next,byRef,available)}:{})}];
 });
 return {record,assessment_context_version,data:{version:DAILY_LEARNING_VERSION,session_id:w.session_id,learning_date:w.learning_date,package_hash:p.hash,
  morning_context_version:w.morning_context_version,source_status:w.source_status,departure_reason:w.departure_reason,
  problems:[...links.entries()].map(([ref,{stored,fresh}])=>({ref,problem_id:stored.problem_id,title:stored.title,status:fresh?'new' as const:'existing' as const,part_ids:stored.original_exercise?.parts.map(p=>p.id)??buildInitialGradingContract({problem:stored,mode:'full'}).gradedParts.map(p=>p.id)})),
  answers:mapped,evaluations,coaching_without_answer,before_counts:before.counts,after_counts:after.counts} satisfies Omit<DailyReceipt,'archive_id'|'saved_at'|'assessment_context_version'>};
}
