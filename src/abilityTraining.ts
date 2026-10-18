import type {AbilityProfile,Attempt,Bootstrap,CoachDiagnosis} from './types.ts';
import type {TransferTrainingLineage} from './generatedTransfer.ts';
import {confidentGrading,independentReferenceFree} from './skillEvidence.ts';
import {findingEvidenceStatus} from './skillEvidence.ts';
import {attemptPlanningEligible,findingPlanningEligible,planningErrorsForSource} from './legacyKPolicy.ts';
import {resolvePersistedAttemptLifecycle} from './reviewTransition.ts';

export const abilityStateLabels={needs_practice:'要補強',improving:'改善中',confirmed:'訓練内で確認済み',uncertain:'証拠不足'};
type Input=Pick<Bootstrap,'coach'|'attempts'|'problems'>&Partial<Pick<Bootstrap,'today'|'masteryByProblem'>>;
export type AbilityProfileView=AbilityProfile&{origin:'structured_diagnosis'|'legacy_diagnosis'|'grading_evidence'|'training_history';reviewedAt:string;revision:string;trainable:boolean;reason:string};
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
/** A training hypothesis, not a canonical skill or mastery claim. No GPT profile
 * is required. One actual, still-unresolved graded operation is kept distinct
 * from an aggregate timing diagnosis and from other unproven skill matches. */
