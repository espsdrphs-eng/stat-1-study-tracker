import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';

test('unstructured GPT text is stored exactly, never converted to a score or mastery, and is idempotent',async()=>{
 await localGet('/api/bootstrap');
 const counts=async()=>Promise.all([db.attempts.count(),db.reviews.count(),db.weakNotes.count(),db.pastSessions.count()]);
 const before=await counts(),body={rawText:'学習の相談\n「まだ未確認」です。\r\n{不完全なJSON',kind:'consultation',problemId:null,note:'原因は未確認',confirmedByUser:true};
 const first=await localPost('/api/gpt-exchanges',body);
 assert.equal(first.record.rawText,body.rawText);assert.equal(first.record.status,'raw_only');assert.equal(first.duplicate,false);
 const again=await localPost('/api/gpt-exchanges',body);
 assert.equal(again.record.id,first.record.id);assert.equal(again.duplicate,true);
 assert.deepEqual(await counts(),before);
 const rows=await localGet('/api/gpt-exchanges');assert.ok(rows.some(r=>r.id===first.record.id));
 const backup=await exportBackup(),preview=await previewBackupRestore(backup);
 await restoreBackup(backup,{mode:'original',sourceHash:preview.manifest.data_hash});
 db.close();await db.open();
 assert.deepEqual((await localGet('/api/gpt-exchanges')).find(r=>r.id===first.record.id),first.record);
 assert.deepEqual(await counts(),before);
});
test('grading and its exact raw response commit together; an archive failure rolls the whole save back',async()=>{
 const b=await localGet('/api/bootstrap'),p=b.problems.find(p=>p.problem_id==='PY-2018-Q3'),c=buildInitialGradingContract({problem:p,mode:'full'});
 const grade={problem_id:p.problem_id,problem_id_confirmed:true,date:b.dashboard.today,task_origin:'first_attempt',mode:'full',mark:'○',score_numeric:80,score_label:'B',error_type:'none',error_types:['none'],primary_error_type:'none',actual_reference_level:0,grading_confidence:99,time_minutes:null,actual_minutes:null,
  learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 指定操作の正答を確認'})),next_action:'保持確認',review_after_days:7};
 const rawText=`ChatGPT返答原文\r\n${JSON.stringify({study_update:grade})}`;
 const before=await db.attempts.count(),fail=function(key,row){if(row.key.startsWith('gpt-exchange:v1:'))throw new Error('fixture archive storage failure')};
 db.meta.hook('creating',fail);
 try{await assert.rejects(()=>localPost('/api/import',{updates:[grade],rawText}),/archive storage failure/)}finally{db.meta.hook('creating').unsubscribe(fail)}
 assert.equal(await db.attempts.count(),before);
 const ok=await localPost('/api/import',{updates:[grade],rawText});assert.equal(ok.savedAttemptIds.length,1);
 const again=await localPost('/api/import',{updates:[grade],rawText});assert.deepEqual(again.savedAttemptIds,ok.savedAttemptIds);assert.equal(again.replayed,true);
 assert.equal(await db.attempts.count(),before+1);
 assert.ok((await localGet('/api/gpt-exchanges')).some(r=>r.rawText===rawText));
});
test('concurrent raw saves have one immutable receipt and never double-count learning',async()=>{
 const body={rawText:'並行保存の検証原文',kind:'planning',confirmedByUser:true};
 const [a,b]=await Promise.all([localPost('/api/gpt-exchanges',body),localPost('/api/gpt-exchanges',body)]);
 assert.equal(a.record.id,b.record.id);assert.notEqual(a.duplicate,b.duplicate);
 assert.equal((await localGet('/api/gpt-exchanges')).filter(r=>r.id===a.record.id).length,1);
});
test('raw archive requires explicit confirmation and a real optional problem; failures do not write',async()=>{
 const before=await db.meta.count();
 await assert.rejects(()=>localPost('/api/gpt-exchanges',{rawText:'未確認',kind:'consultation'}),/確認/);
 await assert.rejects(()=>localPost('/api/gpt-exchanges',{rawText:'未確認',kind:'consultation',confirmedByUser:true,problemId:'NOT-A-PROBLEM'}),/問題/);
 assert.equal(await db.meta.count(),before);
});
