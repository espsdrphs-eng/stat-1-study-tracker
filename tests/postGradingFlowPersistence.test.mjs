import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
let attemptId,problemId;
const learning=async()=>Object.fromEntries(await Promise.all(['attempts','reviews','weakNotes','pastSessions','problems'].map(async k=>[k,await db.table(k).toArray()])));
test('first grade stays immutable and deduplicated while a consultation is linked to its exact saved Attempt',async()=>{
 const b=await localGet('/api/bootstrap'),p=b.problems.find(p=>p.problem_id==='PY-2018-Q3'),c=buildInitialGradingContract({problem:p,mode:'full'});problemId=p.problem_id;
 const grade={problem_id:p.problem_id,problem_id_confirmed:true,date:b.dashboard.today,task_origin:'first_attempt',mode:'full',mark:'△',score_numeric:30,score_label:'D',error_type:'W',error_types:['W'],primary_error_type:'W',actual_reference_level:0,grading_confidence:99,time_minutes:null,actual_minutes:null,
  learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:p.allowedErrorTypes?.includes('W')?'W':'N',resolved:false,evidence:'FIXTURE: 指定された計算が未完成'})),error_point:'FIXTURE: 主要計算が未完成',result_summary:'FIXTURE: 初手は確認したが計算未完成',next_action:'主要計算を補修して別日に自力再現',review_after_days:3};
 const rawText=JSON.stringify({study_update:grade}),receipt=await localPost('/api/import',{updates:[grade],rawText});attemptId=receipt.savedAttemptIds[0];
 const before=await learning(),again=await localPost('/api/import',{updates:[grade],rawText});assert.deepEqual(again.savedAttemptIds,[attemptId]);assert.equal(again.replayed,true);assert.deepEqual(await learning(),before);
 const body={rawText:'FIXTURE: 説明の後に理解できた。自力・保持・転移は未確認。',kind:'consultation',problemId,sourceAttemptId:attemptId,confirmedByUser:true};
 const first=await localPost('/api/gpt-exchanges',body);assert.equal(first.record.sourceAttemptId,attemptId);assert.equal(first.record.status,'raw_only');
 assert.equal((await localPost('/api/gpt-exchanges',body)).duplicate,true);assert.deepEqual(await learning(),before);
 const backup=await exportBackup(),preview=await previewBackupRestore(backup);await restoreBackup(backup,{mode:'original',sourceHash:preview.manifest.data_hash});db.close();await db.open();
 assert.deepEqual((await localGet('/api/gpt-exchanges')).find(r=>r.id===first.record.id),first.record);assert.deepEqual(await learning(),before);
});
test('a missing, mismatched or invalidated source Attempt cannot receive a bound repair archive',async()=>{
 const body={rawText:'FIXTURE source validation',kind:'consultation',problemId,sourceAttemptId:9999999,confirmedByUser:true};const before=await db.meta.count();
 await assert.rejects(()=>localPost('/api/gpt-exchanges',body),/答案/);
 await assert.rejects(()=>localPost('/api/gpt-exchanges',{...body,sourceAttemptId:attemptId,problemId:'PY-2016-Q1'}),/答案.*問題|問題.*答案/);
 await db.attempts.update(attemptId,{invalidated_at:'2026-10-24T00:00:00Z'});
 await assert.rejects(()=>localPost('/api/gpt-exchanges',{...body,sourceAttemptId:attemptId}),/無効|過去/);assert.equal(await db.meta.count(),before);
});
