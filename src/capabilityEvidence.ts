import type {Attempt,Problem,Review,PastSession,WeakNote} from './types.ts';
import {CAPABILITY_CATALOG_VERSION,capabilityById,capabilityCatalog,capabilityDomains,capabilityStates,capabilityKinds,type CapabilityState,type CapabilityKind} from './capabilityCatalog.ts';
import {normalizeCompatibleJson} from './jsonSyntax.ts';
import {confidentGrading} from './skillEvidence.ts';
import {attemptPlanningEligible,findingPlanningEligible} from './legacyKPolicy.ts';
import {GENERATION_CHECKS,validateGeneratedContent} from './generatedTransfer.ts';
import {sessionSelectedIds} from './pastExamSessionScope.ts';
import {resolvePastExamProblemId} from './examReferencePack.ts';
import {theoryAspectKeys,conceptFocusLabels,learningInterval,summarizeTheoryEvidence,calendarDaysBetween,type TheoryAspect,type ConceptFocus,type TheoryStatus,type TheoryObservation,type TheoryEvidence,type IndependentTheoryAnswer} from './capabilityTheory.ts';
import {deriveCapabilityStudyPlan,takeCapabilityStudyCandidates} from './capabilityStudyPlan.ts';

export const CAPABILITY_RECORD_PREFIX='capability-evaluation:v1:';
const contextPattern=/^(capability-context:(?:(iall|i([0-9a-z]+)p(\d+)):)?)(?:r2:([0-9a-z]+):|r3:([0-9a-z]+):([0-9a-f]{20}):|r4:([0-9a-z]+):(all|[0-9a-f]{20}):)?[0-9a-f]{64}$/;
export const isInitialAllCapabilityContext=(version:string)=>contextPattern.exec(version)?.[2]==='iall';
export type CapabilityEvidence={attempt_id:number;part_ids:string[];kind:CapabilityKind;outcome:'success'|'failure'|'partial'|'uncertain';baseline_attempt_id:number|null;observation:string;
 transfer_conditions?:{different_structure:boolean;method_not_cued:boolean};aspect?:TheoryAspect;concept_focus?:ConceptFocus;method_not_cued?:boolean};
export type CapabilityErrorTrace={attempt_id:number;first_part_id:string;affected_part_ids:string[];prerequisite_ability_id?:string};
export type CapabilityCheck={kind:CapabilityKind;due_date:string|null;task:string;success_condition:string;aspect?:TheoryAspect;interval_days?:number;estimated_minutes?:number};
export type CapabilityEvaluation={ability_id:string;state:CapabilityState;certainty:'confirmed'|'provisional'|'conflicting';judgement:string;first_error:string|null;cause_hypothesis?:string|null;
 evidence:CapabilityEvidence[];next_check:CapabilityCheck|null;next_check_action?:'withdraw';error_trace?:CapabilityErrorTrace};
export type CapabilityWire={schema_version:'stat1-capability-v1';catalog_version:string;context_version:string;evaluated_at:string;evaluations:CapabilityEvaluation[]};
export type CapabilityRecord={schemaVersion:'stat1-capability-record-v1';id:string;createdAt:string;wire:CapabilityWire;items:Array<CapabilityEvaluation&{effectiveState:CapabilityState;warnings:string[]}>;sourceSignatures:Record<string,string>;sourceCutoffAttemptId?:number;rawHash:string;savedAfterCount?:number;generatedSources?:Record<string,string|null>};
export type CapabilityFacts={problems:Problem[];attempts:Attempt[];reviews?:Review[];pastSessions?:PastSession[];capabilityPastSessions?:PastSession[];weakNotes?:WeakNote[];records?:CapabilityRecord[];
 settings?:{exam_date?:string;daily_study_minutes?:number;focus_exam?:boolean};dashboard?:{today:string}};
export type CapabilityContextScope={initial?:boolean;domainId?:string;batch?:number;retryIds?:string[]};
export type CapabilityImportEntry={abilityId:string;status:'ready'|'saved'|'conflict'|'rejected';reason?:string;change?:'new'|'updated';beforeState?:CapabilityState;afterState?:CapabilityState;stateReason?:string;
 nextCheck?:CapabilityEvaluation['next_check'];proposalChange?:'maintained'|'updated'|'withdrawn';theory?:Partial<Record<TheoryAspect,{status:TheoryStatus;afterStatus:TheoryStatus;reason:string;submitted:CapabilityEvidence['outcome']}>>};
export type CapabilityMetrics={historyRows:number;historyOperations:number;directEvidenceOperations:number;determinedOperations:number;unconfirmedOperations:number};
export type CapabilityImportPlan={record:CapabilityRecord|null;entries:CapabilityImportEntry[];duplicate:boolean;confirmationToken:string;recoveryScope:CapabilityContextScope;
 summary:{new:number;updated:number;maintained:number;duplicate:number;conflict:number;rejected:number;blocked:number;before:CapabilityMetrics;after:CapabilityMetrics}};
export const canonicalValue=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,x[k]])):x);
const hash=async(v:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const intactAttempt=(a:Attempt)=>!a.exclude_from_metrics&&!a.duplicate_of_attempt_id&&!a.invalidated_at&&!a.superseded_by_attempt_id;
const legacyUsable=(a:Attempt)=>intactAttempt(a)&&!a.exclude_from_planning&&attemptPlanningEligible(a);
const gradedParts=(a:Attempt)=>(a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)&&!a.grading_contract?.explicitlyOutOfScopePartIds?.includes(f.graded_part_id));
// An old broad K exclusion is a planner policy, not a verdict on independently
// graded sibling parts. Do not revive the K judgement or a globally invalid answer.
const survivingParts=(a:Attempt)=>a.policy_validity==='invalid_legacy_k'&&a.exclude_from_planning===true?
 gradedParts(a).filter(f=>['W','N','C'].includes(f.error_type)&&f.resolved===false&&!!f.evidence?.trim()):[];
const usable=(a:Attempt)=>legacyUsable(a)||intactAttempt(a)&&survivingParts(a).length>0;
const partIds=(a:Attempt)=>(legacyUsable(a)?gradedParts(a):survivingParts(a)).map(f=>f.graded_part_id);
function attemptFact(a:Attempt){
 return {id:a.id,problem_id:a.problem_id,date:a.date,mode:a.mode,score_numeric:a.score_numeric,score_max:a.score_max,error_point:a.error_point,result_summary:a.result_summary,
  error_type:a.error_type,error_types:a.error_types,primary_error_type:a.primary_error_type,secondary_error_type:a.secondary_error_type,k_evidence_valid:a.k_evidence_valid,k_evidence:a.k_evidence,policy_validity:a.policy_validity,effective_error_types:a.effective_error_types,rubric_version:a.rubric_version,
  graded_findings:a.graded_findings,contract_id:a.contract_id,contract_hash:a.contract_hash,grading_contract:a.grading_contract,daily_answer:a.daily_answer,
  reference_level:a.actual_reference_level??a.reference_level??null,hint_used:a.hint_used??null,reference_conditions_known:a.reference_conditions_known,grading_confidence:a.grading_confidence??null,
  one_line_hint:a.one_line_hint,previous_mistake:a.previous_mistake,official_answer:a.official_answer,gpt_explanation:a.gpt_explanation,external_reference:a.external_reference,reference_closed_reproduction:a.reference_closed_reproduction,
  learning_purpose:a.learning_purpose,assessment_timing:a.assessment_timing,generated_from_review_id:a.generated_from_review_id,
  transfer_lineage:a.transfer_lineage,target_skill_assessment:a.target_skill_assessment,target_skill_prompted:a.target_skill_prompted,
  parent_past_session_id:a.parent_past_session_id,session_role:a.session_role,exam_score_eligible:a.exam_score_eligible,time_limit_minutes:a.time_limit_minutes,time_minutes:a.time_minutes,conclusion_reached:a.conclusion_reached,
  exclude_from_metrics:a.exclude_from_metrics,exclude_from_planning:a.exclude_from_planning,duplicate_of_attempt_id:a.duplicate_of_attempt_id,invalidated_at:a.invalidated_at,superseded_by_attempt_id:a.superseded_by_attempt_id};
}
const sourceSignature=(a:Attempt)=>canonicalValue(attemptFact(a));
export const capabilityDate=(iso:string)=>iso.length===10?iso:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const recordOrder=(a:CapabilityRecord,b:CapabilityRecord)=>Date.parse(b.wire.evaluated_at)-Date.parse(a.wire.evaluated_at)||b.id.localeCompare(a.id);
function sourceFacts(f:CapabilityFacts){
 return {catalog:CAPABILITY_CATALOG_VERSION,problems:[...f.problems].sort((a,b)=>a.problem_id.localeCompare(b.problem_id)).map(p=>({id:p.problem_id,source:p.source_type,generated:p.generated_transfer,original:p.original_exercise})),attempts:[...f.attempts].sort((a,b)=>a.id-b.id),
  reviews:[...(f.reviews||[])].sort((a,b)=>a.id-b.id),sessions:[...(f.pastSessions||[])].sort((a,b)=>a.id-b.id),weakNotes:[...(f.weakNotes||[])].sort((a,b)=>a.id-b.id)};
}
const recordFacts=(records:CapabilityRecord[])=>records.map(r=>({id:r.id,wire:r.wire})).sort((a,b)=>a.id.localeCompare(b.id));
// Preserve the exact legacy serialization for previously issued requests.
export const capabilityFactsSignature=(f:CapabilityFacts)=>canonicalValue({...sourceFacts(f),records:recordFacts(f.records||[])});
const revisionVersion=async(stem:string,sourceHash:string,records:CapabilityRecord[])=>stem+`r2:${records.length.toString(36)}:`+await hash(canonicalValue([stem,sourceHash,recordFacts(records)]));
/** Noncued drafts keep the previously issued snapshot format. */
export const capabilityGenerationContextVersion=async(f:CapabilityFacts)=>revisionVersion('capability-context:',await hash(canonicalValue(sourceFacts(f))),f.records||[]);

// Catalog-versioned, compact scope. Include the mask and the exact permitted
// answer IDs in the digest; copying a mask from another request cannot widen it.
const maskOf=(ids:string[])=>{
 const set=new Set(ids),bytes=new Uint8Array(Math.ceil(capabilityCatalog.length/8));
 capabilityCatalog.forEach((c,i)=>{if(set.has(c.id))bytes[i>>3]|=1<<(i%8)});
 return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
};
const idsFromMask=(mask:string)=>capabilityCatalog.filter((_c,i)=>(parseInt(mask.slice((i>>3)*2,(i>>3)*2+2),16)&(1<<(i%8)))!==0).map(c=>c.id);
type EvidenceRequest={ids?:string[];mask:string;initial:boolean;revision:'r3'|'r4'};
const scopedRevisionVersion=async(stem:string,sourceHash:string,f:CapabilityFacts,request:EvidenceRequest)=>{
 const records=f.records||[],eligible=eligibleAttempts(f,request.initial,request.ids,request.revision==='r3').sort((a,b)=>a-b);
 const binding=[stem,sourceHash,request.mask,eligible,recordFacts(records)];
 return stem+`${request.revision}:${records.length.toString(36)}:${request.mask}:`+await hash(canonicalValue(request.revision==='r3'?binding:['r4',...binding]));
};

