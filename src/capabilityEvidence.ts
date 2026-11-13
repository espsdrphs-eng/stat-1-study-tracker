import type {Attempt,Problem,Review,PastSession,WeakNote} from './types.ts';
import {CAPABILITY_CATALOG_VERSION,capabilityById,capabilityCatalog,capabilityDomains,capabilityStates,capabilityKinds,type CapabilityState,type CapabilityKind} from './capabilityCatalog.ts';
import {normalizeCompatibleJson} from './jsonSyntax.ts';
import {confidentGrading} from './skillEvidence.ts';
import {attemptPlanningEligible,findingPlanningEligible} from './legacyKPolicy.ts';
import {GENERATION_CHECKS,validateGeneratedContent} from './generatedTransfer.ts';
import {sessionSelectedIds} from './pastExamSessionScope.ts';
import {resolvePastExamProblemId} from './examReferencePack.ts';

export const CAPABILITY_RECORD_PREFIX='capability-evaluation:v1:';
const contextPattern=/^(capability-context:(?:(iall|i([0-9a-z]+)p(\d+)):)?)(?:r2:([0-9a-z]+):|r3:([0-9a-z]+):([0-9a-f]{20}):)?[0-9a-f]{64}$/;
export const isInitialAllCapabilityContext=(version:string)=>contextPattern.exec(version)?.[2]==='iall';
export type CapabilityEvidence={attempt_id:number;part_ids:string[];kind:CapabilityKind;outcome:'success'|'failure'|'partial'|'uncertain';baseline_attempt_id:number|null;observation:string;transfer_conditions?:{different_structure:boolean;method_not_cued:boolean}};
export type CapabilityEvaluation={ability_id:string;state:CapabilityState;certainty:'confirmed'|'provisional'|'conflicting';judgement:string;first_error:string|null;cause_hypothesis?:string|null;evidence:CapabilityEvidence[];next_check:{kind:CapabilityKind;due_date:string|null;task:string;success_condition:string}|null;next_check_action?:'withdraw'};
export type CapabilityWire={schema_version:'stat1-capability-v1';catalog_version:string;context_version:string;evaluated_at:string;evaluations:CapabilityEvaluation[]};
export type CapabilityRecord={schemaVersion:'stat1-capability-record-v1';id:string;createdAt:string;wire:CapabilityWire;items:Array<CapabilityEvaluation&{effectiveState:CapabilityState;warnings:string[]}>;sourceSignatures:Record<string,string>;sourceCutoffAttemptId?:number;rawHash:string;savedAfterCount?:number;generatedSources?:Record<string,string|null>};
export type CapabilityFacts={problems:Problem[];attempts:Attempt[];reviews?:Review[];pastSessions?:PastSession[];capabilityPastSessions?:PastSession[];weakNotes?:WeakNote[];records?:CapabilityRecord[]};
export type CapabilityContextScope={initial?:boolean;domainId?:string;batch?:number;retryIds?:string[]};
export type CapabilityImportEntry={abilityId:string;status:'ready'|'saved'|'conflict'|'rejected';reason?:string;change?:'new'|'updated';beforeState?:CapabilityState;afterState?:CapabilityState;stateReason?:string;
 nextCheck?:CapabilityEvaluation['next_check'];proposalChange?:'maintained'|'updated'|'withdrawn'};
export type CapabilityMetrics={historyRows:number;historyOperations:number;directEvidenceOperations:number;determinedOperations:number;unconfirmedOperations:number};
export type CapabilityImportPlan={record:CapabilityRecord|null;entries:CapabilityImportEntry[];duplicate:boolean;confirmationToken:string;recoveryScope:CapabilityContextScope;
 summary:{new:number;updated:number;maintained:number;duplicate:number;conflict:number;rejected:number;blocked:number;before:CapabilityMetrics;after:CapabilityMetrics}};