export function deriveTrainingProfiles(data:Input):AbilityProfileView[]{
 const proposed=[...data.attempts].filter(a=>usable(a)&&a.transfer_lineage?.abilityProfile&&a.target_skill_assessment?.next_focus&&confidentGrading(a)).sort((a,b)=>b.id-a.id)[0];
 if(proposed&&(!data.coach.current||proposed.id>data.coach.current.evidenceCutoffAttemptId)){
  const focus=proposed.target_skill_assessment!.next_focus!;
  if(focus.part_ids?.length&&focus.name?.trim()&&focus.goal?.trim()&&focus.evidence?.trim()&&focus.part_ids.every(id=>proposed.graded_findings?.some(f=>f.graded_part_id===id&&!f.resolved&&f.error_type!=='none'&&findingPlanningEligible(proposed,f)))){
   const id=`focus-${digest([proposed.id,focus.name,focus.part_ids])}`;
   return [{id,name:focus.name,state:'uncertain',goal:focus.goal,next:'新たに採点で指摘された操作を、異なる設定で検証する（能力同定は暫定）',sources:[{attemptId:proposed.id,partIds:[...focus.part_ids]}],
    origin:'grading_evidence',reviewedAt:proposed.date,revision:digest([id,focus]),trainable:true,reason:'GPT採点の新しい能力仮説です。元の能力の結果とは分け、元の成功・失敗は履歴に保持します。'}];
  }
 }
 const explicit=deriveAbilityProfiles(data).filter(p=>p.trainable);
 if(explicit.length)return explicit;
 const prior=[...data.problems].sort((a,b)=>(b.generated_transfer?.created_at||'').localeCompare(a.generated_transfer?.created_at||'')||a.problem_id.localeCompare(b.problem_id))
  .flatMap(q=>q.generated_transfer?.lineage.abilityProfile?[q.generated_transfer.lineage.abilityProfile]:[]);
 const ids=new Set<string>(),history=prior.filter(p=>{if(ids.has(p.id))return false;ids.add(p.id);return true;})
  .filter(p=>p.sources.every(s=>data.attempts.some(a=>usable(a)&&a.id===s.attemptId&&a.problem_id===s.problemId&&s.partIds.every(id=>sourceParts(a).includes(id))))).slice(0,3);
 if(history.length)return history.map(p=>({...p,state:'uncertain',origin:'training_history',trainable:true,reason:'保存済み訓練の能力仮説を継続します。総合プロフィール更新は任意です。'}));
 const attempts=data.attempts.filter(a=>usable(a)&&attemptPlanningEligible(a)&&!['scan','scan5','scan_only','exam_90min'].includes(a.mode)&&!a.transfer_lineage&&!data.problems.find(p=>p.problem_id===a.problem_id)?.generated_transfer)
  .sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
 const tasks=[...(data.today?.tasks||[])].filter(t=>!t.checked&&t.ranking?.eligible&&!t.stable_session_key&&!t.transfer_training_key).sort((a,b)=>(a.ranking?.rank||Infinity)-(b.ranking?.rank||Infinity));
 const order=[...new Set([...tasks.map(t=>t.problem_id),...attempts.map(a=>a.problem_id)])];
 for(const problemId of order){
  const mastery=data.masteryByProblem?.[problemId];
  if(!data.problems.some(p=>p.problem_id===problemId)||mastery?.normalReviewComplete&&mastery.levels.some(l=>l.status==='retained'&&l.retainedTargetCount>0))continue;
  const rows=attempts.filter(a=>a.problem_id===problemId);if(!rows.length||resolvePersistedAttemptLifecycle(rows[0]).graduated)continue;
  const legacy=rows[0];
  if(!legacy.graded_findings?.length&&legacy.error_point?.trim()&&planningErrorsForSource(legacy).length){
   const id=`observed-${digest([legacy.problem_id,'legacy-note',legacy.id])}`;
   return [{id,name:'過去の採点本文から操作を検証',state:'uncertain',goal:'採点本文に残った操作を、別の設定で自力で選び結論まで完成する',next:'未解消の採点本文から検証可能な仮説を1つ選ぶ。小問・技能の対応は未確定',
    sources:[{attemptId:legacy.id,partIds:[]}],origin:'grading_evidence',reviewedAt:legacy.date,revision:digest([id,legacy.error_point]),trainable:true,
    reason:'旧採点の診断本文を使う暫定訓練です。存在しない小問・採点項目は補完しません。'}];
  }
  const seen=new Set<string>();
  for(const a of rows){
   for(const f of a.graded_findings||[]){
    if(!findingPlanningEligible(a,f)||seen.has(f.graded_part_id))continue;seen.add(f.graded_part_id);
    if(findingEvidenceStatus(a,f).outcome!=='failure'||!f.evidence?.trim())continue;
    const id=`observed-${digest([a.problem_id,f.graded_part_id,a.id])}`;
    return [{id,name:'採点で残った操作を別の設定で確認',state:'uncertain',goal:'根拠答案で未解消だった操作を、新しい問題で自力で選び結論まで完成する',
     next:'採点根拠から検証可能な能力仮説を1つ選び、異なる設定で確認する',sources:[{attemptId:a.id,partIds:[f.graded_part_id]}],
     origin:'grading_evidence',reviewedAt:a.date,revision:digest([id,f.evidence]),trainable:true,
     reason:'採点根拠による暫定の訓練対象です。横断的な能力同定・習得は未確定です。'}];
   }
  }
 }
 return [{id:'unassessed',name:'検証する能力は未判定',state:'uncertain',goal:'採点根拠から次に確認する操作を特定する',next:'個別問題の採点結果を取り込んでください',sources:[],origin:'grading_evidence',reviewedAt:'',revision:'unassessed',trainable:false,
  reason:'未解消の採点箇所を確認できません。プロフィール作成は必須ではありませんが、問題生成には実際の採点根拠が必要です。個別問題の採点を取り込むか、根拠付きプロフィールを任意で更新してください。'}];
}
export function abilityTrainingPlan(data:Pick<Bootstrap,'attempts'|'problems'>,p:AbilityProfileView):{state:AbilityProfile['state'];next:string;latest:ReturnType<typeof abilityTrainingHistory>[number]|null}{
 const latest=abilityTrainingHistory(data,p.id)[0];
 if(!latest)return {state:p.state,next:p.next,latest:null};
 const next={success:'改善が見られました。別の設定・条件で自力成功を再確認する',failure:'弱点が再発しました。異なる設定で同じ能力を再検証する',
  uncertain:'判定根拠が不足しています。対象操作とその選択理由を判定できる問題で確認する',assisted:'援助ありの訓練です。異なる設定で参照なしの自力選択を確認する'}[latest.outcome];
 // A later GPT diagnosis may confirm multiple independent successes; a single
 // generated exercise or an assisted result can never certify mastery.
 const newerDiagnosis=p.origin==='structured_diagnosis'&&p.sources.some(s=>s.attemptId>=latest.attemptId);
 return {state:newerDiagnosis?p.state:latest.outcome==='success'?'improving':latest.outcome==='failure'?'needs_practice':'uncertain',next,latest};
}
export function buildAbilityLineage(p:AbilityProfileView,data:Input,round:number):TransferTrainingLineage{
 if(!p.trainable)throw new Error(p.reason);
 const sources=p.sources.map(s=>{const a=data.attempts.find(a=>a.id===s.attemptId)!,problemText=data.problems.find(q=>q.problem_id===a.problem_id)?.generated_transfer?.problem_text;return {...s,problemId:a.problem_id,date:a.date,...(problemText?{problemText}:{}),
  evidence:s.partIds.length?(a.graded_findings||[]).filter(f=>s.partIds.includes(f.graded_part_id)).map(f=>({partId:f.graded_part_id,resolved:f.resolved,errorType:f.error_type,text:f.evidence})):a.error_point};});
 const first=sources[0],plan=abilityTrainingPlan(data,p);
 return {key:`training:ability:${p.id}:${p.revision}:${round}`,rootWeaknessId:`ability:${p.id}`,rootSkillId:`ability:${p.id}`,
  sourceProblemId:first.problemId,sourceAttemptId:first.attemptId,sourceFindingIds:first.partIds,repairAttemptId:0,retrievalAttemptId:0,
  matchConfidence:'profile',observedFailure:p.name,successCriteria:p.goal,examImpact:'medium',
  abilityProfile:{id:p.id,name:p.name,goal:p.goal,next:plan.next,reviewedAt:p.reviewedAt,revision:p.revision,sources,
   previousResults:abilityTrainingHistory(data,p.id).slice(0,3).map(r=>{const q=data.problems.find(q=>q.problem_id===r.problemId)?.generated_transfer;
    const a=data.attempts.find(a=>a.id===r.attemptId);return {...r,...(q?{problemText:q.problem_text,surfaceFeatures:q.surface_features}:{}),findings:a?.graded_findings,nextAction:a?.next_action}})}};
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