async function findRequestBaseline(version:string,f:CapabilityFacts,scoped?:EvidenceRequest){
 const match=contextPattern.exec(version),records=f.records||[];
 if(!match)return {currentVersion:await hash(capabilityFactsSignature(f))};
 const stem=match[1],count=match[5]??match[6]??match[8];
 const evidence=sourceFacts(f),sourceHash=await hash(canonicalValue(evidence));
 const versionFor=(rows:CapabilityRecord[])=>scoped?scopedRevisionVersion(stem,sourceHash,{...f,records:rows},scoped):revisionVersion(stem,sourceHash,rows);
 const currentVersion=await versionFor(records);
 if(currentVersion===version)return {currentVersion,baseline:records};
 // Existing rows are immutable. Append order is explicit for new saves, and
 // historical candidates are accepted only when the original digest matches.
 const ordered=[...records].sort((a,b)=>(a.savedAfterCount??-1)-(b.savedAfterCount??-1)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 if(count!==undefined){
  const length=parseInt(count,36);
  if(Number.isSafeInteger(length)&&length>=0&&length<ordered.length){
   const baseline=ordered.slice(0,length);
   if(await versionFor(baseline)===version)return {currentVersion,baseline};
  }
 }else{
  // Legacy versions have no count. Try the current state, the empty first
  // assessment, and a bounded set of recent prefixes; never guess a match.
  const {attempts,catalog,problems,reviews,sessions,weakNotes}=evidence;
  const left=`{"attempts":${canonicalValue(attempts)},"catalog":${canonicalValue(catalog)},"problems":${canonicalValue(problems)},"records":`;
  const right=`,"reviews":${canonicalValue(reviews)},"sessions":${canonicalValue(sessions)},"weakNotes":${canonicalValue(weakNotes)}}`;
  const lengths=new Set([ordered.length,0,...Array.from({length:Math.min(ordered.length,24)},(_,i)=>ordered.length-1-i)]);
  for(const length of lengths){
   const baseline=ordered.slice(0,length);
   if(stem+await hash(left+canonicalValue(recordFacts(baseline))+right)===version)return {currentVersion,baseline};
  }
 }
 return {currentVersion};
}
function fail(path:string,message:string):never{throw new Error(`${path}：${message}`)}
const obj=(v:unknown,p:string):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:fail(p,'オブジェクトが必要です。');
const text=(v:unknown,p:string,max=500)=>typeof v==='string'&&v.trim()&&v.length<=max?v:fail(p,`1〜${max}文字の文章が必要です。`);
const array=(v:unknown,p:string,max=12)=>Array.isArray(v)&&v.length<=max?v:fail(p,`${max}件以内の配列 [] が必要です。`);
const oneOf=<T extends string>(v:unknown,values:readonly T[],p:string):T=>typeof v==='string'&&values.includes(v as T)?v as T:fail(p,`許可する値：${values.join(' / ')}`);
const id=(v:unknown,p:string)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:fail(p,'実在する正の整数IDが必要です。');
const day=(v:unknown,p:string)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:fail(p,'日付は YYYY-MM-DD です。');
export function parseCapabilityUpdate(raw:string,stored=false):CapabilityWire{
 if(typeof raw!=='string'||raw.length>2_000_000)fail('JSON','入力は200万文字以内です。');
 const fenced=raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i),normalized=normalizeCompatibleJson(fenced?fenced[1]:raw.trim()).json;
 let parsed:unknown;try{parsed=JSON.parse(normalized)}catch{fail('JSON','構文を読み取れません。配列は []、値の省略は禁止です。原文は入力欄に残して、ChatGPTに標準JSONの再出力を依頼してください。')}
 const root=obj(parsed,'能力評価'),v=obj(root.capability_update??root,'capability_update');
 oneOf(v.schema_version,['stat1-capability-v1'],'schema_version');
 if(v.catalog_version!==CAPABILITY_CATALOG_VERSION)fail('catalog_version','能力マップの版が異なります。現在の依頼をコピーし直してください。');
 text(v.context_version,'context_version',128);
 if(typeof v.evaluated_at!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.evaluated_at)||!Number.isFinite(Date.parse(v.evaluated_at)))fail('evaluated_at','時差付きの評価日時が必要です。');
 day(v.evaluated_at.slice(0,10),'evaluated_at');
 if(!stored&&Date.parse(v.evaluated_at)>Date.now()+300000)fail('evaluated_at','評価日時が未来です。端末日時とGPTの評価日時を確認してください。');
 const maxEvaluations=isInitialAllCapabilityContext(v.context_version)?capabilityCatalog.length:12;
 const seen=new Set<string>(),evaluations=array(v.evaluations,'evaluations',maxEvaluations).map((r,i)=>{
  const p=`evaluations[${i}]`,e=obj(r,p),ability_id=text(e.ability_id,`${p}.ability_id`,100);
  if(!capabilityById.has(ability_id))fail(`${p}.ability_id`,`${ability_id} は能力マップに存在しません。推測で新規登録しません。`);
  if(seen.has(ability_id))fail(`${p}.ability_id`,'同じ評価内で能力が重複しています。');seen.add(ability_id);
  const evidence=array(e.evidence,`${p}.evidence`,8).map((x,j)=>{const q=`${p}.evidence[${j}]`,s=obj(x,q),part_ids=array(s.part_ids,`${q}.part_ids`,30).map(y=>text(y,`${q}.part_ids`,200));
   if(new Set(part_ids).size!==part_ids.length)fail(`${q}.part_ids`,'採点項目が重複しています。');
   const transfer=s.transfer_conditions===undefined?undefined:obj(s.transfer_conditions,`${q}.transfer_conditions`);
   if(transfer&&[transfer.different_structure,transfer.method_not_cued].some(b=>typeof b!=='boolean'))fail(`${q}.transfer_conditions`,'true / false で明示してください。');
   const aspect=s.aspect===undefined?undefined:oneOf(s.aspect,theoryAspectKeys,`${q}.aspect`);
   const concept_focus=s.concept_focus===undefined?undefined:oneOf(s.concept_focus,Object.keys(conceptFocusLabels) as ConceptFocus[],`${q}.concept_focus`);
   if(concept_focus&&aspect!=='concept')fail(`${q}.concept_focus`,'意味・条件（aspect:concept）の観点だけに使えます。');
   if(s.method_not_cued!==undefined&&(aspect!=='derivation'||typeof s.method_not_cued!=='boolean'))fail(`${q}.method_not_cued`,'導出・操作（aspect:derivation）の観点で true / false を指定してください。');
   return {attempt_id:id(s.attempt_id,`${q}.attempt_id`),part_ids,kind:oneOf(s.kind,Object.keys(capabilityKinds) as CapabilityKind[],`${q}.kind`),
    outcome:oneOf(s.outcome,['success','failure','partial','uncertain'],`${q}.outcome`),baseline_attempt_id:s.baseline_attempt_id===null?null:id(s.baseline_attempt_id,`${q}.baseline_attempt_id`),observation:text(s.observation,`${q}.observation`),
    ...(transfer?{transfer_conditions:{different_structure:transfer.different_structure,method_not_cued:transfer.method_not_cued}}:{}),
    ...(aspect?{aspect}:{}),...(concept_focus?{concept_focus}:{}),...(s.method_not_cued!==undefined?{method_not_cued:s.method_not_cued}:{})} as CapabilityEvidence;
  });
  let next_check:CapabilityEvaluation['next_check']=null;
  if(e.next_check!==null){
   const n=obj(e.next_check,`${p}.next_check`),kind=oneOf(n.kind,Object.keys(capabilityKinds) as CapabilityKind[],`${p}.next_check.kind`);
   const aspect=n.aspect===undefined?undefined:oneOf(n.aspect,theoryAspectKeys,`${p}.next_check.aspect`);
   if(aspect==='retention'&&kind!=='delayed_transfer')fail(`${p}.next_check.kind`,'保持の確認は既存の delayed_transfer を使います。');
   if(n.interval_days!==undefined&&(aspect!=='retention'||!Number.isInteger(n.interval_days)||n.interval_days<1||n.interval_days>365))fail(`${p}.next_check.interval_days`,'保持の提案では1〜365日の整数を指定できます。');
   if(n.estimated_minutes!==undefined&&(!Number.isInteger(n.estimated_minutes)||n.estimated_minutes<1||n.estimated_minutes>240))fail(`${p}.next_check.estimated_minutes`,'所要時間の目安は1〜240分です。');
   next_check={kind,due_date:n.due_date===null?null:day(n.due_date,`${p}.next_check.due_date`),task:text(n.task,`${p}.next_check.task`,240),success_condition:text(n.success_condition,`${p}.next_check.success_condition`,240),
    ...(aspect?{aspect}:{}),...(n.interval_days!==undefined?{interval_days:n.interval_days}:{}),...(n.estimated_minutes!==undefined?{estimated_minutes:n.estimated_minutes}:{})};
  }
  const certainty=oneOf(e.certainty,['confirmed','provisional','conflicting'],`${p}.certainty`);
  const action=e.next_check_action===undefined?undefined:oneOf(e.next_check_action,['withdraw'],`${p}.next_check_action`);
  if(action&&(next_check||certainty!=='confirmed'))fail(`${p}.next_check_action`,'提案の撤回は、確定した照合で next_check:null と併せて指定してください。');
  const first_error=e.first_error===null?null:text(e.first_error,`${p}.first_error`);
  let error_trace:CapabilityErrorTrace|undefined;
  if(e.error_trace!==undefined){
   const q=`${p}.error_trace`,t=obj(e.error_trace,q),first_part_id=text(t.first_part_id,`${q}.first_part_id`,200);
   const affected_part_ids=array(t.affected_part_ids,`${q}.affected_part_ids`,12).map(y=>text(y,`${q}.affected_part_ids`,200));
   if(!first_error||affected_part_ids.includes(first_part_id)||new Set(affected_part_ids).size!==affected_part_ids.length)fail(q,'最初の誤りの記述と、重複しない別の波及項目を指定してください。');
   const prerequisite_ability_id=t.prerequisite_ability_id===undefined?undefined:text(t.prerequisite_ability_id,`${q}.prerequisite_ability_id`,100);
   if(prerequisite_ability_id&&(!capabilityById.has(prerequisite_ability_id)||prerequisite_ability_id===ability_id))fail(q,'前提の候補には、能力マップ上の別の能力IDを指定してください。');
   error_trace={attempt_id:id(t.attempt_id,`${q}.attempt_id`),first_part_id,affected_part_ids,...(prerequisite_ability_id?{prerequisite_ability_id}:{})};
  }
  return {ability_id,state:oneOf(e.state,Object.keys(capabilityStates) as CapabilityState[],`${p}.state`),certainty,judgement:text(e.judgement,`${p}.judgement`),first_error,
   ...(e.cause_hypothesis!==undefined?{cause_hypothesis:e.cause_hypothesis===null?null:text(e.cause_hypothesis,`${p}.cause_hypothesis`)}:{}),evidence,next_check,...(action?{next_check_action:action}:{}),...(error_trace?{error_trace}:{})};
 });
 if(!evaluations.length)fail('evaluations','確認した能力を1件以上含めてください。未確認の全能力を埋める必要はありません。');
 return {schema_version:'stat1-capability-v1',catalog_version:CAPABILITY_CATALOG_VERSION,context_version:v.context_version,evaluated_at:v.evaluated_at,evaluations};
}