export const canonicalValue=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,x[k]])):x);
const hash=async(v:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const usable=(a:Attempt)=>attemptPlanningEligible(a)&&!a.exclude_from_metrics&&!a.exclude_from_planning&&!a.duplicate_of_attempt_id&&!a.invalidated_at&&!a.superseded_by_attempt_id;
const partIds=(a:Attempt)=>(a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)&&!a.grading_contract?.explicitlyOutOfScopePartIds?.includes(f.graded_part_id)).map(f=>f.graded_part_id);
function attemptFact(a:Attempt){
 return {id:a.id,problem_id:a.problem_id,date:a.date,mode:a.mode,score_numeric:a.score_numeric,score_max:a.score_max,error_point:a.error_point,result_summary:a.result_summary,
  error_type:a.error_type,error_types:a.error_types,primary_error_type:a.primary_error_type,secondary_error_type:a.secondary_error_type,k_evidence_valid:a.k_evidence_valid,k_evidence:a.k_evidence,policy_validity:a.policy_validity,effective_error_types:a.effective_error_types,rubric_version:a.rubric_version,
  graded_findings:a.graded_findings,contract_id:a.contract_id,contract_hash:a.contract_hash,grading_contract:a.grading_contract,
  reference_level:a.actual_reference_level??a.reference_level??null,hint_used:a.hint_used??null,grading_confidence:a.grading_confidence??null,
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
 return {catalog:CAPABILITY_CATALOG_VERSION,problems:[...f.problems].sort((a,b)=>a.problem_id.localeCompare(b.problem_id)).map(p=>({id:p.problem_id,source:p.source_type,generated:p.generated_transfer})),attempts:[...f.attempts].sort((a,b)=>a.id-b.id),
  reviews:[...(f.reviews||[])].sort((a,b)=>a.id-b.id),sessions:[...(f.pastSessions||[])].sort((a,b)=>a.id-b.id),weakNotes:[...(f.weakNotes||[])].sort((a,b)=>a.id-b.id)};
}
const recordFacts=(records:CapabilityRecord[])=>records.map(r=>({id:r.id,wire:r.wire})).sort((a,b)=>a.id.localeCompare(b.id));
// Preserve the exact legacy serialization for previously issued requests.
export const capabilityFactsSignature=(f:CapabilityFacts)=>canonicalValue({...sourceFacts(f),records:recordFacts(f.records||[])});
const revisionVersion=async(stem:string,sourceHash:string,records:CapabilityRecord[])=>stem+`r2:${records.length.toString(36)}:`+await hash(canonicalValue([stem,sourceHash,recordFacts(records)]));

// Catalog-versioned, compact scope. Include the mask and the exact permitted
// answer IDs in the digest; copying a mask from another request cannot widen it.
const maskOf=(ids:string[])=>{
 const set=new Set(ids),bytes=new Uint8Array(Math.ceil(capabilityCatalog.length/8));
 capabilityCatalog.forEach((c,i)=>{if(set.has(c.id))bytes[i>>3]|=1<<(i%8)});
 return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
};
const idsFromMask=(mask:string)=>capabilityCatalog.filter((_c,i)=>(parseInt(mask.slice((i>>3)*2,(i>>3)*2+2),16)&(1<<(i%8)))!==0).map(c=>c.id);
type ScopedRequest={ids:string[];mask:string;initial:boolean};
const scopedRevisionVersion=async(stem:string,sourceHash:string,f:CapabilityFacts,request:ScopedRequest)=>{
 const records=f.records||[],eligible=eligibleAttempts(f,request.initial,request.ids).sort((a,b)=>a-b);
 return stem+`r3:${records.length.toString(36)}:${request.mask}:`+await hash(canonicalValue([stem,sourceHash,request.mask,eligible,recordFacts(records)]));
};

async function findRequestBaseline(version:string,f:CapabilityFacts,scoped?:ScopedRequest){
 const match=contextPattern.exec(version),records=f.records||[];
 if(!match)return {currentVersion:await hash(capabilityFactsSignature(f))};
 const stem=match[1],count=match[5]??match[6];
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
   return {attempt_id:id(s.attempt_id,`${q}.attempt_id`),part_ids,kind:oneOf(s.kind,Object.keys(capabilityKinds) as CapabilityKind[],`${q}.kind`),
    outcome:oneOf(s.outcome,['success','failure','partial','uncertain'],`${q}.outcome`),baseline_attempt_id:s.baseline_attempt_id===null?null:id(s.baseline_attempt_id,`${q}.baseline_attempt_id`),observation:text(s.observation,`${q}.observation`),
    ...(transfer?{transfer_conditions:{different_structure:transfer.different_structure,method_not_cued:transfer.method_not_cued}}:{})} as CapabilityEvidence;
  });
  let next_check:CapabilityEvaluation['next_check']=null;
  if(e.next_check!==null){const n=obj(e.next_check,`${p}.next_check`);next_check={kind:oneOf(n.kind,Object.keys(capabilityKinds) as CapabilityKind[],`${p}.next_check.kind`),due_date:n.due_date===null?null:day(n.due_date,`${p}.next_check.due_date`),task:text(n.task,`${p}.next_check.task`,240),success_condition:text(n.success_condition,`${p}.next_check.success_condition`,240)}}
  const certainty=oneOf(e.certainty,['confirmed','provisional','conflicting'],`${p}.certainty`);
  const action=e.next_check_action===undefined?undefined:oneOf(e.next_check_action,['withdraw'],`${p}.next_check_action`);
  if(action&&(next_check||certainty!=='confirmed'))fail(`${p}.next_check_action`,'提案の撤回は、確定した照合で next_check:null と併せて指定してください。');
  return {ability_id,state:oneOf(e.state,Object.keys(capabilityStates) as CapabilityState[],`${p}.state`),certainty,judgement:text(e.judgement,`${p}.judgement`),first_error:e.first_error===null?null:text(e.first_error,`${p}.first_error`),
   ...(e.cause_hypothesis!==undefined?{cause_hypothesis:e.cause_hypothesis===null?null:text(e.cause_hypothesis,`${p}.cause_hypothesis`)}:{}),evidence,next_check,...(action?{next_check_action:action}:{})};
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
 const signatures=new Map<number,string>(),parts=new Map<number,string[]>();
 return {attempts,problems,sessions,rows:f.attempts,signature(a:Attempt){if(!signatures.has(a.id))signatures.set(a.id,sourceSignature(a));return signatures.get(a.id)!},
  parts(a:Attempt){if(!parts.has(a.id))parts.set(a.id,partIds(a));return parts.get(a.id)!}};
}
type EvidenceIndex=ReturnType<typeof evidenceIndex>;
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
 const failureParts=findings.filter(p=>!p.resolved&&actualError(p.error_type)&&!!p.evidence?.trim());
 if(s.outcome==='success'&&(!findings.length||findings.some(p=>!p.resolved||p.error_type!=='none'||!p.evidence?.trim())))warnings.push(`答案 #${a.id} の対象内成功を採点記録から確認できません。`);
 if(failed(s.outcome)&&!(failureParts.length||!s.part_ids.length&&!a.graded_findings?.length&&actualError(a.error_type)&&!!a.error_point?.trim()))warnings.push(`答案 #${a.id} に指定範囲の明確な未達所見がありません。未着手・未採点は失敗にしません。`);
 if(problem?.source_type==='generated'){
  const signed=record.generatedSources?.[problem.problem_id];
  if(signed===null||signed!==undefined&&signed!==generatedSignature(problem)||signed===undefined&&item.warnings.includes(generatedWarning))warnings.push(generatedWarning);
 }
 return {link:s,attempt:a,baseline,certainty:item.certainty,exerciseKind,outcomePartIds:(failed(s.outcome)?failureParts:findings).map(p=>p.graded_part_id),warnings,direct:s.outcome!=='uncertain'&&warnings.length===0};
}
type InspectedEvidence=ReturnType<typeof inspectEvidence>;

