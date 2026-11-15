import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilityCatalog} from '../src/capabilityCatalog.ts';
import {buildCapabilityContext,prepareCapabilityUpdate,projectCapabilityMap} from '../src/capabilityEvidence.ts';
import {deriveCapabilityStudyPlan,theoryExamIsFocus} from '../src/capabilityStudyPlan.ts';
import {learningInterval} from '../src/capabilityTheory.ts';
import {noncuedProfiles} from '../src/noncuedTransfer.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';

const primary='distributions.expectation-variance';
const other=['cross.quantity-identity','cross.request-to-math','probability.independence','estimation.likelihood-build','asymptotics.delta'];
const scope={initial:true,domainId:'all'};
const finding=(part,ok)=>({graded_part_id:part,error_type:ok?'none':'W',resolved:ok,evidence:ok?'FIXTURE independent operation':'FIXTURE actual written error'});
const link=(attempt_id,outcome,extras={})=>({attempt_id,kind:'diagnostic',outcome,part_ids:['major_calculation'],baseline_attempt_id:null,observation:'FIXTURE direct evidence',...extras});
const row=(ability_id,state,evidence,extras={})=>({ability_id,state,certainty:'confirmed',judgement:'FIXTURE supported evaluation',first_error:null,evidence,next_check:null,...extras});
const proposal=(kind,more={})=>({kind,task:'FIXTURE stored proposal',success_condition:'FIXTURE independent assessment',due_date:null,...more});
async function save(f,day,...evaluations){
 const context=await buildCapabilityContext(f,undefined,scope);
 const r=await prepareCapabilityUpdate(JSON.stringify({...capabilityWire(context),evaluated_at:day.includes('T')?day:`${day}T10:00:00+09:00`,evaluations}),f);
 f.records.push(r);return r;
}
const view=f=>projectCapabilityMap(f);
const get=(v,id=primary)=>v.abilities.find(a=>a.id===id);
const plan=(f,today,options={})=>deriveCapabilityStudyPlan(view(f),{today,minutes:30,...options});

test('75 unique operations, no curriculum consumption ranking: prioritize distinct-problem recurrence and documented cascade, capped to budget',async()=>{
 const f=capabilityFacts();
 f.attempts[0].graded_findings=[finding('first_step',false),finding('major_calculation',false),finding('answer_conclusion',false)];
 f.attempts.push({...f.attempts[0],problem_id:'PY-2024-Q3',id:4,date:'2026-11-09'});
 const repeat=row(other[0],'unrepaired',[link(1,'failure'),link(1,'failure',{part_ids:['first_step']}),link(4,'failure')]);
 const cascade=row(other[1],'unrepaired',[link(1,'failure',{part_ids:['first_step']})],{first_error:'FIXTURE named step',error_trace:{attempt_id:1,first_part_id:'first_step',affected_part_ids:['major_calculation','answer_conclusion'],prerequisite_ability_id:other[0]}});
 const one=row(other[2],'unrepaired',[link(1,'failure'),link(1,'failure',{part_ids:['first_step']})]);
 const laterOnly=other.slice(3).map(id=>row(id,'unconfirmed',[link(3,'success')],{next_check:proposal('diagnostic',{due_date:'2026-11-05',estimated_minutes:8})}));
 await save(f,'2026-11-12',one,...laterOnly,cascade,repeat,row(primary,'unconfirmed',[],{certainty:'provisional'}));
 const m=view(f),before=structuredClone(f),p=plan(f,'2026-11-16',{minutes:22});
 assert.equal(m.total,75);assert.equal(new Set(capabilityCatalog.map(a=>a.id)).size,75);
 assert.equal(Object.values(m.counts).reduce((a,b)=>a+b),75);
 assert.equal(get(m,other[0]).theory.failureProblemCount,2);assert.equal(get(m,other[2]).theory.failureProblemCount,1);
 assert.deepEqual(p.recommended.map(c=>c.ability.id),other.slice(0,2));assert.equal(p.usedMinutes,20);
 assert.equal(p.unselected.length,3);assert.equal(p.unselected.filter(c=>c.timing==='overdue').length,2);
 assert.ok(!p.queue.some(c=>c.ability.id===primary));assert.deepEqual(f,before);
 const full=plan(f,'2026-11-16',{minutes:150});assert.equal(full.recommended.length,3);assert.equal(full.unselected.length,2);
});