type EvaluationHistory={record:CapabilityRecord;item:CapabilityRecord['items'][number]};
const expectedKind:Partial<Record<CapabilityState,CapabilityKind>>={immediate_confirmed:'immediate_reproduction',delayed_transfer_confirmed:'delayed_transfer',exam_confirmed:'exam'};
const attemptOrder=(a:Attempt,b:Attempt)=>a.date.localeCompare(b.date)||a.id-b.id;
const failed=(outcome:CapabilityEvidence['outcome'])=>outcome==='failure'||outcome==='partial';
const actualError=(type:unknown)=>['K','W','N','C'].includes(String(type));
const generatedWarning='生成問題の内容hash・独立品質確認を照合できません。問題不備は能力失敗として確定しません。';
const unique=(rows:string[])=>[...new Set(rows)];
const generatedSignature=(p:Problem)=>canonicalValue({...p.generated_transfer,lifecycle_status:undefined});
const stablePart=(a:Attempt,id:string)=>{
 const part=a.grading_contract?.gradedParts?.find(p=>p.id===id);return part?.stableTargetKey||part?.stable_target_key;
};
function samePart(a:Attempt,id:string,b:Attempt,otherId:string){
 const key=stablePart(a,id),other=stablePart(b,otherId);
 if(key&&other)return key===other;
 const scope=(r:Attempt)=>r.review_scope??r.grading_contract?.reviewScope??r.evaluation_scope??r.mode;
 return id===otherId&&!!(a.contract_id&&a.contract_id===b.contract_id||!a.grading_contract&&!b.grading_contract&&!a.contract_id&&!b.contract_id&&scope(a)===scope(b));
}
const savedSessions=(f:CapabilityFacts)=>f.capabilityPastSessions??f.pastSessions??[];
const positiveMinutes=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const sessionExcluded=(s:PastSession)=>!!s.superseded_by_session_id||s.cancelled===true||s.deferred===true||['invalidated','cancelled','deferred'].includes(s.session_state||'');
const recordedFinish=(s:PastSession)=>typeof s.answer_finished_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s.answer_finished_at)&&Number.isFinite(Date.parse(s.answer_finished_at));
const selectedBinding=(a:Attempt,s:PastSession|undefined)=>{
 if(!s||s.session_kind!=='selected_three_timed'||a.parent_past_session_id!==s.id||a.session_role!=='selected_timed'||a.transfer_lineage)return false;
 const normalized=(ids:string[])=>ids.map(id=>resolvePastExamProblemId(s.year,id));
 const selected=sessionSelectedIds(s),validSelection=(ids:string[])=>ids.length===3&&new Set(normalized(ids)).size===3&&normalized(ids).every(id=>selected.includes(id));
 if(selected.length!==3||!selected.includes(a.problem_id)||s.exam_selected_problem_ids&&!validSelection(s.exam_selected_problem_ids)||s.answered_problem_ids&&!validSelection(s.answered_problem_ids))return false;
 if(a.past_exam_session_instance_id!==s.session_instance_id||s.counterfactual_calibration_attempt_ids?.includes(a.id)||
   s.selected_timed_attempt_ids&&!s.selected_timed_attempt_ids.includes(a.id)||s.linked_attempt_ids&&!s.linked_attempt_ids.includes(a.id)||
   s.post_session_answers?.[a.problem_id])return false;
 if(s.grading_contracts){
  const contract=s.grading_contracts[a.problem_id];
  return !!contract&&contract.problemId===a.problem_id&&contract.contractId===a.contract_id&&contract.contractHash===a.contract_hash;
 }
 return true;
};
const immediateReproduction=(a:Attempt)=>a.assessment_timing==='same_session_correction'&&a.reference_closed_reproduction===true;
function recordedExerciseKind(a:Attempt,p:Problem|undefined,s:PastSession|undefined){
 if(a.daily_answer)return ({diagnostic:'日次・診断答案',local_repair:'日次・局所補修',immediate_reproduction:'日次・直後の自力再現',delayed_transfer:'日次・後日の確認',exam:'日次・本番形式の練習（正式得点外）'})[a.daily_answer.kind];
 if(p?.source_type==='generated'||a.source_type==='generated'||/^GEN-/.test(a.problem_id))return '生成問題の訓練';
 if(a.transfer_lineage)return '別問題での確認';
 if(a.session_role==='counterfactual_calibration'&&s?.post_session_answers?.[a.problem_id])return '後日解答・選択判断の検証';
 if(p?.source_type==='past_exam'&&a.learning_purpose==='exam_performance'&&selectedBinding(a,s))return sessionExcluded(s!)?'無効・差し替え済みの本番記録':'本番形式の選択答案';
 if(immediateReproduction(a))return '直後の再現記録';
 if(a.assessment_timing==='delayed_retrieval'||a.learning_purpose==='retrieval_check')return '後日の再現確認';
 if(a.learning_purpose==='error_repair'||a.assessment_timing==='same_session_correction')return '局所補修';
 if(a.learning_purpose==='transfer_check')return '別問題での確認';
 return p?.source_type==='past_exam'?'個別の過去問演習':p?'個別演習':'演習形式未確認';
}
function evidenceIndex(f:CapabilityFacts){
 const attempts=new Map(f.attempts.map(a=>[a.id,a])),problems=new Map(f.problems.map(p=>[p.problem_id,p])),sessions=new Map(savedSessions(f).map(s=>[s.id,s]));
 const signatures=new Map<number,string>(),parts=new Map<number,string[]>(),byProblem=new Map<string,Attempt[]>();
 for(const a of f.attempts){const list=byProblem.get(a.problem_id)||[];list.push(a);byProblem.set(a.problem_id,list)}
 return {attempts,problems,sessions,byProblem,rows:f.attempts,signature(a:Attempt){if(!signatures.has(a.id))signatures.set(a.id,sourceSignature(a));return signatures.get(a.id)!},
  parts(a:Attempt){if(!parts.has(a.id))parts.set(a.id,partIds(a));return parts.get(a.id)!}};
}
type EvidenceIndex=ReturnType<typeof evidenceIndex>;
function observedFailureParts(a:Attempt,ids:string[]){
 return (a.graded_findings||[]).filter(p=>ids.includes(p.graded_part_id)&&p.resolved===false&&actualError(p.error_type)&&!!p.evidence?.trim()&&
  !(a.whole_answer_scan?.performed&&a.whole_answer_scan.regions?.some(r=>r.finding_ids.includes(p.graded_part_id)&&!r.answer_present)&&
   !a.whole_answer_scan.regions.some(r=>r.finding_ids.includes(p.graded_part_id)&&r.answer_present&&r.status==='checked_error')));
}
const examStageEvidence=(s:CapabilityEvidence)=>!s.aspect||s.aspect==='derivation'||s.aspect==='transfer';
function inspectEvidence(s:CapabilityEvidence,h:EvaluationHistory,x:EvidenceIndex){
 const {record,item}=h,a=x.attempts.get(s.attempt_id),baseline=s.baseline_attempt_id===null?undefined:x.attempts.get(s.baseline_attempt_id),warnings:string[]=[];
 const exerciseKind=a?recordedExerciseKind(a,x.problems.get(a.problem_id),x.sessions.get(a.parent_past_session_id??-1)):'演習形式未確認';
 if(!a)return {link:s,attempt:a,baseline,certainty:item.certainty,exerciseKind,outcomePartIds:[] as string[],warnings:[`根拠答案 #${s.attempt_id} が見つかりません。`],direct:false};
 const problem=x.problems.get(a.problem_id),evaluatedDate=capabilityDate(record.wire.evaluated_at);
 if(!problem||!usable(a)||a.date>evaluatedDate)warnings.push(`答案 #${a.id} は問題との対応・評価日・有効性を確認できません。`);
 if(!confidentGrading(a))warnings.push(`答案 #${a.id} の採点確信度が不足または未記録です。`);
 if(x.signature(a)!==record.sourceSignatures[a.id])warnings.push(`根拠答案 #${a.id} の変更・削除があります。GPTによる照合が必要です。`);
 if(s.baseline_attempt_id!==null&&(!baseline||!usable(baseline)||!x.problems.has(baseline.problem_id)||attemptOrder(baseline,a)>=0||x.signature(baseline)!==record.sourceSignatures[baseline.id]))warnings.push(`基準答案 #${s.baseline_attempt_id} の順序・有効性・原記録を確認できません。`);
 if(s.part_ids.some(p=>!x.parts(a).includes(p)))warnings.push(`答案 #${a.id} に対象外または存在しない採点項目があります。`);
 const findings=(a.graded_findings||[]).filter(p=>s.part_ids.includes(p.graded_part_id));
 const daily=a.daily_answer;
 if(daily&&s.outcome!=='uncertain'){
  if(daily.kind!==s.kind||daily.baseline_attempt_id!==s.baseline_attempt_id)warnings.push(`答案 #${a.id} の保存済みの実施区分・基準答案と一致しません。`);
  const observed=daily.parts.filter(p=>s.part_ids.includes(p.part_id));
  if(!s.part_ids.length||observed.length!==s.part_ids.length||observed.some(p=>p.status==='unattempted'||p.status==='unreadable'||!p.quote))warnings.push(`答案 #${a.id} の対象に未着手・判定不能・引用未確認の採点項目があります。`);
 }
 const failureParts=observedFailureParts(a,s.part_ids);
 const operationFindings=s.outcome==='success'?findings:failureParts;
 if(s.aspect&&s.outcome!=='uncertain'&&(!s.part_ids.length||calendarDaysBetween(a.date,evaluatedDate)===null||['scan','scan5','scan_only'].includes(a.mode)))warnings.push(`答案 #${a.id} に観点を確認できる解答日・採点項目がありません。`);
 if(s.aspect==='concept'&&s.outcome!=='uncertain'&&(!s.concept_focus||!operationFindings.some(p=>p.concept_focus===s.concept_focus)))warnings.push(`答案 #${a.id} に、その意味・条件を実際に採点した項目（concept_focus）がありません。計算結果だけでは確認しません。`);
 if(s.aspect&&s.aspect!=='concept'&&s.outcome!=='uncertain'&&operationFindings.length&&operationFindings.every(p=>!!p.concept_focus))warnings.push(`答案 #${a.id} の指定項目は意味・条件の説明です。操作を実行した採点項目が必要です。`);
 if(s.outcome==='success'&&(!findings.length||findings.some(p=>!p.resolved||p.error_type!=='none'||!p.evidence?.trim())))warnings.push(`答案 #${a.id} の対象内成功を採点記録から確認できません。`);
 if(failed(s.outcome)&&!(failureParts.length||!s.part_ids.length&&!a.graded_findings?.length&&actualError(a.error_type)&&!!a.error_point?.trim()))warnings.push(`答案 #${a.id} に指定範囲の明確な未達所見がありません。未着手・未採点は失敗にしません。`);
 if(problem?.source_type==='generated'){
  const signed=record.generatedSources?.[problem.problem_id];
  if(signed===null||signed!==undefined&&signed!==generatedSignature(problem)||signed===undefined&&item.warnings.includes(generatedWarning))warnings.push(generatedWarning);
 }
 return {link:s,attempt:a,baseline,certainty:item.certainty,exerciseKind,outcomePartIds:(failed(s.outcome)?failureParts:findings).map(p=>p.graded_part_id),warnings,direct:s.outcome!=='uncertain'&&warnings.length===0};
}
type InspectedEvidence=ReturnType<typeof inspectEvidence>;
const operationStageEvidence=(o:InspectedEvidence)=>examStageEvidence(o.link)&&(!o.outcomePartIds.length||
 o.outcomePartIds.some(id=>o.attempt?.graded_findings?.some(p=>p.graded_part_id===id&&!p.concept_focus)));

function referenceWarnings(a:Attempt){
 const warnings:string[]=[];
 if(a.reference_conditions_known===false||(a.actual_reference_level??a.reference_level)!==0||a.hint_used!==false)warnings.push(`答案 #${a.id} の参照なし・ヒントなしを確認できません。`);
 if(a.one_line_hint||a.previous_mistake||a.official_answer||a.gpt_explanation||a.saved_gpt_feedback||a.external_reference)warnings.push(`答案 #${a.id} の参照フラグと自力成功の申告が矛盾しています。`);
 return warnings;
}
function noncuedWarnings(s:CapabilityEvidence,a:Attempt,x:EvidenceIndex,abilityId?:string){
 const warnings:string[]=[];
 if(a.target_skill_prompted===true||s.transfer_conditions?.method_not_cued!==true)warnings.push(`答案 #${a.id} が方法の誘導なしだったことを確認できません。`);
 const problem=x.problems.get(a.problem_id);
 const daily=a.daily_answer;
 if(daily){
  if(daily.reference.method_cued!==false||daily.shown.length!==1||daily.shown[0]!=='statement')warnings.push(`答案 #${a.id} は、出題時に問題文以外を見ていないことを確認できません。`);
  if(s.transfer_conditions?.different_structure!==false&&(!daily.noncued_quality||!abilityId||!daily.noncued_quality.ability_ids.includes(abilityId)))warnings.push(`答案 #${a.id} の対象操作・出題前の独立品質確認または非閲覧条件を確認できません。`);
 }else if(problem?.source_type==='original'&&s.transfer_conditions?.different_structure!==false)warnings.push(`答案 #${a.id} は自作の診断問題で、対象・解法を答案固定まで隠した記録がありません。非誘導の異構造確認は「確認・転移」から行ってください。`);
 if(problem?.source_type==='generated'){
  const c=problem.generated_transfer;
  if(!c?.answer_submission||!c.validation||GENERATION_CHECKS.some(k=>c.validation.checks[k]?.pass!==true)||c.validation.draft_hash!==c.content_hash||c.generator_pass_id===c.validation.validator_pass_id)warnings.push(`答案 #${a.id} の生成問題に独立品質確認・自力答案固定の証拠が不足しています。`);
  const blind=c?.answer_submission?.noncued;
  if(a.target_skill_prompted!==false||!c?.lineage.noncuedRequestId||blind?.requestId!==c.lineage.key||blind?.externalReview!=='not_viewed'||!Array.isArray(blind.exposures)||blind.exposures.length!==0)warnings.push(`答案 #${a.id} の生成理由・解答・品質内容の非閲覧条件を確認できません。弱点指定型や閲覧不明を非誘導成功にしません。`);
  if(abilityId&&(c?.lineage.capabilityEvaluation?.abilityId!==abilityId||a.transfer_lineage?.capabilityEvaluation?.abilityId!==abilityId))warnings.push(`答案 #${a.id} の非誘導型生成契約は別の対象能力に紐付いています。`);
 }
 return warnings;
}
const trainingSuccess=(a:Attempt)=>a.target_skill_assessment?.outcome==='success'&&a.target_skill_assessment.self_selected&&a.target_skill_assessment.major_calculation_success&&a.target_skill_assessment.no_major_error;
function recordedAnswerTime(a:Attempt,x:EvidenceIndex){
 const problem=x.problems.get(a.problem_id),session=x.sessions.get(a.parent_past_session_id??-1);
 const content=problem?.generated_transfer,generatedTime=content&&a.transfer_lineage?.key===content.lineage.key?content.answer_submission?.submittedAt:undefined;
 const timestamp=generatedTime||a.daily_answer?.answered_at||(selectedBinding(a,session)&&session&&!sessionExcluded(session)?session.answer_finished_at:undefined);
 // Date notation must agree with the attempt. Never use the grading import time.
 return timestamp&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)&&Number.isFinite(Date.parse(timestamp))&&capabilityDate(timestamp)===a.date?timestamp:undefined;
}
function intervalFor(baseline:Attempt,a:Attempt,x:EvidenceIndex){
 return learningInterval({date:baseline.date,at:recordedAnswerTime(baseline,x)},{date:a.date,at:recordedAnswerTime(a,x)});
}

