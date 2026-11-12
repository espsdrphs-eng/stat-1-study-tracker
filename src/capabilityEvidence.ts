import type {Attempt,Problem,Review,PastSession,WeakNote} from './types.ts';
import {CAPABILITY_CATALOG_VERSION,capabilityById,capabilityCatalog,capabilityDomains,capabilityStates,capabilityKinds,type CapabilityState,type CapabilityKind} from './capabilityCatalog.ts';
import {normalizeCompatibleJson} from './jsonSyntax.ts';
import {confidentGrading} from './skillEvidence.ts';
import {attemptPlanningEligible,findingPlanningEligible} from './legacyKPolicy.ts';
import {GENERATION_CHECKS,validateGeneratedContent} from './generatedTransfer.ts';

export const CAPABILITY_RECORD_PREFIX='capability-evaluation:v1:';
const contextPattern=/^(capability-context:(?:(iall|i([0-9a-z]+)p(\d+)):)?)(?:r2:([0-9a-z]+):)?[0-9a-f]{64}$/;
export const isInitialAllCapabilityContext=(version:string)=>contextPattern.exec(version)?.[2]==='iall';
export type CapabilityEvidence={attempt_id:number;part_ids:string[];kind:CapabilityKind;outcome:'success'|'failure'|'partial'|'uncertain';baseline_attempt_id:number|null;observation:string;transfer_conditions?:{different_structure:boolean;method_not_cued:boolean}};
export type CapabilityEvaluation={ability_id:string;state:CapabilityState;certainty:'confirmed'|'provisional'|'conflicting';judgement:string;first_error:string|null;cause_hypothesis?:string|null;evidence:CapabilityEvidence[];next_check:{kind:CapabilityKind;due_date:string|null;task:string;success_condition:string}|null};
export type CapabilityWire={schema_version:'stat1-capability-v1';catalog_version:string;context_version:string;evaluated_at:string;evaluations:CapabilityEvaluation[]};
export type CapabilityRecord={schemaVersion:'stat1-capability-record-v1';id:string;createdAt:string;wire:CapabilityWire;items:Array<CapabilityEvaluation&{effectiveState:CapabilityState;warnings:string[]}>;sourceSignatures:Record<string,string>;sourceCutoffAttemptId?:number;rawHash:string;savedAfterCount?:number};
export type CapabilityFacts={problems:Problem[];attempts:Attempt[];reviews?:Review[];pastSessions?:PastSession[];weakNotes?:WeakNote[];records?:CapabilityRecord[]};
export type CapabilityContextScope={initial?:boolean;domainId?:string;batch?:number;retryIds?:string[]};
export type CapabilityImportEntry={abilityId:string;status:'ready'|'saved'|'conflict';reason?:string};
export type CapabilityImportPlan={record:CapabilityRecord|null;entries:CapabilityImportEntry[];duplicate:boolean;confirmationToken:string;recoveryScope:CapabilityContextScope};
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

