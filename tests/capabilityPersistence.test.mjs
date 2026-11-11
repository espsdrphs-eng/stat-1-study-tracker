import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';

test('ability preview and atomic save keep initial grades, Review, history and formal scores exact',async()=>{
 await localGet('/api/bootstrap');const f=capabilityFacts();await db.attempts.bulkPut(f.attempts);
 const before=await exportBackup(),ctx=await localGet('/api/capabilities/context'),text=JSON.stringify(capabilityWire(ctx));
 const preview=await localPost('/api/capabilities/preview',{text});assert.equal(preview.record.items[0].effectiveState,'immediate_confirmed');
 assert.equal((await exportBackup()).source_manifest.data_hash,before.source_manifest.data_hash,'preview must not write; export timestamps are not source data');
 await assert.rejects(()=>localPost('/api/capabilities/save',{text}),/確認/);
 const fail=(key,row)=>{if(row.key.startsWith('gpt-exchange:v1:'))throw new Error('fixture storage failure')};db.meta.hook('creating',fail);
 try{await assert.rejects(()=>localPost('/api/capabilities/save',{text,confirmed:true}),/storage failure/)}finally{db.meta.hook('creating').unsubscribe(fail)}
 assert.equal((await exportBackup()).source_manifest.data_hash,before.source_manifest.data_hash,'a failed raw archive must roll back the evaluation too');
 const [saved,again]=await Promise.all([localPost('/api/capabilities/save',{text,confirmed:true}),localPost('/api/capabilities/save',{text,confirmed:true})]);
 assert.equal(saved.record.id,again.record.id);assert.notEqual(saved.duplicate,again.duplicate);
 const result=await exportBackup();for(const key of ['problems','attempts','reviews','weakNotes','sMemory','pastSessions'])assert.deepEqual(result[key],before[key]);
 assert.equal((await localGet('/api/gpt-exchanges')).filter(r=>r.rawText===text).length,1);
 assert.equal((await localGet('/api/capabilities/records')).records.length,1);
 assert.equal((await localGet('/api/bootstrap')).capabilityRecords.length,1);
});
test('a GPT capability proposal reuses one existing transfer generation contract and keeps the map unchanged',async()=>{
 const before=await exportBackup();
 const a=await localPost('/api/transfer-training',{action:'begin-ability',capabilityId:'distributions.expectation-variance'});
 const b=await localPost('/api/transfer-training',{action:'begin-ability',capabilityId:'distributions.expectation-variance'});
 assert.equal(a.key,b.key);
 const record=JSON.parse((await db.meta.get('transfer-generation:'+a.key)).value);
 assert.equal(record.lineage.capabilityEvaluation.abilityId,'distributions.expectation-variance');
 assert.ok(record.lineage.capabilityEvaluation.evaluationId);
 assert.equal(record.lineage.sourceAttemptId,2);assert.equal(record.status,'requested');assert.deepEqual(record.rounds,[]);
 assert.equal(record.generation_context.ability_id,'distributions.expectation-variance');
 const after=await exportBackup();for(const k of ['attempts','reviews','weakNotes','pastSessions','problems'])assert.deepEqual(after[k],before[k]);
 assert.deepEqual(after.meta.filter(m=>m.key.startsWith('capability-evaluation:')),before.meta.filter(m=>m.key.startsWith('capability-evaluation:')));
 await assert.rejects(()=>localPost('/api/transfer-training',{action:'begin-ability',capabilityId:'cross.unknown'}),/確認|根拠/);
});
test('reload, exact original restore and later source edits do not lose or silently certify ability evidence',async()=>{
 const before=await exportBackup(),pre=await previewBackupRestore(before);
 await restoreBackup(before,{mode:'original',sourceHash:pre.manifest.data_hash});db.close();await db.open();
 const restored=await exportBackup();for(const key of ['attempts','reviews','weakNotes','pastSessions','problems'])assert.deepEqual(restored[key],before[key]);
 assert.deepEqual((await localGet('/api/capabilities/records')).records.map(r=>r.id),before.meta.filter(r=>r.key.startsWith('capability-evaluation:v1:')).map(r=>JSON.parse(r.value).id));
 const ctx=await localGet('/api/capabilities/context'),wire=capabilityWire(ctx);wire.evaluated_at='2026-11-11T11:00:00+09:00';
 await db.attempts.update(2,{score_numeric:99});await assert.rejects(()=>localPost('/api/capabilities/save',{text:JSON.stringify(wire),confirmed:true}),/更新|対象/);
 const stored=await localGet('/api/capabilities/records'),{projectCapabilityMap}=await import('../src/capabilityEvidence.ts');
 const view=projectCapabilityMap({problems:await db.problems.toArray(),attempts:await db.attempts.toArray()},stored.records);
 assert.equal(view.counts.immediate_confirmed,0);assert.ok(view.abilities.find(a=>a.current).warnings.length);
});