/** Structural validity of a single success does not change when a later
 * failure occurs. The current stage applies a separate recurrence check. */
function successStageWarnings(e:Pick<CapabilityEvaluation,'ability_id'>,s:CapabilityEvidence,a:Attempt,baseline:Attempt|undefined,x:EvidenceIndex){
 const warnings=referenceWarnings(a);
 if(a.target_skill_prompted===true&&(s.kind==='delayed_transfer'||s.kind==='exam'))warnings.push(`答案 #${a.id} は対象技能が事前に示されています。`);
 if((a.transfer_lineage?.capabilityEvaluation?.abilityId===e.ability_id||a.transfer_lineage?.abilityProfile?.id===e.ability_id)&&!trainingSuccess(a))warnings.push(`答案 #${a.id} の総合点とは別の対象能力判定が成功していません。`);
 if(s.kind==='immediate_reproduction'){
  if(!baseline||baseline.problem_id!==a.problem_id||baseline.date!==a.date)warnings.push(`答案 #${a.id} の同一課題での直後再現を確認できません。`);
  if(!immediateReproduction(a))warnings.push(`答案 #${a.id} に参照なしの直後再現の実施記録がありません。同日中の独立演習・局所補修だけでは直後再現としません。`);
 }
  if(s.kind==='delayed_transfer'){
   warnings.push(...noncuedWarnings(s,a,x,a.daily_answer||s.aspect==='transfer'||s.aspect==='retention'?e.ability_id:undefined));
   if(!baseline||baseline.problem_id===a.problem_id||baseline.id===a.id||s.transfer_conditions?.different_structure!==true)warnings.push(`答案 #${a.id} に構造の異なる別問題の裏付けがありません。`);
   if(!baseline||(intervalFor(baseline,a,x)?.minimumDays??0)<1)warnings.push(`答案 #${a.id} の24時間以上の遅延間隔を確認できません（日付のみなら2暦日以上必要です）。`);
   if(x.byProblem.get(a.problem_id)?.some(old=>attemptOrder(old,a)<0))warnings.push(`答案 #${a.id} は既習問題の再挑戦です。`);
   if(a.assessment_timing==='same_session_correction')warnings.push(`答案 #${a.id} は同時補修です。`);
  }
  if(s.kind==='exam'){
   const p=x.problems.get(a.problem_id),session=x.sessions.get(a.parent_past_session_id??-1),scope=a.grading_contract?.reviewScope??a.review_scope;
   if(p?.source_type!=='past_exam'||a.exam_score_eligible!==true||a.learning_purpose!=='exam_performance'||(a.assessment_timing&&a.assessment_timing!=='independent_performance')||
     scope&&scope!=='full_answer'||a.evaluation_scope==='conditional_full'||!session||!selectedBinding(a,session)||sessionExcluded(session)||session.exam_score_eligible!==true||session.answer_exposure===true||
     !recordedFinish(session))warnings.push(`答案 #${a.id} は保存済みの正式な本番形式・選択答案の条件を満たしません。`);
   const total=session?.actual_total_minutes,elapsed=session?.session_elapsed_minutes;
   if(!positiveMinutes(total)||total>90||elapsed!=null&&(!positiveMinutes(elapsed)||elapsed>90)||!positiveMinutes(a.time_minutes)||
     !positiveMinutes(a.time_limit_minutes)||a.time_minutes>Math.min(a.time_limit_minutes,total,elapsed??Infinity)||a.conclusion_reached!==true||a.incomplete_reason)warnings.push(`答案 #${a.id} の保存済みの演習時間・時間内完遂を確認できません。`);
  }
 return unique(warnings);
}

/** A stored concept/retention observation must not be confused with a
 * derivation relapse even when a legacy boilerplate grade uses the same slot. */
function laterSameScopeFailure(e:CapabilityEvaluation,proof:InspectedEvidence,history:InspectedEvidence[],x:EvidenceIndex){
 const a=proof.attempt!,s=proof.link;
 return x.rows.some(n=>{
  if(!usable(n)||!confidentGrading(n)||attemptOrder(n,a)<=0)return false;
  const linked=history.filter(o=>o.direct&&o.certainty==='confirmed'&&o.attempt?.id===n.id&&failed(o.link.outcome));
  const onlyOtherAspect=(part:string)=>linked.some(o=>!operationStageEvidence(o)&&o.outcomePartIds.includes(part))&&
   !linked.some(o=>operationStageEvidence(o)&&o.outcomePartIds.includes(part));
  return n.transfer_lineage?.capabilityEvaluation?.abilityId===e.ability_id&&n.target_skill_assessment?.outcome==='failure'&&
    !(linked.length&&linked.every(o=>!operationStageEvidence(o)))||
   n.problem_id===a.problem_id&&observedFailureParts(n,x.parts(n)).some(p=>!p.concept_focus&&!onlyOtherAspect(p.graded_part_id)&&s.part_ids.some(id=>samePart(a,id,n,p.graded_part_id)));
 });
}

function derivationWarnings(s:CapabilityEvidence,a:Attempt){
 const warnings=referenceWarnings(a);
 if(s.method_not_cued!==true||a.target_skill_prompted===true)warnings.push(`答案 #${a.id} で公式・解法の指定なしに操作を選べたことを確認できません。`);
 if(s.kind==='local_repair'||a.assessment_timing==='same_session_correction'&&s.kind!=='immediate_reproduction')warnings.push(`答案 #${a.id} の補修を、独立した導出の成功には数えません。`);
 if(a.daily_answer&&(a.daily_answer.reference.method_cued!==false||a.daily_answer.shown.some(x=>x!=='statement')))warnings.push(`答案 #${a.id} の保存済みの出題・解答条件では、方法を自力で選んだと確認できません。`);
 return warnings;
}
function resolveEvaluation(e:CapabilityEvaluation,own:InspectedEvidence[],history:InspectedEvidence[],x:EvidenceIndex){
 const warnings:string[]=[],expected=expectedKind[e.state];
 if(e.certainty!=='confirmed')warnings.push('GPTの能力対応が暫定または矛盾ありです。');
 const relevant=own.filter(row=>operationStageEvidence(row)&&(e.state==='unrepaired'?failed(row.link.outcome):expected&&row.link.kind===expected&&row.link.outcome==='success'&&
  (row.link.aspect!=='transfer'||expected==='delayed_transfer')));
 const proof=relevant.filter(row=>row.direct&&row.attempt).map(row=>({row,warnings:expected?[
  ...successStageWarnings(e,row.link,row.attempt!,row.baseline,x),
  ...(row.link.aspect==='derivation'?derivationWarnings(row.link,row.attempt!):[]),
  ...(laterSameScopeFailure(e,row,history,x)?[`答案 #${row.attempt!.id} より新しい答案に同じ対象範囲の未達があります。後続答案を含めてGPTで再照合してください。`]:[]),
 ]:row.link.aspect==='transfer'?transferSettingWarnings(row.link,row.attempt!,row.baseline,x,e.ability_id):[]}));
 const passing=proof.filter(p=>!p.warnings.length).map(p=>p.row).sort((a,b)=>attemptOrder(b.attempt!,a.attempt!));
 const best=passing[0];
 if(e.state!=='unconfirmed'&&own.length&&own.every(o=>!operationStageEvidence(o)))warnings.push('意味・条件と保持は別の観点です。これらだけで従来の5段階は変更しません。');
 if(e.state!=='unconfirmed'&&!best)warnings.push(...relevant.flatMap(row=>row.warnings),...proof.flatMap(p=>p.warnings),
  e.state==='unrepaired'?'未修復とする有効な失敗・部分成功の証拠がありません。':'この段階の成功を直接確認した有効な証拠がありません。');
 if(best&&history.some(row=>row.direct&&row.certainty==='confirmed'&&row.attempt&&operationStageEvidence(row)&&(expected?failed(row.link.outcome):row.link.outcome==='success')&&
   attemptOrder(row.attempt,best.attempt!)>=0&&comparableEvidence(e,best,row,x)))warnings.push(expected?'同じ操作の対象範囲に未達があります。GPTの再照合が必要です。':'同じ操作に失敗以後の成功も記録されています。古い失敗だけで現在の未修復とせず、GPTの再照合を待ちます。');
 return {state:warnings.length?'unconfirmed' as const:e.state,warnings:unique(warnings),proofIds:unique(passing.map(row=>`#${row.attempt!.id}`))};
}
function comparableEvidence(e:CapabilityEvaluation,a:InspectedEvidence,b:InspectedEvidence,x:EvidenceIndex){
 const left=a.attempt!,right=b.attempt!;
 const success=a.link.outcome==='success'?a:b,prior=success===a?b:a;
 if(success.attempt?.daily_answer&&(success.link.kind==='local_repair'||referenceWarnings(success.attempt).length||
  success.link.aspect==='derivation'&&derivationWarnings(success.link,success.attempt).length||
  success.link.kind!=='diagnostic'&&successStageWarnings(e,success.link,success.attempt,success.baseline,x).length))return false;
 if(left.id===right.id)return a.outcomePartIds.some(id=>b.outcomePartIds.includes(id));
 if(left.problem_id===right.problem_id)return a.outcomePartIds.some(id=>b.outcomePartIds.some(other=>samePart(left,id,right,other)));
 // Different problems: a deliberately linked, independently checked transfer
 // can contradict a prior result. Generic slots such as "major_calculation"
 // are not evidence that unrelated parts in two problems are comparable.
 return success.link.kind==='delayed_transfer'&&success.link.baseline_attempt_id===prior.attempt!.id&&
  !successStageWarnings(e,success.link,success.attempt!,success.baseline,x).length;
}

