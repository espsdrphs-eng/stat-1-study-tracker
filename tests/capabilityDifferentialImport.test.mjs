import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {capabilityCatalog} from '../src/capabilityCatalog.ts';
import {buildCapabilityContext,capabilityFactsSignature,planCapabilityImport,prepareCapabilityUpdate,projectCapabilityMap} from '../src/capabilityEvidence.ts';

const all='/api/capabilities/context?initial=1&domain=all';
const preview=text=>localPost('/api/capabilities/preview',{text});
const save=(text,confirmationToken)=>localPost('/api/capabilities/save',{text,confirmed:true,confirmationToken});
const blank=(ability_id,judgement='評価根拠がなく未確認')=>({ability_id,state:'unconfirmed',certainty:'provisional',judgement,first_error:null,evidence:[],next_check:null});

test('legacy all-domain JSON remains usable after one saved ability; only the safe subset is stored',async()=>{
 await localGet('/api/bootstrap');await db.attempts.bulkPut(capabilityFacts().attempts);
 const facts={problems:await db.problems.toArray(),attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),pastSessions:await db.pastSessions.toArray(),weakNotes:await db.weakNotes.toArray(),records:[]};
 const before=await exportBackup(),c=await localGet(all),old=capabilityWire({...c,version:'capability-context:iall:'+createHash('sha256').update(capabilityFactsSignature(facts)).digest('hex')});
 const overlap=old.evaluations[0].ability_id,first=capabilityWire(c,{judgement:'既に確認・保存した評価'});
 old.evaluations=c.scope.abilityIds.map(ability_id=>ability_id===overlap?old.evaluations[0]:blank(ability_id));
 const raw=JSON.stringify(old),firstRaw=JSON.stringify(first);
 await save(firstRaw,(await preview(firstRaw)).confirmationToken);
 const p=await preview(raw);
 assert.equal(p.entries.filter(e=>e.status==='ready').length,74);
 assert.deepEqual(p.entries.filter(e=>e.status==='conflict').map(e=>e.abilityId),[overlap]);
 assert.match(p.entries.find(e=>e.abilityId===overlap).reason,/保存|変更/);
 assert.equal(p.record.wire.context_version,old.context_version,'do not rebase the wire by replacing its hash');
 assert.equal(p.record.items.length,74);
 const afterPreview=await exportBackup();await assert.rejects(()=>save(raw,'unconfirmed-plan'),/プレビュー/);
 assert.equal((await exportBackup()).source_manifest.data_hash,afterPreview.source_manifest.data_hash);
 const receipt=await save(raw,p.confirmationToken);assert.equal(receipt.record.items.length,74);
 const exported=await exportBackup();for(const [key,rows] of Object.entries(before).filter(([k,v])=>k!=='meta'&&Array.isArray(v)))assert.deepEqual(exported[key],rows,key);
 const pre=await previewBackupRestore(exported);await restoreBackup(exported,{mode:'original',sourceHash:pre.manifest.data_hash});db.close();await db.open();
 assert.equal((await exportBackup()).source_manifest.data_hash,exported.source_manifest.data_hash);
 const retry=await preview(raw);assert.equal(retry.entries.filter(e=>e.status==='saved').length,74);assert.equal(retry.entries.filter(e=>e.status==='conflict').length,1);
 assert.equal((await save(raw,retry.confirmationToken)).duplicate,true);
 assert.equal((await exportBackup()).source_manifest.data_hash,exported.source_manifest.data_hash);
 const data=await localGet('/api/bootstrap'),map=projectCapabilityMap(data,data.capabilityRecords);
 assert.deepEqual(map.abilities.map(a=>a.id),capabilityCatalog.map(a=>a.id));assert.equal(map.counts.unconfirmed,74);
 assert.equal(map.abilities.find(a=>a.id===overlap).current.item.judgement,'既に確認・保存した評価');
 assert.equal((await localGet('/api/gpt-exchanges')).filter(r=>r.rawText===raw).length,1);
});

test('an error-repair attempt without a recorded closed-reference reproduction cannot be relabelled as immediate confirmation',async()=>{
 const f=capabilityFacts();Object.assign(f.attempts[1],{learning_purpose:'error_repair',assessment_timing:'same_session_correction'});
 const w=capabilityWire(await buildCapabilityContext(f));
 let r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(r.items[0].effectiveState,'unconfirmed');
 f.attempts[1].reference_closed_reproduction=true;w.context_version=(await buildCapabilityContext(f)).version;
 r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(r.items[0].effectiveState,'immediate_confirmed');
});

test('revision requests verify a nonempty baseline across unrelated saves, without changing an omitted ability',async()=>{
 const f=capabilityFacts(),allScope={initial:true,domainId:'all'},c=await buildCapabilityContext(f,undefined,allScope);
 f.records=[await prepareCapabilityUpdate(JSON.stringify(capabilityWire(c)),f)];
 const request=await buildCapabilityContext(f,undefined,allScope),untouched=f.records[0].items[0].ability_id;
 const overlap='cross.request-to-math',ready='cross.complete-derivation',later=capabilityWire(request);
 later.evaluations=[blank(overlap,'後から保存した評価')];
 f.records.push(await prepareCapabilityUpdate(JSON.stringify(later),f));
 // Restore/key iteration order need not match creation order.
 f.records.reverse();
 const candidate=capabilityWire(request);candidate.evaluations=[blank(overlap),blank(ready)];
 const raw=JSON.stringify(candidate),p=await planCapabilityImport(raw,f);
 assert.deepEqual(p.entries.map(e=>e.status),['conflict','ready']);
 assert.deepEqual(p.record.items.map(e=>e.ability_id),[ready]);
 const map=projectCapabilityMap(f,[...f.records,p.record]);assert.equal(map.abilities.find(a=>a.id===untouched).state,'immediate_confirmed');
 const retry=await buildCapabilityContext(f,undefined,p.recoveryScope);
 assert.deepEqual(JSON.parse(retry.prompt.split('保存済み証拠：\n')[1]).operation_catalog.map(a=>a.id),[overlap]);
 assert.match(retry.prompt,/最大1能力|旧JSONの context_version だけを差し替えない/);
 candidate.context_version=request.version.replace('iall:','');
 assert.ok((await planCapabilityImport(JSON.stringify(candidate),f)).entries.every(e=>e.status==='conflict'),'changing scope does not prove request identity');
 f.reviews.push({id:98,problem_id:'PY-2018-Q5',status:'done'});
 const changed=await planCapabilityImport(raw,f);assert.equal(changed.record,null);assert.ok(changed.entries.every(e=>/依頼時点の状態を照合できません/.test(e.reason)));
});

test('a fresh request cannot overwrite on equal timestamps or replace supported evidence with an empty claim',async()=>{
 const f=capabilityFacts();f.records=[await prepareCapabilityUpdate(JSON.stringify(capabilityWire(await buildCapabilityContext(f))),f)];
 const w=capabilityWire(await buildCapabilityContext(f),{judgement:'同じ日時の別の判断'});
 assert.match((await planCapabilityImport(JSON.stringify(w),f)).entries[0].reason,/同じ日時/);
 w.evaluated_at='2026-11-11T11:00:00+09:00';w.evaluations=[blank(w.evaluations[0].ability_id)];
 const p=await planCapabilityImport(JSON.stringify(w),f);assert.equal(p.record,null);assert.match(p.entries[0].reason,/根拠答案/);
});
