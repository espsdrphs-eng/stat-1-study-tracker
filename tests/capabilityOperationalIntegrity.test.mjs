import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {buildCapabilityContext,planCapabilityImport,prepareCapabilityUpdate,projectCapabilityMap} from '../src/capabilityEvidence.ts';
import {capabilityTrainingProfile} from '../src/abilityTraining.ts';
import {buildReviewGradingPrompt} from '../src/gradingPrompt.ts';
import {reconcilePastExamSessionEvidence} from '../src/pastExamPlanning.ts';

const id='distributions.expectation-variance',other='probability.bayes-rule',all={initial:true,domainId:'all'};
const link=(attempt_id,outcome,kind='diagnostic',baseline_attempt_id=null,part_ids=['major_calculation'])=>({attempt_id,outcome,kind,baseline_attempt_id,part_ids,observation:'FIXTURE: 採点対象の所見'});
const blank=(ability_id=id)=>({ability_id,state:'unconfirmed',certainty:'provisional',judgement:'確認した事実だけ記録',first_error:null,evidence:[],next_check:null});
const claim=(state,evidence,more={})=>({...blank(),state,evidence,certainty:'confirmed',...more});
const raw=(c,evaluations,hour=10)=>JSON.stringify({...capabilityWire(c),evaluated_at:`2026-11-11T${hour}:00:00+09:00`,evaluations});
const request=f=>buildCapabilityContext(f,undefined,all);
const save=async(f,e,h)=>{const r=await prepareCapabilityUpdate(raw(await request(f),[e],h),f);f.records.push(r);return r};
const operation=f=>projectCapabilityMap(f).abilities.find(a=>a.id===id);
const payload=c=>JSON.parse(c.prompt.split('保存済み証拠：\n')[1]);

function examFacts(){
 const f=capabilityFacts(),a=f.attempts[2],ids=['PY-2024-Q3','PY-2024-Q1','PY-2024-Q2'];
 Object.assign(a,{parent_past_session_id:9,past_exam_session_instance_id:'session-2024-1',session_role:'selected_timed',
  exam_score_eligible:true,learning_purpose:'exam_performance',assessment_timing:'independent_performance',time_minutes:25,time_limit_minutes:30,conclusion_reached:true});
 f.pastSessions=[{id:9,year:2024,date:a.date,session_kind:'selected_three_timed',session_state:'completed',session_instance_id:'session-2024-1',
  exam_score_eligible:true,actual_total_minutes:90,initial_selected_problem_ids:ids,final_selected_problem_ids:[],answered_problem_ids:ids,
  selected_timed_attempt_ids:[3,40,41],linked_attempt_ids:[3,40,41],answer_finished_at:'2026-11-08T12:00:00+09:00'}];
 return f;
}

test('exam proof uses one saved source regardless of the dashboard timing projection',async()=>{
 const f=examFacts();f.pastSessions[0].final_selected_problem_ids=f.pastSessions[0].initial_selected_problem_ids;
 const source=f.pastSessions.map(s=>({...s,actual_total_minutes:100,exam_score_eligible:false}));
 const rawFacts={...f,pastSessions:source},w=raw(await request(rawFacts),[claim('exam_confirmed',[link(3,'success','exam')])]);
 const p=await planCapabilityImport(w,rawFacts);assert.equal(p.entries[0].afterState,'unconfirmed');
 const dashboard=projectCapabilityMap({...f,capabilityPastSessions:source},[p.record]);
 assert.equal(dashboard.metrics.determinedOperations,p.summary.after.determinedOperations);
 assert.equal(dashboard.counts.exam_confirmed,0);
});

test('only a valid, on-time selected session can certify an exam stage',async()=>{
 for(const [field,value] of Object.entries({session_state:'invalidated',superseded_by_session_id:12,exam_score_eligible:false,
  selected_timed_attempt_ids:[40,41,42],counterfactual_calibration_attempt_ids:[3],session_instance_id:'other',actual_total_minutes:-1,answer_finished_at:'unknown',
  answered_problem_ids:['PY-2024-Q1','PY-2024-Q2','PY-2024-Q4'],session_elapsed_minutes:100,
  grading_contracts:{'PY-2024-Q3':{problemId:'PY-2024-Q3',contractId:'different',contractHash:'different'}}})){
  const f=examFacts();f.pastSessions[0].final_selected_problem_ids=f.pastSessions[0].initial_selected_problem_ids;
  f.pastSessions[0][field]=value;await save(f,claim('exam_confirmed',[link(3,'success','exam')]));
  assert.equal(operation(f).state,'unconfirmed',field);
 }
 const f=examFacts();await save(f,claim('exam_confirmed',[link(3,'success','exam')]));
 assert.equal(operation(f).state,'exam_confirmed','legacy empty final selection does not erase the saved selection');
});