type AssessmentObservation=InspectedEvidence&{evaluatedAt:string;recordId:string};
function theoryEvidence(abilityId:string,observations:AssessmentObservation[],x:EvidenceIndex):Omit<TheoryEvidence,'errorTrace'|'failureAttemptIds'|'failureProblemCount'>&{entries:Array<TheoryObservation&{recordId:string}>}{
 const entries:Array<TheoryObservation&{recordId:string}>=[],independent:IndependentTheoryAnswer[]=[],operationAnchors=new Set<number>();
 const checked=observations.filter(o=>o.direct&&o.certainty==='confirmed'&&o.attempt);
 const knownPractice=new Set(checked.map(o=>o.attempt!.id));
 const byTime=[...observations].sort((a,b)=>(a.attempt?.date||'').localeCompare(b.attempt?.date||'')||(a.attempt?.id||0)-(b.attempt?.id||0)||
  Date.parse(b.evaluatedAt)-Date.parse(a.evaluatedAt));
 const independentStage=(s:CapabilityEvidence,a:Attempt,b:Attempt|undefined)=>!['local_repair','diagnostic'].includes(s.kind)&&!successStageWarnings({ability_id:abilityId},s,a,b,x).length;
 for(const o of byTime){
  const {attempt:a,baseline:b,link:s,evaluatedAt,recordId}=o,aspect=s.aspect??(s.kind==='delayed_transfer'?'transfer':undefined);
  if(!aspect){
   if(o.direct&&o.certainty==='confirmed'&&a&&operationStageEvidence(o)&&s.outcome==='success'&&independentStage(s,a,b)){
    operationAnchors.add(a.id);independent.push({attempt:a,link:s,evaluatedAt,answeredAt:recordedAnswerTime(a,x)});
   }
   continue;
  }
  const warnings=[...o.warnings];
  if(aspect==='transfer'&&!s.aspect&&!operationStageEvidence(o))warnings.push('説明の根拠だけでは、異なる構造での操作を確認しません。');
  if(o.certainty!=='confirmed')warnings.push('GPTの能力対応が暫定または矛盾ありです。');
  if(!o.direct&&!warnings.length)warnings.push('観察を記録しました。成功・未達の採点結果はありません。');
  let interval:TheoryObservation['interval'],relation:TheoryObservation['relation'];
  if(a&&o.direct){
   if(aspect==='derivation'&&s.outcome==='success')warnings.push(...derivationWarnings(s,a),...(s.kind==='immediate_reproduction'?successStageWarnings({ability_id:abilityId},s,a,b,x):[]));
   if(aspect==='concept'&&s.outcome==='success'){
    warnings.push(...referenceWarnings(a));
    if(a.daily_answer&&s.kind==='local_repair')warnings.push('指導を受けた局所補修は、意味・条件を自力で説明できた証拠とは別です。');
   }
   if(aspect==='transfer'){
    if(s.kind!=='delayed_transfer')warnings.push('転移は遅延した別問題の採点結果で照合します。');
    else if(s.outcome==='success'){
     warnings.push(...successStageWarnings({ability_id:abilityId},s,a,b,x));
     interval=b?(intervalFor(b,a,x)??undefined):undefined;
     if(b&&b.problem_id!==a.problem_id&&s.transfer_conditions?.different_structure===true)relation='different_structure';
    }else if(s.aspect){
     // Failed transfer still needs to have been a real transfer exercise;
     // the target-skill success requirement is only for a success.
     warnings.push(...transferSettingWarnings(s,a,b,x,abilityId));
    }else continue; // Old records do not infer an aspect from a failed label.
   }
   if(aspect==='retention'){
    const same=!!b&&b.problem_id===a.problem_id;
    relation=same?'same_problem':s.transfer_conditions?.different_structure===true?'different_structure':'different_problem_unverified';
    interval=b?(intervalFor(b,a,x)??undefined):undefined;
    if(s.kind!=='delayed_transfer'||a.assessment_timing==='same_session_correction')warnings.push('保持は同時補修と分けて、遅延した確認として記録します。');
    if(!b||!operationAnchors.has(b.id))warnings.push('基準答案で同じ能力の自力成功を照合できません。');
    if(!interval||interval.minimumDays<1)warnings.push('基準答案から24時間以上経ったことを確認できません。');
    if(same&&s.transfer_conditions?.different_structure===true)warnings.push('同じ問題を異構造の証拠にはできません。');
    if(!same&&relation!=='different_structure')warnings.push('別問題の構造が実際に異なることを確認できません。');
    if(!same&&x.byProblem.get(a.problem_id)?.some(old=>attemptOrder(old,a)<0))warnings.push('既習の別問題は異構造での非誘導保持に数えません。');
    warnings.push(...referenceWarnings(a),...noncuedWarnings(s,a,x,abilityId));
    if(s.outcome==='success'&&a.transfer_lineage&&!trainingSuccess(a))warnings.push('生成・訓練問題の対象操作の自力成功を確認できません。');
    if(b){
     const later=x.rows.filter(n=>intactAttempt(n)&&attemptOrder(n,b)>0&&attemptOrder(n,a)<0&&(
      knownPractice.has(n.id)||n.problem_id===b.problem_id||n.transfer_lineage?.capabilityEvaluation?.abilityId===abilityId))
      .sort((p,q)=>attemptOrder(q,p))[0];
     if(later)warnings.push(`基準答案からの途中に関連答案 #${later.id} があります。直近の自力確認と学習間隔を照合し直してください。`);
    }
   }
  }
  const status:TheoryStatus=warnings.length||!a||s.outcome==='uncertain'?'unconfirmed':s.outcome==='success'?'success':'failure';
  if(a&&status==='success'){
   independent.push({attempt:a,link:s,evaluatedAt,answeredAt:recordedAnswerTime(a,x)});
   if(aspect!=='concept')operationAnchors.add(a.id);
  }
  entries.push({aspect,status,link:s,attempt:a,baseline:b,evaluatedAt,recordId,interval,relation,
   reason:unique(warnings).join(' ')||(s.outcome==='partial'?'部分成功。指定範囲に未達が残っています。':'採点項目と照合済み。')});
 }
 independent.sort((a,b)=>attemptOrder(b.attempt,a.attempt)||Date.parse(b.evaluatedAt)-Date.parse(a.evaluatedAt));
 return {...summarizeTheoryEvidence(entries),lastIndependent:independent[0],lastOperation:independent.find(o=>operationAnchors.has(o.attempt.id)),entries};
}

function transferSettingWarnings(s:CapabilityEvidence,a:Attempt,b:Attempt|undefined,x:EvidenceIndex,abilityId?:string){
 const warnings=[...referenceWarnings(a),...noncuedWarnings(s,a,x,abilityId)];
 if(!b||b.problem_id===a.problem_id||s.transfer_conditions?.different_structure!==true||x.byProblem.get(a.problem_id)?.some(old=>attemptOrder(old,a)<0))warnings.push('異なる構造の未見問題としての条件を満たしません。');
 if(!b||(intervalFor(b,a,x)?.minimumDays??0)<1||a.assessment_timing==='same_session_correction')warnings.push('24時間以上の遅延を確認できません。');
 return warnings;
}

function latestCapabilityItems(f:CapabilityFacts){
 const selected=new Map<string,{record:CapabilityRecord;item:CapabilityRecord['items'][number]}>();
 for(const record of [...(f.records||[])].sort(recordOrder))for(const item of record.items)if(!selected.has(item.ability_id))selected.set(item.ability_id,{record,item});
 return [...selected.values()];
}
function requestedItems(f:CapabilityFacts,requested?:string[]){
 const latest=latestCapabilityItems(f);
 return requested?latest.filter(({item})=>requested.includes(item.ability_id)):latest;
}
function representativeAttempts(f:CapabilityFacts,requested?:string[],legacy=false){
 const usableRows=[...f.attempts].filter(legacy?legacyUsable:usable).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id),ids=new Set<number>();
 // Latest events plus older *referenced* failures/successes and measured exams.
 const current=requestedItems(f,requested),selected=requested?current:current.slice(0,8);
 for(const {item} of selected)for(const s of item.evidence){ids.add(s.attempt_id);if(s.baseline_attempt_id)ids.add(s.baseline_attempt_id)}
 if(requested)for(const record of [...(f.records||[])].sort(recordOrder))for(const item of record.items)if(requested.includes(item.ability_id)){
  if(ids.size>=40)break;
  for(const s of item.evidence){ids.add(s.attempt_id);if(s.baseline_attempt_id)ids.add(s.baseline_attempt_id)}
 }
 for(const a of usableRows.filter(a=>a.exam_score_eligible).slice(0,6))ids.add(a.id);
 for(const a of usableRows.slice(0,10))ids.add(a.id);
 for(const a of usableRows.filter(a=>(a.graded_findings||[]).some(x=>!x.resolved)||a.error_point?.trim()).slice(0,8))ids.add(a.id);
 return usableRows.filter(a=>ids.has(a.id));
}
function getCapabilityScope(selection:CapabilityContextScope){
 const initial=selection.initial===true,domainIndex=capabilityDomains.findIndex(d=>d.id===selection.domainId),batch=selection.batch??0;
 const all=initial&&selection.domainId==='all';
 if(initial&&(all?batch!==0:domainIndex<0||!Number.isInteger(batch)||batch<0))fail('分野','初回評価の分野と区分を選んでください。');
 const domainRows=initial&&!all?capabilityCatalog.filter(c=>c.domainId===selection.domainId):capabilityCatalog;
 const operations=initial&&!all?domainRows.slice(batch*12,(batch+1)*12):capabilityCatalog;
 if(!operations.length)fail('分野','この評価区分は存在しません。');
 const scope={initial,domainId:initial?selection.domainId:null,batch,abilityIds:operations.map(c=>c.id),batchCount:all?1:Math.ceil(domainRows.length/12)};
 return {initial,all,domainIndex,batch,operations,scope,stem:'capability-context:'+(all?'iall:':initial?`i${domainIndex.toString(36)}p${batch}:`:'')};
}
const eligibleAttempts=(f:CapabilityFacts,initial:boolean,requested?:string[],legacy=false)=>[...new Set([...(initial?f.attempts.filter(legacy?legacyUsable:usable):representativeAttempts(f,requested,legacy)).map(a=>a.id),...requestedItems(f,requested).flatMap(({item})=>item.evidence.flatMap(s=>[s.attempt_id,...(s.baseline_attempt_id?[s.baseline_attempt_id]:[])]))])];

/** The batch adapter uses the same real, all-scope revision after staging new
 * answers, without generating the full-history attachment or a chat prompt. */
export async function capabilityDailyContextVersion(f:CapabilityFacts){
 const {stem}=getCapabilityScope({initial:true,domainId:'all'});
 return scopedRevisionVersion(stem,await hash(canonicalValue(sourceFacts(f))),f,{initial:true,mask:'all',revision:'r4'});
}

