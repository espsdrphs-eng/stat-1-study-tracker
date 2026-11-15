import type {Bootstrap} from './types.ts';
import {capabilityCatalog} from './capabilityCatalog.ts';
import {capabilityTrainingProfile,buildAbilityLineage} from './abilityTraining.ts';
import {capabilityGenerationContextVersion,capabilityDate,projectCapabilityMap} from './capabilityEvidence.ts';
import {deriveCapabilityStudyPlan} from './capabilityStudyPlan.ts';
import {generationDraftContract,transferJson,type TransferGenerationRecord,type GenerationContext} from './generatedTransfer.ts';

/** An unselected request is kept in the existing generation meta namespace.
 * It is not a problem, answer, skill diagnosis or completed transfer event. */
export type NoncuedExposure={kind:'request_details'|'source'|'quality_details'|'payload';at:string};
export type NoncuedProtection={requestId:string;candidateAbilityIds:string[];exposures:NoncuedExposure[]};
export type NoncuedRequest={schemaVersion:'stat1-noncued-request-v1';key:string;createdAt:string;status:'requested';problemId:string;contextVersion:string;
 candidates:Array<{abilityId:string;revision:string}>;noncued:NoncuedProtection};
export const isNoncuedRequest=(r:unknown):r is NoncuedRequest=>!!r&&typeof r==='object'&&(r as NoncuedRequest).schemaVersion==='stat1-noncued-request-v1';
export function noncuedProfiles(data:Bootstrap,{pendingOnly=true,today=data.dashboard?.today??capabilityDate(new Date().toISOString())}={}){
 const map=projectCapabilityMap(data,data.capabilityRecords||[]);
 const plan=deriveCapabilityStudyPlan(map,{today});
 const retained=new Set(plan.queue.filter(c=>c.kind==='retention'&&c.source==='gpt'&&['overdue','ready'].includes(c.timing)).map(c=>c.ability.id));
 const proposed=new Set(map.checks.filter(({ability,check})=>check.kind==='delayed_transfer'&&(!pendingOnly||check.aspect!=='retention'||retained.has(ability.id))).map(({ability})=>ability.id));
 return capabilityCatalog.filter(c=>proposed.has(c.id)).map(c=>capabilityTrainingProfile(data,c.id,map)).filter((p):p is NonNullable<typeof p>=>!!p?.trainable);
}
export async function createNoncuedRequest(data:Bootstrap):Promise<NoncuedRequest>{
 const profiles=noncuedProfiles(data);
 if(profiles.length<2)throw new Error('非誘導型には、実施可能な根拠付きのGPT提案が2能力以上必要です。保持予定は基準の自力答案を照合し、期日から候補に入ります。「GPT連携 → 能力評価」で確認してください。1能力を指定した練習は転移の非誘導確認とは区別します。');
 const key='training:blind:'+crypto.randomUUID(),contextVersion=await capabilityGenerationContextVersion({...data,records:data.capabilityRecords}),createdAt=new Date().toISOString();
 return {schemaVersion:'stat1-noncued-request-v1',key,createdAt,status:'requested',problemId:'GEN-'+crypto.randomUUID().toUpperCase(),contextVersion,
  candidates:profiles.map(p=>({abilityId:p.id,revision:p.revision})),noncued:{requestId:key,candidateAbilityIds:profiles.map(p=>p.id),exposures:[]}};
}
async function matchingProfiles(request:NoncuedRequest,data:Bootstrap){
 const context=await capabilityGenerationContextVersion({...data,records:data.capabilityRecords});
 if(request.contextVersion!==context)throw new Error('生成依頼後に学習証拠・能力評価が更新されています。元の依頼は保存したまま、非誘導型の新しい依頼を作成してください。');
 // Reopening an issued request must not be invalidated by crossing midnight.
 const profiles=noncuedProfiles(data,{pendingOnly:false});
 return request.candidates.map(c=>{const p=profiles.find(p=>p.id===c.abilityId&&p.revision===c.revision);if(!p)throw new Error('出題候補の根拠が更新されています。現在の能力評価から依頼を作成し直してください。');return p});
}
export async function noncuedGenerationPrompt(request:NoncuedRequest,data:Bootstrap){
 const profiles=await matchingProfiles(request,data),lineages=profiles.map(p=>buildAbilityLineage(p,data,1));
 const checks=new Map(projectCapabilityMap(data,data.capabilityRecords||[]).checks.map(c=>[c.ability.id,c.check]));
 const generation_context:GenerationContext={schema_version:'STAT1-GENERATION-v2',request_key:request.key,problem_id:request.problemId,ability_id:'候補からGPTが選んだ能力ID',created_at:request.createdAt,source:'manual_chatgpt'};
 const sample=generationDraftContract({generation_context} as TransferGenerationRecord);
 return '【非誘導型の遅延転移確認・生成用。解答者に対象を明かさない】\n'+
  'あなたが下記の保存済みGPT提案から今回の対象を1つ選ぶ。アプリは選ばない。生成理由、対象弱点、使用公式、解法、正答、採点基準、品質の検算内容は、本人の自力答案を固定するまで返答本文に表示しない。解法を悟れるタイトルも付けない。\n'+
  '元の失敗と同じ数学的操作を、別の設定・構造・要求で自力選択させる。数字や記号だけの変更は禁止。正当な別解も認める。記録にない原問題本文・原因は推測しない。独立した新しい会話で品質確認するため、完全な問題・解答・採点基準・採点根拠を機械可読データとして保持する。\n'+
  '保持の候補では、既習時の解法の記憶では進めない別構造を選ぶ。概念の混同に根拠がある場合に限り、必要な条件や意味を短く説明する問いを1点添えてよい。説明を求めることで方法を教えない。保持や転移の採用は実際の解答・参照条件・経過の照合後で、出題しただけでは認定しない。\n'+
  '返答本文には「問題を用意しました」のみを出し、次の標準JSONを未開封で取り込むためのJSON添付ファイルとして返す。添付ファイルを作れない場合は無理に非誘導を主張せず、全文を見たら誘導ありとして扱う。内部思考の開示は不要で、検証対象と採点根拠だけをファイルに記録する。\n'+
  'generation_contextのability_idだけを候補から選択し、その他の識別情報は予約値を変更しない。generator_pass_idは一意。self_checkは自己点検であって独立品質確認の代わりではない。\n'+
  JSON.stringify({candidates:lineages.map(l=>{const id=l.capabilityEvaluation!.abilityId,check=checks.get(id);return {ability_id:id,profile:l.abilityProfile,observed_failure:l.observedFailure,criterion:l.successCriteria,
   ...(check?.aspect==='retention'?{confirmation:'retention',interval_days:check.interval_days}:{})}}),output:sample});
}
export async function resolveNoncuedRequest(request:NoncuedRequest,data:Bootstrap,input:string):Promise<TransferGenerationRecord>{
 const raw=transferJson(input),profiles=await matchingProfiles(request,data),profile=profiles.find(p=>p.id===raw.generation_context?.ability_id);
 if(!profile)throw new Error('GPTが選んだ能力が、この非誘導依頼の候補にありません。現在の生成依頼を使用してください。');
 const lineage={...buildAbilityLineage(profile,data,1),key:request.key,noncuedRequestId:request.key};
 return {key:request.key,lineage,createdAt:request.createdAt,status:'requested',rounds:[],noncued:request.noncued,
  generation_context:{schema_version:'STAT1-GENERATION-v2',request_key:request.key,problem_id:request.problemId,ability_id:profile.id,created_at:request.createdAt,source:'manual_chatgpt'}};
}
export const noncuedInstructions='非誘導型です。通常の返答に対象能力・生成理由・正答・品質の根拠を出さず、結果は未開封で取り込めるJSON添付ファイルで返してください。解答者が内容を読んだ場合は参照ありとして申告します。JSONの仕様は下記から変更しません。\n';

export function noncuedAnswerConditions(protection:NoncuedProtection|undefined,external:unknown){
 if(!protection)return undefined;
 if(!['not_viewed','viewed','unknown'].includes(String(external)))throw new Error('答案固定前の生成理由・解答・品質内容の閲覧状況を選択してください。');
 return {requestId:protection.requestId,externalReview:external as 'not_viewed'|'viewed'|'unknown',exposures:structuredClone(protection.exposures),frozenAt:new Date().toISOString()};
}
export function noncuedIndependent(c:{externalReview:string;exposures:unknown[]}|undefined){
 return !!c&&c.externalReview==='not_viewed'&&c.exposures.length===0;
}
