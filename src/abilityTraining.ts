import type {AbilityProfile,Attempt,Bootstrap,CoachDiagnosis} from './types.ts';
import type {TransferTrainingLineage} from './generatedTransfer.ts';
import {confidentGrading,independentReferenceFree} from './skillEvidence.ts';

export const abilityStateLabels={needs_practice:'要補強',improving:'改善中',confirmed:'訓練内で確認済み',uncertain:'証拠不足'};
type Input=Pick<Bootstrap,'coach'|'attempts'|'problems'>;
export type AbilityProfileView=AbilityProfile&{origin:'structured_diagnosis'|'legacy_diagnosis';reviewedAt:string;revision:string;trainable:boolean;reason:string};
const usable=(a:Attempt)=>!a.exclude_from_metrics&&!a.duplicate_of_attempt_id&&a.exclude_from_planning!==true;
const digest=(x:unknown)=>{let h=2166136261;for(const c of JSON.stringify(x))h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0).toString(36)};
export const legacyAbilityId=(title:string)=>`legacy-${digest(title)}`;
const sourceParts=(a:Attempt)=>(a.graded_findings||[]).map(f=>f.graded_part_id);

/** Legacy diagnoses remain usable only through their explicit evidence links.
 * Never infer an ability from a problem title, weakNote flag, or matching prose. */