export async function buildCapabilityContext(f:CapabilityFacts,focusId?:string,selection:CapabilityContextScope={}){
 if(focusId&&!capabilityById.has(focusId))fail('ability_id','能力マップにありません。');
 const {initial,all,domainIndex,batch,operations,scope:baseScope,stem}=getCapabilityScope(selection);
 const retryIds=[...new Set(selection.retryIds?.length?selection.retryIds:focusId&&!initial?[focusId]:[])];
 if(retryIds.some(id=>!baseScope.abilityIds.includes(id)))fail('差分の対象能力','評価範囲に含まれないIDです。');
 const requestedOperations=retryIds.length?operations.filter(c=>retryIds.includes(c.id)):operations,requested=retryIds.length?requestedOperations.map(c=>c.id):undefined;
 const scope={...baseScope,abilityIds:requested??baseScope.abilityIds};
 const sourceHash=await hash(canonicalValue(sourceFacts(f)));
 const version=await scopedRevisionVersion(stem,sourceHash,f,{initial,ids:requested,mask:requested?maskOf(requested):'all',revision:'r4'});
 const view=projectCapabilityMap(f),viewById=new Map(view.abilities.map(a=>[a.id,a]));
 const today=f.dashboard?.today??capabilityDate(new Date().toISOString());
 const plan=deriveCapabilityStudyPlan(view,{today,examDate:f.settings?.exam_date,focusExam:f.settings?.focus_exam,minutes:f.settings?.daily_study_minutes});
 const allowedOperations=new Set(scope.abilityIds),relevantPlan=plan.queue.filter(c=>allowedOperations.has(c.ability.id));
 const recommended=relevantPlan.filter(c=>c.timing==='ready'||c.timing==='overdue');
 const suggestions=takeCapabilityStudyCandidates(recommended.length?recommended:relevantPlan,plan.minutes).recommended;
 const representatives=initial?[...f.attempts].filter(usable).sort(attemptOrder):representativeAttempts(f,requested);
 const noteGroups=new Map<string,{attempt_id:number;problem_id:string;note_ids:number[];observation:string;correction_rule:string}>();
 if(initial)for(const n of f.weakNotes||[]){if(!representatives.some(a=>a.id===n.generated_from_attempt_id&&a.problem_id===n.problem_id))continue;
  const key=canonicalValue([n.generated_from_attempt_id,n.problem_id,n.mistake,n.correction_rule]),old=noteGroups.get(key);
  if(old)old.note_ids.push(n.id);else noteGroups.set(key,{attempt_id:n.generated_from_attempt_id!,problem_id:n.problem_id,note_ids:[n.id],observation:n.mistake,correction_rule:n.correction_rule});
 }
 const schema={capability_update:{schema_version:'stat1-capability-v1',catalog_version:CAPABILITY_CATALOG_VERSION,context_version:version,evaluated_at:'実際の評価日時（時差付きISO）',evaluations:[{ability_id:initial||retryIds.length?requestedOperations[0].id:'cross.request-to-math',state:'unconfirmed',certainty:'provisional',judgement:'観察事実と未確認を1〜2文で区別',first_error:null,cause_hypothesis:null,evidence:representatives.length?[{attempt_id:representatives[0].id,part_ids:partIds(representatives[0]),kind:'diagnostic',outcome:'uncertain',baseline_attempt_id:null,observation:'答案で確認できた式・条件・記号。未確認は補完しない'}]:[],next_check:{kind:'immediate_reproduction',due_date:null,task:'次に確認する操作を1件',success_condition:'参照なしで再現できたと判定する条件'}}]}};
 const facts={catalog_version:CAPABILITY_CATALOG_VERSION,context_version:version,focus_ability_id:focusId||null,review_scope:scope,
  operation_catalog:requestedOperations.map(c=>({id:c.id,domain:capabilityDomains.find(d=>d.id===c.domainId)!.name,name:c.name,criterion:c.criterion})),
  current_evaluation_counts:view.metrics,
  learning_goal:plan.examFocus?'exam_and_theory':'long_term_theory',
  selected_next_checks:suggestions.map(({ability:a,kind,aspect,dueDate,minutes,task,successCondition,reason,intervalDays,timing})=>({ability_id:a.id,suggested_action:kind,aspect,due_date:dueDate,
   estimated_minutes:minutes,task,success_condition:successCondition,reason,interval_days:intervalDays,timing})),
  current_evaluations:requestedItems(f,requested).map(({record,item:e})=>{
   const a=viewById.get(e.ability_id)!;
   return {evaluated_at:record.wire.evaluated_at,ability_id:e.ability_id,state:a.state,latest_proposed_state:e.state,certainty:e.certainty,state_reason:a.stateReason,
    state_source_evaluated_at:a.stateSource?.record.wire.evaluated_at,history_count:a.history.length,direct_evidence_count:a.directEvidence.length,
    judgement:e.judgement,first_error:e.first_error,evidence:e.evidence,next_check:a.proposalSource?.item.next_check??null,
    ...(a.theory.errorTrace?{error_trace:a.theory.errorTrace}:{}),
    ...(a.theory.lastIndependent?{last_independent_answer:{attempt_id:a.theory.lastIndependent.attempt.id,date:a.theory.lastIndependent.attempt.date}}:{}),
    ...(a.theory.entries.length?{theory:Object.fromEntries(theoryAspectKeys.map(aspect=>{
     const axis=a.theory.aspects[aspect],row=axis.latest;
     return [aspect,{status:axis.status,attempt_id:row?.attempt?.id,date:row?.attempt?.date,minimum_elapsed_days:row?.interval?.minimumDays,relation:row?.relation}];
    })),longest_verified_interval:a.theory.milestone}:{}),
   };
  }),
  representative_answers:representatives.map(a=>({id:a.id,problem_id:a.problem_id,date:a.date,problem_title:f.problems.find(p=>p.problem_id===a.problem_id)?.title,
   material_kind:f.problems.find(p=>p.problem_id===a.problem_id)?.source_type,score:a.score_numeric??null,grade_is_official:false,summary:a.result_summary||null,observed_errors:a.error_point||null,
   reference_level:a.actual_reference_level??a.reference_level??null,hint_used:a.reference_conditions_known===false?null:a.hint_used??null,reference_conditions_known:a.reference_conditions_known,grading_confidence:a.grading_confidence??null,purpose:a.learning_purpose||null,timing:a.assessment_timing||null,
   mode:a.mode,answer_scope:a.review_scope??a.grading_contract?.reviewScope??null,reference_closed_reproduction:a.reference_closed_reproduction??null,
   ...(a.source_type==='original'?{source_attempt_id:a.grading_contract?.sourceAttemptId??null,source_review_id:a.source_review_id??null}:{}),
   reference_flags:{one_line_hint:a.one_line_hint??null,previous_mistake:a.previous_mistake??null,official_answer:a.official_answer??null,gpt_explanation:a.gpt_explanation??null,external_reference:a.external_reference??null},
   prior_recorded_answer_ids:f.attempts.filter(old=>old.problem_id===a.problem_id&&(old.date<a.date||old.date===a.date&&old.id<a.id)).map(old=>old.id),novelty:'既習答案がなければ初見と確定せず、アプリ外の既習は未記録',
   assessed_parts:(a.graded_findings||[]).filter(p=>partIds(a).includes(p.graded_part_id)).map(p=>({id:p.graded_part_id,
    ...(a.source_type==='original'?{label:a.grading_contract?.gradedParts.find(q=>q.id===p.graded_part_id)?.label}:{}),error_type:p.error_type,resolved:p.resolved,evidence:p.evidence,concept_focus:p.concept_focus})),
   transfer:a.transfer_lineage?{source_attempt_id:a.transfer_lineage.sourceAttemptId,ability_id:a.transfer_lineage.capabilityEvaluation?.abilityId||a.transfer_lineage.abilityProfile?.id,target_skill_prompted:a.target_skill_prompted??null,assessment:a.target_skill_assessment}:null,
   formal_session_id:a.parent_past_session_id??null,session_role:a.session_role??null,exam_score_eligible:a.exam_score_eligible??null,time_minutes:a.time_minutes??null,time_limit_minutes:a.time_limit_minutes??null,conclusion_reached:a.conclusion_reached??null,
   review_ids:(f.reviews||[]).filter(r=>r.generated_from_attempt_id===a.id).map(r=>r.id)})),
  available_answer_count:f.attempts.length,omitted_answer_count:f.attempts.length-representatives.length,
  ...(initial?{note_observations:[...noteGroups.values()],unlinked_note_count:(f.weakNotes||[]).filter(n=>!representatives.some(a=>a.id===n.generated_from_attempt_id&&a.problem_id===n.problem_id)).length,
   review_records:(f.reviews||[]).map(r=>({id:r.id,source_attempt_id:r.generated_from_attempt_id,problem_id:r.problem_id,due_date:r.due_date,status:r.status,purpose:r.learning_purpose??null,timing:r.assessment_timing??null,parts:r.graded_part_ids??r.targeted_parts??[],completion:r.completion_result??null,completed_at:r.completed_at??null,reference_level:r.actual_reference_level??r.reference_level??null})),
   source_period:{first:representatives[0]?.date??null,last:representatives.at(-1)?.date??null}}:{}),
  limits:'採点得点はGPTによる推定であり検定の公式得点ではない。原問題・答案画像・未取り込みの履歴は見たと仮定しない。古い弱点メモを現在の弱点数へ変換しない。'};
 let historyAttachment:{name:string;text:string;sha256:string;answerCount:number}|undefined;
 if(initial){
  // First review only: put the complete evidence projection in one reusable
  // attachment, not an enormous clipboard payload for every domain. The index
  // still exposes old IDs; GPT, not a theme matcher, chooses what to inspect.
  const history={schema_version:'stat1-capability-history-v1',source_period:facts.source_period,answers:facts.representative_answers,note_observations:facts.note_observations,review_records:facts.review_records,
   excluded_answer_ids:f.attempts.filter(a=>!usable(a)).map(a=>a.id),limits:'評価対象外の答案は索引だけで保持。メモID数は失敗回数ではない。このファイルは評価用の射影であり復元用バックアップではない。'};
  const encoded=JSON.stringify(history),digest=await hash(encoded);historyAttachment={name:`stat1-capability-history-${digest.slice(0,12)}.json`,text:encoded,sha256:digest,answerCount:history.answers.length};
  const selected=new Set(representativeAttempts(f,requested).map(a=>a.id));
  const oldestProblems=[...new Set(representatives.map(a=>a.problem_id))].slice(0,4);
  for(const pid of oldestProblems){const rows=representatives.filter(a=>a.problem_id===pid);for(const a of [rows.find(a=>(a.graded_findings||[]).some(p=>p.resolved&&p.error_type==='none')),rows.find(a=>(a.graded_findings||[]).some(p=>!p.resolved)||a.error_point?.trim())])if(a)selected.add(a.id)}
  const all=facts.representative_answers;
  facts.representative_answers=all.filter(a=>selected.has(a.id));facts.omitted_answer_count=f.attempts.length-facts.representative_answers.length;
  const payload=facts as Record<string,unknown>;delete payload.note_observations;delete payload.review_records;
  payload.history_attachment={name:historyAttachment.name,sha256:digest,answers:all.length,required_for_initial_review:true};
  payload.answer_index=all.map(a=>({id:a.id,problem_id:a.problem_id,date:a.date,success_parts:a.assessed_parts.filter(p=>p.resolved&&p.error_type==='none').map(p=>p.id),unresolved_parts:a.assessed_parts.filter(p=>!p.resolved).map(p=>p.id)}));
 }
 const prompt=(retryIds.length?`【差分の再評価】下の operation_catalog にある ${retryIds.length} 件だけを再照合し、変更を裏づけられる能力だけを evaluations に返す。旧JSONの context_version だけを差し替えない。既に保存済み・根拠不足の能力は繰り返さない。\n`:initial?(all?`【初回・全分野評価】全${capabilityDomains.length}分野の${operations.length}操作を一度に確認し、分野ごとに分割せず、取り込み用JSONを1個だけ返す。根拠のある能力だけを記録する。証拠不足の能力は無理に配列を埋めず、既存評価も新しい根拠がなければ変更しない。各能力の根拠は直接関係する1〜2件を目安にし、次回提案は優先3件まで（他はnull）。\n`:`【初回・分野別評価】今回は${capabilityDomains[domainIndex].name}の区分${batch+1}/${scope.batchCount}、operation_catalogの能力だけを評価する。`)+`過去の有効答案を最小射影で全期間含める。最初の誤りは記録上未確定なら推測しない。成功所見と失敗所見の両方、補修・後続答案を対話で照合する。同じ答案から派生したnote_idsの多さを失敗回数としない。Reviewのdoneだけで成功や定着を認定しない。分野名や問題テーマから能力を一括分類しない。必要な原答案は利用者に依頼し、不明はunconfirmedのままにする。\n`:'')+'統計検定1級・統計数理の学習を、ChatGPT「勉強する」で指導してください。以下はアプリに保存された証拠です。学習方針・出題・採点・原因仮説・習得評価はあなたが担当し、アプリは記録とID照合のみを担当します。\n'+
  (initial?'初回履歴JSON（history_attachmentの名前・hash）を同じ会話の添付として確認する。代表答案だけで全期間の評価を済ませず、answer_indexから古い成功・失敗の該当記録もファイルで照合する。ファイルがない・読めない場合は添付を依頼し、未確認を埋めない。最新の能力評価は今回の依頼を優先し、以前の添付内の情報から現在状態を勝手に戻さない。\n':'')+
  '2026-11-11版「学習停滞の診断と改善指導ルール」に従う。問題消化を目標にしない。最初の不正確な式・条件・記号1件を特定し、連鎖的失点と独立した誤りを区別する。原因は仮説と確信度を示し、局所計算ミスを概念不足と断定しない。未着手を未修復にしない。\n'+
  '初回採点は元得点として固定する。同じ学習で高影響の操作1個だけを必要な1〜3行から丁寧に補修し、解説を閉じて短い自力再現を確認する。説明を読んだだけでは成功としない。次回は原則24〜72時間後を目安に、構造・要求を変えた非誘導の未見問題で確認する。日時は提案であり、アプリが勝手に予定や既存Reviewを書き換えることはない。\n'+
  '診断・転移の出題時は弱点名・分野・定理・解法・正答を先に見せない。数値だけを変えた類題、同じ問題の再挑戦、援助ありを遅延転移成功としない。生成問題は下書き→別passの独立品質確認→自力答案固定→既存採点の順とする。不備は能力失敗でなく保留。\n'+
  '学習の優先順は、異なる問題で再発・後続小問に波及・前提の小さな修復で解消できる操作。出題頻度や消化数で並べない。再発する場合は反復量を増やさず、前提技能に戻る。今日の課題は時間に収まる少数から1つ選ぶ。learning_goal が long_term_theory なら本番形式を優先しない。\n'+
  '【任意の観点別証拠】同じ evidence を使い、観点を分ける場合だけ aspect:derivation（導出・操作）/ concept（意味・条件）/ transfer（異構造への転移）/ retention（期間を空けた保持）を付ける。導出の成功には method_not_cued:true と、実際に自力で実行した採点項目が必要。説明が実際に採点されたときだけ、concept_focus を assessed_parts の同名フィールドから引き継ぐ。意味・成立理由・仮定・適用限界・概念の違い・要求の数式化は必要な一点だけ問う。計算正答から概念正答を推測せず、説明の未達だけで導出成功を取り消さない。\n'+
  '最初の不正確な操作と波及先を既存の採点項目で特定できる場合だけ、同じ能力に error_trace:{"attempt_id":採点済み答案ID,"first_part_id":"最初の未達項目ID","affected_part_ids":["その誤りが波及した別の未達項目ID"]} を追加する。独立した誤り・白紙は波及に含めない。前提の小さな修復を提案する場合だけ prerequisite_ability_id に実在する別の能力IDを加える。仮説は cause_hypothesis のまま。\n'+
  '保持の評価は aspect:retention, kind:delayed_transfer を使う。baseline_attempt_id は同じ能力で自力成功が確認されている直近の基準答案。基準以後に関連する演習や参照があった場合は無視しない。学習日の差はアプリが計算する。日付だけなら経過を最大1日短く見積もる。transfer_conditions で方法の非誘導と構造差を明示する。同じ問題の後日再現は different_structure:false。保持の成功を転移の成功に自動変換しない。異なる構造での転移も評価した場合は別の evidence として返す。\n'+
  '保持の次回提案には next_check.kind:delayed_transfer, aspect:retention, interval_days（1〜365の整数・任意）、estimated_minutes（1〜240・任意）が使える。初期転移24〜72時間、保持は約7・30・90日を目安に、成功が続けば延ばし、失敗時は短い前提補修へ。期日や経過だけで習得段階は変更しない。\n'+
  '分野全体を一度で習得認定せず、下のoperation_catalogの操作IDと実際の採点範囲を対応させる。不確かな対応はcertainty=provisional、矛盾はconflicting。根拠がない能力はunconfirmedのままにする。過去プロフィールの名前一致だけで対応を確定しない。改善済みの操作を無条件で最優先へ戻さない。優先順位と確認時期は根拠を述べて提案し、同じ成功類題を漫然と追加しない。\n'+
  '状態は unconfirmed / unrepaired / immediate_confirmed / delayed_transfer_confirmed / exam_confirmed。根拠がない能力は列挙しない。first_error と cause_hypothesis は答案の記録から確認・推論できないときは null。局所補修の成功を直後の自力再現に読み替えず、直後成功から後続段階を推測しない。各証拠kindは diagnostic / local_repair / immediate_reproduction / delayed_transfer / exam、outcomeは success / failure / partial / uncertain。遅延転移の証拠には transfer_conditions:{"different_structure":true|false,"method_not_cued":true|false} を付ける。基準答案はbaseline_attempt_idで指定する。日付しかない翌日の記録は24時間経過を立証できない。\n'+
  '直後再現には同じ日の基準答案と timing=same_session_correction・reference_closed_reproduction=true・参照なしの別答案が必要。同日の独立演習は含めない。本番は正式に紐づいた選択答案だけで確認し、個別の時間制限つき演習や本番後の解答は含めない。next_check:null は提案の追加なし（前提の状態が変わらなければ従来の提案を維持）。既存提案を明示的に撤回するときだけ、根拠を説明し certainty=confirmed と next_check:null と next_check_action="withdraw" を指定する。\n'+
  `まず通常の文章で対話・解説してよい。保存時だけ下記スキーマの標準JSONを1個返す。Markdownフェンス・JSON外の文章は付けず、配列は[]、不明値は明示的null、空の値は禁止。評価は今回確認した最大${retryIds.length?Math.min(retryIds.length,all?operations.length:12):all?operations.length:12}能力、各説明1〜2文、次回行動は能力ごとに1件まで。evaluations配列はあなたが提案する重要度の順で、今回の重点を先頭に置く。${initial?'添付履歴のanswers（採点項目はassessed_parts）または保存済み能力評価':'代表答案または保存済み能力評価'}に明示されたIDだけを参照し、必要な古い原資料は利用者へ依頼する。得点の再出力・書換えは不要。\n`+JSON.stringify(schema)+'\n保存済み証拠：\n'+JSON.stringify(facts);
 const eligibleAttemptIds=eligibleAttempts(f,initial,requested);
 return {version,catalogVersion:CAPABILITY_CATALOG_VERSION,prompt,eligibleAttemptIds,scope,historyAttachment,sourcePeriod:{first:[...f.attempts].map(a=>a.date).sort()[0]??null,last:[...f.attempts].map(a=>a.date).sort().at(-1)??null},answerCount:f.attempts.length};
}
function invalidImportEvidence(e:CapabilityEvaluation,x:EvidenceIndex,allowed:Set<number>,date:string){
 for(const s of e.evidence){
  const a=x.attempts.get(s.attempt_id);
  if(!a||!allowed.has(s.attempt_id))return `根拠答案 #${s.attempt_id} は今回の評価対象にありません。`;
  if(!x.problems.has(a.problem_id))return `答案 #${a.id} の関連問題がありません。`;
  const outside=s.part_ids.filter(p=>!x.parts(a).includes(p));
  if(outside.length)return `答案 #${a.id}：対象外または存在しない採点項目 ${outside.join(' / ')}。`;
  if(a.date>date)return `答案 #${a.id} は評価日時より後です。`;
  if(s.baseline_attempt_id!==null){const b=x.attempts.get(s.baseline_attempt_id);
   if(!b||!allowed.has(b.id)||!usable(b)||!x.problems.has(b.problem_id)||b.date>date||attemptOrder(b,a)>=0)return `baseline_attempt_id #${s.baseline_attempt_id}：今回の有効な評価対象にないか、答案 #${a.id} より前の基準答案ではありません。`;
  }
 }
 if(e.error_trace){
  const t=e.error_trace,a=x.attempts.get(t.attempt_id),ids=[t.first_part_id,...t.affected_part_ids];
  if(!a||!allowed.has(a.id)||!e.evidence.some(s=>s.attempt_id===a.id&&failed(s.outcome)&&s.part_ids.includes(t.first_part_id))||
    ids.some(id=>!x.parts(a).includes(id)||!observedFailureParts(a,[id]).length))
   return `error_trace：答案 #${t.attempt_id} の最初の誤りと波及先を、有効な未達の採点項目で照合してください。白紙・範囲外は指定できません。`;
 }
}

