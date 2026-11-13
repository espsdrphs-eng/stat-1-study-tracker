import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {capabilityCatalog} from '../src/capabilityCatalog.ts';
import {buildCapabilityContext,CAPABILITY_RECORD_PREFIX,canonicalValue,parseCapabilityUpdate,planCapabilityImport,prepareCapabilityUpdate,projectCapabilityMap,readCapabilityRecords} from '../src/capabilityEvidence.ts';

const all={initial:true,domainId:'all'},ctx=f=>buildCapabilityContext(f,undefined,all);
const blank=(ability_id,judgement='追加の確認なし')=>({ability_id,state:'unconfirmed',certainty:'provisional',judgement,first_error:null,evidence:[],next_check:null});
const evidence=(attempt_id,outcome,kind='diagnostic',baseline_attempt_id=null,part_ids=['major_calculation'])=>({attempt_id,outcome,kind,baseline_attempt_id,part_ids,observation:'FIXTURE: 対象操作の採点記録'});
const claim=(ability_id,state,rows,judgement='FIXTURE: 操作を明示的に対応づけた評価')=>({...blank(ability_id,judgement),state,certainty:'confirmed',evidence:rows});
const wire=(c,evaluations,hour=10)=>JSON.stringify({...capabilityWire(c),evaluated_at:`2026-11-11T${hour}:00:00+09:00`,evaluations});
const abilityId='distributions.expectation-variance';

test('39 stored operations survive sparse 2 and 11-row imports, duplicate, reload and backup restore',async()=>{
 await localGet('/api/bootstrap');await db.attempts.bulkPut(capabilityFacts().attempts);
 const before=await exportBackup(),context=()=>localGet('/api/capabilities/context?initial=1&domain=all');
 const preview=text=>localPost('/api/capabilities/preview',{text});
 const save=(text,p)=>localPost('/api/capabilities/save',{text,confirmed:true,confirmationToken:p.confirmationToken});
 const map=async()=>{const d=await localGet('/api/bootstrap');return projectCapabilityMap(d,d.capabilityRecords);};
 const ids=[abilityId,...capabilityCatalog.map(c=>c.id).filter(id=>id!==abilityId)].slice(0,39),initial=wire(await context(),ids.map((id,i)=>i===0?claim(id,'unrepaired',[evidence(1,'failure')]):blank(id)));
 await save(initial,await preview(initial));const start=await map();assert.equal(start.metrics.historyOperations,39);assert.equal(start.metrics.directEvidenceOperations,1);assert.equal(start.counts.unrepaired,1);
 const changes=async(size,hour)=>{
  const input=wire(await context(),ids.slice(1,size+1).map(id=>blank(id,`別途確認した所見 ${hour}`)),hour),p=await preview(input);
  assert.equal(p.summary.updated,size);assert.equal(p.summary.maintained,39-size);assert.equal(p.summary.before.historyOperations,39);assert.equal(p.summary.after.historyOperations,39);
  assert.equal(p.summary.after.determinedOperations,1);await save(input,p);
  const again=await preview(input);assert.equal(again.summary.duplicate,size);assert.equal((await save(input,again)).duplicate,true);
 };
 await changes(2,11);await changes(11,12);
 const saved=await exportBackup();for(const [key,rows] of Object.entries(before).filter(([k,v])=>k!=='meta'&&Array.isArray(v)))assert.deepEqual(saved[key],rows,key);
 const snapshot=await map();assert.equal(snapshot.metrics.historyRows,52);assert.deepEqual(snapshot.abilities.filter(a=>a.current).map(a=>a.id).sort(),[...ids].sort());assert.equal(snapshot.abilities.find(a=>a.id===abilityId).current.record.id,start.abilities.find(a=>a.id===abilityId).current.record.id);
 const pre=await previewBackupRestore(saved);await restoreBackup(saved,{mode:'original',sourceHash:pre.manifest.data_hash});db.close();await db.open();
 const restored=await map();assert.deepEqual(restored.metrics,snapshot.metrics);assert.deepEqual(restored.counts,snapshot.counts);assert.equal((await exportBackup()).source_manifest.data_hash,saved.source_manifest.data_hash);
 assert.equal(Object.values(restored.counts).reduce((n,x)=>n+x,0),75);
});

test('an unconfirmed, non-decisive annotation keeps an earlier supported state and every linked observation',async()=>{
 const f=capabilityFacts(),old=await prepareCapabilityUpdate(wire(await ctx(f),[claim(abilityId,'unrepaired',[evidence(1,'failure')])]),f);
 f.records=[old];const pending={...blank(abilityId,'新しい状態の判断はしていない'),evidence:[evidence(3,'uncertain')]};
 f.records.push(await prepareCapabilityUpdate(wire(await ctx(f),[pending],11),f));
 const a=projectCapabilityMap(f).abilities.find(x=>x.id===abilityId);assert.equal(a.current.item.state,'unconfirmed');assert.equal(a.state,'unrepaired');assert.equal(a.stateSource.record.id,old.id);assert.deepEqual(a.directEvidence.map(e=>e.attempt.id),[1]);assert.equal(a.history.length,2);
});