/** Stage requirements apply to the decisive success, not to background
 * observations such as an assisted diagnostic or a historical failure. */
function successStageWarnings(e:CapabilityEvaluation,s:CapabilityEvidence,a:Attempt,baseline:Attempt|undefined,x:EvidenceIndex){
 const warnings:string[]=[];
 const contradicted=x.rows.some(n=>usable(n)&&confidentGrading(n)&&attemptOrder(n,a)>0&&(
  n.transfer_lineage?.capabilityEvaluation?.abilityId===e.ability_id&&n.target_skill_assessment?.outcome==='failure'||
  n.problem_id===a.problem_id&&(n.graded_findings||[]).some(p=>x.parts(n).includes(p.graded_part_id)&&!p.resolved&&actualError(p.error_type)&&!!p.evidence?.trim()&&s.part_ids.some(id=>samePart(a,id,n,p.graded_part_id)))));
 if(contradicted)warnings.push(`答案 #${a.id} より新しい答案に同じ対象範囲の未達があります。後続答案を含めてGPTで再照合してください。`);
 if((a.actual_reference_level??a.reference_level)!==0||a.hint_used!==false)warnings.push(`答案 #${a.id} の参照なし・ヒントなしを確認できません。`);
 if(a.one_line_hint||a.previous_mistake||a.official_answer||a.gpt_explanation||a.saved_gpt_feedback||a.external_reference)warnings.push(`答案 #${a.id} の参照フラグと自力成功の申告が矛盾しています。`);
 if(a.target_skill_prompted===true&&(s.kind==='delayed_transfer'||s.kind==='exam'))warnings.push(`答案 #${a.id} は対象技能が事前に示されています。`);
 if((a.transfer_lineage?.capabilityEvaluation?.abilityId===e.ability_id||a.transfer_lineage?.abilityProfile?.id===e.ability_id)&&(!a.target_skill_assessment||a.target_skill_assessment.outcome!=='success'||!a.target_skill_assessment.self_selected||!a.target_skill_assessment.major_calculation_success||!a.target_skill_assessment.no_major_error))warnings.push(`答案 #${a.id} の総合点とは別の対象能力判定が成功していません。`);
 if(s.kind==='immediate_reproduction'){
  if(!baseline||baseline.problem_id!==a.problem_id||baseline.date!==a.date)warnings.push(`答案 #${a.id} の同一課題での直後再現を確認できません。`);
  if(!immediateReproduction(a))warnings.push(`答案 #${a.id} に参照なしの直後再現の実施記録がありません。同日中の独立演習・局所補修だけでは直後再現としません。`);
 }
  if(s.kind==='delayed_transfer'){
   if(!baseline||baseline.problem_id===a.problem_id||baseline.id===a.id)warnings.push(`答案 #${a.id} は元問題と異なる課題の確認になっていません。`);
   // Date-only records cannot prove 24 hours across adjacent calendar dates.
   if(!baseline||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!/^\d{4}-\d{2}-\d{2}$/.test(baseline.date)||(Date.parse(a.date)-Date.parse(baseline.date))<2*86400000)warnings.push(`答案 #${a.id} の遅延間隔を確認できません（日付のみでは2暦日以上必要、翌日の時刻は未確認）。`);
   if(x.rows.some(old=>old.problem_id===a.problem_id&&attemptOrder(old,a)<0))warnings.push(`答案 #${a.id} は既習問題の再挑戦です。`);
   if(!s.transfer_conditions?.different_structure||!s.transfer_conditions?.method_not_cued)warnings.push(`答案 #${a.id} の構造変更・非誘導についてGPTの明示的確認がありません。`);
   const problem=x.problems.get(a.problem_id);
   if(problem?.source_type==='generated'){
    const c=problem.generated_transfer;
    if(!c?.answer_submission||!c.validation||GENERATION_CHECKS.some(k=>c.validation.checks[k]?.pass!==true)||c.validation.draft_hash!==c.content_hash||c.generator_pass_id===c.validation.validator_pass_id)warnings.push(`答案 #${a.id} の生成問題に独立品質確認・自力答案固定の証拠が不足しています。`);
    const blind=c?.answer_submission?.noncued;
    if(a.target_skill_prompted!==false||!c?.lineage.noncuedRequestId||blind?.requestId!==c.lineage.key||blind?.externalReview!=='not_viewed'||!Array.isArray(blind.exposures)||blind.exposures.length!==0)warnings.push(`答案 #${a.id} の生成理由・解答・品質内容の非閲覧条件を確認できません。弱点指定型や閲覧不明を非誘導成功にしません。`);
   }
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

function resolveEvaluation(e:CapabilityEvaluation,own:InspectedEvidence[],history:InspectedEvidence[],x:EvidenceIndex){
 const warnings:string[]=[],expected=expectedKind[e.state];
 if(e.certainty!=='confirmed')warnings.push('GPTの能力対応が暫定または矛盾ありです。');
 const relevant=own.filter(row=>e.state==='unrepaired'?failed(row.link.outcome):expected&&row.link.kind===expected&&row.link.outcome==='success');
 const proof=relevant.filter(row=>row.direct&&row.attempt).map(row=>({row,warnings:expected?successStageWarnings(e,row.link,row.attempt!,row.baseline,x):[]}));
 const passing=proof.filter(p=>!p.warnings.length).map(p=>p.row).sort((a,b)=>attemptOrder(b.attempt!,a.attempt!));
 const best=passing[0];
 if(e.state!=='unconfirmed'&&!best)warnings.push(...relevant.flatMap(row=>row.warnings),...proof.flatMap(p=>p.warnings),
  e.state==='unrepaired'?'未修復とする有効な失敗・部分成功の証拠がありません。':'この段階の成功を直接確認した有効な証拠がありません。');
 if(best&&history.some(row=>row.direct&&row.certainty==='confirmed'&&row.attempt&&(expected?failed(row.link.outcome):row.link.outcome==='success')&&
   attemptOrder(row.attempt,best.attempt!)>=0&&comparableEvidence(e,best,row,x)))warnings.push(expected?'同じ操作の対象範囲に未達があります。GPTの再照合が必要です。':'同じ操作に失敗以後の成功も記録されています。古い失敗だけで現在の未修復とせず、GPTの再照合を待ちます。');
 return {state:warnings.length?'unconfirmed' as const:e.state,warnings:unique(warnings),proofIds:unique(passing.map(row=>`#${row.attempt!.id}`))};
}
function comparableEvidence(e:CapabilityEvaluation,a:InspectedEvidence,b:InspectedEvidence,x:EvidenceIndex){
 const left=a.attempt!,right=b.attempt!;
 if(left.id===right.id)return a.outcomePartIds.some(id=>b.outcomePartIds.includes(id));
 if(left.problem_id===right.problem_id)return a.outcomePartIds.some(id=>b.outcomePartIds.some(other=>samePart(left,id,right,other)));
 // Different problems: a deliberately linked, independently checked transfer
 // can contradict a prior result. Generic slots such as "major_calculation"
 // are not evidence that unrelated parts in two problems are comparable.
 const success=a.link.outcome==='success'?a:b,prior=success===a?b:a;
 return success.link.kind==='delayed_transfer'&&success.link.baseline_attempt_id===prior.attempt!.id&&
  !successStageWarnings(e,success.link,success.attempt!,success.baseline,x).length;
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
function representativeAttempts(f:CapabilityFacts,requested?:string[]){
 const usableRows=[...f.attempts].filter(usable).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id),ids=new Set<number>();
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
const eligibleAttempts=(f:CapabilityFacts,initial:boolean,requested?:string[])=>[...new Set([...(initial?f.attempts.filter(usable):representativeAttempts(f,requested)).map(a=>a.id),...requestedItems(f,requested).flatMap(({item})=>item.evidence.flatMap(s=>[s.attempt_id,...(s.baseline_attempt_id?[s.baseline_attempt_id]:[])]))])];

export async function buildCapabilityContext(f:CapabilityFacts,focusId?:string,selection:CapabilityContextScope={}){
 if(focusId&&!capabilityById.has(focusId))fail('ability_id','能力マップにありません。');
 const {initial,all,domainIndex,batch,operations,scope:baseScope,stem}=getCapabilityScope(selection);
 const retryIds=[...new Set(selection.retryIds?.length?selection.retryIds:focusId&&!initial?[focusId]:[])];
 if(retryIds.some(id=>!baseScope.abilityIds.includes(id)))fail('差分の対象能力','評価範囲に含まれないIDです。');
 const requestedOperations=retryIds.length?operations.filter(c=>retryIds.includes(c.id)):operations,requested=retryIds.length?requestedOperations.map(c=>c.id):undefined;
 const scope={...baseScope,abilityIds:requested??baseScope.abilityIds};
 const sourceHash=await hash(canonicalValue(sourceFacts(f)));
 const version=requested?await scopedRevisionVersion(stem,sourceHash,f,{initial,ids:requested,mask:maskOf(requested)}):await revisionVersion(stem,sourceHash,f.records||[]);
 const view=projectCapabilityMap(f),viewById=new Map(view.abilities.map(a=>[a.id,a]));
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
  current_evaluations:requestedItems(f,requested).map(({record,item:e})=>{
   const a=viewById.get(e.ability_id)!;
   return {evaluated_at:record.wire.evaluated_at,ability_id:e.ability_id,state:a.state,latest_proposed_state:e.state,certainty:e.certainty,state_reason:a.stateReason,
    state_source_evaluated_at:a.stateSource?.record.wire.evaluated_at,history_count:a.history.length,direct_evidence_count:a.directEvidence.length,
    judgement:e.judgement,first_error:e.first_error,evidence:e.evidence,next_check:a.proposalSource?.item.next_check??null};
  }),
  representative_answers:representatives.map(a=>({id:a.id,problem_id:a.problem_id,date:a.date,problem_title:f.problems.find(p=>p.problem_id===a.problem_id)?.title,
   material_kind:f.problems.find(p=>p.problem_id===a.problem_id)?.source_type,score:a.score_numeric??null,grade_is_official:false,summary:a.result_summary||null,observed_errors:a.error_point||null,
   reference_level:a.actual_reference_level??a.reference_level??null,hint_used:a.hint_used??null,grading_confidence:a.grading_confidence??null,purpose:a.learning_purpose||null,timing:a.assessment_timing||null,
   mode:a.mode,answer_scope:a.review_scope??a.grading_contract?.reviewScope??null,reference_closed_reproduction:a.reference_closed_reproduction??null,
   reference_flags:{one_line_hint:a.one_line_hint??null,previous_mistake:a.previous_mistake??null,official_answer:a.official_answer??null,gpt_explanation:a.gpt_explanation??null,external_reference:a.external_reference??null},
   prior_recorded_answer_ids:f.attempts.filter(old=>old.problem_id===a.problem_id&&(old.date<a.date||old.date===a.date&&old.id<a.id)).map(old=>old.id),novelty:'既習答案がなければ初見と確定せず、アプリ外の既習は未記録',
   assessed_parts:(a.graded_findings||[]).filter(p=>partIds(a).includes(p.graded_part_id)).map(p=>({id:p.graded_part_id,error_type:p.error_type,resolved:p.resolved,evidence:p.evidence})),
   transfer:a.transfer_lineage?{source_attempt_id:a.transfer_lineage.sourceAttemptId,ability_id:a.transfer_lineage.capabilityEvaluation?.abilityId||a.transfer_lineage.abilityProfile?.id,target_skill_prompted:a.target_skill_prompted??null,assessment:a.target_skill_assessment}:null,
   formal_session_id:a.parent_past_session_id??null,session_role:a.session_role??null,exam_score_eligible:a.exam_score_eligible??null,time_minutes:a.time_minutes??null,time_limit_minutes:a.time_limit_minutes??null,conclusion_reached:a.conclusion_reached??null,
   review_ids:(f.reviews||[]).filter(r=>r.generated_from_attempt_id===a.id).map(r=>r.id)})),
  available_answer_count:f.attempts.length,omitted_answer_count:f.attempts.length-representatives.length,
  ...(initial?{note_observations:[...noteGroups.values()],unlinked_note_count:(f.weakNotes||[]).filter(n=>!representatives.some(a=>a.id===n.generated_from_attempt_id&&a.problem_id===n.problem_id)).length,
   review_records:(f.reviews||[]).map(r=>({id:r.id,source_attempt_id:r.generated_from_attempt_id,problem_id:r.problem_id,due_date:r.due_date,status:r.status,purpose:r.learning_purpose??null,timing:r.assessment_timing??null,parts:r.graded_part_ids??r.targeted_parts??[],completion:r.completion_result??null,completed_at:r.completed_at??null,reference_level:r.actual_reference_level??r.reference_level??null})),
   source_period:{first:representatives[0]?.date??null,last:representatives.at(-1)?.date??null}}:{}),
  limits:'採点得点はGPTによる推定であり検定の公式得点ではない。原問題・答案画像・11/6最新版は未提供なら見たと仮定しない。古い弱点メモを現在の弱点数へ変換しない。'};
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
 const mask=match?.[7],requested=mask?idsFromMask(mask):undefined;
 if(mask&&(!requested?.length||maskOf(requested)!==mask||requested.some(id=>!scope.abilityIds.includes(id))))fail('context_version','差分の対象範囲が正しくありません。入力を保持し、最新の評価依頼を取り直してください。');
 const requestedScope=requested??scope.abilityIds,allowedAbilities=new Set(requestedScope);
 const {baseline,currentVersion}=await findRequestBaseline(wire.context_version,f,requested&&mask?{ids:requested,mask,initial:scope.initial}:undefined),baselineIds=new Set(baseline?.map(r=>r.id));
 const changedIds=new Set(records.filter(r=>!baselineIds.has(r.id)).flatMap(r=>r.items.map(i=>i.ability_id)));
 const latest=new Map(latestCapabilityItems(f).map(pair=>[pair.item.ability_id,pair]));
 const x=evidenceIndex(f),allowed=new Set(baseline?eligibleAttempts({...f,records:baseline},scope.initial,requested):[]),date=capabilityDate(wire.evaluated_at);
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
  const rows=(byAbility.get(c.id)||[]).map(h=>({...h,observations:h.item.evidence.map(s=>inspectEvidence(s,h,x))})),all=rows.flatMap(r=>r.observations);
  const history=rows.map(h=>({...h,validation:resolveEvaluation(h.item,h.observations,all,x)}));
  const current=history[0],annotation=(h:typeof current)=>h.item.certainty==='provisional'||h.item.certainty==='confirmed'&&h.item.state==='unconfirmed';
  const stateSource=history.find(h=>!annotation(h))||current;
  const tied=(at:typeof current)=>at&&!annotation(at)&&history.some(h=>!annotation(h)&&h.record.id!==at.record.id&&Date.parse(h.record.wire.evaluated_at)===Date.parse(at.record.wire.evaluated_at)&&h.item.state!==at.item.state);
  const warnings=[...(stateSource?.validation.warnings||[])];
  if(tied(stateSource))warnings.push('同じ評価日時に異なる状態があり、判断を保留しています。');
  const state:CapabilityState=stateSource&&!warnings.length?stateSource.validation.state:'unconfirmed';
  const stateReason=!current?'能力と答案を対応づけたGPT評価がまだありません。':warnings.length?warnings.join(' '):state==='unconfirmed'?'評価履歴はありますが、GPTは習得段階を未確認としています。':
   `${stateSource!==current?'最新行は新しい状態を判断していないため、以前の判定を維持。':''}根拠 ${stateSource.validation.proofIds.join(' / ')}。`;
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
  const newerLinkedAnswers=f.attempts.filter(a=>usable(a)&&a.transfer_lineage?.capabilityEvaluation?.abilityId===c.id&&!knownIds.has(a.id));
  return {...c,state,current,stateSource,proposalSource,canTrain,stateReason,history,directEvidence,problemIds,warnings:unique(warnings),recurrence,improved,newerLinkedAnswers:newerLinkedAnswers.map(a=>a.id),
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
