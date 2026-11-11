import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {capabilityCatalog,capabilityDomains} from '../src/capabilityCatalog.ts';
import {buildCapabilityContext,prepareCapabilityUpdate} from '../src/capabilityEvidence.ts';

test('initial domain review includes old positive and negative evidence, not just latest N answers or raw note counts',async()=>{
 const f=capabilityFacts();
 for(let i=10;i<38;i++)f.attempts.push({...f.attempts[2],id:i,date:'2026-11-10',problem_id:'PY-2024-Q3'});
 f.weakNotes=[{id:1,generated_from_attempt_id:1,problem_id:'PY-2018-Q5',mistake:'同じ観察',correction_rule:'同じ観察'}, {id:2,generated_from_attempt_id:1,problem_id:'PY-2018-Q5',mistake:'同じ観察',correction_rule:'同じ観察'}];
 const before=JSON.stringify(f),c=await buildCapabilityContext(f,undefined,{initial:true,domainId:'distributions',batch:0});
 assert.equal(c.scope.initial,true);assert.equal(c.scope.abilityIds.length,11);
 assert.ok(c.eligibleAttemptIds.includes(1));assert.ok(c.eligibleAttemptIds.includes(2));
 const facts=JSON.parse(c.prompt.split('保存済み証拠：\n')[1]);
 assert.ok(facts.representative_answers.find(a=>a.id===1).observed_errors);
 assert.ok(facts.representative_answers.find(a=>a.id===2).assessed_parts.some(p=>p.resolved));
 const history=JSON.parse(c.historyAttachment.text);assert.equal(history.answers.length,f.attempts.length);
 assert.equal(history.note_observations.length,1);assert.deepEqual(history.note_observations[0].note_ids,[1,2]);
 assert.ok(facts.answer_index.some(a=>a.id===1));assert.ok(c.prompt.length<c.historyAttachment.text.length);
 assert.match(c.prompt,/最初の誤り.*未確定|最初の誤り.*推測/);
 assert.equal(JSON.stringify(f),before);
});

test('domain batches cover all 75 operation IDs, preserve the existing wire and reject out-of-batch classifications',async()=>{
 const f=capabilityFacts(),seen=new Set();
 for(const d of capabilityDomains){
  const count=capabilityCatalog.filter(c=>c.domainId===d.id).length;
  for(let batch=0;batch<Math.ceil(count/12);batch++){
   const c=await buildCapabilityContext(f,undefined,{initial:true,domainId:d.id,batch});
   assert.ok(c.scope.abilityIds.length<=12);c.scope.abilityIds.forEach(id=>seen.add(id));
   const schema=JSON.parse(c.prompt.split('\n').find(l=>l.startsWith('{"capability_update":')));assert.ok(c.scope.abilityIds.includes(schema.capability_update.evaluations[0].ability_id));
   const w=capabilityWire(c,{ability_id:c.scope.abilityIds[0],state:'unconfirmed',certainty:'provisional',evidence:[]});
   await prepareCapabilityUpdate(JSON.stringify(w),f);
   w.evaluations[0].ability_id=capabilityCatalog.find(a=>!c.scope.abilityIds.includes(a.id)).id;
   await assert.rejects(()=>prepareCapabilityUpdate(JSON.stringify(w),f),/分野|対象能力|今回/);
  }
 }
 assert.equal(seen.size,75);
});

test('a later contradictory scoped answer holds an older success, while unrelated parts do not',async()=>{
 const f=capabilityFacts();f.attempts.push({...f.attempts[1],id:4,date:'2026-11-09',graded_findings:[{graded_part_id:'major_calculation',resolved:false,error_type:'N',evidence:'最終分散を再び取り違えた'}]});
 let c=await buildCapabilityContext(f),r=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(c)),f);
 assert.equal(r.items[0].effectiveState,'unconfirmed');assert.match(r.items[0].warnings.join(),/新しい答案|後続/);
 f.attempts[3].graded_findings[0].graded_part_id='unrelated';
 c=await buildCapabilityContext(f);r=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(c)),f);
 assert.equal(r.items[0].effectiveState,'immediate_confirmed');
});

test('one initial request covers all 75 operations without splitting the history or certifying missing evidence',async()=>{
 const f=capabilityFacts(),c=await buildCapabilityContext(f,undefined,{initial:true,domainId:'all'});
 assert.equal(c.scope.batchCount,1);assert.equal(c.scope.abilityIds.length,75);
 const facts=JSON.parse(c.prompt.split('保存済み証拠：\n')[1]);
 assert.equal(new Set(facts.operation_catalog.map(a=>a.domain)).size,12);
 assert.equal(facts.history_attachment.sha256,c.historyAttachment.sha256);
 const w=capabilityWire(c);w.evaluations=c.scope.abilityIds.map(ability_id=>({...w.evaluations[0],ability_id,state:'unconfirmed',certainty:'provisional',evidence:[],next_check:null}));
 const result=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(result.items.length,75);assert.ok(result.items.every(e=>e.effectiveState==='unconfirmed'));
 assert.match(c.prompt,/最大75能力/);assert.doesNotMatch(c.prompt,/最大12能力/);
});

test('all-domain size is scoped to the current initial request and never bypasses evidence or duplicate-ID checks',async()=>{
 const f=capabilityFacts(),all=await buildCapabilityContext(f,undefined,{initial:true,domainId:'all'}),daily=await buildCapabilityContext(f);
 const w=capabilityWire(all);w.evaluations=all.scope.abilityIds.slice(0,13).map(ability_id=>({...w.evaluations[0],ability_id,state:'unconfirmed',certainty:'provisional',evidence:[],next_check:null}));
 const scoped=await buildCapabilityContext(f,undefined,{initial:true,domainId:'estimation',batch:0});
 for(const c of [daily,scoped])await assert.rejects(()=>prepareCapabilityUpdate(JSON.stringify({...w,context_version:c.version}),f),/12件/);
 await assert.rejects(()=>prepareCapabilityUpdate(JSON.stringify({...w,evaluations:[...w.evaluations,w.evaluations[0]]}),f),/重複/);
 w.evaluations[12].evidence=[{attempt_id:999999,part_ids:[],kind:'diagnostic',outcome:'uncertain',baseline_attempt_id:null,observation:'存在しない答案'}];
 await assert.rejects(()=>prepareCapabilityUpdate(JSON.stringify(w),f),/根拠答案/);
 w.evaluations[12].evidence=[];f.attempts[0].score_numeric=46;
 await assert.rejects(()=>prepareCapabilityUpdate(JSON.stringify(w),f),/更新/);
});
