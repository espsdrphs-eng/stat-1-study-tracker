import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';import yaml from 'js-yaml';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');
test('ended session can retrieve bound grading after reload and saves exactly once through the common import',async()=>{
 await localGet('/api/bootstrap');const year=2019,id=8801,ids=[1,2,3].map(q=>`PY-${year}-Q${q}`);
 await db.pastSessions.put({id,year,date:'2026-10-16',session_type:'scan5',session_kind:'selected_three_timed',session_instance_id:'session-fixture-8801',session_ordinal:1,session_purpose:'timed_three_question_session',stable_session_key:`past_exam_session:${year}:timed_three_question_session:session-fixture-8801`,scan_minutes:10,initial_selected_problem_ids:ids,questions:Array.from({length:5},(_,i)=>({problemId:`PY-${year}-Q${i+1}`,questionLabel:`問${i+1}`,selected:i<3,completed:false,actualScore:null})),exposure_snapshot_at_start:{classification:'practice',exposed_problem_ids:ids,total_problem_count:5,captured_at:'2026-10-16T00:00:00Z'}});
 const call=b=>localPost(`/api/past-sessions/${id}/grading`,b);
 await assert.rejects(()=>call({action:'prompt',problemId:ids[0]}),/終了/);
 await call({action:'finish',answeredProblemIds:ids,totalMinutes:90});
 const prompt=(await call({action:'prompt',problemId:ids[0]})).prompt;
 const {parseStudyText}=await import('../src/importParser.ts');
 const u=[...prompt.matchAll(/```yaml\s*([\s\S]*?)```/g)].map(m=>yaml.load(m[1])).find(v=>v?.study_update).study_update;
 Object.assign(u,{score_numeric:60,score_max:100,score_text:'60/100',error_types:['W'],primary_error_type:'W',grading_confidence:.99,error_point:'FIXTURE: 結論の計算が未完了',next_action:'FIXTURE: 対象計算を補修',actual_minutes:null,time_minutes:null});u.graded_findings=u.graded_findings.map(f=>({...f,error_type:f.graded_part_id==='major_calculation'?'W':'none',resolved:f.graded_part_id!=='major_calculation',evidence:'FIXTURE: 答案の計算を確認'}));
 const updates=parseStudyText(JSON.stringify({study_update:u}),await db.problems.toArray()).updates;const wrong=structuredClone(updates);wrong[0].problem_id=`PY-${year}-Q4`;await assert.rejects(()=>localPost('/api/import',{updates:wrong}),/コンテキスト|session|対象|契約/i);
 const saved=await localPost('/api/import',{updates}),again=await localPost('/api/import',{updates});assert.deepEqual(saved.savedAttemptIds,again.savedAttemptIds);assert.equal(again.replayed,true);
 const a=await db.attempts.get(saved.savedAttemptIds[0]);assert.equal(a.parent_past_session_id,id);assert.equal(a.session_role,'selected_timed');assert.equal(a.learning_purpose,'exam_performance');assert.equal(a.time_minutes,null);
 const p2=(await call({action:'prompt',problemId:ids[0]})).prompt;assert.equal(p2,prompt);
 const b=await exportBackup();await restoreBackup(b);assert.deepEqual(await db.attempts.get(a.id),a);assert.equal((await call({action:'prompt',problemId:ids[0]})).prompt,prompt);
 await assert.rejects(()=>call({action:'prompt',problemId:`PY-${year}-Q5`}),/対象/);
});
test('a merely planned protected session cannot be finished to bypass the unseen-year gate',async()=>{
 const id=8802,year=2024,ids=[1,2,3].map(q=>`PY-${year}-Q${q}`);await db.pastSessions.put({id,year,date:'2026-10-16',session_type:'scan5',session_kind:'selected_three_timed',session_state:'planned',initial_selected_problem_ids:ids,questions:Array.from({length:5},(_,i)=>({problemId:`PY-${year}-Q${i+1}`,questionLabel:`問${i+1}`,selected:i<3,completed:false,actualScore:null}))});
 await assert.rejects(()=>localPost(`/api/past-sessions/${id}/grading`,{action:'finish',answeredProblemIds:ids,totalMinutes:90}),/保護|前提/);
 assert.equal((await db.pastSessions.get(id)).answer_finished_at,undefined);
});

test('actual session prompt full_answer alias YAML saves once without converting exam purpose into repair and survives restore',async()=>{
 const id=8810,year=2018,ids=[1,2,3].map(q=>`PY-${year}-Q${q}`);
 await db.pastSessions.put({id,year,date:'2026-10-16',session_type:'scan5',session_kind:'selected_three_timed',session_instance_id:'session-alias-fixture',scan_minutes:10,prompt_scanned_at:'2026-10-16T01:00:00Z',initial_selected_problem_ids:ids,questions:Array.from({length:5},(_,i)=>({problemId:`PY-${year}-Q${i+1}`,questionLabel:`問${i+1}`,selected:i<3,completed:false,actualScore:null}))});
 await localPost(`/api/past-sessions/${id}/grading`,{action:'finish',answeredProblemIds:ids,totalMinutes:90});
 const prompt=(await localPost(`/api/past-sessions/${id}/grading`,{action:'prompt',problemId:ids[0]})).prompt;
 const u=[...prompt.matchAll(/```yaml\s*([\s\S]*?)```/g)].map(m=>yaml.load(m[1])).find(v=>v?.study_update).study_update;
 Object.assign(u,{target_kind:'full_answer',score_numeric:55,score_text:'55/100',error_types:['W'],primary_error_type:'W',grading_confidence:.99,error_point:'FIXTURE: 結論未完',next_action:'FIXTURE: 局所補修'});u.task_context.target_kind='full_answer';u.graded_findings=u.graded_findings.map(f=>({...f,error_type:f.graded_part_id==='major_calculation'?'W':'none',resolved:f.graded_part_id!=='major_calculation',evidence:'FIXTURE: 今回答案の証拠'}));
 const text=yaml.dump({study_update:u}),updates=(await import('../src/importParser.ts')).parseStudyText(text,await db.problems.toArray()).updates;
 const bad=structuredClone(updates);bad[0].contract_hash='gc-wrong';await assert.rejects(()=>localPost('/api/import',{updates:bad}),/一致|契約/);
 const before=await db.attempts.count(),saved=await localPost('/api/import',{updates}),again=await localPost('/api/import',{updates});assert.equal(await db.attempts.count(),before+1);assert.deepEqual(saved.savedAttemptIds,again.savedAttemptIds);
 const a=await db.attempts.get(saved.savedAttemptIds[0]);assert.equal(a.learning_purpose,'exam_performance');assert.equal(a.review_scope,'full_answer');assert.equal(a.target_kind,undefined);assert.equal(a.parent_past_session_id,id);
 const exportCopy=await exportBackup();await restoreBackup(exportCopy);assert.deepEqual(await db.attempts.get(a.id),a);
});