async function findRequestBaseline(version:string,f:CapabilityFacts){
 const match=contextPattern.exec(version),records=f.records||[];
 if(!match)return {currentVersion:await hash(capabilityFactsSignature(f))};
 const stem=match[1],count=match[5];
 const evidence=sourceFacts(f),sourceHash=await hash(canonicalValue(evidence));
 const currentVersion=await revisionVersion(stem,sourceHash,records);
 if(currentVersion===version)return {currentVersion,baseline:records};
 // Existing rows are immutable. Append order is explicit for new saves, and
 // historical candidates are accepted only when the original digest matches.
 const ordered=[...records].sort((a,b)=>(a.savedAfterCount??-1)-(b.savedAfterCount??-1)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 if(count!==undefined){
  const length=parseInt(count,36);
  if(Number.isSafeInteger(length)&&length>=0&&length<ordered.length){
   const baseline=ordered.slice(0,length);
   if(await revisionVersion(stem,sourceHash,baseline)===version)return {currentVersion,baseline};
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
export function parseCapabilityUpdate(raw:string):CapabilityWire{
 if(typeof raw!=='string'||raw.length>2_000_000)fail('JSON','入力は200万文字以内です。');
 const fenced=raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i),normalized=normalizeCompatibleJson(fenced?fenced[1]:raw.trim()).json;
 let parsed:unknown;try{parsed=JSON.parse(normalized)}catch{fail('JSON','構文を読み取れません。配列は []、値の省略は禁止です。原文は入力欄に残して、ChatGPTに標準JSONの再出力を依頼してください。')}
 const root=obj(parsed,'能力評価'),v=obj(root.capability_update??root,'capability_update');
 oneOf(v.schema_version,['stat1-capability-v1'],'schema_version');
 if(v.catalog_version!==CAPABILITY_CATALOG_VERSION)fail('catalog_version','能力マップの版が異なります。現在の依頼をコピーし直してください。');
 text(v.context_version,'context_version',128);
 if(typeof v.evaluated_at!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.evaluated_at)||!Number.isFinite(Date.parse(v.evaluated_at)))fail('evaluated_at','時差付きの評価日時が必要です。');
 day(v.evaluated_at.slice(0,10),'evaluated_at');
 if(Date.parse(v.evaluated_at)>Date.now()+300000)fail('evaluated_at','評価日時が未来です。端末日時とGPTの評価日時を確認してください。');
 const maxEvaluations=isInitialAllCapabilityContext(v.context_version)?capabilityCatalog.length:12;
 const seen=new Set<string>(),evaluations=array(v.evaluations,'evaluations',maxEvaluations).map((r,i)=>{
  const p=`evaluations[${i}]`,e=obj(r,p),ability_id=text(e.ability_id,`${p}.ability_id`,100);
  if(!capabilityById.has(ability_id))fail(`${p}.ability_id`,'能力マップに存在しません。推測で新規登録しません。');
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
  return {ability_id,state:oneOf(e.state,Object.keys(capabilityStates) as CapabilityState[],`${p}.state`),certainty:oneOf(e.certainty,['confirmed','provisional','conflicting'],`${p}.certainty`),judgement:text(e.judgement,`${p}.judgement`),first_error:e.first_error===null?null:text(e.first_error,`${p}.first_error`),
   ...(e.cause_hypothesis!==undefined?{cause_hypothesis:e.cause_hypothesis===null?null:text(e.cause_hypothesis,`${p}.cause_hypothesis`)}:{}),evidence,next_check};
 });
 if(!evaluations.length)fail('evaluations','確認した能力を1件以上含めてください。未確認の全能力を埋める必要はありません。');
 return {schema_version:'stat1-capability-v1',catalog_version:CAPABILITY_CATALOG_VERSION,context_version:v.context_version,evaluated_at:v.evaluated_at,evaluations};
}

/** Deterministic structural gates only. Mathematical correctness and the
 * operation-to-ability mapping remain the explicit GPT judgement above. */
function evaluationWarnings(e:CapabilityEvaluation,f:CapabilityFacts){
 const warnings:string[]=[],byId=new Map(f.attempts.map(a=>[a.id,a]));
 if(e.certainty!=='confirmed')warnings.push('GPT自身が未確定・矛盾ありと評価しています。');
 if(e.state!=='unconfirmed'&&!e.evidence.length)warnings.push('根拠答案がありません。');
 const expected:Partial<Record<CapabilityState,CapabilityKind>>={immediate_confirmed:'immediate_reproduction',delayed_transfer_confirmed:'delayed_transfer',exam_confirmed:'exam'};
 if(expected[e.state]&&!e.evidence.some(s=>s.kind===expected[e.state]&&s.outcome==='success'))warnings.push('この段階の成功を直接確認した証拠がありません。');
 if(e.state==='unrepaired'&&!e.evidence.some(s=>s.outcome==='failure'||s.outcome==='partial'))warnings.push('未修復とする失敗・部分成功の証拠がありません。');
 const successes=e.evidence.filter(s=>s.kind===expected[e.state]&&s.outcome==='success').map(s=>byId.get(s.attempt_id)).filter((a):a is Attempt=>!!a);
 const successfulDate=successes.map(a=>a.date).sort().at(-1);
 if(successfulDate&&e.evidence.some(s=>['failure','partial'].includes(s.outcome)&&(byId.get(s.attempt_id)?.date||'')>=successfulDate))warnings.push('成功と同日以後の未達証拠が同じ評価に含まれます。GPTの再照合が必要です。');
 for(const s of e.evidence){
  const a=byId.get(s.attempt_id);
  if(!a){warnings.push(`根拠答案 #${s.attempt_id} が見つかりません。`);continue;}
  if(!usable(a))warnings.push(`答案 #${a.id} は無効化・差し替え・集計対象外です。`);
  if(!confidentGrading(a))warnings.push(`答案 #${a.id} の採点確信度が不足または未記録です。`);
  const findings=(a.graded_findings||[]).filter(x=>s.part_ids.includes(x.graded_part_id));
  if(['failure','partial'].includes(s.outcome)&&(!s.part_ids.length&&(!!a.graded_findings?.length||!a.error_point?.trim()||!a.error_type||a.error_type==='none')))warnings.push(`答案 #${a.id} に指定範囲の失敗を確認できる採点根拠がありません。未確認を未修復に変えません。`);
  if(s.outcome==='success'&&(!s.part_ids.length||findings.some(x=>!x.resolved||x.error_type!=='none')))warnings.push(`答案 #${a.id} の対象内成功を採点記録から確認できません。`);
  if((s.outcome==='failure'||s.outcome==='partial')&&s.part_ids.length&&findings.every(x=>x.resolved&&x.error_type==='none'))warnings.push(`答案 #${a.id} の成功記録と未達の所見が矛盾しています。`);
  if(s.outcome==='success'&&s.kind!=='local_repair'){
   const later=f.attempts.filter(n=>usable(n)&&n.id!==a.id&&(n.date>a.date||n.date===a.date&&n.id>a.id));
   const contradicted=later.some(n=>(n.problem_id===a.problem_id||n.transfer_lineage?.capabilityEvaluation?.abilityId===e.ability_id)&&
    (n.graded_findings||[]).some(p=>findingPlanningEligible(n,p)&&!p.resolved&&p.error_type!=='none'&&s.part_ids.includes(p.graded_part_id)));
   if(contradicted)warnings.push(`答案 #${a.id} より新しい答案に同じ対象範囲の未達があります。後続答案を含めてGPTで再照合してください。`);
   if((a.actual_reference_level??a.reference_level)!==0||a.hint_used!==false)warnings.push(`答案 #${a.id} の参照なし・ヒントなしを確認できません。`);
   if((a.one_line_hint||a.previous_mistake||a.official_answer||a.gpt_explanation||a.external_reference)&&!(s.kind==='immediate_reproduction'&&a.reference_closed_reproduction===true))warnings.push(`答案 #${a.id} の参照フラグと自力成功の申告が矛盾しています。`);
   if(a.target_skill_prompted===true&&(s.kind==='delayed_transfer'||s.kind==='exam'))warnings.push(`答案 #${a.id} は対象技能が事前に示されています。`);
   if((a.transfer_lineage?.capabilityEvaluation?.abilityId===e.ability_id||a.transfer_lineage?.abilityProfile?.id===e.ability_id)&&(!a.target_skill_assessment||a.target_skill_assessment.outcome!=='success'||!a.target_skill_assessment.self_selected||!a.target_skill_assessment.major_calculation_success||!a.target_skill_assessment.no_major_error))warnings.push(`答案 #${a.id} の総合点とは別の対象能力判定が成功していません。`);
  }
  const baseline=s.baseline_attempt_id===null?undefined:byId.get(s.baseline_attempt_id);
  if(s.kind==='immediate_reproduction'){
   if(!baseline||!usable(baseline)||baseline.id===a.id||baseline.date>a.date||baseline.date===a.date&&baseline.id>a.id)warnings.push(`答案 #${a.id} の再現前の根拠が不足しています。`);
   const repair=a.learning_purpose==='error_repair'||a.grading_contract?.learningPurpose==='error_repair'||a.assessment_timing==='same_session_correction';
   if(s.outcome==='success'&&(repair&&a.reference_closed_reproduction!==true||a.assessment_timing==='delayed_retrieval'))warnings.push(`答案 #${a.id} の解説を閉じた直後の自力再現を確認できません。局所補修や遅延再現だけでは直後再現としません。`);
  }
  if(s.kind==='delayed_transfer'){
   if(!baseline||baseline.problem_id===a.problem_id||baseline.id===a.id)warnings.push(`答案 #${a.id} は元問題と異なる課題の確認になっていません。`);
   // Date-only records cannot prove 24 hours across adjacent calendar dates.
   if(!baseline||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!/^\d{4}-\d{2}-\d{2}$/.test(baseline.date)||(Date.parse(a.date)-Date.parse(baseline.date))<2*86400000)warnings.push(`答案 #${a.id} の遅延間隔を確認できません（日付のみでは2暦日以上必要、翌日の時刻は未確認）。`);
   if(f.attempts.some(old=>old.id!==a.id&&old.problem_id===a.problem_id&&(old.date<a.date||old.date===a.date&&old.id<a.id)))warnings.push(`答案 #${a.id} は既習問題の再挑戦です。`);
   if(!s.transfer_conditions?.different_structure||!s.transfer_conditions?.method_not_cued)warnings.push(`答案 #${a.id} の構造変更・非誘導についてGPTの明示的確認がありません。`);
   const problem=f.problems.find(p=>p.problem_id===a.problem_id);
   if(problem?.source_type==='generated'){
    const c=problem.generated_transfer;
    if(!c?.answer_submission||!c.validation||GENERATION_CHECKS.some(k=>c.validation.checks[k]?.pass!==true)||c.validation.draft_hash!==c.content_hash||c.generator_pass_id===c.validation.validator_pass_id)warnings.push(`答案 #${a.id} の生成問題に独立品質確認・自力答案固定の証拠が不足しています。`);
    const blind=c?.answer_submission?.noncued;
    if(a.target_skill_prompted!==false||!c?.lineage.noncuedRequestId||blind?.requestId!==c.lineage.key||blind?.externalReview!=='not_viewed'||!Array.isArray(blind.exposures)||blind.exposures.length!==0)warnings.push(`答案 #${a.id} の生成理由・解答・品質内容の非閲覧条件を確認できません。弱点指定型や閲覧不明を非誘導成功にしません。`);
   }
   if(a.assessment_timing==='same_session_correction')warnings.push(`答案 #${a.id} は同時補修です。`);
  }
  if(s.kind==='exam'){
   const p=f.problems.find(p=>p.problem_id===a.problem_id),session=(f.pastSessions||[]).find(r=>r.id===a.parent_past_session_id),selected=session?.exam_selected_problem_ids||session?.final_selected_problem_ids||session?.initial_selected_problem_ids||[];
   if(p?.source_type!=='past_exam'||a.transfer_lineage||a.exam_score_eligible!==true||a.session_role!=='selected_timed'||a.learning_purpose!=='exam_performance'||!session||session.session_kind!=='selected_three_timed'||new Set(selected).size!==3||!selected.includes(a.problem_id)||!session.answer_finished_at||!session.actual_total_minutes||session.actual_total_minutes>90)warnings.push(`答案 #${a.id} は保存済みの正式な本番形式・選択答案の条件を満たしません。`);
   if(!a.conclusion_reached||!a.time_minutes||!a.time_limit_minutes||a.time_minutes>a.time_limit_minutes)warnings.push(`答案 #${a.id} の時間内完遂を確認できません。`);
  }
 }
 return [...new Set(warnings)];
}

function latestCapabilityItems(f:CapabilityFacts){
 const selected=new Map<string,{record:CapabilityRecord;item:CapabilityRecord['items'][number]}>();
 for(const record of [...(f.records||[])].sort(recordOrder))for(const item of record.items)if(!selected.has(item.ability_id))selected.set(item.ability_id,{record,item});
 return [...selected.values()];
}
function representativeAttempts(f:CapabilityFacts,focusId?:string){
 const usableRows=[...f.attempts].filter(usable).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id),ids=new Set<number>();
 // Latest events plus older *referenced* failures/successes and measured exams.
 const current=latestCapabilityItems(f),selected=focusId?current.filter(e=>e.item.ability_id===focusId):current.slice(0,8);
 for(const {item} of selected)for(const s of item.evidence){ids.add(s.attempt_id);if(s.baseline_attempt_id)ids.add(s.baseline_attempt_id)}
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
const eligibleAttempts=(f:CapabilityFacts,initial:boolean,focusId?:string)=>[...new Set([...(initial?f.attempts.filter(usable):representativeAttempts(f,focusId)).map(a=>a.id),...latestCapabilityItems(f).flatMap(({item})=>item.evidence.flatMap(s=>[s.attempt_id,...(s.baseline_attempt_id?[s.baseline_attempt_id]:[])]))])];

export async function buildCapabilityContext(f:CapabilityFacts,focusId?:string,selection:CapabilityContextScope={}){
 if(focusId&&!capabilityById.has(focusId))fail('ability_id','能力マップにありません。');
 const {initial,all,domainIndex,batch,operations,scope,stem}=getCapabilityScope(selection);
 const retryIds=[...new Set(selection.retryIds||[])];
 if(retryIds.some(id=>!scope.abilityIds.includes(id)))fail('差分の対象能力','評価範囲に含まれないIDです。');
 const requestedOperations=retryIds.length?operations.filter(c=>retryIds.includes(c.id)):operations;
 const version=await revisionVersion(stem,await hash(canonicalValue(sourceFacts(f))),f.records||[]);
 const representatives=initial?[...f.attempts].filter(usable).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id):representativeAttempts(f,focusId);
 const noteGroups=new Map<string,{attempt_id:number;problem_id:string;note_ids:number[];observation:string;correction_rule:string}>();
 if(initial)for(const n of f.weakNotes||[]){if(!representatives.some(a=>a.id===n.generated_from_attempt_id&&a.problem_id===n.problem_id))continue;
  const key=canonicalValue([n.generated_from_attempt_id,n.problem_id,n.mistake,n.correction_rule]),old=noteGroups.get(key);
  if(old)old.note_ids.push(n.id);else noteGroups.set(key,{attempt_id:n.generated_from_attempt_id!,problem_id:n.problem_id,note_ids:[n.id],observation:n.mistake,correction_rule:n.correction_rule});
 }
 const schema={capability_update:{schema_version:'stat1-capability-v1',catalog_version:CAPABILITY_CATALOG_VERSION,context_version:version,evaluated_at:'実際の評価日時（時差付きISO）',evaluations:[{ability_id:initial||retryIds.length?requestedOperations[0].id:focusId||'cross.request-to-math',state:'unconfirmed',certainty:'provisional',judgement:'観察事実と未確認を1〜2文で区別',first_error:null,cause_hypothesis:null,evidence:[{attempt_id:representatives[0]?.id||1,part_ids:representatives[0]?partIds(representatives[0]):[],kind:'diagnostic',outcome:'uncertain',baseline_attempt_id:null,observation:'答案で確認できた式・条件・記号。未確認は補完しない'}],next_check:{kind:'immediate_reproduction',due_date:null,task:'次に確認する操作を1件',success_condition:'参照なしで再現できたと判定する条件'}}]}};
 const facts={catalog_version:CAPABILITY_CATALOG_VERSION,context_version:version,focus_ability_id:focusId||null,review_scope:scope,
  operation_catalog:requestedOperations.map(c=>({id:c.id,domain:capabilityDomains.find(d=>d.id===c.domainId)!.name,name:c.name,criterion:c.criterion})),
  current_evaluations:latestCapabilityItems(f).filter(({item})=>!retryIds.length||retryIds.includes(item.ability_id)).map(({record,item:e})=>({evaluated_at:record.wire.evaluated_at,ability_id:e.ability_id,state:e.effectiveState,certainty:e.certainty,judgement:e.judgement,first_error:e.first_error,evidence:e.evidence,next_check:e.next_check})),
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
  const selected=new Set(representativeAttempts(f,focusId).map(a=>a.id));
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
  `まず通常の文章で対話・解説してよい。保存時だけ下記スキーマの標準JSONを1個返す。Markdownフェンス・JSON外の文章は付けず、配列は[]、不明値は明示的null、空の値は禁止。評価は今回確認した最大${retryIds.length?Math.min(retryIds.length,all?operations.length:12):all?operations.length:12}能力、各説明1〜2文、次回行動は能力ごとに1件まで。evaluations配列はあなたが提案する重要度の順で、今回の重点を先頭に置く。${initial?'添付履歴のanswers（採点項目はassessed_parts）または保存済み能力評価':'代表答案または保存済み能力評価'}に明示されたIDだけを参照し、必要な古い原資料は利用者へ依頼する。得点の再出力・書換えは不要。\n`+JSON.stringify(schema)+'\n保存済み証拠：\n'+JSON.stringify(facts);
 const eligibleAttemptIds=eligibleAttempts(f,initial,focusId);
 return {version,catalogVersion:CAPABILITY_CATALOG_VERSION,prompt,eligibleAttemptIds,scope,historyAttachment,sourcePeriod:{first:[...f.attempts].map(a=>a.date).sort()[0]??null,last:[...f.attempts].map(a=>a.date).sort().at(-1)??null},answerCount:f.attempts.length};
}
async function makeCapabilityRecord(raw:string,wire:CapabilityWire,f:CapabilityFacts,allowed:Set<number>):Promise<CapabilityRecord>{
 const byId=new Map(f.attempts.map(a=>[a.id,a])),sourceSignatures:Record<string,string>={};
 for(const e of wire.evaluations)for(const s of e.evidence){
  const a=byId.get(s.attempt_id);if(!a||!allowed.has(s.attempt_id))fail(`答案 #${s.attempt_id}`,'今回渡した根拠答案に存在しません。');
  if(!f.problems.some(p=>p.problem_id===a.problem_id))fail(`答案 #${a.id}`,'関連問題がありません。');
  if(s.part_ids.some(p=>!partIds(a).includes(p)))fail(`答案 #${a.id}`,'対象外または存在しない採点項目が指定されています。');
  if(a.date>capabilityDate(wire.evaluated_at))fail(`答案 #${a.id}`,'評価日時より後の答案です。');
  sourceSignatures[a.id]=sourceSignature(a);
  if(s.baseline_attempt_id!==null){const b=byId.get(s.baseline_attempt_id);if(!b||!allowed.has(b.id)||b.date>capabilityDate(wire.evaluated_at))fail('baseline_attempt_id','今回の評価対象に存在しないか、評価日時より後の答案です。');sourceSignatures[b.id]=sourceSignature(b)}
 }
 const invalidGenerated=new Set<string>();
 for(const problemId of new Set(wire.evaluations.flatMap(e=>e.evidence.map(s=>byId.get(s.attempt_id)!.problem_id)))){
  const p=f.problems.find(p=>p.problem_id===problemId);
  if(p?.source_type==='generated'){try{await validateGeneratedContent(p)}catch{invalidGenerated.add(problemId)}}
 }
 const items=wire.evaluations.map(e=>{
  const warnings=evaluationWarnings(e,f),prior=(f.records||[]).flatMap(r=>r.items.filter(i=>i.ability_id===e.ability_id).map(item=>({record:r,item}))).sort((a,b)=>recordOrder(a.record,b.record))[0];
  if(e.evidence.some(s=>invalidGenerated.has(byId.get(s.attempt_id)!.problem_id)))warnings.push('生成問題の内容hash・独立品質確認を照合できません。問題不備は能力失敗として確定しません。');
  if(e.state==='unrepaired'&&prior&&['immediate_confirmed','delayed_transfer_confirmed','exam_confirmed'].includes(prior.item.effectiveState)){
   const previousDate=prior.item.evidence.filter(s=>s.outcome==='success').map(s=>byId.get(s.attempt_id)?.date||'').sort().at(-1)||'';
   if(!e.evidence.some(s=>['failure','partial'].includes(s.outcome)&&(byId.get(s.attempt_id)?.date||'')>=previousDate))warnings.push('以前の成功確認より古い失敗だけでは、現在の未修復へ戻しません。新しい答案・再評価の根拠を確認してください。');
  }
  return {...e,effectiveState:warnings.length?'unconfirmed' as const:e.state,warnings};
 });
 return {schemaVersion:'stat1-capability-record-v1',id:await hash(canonicalValue(wire)),createdAt:new Date().toISOString(),wire,items,sourceSignatures,sourceCutoffAttemptId:Math.max(0,...f.attempts.map(a=>a.id)),rawHash:await hash(raw),savedAfterCount:f.records?.length||0};
}

export async function planCapabilityImport(raw:string,f:CapabilityFacts):Promise<CapabilityImportPlan>{
 const wire=parseCapabilityUpdate(raw),match=contextPattern.exec(wire.context_version),records=f.records||[];
 const selection:CapabilityContextScope=match?.[2]==='iall'?{initial:true,domainId:'all'}:match?.[3]?{initial:true,domainId:capabilityDomains[parseInt(match[3],36)]?.id,batch:Number(match[4])}:{};
 const {scope}=getCapabilityScope(selection);
 if(wire.evaluations.some(e=>!scope.abilityIds.includes(e.ability_id)))fail('対象能力','今回の分野・区分に含まれません。分野別の依頼を確認してください。');
 const {baseline,currentVersion}=await findRequestBaseline(wire.context_version,f),baselineIds=new Set(baseline?.map(r=>r.id));
 const changedIds=new Set(records.filter(r=>!baselineIds.has(r.id)).flatMap(r=>r.items.map(i=>i.ability_id)));
 const latest=new Map(latestCapabilityItems(f).map(pair=>[pair.item.ability_id,pair]));
 const byId=new Map(f.attempts.map(a=>[a.id,a]));
 const ready:CapabilityEvaluation[]=[];
 const entries=wire.evaluations.map((e):CapabilityImportEntry=>{
  const abilityId=e.ability_id,prior=latest.get(abilityId),at=Date.parse(wire.evaluated_at),same=(r:CapabilityRecord)=>r.wire.evaluations.some(item=>item.ability_id===abilityId&&canonicalValue(item)===canonicalValue(e));
  if(records.some(r=>Date.parse(r.wire.evaluated_at)===at&&same(r)))return {abilityId,status:'saved'};
  if(!baseline)return {abilityId,status:'conflict',reason:'依頼時点の状態を照合できません。答案・Reviewなどの更新、または元の履歴が確認できないため保存しません。'};
  if(prior&&same(prior.record)&&e.evidence.every(s=>[s.attempt_id,s.baseline_attempt_id].every(id=>id===null||(byId.has(id)&&sourceSignature(byId.get(id)!)===prior.record.sourceSignatures[id]))))return {abilityId,status:'saved'};
  if(changedIds.has(abilityId))return {abilityId,status:'conflict',reason:'依頼の作成後にこの能力の評価が保存されました。保存済みの評価を維持します。'};
  if(prior&&Date.parse(prior.record.wire.evaluated_at)>=at)return {abilityId,status:'conflict',reason:'この能力には同じ日時か、より新しい評価が保存されています。現在の評価を維持します。'};
  if(prior?.item.evidence.length&&!e.evidence.length)return {abilityId,status:'conflict',reason:'既存評価を見直す根拠答案が指定されていません。現在の評価を維持します。'};
  ready.push(e);return {abilityId,status:'ready'};
 });
 const candidate=ready.length?await makeCapabilityRecord(raw,{...wire,evaluations:ready},f,new Set(eligibleAttempts({...f,records:baseline},scope.initial))):null;
 const duplicate=!candidate&&entries.some(e=>e.status==='saved');
 const record=candidate||(duplicate?records.find(r=>canonicalValue(r.wire)===canonicalValue(wire))||null:null);
 return {record,entries,duplicate,confirmationToken:await hash(canonicalValue([raw,currentVersion,entries])),recoveryScope:{...selection,retryIds:entries.filter(e=>e.status==='conflict').map(e=>e.abilityId)}};
}

/** Strict single-record helper for callers that require the whole input. */
export async function prepareCapabilityUpdate(raw:string,f:CapabilityFacts):Promise<CapabilityRecord>{
 const plan=await planCapabilityImport(raw,f),conflict=plan.entries.find(e=>e.status==='conflict');
 if(conflict)fail('context_version',conflict.reason!);
 return plan.record||fail('evaluations','新しく保存する能力評価がありません。');
}
export const capabilityUpdateId=async(raw:string)=>hash(canonicalValue(parseCapabilityUpdate(raw)));
export function readCapabilityRecords(meta:Array<{key:string;value:string}>){
 const records:CapabilityRecord[]=[],issues:string[]=[];
 for(const row of meta.filter(m=>m.key.startsWith(CAPABILITY_RECORD_PREFIX))){try{const r=JSON.parse(row.value) as CapabilityRecord;
  if(r.schemaVersion!=='stat1-capability-record-v1'||!r.id||row.key!==CAPABILITY_RECORD_PREFIX+r.id||!Array.isArray(r.items)||!r.sourceSignatures||!r.wire)throw Error('format');
  const wire=parseCapabilityUpdate(canonicalValue(r.wire));
  if(r.items.length!==wire.evaluations.length||r.items.some((e,i)=>e.ability_id!==wire.evaluations[i].ability_id||!Object.hasOwn(capabilityStates,e.effectiveState)||!['unconfirmed',e.state].includes(e.effectiveState)||!Array.isArray(e.warnings)||e.warnings.some(w=>typeof w!=='string')||e.warnings.length>0&&e.effectiveState!=='unconfirmed'||canonicalValue({...e,effectiveState:undefined,warnings:undefined})!==canonicalValue(wire.evaluations[i])))throw Error('stored evaluations differ from their original wire');
  records.push(r);
 }catch{issues.push(`能力評価 ${row.key} を読み取れません。原記録は保持し、集計対象外としました。`)}}
 return {records,issues};
}
export function projectCapabilityMap(f:CapabilityFacts,records:CapabilityRecord[]=f.records||[]){
 const byId=new Map(f.attempts.map(a=>[a.id,a]));
 const abilities=capabilityCatalog.map(c=>{
  const history=records.flatMap(r=>r.items.filter(e=>e.ability_id===c.id).map(item=>({record:r,item}))).sort((a,b)=>recordOrder(a.record,b.record));
  const current=history[0],warnings=current?[...current.item.warnings,...evaluationWarnings(current.item,f)]:[];
  const sourceIds=new Set(current?.item.evidence.flatMap(e=>[e.attempt_id,...(e.baseline_attempt_id?[e.baseline_attempt_id]:[])])||[]);
  if(current&&[...sourceIds].some(id=>!byId.has(id)||sourceSignature(byId.get(id)!)!==current.record.sourceSignatures[id]))warnings.push('根拠答案の変更・削除があります。GPTによる照合が必要です。');
  if(current&&history.some(h=>h.record.id!==current.record.id&&Date.parse(h.record.wire.evaluated_at)===Date.parse(current.record.wire.evaluated_at)&&h.item.state!==current.item.state))warnings.push('同じ評価日時に異なる状態があり、判断を保留しています。');
  const state:CapabilityState=current&&!warnings.length?current.item.effectiveState:'unconfirmed';
  const evidence=current?.item.evidence||[],problemIds=[...new Set(evidence.flatMap(s=>byId.get(s.attempt_id)?.problem_id?[byId.get(s.attempt_id)!.problem_id]:[]))];
  const previous=history[1],recurrence=state==='unrepaired'&&history.slice(1).some(h=>['immediate_confirmed','delayed_transfer_confirmed','exam_confirmed'].includes(h.item.effectiveState));
  const improved=!!previous&&!warnings.length&&current!.item.effectiveState!==previous.item.effectiveState&&['immediate_confirmed','delayed_transfer_confirmed','exam_confirmed'].includes(state);
  const knownIds=new Set(history.flatMap(h=>h.item.evidence.map(s=>s.attempt_id)));
  const newerLinkedAnswers=f.attempts.filter(a=>usable(a)&&a.transfer_lineage?.capabilityEvaluation?.abilityId===c.id&&!knownIds.has(a.id));
  return {...c,state,current,history,problemIds,warnings:[...new Set(warnings)],recurrence,improved,newerLinkedAnswers:newerLinkedAnswers.map(a=>a.id),
   stages:{immediate_reproduction:state==='immediate_confirmed',delayed_transfer:state==='delayed_transfer_confirmed',exam:state==='exam_confirmed'}};
 });
 const counts=Object.fromEntries(Object.keys(capabilityStates).map(s=>[s,abilities.filter(a=>a.state===s).length])) as Record<CapabilityState,number>;
 const domains=capabilityDomains.map(d=>{const rows=abilities.filter(c=>c.domainId===d.id);return {...d,abilities:rows,total:rows.length,counts:Object.fromEntries(Object.keys(capabilityStates).map(s=>[s,rows.filter(a=>a.state===s).length])) as Record<CapabilityState,number>}});
 const checks=abilities.flatMap(a=>a.current?.item.next_check?[{ability:a,check:a.current.item.next_check,evaluatedAt:a.current.record.wire.evaluated_at,proposed:true as const}]:[]).sort((a,b)=>(a.check.due_date||'9999').localeCompare(b.check.due_date||'9999'));
 const priorities=latestCapabilityItems({...f,records}).flatMap(({item})=>{const ability=abilities.find(a=>a.id===item.ability_id);return ability?.state==='unrepaired'?[ability]:[]});
 return {abilities,counts,domains,total:abilities.length,evaluated:abilities.filter(a=>a.current).length,checks,priorities,recurrences:abilities.filter(a=>a.recurrence),improved:abilities.filter(a=>a.improved)};
}
