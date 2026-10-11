import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {buildGradingContractSnapshot} from '../src/gradingContract.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');

test('started root task without Review ID retains its exact grading contract through restore and rejects stale reuse',async()=>{
 const b=await localGet('/api/bootstrap'),p=b.problems.find(p=>p.problem_id==='PY-2018-Q4');
 // Local boundary fixture: the started-task snapshot is app-owned, not model-owned.
 const sourceId=await db.attempts.add({problem_id:p.problem_id,date:b.dashboard.today,mode:'full',mark:'△',score_numeric:50,error_type:'W',error_types:['W'],error_point:'係数の追跡',next_action:'対象範囲の補修',policy_validity:'valid'});
 const source=await db.attempts.get(sourceId),task={problem_id:p.problem_id,mode:'skeleton',learning_purpose:'error_repair',learning_stage:'repair',assessment_timing:'same_session_correction',review_scope:'targeted_patch',source_attempt_id:sourceId,targeted_parts:['係数の追跡']};
 const c=buildGradingContractSnapshot({review:task,problem:p,sourceAttempt:source}).contract;task.grading_contract=c;
 await db.meta.put({key:`learning-work:${p.problem_id}`,value:JSON.stringify({id:'boundary-fixture',problemId:p.problem_id,mode:c.mode,baselineAttemptId:sourceId,stage:'awaiting_grading',referenceLevel:2,task,updatedAt:new Date().toISOString()})});
 const backup=await exportBackup();await restoreBackup(backup);
 const grade={problem_id:p.problem_id,problem_id_confirmed:true,date:b.dashboard.today,mode:c.mode,score_numeric:100,error_type:'none',error_types:['none'],actual_reference_level:0,hint_used:false,no_hint:true,grading_confidence:.99,
  contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval',review_scope:c.reviewScope,target_kind:c.targetKind,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 対象範囲の画像答案を採点'})),review_outcome:'success',target_issue_resolved:true,minimum_pass_condition_met:true};
 await assert.rejects(localPost('/api/attempts',{...grade,contract_hash:'forged'}),/一致しません/);
 await localPost('/api/attempts',grade);
 const saved=(await db.attempts.where('problem_id').equals(p.problem_id).toArray()).at(-1);
 assert.equal(saved.grading_contract.contractId,c.contractId);assert.equal(saved.actual_reference_level,2);assert.equal(saved.hint_used,true);assert.notEqual(saved.mark,'◎');assert.equal(saved.learning_purpose,'error_repair');assert.equal(saved.assessment_timing,'same_session_correction');assert.equal(saved.exam_score_eligible,false);
 await assert.rejects(localPost('/api/attempts',grade),/終了|更新|再生成/);
 await assert.rejects(localPost('/api/learning-work',{problemId:p.problem_id,stage:'preparing',contractId:'review:pending:forged'}),/適格|更新|課題/);
});
