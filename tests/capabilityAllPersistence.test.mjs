import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {projectCapabilityMap} from '../src/capabilityEvidence.ts';

test('a 75-operation initial evaluation previews and saves atomically, once, without changing learning originals',async()=>{
 await localGet('/api/bootstrap');await db.attempts.bulkPut(capabilityFacts().attempts);
 const before=await exportBackup(),c=await localGet('/api/capabilities/context?initial=1&domain=all&batch=0'),w=capabilityWire(c);
 const evaluated=w.evaluations[0];w.evaluations=c.scope.abilityIds.map(ability_id=>ability_id===evaluated.ability_id?evaluated:{...evaluated,ability_id,state:'unconfirmed',certainty:'provisional',evidence:[],next_check:null});
 const invalid=structuredClone(w);invalid.evaluations.at(-1).evidence=[{...evaluated.evidence[0],part_ids:['not-a-graded-part']}];
 await assert.rejects(()=>localPost('/api/capabilities/save',{text:JSON.stringify(invalid),confirmed:true}),/採点項目/);
 assert.equal((await exportBackup()).source_manifest.data_hash,before.source_manifest.data_hash);
 const text=JSON.stringify(w),preview=await localPost('/api/capabilities/preview',{text});assert.equal(preview.record.items.length,75);
 assert.equal((await exportBackup()).source_manifest.data_hash,before.source_manifest.data_hash);
 const result=await localPost('/api/capabilities/save',{text,confirmed:true});assert.equal(result.duplicate,false);
 const duplicate=await localPost('/api/capabilities/save',{text,confirmed:true});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.record.id,result.record.id);
 const exported=await exportBackup();for(const [key,rows] of Object.entries(before).filter(([k,v])=>k!=='meta'&&Array.isArray(v)))assert.deepEqual(exported[key],rows,key);
 assert.equal(exported.meta.length,before.meta.length+2);
 const pre=await previewBackupRestore(exported);await restoreBackup(exported,{mode:'original',sourceHash:pre.manifest.data_hash});db.close();await db.open();
 assert.equal((await exportBackup()).source_manifest.data_hash,exported.source_manifest.data_hash);
 const data=await localGet('/api/bootstrap'),map=projectCapabilityMap(data,data.capabilityRecords);assert.equal(map.counts.immediate_confirmed,1);assert.equal(map.counts.unconfirmed,74);
});
