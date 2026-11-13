import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilityCatalog,capabilityDomains,syllabusCoverage,capabilitySearchText} from '../src/capabilityCatalog.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
const core=()=>import('../src/capabilityEvidence.ts');

test('official mathematical syllabus has stable unique operations and full small-heading coverage',()=>{
 assert.equal(new Set(capabilityCatalog.map(c=>c.id)).size,capabilityCatalog.length);
 assert.ok(capabilityCatalog.length>=60);assert.equal(capabilityDomains.length,12);
 for(const row of syllabusCoverage)assert.ok(capabilityCatalog.some(c=>c.coverageIds.includes(row.id)),row.name);
 for(const c of capabilityCatalog)for(const id of c.relatedIds)assert.ok(capabilityCatalog.some(k=>k.id===id));
});
test('official knowledge terms remain discoverable under their operation without implying proficiency',()=>{
 for(const word of ['コーシー','ベータ','超幾何','ギブス','ウィルコクソン','トランケーション','クロスバリデーション'])assert.ok(capabilityCatalog.some(c=>capabilitySearchText(c).includes(word)),word);
});
test('old failure notes, old profiles and total scores never create capability states or links',async()=>{
 const {projectCapabilityMap}=await core(),facts=capabilityFacts();
 facts.weakNotes=Array.from({length:704},()=>({is_resolved:0}));facts.coach={current:{abilityProfiles:[{id:'distribution-support',state:'confirmed'}]}};
 const before=JSON.stringify(facts),view=projectCapabilityMap(facts,[]);
 assert.equal(view.counts.unconfirmed,capabilityCatalog.length);assert.equal(view.counts.unrepaired,0);
 assert.ok(view.abilities.every(a=>a.problemIds.length===0));assert.equal(JSON.stringify(facts),before);
});
test('GPT-confirmed immediate reproduction is not delayed transfer or exam success',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts(),ctx=await buildCapabilityContext(f);
 const record=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(ctx)),f);
 const row=projectCapabilityMap(f,[record]).abilities.find(r=>r.id==='distributions.expectation-variance');
 assert.equal(row.state,'immediate_confirmed');assert.equal(row.stages.delayed_transfer,false);assert.equal(row.stages.exam,false);
 assert.deepEqual(row.problemIds,['PY-2018-Q5']);assert.ok(record.sourceSignatures['2']);
});
test('unknown reference use, partial or assisted success is saved as uncertain, never mastery',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core();
 for(const change of [{actual_reference_level:undefined},{hint_used:true},{actual_reference_level:2},{grading_confidence:30}]){
  const f=capabilityFacts();Object.assign(f.attempts[1],change);const ctx=await buildCapabilityContext(f),r=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(ctx)),f),v=projectCapabilityMap(f,[r]);
  assert.equal(v.abilities.find(a=>a.id==='distributions.expectation-variance').state,'unconfirmed');assert.ok(r.items[0].warnings.length);
 }
});
test('only a dated different first-seen problem with baseline proof can confirm delayed transfer',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts(),ctx=await buildCapabilityContext(f);
 const w=capabilityWire(ctx,{state:'delayed_transfer_confirmed'});w.evaluations[0].evidence=[{attempt_id:3,part_ids:['major_calculation'],kind:'delayed_transfer',outcome:'success',baseline_attempt_id:2,observation:'別日の初見設定で自力完遂',transfer_conditions:{different_structure:true,method_not_cued:true}}];
 const r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(projectCapabilityMap(f,[r]).counts.delayed_transfer_confirmed,1);
 f.attempts[2].date=f.attempts[1].date;const same=await buildCapabilityContext(f);w.context_version=same.version;
 const hold=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(projectCapabilityMap(f,[hold]).counts.delayed_transfer_confirmed,0);
});
test('missing IDs, mismatched parts, stale facts and malformed JSON are rejected without guessing',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate}=await core(),f=capabilityFacts(),ctx=await buildCapabilityContext(f);
 for(const edit of [w=>w.evaluations[0].ability_id='invented.ability',w=>w.evaluations[0].evidence[0].attempt_id=999,w=>w.evaluations[0].evidence[0].part_ids=['wrong'],w=>w.context_version='old']){
  const w=capabilityWire(ctx);edit(w);await assert.rejects(()=>prepareCapabilityUpdate(JSON.stringify(w),f));
 }
 await assert.rejects(()=>prepareCapabilityUpdate('{"evaluations": ,}',f),/JSON|構文/);
 const w=capabilityWire(ctx);f.attempts[0].score_numeric=80;await assert.rejects(()=>prepareCapabilityUpdate(JSON.stringify(w),f),/更新|対象|context/);
});

