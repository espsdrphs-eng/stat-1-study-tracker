import test from 'node:test';
import assert from 'node:assert/strict';
import {record,pastProblem,problem} from './adaptiveFixture.mjs';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {derivePastExamSessionAdmission,projectPastExamSessionAdmissions,derivePastExamWorkspace,pastExamCorrectionKey} from '../src/pastExamPlanning.ts';
import {buildAdaptivePlannerShadow} from '../src/adaptivePlanner.ts';
import {adaptivePlanDayToTasks} from '../src/adaptiveTodayPlan.ts';
import {deriveCurrentTodayProjection} from '../src/currentTodayProjection.ts';
import {runIntegrityAudit} from '../src/integrityEngine.ts';
import {addCalendarDays} from '../src/reviewSchedulePolicy.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';

// Confirmed production fields; IDs, catalog, timestamps, scan answers and
// unrelated repair metadata are synthetic. This is NOT a full export copy.
const fixture=(solve=90,error='score_overconfidence')=>{
  const rec=record();rec.data.pastExamProblems=[2017,2022,2024,2025].flatMap(y=>[1,2,3,4,5].map(q=>pastProblem(y,q,['c1'])));
  const completed={id:22,year:2022,date:'2026-10-01',session_kind:'selected_three_timed',
    session_instance_id:'measured-2022',scan_evidence_kind:'clean',scan_minutes:10,
    prompt_scanned_at:'2026-10-01T09:00:00Z',attempt_completed_at:'2026-10-01T11:00:00Z',
    scan_submitted:true,selected_problem_ids:[2,3,4].map(q=>`PY-2022-Q${q}`),
    selected_solve_minutes:solve,session_elapsed_minutes:solve+10,actual_total_minutes:solve+10,
    selected_answer_count:3,selection_evaluation_status:'complete',selection_success_count:3,
    selection_target_count:3,selection_success_rate:1,session_state:'completed',
    analysis:{primary_selection_error:error},
    questions:[1,2,3,4,5].map(q=>({problemId:`PY-2022-Q${q}`,questionLabel:`問${q}`,selected:[2,3,4].includes(q),
      predictedScore:70,actualScore:[2,3,4].includes(q)?50:20,actualMinutes:[2,3,4].includes(q)?solve/3:15,
      completed:true,sank:false,predictedType:'型',firstStep:'入口'}))};
  const key='past_exam_session:2017:timed_three_question_session:session-2017-1';
  const planned={id:17,year:2017,date:'2026-10-02',session_instance_id:'session-2017-1',
    stable_session_key:key,session_kind:'selected_three_timed',scan_evidence_kind:'practice',
    exposure_snapshot_at_start:{classification:'practice'},session_state:'planned',questions:[],selected_year_reason:'既露出training'};
  const pastSessions=[completed,planned];
  // Explicit exposure is supplemented; an empty raw planned row does not establish exposure.
  const catalog=buildPastExamCatalog({record:rec,sessions:pastSessions,attempts:[]})
    .map(row=>({...row,exposure:row.year<=2022?'fully_attempted':'unseen'}));
  const sticky={problem_id:'PY-2017-Q4',title:'2017年 本番型session',mode:'exam_90min',minutes:90,triage:'must',
    past_exam_year:2017,past_exam_year_role:'training_pool',past_exam_task_type:'timed_three_question_session',
    past_exam_session_state:'planned',stable_session_key:key,session_problem_ids:[1,2,3,4,5].map(q=>`PY-2017-Q${q}`),
    clean_selection_evidence:false,selected_year_reason:'既露出training'};
  return {record:rec,catalog,pastSessions,currentTasks:[sticky],attempts:[],reviews:[],weaknesses:[],repairCandidates:[],
    problems:catalog.map(row=>({...problem(row.canonicalProblemId,null,'past_exam'),source_type:'past_exam'})),
    today:'2026-10-06',examDate:'2026-11-15',targetMinutes:90,key};
};
const decide=args=>derivePastExamSessionAdmission({...args,year:2017});
test('A: scan10 + solve80 remains a genuine 90-minute completion',()=>{
  const d=decide(fixture(80,null));assert.equal(d.required,false);assert.equal(d.deficits.length,0);
});
test('B/C/H: modest total overrun and score optimism retain evidence but not full approval',()=>{
  for(const [solve,error] of [[90,null],[90,'score_overconfidence'],[80,'score_overconfidence']]){
    const d=decide(fixture(solve,error));
    assert.equal(d.required,false);assert.equal(d.fullSessionApproved,false);
    assert.equal(d.minimumIntervention,'practice_scan5');
    assert.equal(d.deficits.some(x=>x.kind==='total_timing'),solve===90);
    if(solve===90){assert.match(d.reason,/100分/);assert.match(d.reason,/80分/);}
    assert.doesNotMatch(d.reason,/選題.*失敗|完遂.*失敗/);
  }
});
test('E/F: unfinished answers and serious sink overrun can justify full rehearsal',()=>{
  for(const change of [s=>s.questions[3].completed=false,s=>{s.questions[2].sank=true;s.session_elapsed_minutes=125;}]){
    const args=fixture();change(args.pastSessions[0]);
    assert.equal(decide(args).fullSessionApproved,true);assert.equal(decide(args).required,true);
  }
});
test('I/L/M/N: planned/sticky full cannot resurrect over 14 replans; short correction leaves repair budget',()=>{
  const args=fixture();
  const a={id:55,problem_id:'PY-2017-Q3',date:'2026-10-05',mode:'full',time_minutes:30,score_numeric:40,
    score_label:'C',mark:'△',error_type:'W',error_types:['W'],policy_validity:'valid',grading_confidence:.99,
    actual_reference_level:0,session_role:'selected_timed',review_outcome:'failed',
    grading_contract:{gradedParts:[{id:'major_calculation',masteryLevel:2,rootSkillIds:['c1'],stableTargetKey:'target:PY-2017-Q3:slot:major_calculation'}]},
    graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'主要計算の失点'}]};
  const root=deriveFailureEpisode(a).rootWeaknesses[0];args.attempts=[a];
  args.repairCandidates=[{sourceAttemptId:a.id,sourceProblemId:a.problem_id,sourceFindingId:'major_calculation',sourceFindingIds:['major_calculation'],
    rootWeaknessId:root.rootWeaknessId,conceptId:'c1',required:true,repairKind:'same_problem',materiality:'major',examImpact:'high',
    recurrence:0,weaknessSkillIds:['c1'],matchedSkillIds:[],whitebookProblemIds:[],transferProblemIds:[],reason:'major失点',matchReason:'局所補修'}];
  const original=JSON.stringify(args.pastSessions),keys=[];
  for(let i=0;i<14;i++){
    const today=addCalendarDays(args.today,i),input={...args,today},shadow=buildAdaptivePlannerShadow(input),day=shadow.plan14.plan[0];
    assert.ok(!day.tasks.some(t=>t.stableSessionKey===args.key));
    const correction=day.tasks.find(t=>t.pastExamTaskType==='practice_scan5');
    if(correction){
      assert.equal(correction.minutes,10);keys.push(correction.stableSessionKey);
      assert.ok(day.tasks.some(t=>t.repairLineage?.rootWeaknessId===root.rootWeaknessId&&t.minutes===7));
    }else assert.ok(day.tasks.some(t=>t.pastExamYear===2024&&t.kind==='timed')); // Release window is not held artificially.
    assert.ok(day.totalMinutes<=90);
    const tasks=adaptivePlanDayToTasks({day,problems:args.problems,reviews:[],today});
    const snapshot={date:today,created_at:today+'T00:00:00Z',tasks:args.currentTasks,start_of_day_planned_minutes:90};
    const projected=deriveCurrentTodayProjection({snapshot,generatedTasks:tasks,attempts:args.attempts,
      pastSessions:args.pastSessions,reviews:[],today,completedMinutes:0,targetMinutes:90});
    assert.ok(!projected.tasks.some(t=>t.stable_session_key===args.key&&!t.checked));
    assert.deepEqual(buildAdaptivePlannerShadow(JSON.parse(JSON.stringify(input))).plan14,shadow.plan14);
  }
  assert.ok(keys.length>0);assert.equal(new Set(keys).size,1);assert.equal(JSON.stringify(args.pastSessions),original);
});
test('D/J: a nearby benchmark retains its release conditions and replaces—not duplicates—full rehearsal',()=>{
  const args=fixture();args.today='2026-10-07'; // 39 days: benchmark release window
  const day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(!day.tasks.some(t=>t.stableSessionKey===args.key));
  assert.ok(day.tasks.some(t=>t.pastExamYear===2024&&t.kind==='timed'));
  const projected=projectPastExamSessionAdmissions({...args,daysRemaining:39});
  assert.equal(projected.find(s=>s.year===2017).session_state,'deferred');
});
test('audit rejects unjustified full while preserving scan correction and historical snapshot',()=>{
  const args=fixture();const audit=runIntegrityAudit({attempts:[],reviews:[],problems:args.problems,
    pastSessions:args.pastSessions,pastExamCatalog:args.catalog,today:args.today,currentTodayTasks:args.currentTasks});
  assert.equal(audit.counts.unsupported_exposed_session_required,1);
});