test('form retest intervals from actual evidence, fulfill issued proposals and lengthen after 7 / 30 / 90 day success',async()=>{
 const f=capabilityFacts(),cond={different_structure:true,method_not_cued:true};
 f.attempts=f.attempts.slice(0,2);f.attempts[0].date=f.attempts[1].date='2026-07-01';
 const passed=(id,date)=>{const problem_id=`FIXTURE-${id}`;f.problems.push({problem_id,title:problem_id,source_type:'past_exam'});f.attempts.push({...f.attempts[1],id,date,problem_id,assessment_timing:'independent_performance',reference_closed_reproduction:false});};
 const op=link(2,'success',{kind:'immediate_reproduction',aspect:'derivation',method_not_cued:true,baseline_attempt_id:1});
 const delayed=(id,baseline,aspect,outcome='success')=>link(id,outcome,{kind:'delayed_transfer',aspect,baseline_attempt_id:baseline,transfer_conditions:cond});
 await save(f,'2026-07-02',row(primary,'immediate_confirmed',[op]));
 assert.equal(plan(f,'2026-07-02').upcoming[0].dueDate,'2026-07-03');
 passed(3,'2026-07-03');
 await save(f,'2026-07-04',row(primary,'delayed_transfer_confirmed',[delayed(3,2,'transfer')],{next_check:proposal('delayed_transfer',{aspect:'retention'})}));
 let p=plan(f,'2026-07-04');assert.deepEqual(p.upcoming.map(x=>[x.intervalDays,x.dueDate,x.source]),[[7,'2026-07-11','gpt']]);
 const profiles=today=>noncuedProfiles({...f,capabilityRecords:f.records},{today});
 assert.deepEqual(profiles('2026-07-10').map(x=>x.id),[]);
 assert.deepEqual(profiles('2026-07-11').map(x=>[x.id,x.sources[0].attemptId]),[[primary,3]]);
 passed(4,'2026-07-11');
 await save(f,'2026-07-12',row(primary,'unconfirmed',[delayed(4,3,'retention')]));
 assert.equal(get(view(f)).theory.milestone,7);
 p=plan(f,'2026-07-12');assert.deepEqual(p.upcoming.map(x=>[x.intervalDays,x.dueDate,x.source]),[[30,'2026-08-11','suggestion']]);
 assert.deepEqual(profiles('2026-07-12').map(x=>x.id),[],'an already fulfilled proposal is not offered repeatedly');
 passed(5,'2026-08-11');
 await save(f,'2026-08-12',row(primary,'unconfirmed',[delayed(5,4,'retention')],{next_check:proposal('delayed_transfer',{aspect:'retention',due_date:'2026-11-13'})}));
 assert.equal(get(view(f)).theory.milestone,30);
 assert.deepEqual(plan(f,'2026-08-12').upcoming.map(x=>[x.intervalDays,x.dueDate]),[[90,'2026-11-13']]);
 passed(6,'2026-11-13');
 await save(f,'2026-11-13',row(primary,'unconfirmed',[delayed(6,5,'retention')]));
 assert.equal(get(view(f)).theory.milestone,90);assert.equal(get(view(f)).state,'delayed_transfer_confirmed');
 assert.deepEqual(plan(f,'2027-11-16').stale.map(x=>x.ability.id),[primary]);
 assert.equal(get(view(f)).state,'delayed_transfer_confirmed','old dates alone do not downgrade');
 passed(7,'2026-11-15');f.attempts.at(-1).graded_findings=[finding('major_calculation',false)];
 await save(f,'2026-11-15',row(primary,'unconfirmed',[delayed(7,6,'retention','failure')]));
 const a=get(view(f));assert.equal(a.theory.aspects.retention.status,'failure');assert.equal(a.theory.milestone,90);
 assert.ok(a.theory.aspects.retention.history.some(o=>o.status==='success'&&o.attempt.id===6));
 assert.equal(plan(f,'2026-11-16').recommended[0].kind,'repair');assert.equal(a.state,'delayed_transfer_confirmed');
});

