import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,previewBackupRestore,restoreBackup} from '../src/localDb.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {GENERATION_CHECKS} from '../src/generatedTransfer.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {projectCapabilityMap} from '../src/capabilityEvidence.ts';

const call=(key,action,extra={})=>localPost('/api/transfer-training',{key,action,...extra});
const record=async key=>JSON.parse((await db.meta.get('transfer-generation:'+key)).value);
const makeDraft=r=>({generation_context:{schema_version:'STAT1-GENERATION-v2',request_key:r.key,problem_id:r.problemId,ability_id:r.candidates[0].abilityId,created_at:r.createdAt,source:'manual_chatgpt'},self_check:Object.fromEntries(['well_defined','solution_correct','rubric_aligned'].map(k=>[k,{pass:true,evidence:'TEST ONLY: 検証経路の固定データ。実際の数学的品質保証ではない。'}])),problem_text:`TEST ONLY ${r.problemId}: Xは0,1を確率2/3,1/3でとる。L=2X+1の期待値と分散を求めよ。`,reference_solution:'TEST ONLY: E[L]=5/3、Var(L)=4Var(X)=8/9。これは模擬問題の解答。',grading_rubric:'TEST ONLY: 対象量の識別、確率計算、最終値、適切な別解を独立に採点する。',difficulty:'統計検定1級',estimated_minutes:12,surface_features:['TEST ONLY finite losses','TEST ONLY affine variables'],generator_pass_id:'TEST-ONLY-generator-'+r.key});
async function register(key){
 const r=await record(key),draft=makeDraft(r),before=JSON.stringify(r);
 const bad=structuredClone(draft);bad.generation_context.ability_id='not-in-offer';
 await assert.rejects(()=>call(key,'draft',{text:JSON.stringify(bad)}),/候補/);assert.equal(JSON.stringify(await record(key)),before);
 await call(key,'draft',{text:JSON.stringify(draft)});
 const pending=await call(key,'view');assert.equal(pending.status,'validation_pending');assert.equal(pending.sourceContext,undefined);assert.equal(pending.draftPreview,undefined,'unvalidated questions may contain cues; do not show them before quality passes');assert.ok(!JSON.stringify(pending).includes(draft.reference_solution));
 const stored=await record(key),quality={draft_hash:stored.rounds.at(-1).hash,validator_pass_id:'TEST-ONLY-independent-'+key,checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'TEST ONLY: 数学的品質は実モデル未検証、フローの合格経路を通す固定データ。'}]))};
 await assert.rejects(()=>call(key,'validate',{text:JSON.stringify({...quality,validator_pass_id:draft.generator_pass_id})}),/独立|同じ/);
 const preview=await call(key,'preview-validation',{text:JSON.stringify(quality)});assert.equal(preview.ready,true);assert.equal(preview.checks,undefined);
 const result=await call(key,'validate',{text:JSON.stringify(quality)});assert.equal(result.status,'ready');assert.equal(result.afterSubmission,undefined);
 assert.ok(!JSON.stringify(result).includes(draft.reference_solution));
 return result.problem.problem_id;
}
async function grade(key,problemId){
 const prompt=(await call(key,'grading-prompt')).prompt;
 const context=JSON.parse(prompt.match(/study_update\.transfer_task_context を次のJSONのまま返してください:\n([^\n]+)/)[1]);
 const p=await db.problems.get(problemId),c=buildInitialGradingContract({problem:p,mode:'full'});
 const u={problem_id:problemId,problem_id_confirmed:true,date:'2026-11-11',mode:'full',score_numeric:95,mark:'○',error_type:'none',error_types:['none'],grading_confidence:99,actual_reference_level:0,hint_used:false,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'TEST ONLY: 必要な対象操作を自力選択して最終値まで完遂したという模擬採点。'})),target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,outcome:'success',evidence:'TEST ONLY: 対象操作を自力選択し完成したという模擬採点。'},transfer_task_context:context};
 const text=JSON.stringify({study_update:u});await call(key,'grade',{text});await call(key,'grade',{text});
 const rows=await db.attempts.where('problem_id').equals(problemId).toArray();assert.equal(rows.length,1);assert.equal(rows[0].exam_score_eligible,false);return rows[0];
}

