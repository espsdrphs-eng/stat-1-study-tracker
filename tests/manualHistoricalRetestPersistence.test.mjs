import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {buildPastExamYearCandidates} from '../src/pastExamPlanning.ts';
let sessionId;

test('a manual 2025 session starts only after confirmation, resumes once, and preserves existing grades and Planner protection',async()=>{
 const before=await localGet('/api/bootstrap'),original=await exportBackup();
 const body={year:2025,selectedQuestionNumbers:[1,2,3]};
 await assert.rejects(()=>localPost('/api/past-sessions/start',body),/保護|前提/);
 await assert.rejects(()=>localPost('/api/past-sessions/start',{...body,year:2024,confirmHistoricalRetest:true}),/保護|前提/);
 const receipt=await localPost('/api/past-sessions/start',{...body,confirmHistoricalRetest:true});
 sessionId=receipt.id??receipt.sessionId;
 assert.ok(sessionId);const saved=await db.pastSessions.get(sessionId);
 assert.equal(saved.year,2025);assert.equal(saved.past_exam_year_role,'historical_retest');assert.equal(saved.scan_evidence_kind,'practice');assert.equal(saved.exposure_snapshot_at_start.classification,'practice');
 assert.deepEqual(saved.initial_selected_problem_ids,['PY-2025-Q1','PY-2025-Q2','PY-2025-Q3']);
 assert.match(saved.selected_year_reason,/利用者|再演習/);assert.ok(saved.prompt_scanned_at);
 const again=await localPost('/api/past-sessions/start',{...body,confirmHistoricalRetest:true});assert.equal(again.sessionId,sessionId);assert.equal(again.resumed,true);
 const after=await localGet('/api/bootstrap');
 for(const key of ['attempts','reviews','weakNotes','problems'])assert.deepEqual((await exportBackup())[key],original[key]);
 for(const old of original.pastSessions)assert.deepEqual(await db.pastSessions.get(old.id),old);
 assert.deepEqual(after.dashboard.readiness.evidence,before.dashboard.readiness.evidence);
 const candidates=buildPastExamYearCandidates({catalog:after.adaptiveLearning.pastExamCatalog,attempts:after.attempts,pastSessions:after.pastSessions,today:after.dashboard.today,daysRemaining:after.dashboard.pace.daysRemaining});
 assert.equal(candidates.some(c=>c.year===2025),false,'manual consent does not globally release the automatic year gate');
 assert.equal(after.adaptiveLearning.pastExamCatalog.find(p=>p.canonicalProblemId==='PY-2024-Q1').simulationProtected,true);
});

test('manual 2025 finish, grading contract and export/restore remain linked without inventing a score',async()=>{
 assert.ok(sessionId,'manual start must succeed first');
 const ids=['PY-2025-Q1','PY-2025-Q2','PY-2025-Q3'];
 await localPost(`/api/past-sessions/${sessionId}/grading`,{action:'finish',answeredProblemIds:ids,totalMinutes:90});
 const p=await localPost(`/api/past-sessions/${sessionId}/grading`,{action:'prompt',problemId:ids[0]});
 assert.equal(p.sessionId,sessionId);assert.match(p.prompt,/PY-2025-Q1/);assert.ok(p.contract.contractId);
 const session=await db.pastSessions.get(sessionId),backup=await exportBackup();
 assert.equal(session.exam_score_eligible,false);assert.equal(session.selected_answer_count??0,0);
 const preview=await previewBackupRestore(backup);await restoreBackup(backup,{mode:'original',sourceHash:preview.manifest.data_hash});db.close();await db.open();assert.deepEqual(await db.pastSessions.get(sessionId),session);
 assert.equal((await localPost(`/api/past-sessions/${sessionId}/grading`,{action:'prompt',problemId:ids[0]})).prompt,p.prompt);
 assert.deepEqual((await exportBackup()).attempts,backup.attempts);
});