test('the persisted stopwatch cannot be overwritten by per-answer timing during session reconciliation',()=>{
 const f=examFacts(),s=f.pastSessions[0],ids=s.initial_selected_problem_ids;
 s.questions=ids.map((problemId,i)=>({problemId,questionLabel:`問${i+1}`,selected:true}));
 s.scan_minutes=10;
 f.attempts.push(...ids.slice(1).map((problem_id,i)=>({...f.attempts[2],id:40+i,problem_id,time_minutes:20})));
 const long={...s,actual_total_minutes:100,exam_score_eligible:false};
 const projected=reconcilePastExamSessionEvidence(long,f.attempts);
 assert.equal(projected.selected_solve_minutes,65);assert.equal(projected.actual_total_minutes,100);assert.equal(projected.session_elapsed_minutes,100);
 assert.equal(projected.exam_score_eligible,false);
 const derived=reconcilePastExamSessionEvidence({...s,actual_total_minutes:0,session_state:'grading_pending',exam_score_eligible:false},f.attempts);
 assert.equal(derived.actual_total_minutes,0);assert.equal(derived.session_elapsed_minutes,75);
 const deferred=reconcilePastExamSessionEvidence({...s,session_state:'deferred'},f.attempts);
 assert.equal(deferred.session_state,'deferred');assert.equal(deferred.exam_score_eligible,false);
});

test('a same-day independent answer cannot certify immediate reproduction; a recorded clean reproduction can',async()=>{
 for(const flags of [{assessment_timing:'independent_performance',reference_closed_reproduction:false},{assessment_timing:'independent_performance',reference_closed_reproduction:true},
  {assessment_timing:'same_session_correction',reference_closed_reproduction:false},{assessment_timing:'same_session_correction',reference_closed_reproduction:true,saved_gpt_feedback:true},
  {assessment_timing:undefined,reference_closed_reproduction:undefined}]){
  const f=capabilityFacts();Object.assign(f.attempts[1],flags);
  await save(f,claim('immediate_confirmed',[link(2,'success','immediate_reproduction',1)]));assert.equal(operation(f).state,'unconfirmed',JSON.stringify(flags));
 }
 const f=capabilityFacts();Object.assign(f.attempts[1],{assessment_timing:'same_session_correction',reference_closed_reproduction:true});
 await save(f,claim('immediate_confirmed',[link(2,'success','immediate_reproduction',1)]));assert.equal(operation(f).state,'immediate_confirmed');
});

test('the existing review grading prompt can carry the clean reproduction recorded by the user',()=>{
 const args={problemId:'PY-2018-Q5',reviewId:50,mode:'main_calc',actualReferenceLevel:0,hintLevel:'none',assessmentTiming:'same_session_correction'};
 assert.match(buildReviewGradingPrompt({...args,referenceClosedReproduction:true}),/^  reference_closed_reproduction: true$/m);
 assert.match(buildReviewGradingPrompt({...args,referenceClosedReproduction:false}),/^  reference_closed_reproduction: false$/m);
 assert.match(buildReviewGradingPrompt({...args,assessmentTiming:'independent_performance',referenceClosedReproduction:true}),/^  reference_closed_reproduction: false$/m);
});

test('an individually solved past question is not relabelled as a formal exam by a GPT kind',async()=>{
 const f=capabilityFacts();f.attempts[0].exam_score_eligible=true;
 await save(f,claim('unrepaired',[link(1,'failure','exam')]));
 const e=operation(f).current.observations[0];assert.equal(e.link.kind,'exam');assert.equal(e.exerciseKind,'個別の過去問演習');
});

test('retry and focused requests bind their advertised operation scope and cannot be widened by editing the token',async()=>{
 const f=capabilityFacts(),c=await buildCapabilityContext(f,undefined,{...all,retryIds:[id]}),daily=await buildCapabilityContext(f,id);
 assert.notEqual(c.version,(await request(f)).version);
 for(const request of [c,daily]){
  assert.deepEqual(payload(request).operation_catalog.map(o=>o.id),[id]);assert.deepEqual(payload(request).review_scope.abilityIds,[id]);
  const p=await planCapabilityImport(raw(request,[blank(other)]),f);
  assert.equal(p.record,null);assert.equal(p.entries[0].status,'rejected');assert.deepEqual(p.recoveryScope.retryIds,[]);
  assert.equal((await planCapabilityImport(raw(request,[blank()]),f)).entries[0].status,'ready');
 }
 const different=await buildCapabilityContext(f,undefined,{...all,retryIds:[other]});
 const transplanted={...c,version:different.version.slice(0,-64)+c.version.slice(-64)};
 assert.equal((await planCapabilityImport(raw(transplanted,[blank(other)]),f)).entries[0].status,'conflict');
});

