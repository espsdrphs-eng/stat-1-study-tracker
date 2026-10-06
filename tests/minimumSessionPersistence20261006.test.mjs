import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {mkdir,writeFile} from 'node:fs/promises';
import {EXAM_REFERENCE_EXPOSURE_META_KEY} from '../src/examReferencePack.ts';
import {addCalendarDays} from '../src/reviewSchedulePolicy.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');

test('fixture storage E2E: fresh derivation → short scan → save → reload → export/restore; no old full resurrection',async()=>{
  const initial=await localGet('/api/bootstrap'),today=initial.dashboard.today,date=addCalendarDays(today,-5);
  // Isolated fake IndexedDB. Supplemented IDs, grading, taxonomy and exposure,
  // not a production-copy E2E and not evidence of actual user execution.
  await db.attempts.clear();await db.reviews.clear();await db.pastSessions.clear();
  const problems=await db.problems.toArray();
  await db.meta.put({key:EXAM_REFERENCE_EXPOSURE_META_KEY,value:JSON.stringify(Object.fromEntries(
    problems.filter(p=>p.problem_id.startsWith('PY-')).map(p=>[p.problem_id,
      /^PY-202[45]-/.test(p.problem_id)?'unseen':'fully_attempted'])))});
  await db.meta.put({key:'daily_study_minutes',value:'90'});
  const raw={id:717,year:2017,date:today,session_kind:'selected_three_timed',session_type:'exam_90min',
    session_instance_id:'session-2017-1',stable_session_key:'past_exam_session:2017:timed_three_question_session:session-2017-1',
    session_purpose:'timed_three_question_session',session_state:'planned',scan_evidence_kind:'practice',questions:[],
    selected_year_reason:'既露出training'};
  await db.pastSessions.put(raw);
  const selected=[2,3,4].map(q=>`PY-2022-Q${q}`);
  await db.attempts.bulkPut([2,3,4].map((q,i)=>({id:802+i,problem_id:`PY-2022-Q${q}`,date,mode:'full',
    time_minutes:30,score_numeric:[50,55,52][i],score_max:100,score_label:'C',mark:'△',
    policy_validity:'valid',error_type:'none',error_types:[],actual_reference_level:0,reference_level:0,hint_used:false,
    session_role:'selected_timed',past_exam_session_id:722,past_exam_session_instance_id:'measured-2022',
    grading_confidence:.99,graded_part_ids:['major_calculation'],
    grading_contract:{gradedParts:[{id:'major_calculation',masteryLevel:2,stableTargetKey:`target:PY-2022-Q${q}:slot:major_calculation`}]},
    graded_findings:[{graded_part_id:'major_calculation',error_type:'none',resolved:true,evidence:'完遂'}]})));
  const questions=[1,2,3,4,5].map(q=>({problemId:`PY-2022-Q${q}`,questionLabel:`問${q}`,selected:[2,3,4].includes(q),
    predictedType:'型',firstStep:'入口',predictedScore:70,predictedMinutes:30,sinkRisk:'low',selectionReason:'選択候補',
    plannedOrder:[2,3,4].includes(q)?q-1:null,completed:true,sank:false,
    actualScore:[2,3,4].includes(q)?[50,55,52][q-2]:20,actualMinutes:[2,3,4].includes(q)?30:15}));
  await db.pastSessions.put({id:722,year:2022,date,session_kind:'selected_three_timed',session_type:'exam_90min',
    session_instance_id:'measured-2022',session_purpose:'timed_three_question_session',
    scan_evidence_kind:'clean',scan_minutes:10,selected_solve_minutes:90,session_elapsed_minutes:100,actual_total_minutes:100,
    prompt_scanned_at:date+'T09:00:00Z',attempt_completed_at:date+'T11:00:00Z',questions,
    initial_selected_problem_ids:selected,selected_problem_ids:selected,selected_year_reason:'clean測定',
    selection_evaluation_status:'complete',selection_success_count:3,selection_target_count:3,selection_success_rate:1,
    analysis:{primary_selection_error:'score_overconfidence'}});
  const old={problem_id:'PY-2017-Q4',title:'2017年 本番型session',kind:'本番演習',mode:'exam_90min',minutes:90,
    load:3,triage:'must',plan_origin:'adaptive_planner',past_exam_year:2017,past_exam_year_role:'training_pool',
    past_exam_task_type:'timed_three_question_session',stable_session_key:raw.stable_session_key,
    past_exam_session_state:'planned',session_problem_ids:[1,2,3,4,5].map(q=>`PY-2017-Q${q}`),
    clean_selection_evidence:false,selected_year_reason:'training',reason:'旧full計画'};
  const snapshot={date:today,created_at:today+'T00:00:00Z',tasks:[old],start_of_day_planned_minutes:90,planner_source:'adaptive'};
  await db.meta.put({key:`today-plan-snapshot:${today}`,value:JSON.stringify(snapshot)});
  const after=await localGet('/api/bootstrap');
  assert.ok(!after.today.tasks.some(t=>t.stable_session_key===raw.stable_session_key&&!t.checked));
  const correction=after.today.tasks.find(t=>t.past_exam_task_type==='practice_scan5');
  assert.ok(correction);assert.equal(correction.minutes,10);assert.equal(correction.mode,'scan5');
  assert.match(correction.why_today,/100分/);assert.match(correction.why_today,/80分/);
  assert.deepEqual(await db.pastSessions.get(717),raw);
  assert.deepEqual(JSON.parse((await db.meta.get(`today-plan-snapshot:${today}`)).value),snapshot);
  const audit=await localPost('/api/integrity/audit',{});
  assert.equal(audit.blockingIntegrityIssueCount,0,JSON.stringify(audit.issues.filter(i=>i.severity==='active')));assert.equal(audit.plannerPolicyViolationCount,0);
  // Restore intentionally rebuilds today's snapshot. Compare executable state,
  // while checking completed historical identities separately below.
  const fingerprint=s=>s.today.tasks.filter(t=>!t.checked).map(t=>[t.stable_session_key||t.id||t.problem_id,t.triage,t.minutes,t.why_today]);
  assert.deepEqual(fingerprint(await localGet('/api/bootstrap')),fingerprint(after));
  const beforeScan=await exportBackup();await mkdir('outputs',{recursive:true});
  await writeFile('outputs/minimum-session-browser-fixture.json',JSON.stringify(beforeScan));
  await restoreBackup(beforeScan);
  assert.deepEqual(fingerprint(await localGet('/api/bootstrap')),fingerprint(after));
  // Same payload identity emitted by the start form; outcome generation is not stubbed.
  const saved=await localPost('/api/past-sessions',{year:2022,date:today,session_kind:'scan_only',session_type:'scan5',
    session_purpose:'practice_scan5',scan_minutes:10,scan_evidence_kind:'practice',selected_year_reason:correction.selected_year_reason,
    stable_session_key:correction.stable_session_key,session_instance_id:correction.stable_session_key.split(':').slice(3).join(':'),
    initial_selected_problem_ids:selected,
    questions:questions.map(q=>({...q,completed:false,actualScore:null,actualMinutes:null,predictedMinutes:q.selected?26:null}))});
  const scan=await db.pastSessions.get(saved.sessionId);
  assert.equal(scan.stable_session_key,correction.stable_session_key);
  const reload=await localGet('/api/bootstrap');
  assert.equal(reload.pastSessions.find(s=>s.id===saved.sessionId).session_state,'completed');
  assert.ok(!reload.today.tasks.some(t=>[correction.stable_session_key,raw.stable_session_key].includes(t.stable_session_key)&&!t.checked));
  const observed=reload.pastSessions.find(s=>s.id===722);
  assert.equal(observed.session_elapsed_minutes,100);assert.equal(observed.selection_success_rate,1);
  const backup=await exportBackup();await restoreBackup(backup);
  const restored=await localGet('/api/bootstrap');
  assert.equal(restored.pastSessions.find(s=>s.id===saved.sessionId).stable_session_key,scan.stable_session_key);
  assert.deepEqual(fingerprint(restored),fingerprint(reload));
  const finalAudit=await localPost('/api/integrity/audit',{});
  const details=JSON.stringify(finalAudit.issues.filter(i=>i.severity==='active'));
  assert.equal(finalAudit.blockingIntegrityIssueCount,0,details);assert.equal(finalAudit.plannerPolicyViolationCount,0,details);
  console.log('LOCAL FIXTURE audit after',JSON.stringify({blocking:finalAudit.blockingIntegrityIssueCount,planner:finalAudit.plannerPolicyViolationCount}));
});