test('explicit future exam focus only; timing treats absent clocks as a lower bound',async()=>{
 const f=capabilityFacts();await save(f,'2026-11-12',row(primary,'unconfirmed',[link(3,'success')],{next_check:proposal('exam')}));
 assert.ok(!plan(f,'2026-11-16',{examDate:'2026-11-15',focusExam:true,minutes:120}).queue.length);
 assert.ok(!plan(f,'2026-11-16',{examDate:'2027-11-15',minutes:120}).queue.length);
 assert.equal(plan(f,'2026-11-16',{examDate:'2027-11-15',focusExam:true,minutes:120}).recommended[0].kind,'exam');
 assert.equal(theoryExamIsFocus({today:'2026-11-16',examDate:'2026-11-31',focusExam:true}),false);
 assert.deepEqual(learningInterval({date:'2026-08-01',at:'2026-08-01T09:30:00+09:00'},{date:'2026-08-08',at:'2026-08-08T10:30:00+09:00'}),{calendarDays:7,minimumDays:7,exactDays:7+1/24});
 assert.deepEqual(learningInterval({date:'2026-08-01'},{date:'2026-08-08'}),{calendarDays:7,minimumDays:6,exactDays:null});
 assert.equal(learningInterval({date:'2026-02-30'},{date:'2026-03-02'}),null);
});

test('a verified local recovery reopens a short transfer check without erasing the failed retention or old success',async()=>{
 const f=capabilityFacts(),cond={different_structure:true,method_not_cued:true};
 const d=(id,base)=>link(id,'success',{kind:'immediate_reproduction',aspect:'derivation',method_not_cued:true,baseline_attempt_id:base});
 const transfer=(id,base,aspect,outcome='success')=>link(id,outcome,{kind:'delayed_transfer',aspect,baseline_attempt_id:base,transfer_conditions:cond});
 const add=(id,date,ok,problem_id=`NEW-${id}`)=>{
  if(!f.problems.some(p=>p.problem_id===problem_id))f.problems.push({problem_id,title:problem_id,source_type:'past_exam'});
  f.attempts.push({...f.attempts[1],id,problem_id,date,assessment_timing:'independent_performance',reference_closed_reproduction:false,graded_findings:[finding('major_calculation',ok)]});
 };
 f.attempts[0].date=f.attempts[1].date='2026-07-01';f.attempts[2].date='2026-11-05';
 // A long verification may exist even if no separate initial transfer was recorded.
 await save(f,'2026-11-06',row(primary,'immediate_confirmed',[d(2,1),transfer(3,2,'retention')],{next_check:proposal('delayed_transfer',{aspect:'retention',interval_days:90})}));
 assert.equal(get(view(f)).theory.milestone,90);
 add(4,'2026-11-09',false);
 await save(f,'2026-11-09',row(primary,'unconfirmed',[transfer(4,3,'retention','failure')]));
 assert.equal(plan(f,'2026-11-09').recommended[0].kind,'repair');
 add(5,'2026-11-09',true,'NEW-4');
 Object.assign(f.attempts.at(-1),{assessment_timing:'same_session_correction',reference_closed_reproduction:true});
 await save(f,'2026-11-09T11:00:00+09:00',row(primary,'immediate_confirmed',[d(5,4)]));
 assert.deepEqual(plan(f,'2026-11-10').upcoming.map(c=>[c.kind,c.dueDate]),[['transfer','2026-11-11']]);
 assert.equal(get(view(f)).theory.aspects.retention.status,'failure');assert.equal(get(view(f)).theory.milestone,90);
 add(6,'2026-11-11',true);
 await save(f,'2026-11-12',row(primary,'delayed_transfer_confirmed',[transfer(6,5,'transfer')]));
 assert.deepEqual(plan(f,'2026-11-12').upcoming.map(c=>[c.kind,c.intervalDays,c.dueDate]),[['retention',7,'2026-11-19']]);
 assert.equal(get(view(f)).theory.milestone,90);
});
