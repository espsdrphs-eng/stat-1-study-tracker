import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {writeFile} from 'node:fs/promises';
import {EXAM_REFERENCE_EXPOSURE_META_KEY} from '../src/examReferencePack.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');

test('unsupported exposed session is deferred without editing its raw row or morning history; start/restore remain stable',async()=>{
  const initial=await localGet('/api/bootstrap'),today=initial.dashboard.today;
  const key='past_exam_session:2017:timed_three_question_session:session-2017-1';
  const raw={id:701,year:2017,date:today,session_type:'exam_90min',session_kind:'selected_three_timed',
    session_instance_id:'session-2017-1',stable_session_key:key,session_purpose:'timed_three_question_session',
    session_state:'planned',scan_evidence_kind:'practice',scan_minutes:0,questions:[],
    selected_year_reason:'既露出問題で選題・時間内完遂を確認するため'};
  await db.pastSessions.put(raw);
  await db.meta.put({key:EXAM_REFERENCE_EXPOSURE_META_KEY,value:JSON.stringify(Object.fromEntries(
    [1,2,3,4,5].map(q=>[`PY-2017-Q${q}`,'fully_attempted'])))});
  const task={problem_id:'PY-2017-Q4',title:'2017年 本番型session',kind:'本番演習',reason:raw.selected_year_reason,
    why_today:raw.selected_year_reason,mode:'exam_90min',minutes:90,load:3,triage:'must',
    plan_origin:'adaptive_planner',past_exam_year:2017,past_exam_year_role:'training_pool',
    stable_session_key:key,past_exam_session_state:'planned',past_exam_task_type:'timed_three_question_session',
    session_problem_ids:[1,2,3,4,5].map(q=>`PY-2017-Q${q}`),clean_selection_evidence:false,
    selected_year_reason:raw.selected_year_reason};
  const snapshot={date:today,created_at:`${today}T00:00:00Z`,tasks:[task],start_of_day_planned_minutes:90,
    initial_bucket:{[key]:'must'},initial_estimated_minutes:{[key]:90},task_ids:[`session:${key}`],planner_source:'adaptive'};
  await db.meta.put({key:`today-plan-snapshot:${today}`,value:JSON.stringify(snapshot)});
  await db.meta.put({key:'daily_study_minutes',value:'120'});
  const after=await localGet('/api/bootstrap');
  assert.equal(after.pastSessions.find(s=>s.id===701).session_state,'deferred');
  assert.deepEqual(await db.pastSessions.get(701),raw);
  assert.deepEqual(JSON.parse((await db.meta.get(`today-plan-snapshot:${today}`)).value),snapshot);
  assert.ok(!after.today.tasks.some(t=>t.stable_session_key===key&&t.triage==='must'));
  assert.ok(after.adaptiveLearning.plannerShadow.plan14.sessionDecisions.some(d=>d.sessionKey===key&&d.disposition==='deferred'));
  const audit=await localPost('/api/integrity/audit',{});
  assert.equal(audit.counts.unsupported_exposed_session_required,0);
  assert.equal(audit.counts.unexecuted_past_session_replaced,0);
  console.log('SANDBOX admission audit',JSON.stringify({blocking:audit.blockingIntegrityIssueCount,
    planner:audit.plannerPolicyViolationCount,issues:audit.issues.filter(i=>i.severity==='active').map(i=>i.category)}));
  const backup=await exportBackup();
  // A generated test artifact for browser upload. This is explicitly synthetic,
  // not the latest complete production export.
  await writeFile('outputs/session-value-browser-fixture.json',JSON.stringify(backup));
  await restoreBackup(backup);
  const restored=await localGet('/api/bootstrap');
  const restoredRaw=await db.pastSessions.get(701);
  // Restore's existing canonical enrichment can add derived fields, but cannot
  // change the historical scheduling facts or the stable identity.
  for(const [field,value] of Object.entries(raw))assert.deepEqual(restoredRaw[field],value);
  const fingerprint=s=>s.today.tasks.map(t=>[t.stable_session_key||t.id||t.problem_id,t.triage,t.minutes,t.why_today]);
  assert.deepEqual(fingerprint(restored),fingerprint(after));
  const next=after.today.tasks.find(t=>t.stable_session_key&&t.clean_selection_evidence);
  assert.ok(next);
  // Saved scan input, not a completed exam execution. The deferred raw session
  // must not prohibit the user from starting the high-information session.
  const saved=await localPost('/api/past-sessions',{year:next.past_exam_year,date:today,session_type:'scan5',
    session_kind:'selected_three_timed',scan_minutes:10,scan_evidence_kind:'clean',
    selected_year_reason:next.selected_year_reason,initial_selected_problem_ids:next.session_problem_ids.slice(0,3),
    questions:next.session_problem_ids.map((id,i)=>({problemId:id,questionLabel:`問${i+1}`,predictedType:'分布',
      firstStep:'式を立てる',predictedScore:50,predictedMinutes:25,sinkRisk:'medium',selected:i<3,
      selectionReason:i<3?'答案候補':'時間配分',plannedOrder:i<3?i+1:null,completed:false,
      actualScore:null,actualMinutes:null}))});
  const session=await db.pastSessions.get(saved.sessionId);
  assert.notEqual(session.year,2017);
  assert.deepEqual(await db.pastSessions.get(701),restoredRaw);
  const reload=await localGet('/api/bootstrap');
  assert.ok(reload.today.tasks.some(t=>t.stable_session_key===session.stable_session_key));
  assert.equal(reload.pastSessions.find(s=>s.id===session.id).scan_evidence_kind,'clean');
  const again=await localGet('/api/bootstrap');
  assert.deepEqual(fingerprint(again),fingerprint(reload));
  assert.ok(again.adaptiveLearning.plannerShadow.plan14.sessionDecisions.some(d=>
    d.sessionKey===key&&d.disposition==='deferred'&&d.reason));
  const startedAudit=await localPost('/api/integrity/audit',{});
  assert.equal(startedAudit.counts.clean_scan_year_skipped,0);
  assert.equal(startedAudit.blockingIntegrityIssueCount,0);
  assert.equal(startedAudit.plannerPolicyViolationCount,0);
});
