import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');
test('paper work is persisted separately, reloadable and closed only by a new graded Attempt',async()=>{
 const b=await localGet('/api/bootstrap'),id='PY-2019-Q2';
 const before=await db.attempts.count();
 await localPost('/api/learning-work',{problemId:id,stage:'preparing',mode:'full'});
 assert.equal((await localGet('/api/bootstrap')).learningWorkByProblem[id].stage,'preparing');
 await localPost('/api/learning-work',{problemId:id,stage:'awaiting_grading',mode:'full'});
 assert.equal(await db.attempts.count(),before);
 const backup=await exportBackup();await restoreBackup(backup);
 assert.equal((await localGet('/api/bootstrap')).learningWorkByProblem[id].stage,'awaiting_grading');
 const p=b.problems.find(p=>p.problem_id===id),c=buildInitialGradingContract({problem:p,mode:'full'});
 await localPost('/api/attempts',{problem_id:id,problem_id_confirmed:true,date:b.dashboard.today,mode:'full',mark:'○',score_numeric:80,score_label:'B',error_type:'none',error_types:['none'],actual_reference_level:0,grading_confidence:99,time_minutes:null,actual_minutes:null,
  learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 画像採点で対象範囲を確認'})),next_action:'保持確認',review_after_days:7});
 const result=(await db.attempts.where('problem_id').equals(id).toArray()).at(-1);assert.equal(result.time_minutes,null);
 const {deriveProblemLearningView}=await import('../src/learningFeedback.ts');
 const current=await localGet('/api/bootstrap');assert.equal(deriveProblemLearningView(current,p).workStatus,'graded');
 const after=await exportBackup();await restoreBackup(after);assert.equal((await db.attempts.get(result.id)).time_minutes,null);
 const empty={...backup,meta:backup.meta.filter(m=>!m.key.startsWith('learning-work:'))};await restoreBackup(empty);
 assert.equal((await localGet('/api/bootstrap')).learningWorkByProblem[id],undefined);
});
test('unspecified answer time saves null instead of a zero-minute completion',async()=>{
 const b=await localGet('/api/bootstrap'),p=b.problems.find(p=>p.problem_id==='PY-2018-Q3'),c=buildInitialGradingContract({problem:p,mode:'full'});
 await localPost('/api/attempts',{problem_id:p.problem_id,problem_id_confirmed:true,date:b.dashboard.today,mode:'full',score_numeric:50,error_type:'W',error_types:['W'],error_point:'FIXTURE: 主要計算未完',next_action:'局所補修',grading_confidence:99,actual_reference_level:0,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,
 learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,time_minutes:'',graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:p.allowedErrorTypes.includes('W')?'W':'none',resolved:!p.allowedErrorTypes.includes('W'),evidence:'FIXTURE: 画像で主要計算停止を確認'}))});
 assert.equal((await db.attempts.where('problem_id').equals(p.problem_id).toArray()).at(-1).time_minutes,null);
});
test('recorded root-task assistance cannot be lowered by imported grading JSON or leak into a future attempt',async()=>{
 const b=await localGet('/api/bootstrap'),p=b.problems.find(p=>p.problem_id==='PY-2019-Q3'),c=buildInitialGradingContract({problem:p,mode:'full'});
 await localPost('/api/learning-work',{problemId:p.problem_id,stage:'preparing',mode:'full',referenceLevel:2});
 await localPost('/api/learning-work',{problemId:p.problem_id,stage:'awaiting_grading',mode:'full',referenceLevel:0});
 const backup=await exportBackup();await restoreBackup(backup);
 const grade={problem_id:p.problem_id,problem_id_confirmed:true,date:b.dashboard.today,mode:'full',mark:'○',score_numeric:100,error_type:'none',error_types:['none'],actual_reference_level:0,hint_used:false,no_hint:true,grading_confidence:99,time_minutes:null,
  learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,
  graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 採点JSONは参照なしを誤申告'}))};
 await localPost('/api/attempts',grade);const aided=(await db.attempts.where('problem_id').equals(p.problem_id).toArray()).at(-1);
 assert.equal(aided.actual_reference_level,2);assert.equal(aided.hint_used,true);assert.equal(aided.no_hint,false);assert.equal(aided.exam_score_eligible,false);
 // A later manual/legacy result is a separate attempt; never reuse the first-attempt contract.
 const {contract_id,contract_hash,contract_version,graded_part_ids,graded_findings,...manual}=grade;
 await localPost('/api/attempts',{...manual,date:'2026-10-12'});const next=(await db.attempts.where('problem_id').equals(p.problem_id).toArray()).at(-1);
 assert.equal(next.actual_reference_level,0,'consumed work reference must not persist onto future attempts');
});
