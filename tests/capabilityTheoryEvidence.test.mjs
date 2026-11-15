import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {capabilityCatalog} from '../src/capabilityCatalog.ts';
import {buildCapabilityContext,planCapabilityImport,prepareCapabilityUpdate,projectCapabilityMap,parseCapabilityUpdate,capabilityFactsSignature,canonicalValue} from '../src/capabilityEvidence.ts';

const id='distributions.expectation-variance',all={initial:true,domainId:'all'};
const parts=(...partIds)=>partIds.map(([part,ok])=>({graded_part_id:part,resolved:ok,error_type:ok?'none':'W',evidence:ok?'FIXTURE: 答案から確認できた操作':'FIXTURE: 答案に書かれた誤り'}));
const link=(attempt_id,aspect,outcome,extra={})=>({attempt_id,aspect,outcome,part_ids:['major_calculation'],kind:'diagnostic',baseline_attempt_id:null,observation:'FIXTURE: 実際に採点した内容',...extra});
const evaluation=(state,evidence,extra={})=>({ability_id:id,state,certainty:'confirmed',judgement:'FIXTURE: 能力を採点項目と照合',first_error:null,evidence,next_check:null,...extra});
const raw=(c,evaluations,evaluated_at='2026-11-12T11:00:00+09:00')=>JSON.stringify({...capabilityWire(c),evaluated_at,evaluations});
const input=async(f,e,at)=>raw(await buildCapabilityContext(f,undefined,all),[e],at);
const save=async(f,e,at)=>{const r=await prepareCapabilityUpdate(await input(f,e,at),f);f.records.push(r);return r};
const operation=f=>projectCapabilityMap(f).abilities.find(a=>a.id===id);
const noncued={different_structure:true,method_not_cued:true};

test('a valid mathematical finding in an ordinary legacy-K-excluded answer remains usable on its own',async()=>{
 const f=capabilityFacts(),a=f.attempts[0];
 Object.assign(a,{policy_validity:'invalid_legacy_k',exclude_from_planning:true,exam_score_eligible:false,grading_confidence:.97,
  graded_findings:[...parts(['major_calculation',false],['outside',false]),{graded_part_id:'first_step',error_type:'K',resolved:false,evidence:'旧K判定'}],
  grading_contract:{explicitlyOutOfScopePartIds:['outside']}});
 const e=evaluation('unrepaired',[link(a.id,'derivation','failure')]),c=await buildCapabilityContext(f,undefined,all);
 assert.ok(c.eligibleAttemptIds.includes(a.id));
 const record=await save(f,e);
 assert.equal(record.items[0].effectiveState,'unrepaired');
 assert.equal(operation(f).theory.aspects.derivation.status,'failure');
 for(const part of ['outside','first_step']){
  const p=await planCapabilityImport(await input(f,evaluation('unrepaired',[link(1,'derivation','failure',{part_ids:[part]})]),'2026-11-12T12:00:00+09:00'),f);
  assert.equal(p.entries[0].status,'rejected');
 }
});

test('a failed explanation does not erase independently checked derivation on the same capability',async()=>{
 const f=capabilityFacts();
 f.attempts[1].graded_findings=parts(['major_calculation',true]);
 f.attempts.push({...f.attempts[0],id:4,date:'2026-11-10',graded_findings:parts(['major_calculation',false])});
 const d=evaluation('immediate_confirmed',[link(2,'derivation','success',{kind:'immediate_reproduction',baseline_attempt_id:1,method_not_cued:true})]);
 await save(f,d,'2026-11-11T10:00:00+09:00');
 f.attempts.at(-1).graded_findings[0].concept_focus='assumption';
 const e=evaluation('unrepaired',[link(4,'concept','failure',{concept_focus:'assumption'})]);
 const p=await planCapabilityImport(await input(f,e),f);
 assert.equal(p.entries[0].afterState,'immediate_confirmed');
 assert.equal(p.entries[0].theory.concept.status,'failure');
 await save(f,e);
 const a=operation(f);
 assert.equal(a.state,'immediate_confirmed');assert.equal(a.theory.aspects.derivation.status,'success');
 assert.equal(a.theory.aspects.concept.status,'failure');assert.equal(a.theory.aspects.concept.latest.link.concept_focus,'assumption');
 assert.equal(a.theory.aspects.transfer.status,'unconfirmed');
});

