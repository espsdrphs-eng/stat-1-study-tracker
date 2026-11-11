import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import yaml from 'js-yaml';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {GENERATION_CHECKS,generationDraftContract} from '../src/generatedTransfer.ts';
import {projectCapabilityMap} from '../src/capabilityEvidence.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';

test('canonical capability -> existing generation -> independent quality -> paper -> actual grading contract -> explicit GPT state update -> next proposal survives restore',async()=>{
 await localGet('/api/bootstrap');const f=capabilityFacts();await db.attempts.bulkPut(f.attempts);
 const formal=await localGet('/api/bootstrap'),initial=await exportBackup();
 const ctx=await localGet('/api/capabilities/context'),first=capabilityWire(ctx);
 await localPost('/api/capabilities/save',{text:JSON.stringify(first),confirmed:true});
 const {key}=await localPost('/api/transfer-training',{action:'begin-ability',capabilityId:first.evaluations[0].ability_id});
 const call=(action,extra={})=>localPost('/api/transfer-training',{key,action,...extra});
 const prompt=(await call('start-generated')).prompt;assert.match(prompt,/expectation-variance/);assert.match(prompt,/数字・記号だけ/);
 let record=JSON.parse((await db.meta.get('transfer-generation:'+key)).value),contract=generationDraftContract(record);
 const draft={generation_context:contract.generation_context,self_check:Object.fromEntries(['well_defined','solution_correct','rubric_aligned'].map(k=>[k,{pass:true,evidence:'TEST ONLY: 自己点検であり独立品質の検証ではない。'}])),problem_text:'TEST ONLY: 確率変数Xは値0,1をそれぞれ確率2/3,1/3でとる。L=2X+1の期待値と分散を求めよ。',reference_solution:'TEST ONLY: E[L]=5/3、Var(L)=4Var(X)=8/9。',grading_rubric:'TEST ONLY: 対象量、期待値、二次モーメント、最終分散を独立に採点。',difficulty:'統計検定1級',estimated_minutes:10,surface_features:['TEST ONLY finite losses','TEST ONLY affine transformation'],generator_pass_id:'test-capability-generator'};
 await call('draft',{text:JSON.stringify(draft)});record=JSON.parse((await db.meta.get('transfer-generation:'+key)).value);
 const pending=await call('view');assert.equal(pending.status,'validation_pending');assert.equal(pending.problem,undefined);
 const quality={draft_hash:record.rounds.at(-1).hash,validator_pass_id:'test-capability-independent',checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'TEST ONLY: 合格経路を通すための検証報告。実ChatGPTによる品質確認ではない。'}]))};
 await call('validate',{text:JSON.stringify(quality)});const ready=await call('view');assert.equal(ready.status,'ready');assert.ok(!JSON.stringify(ready).includes(draft.reference_solution));
 const p=await db.problems.get(ready.problem.problem_id);assert.equal(p.generated_transfer.lineage.capabilityEvaluation.evaluationId,JSON.parse((await db.meta.where('key').startsWith('capability-evaluation:').first()).value).id);
 const attemptsBefore=await db.attempts.count();await call('submit',{answer_medium:'paper_image',answer_completed:true,minutes:10,referenceLevel:0});assert.equal(await db.attempts.count(),attemptsBefore);
 const gradePrompt=(await call('grading-prompt')).prompt,wireContext=JSON.parse(gradePrompt.match(/study_update\.transfer_task_context を次のJSONのまま返してください:\n([^\n]+)/)[1]);
 const c=buildInitialGradingContract({problem:await db.problems.get(p.problem_id),mode:'full'});
 const grade={problem_id:p.problem_id,problem_id_confirmed:true,date:'2026-11-11',mode:'full',score_numeric:95,mark:'○',error_type:'none',error_types:['none'],grading_confidence:99,actual_reference_level:0,hint_used:false,learning_purpose:'transfer_check',learning_stage:'transfer',contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'TEST ONLY: 対象の数学的操作を自力で選択し、最終値まで完成したというテスト採点。'})),target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,outcome:'success',evidence:'TEST ONLY: 分散計算を自力で完成したというテスト所見。'},transfer_task_context:wireContext};
 await call('grade',{text:yaml.dump({study_update:grade})});await call('grade',{text:yaml.dump({study_update:grade})});
 const generated=await db.attempts.where('problem_id').equals(p.problem_id).toArray();assert.equal(generated.length,1);assert.equal(generated[0].exam_score_eligible,false);
 let current=await localGet('/api/bootstrap'),map=projectCapabilityMap(current,current.capabilityRecords);
 assert.equal(map.counts.immediate_confirmed,1,'a completed generation/grade must not update the map without explicit GPT evaluation');assert.equal(map.counts.delayed_transfer_confirmed,0);
 assert.deepEqual(map.abilities.find(a=>a.id===first.evaluations[0].ability_id).newerLinkedAnswers,[generated[0].id]);
 const next=capabilityWire(await localGet('/api/capabilities/context'),{state:'delayed_transfer_confirmed'});next.evaluated_at='2026-11-11T11:00:00+09:00';
 next.evaluations[0].evidence=[{attempt_id:generated[0].id,part_ids:['major_calculation'],kind:'delayed_transfer',outcome:'success',baseline_attempt_id:2,observation:'TEST ONLY: 別日・別の設定で自力完遂。',transfer_conditions:{different_structure:true,method_not_cued:true}}];next.evaluations[0].next_check={kind:'exam',due_date:'2026-11-14',task:'TEST ONLY: 時間制限下で同じ操作を確認',success_condition:'TEST ONLY: 制約・最終結論を時間内に完成'};
 const held=await localPost('/api/capabilities/save',{text:JSON.stringify(next),confirmed:true});assert.equal(held.record.items[0].effectiveState,'unconfirmed');assert.match(held.record.items[0].warnings.join(),/事前に示/);
 // Existing capability-focused generation intentionally records a cued
 // training. Do not erase that flag just to make a transfer assertion pass.
 const natural=capabilityWire(await localGet('/api/capabilities/context'),{state:'delayed_transfer_confirmed'});natural.evaluated_at='2026-11-11T11:30:00+09:00';natural.evaluations[0].evidence=[{attempt_id:3,part_ids:['major_calculation'],kind:'delayed_transfer',outcome:'success',baseline_attempt_id:2,observation:'TEST ONLY: 非誘導の未見過去問で確認した操作。',transfer_conditions:{different_structure:true,method_not_cued:true}}];natural.evaluations[0].next_check=next.evaluations[0].next_check;
 const saved=await localPost('/api/capabilities/save',{text:JSON.stringify(natural),confirmed:true});assert.equal(saved.record.items[0].effectiveState,'delayed_transfer_confirmed',saved.record.items[0].warnings.join(' / '));
 current=await localGet('/api/bootstrap');map=projectCapabilityMap(current,current.capabilityRecords);assert.equal(map.counts.delayed_transfer_confirmed,1);assert.equal(map.counts.exam_confirmed,0);
 for(const k of ['selectedThree','timed','selection','transfer'])assert.deepEqual(current.dashboard.readiness.evidence[k],formal.dashboard.readiness.evidence[k],k);
 const exported=await exportBackup(),pre=await previewBackupRestore(exported);await restoreBackup(exported,{mode:'original',sourceHash:pre.manifest.data_hash});db.close();await db.open();
 current=await localGet('/api/bootstrap');assert.equal(projectCapabilityMap(current,current.capabilityRecords).counts.delayed_transfer_confirmed,1);
 for(const a of initial.attempts)assert.deepEqual(await db.attempts.get(a.id),a);assert.deepEqual((await exportBackup()).pastSessions,initial.pastSessions);
});