async function makeCapabilityRecord(raw:string,wire:CapabilityWire,f:CapabilityFacts,x:EvidenceIndex):Promise<CapabilityRecord>{
 const sourceSignatures:Record<string,string>={},generatedSources:Record<string,string|null>={};
 for(const e of wire.evaluations)for(const s of e.evidence){
  const a=x.attempts.get(s.attempt_id)!;sourceSignatures[a.id]=x.signature(a);
  if(s.baseline_attempt_id!==null){const b=x.attempts.get(s.baseline_attempt_id)!;sourceSignatures[b.id]=x.signature(b)}
  const p=x.problems.get(a.problem_id);
  if(p?.source_type==='generated'&&!Object.hasOwn(generatedSources,p.problem_id)){
   try{await validateGeneratedContent(p);generatedSources[p.problem_id]=generatedSignature(p)}catch{generatedSources[p.problem_id]=null}
  }
 }
 return {schemaVersion:'stat1-capability-record-v1',id:await hash(canonicalValue(wire)),createdAt:new Date().toISOString(),wire,items:wire.evaluations.map(e=>({...e,effectiveState:e.state,warnings:[]})),sourceSignatures,
  sourceCutoffAttemptId:Math.max(0,...f.attempts.map(a=>a.id)),rawHash:await hash(raw),savedAfterCount:f.records?.length||0,...(Object.keys(generatedSources).length?{generatedSources}:{})};
}

export async function planCapabilityImport(raw:string,f:CapabilityFacts):Promise<CapabilityImportPlan>{
 const wire=parseCapabilityUpdate(raw),match=contextPattern.exec(wire.context_version),records=f.records||[];
 const selection:CapabilityContextScope=match?.[2]==='iall'?{initial:true,domainId:'all'}:match?.[3]?{initial:true,domainId:capabilityDomains[parseInt(match[3],36)]?.id,batch:Number(match[4])}:{};
 const {scope}=getCapabilityScope(selection);
 const scopedMask=match?.[7]??match?.[9],mask=scopedMask==='all'?undefined:scopedMask,requested=mask?idsFromMask(mask):undefined;
 if(mask&&(!requested?.length||maskOf(requested)!==mask||requested.some(id=>!scope.abilityIds.includes(id))))fail('context_version','差分の対象範囲が正しくありません。入力を保持し、最新の評価依頼を取り直してください。');
 const requestedScope=requested??scope.abilityIds,allowedAbilities=new Set(requestedScope);
 const {baseline,currentVersion}=await findRequestBaseline(wire.context_version,f,scopedMask?{ids:requested,mask:scopedMask,initial:scope.initial,revision:match?.[8]!==undefined?'r4':'r3'}:undefined),baselineIds=new Set(baseline?.map(r=>r.id));
 const changedIds=new Set(records.filter(r=>!baselineIds.has(r.id)).flatMap(r=>r.items.map(i=>i.ability_id)));
 const latest=new Map(latestCapabilityItems(f).map(pair=>[pair.item.ability_id,pair]));
 const x=evidenceIndex(f),allowed=new Set(baseline?eligibleAttempts({...f,records:baseline},scope.initial,requested,match?.[8]===undefined):[]),date=capabilityDate(wire.evaluated_at);
 const ready:CapabilityEvaluation[]=[];
 const entries=wire.evaluations.map((e):CapabilityImportEntry=>{
  const abilityId=e.ability_id,prior=latest.get(abilityId),at=Date.parse(wire.evaluated_at),same=(r:CapabilityRecord)=>r.wire.evaluations.some(item=>item.ability_id===abilityId&&canonicalValue(item)===canonicalValue(e));
  if(!allowedAbilities.has(abilityId))return {abilityId,status:'rejected',reason:'今回の依頼範囲に含まれない対象能力です。範囲外の能力は、別の評価依頼で照合してください。'};
  if(records.some(r=>Date.parse(r.wire.evaluated_at)===at&&same(r)))return {abilityId,status:'saved'};
  if(!baseline)return {abilityId,status:'conflict',reason:'依頼時点の状態を照合できません。答案・Reviewなどの更新、または元の履歴が確認できないため保存しません。'};
  const invalid=invalidImportEvidence(e,x,allowed,date);
  if(invalid)return {abilityId,status:'rejected',reason:invalid};
  if(prior&&same(prior.record)&&e.evidence.every(s=>[s.attempt_id,s.baseline_attempt_id].every(id=>id===null||(x.attempts.has(id)&&x.signature(x.attempts.get(id)!)===prior.record.sourceSignatures[id]))))return {abilityId,status:'saved'};
  if(changedIds.has(abilityId))return {abilityId,status:'conflict',reason:'依頼の作成後にこの能力の評価が保存されました。保存済みの評価を維持します。'};
  if(prior&&Date.parse(prior.record.wire.evaluated_at)>=at)return {abilityId,status:'conflict',reason:'この能力には同じ日時か、より新しい評価が保存されています。現在の評価を維持します。'};
  if(prior?.item.evidence.length&&!e.evidence.length)return {abilityId,status:'conflict',reason:'既存評価を見直す根拠答案が指定されていません。現在の評価を維持します。'};
  ready.push(e);return {abilityId,status:'ready',change:prior?'updated':'new'};
 });
 const before=projectCapabilityMap(f,records),rejected=entries.filter(e=>e.status==='rejected').length;
 const candidate=ready.length&&!rejected?await makeCapabilityRecord(raw,{...wire,evaluations:ready},f,x):null;
 const after=candidate?projectCapabilityMap(f,[...records,candidate]):before;
 if(candidate)candidate.items=after.abilities.flatMap(a=>{
  const row=a.history.find(h=>h.record.id===candidate.id);return row?[{...row.item,effectiveState:row.validation.state,warnings:row.validation.warnings}]:[];
 }).sort((a,b)=>ready.findIndex(e=>e.ability_id===a.ability_id)-ready.findIndex(e=>e.ability_id===b.ability_id));
 const beforeById=new Map(before.abilities.map(a=>[a.id,a])),afterById=new Map(after.abilities.map(a=>[a.id,a]));
 for(const entry of entries){
  const b=beforeById.get(entry.abilityId)!,a=afterById.get(entry.abilityId)!;
  entry.beforeState=b.state;entry.afterState=a.state;entry.stateReason=a.stateReason;
  const previous=b.proposalSource?.item.next_check,next=a.proposalSource?.item.next_check;
  entry.nextCheck=next??null;
  if(previous||next)entry.proposalChange=canonicalValue(previous)===canonicalValue(next)?'maintained':next?'updated':'withdrawn';
  const imported=candidate?a.theory.entries.filter(o=>o.recordId===candidate.id&&o.link.aspect):[];
  if(imported.length)entry.theory=Object.fromEntries(theoryAspectKeys.flatMap(aspect=>{
   const rows=imported.filter(o=>o.aspect===aspect),row=rows.find(o=>o.status==='failure')??rows.find(o=>o.status==='success')??rows[0];
   return row?[[aspect,{status:row.status,afterStatus:a.theory.aspects[aspect].status,submitted:row.link.outcome,reason:rows.map(o=>`答案 #${o.link.attempt_id}：${o.reason}`).join(' ')}]]:[];
  }));
 }
 const duplicate=!rejected&&!candidate&&entries.some(e=>e.status==='saved');
 const record=candidate||(duplicate?records.find(r=>canonicalValue(r.wire)===canonicalValue(wire))||null:null);
 const ids=new Set(wire.evaluations.map(e=>e.ability_id));
 const summary={new:rejected?0:entries.filter(e=>e.change==='new').length,updated:rejected?0:entries.filter(e=>e.change==='updated').length,maintained:before.abilities.filter(a=>a.current&&!ids.has(a.id)).length,
  duplicate:entries.filter(e=>e.status==='saved').length,conflict:entries.filter(e=>e.status==='conflict').length,rejected,blocked:rejected?ready.length:0,before:before.metrics,after:after.metrics};
 return {record,entries,summary,duplicate,confirmationToken:await hash(canonicalValue([raw,currentVersion,entries])),recoveryScope:{...selection,
  retryIds:entries.filter(e=>allowedAbilities.has(e.abilityId)&&(e.status==='conflict'||e.status==='rejected'||rejected>0&&e.status==='ready')).map(e=>e.abilityId)}};
}

