import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {buildInitialGradingContract} from '../src/gradingContract.ts';import {deriveTransferEvidence} from '../src/skillEvidence.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');
const skill='finite_population_correction',key=`training:${skill}`,sourceId='PY-2023-Q5';
const fact=(id,date,purpose,success)=>({id,problem_id:sourceId,date,mode:'main_calc',time_minutes:12,
  score_numeric:success?100:35,score_label:success?'A':'C',mark:success?'○':'△',error_type:success?'none':'W',error_types:[success?'none':'W'],
  error_point:success?'':'共分散と有限修正へ到達できない',next_action:'局所再現',actual_reference_level:0,grading_confidence:.95,
  learning_purpose:purpose,assessment_timing:purpose==='retrieval_check'?'delayed_retrieval':'independent_performance',
  grading_contract:{gradedParts:[{id:'major_calculation',stableTargetKey:`target:${sourceId}:slot:major_calculation`,rootSkillIds:[skill],masteryLevel:2}]},
  graded_findings:[{graded_part_id:'major_calculation',error_type:success?'none':'W',materiality:'major',resolved:success,evidence:'二次積から分散'}]});
test('existing candidate completes the same blind submit → scoped grading → training → roundtrip flow',async()=>{
  await localGet('/api/bootstrap');await db.attempts.bulkPut([fact(9001,'2026-09-20','exam_performance',false),fact(9002,'2026-09-21','error_repair',true),fact(9003,'2026-09-23','retrieval_check',true)]);
  await db.pastSessions.put({id:9001,year:2023,date:'2026-09-20',session_kind:'individual_full',linked_attempt_ids:[9001],initial_selected_problem_ids:[sourceId],final_selected_problem_ids:[sourceId],questions:[],execution_status:'completed'});
  await db.meta.put({key:'exam-reference-pack:exposure-overrides',value:JSON.stringify({'PY-2018-Q2':'answer_exposed'})});
  const p={id:9999,problem_id:'WB-fixture-transfer',source_type:'whitebook',category:'A',chapter:1,problem_number:99,title:'検証用の別問題',theme:'fixture',
    recommended_mode:'full',priority:'A',role:'repair',notes:'',completion_status:'未着手',classification_confidence:'high',root_skill_ids:[skill],solution_operation_ids:[skill],fine_concept_ids:[skill],schedulable:true,gradable:true};
  await db.problems.put(p);
  const call=(action,extra={})=>localPost('/api/transfer-training',{key,action,...extra});
  const state=await localGet('/api/bootstrap');assert.ok(state.today.tasks.some(t=>t.transfer_training_key===key));
  await assert.rejects(()=>call('grading-prompt'));
  await call('start');const blind=await call('view');assert.ok(!JSON.stringify(blind).includes(skill),'blind response has no target identity');
  await call('submit',{answer:'固定個数の二次積を用いて分散まで導出した（試験fixture答案）',minutes:12,referenceLevel:0});
  const prompt=await call('grading-prompt');assert.ok(prompt.prompt.includes(skill));
  const contract=buildInitialGradingContract({problem:p,mode:'full'}),before=await db.reviews.count();
  const u={problem_id:p.problem_id,problem_id_confirmed:true,date:'auto_today',mode:'full',score_numeric:90,score_label:'A',mark:'○',error_type:'none',error_types:['none'],
    grading_confidence:.95,contract_id:contract.contractId,contract_hash:contract.contractHash,contract_version:contract.contractVersion,
    graded_part_ids:contract.gradedParts.map(p=>p.id),graded_findings:contract.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'答案で主要計算を確認'})),
    target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'二次積から分散を自力で導出'}};
  await call('grade',{text:JSON.stringify({study_update:u})});
  const a=(await db.attempts.where('problem_id').equals(p.problem_id).toArray())[0];assert.equal(a.exam_score_eligible,false);assert.equal(a.learning_purpose,'transfer_check');
  assert.equal(await db.reviews.count(),before,'target外の新規Reviewを増殖しない');
  assert.ok(deriveTransferEvidence(await db.attempts.toArray()).some(e=>e.successAttemptId===a.id&&e.evidenceStrength==='training'));
  const backup=await exportBackup();await restoreBackup(backup);assert.equal((await call('view')).status,'graded');
  assert.equal((await call('view')).afterSubmission.result,'training transfer success');
  assert.equal((await call('view')).afterSubmission.feedback.score,90,'post-answer feedback includes the saved score');
});
test('a recorded hint cannot be downgraded by the quick Review result body',async()=>{
  // Synthetic source only; this test never alters the production export.
  await localPost('/api/attempts',{problem_id:'PY-2022-Q4',problem_id_confirmed:true,problem_id_source:'manual',date:'2026-10-10',mode:'full',
    mark:'△',score_label:'C',score_numeric:30,error_types:['W'],error_type:'W',error_point:'計算途中で停止',next_action:'局所確認',actual_reference_level:0});
  let s=await localGet('/api/bootstrap');const review=s.reviews.find(r=>r.problem_id==='PY-2022-Q4'&&r.status==='pending');assert.ok(review);
  await localPost(`/api/reviews/${review.id}/reference`,{actual_reference_level:2});
  await localPost(`/api/reviews/${review.id}/complete`,{result:'success',actual_reference_level:0,time_minutes:10});
  const a=(await db.attempts.where('problem_id').equals(review.problem_id).toArray()).find(a=>a.generated_from_review_id===review.id);
  assert.equal(a.actual_reference_level,2);assert.equal(a.hint_used,true);assert.notEqual(a.mark,'◎');
});