test('partial success never becomes immediate reproduction, even when the total score is high',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts();f.attempts[1].score_numeric=99;
 const ctx=await buildCapabilityContext(f),w=capabilityWire(ctx);w.evaluations[0].evidence[0].outcome='partial';
 const r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(projectCapabilityMap(f,[r]).counts.immediate_confirmed,0);
});
test('a repeated problem, induced method, missing baseline or a one-calendar-day gap cannot confirm delayed transfer',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core();
 for(const which of ['repeat','cued','baseline','day']){
  const f=capabilityFacts();if(which==='repeat')f.attempts.push({...f.attempts[2],id:4,date:'2026-11-07'});
  if(which==='cued')f.attempts[2].target_skill_prompted=true;if(which==='day')f.attempts[2].date='2026-11-02';
  const ctx=await buildCapabilityContext(f),w=capabilityWire(ctx,{state:'delayed_transfer_confirmed'});
  w.evaluations[0].evidence=[{attempt_id:3,part_ids:['major_calculation'],kind:'delayed_transfer',outcome:'success',baseline_attempt_id:which==='baseline'?null:2,observation:'TEST: 別問題での成功申告',transfer_conditions:{different_structure:true,method_not_cued:true}}];
  const r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(projectCapabilityMap(f,[r]).counts.delayed_transfer_confirmed,0,which);
 }
});
test('generated drafts and old transfer flags cannot certify a delayed or natural transfer',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts();
 f.attempts[2].problem_id='GEN-TEST';f.attempts[2].transfer_evidence=true;
 const ctx=await buildCapabilityContext(f),w=capabilityWire(ctx,{state:'delayed_transfer_confirmed'});
 w.evaluations[0].evidence=[{attempt_id:3,part_ids:['major_calculation'],kind:'delayed_transfer',outcome:'success',baseline_attempt_id:2,observation:'TEST: 品質情報のない生成問題',transfer_conditions:{different_structure:true,method_not_cued:true}}];
 const r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(projectCapabilityMap(f,[r]).counts.delayed_transfer_confirmed,0);assert.match(r.items[0].warnings.join(),/品質/);
 assert.equal(projectCapabilityMap(f,[]).counts.unconfirmed,capabilityCatalog.length);
});
test('only a bound completed timed past-exam answer supports the exam stage, not local repair or generated training',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts();
 Object.assign(f.attempts[2],{parent_past_session_id:9,session_role:'selected_timed',exam_score_eligible:true,learning_purpose:'exam_performance',time_minutes:25,time_limit_minutes:30,conclusion_reached:true});
 f.pastSessions=[{id:9,year:2024,date:'2026-11-08',session_kind:'selected_three_timed',exam_score_eligible:true,actual_total_minutes:90,exam_selected_problem_ids:['PY-2024-Q3','PY-2024-Q1','PY-2024-Q2'],answer_finished_at:'2026-11-08T12:00:00+09:00'}];
 const wire=async()=>{const ctx=await buildCapabilityContext(f),w=capabilityWire(ctx,{state:'exam_confirmed'});w.evaluations[0].evidence=[{attempt_id:3,part_ids:['major_calculation'],kind:'exam',outcome:'success',baseline_attempt_id:null,observation:'TEST: 時間内の指定操作を確認'}];return w};
 let r=await prepareCapabilityUpdate(JSON.stringify(await wire()),f);assert.equal(projectCapabilityMap(f,[r]).counts.exam_confirmed,1);
 f.attempts[2].learning_purpose='error_repair';r=await prepareCapabilityUpdate(JSON.stringify(await wire()),f);assert.equal(projectCapabilityMap(f,[r]).counts.exam_confirmed,0);
 f.attempts[2].learning_purpose='exam_performance';f.attempts[2].time_minutes=40;r=await prepareCapabilityUpdate(JSON.stringify(await wire()),f);assert.equal(projectCapabilityMap(f,[r]).counts.exam_confirmed,0);
});
test('deleted or modified sources and same-time conflicting GPT states display as unconfirmed without destroying history',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts(),ctx=await buildCapabilityContext(f),r=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(ctx)),f);
 const absent=structuredClone(f);absent.attempts=absent.attempts.filter(a=>a.id!==2);assert.doesNotThrow(()=>projectCapabilityMap(absent,[r]));assert.equal(projectCapabilityMap(absent,[r]).counts.immediate_confirmed,0);
 const altered=structuredClone(f);altered.attempts[1].score_numeric=1;assert.equal(projectCapabilityMap(altered,[r]).counts.immediate_confirmed,0);
 const other=structuredClone(r);other.id='other';other.items[0].state='unrepaired';other.items[0].effectiveState='unrepaired';
 assert.equal(projectCapabilityMap(f,[r,other]).counts.immediate_confirmed,0);
});
test('an older failure alone does not undo a newer explicitly mapped success',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate}=await core(),f=capabilityFacts();
 let ctx=await buildCapabilityContext(f),r=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(ctx)),f);f.records=[r];
 assert.equal(r.items[0].effectiveState,'immediate_confirmed');
 ctx=await buildCapabilityContext(f);const w=capabilityWire(ctx,{state:'unrepaired'});w.evaluated_at='2026-11-11T11:00:00+09:00';w.evaluations[0].evidence=[{attempt_id:1,part_ids:['major_calculation'],kind:'diagnostic',outcome:'failure',baseline_attempt_id:null,observation:'古い失敗だけを再引用'}];
 r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.equal(r.items[0].effectiveState,'unconfirmed');assert.match(r.items[0].warnings.join(),/古い失敗/);
});
test('recurrence and latest state use real time across time zones, with one capability in one domain',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts();
 let r=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(await buildCapabilityContext(f))),f);f.records=[r];
 f.attempts.push({...f.attempts[0],id:4,date:'2026-11-10'});
 const w=capabilityWire(await buildCapabilityContext(f),{state:'unrepaired'});w.evaluated_at='2026-11-11T02:00:00Z';w.evaluations[0].evidence=[{attempt_id:4,part_ids:['major_calculation'],kind:'diagnostic',outcome:'failure',baseline_attempt_id:null,observation:'TEST ONLY: 別日の答案で未完了が再発した'}];
 const next=await prepareCapabilityUpdate(JSON.stringify(w),f),map=projectCapabilityMap(f,[r,next]);
 assert.equal(map.counts.unrepaired,1);assert.equal(map.recurrences.length,1);assert.equal(map.counts.immediate_confirmed,0);
 assert.equal(Object.values(map.counts).reduce((a,b)=>a+b,0),capabilityCatalog.length);
 assert.equal(map.domains.reduce((n,d)=>n+d.total,0),capabilityCatalog.length);
 for(const d of map.domains)assert.equal(Object.values(d.counts).reduce((a,b)=>a+b,0),d.total);
});
test('an edited or malformed stored derived state is not trusted above its original GPT claim',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,readCapabilityRecords,CAPABILITY_RECORD_PREFIX}=await core(),f=capabilityFacts();
 const r=await prepareCapabilityUpdate(JSON.stringify(capabilityWire(await buildCapabilityContext(f))),f),changed=structuredClone(r);
 changed.items[0].effectiveState='exam_confirmed';
 const result=readCapabilityRecords([{key:CAPABILITY_RECORD_PREFIX+r.id,value:JSON.stringify(changed)}]);assert.equal(result.records.length,0);assert.equal(result.issues.length,1);
 const broken=readCapabilityRecords([{key:CAPABILITY_RECORD_PREFIX+'broken',value:'invalid JSON'}]);assert.equal(broken.records.length,0);assert.equal(broken.issues.length,1);
});
test('an unassessed blank source cannot become unrepaired; contradictory reference flags cannot become independent success',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate}=await core(),f=capabilityFacts();
 f.attempts[1].graded_findings=[];f.attempts[1].error_point='';f.attempts[1].error_type='none';
 let w=capabilityWire(await buildCapabilityContext(f),{state:'unrepaired'});w.evaluations[0].evidence[0].part_ids=[];w.evaluations[0].evidence[0].outcome='failure';
 assert.equal((await prepareCapabilityUpdate(JSON.stringify(w),f)).items[0].effectiveState,'unconfirmed');
 const g=capabilityFacts();g.attempts[1].external_reference=true;w=capabilityWire(await buildCapabilityContext(g));
 assert.equal((await prepareCapabilityUpdate(JSON.stringify(w),g)).items[0].effectiveState,'unconfirmed');
});
test('current issue presentation follows the recorded GPT order, not the catalog or raw failure counts',async()=>{
 const {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap}=await core(),f=capabilityFacts(),w=capabilityWire(await buildCapabilityContext(f),{state:'unrepaired'});
 w.evaluations[0].evidence=[{attempt_id:1,part_ids:['major_calculation'],kind:'diagnostic',outcome:'failure',baseline_attempt_id:null,observation:'TEST ONLY: 評価順の保存を確認'}];
 w.evaluations.unshift({...structuredClone(w.evaluations[0]),ability_id:'cross.complete-derivation'});
 const r=await prepareCapabilityUpdate(JSON.stringify(w),f);assert.deepEqual(projectCapabilityMap(f,[r]).priorities.map(a=>a.id),['cross.complete-derivation','distributions.expectation-variance']);
});