/** Strict single-record helper for callers that require the whole input. */
export async function prepareCapabilityUpdate(raw:string,f:CapabilityFacts):Promise<CapabilityRecord>{
 const plan=await planCapabilityImport(raw,f),conflict=plan.entries.find(e=>e.status==='conflict'||e.status==='rejected');
 if(conflict)fail(conflict.abilityId,conflict.reason!);
 return plan.record||fail('evaluations','新しく保存する能力評価がありません。');
}
export const capabilityUpdateId=async(raw:string)=>hash(canonicalValue(parseCapabilityUpdate(raw)));
export function readCapabilityRecords(meta:Array<{key:string;value:string}>){
 const records:CapabilityRecord[]=[],issues:string[]=[];
 for(const row of meta.filter(m=>m.key.startsWith(CAPABILITY_RECORD_PREFIX))){try{const r=JSON.parse(row.value) as CapabilityRecord;
  if(r.schemaVersion!=='stat1-capability-record-v1'||!r.id||row.key!==CAPABILITY_RECORD_PREFIX+r.id||!Array.isArray(r.items)||!r.sourceSignatures||!r.wire)throw Error('format');
  const wire=parseCapabilityUpdate(canonicalValue(r.wire),true);
  if(r.items.length!==wire.evaluations.length||r.items.some((e,i)=>e.ability_id!==wire.evaluations[i].ability_id||!Object.hasOwn(capabilityStates,e.effectiveState)||!['unconfirmed',e.state].includes(e.effectiveState)||!Array.isArray(e.warnings)||e.warnings.some(w=>typeof w!=='string')||e.warnings.length>0&&e.effectiveState!=='unconfirmed'||canonicalValue({...e,effectiveState:undefined,warnings:undefined})!==canonicalValue(wire.evaluations[i])))throw Error('stored evaluations differ from their original wire');
  records.push(r);
 }catch{issues.push(`能力評価 ${row.key} を読み取れません。原記録は保持し、集計対象外としました。`)}}
 return {records,issues};
}
export function projectCapabilityMap(f:CapabilityFacts,records:CapabilityRecord[]=f.records||[]){
 const x=evidenceIndex(f),byAbility=new Map<string,EvaluationHistory[]>();
 for(const record of [...records].sort(recordOrder))for(const item of record.items){const list=byAbility.get(item.ability_id)||[];list.push({record,item});byAbility.set(item.ability_id,list)}
 const abilities=capabilityCatalog.map(c=>{
  const rows=(byAbility.get(c.id)||[]).map(h=>({...h,observations:h.item.evidence.map(s=>({...inspectEvidence(s,h,x),evaluatedAt:h.record.wire.evaluated_at,recordId:h.record.id}))})),all=rows.flatMap(r=>r.observations);
  const history=rows.map(h=>({...h,validation:resolveEvaluation(h.item,h.observations,all,x)}));
  const current=history[0],sideOnly=(h:typeof current)=>h.observations.length>0&&h.observations.every(o=>!operationStageEvidence(o));
  const annotation=(h:typeof current)=>sideOnly(h)||h.item.certainty==='provisional'||h.item.certainty==='confirmed'&&h.item.state==='unconfirmed';
  const stateSource=history.find(h=>!annotation(h))||current;
  const tied=(at:typeof current)=>at&&!annotation(at)&&history.some(h=>!annotation(h)&&h.record.id!==at.record.id&&Date.parse(h.record.wire.evaluated_at)===Date.parse(at.record.wire.evaluated_at)&&h.item.state!==at.item.state);
  const warnings=[...(!stateSource||sideOnly(stateSource)?[]:stateSource.validation.warnings)];
  if(tied(stateSource))warnings.push('同じ評価日時に異なる状態があり、判断を保留しています。');
  const state:CapabilityState=stateSource&&!sideOnly(stateSource)&&!warnings.length?stateSource.validation.state:'unconfirmed';
  const stateReason=!current?'能力と答案を対応づけたGPT評価がまだありません。':warnings.length?warnings.join(' '):state==='unconfirmed'?
   sideOnly(stateSource)?'意味・条件または保持の評価はありますが、それだけで従来の5段階は判定しません。':'評価履歴はありますが、習得段階を確認できる根拠はまだありません。':
   `${stateSource!==current?(sideOnly(current)?'意味・条件と保持は別に記録し、以前の段階を維持。':'最新行は新しい状態を判断していないため、以前の判定を維持。'):''}根拠 ${stateSource.validation.proofIds.join(' / ')}。`;
  const directByAttempt=new Map<number,{attempt:Attempt;outcomes:CapabilityEvidence['outcome'][];partIds:string[]}>();
  for(const {attempt,link,direct} of all)if(direct&&attempt){
   const old=directByAttempt.get(attempt.id);if(old){if(!old.outcomes.includes(link.outcome))old.outcomes.push(link.outcome);old.partIds=unique([...old.partIds,...link.part_ids]);}
   else directByAttempt.set(attempt.id,{attempt,outcomes:[link.outcome],partIds:link.part_ids});
  }
  const directEvidence=[...directByAttempt.values()].sort((a,b)=>attemptOrder(b.attempt,a.attempt));
  const problemIds=unique(all.flatMap(s=>s.attempt?[s.attempt.problem_id]:[]));
  // An annotation with no new plan is not a withdrawal. Do not carry plans
  // past an explicit withdrawal or a different decisive state.
  const incompatible=(h:typeof current)=>!annotation(h)&&(h.item.certainty==='conflicting'||h.item.state!==stateSource?.item.state);
  const plan=history.find(h=>h.item.next_check_action==='withdraw'||incompatible(h)||!!h.item.next_check&&(!annotation(h)||
   Date.parse(h.record.wire.evaluated_at)>=Date.parse(stateSource!.record.wire.evaluated_at)));
  const proposalSource=plan?.item.next_check&&!incompatible(plan)?plan:undefined;
  const canTrain=!!proposalSource&&proposalSource.item.next_check?.kind==='delayed_transfer'&&!warnings.length&&proposalSource.item.certainty==='confirmed'&&
   proposalSource.observations.some(e=>e.direct)&&proposalSource.observations.every(e=>!e.warnings.length);
  const previous=history.slice(history.indexOf(stateSource)+1).find(h=>!annotation(h)),recurrence=state==='unrepaired'&&history.slice(1).some(h=>expectedKind[h.item.effectiveState]);
  const improved=!!previous&&!!expectedKind[state]&&state!==previous.item.effectiveState;
  const knownIds=new Set(history.flatMap(h=>h.item.evidence.map(s=>s.attempt_id)));
  const newerLinkedAnswers=f.attempts.filter(a=>usable(a)&&!knownIds.has(a.id)&&(
   a.transfer_lineage?.capabilityEvaluation?.abilityId===c.id||a.daily_answer&&
   (a.daily_answer.target_ability_ids.includes(c.id)||a.daily_answer.repair?.ability_id===c.id)&&
   (!current||a.id>(current.record.sourceCutoffAttemptId??0))));
  const assessed=theoryEvidence(c.id,all,x);
  const failures=new Map<number,Attempt>();
  for(const axis of Object.values(assessed.aspects))if(axis.status==='failure'){
   const success=axis.history.find(o=>o.status==='success')?.attempt;
   for(const o of axis.history)if(o.status==='failure'&&o.attempt&&(!success||attemptOrder(o.attempt,success)>0))failures.set(o.attempt.id,o.attempt);
  }
  if(state==='unrepaired')for(const o of all)if(o.direct&&o.certainty==='confirmed'&&o.attempt&&!o.link.aspect&&failed(o.link.outcome)&&
    (!assessed.lastOperation||attemptOrder(o.attempt,assessed.lastOperation.attempt)>0))failures.set(o.attempt.id,o.attempt);
  const errorTrace=history.find(h=>h.item.certainty==='confirmed'&&h.item.error_trace&&failures.has(h.item.error_trace.attempt_id)&&
   h.observations.some(o=>o.direct&&o.link.attempt_id===h.item.error_trace!.attempt_id&&failed(o.link.outcome)&&o.outcomePartIds.includes(h.item.error_trace!.first_part_id)))?.item.error_trace;
  const theory:TheoryEvidence&Pick<typeof assessed,'entries'|'lastOperation'>={...assessed,errorTrace,failureAttemptIds:[...failures.values()].sort((a,b)=>attemptOrder(b,a)).map(a=>a.id),
   failureProblemCount:new Set([...failures.values()].map(a=>a.problem_id)).size};
  return {...c,state,current,stateSource,proposalSource,canTrain,stateReason,history,directEvidence,problemIds,warnings:unique(warnings),recurrence,improved,theory,newerLinkedAnswers:newerLinkedAnswers.map(a=>a.id),
   stages:{immediate_reproduction:state==='immediate_confirmed',delayed_transfer:state==='delayed_transfer_confirmed',exam:state==='exam_confirmed'}};
 });
 const counts=Object.fromEntries(Object.keys(capabilityStates).map(s=>[s,abilities.filter(a=>a.state===s).length])) as Record<CapabilityState,number>;
 const measure=(rows:typeof abilities):CapabilityMetrics=>({historyRows:rows.reduce((n,a)=>n+a.history.length,0),historyOperations:rows.filter(a=>a.current).length,directEvidenceOperations:rows.filter(a=>a.directEvidence.length).length,determinedOperations:rows.filter(a=>a.state!=='unconfirmed').length,unconfirmedOperations:rows.filter(a=>a.state==='unconfirmed').length});
 const metrics=measure(abilities);
 const domains=capabilityDomains.map(d=>{const rows=abilities.filter(c=>c.domainId===d.id);return {...d,abilities:rows,total:rows.length,metrics:measure(rows),counts:Object.fromEntries(Object.keys(capabilityStates).map(s=>[s,rows.filter(a=>a.state===s).length])) as Record<CapabilityState,number>}});
 const checks=abilities.flatMap(a=>a.proposalSource?.item.next_check?[{ability:a,check:a.proposalSource.item.next_check,evaluatedAt:a.proposalSource.record.wire.evaluated_at,proposed:true as const}]:[]).sort((a,b)=>(a.check.due_date||'9999').localeCompare(b.check.due_date||'9999'));
 const priorities=latestCapabilityItems({...f,records}).flatMap(({item})=>{const ability=abilities.find(a=>a.id===item.ability_id);return ability?.state==='unrepaired'?[ability]:[]});
 return {abilities,counts,metrics,domains,total:abilities.length,evaluated:metrics.historyOperations,checks,priorities,recurrences:abilities.filter(a=>a.recurrence),improved:abilities.filter(a=>a.improved)};
}