test('scoped daily recovery cannot cite an unshown answer but remains valid after an unrelated save',async()=>{
 const f=capabilityFacts();
 for(let i=4;i<=20;i++)f.attempts.push({...f.attempts[0],id:i,date:'2026-11-09'});
 await save(f,claim('unrepaired',[link(1,'failure')],{ability_id:other}));
 const c=await buildCapabilityContext(f,undefined,{retryIds:[id]});
 assert.ok(!payload(c).representative_answers.some(a=>a.id===1));assert.ok(!c.eligibleAttemptIds.includes(1));
 const invalid=await planCapabilityImport(raw(c,[claim('unrepaired',[link(1,'failure')])],11),f);
 assert.equal(invalid.entries[0].status,'rejected');assert.match(invalid.entries[0].reason,/#1/);
 await save(f,blank('cross.quantity-identity'),11);
 const p=await planCapabilityImport(raw(c,[claim('unrepaired',[link(20,'failure')])],12),f);
 assert.equal(p.entries[0].status,'ready');assert.equal(p.record.items[0].ability_id,id);
});

test('recovery includes every unsaved row blocked by a rejected batch but excludes duplicate rows',async()=>{
 const f=capabilityFacts(),duplicate='cross.request-to-math',c=await request(f);
 await save(f,blank(duplicate));
 const p=await planCapabilityImport(raw(c,[blank(duplicate),claim('unrepaired',[link(1,'failure','diagnostic',3)]),blank(other)]),f);
 assert.deepEqual(p.entries.map(e=>e.status),['saved','rejected','ready']);
 assert.equal(p.record,null);assert.equal(p.summary.blocked,1);assert.deepEqual(p.summary.after,p.summary.before);
 assert.deepEqual(p.recoveryScope.retryIds,[id,other]);assert.equal(p.recoveryScope.initial,true);
 const retry=await buildCapabilityContext(f,undefined,p.recoveryScope);
 assert.ok(retry.historyAttachment?.text);assert.deepEqual(new Set(retry.scope.abilityIds),new Set([id,other]));
});

test('provisional observations preserve the supported state and next proposal, without erasing new evidence',async()=>{
 const f=capabilityFacts(),next_check=capabilityWire({}).evaluations[0].next_check;
 const source=await save(f,claim('unrepaired',[link(1,'failure')],{next_check}));
 await save(f,{...blank(),evidence:[link(3,'success')]},11);
 let a=operation(f);
 assert.equal(a.state,'unrepaired');assert.equal(a.stateSource.record.id,source.id);assert.deepEqual(a.directEvidence.map(d=>d.attempt.id),[3,1]);
 assert.equal(a.proposalSource.record.id,source.id);assert.deepEqual(projectCapabilityMap(f).checks[0].check,next_check);
 const profile=capabilityTrainingProfile({...f,capabilityRecords:f.records},id);
 assert.equal(profile.trainable,true);assert.equal(profile.revision,source.id);assert.deepEqual(profile.sources.map(s=>s.attemptId),[1]);
 const scoped=await buildCapabilityContext(f,id);
 assert.deepEqual(payload(scoped).current_evaluations[0].next_check,next_check);
 await save(f,claim('unrepaired',[link(1,'failure')],{next_check_action:'withdraw'}),12);
 a=operation(f);assert.equal(a.state,'unrepaired');assert.equal(a.proposalSource,undefined);assert.equal(projectCapabilityMap(f).checks.length,0);
 assert.equal(a.history[2].item.next_check.task,next_check.task);
 assert.equal(capabilityTrainingProfile({...f,capabilityRecords:f.records},id).trainable,false);
});

test('different graded parts of one answer do not conflict; a later matching success still needs reassessment',async()=>{
 const f=capabilityFacts();f.attempts[0].graded_findings.push({graded_part_id:'focal_quantity',error_type:'none',resolved:true,evidence:'対象量を正しく定義した'});
 const r=await save(f,claim('unrepaired',[link(1,'partial','diagnostic',null,['major_calculation','focal_quantity']),link(1,'success','diagnostic',null,['focal_quantity'])]));
 let a=operation(f);assert.equal(a.state,'unrepaired');assert.equal(a.directEvidence.length,1);
 assert.deepEqual(a.directEvidence[0].outcomes,['partial','success']);
 await save(f,claim('unconfirmed',[link(2,'success')]),11);
 a=operation(f);assert.equal(a.state,'unconfirmed');assert.equal(a.history[1].record.id,r.id);
});