test('G: paired unreferenced outcomes—not low score alone—prove timed context degradation',()=>{
  const args=fixture(80,null);
  args.pastSessions[0].questions.filter(q=>q.selected).forEach((q,i)=>q.sourceAttemptId=100+i);
  args.attempts=[2,3,4].flatMap((q,i)=>[
    {id:10+i,problem_id:`PY-2022-Q${q}`,date:'2026-09-20',mode:'full',score_numeric:90,actual_reference_level:0,policy_validity:'valid'},
    {id:100+i,problem_id:`PY-2022-Q${q}`,date:'2026-10-01',mode:'full',score_numeric:40,actual_reference_level:0,policy_validity:'valid'}]);
  assert.equal(decide(args).fullSessionApproved,true);
  args.attempts=args.attempts.filter(a=>a.id>=100);
  assert.equal(decide(args).fullSessionApproved,false);
});
test('short correction is shared with workspace, survives pinning, and stops after executed scan',()=>{
  const args=fixture(),workspace=derivePastExamWorkspace({...args,daysRemaining:40});
  assert.equal(workspace.recommended.taskType,'practice_scan5');
  const key=workspace.recommended.stableSessionKey;
  const scan={id:23,year:2022,date:args.today,session_kind:'scan_only',scan_evidence_kind:'practice',
    session_purpose:'practice_scan5',session_instance_id:key.split(':').slice(3).join(':'),stable_session_key:key,
    questions:[],selected_year_reason:workspace.recommended.selectedYearReason,session_state:'planned'};
  args.pastSessions.push(scan);
  let day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.equal(day.tasks.find(t=>t.stableSessionKey===key).minutes,10);
  assert.equal(day.tasks.find(t=>t.stableSessionKey===key).kind,'scan5');
  scan.prompt_scanned_at=args.today+'T09:00:00Z';scan.scan_minutes=10;scan.scan_submitted=true;
  scan.questions=args.pastSessions[0].questions.map(q=>({...q,actualScore:null,actualMinutes:null,completed:false}));
  scan.session_state='completed';
  day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(!day.tasks.some(t=>t.stableSessionKey===key));
  assert.equal(decide(args).deficits.find(d=>d.kind==='total_timing').unresolved,true); // Await full benchmark, not fake success.
});
test('later valid full completion supersedes old total overrun without deleting history',()=>{
  const args=fixture();
  args.pastSessions.push({...structuredClone(args.pastSessions[0]),id:24,year:2024,session_instance_id:'benchmark-2024',
    date:'2026-10-05',attempt_completed_at:'2026-10-05T11:00:00Z',scan_minutes:10,selected_solve_minutes:80,
    session_elapsed_minutes:90,actual_total_minutes:90,analysis:{},
    questions:args.pastSessions[0].questions.map(q=>({...q,problemId:q.problemId.replace('2022','2024'),actualMinutes:q.selected?80/3:15}))});
  const d=decide(args);
  assert.equal(d.fullSessionApproved,false);
  assert.equal(d.deficits.find(x=>x.kind==='total_timing').unresolved,false);
  assert.equal(args.pastSessions[0].session_elapsed_minutes,100);
});
test('a newer complete 100-minute measurement supersedes older severe timing/sink evidence, without claiming pacing is fixed',()=>{
  const args=fixture(),older=structuredClone(args.pastSessions[0]);
  Object.assign(older,{id:19,year:2019,date:'2026-09-20',session_instance_id:'older-2019',
    attempt_completed_at:'2026-09-20T11:00:00Z',session_elapsed_minutes:150,actual_total_minutes:150});
  older.questions=older.questions.map(q=>({...q,problemId:q.problemId.replace('2022','2019'),sank:q.selected}));
  args.pastSessions.unshift(older);
  const d=decide(args);
  assert.equal(d.required,false);assert.equal(d.fullSessionApproved,false);
  assert.equal(d.deficits.find(x=>x.kind==='total_timing'&&x.sourceDate==='2026-10-01').unresolved,true);
  assert.equal(d.deficits.find(x=>x.kind==='total_timing'&&x.sourceDate==='2026-09-20').resolution,'superseded');
  assert.equal(d.deficits.find(x=>x.kind==='sink').unresolved,false);
});
test('selection-choice error calls for scan, not automatic full; renewed deficit after correction can justify full',()=>{
  const args=fixture(80,null);args.pastSessions[0].selection_success_count=2;args.pastSessions[0].selection_success_rate=2/3;
  assert.equal(decide(args).minimumIntervention,'practice_scan5');assert.equal(decide(args).required,false);
  const timed=fixture().pastSessions[0];args.pastSessions=[timed];
  const key=pastExamCorrectionKey('past_exam_session:2022:timed_three_question_session:measured-2022',2022);
  args.pastSessions.push({id:23,year:2022,date:'2026-10-02',session_kind:'scan_only',scan_evidence_kind:'practice',
    session_instance_id:key.split(':').slice(3).join(':'),session_state:'completed',scan_submitted:true,scan_minutes:10,
    prompt_scanned_at:'2026-10-02T10:00:00Z',questions:timed.questions});
  args.pastSessions.push({...structuredClone(timed),id:24,year:2023,date:'2026-10-04',session_instance_id:'measured-2023',
    attempt_completed_at:'2026-10-04T12:00:00Z'});
  assert.equal(decide(args).fullSessionApproved,true);
});

test('2024 required repair gate is not released to fill the gap with an exposed full session',()=>{
  const args=fixture();args.today='2026-10-07';
  args.attempts=[{id:302,problem_id:'PY-2022-Q2',date:'2026-10-01',mode:'full',time_minutes:30,score_numeric:50,
    score_label:'C',mark:'△',error_type:'W',error_types:['W'],policy_validity:'valid',grading_confidence:.99,actual_reference_level:0,
    session_role:'selected_timed',review_outcome:'failed',
    grading_contract:{gradedParts:[{id:'major_calculation',masteryLevel:2,rootSkillIds:['c1'],stableTargetKey:'target:PY-2022-Q2:slot:major_calculation'}]},
    graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'未修復の主要計算'}]}];
  args.pastSessions[0].selected_timed_attempt_ids=[302];
  const day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(!day.tasks.some(t=>t.pastExamYear===2024));
  assert.ok(!day.tasks.some(t=>t.stableSessionKey===args.key));
  assert.ok(day.tasks.some(t=>t.pastExamTaskType==='practice_scan5'&&t.minutes===10));
});