test('a noncued request lets GPT choose among saved proposals without preselecting or exposing a target',async()=>{
 await localGet('/api/bootstrap');await db.attempts.bulkPut(capabilityFacts().attempts);
 const ctx=await localGet('/api/capabilities/context'),w=capabilityWire(ctx);
 w.evaluations.push({...structuredClone(w.evaluations[0]),ability_id:'cross.finish-derivation'});
 // Only catalog IDs explicitly present in this fixture may be proposed.
 w.evaluations[1].ability_id='distributions.function-identity';
 await localPost('/api/capabilities/save',{text:JSON.stringify(w),confirmed:true});
 const before=await exportBackup();
 const begun=await localPost('/api/transfer-training',{action:'begin-blind'});
 assert.match(begun.key,/^training:blind:/);
 const view=await localPost('/api/transfer-training',{key:begun.key,action:'view'});
 assert.equal(view.noncued,true);assert.equal(view.sourceContext,undefined);assert.equal(view.selectedAbilityId,undefined);
 const prompt=await localPost('/api/transfer-training',{key:begun.key,action:'start-generated'});
 assert.match(prompt.prompt,/GPTが.*選|あなたが.*選/);assert.match(prompt.prompt,/添付.*JSON|JSON.*添付/);
 const after=await exportBackup();for(const k of ['attempts','reviews','weakNotes','pastSessions','problems'])assert.deepEqual(after[k],before[k]);
 const pre=await previewBackupRestore(after);await restoreBackup(after,{mode:'original',sourceHash:pre.manifest.data_hash});db.close();await db.open();
 assert.equal((await call(begun.key,'view')).status,'requested');
 assert.equal((await localPost('/api/transfer-training',{action:'list'})).warnings.length,0);
});

test('noncued generation, independent quality, frozen reference conditions, grading and explicit capability update survive restore',async()=>{
 const before=await exportBackup(),r=(await db.meta.where('key').startsWith('transfer-generation:training:blind:').first()),key=JSON.parse(r.value).key;
 const problemId=await register(key),list=(await localPost('/api/transfer-training',{action:'list'})).items.find(i=>i.key===key);
 assert.equal(list.sourceHidden,true);assert.ok(!list.title.includes('期待値'));
 await assert.rejects(()=>call(key,'grading-prompt'),/答案|参照/);
 await call(key,'submit',{answer_medium:'paper_image',answer_completed:true,referenceLevel:0,externalReview:'not_viewed'});
 const a=await grade(key,problemId);assert.equal(a.target_skill_prompted,false);
 const p=await db.problems.get(problemId);assert.equal(p.generated_transfer.answer_submission.noncued.externalReview,'not_viewed');
 let data=await localGet('/api/bootstrap'),map=projectCapabilityMap(data,data.capabilityRecords);assert.equal(map.counts.delayed_transfer_confirmed,0,'no automatic mastery');
 const ctx=await localGet('/api/capabilities/context'),w=capabilityWire(ctx,{ability_id:a.transfer_lineage.capabilityEvaluation.abilityId,state:'delayed_transfer_confirmed'});w.evaluated_at='2026-11-11T11:00:00+09:00';
 w.evaluations[0].evidence=[{attempt_id:a.id,part_ids:['major_calculation'],kind:'delayed_transfer',outcome:'success',baseline_attempt_id:2,observation:'TEST ONLY: 異構造の遅延確認という模擬判定。',transfer_conditions:{different_structure:true,method_not_cued:true}}];
 const result=await localPost('/api/capabilities/save',{text:JSON.stringify(w),confirmed:true});assert.equal(result.record.items[0].effectiveState,'delayed_transfer_confirmed',result.record.items[0].warnings.join());
 const again=await localPost('/api/capabilities/save',{text:JSON.stringify(w),confirmed:true});assert.equal(again.duplicate,true);
 const exported=await exportBackup(),pre=await previewBackupRestore(exported);await restoreBackup(exported,{mode:'original',sourceHash:pre.manifest.data_hash});db.close();await db.open();
 const restored=await exportBackup();for(const k of Object.keys(exported).filter(k=>Array.isArray(exported[k])))assert.deepEqual(restored[k],exported[k],k);
 for(const a of before.attempts)assert.deepEqual(await db.attempts.get(a.id),a);for(const k of ['reviews','weakNotes','pastSessions'])assert.deepEqual(restored[k],before[k]);
 data=await localGet('/api/bootstrap');assert.equal(projectCapabilityMap(data,data.capabilityRecords).counts.delayed_transfer_confirmed,1);
});