test('retention records the actually provable interval and does not turn repeat problems into transfer',async()=>{
 const f=capabilityFacts();
 f.attempts[0].date=f.attempts[1].date='2026-07-01';f.attempts[2].date='2026-10-01';
 f.attempts.push({...f.attempts[2],id:4,problem_id:f.attempts[1].problem_id,date:'2026-08-02'});
 const d=link(2,'derivation','success',{kind:'immediate_reproduction',baseline_attempt_id:1,method_not_cued:true});
 const repeat=link(4,'retention','success',{kind:'delayed_transfer',baseline_attempt_id:2,transfer_conditions:{...noncued,different_structure:false}});
 await save(f,evaluation('unconfirmed',[d,repeat]),'2026-08-03T09:00:00+09:00');
 let a=operation(f),r=a.theory.aspects.retention.latest;
 assert.equal(r.interval.calendarDays,32);assert.equal(r.interval.minimumDays,31);assert.equal(r.interval.exactDays,null);assert.equal(r.relation,'same_problem');
 assert.equal(a.theory.milestone,null);assert.equal(a.theory.aspects.transfer.status,'unconfirmed');
 // A known intervening same-problem answer cannot be ignored to claim 90 days.
 const retained=link(3,'retention','success',{kind:'delayed_transfer',baseline_attempt_id:2,transfer_conditions:noncued});
 let p=await planCapabilityImport(await input(f,evaluation('unconfirmed',[retained])),f);
 assert.equal(p.entries[0].theory.retention.status,'unconfirmed');assert.match(p.entries[0].theory.retention.reason,/途中.*#4/);
 retained.baseline_attempt_id=4;
 await save(f,evaluation('unconfirmed',[retained]));
 a=operation(f);r=a.theory.aspects.retention.latest;
 assert.deepEqual([r.baseline.id,r.attempt.id,r.interval.calendarDays,r.interval.minimumDays,r.relation],[4,3,60,59,'different_structure']);
 assert.equal(a.theory.milestone,30);assert.equal(a.state,'unconfirmed');
 assert.equal(a.theory.aspects.transfer.status,'unconfirmed','an independent retention mark does not silently fill another axis');
});

test('same-day transfer, reading a hint, and an unproved retention baseline leave the new dimensions unconfirmed',async()=>{
 for(const scenario of ['same_day','hint','no_baseline','cued','repeat']){
  const f=capabilityFacts();f.attempts[2].date=scenario==='same_day'?f.attempts[1].date:'2026-11-10';
  if(scenario==='hint')f.attempts[2].hint_used=true;
  if(scenario==='repeat')f.attempts[2].problem_id=f.attempts[1].problem_id;
  const l=link(3,scenario==='no_baseline'?'retention':'transfer','success',{kind:'delayed_transfer',baseline_attempt_id:2,
   transfer_conditions:{...noncued,method_not_cued:scenario!=='cued'}});
  await save(f,evaluation(scenario==='no_baseline'?'unconfirmed':'delayed_transfer_confirmed',[l]));
  const a=operation(f);assert.equal(a.state,'unconfirmed',scenario);assert.equal(a.theory.aspects[l.aspect].status,'unconfirmed',scenario);
 }
});

test('optional first-error chain is bound to valid, distinct graded parts; absent new fields preserve older wire',async()=>{
 const f=capabilityFacts();f.attempts[0].graded_findings=parts(['first_step',false],['major_calculation',false],['answer_conclusion',false]);
 const e=evaluation('unrepaired',[link(1,'derivation','failure',{part_ids:['first_step','major_calculation']})],{first_error:'FIXTURE: 対象量を誤った',
  error_trace:{attempt_id:1,first_part_id:'first_step',affected_part_ids:['major_calculation','answer_conclusion'],prerequisite_ability_id:'cross.quantity-identity'}});
 const good=await input(f,e);assert.deepEqual(parseCapabilityUpdate(good).evaluations[0].error_trace,e.error_trace);
 await save(f,e);assert.equal(operation(f).theory.errorTrace.affected_part_ids.length,2);
 e.error_trace.affected_part_ids.push('not-a-real-part');
 const p=await planCapabilityImport(await input(f,e,'2026-11-12T12:00:00+09:00'),f);
 assert.equal(p.entries[0].status,'rejected');
 const old=capabilityWire(await buildCapabilityContext(capabilityFacts()));
 assert.equal(parseCapabilityUpdate(JSON.stringify(old)).evaluations[0].evidence[0].aspect,undefined);
});

test('calculations are not evidence of explanation, nor is a marked blank answer a demonstrated mathematical failure',async()=>{
 const f=capabilityFacts();
 const e=evaluation('immediate_confirmed',[link(2,'concept','success',{kind:'immediate_reproduction',concept_focus:'justification',baseline_attempt_id:1})]);
 let p=await planCapabilityImport(await input(f,e),f);
 assert.equal(p.entries[0].afterState,'unconfirmed');assert.equal(p.entries[0].theory.concept.status,'unconfirmed');assert.match(p.entries[0].theory.concept.reason,/実際に採点/);
 f.attempts[0].whole_answer_scan={performed:true,regions:[{answer_present:false,status:'unanswered',finding_ids:['major_calculation']}]};
 p=await planCapabilityImport(await input(f,evaluation('unrepaired',[link(1,'derivation','failure')])),f);
 assert.equal(p.entries[0].afterState,'unconfirmed');assert.match(p.entries[0].theory.derivation.reason,/未着手/);
});

test('explaining meaning does not clear a separately graded misconception about assumptions',async()=>{
 const f=capabilityFacts();f.attempts[0].graded_findings[0].concept_focus='assumption';f.attempts[2].graded_findings[0].concept_focus='meaning';
 await save(f,evaluation('unrepaired',[link(1,'concept','failure',{concept_focus:'assumption'})]),'2026-11-10T10:00:00+09:00');
 const explained=evaluation('unconfirmed',[link(3,'concept','success',{concept_focus:'meaning'})]);
 const p=await planCapabilityImport(await input(f,explained,'2026-11-11T10:00:00+09:00'),f);
 assert.equal(p.entries[0].theory.concept.status,'success');assert.equal(p.entries[0].theory.concept.afterStatus,'failure');
 await save(f,explained,'2026-11-11T10:00:00+09:00');
 const a=operation(f);assert.equal(a.theory.aspects.concept.latest.link.concept_focus,'assumption');assert.equal(a.state,'unconfirmed');
 assert.match(a.stateReason,/だけで従来の5段階は判定しません/);
 f.attempts.push({...f.attempts[2],id:4,date:'2026-11-11',graded_findings:parts(['major_calculation',true])});
 f.attempts.at(-1).graded_findings[0].concept_focus='assumption';
 await save(f,evaluation('unconfirmed',[link(4,'concept','success',{concept_focus:'assumption'})]));
 assert.equal(operation(f).theory.aspects.concept.status,'success');assert.equal(operation(f).theory.aspects.concept.history.length,3);
});

test('unsubmitted r3 evaluation requests remain valid in their original eligible scope; r4 does not widen past requests',async()=>{
 const f=capabilityFacts();
 Object.assign(f.attempts[0],{policy_validity:'invalid_legacy_k',exclude_from_planning:true,grading_confidence:.97,graded_findings:parts(['major_calculation',false])});
 const sha=t=>createHash('sha256').update(t).digest('hex');
 const {records,...source}=JSON.parse(capabilityFactsSignature(f)),stem='capability-context:iall:';
 const index=capabilityCatalog.findIndex(a=>a.id===id),bytes=Buffer.alloc(10);bytes[index>>3]=1<<(index&7);
 const mask=bytes.toString('hex'),sourceHash=sha(canonicalValue(source));
 const previous=stem+'r3:0:'+mask+':'+sha(canonicalValue([stem,sourceHash,mask,[2,3],records]));
 const c={...await buildCapabilityContext(f,undefined,all),version:previous};
 const valid=evaluation('unconfirmed',[link(3,'concept','uncertain')]);
 assert.equal((await planCapabilityImport(raw(c,[valid]),f)).entries[0].status,'ready');
 const limited=await planCapabilityImport(raw(c,[evaluation('unrepaired',[link(1,'derivation','failure')])]),f);
 assert.equal(limited.entries[0].status,'rejected');assert.match(limited.entries[0].reason,/#1.*評価対象/);
 const unscoped={...c,version:stem+'r2:0:'+sha(canonicalValue([stem,sourceHash,records]))};
 assert.equal((await planCapabilityImport(raw(unscoped,[valid]),f)).entries[0].status,'ready');
});