export function deriveAbilityProfiles(data:Input):AbilityProfileView[]{
 const d=data.coach.current;if(!d)return [];
 const attempts=data.attempts.filter(usable),byId=new Map(attempts.map(a=>[a.id,a]));
 let profiles=d.abilityProfiles,origin:AbilityProfileView['origin']='structured_diagnosis';
 if(!profiles?.length){
  origin='legacy_diagnosis';
  const ids=new Set((d.primaryBottleneck.evidenceIds||[]).flatMap(id=>/^attempt:\d+$/.test(id)?[Number(id.split(':')[1])]:[]));
  for(const id of d.primaryBottleneck.evidenceProblemIds){const a=attempts.filter(a=>a.problem_id===id&&a.id<=d.evidenceCutoffAttemptId).sort((a,b)=>b.id-a.id)[0];if(a)ids.add(a.id);}
  profiles=[{id:legacyAbilityId(d.primaryBottleneck.title),name:d.primaryBottleneck.title,state:'uncertain',
   goal:d.primaryBottleneck.title,next:'異なる設定の問題で、この能力を自力で使えるか確認する',
   sources:[...ids].map(id=>({attemptId:id,partIds:byId.has(id)?sourceParts(byId.get(id)!):[]}))}];
 }
 return profiles.map(p=>{
  const issues:string[]=[];
  if(!p.sources.length)issues.push(origin==='legacy_diagnosis'?'能力別プロフィール（答案・採点対象の根拠）が未作成です。総合評価の文章や時間内完走率だけでは訓練対象を決めません。':'能力プロフィールの根拠答案が未登録です。');
  for(const s of p.sources){const a=byId.get(s.attemptId);
   if(!a){issues.push(`根拠答案 #${s.attemptId} が見つからないか、無効化・集計対象外です。`);continue;}
   if(a.id>d.evidenceCutoffAttemptId)issues.push(`根拠答案 #${s.attemptId} は評価対象のcutoffより後の記録です。`);
   if(!data.problems.some(q=>q.problem_id===a.problem_id))issues.push(`根拠答案 #${s.attemptId} の問題 ${a.problem_id} が問題台帳にありません。`);
   const missing=s.partIds.filter(id=>!sourceParts(a).includes(id));if(missing.length)issues.push(`根拠答案 #${s.attemptId} に採点項目 ${missing.join(' / ')} がありません。`);
   if(!s.partIds.length&&!a.error_point?.trim())issues.push(`根拠答案 #${s.attemptId} に採点対象・診断本文がありません。`);
  }
  return {...p,origin,reviewedAt:d.reviewedAt,revision:digest([d.reviewedAt,d.evidenceCutoffAttemptId,p]),trainable:issues.length===0,
   reason:issues.length?`${issues.join(' ')}「訓練の準備をする」から根拠付きのGPTプロフィールを依頼してください。`:''};
 });
}
export function abilityTrainingOutcome(a:Attempt):'success'|'failure'|'uncertain'|'assisted'{
 const t=a.target_skill_assessment;
 if(!a.transfer_lineage?.abilityProfile||!usable(a)||!t?.evidence?.trim()||!confidentGrading(a)||t.outcome==='uncertain')return 'uncertain';
 if(a.hint_used||Number(a.actual_reference_level??a.reference_level??0)>0)return 'assisted';
 if(!independentReferenceFree(a))return 'uncertain';
 return t.self_selected&&t.major_calculation_success&&t.no_major_error?'success':'failure';
}
export function abilityTrainingHistory(data:Pick<Bootstrap,'attempts'|'problems'>,id:string){
 const seen=new Set<string>();
 return data.attempts.filter(a=>usable(a)&&a.transfer_lineage?.abilityProfile?.id===id)
  .sort((a,b)=>b.id-a.id).filter(a=>{const key=a.transfer_lineage!.key;if(seen.has(key))return false;seen.add(key);return true})
  .map(a=>({attemptId:a.id,problemId:a.problem_id,date:a.date,outcome:abilityTrainingOutcome(a),evidence:a.target_skill_assessment?.evidence||'採点根拠未登録'}));
}
export function buildAbilityLineage(p:AbilityProfileView,data:Input,round:number):TransferTrainingLineage{
 if(!p.trainable)throw new Error(p.reason);
 const sources=p.sources.map(s=>{const a=data.attempts.find(a=>a.id===s.attemptId)!;return {...s,problemId:a.problem_id,date:a.date,
  evidence:s.partIds.length?(a.graded_findings||[]).filter(f=>s.partIds.includes(f.graded_part_id)).map(f=>({partId:f.graded_part_id,resolved:f.resolved,errorType:f.error_type,text:f.evidence})):a.error_point};});
 const first=sources[0];
 return {key:`training:ability:${p.id}:${p.revision}:${round}`,rootWeaknessId:`ability:${p.id}`,rootSkillId:`ability:${p.id}`,
  sourceProblemId:first.problemId,sourceAttemptId:first.attemptId,sourceFindingIds:first.partIds,repairAttemptId:0,retrievalAttemptId:0,
  matchConfidence:'profile',observedFailure:p.name,successCriteria:p.goal,examImpact:'medium',
  abilityProfile:{id:p.id,name:p.name,goal:p.goal,next:p.next,reviewedAt:p.reviewedAt,revision:p.revision,sources,
   previousResults:abilityTrainingHistory(data,p.id).slice(0,3).map(r=>{const q=data.problems.find(q=>q.problem_id===r.problemId)?.generated_transfer;
    return {...r,...(q?{problemText:q.problem_text,surfaceFeatures:q.surface_features}:{})}})}};
}
export function validAbilityLineage(l:TransferTrainingLineage|undefined){
 const p=l?.abilityProfile;
 return !!l&&!!p&&l.matchConfidence==='profile'&&l.key.startsWith(`training:ability:${p.id}:`)&&l.rootSkillId===`ability:${p.id}`&&
  !!p.name?.trim()&&!!p.goal?.trim()&&!!p.revision&&!!p.reviewedAt&&Array.isArray(p.sources)&&p.sources.length>0&&
  p.sources.every(s=>Number.isSafeInteger(s.attemptId)&&s.attemptId>0&&!!s.problemId&&Array.isArray(s.partIds))&&
  p.sources[0].attemptId===l.sourceAttemptId&&p.sources[0].problemId===l.sourceProblemId&&JSON.stringify(p.sources[0].partIds)===JSON.stringify(l.sourceFindingIds);
}
export type AbilityOutcomeProof={attemptId:number;problemId:string;abilityId:string;outcome:ReturnType<typeof abilityTrainingOutcome>};
export function validateAbilitySources(d:CoachDiagnosis,sources:Array<{attemptId:number;partIds:string[]}>,proofs:AbilityOutcomeProof[]=[]){
 for(const p of d.abilityProfiles||[]){for(const s of p.sources){const allowed=sources.filter(a=>a.attemptId===s.attemptId);
  if(!allowed.length||s.partIds.some(id=>!allowed.some(a=>a.partIds.includes(id))))throw new Error('能力プロフィールの根拠答案・採点項目が今回の評価対象にありません。現在のプロンプトで確認してください。');}
  if(p.state==='confirmed'){
   const relevant=proofs.filter(e=>e.abilityId===p.id),failedAfter=Math.max(0,...relevant.filter(e=>e.outcome==='failure').map(e=>e.attemptId));
   const successes=relevant.filter(e=>e.outcome==='success'&&e.attemptId>failedAfter&&p.sources.some(s=>s.attemptId===e.attemptId));
   if(new Set(successes.map(e=>e.problemId)).size<2)throw new Error('確認済みにするには、後続の失敗がない異なる訓練問題の自力成功の証拠が複数必要です。未確認・改善中として再評価してください。');
  }
 }
}