test('app exposure cannot be undone by an external no-view declaration; viewed or unknown external conditions remain cued',async()=>{
 for(const condition of ['app-source','app-payload','viewed','unknown','hint']){
  const begun=await localPost('/api/transfer-training',{action:'begin-blind'}),key=begun.key;
  if(condition==='app-payload')await call(key,'reveal',{kind:'payload'});
  const id=await register(key);
  if(condition==='app-source')await call(key,'lineage');
  await call(key,'submit',{answer_medium:'paper_image',answer_completed:true,referenceLevel:condition==='hint'?3:0,externalReview:['viewed','unknown'].includes(condition)?condition:'not_viewed'});
  const a=await grade(key,id),ctx=await localGet('/api/capabilities/context');
  if(condition!=='hint')assert.equal(a.target_skill_prompted,true,condition);
  const w=capabilityWire(ctx,{ability_id:a.transfer_lineage.capabilityEvaluation.abilityId,state:'delayed_transfer_confirmed'});w.evaluated_at='2026-11-11T11:30:00+09:00';
  w.evaluations[0].evidence=[{attempt_id:a.id,part_ids:['major_calculation'],kind:'delayed_transfer',outcome:'success',baseline_attempt_id:2,observation:'TEST ONLY: 閲覧ありを誤って成功申告した入力。',transfer_conditions:{different_structure:true,method_not_cued:true}}];
  const held=await localPost('/api/capabilities/preview',{text:JSON.stringify(w)});assert.equal(held.record.items[0].effectiveState,'unconfirmed',condition);
  if(condition==='app-source'){
   await db.attempts.update(a.id,{target_skill_prompted:false});w.context_version=(await localGet('/api/capabilities/context')).version;
   const forged=await localPost('/api/capabilities/preview',{text:JSON.stringify(w)});assert.equal(forged.record.items[0].effectiveState,'unconfirmed');assert.match(forged.record.items[0].warnings.join(),/非閲覧/);
  }
 }
});

test('a stale noncued request is not rebound to new evidence and a failed import remains retryable',async()=>{
 const begun=await localPost('/api/transfer-training',{action:'begin-blind'}),key=begun.key,r=await record(key),snapshot=JSON.stringify(r);
 const source=await db.attempts.get(2);await db.attempts.update(2,{memo:'TEST ONLY: changed after the generation request'});
 await assert.rejects(()=>call(key,'draft',{text:JSON.stringify(makeDraft(r))}),/更新/);assert.equal(JSON.stringify(await record(key)),snapshot);
 await db.attempts.put(source);
 const original=JSON.stringify(await record(key)),fail=(changes,id)=>{if(id==='transfer-generation:'+key)throw Error('TEST ONLY failed noncued draft write')};
 db.meta.hook('updating',fail);try{await assert.rejects(()=>call(key,'draft',{text:JSON.stringify(makeDraft(r))}),/failed noncued/)}finally{db.meta.hook('updating').unsubscribe(fail)}
 assert.equal(JSON.stringify(await record(key)),original);
 await call(key,'draft',{text:JSON.stringify(makeDraft(r))});assert.equal((await call(key,'view')).status,'validation_pending');
});
