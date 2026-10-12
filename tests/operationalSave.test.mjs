import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';
import {deriveProblemLearningView} from '../src/learningFeedback.ts';
const {db,localGet,localPost,restoreBackup,exportBackup}=await import('../src/localDb.ts');
const path='outputs/operations-20261012/stat-study-2026-10-12(1).json';
const raw=await readFile(path,'utf8').then(JSON.parse).catch(()=>null);
export function partialGrade(state){
 const w=state.learningWorkByProblem['PY-2021-Q4'],c=w.task.grading_contract;
 return {problem_id:w.problemId,date:state.dashboard.today,mode:c.mode,submission_id:'operational-partial-55',score_numeric:55,score_label:'B',mark:'△',error_type:'W',error_types:['W'],actual_reference_level:w.referenceLevel,reference_level:w.referenceLevel,hint_used:w.referenceLevel>0,no_hint:w.referenceLevel===0,grading_confidence:90,uncertain_points:['設問5の最終条件は画像から判定不能'],result_summary:'FIXTURE: 設問4は部分的に改善。設問5の最終条件は判定不能。',error_point:'FIXTURE: 設問5の結論は追加確認が必要。',next_action:'FIXTURE: 設問5の最終条件を後日確認する。',target_issue_resolved:false,minimum_pass_condition_met:false,review_outcome:'failure',time_minutes:null,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,assessment_timing:w.task.assessment_timing,source_attempt_id:c.sourceAttemptId,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map((p,i)=>({graded_part_id:p.id,error_type:i?'none':'W',resolved:!!i,evidence:i?'FIXTURE: 指定計算は成功':'FIXTURE: 結論に未確定部分が残る'}))};
}
test('production-copy partial 55 is durably saved once, finishes the old task and retains a future unresolved target',{skip:!raw},async()=>{
 await restoreBackup(structuredClone(raw));const before=await exportBackup(),state=await localGet('/api/bootstrap');
 const input={...partialGrade(state),problem_id_confirmed:true,target_kind:state.learningWorkByProblem['PY-2021-Q4'].task.grading_contract.targetKind},oldTask=state.learningWorkByProblem[input.problem_id].task;
 const receipt=await localPost('/api/import',{updates:[input]});
 const id=receipt.savedAttemptIds?.[0]||(await db.attempts.toArray()).find(a=>a.submission_id===input.submission_id)?.id,saved=await db.attempts.get(id);assert.equal(saved.score_numeric,55);assert.ok(saved.uncertain_points.length);assert.equal(saved.time_minutes,null);
 const after=await localGet('/api/bootstrap');assert.ok(!after.today.tasks.some(t=>!t.checked&&t.grading_contract?.contractId===oldTask.grading_contract.contractId));
 const view=deriveProblemLearningView(after,after.problems.find(p=>p.problem_id===input.problem_id));assert.equal(view.workStatus,'graded');assert.match(view.statusLabel,/採点済み.*再復習予定/);
 assert.ok(!after.today.tasks.some(t=>!t.checked&&t.problem_id===input.problem_id&&!t.stable_session_key),'future residual must not bypass the follow-up Review window');
 assert.ok(after.reviews.some(r=>r.problem_id===input.problem_id&&r.status==='pending'&&r.source_attempt_id===id));
 assert.deepEqual((await exportBackup()).attempts.filter(a=>a.id!==id),before.attempts);
 const count=await db.attempts.count(),repeat=await localPost('/api/import',{updates:[{...input,submission_id:'new-random-id-same-json'}]});assert.deepEqual(repeat.savedAttemptIds,[id]);assert.equal(await db.attempts.count(),count);
 await assert.rejects(localPost('/api/import',{updates:[{...input,score_numeric:56}]}),/保存ID.*別の採点/);
 const backup=await exportBackup();await restoreBackup(backup);await localPost('/api/import',{updates:[input]});assert.equal(await db.attempts.count(),count);
 const restored=await localGet('/api/bootstrap');console.log('roundtrip Q4',JSON.stringify(restored.today.tasks.filter(t=>!t.checked&&t.problem_id===input.problem_id).map(t=>({kind:t.kind,source:t.source_attempt_id,review:t.id,contract:t.grading_contract?.contractId,session:t.stable_session_key}))));assert.ok(!restored.today.tasks.some(t=>!t.checked&&!t.stable_session_key&&t.problem_id===input.problem_id));
});
test('failed atomic save rolls back all records and same input retry/concurrent duplicate is exactly once',{skip:!raw},async()=>{
 await restoreBackup(structuredClone(raw));const state=await localGet('/api/bootstrap'),before=await exportBackup();
 const input={...partialGrade(state),problem_id_confirmed:true,target_kind:state.learningWorkByProblem['PY-2021-Q4'].task.grading_contract.targetKind};
 const put=db.meta.put.bind(db.meta);db.meta.put=async row=>{if(row.key.startsWith('grading-submission:'))throw new DOMException('FIXTURE: storage full','QuotaExceededError');return put(row);};
 try{await assert.rejects(localPost('/api/import',{updates:[input]}),/storage full/);}finally{db.meta.put=put;}
 const failed=await exportBackup();for(const k of ['attempts','reviews','weakNotes'])assert.deepEqual(failed[k],before[k]);
 const receipts=await Promise.all([localPost('/api/import',{updates:[input]}),localPost('/api/import',{updates:[{...input,submission_id:'double-click'}]})]);assert.deepEqual(receipts[0].savedAttemptIds,receipts[1].savedAttemptIds);
 assert.equal(await db.attempts.count(),before.attempts.length+1);
});
test('input JSON failure is not mislabelled as a database upgrade and save needs a durable receipt',async()=>{
 const src=await readFile(new URL('../src/AdvancedImportView.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(src,/データベース更新後、もう一度保存/);assert.match(src,/savedAttemptIds/);assert.match(src,/saving\.current/);assert.match(src,/setSaveFailureReason\(schemaErrorMessage/);
});
test('explicit indeterminate finding is saved as executed, never silently converted into resolved success',{skip:!raw},async()=>{
 await restoreBackup(structuredClone(raw));const state=await localGet('/api/bootstrap'),input={...partialGrade(state),problem_id_confirmed:true,target_kind:state.learningWorkByProblem['PY-2021-Q4'].task.grading_contract.targetKind,submission_id:'indeterminate-not-wrong'};
 input.graded_findings=input.graded_findings.map((f,i)=>({...f,error_type:i?'W':'none',resolved:false,evidence:i?'FIXTURE: 主要計算は未完':'FIXTURE: この最終条件は画像から判定不能'}));
 const receipt=await localPost('/api/import',{updates:[input]}),saved=await db.attempts.get(receipt.savedAttemptIds[0]);assert.equal(saved.graded_findings[0].resolved,false);assert.equal(saved.graded_findings[0].error_type,'none');assert.ok(saved.uncertain_points.length);assert.notEqual(saved.mark,'◎');
 const b=await localGet('/api/bootstrap');assert.equal(deriveProblemLearningView(b,b.problems.find(p=>p.problem_id===input.problem_id)).workStatus,'graded');
 assert.ok(!b.today.tasks.some(t=>!t.checked&&t.grading_contract?.contractId===input.contract_id));
});
test('failure after durable commit is a projection warning, not a failed save or duplicate retry',{skip:!raw},async()=>{
 await restoreBackup(structuredClone(raw));const state=await localGet('/api/bootstrap');const input={...partialGrade(state),problem_id_confirmed:true,target_kind:state.learningWorkByProblem['PY-2021-Q4'].task.grading_contract.targetKind};
 const read=db.pastSessions.toArray.bind(db.pastSessions);db.pastSessions.toArray=async()=>{throw new Error('FIXTURE: projection unavailable');};let receipt;
 try{receipt=await localPost('/api/import',{updates:[input]});}finally{db.pastSessions.toArray=read;}
 assert.equal(receipt.savedAttemptIds.length,1);assert.match(receipt.projectionWarning,/保存済み/);assert.equal((await db.attempts.get(receipt.savedAttemptIds[0])).score_numeric,55);
 const repeat=await localPost('/api/import',{updates:[input]});assert.deepEqual(repeat.savedAttemptIds,receipt.savedAttemptIds);assert.equal(await db.attempts.count(),raw.attempts.length+1);
});
test('multi-day partial failure then a valid successful repair keeps task completion, follow-up window and retention distinct',{skip:!raw},async t=>{
 const now=Date.parse('2026-10-12T12:00:00Z');t.mock.timers.enable({apis:['Date'],now});
 await restoreBackup(structuredClone(raw));let state=await localGet('/api/bootstrap');const input={...partialGrade(state),problem_id_confirmed:true,target_kind:state.learningWorkByProblem['PY-2021-Q4'].task.grading_contract.targetKind};
 const receipt=await localPost('/api/import',{updates:[input]}),id=receipt.savedAttemptIds[0],follow=(await db.reviews.toArray()).find(r=>r.problem_id===input.problem_id&&r.status==='pending'&&r.source_attempt_id===id);assert.ok(follow);
 const earliest=follow.earliest_date||follow.due_date;
 for(let day=1;day<=14;day++){
  t.mock.timers.setTime(now+day*86400000);state=await localGet('/api/bootstrap');
  assert.ok(!state.today.tasks.some(task=>!task.checked&&!task.stable_session_key&&task.problem_id===input.problem_id&&task.source_attempt_id===291));
  if(state.dashboard.today<earliest)assert.ok(!state.today.tasks.some(task=>!task.checked&&!task.stable_session_key&&task.problem_id===input.problem_id));
 }
 const task=state.today.tasks.find(task=>!task.checked&&!task.stable_session_key&&task.problem_id===input.problem_id);assert.ok(task);
 await localPost('/api/learning-work',{problemId:input.problem_id,stage:'awaiting_grading',mode:task.mode,contractId:task.id?undefined:task.grading_contract.contractId,reviewId:task.id,referenceLevel:0});state=await localGet('/api/bootstrap');
 const c=state.learningWorkByProblem[input.problem_id].task?.grading_contract||state.reviews.find(r=>r.id===task.id).grading_contract;
 const success={...input,submission_id:'later-success',date:state.dashboard.today,mode:c.mode,score_numeric:100,score_label:'A',uncertain_points:[],error_type:'none',error_types:['none'],actual_reference_level:0,reference_level:0,hint_used:false,no_hint:true,review_outcome:'success',target_issue_resolved:true,minimum_pass_condition_met:true,result_summary:'FIXTURE: 後日の参照なし局所補修成功',error_point:'',next_action:'FIXTURE: 遅延保持を確認する',contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,source_attempt_id:c.sourceAttemptId,generated_from_review_id:task.id,source_review_id:task.id,review_scope:c.reviewScope,target_kind:c.targetKind,learning_purpose:c.learningPurpose,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 対象成功'}))};
 const result=await localPost('/api/import',{updates:[success]});const saved=await db.attempts.get(result.savedAttemptIds[0]);assert.notEqual(saved.mark,'◎');assert.equal(saved.exam_score_eligible,false);
 console.log('later repair',JSON.stringify({id:saved.id,mark:saved.mark,purpose:saved.learning_purpose,outcome:saved.review_outcome,ref:saved.actual_reference_level,confidence:saved.grading_confidence,valid:saved.policy_validity,excluded:saved.exclude_from_planning,parts:saved.graded_findings,review:(await db.reviews.toArray()).filter(r=>r.problem_id===input.problem_id&&r.status==='pending').map(r=>({id:r.id,purpose:r.learning_purpose,source:r.source_attempt_id}))}));
 assert.ok((await db.reviews.toArray()).some(r=>r.problem_id===input.problem_id&&r.status==='pending'&&(r.learning_purpose||r.grading_contract?.learningPurpose)==='retrieval_check'));
 const delayed=(await db.reviews.toArray()).find(r=>r.problem_id===input.problem_id&&r.status==='pending'&&r.learning_purpose==='retrieval_check');
 t.mock.timers.setTime(Date.parse(`${delayed.earliest_date||delayed.due_date}T12:00:00Z`));
 const dc=delayed.grading_contract,err=dc.gradedParts[0].allowedErrorTypes.find(e=>e!=='none'&&e!=='K');assert.ok(err);
 const lapse={...success,submission_id:'later-retention-failure',date:(await localGet('/api/bootstrap')).dashboard.today,mode:dc.mode,score_numeric:55,score_label:'B',error_type:err,error_types:[err],contract_id:dc.contractId,contract_hash:dc.contractHash,contract_version:dc.contractVersion,source_attempt_id:dc.sourceAttemptId,source_review_id:delayed.id,generated_from_review_id:delayed.id,review_scope:dc.reviewScope,target_kind:dc.targetKind,learning_purpose:dc.learningPurpose,assessment_timing:'delayed_retrieval',target_issue_resolved:false,minimum_pass_condition_met:false,review_outcome:'failure',error_point:'FIXTURE: 遅延保持で再現できない',next_action:'FIXTURE: 未解消targetだけを再補修する',graded_part_ids:dc.gradedParts.map(p=>p.id),graded_findings:dc.gradedParts.map((p,i)=>({graded_part_id:p.id,error_type:i?'none':err,resolved:!!i,evidence:'FIXTURE: 保持失敗'}))};
 const lapseReceipt=await localPost('/api/import',{updates:[lapse]});const newRepair=(await db.reviews.toArray()).find(r=>r.problem_id===input.problem_id&&r.status==='pending'&&r.source_attempt_id===lapseReceipt.savedAttemptIds[0]);assert.ok(newRepair);
 t.mock.timers.setTime(Date.parse(`${newRepair.earliest_date||newRepair.due_date}T12:00:00Z`));const failedState=await localGet('/api/bootstrap');
 assert.ok(failedState.today.tasks.some(t=>!t.checked&&t.problem_id===input.problem_id&&(t.source_attempt_id===lapseReceipt.savedAttemptIds[0]||t.grading_contract?.sourceAttemptId===lapseReceipt.savedAttemptIds[0])),'a later valid retention failure must not be suppressed by an older repair success');
});
