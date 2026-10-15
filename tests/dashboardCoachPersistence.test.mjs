import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');
test('actual reassessment prompt → preview → save is evidence-bound, idempotent and never overwrites measured facts',async()=>{
 await localGet('/api/bootstrap');await db.attempts.put({id:9001,problem_id:'PY-2019-Q2',date:'2026-10-15',mode:'full',mark:'△',score_numeric:45,error_type:'W',error_types:['W'],actual_reference_level:0,policy_validity:'valid'});
 const b=await localGet('/api/bootstrap'),before=await exportBackup(),history=b.coach.history.length;
 const start=b.coach.prompt.lastIndexOf('\n{\n  "coach_update"');assert.ok(start>=0);
 const raw=JSON.parse(b.coach.prompt.slice(start+1)),u=raw.coach_update;
 // Use the actual current prompt shape, not a hand-corrected legacy reply.
 Object.assign(u,{reviewed_at:'2026-10-15T22:00:00+09:00',level:{value:3,readiness:'主要計算の補強',confidence:'medium',refs:['metric:selectedThree']},bottleneck:{text:'時間配分',refs:['metric:timed']},actions:[],improvements:[],unknowns:[]});
 const call=(action,text=JSON.stringify(raw))=>localPost(`/api/coach/${action}`,{text,require_current_evidence:true});
 await call('preview');assert.equal((await localGet('/api/bootstrap')).coach.history.length,history);
 const missing=structuredClone(raw);delete missing.coach_update.review_context_version;
 await assert.rejects(()=>call('preview',JSON.stringify(missing)),e=>e.stage==='schema'&&e.path==='coach_update.review_context_version');
 const wrong=structuredClone(raw);wrong.coach_update.bottleneck.refs=['attempt:999999999'];await assert.rejects(()=>call('save',JSON.stringify(wrong)),/証拠ID/);
 const wrongData=structuredClone(raw);wrongData.coach_update.data_version='changed-scope';await assert.rejects(()=>call('save',JSON.stringify(wrongData)),/データが更新/);
 await call('save');assert.equal((await call('save')).duplicate,true);
 let after=await localGet('/api/bootstrap');assert.equal(after.coach.history.length,history+1);assert.equal(after.coach.stale,false);assert.equal(after.coach.current.level.value,3);
 assert.equal(after.dashboard.kpis.assessment.level,b.dashboard.kpis.assessment.level);assert.deepEqual(after.dashboard.readiness,b.dashboard.readiness);
 for(const k of ['problems','attempts','reviews','weakNotes'])assert.deepEqual((await exportBackup())[k],before[k]);
 const old=await db.attempts.orderBy('id').last();
 assert.ok(old);await db.attempts.update(old.id,{score_numeric:(old.score_numeric||0)+1});await assert.rejects(()=>call('save'),/データが更新/);await db.attempts.put(old);
 const backup=await exportBackup();await restoreBackup(backup);after=await localGet('/api/bootstrap');assert.equal(after.coach.history.length,history+1);assert.equal(after.coach.current.level.value,3);
});