test('assisted diagnostic success stays visible, but is not a stage gate on a later explicit failure',async()=>{
 const f=capabilityFacts();f.attempts[1].actual_reference_level=2;f.attempts[1].hint_used=true;
 f.attempts.push({...f.attempts[0],id:4,problem_id:'PY-2024-Q3',date:'2026-11-09'});
 const e=claim(abilityId,'unrepaired',[evidence(2,'success'),evidence(4,'failure'),evidence(4,'failure')]);
 f.records=[await prepareCapabilityUpdate(wire(await ctx(f),[e]),f)];
 const map=projectCapabilityMap(f),a=map.abilities.find(x=>x.id===abilityId);assert.equal(a.state,'unrepaired');assert.deepEqual(a.directEvidence.map(e=>[e.attempt.id,e.outcomes]),[[4,['failure']],[2,['success']]]);assert.equal(map.metrics.directEvidenceOperations,1);
});

test('unresolved none and unsupported success are not direct proof, but certainty alone is not a mastery stage',async()=>{
 const f=capabilityFacts();f.attempts[0].graded_findings[0].error_type='none';
 const e=claim(abilityId,'unrepaired',[evidence(1,'failure')]);f.records=[await prepareCapabilityUpdate(wire(await ctx(f),[e]),f)];
 const a=projectCapabilityMap(f).abilities.find(x=>x.id===abilityId);assert.equal(a.state,'unconfirmed');assert.equal(a.directEvidence.length,0);
});

test('preview rejects nonexistent and later baseline IDs with the exact ability, without silently discarding other changes',async()=>{
 const f=capabilityFacts(),c=await ctx(f),bad=claim(abilityId,'unrepaired',[evidence(1,'failure','diagnostic',3)]);
 const p=await planCapabilityImport(wire(c,[bad,blank('cross.request-to-math')]),f);
 assert.deepEqual(p.entries.map(e=>e.status),['rejected','ready']);assert.equal(p.entries[0].abilityId,abilityId);assert.match(p.entries[0].reason,/baseline_attempt_id.*#3/);assert.equal(p.summary.after.historyOperations,0);
 bad.evidence[0].baseline_attempt_id=99999;
 const missing=await planCapabilityImport(wire(c,[bad]),f);assert.equal(missing.entries[0].status,'rejected');assert.match(missing.entries[0].reason,/baseline_attempt_id.*#99999/);
});

test('the same generic grade slot in a different scoped contract is not automatically a contradiction',async()=>{
 const f=capabilityFacts(),success=f.attempts[1],later={...f.attempts[0],id:4,date:'2026-11-09'};
 const contract=(key)=>({gradedParts:[{id:'major_calculation',stableTargetKey:key}]});
 success.grading_contract=contract('bound-target-A');later.grading_contract=contract('bound-target-B');f.attempts.push(later);
 const w=()=>claim(abilityId,'immediate_confirmed',[evidence(2,'success','immediate_reproduction',1)]);
 let r=await prepareCapabilityUpdate(wire(await ctx(f),[w()]),f);assert.equal(r.items[0].effectiveState,'immediate_confirmed');
 later.grading_contract=contract('bound-target-A');r=await prepareCapabilityUpdate(wire(await ctx(f),[w()]),f);assert.equal(r.items[0].effectiveState,'unconfirmed');assert.match(r.items[0].warnings.join(),/同じ対象範囲/);
});

test('a device clock change does not hide a previously saved evaluation; new future imports still fail',async()=>{
 const f=capabilityFacts(),raw=wire(await ctx(f),[claim(abilityId,'unrepaired',[evidence(1,'failure')])]);
 const record=await prepareCapabilityUpdate(raw,f),clock=Date.now;
 try{Date.now=()=>Date.parse('2026-11-10T12:00:00+09:00');
  assert.throws(()=>parseCapabilityUpdate(raw),/未来/);
  const saved=readCapabilityRecords([{key:CAPABILITY_RECORD_PREFIX+record.id,value:JSON.stringify(record)}]);assert.deepEqual(saved.issues,[]);assert.equal(saved.records.length,1);
 }finally{Date.now=clock;}
});

test('a stored quality warning for one generated source does not erase a separately validated observation',async()=>{
 const f=capabilityFacts(),e=claim(abilityId,'delayed_transfer_confirmed',[evidence(1,'failure'),evidence(3,'success','delayed_transfer',1)]);
 const r=await prepareCapabilityUpdate(wire(await ctx(f),[e]),f);
 // Isolate the projection of two per-problem validation receipts from the
 // generated-problem producer (its real QA flow has separate E2E coverage).
 const good={...f.problems[0],source_type:'generated',generated_transfer:{content_hash:'fixture-valid',lifecycle_status:'graded'}};
 f.problems[0]=good;f.problems[2]={...f.problems[2],source_type:'generated'};
 r.generatedSources={[good.problem_id]:canonicalValue({content_hash:'fixture-valid'}),[f.problems[2].problem_id]:null};
 r.items[0].effectiveState='unconfirmed';
 r.items[0].warnings.push('生成問題の内容hash・独立品質確認を照合できません。問題不備は能力失敗として確定しません。');
 const {records,issues}=readCapabilityRecords([{key:CAPABILITY_RECORD_PREFIX+r.id,value:JSON.stringify(r)}]);assert.deepEqual(issues,[]);
 const a=projectCapabilityMap(f,records).abilities.find(a=>a.id===abilityId);assert.equal(a.state,'unconfirmed');assert.deepEqual(a.directEvidence.map(x=>x.attempt.id),[1]);
});
