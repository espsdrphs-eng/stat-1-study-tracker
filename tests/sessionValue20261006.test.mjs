import test from 'node:test';
import assert from 'node:assert/strict';
import {record,pastProblem,problem} from './adaptiveFixture.mjs';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {buildAdaptivePlannerShadow} from '../src/adaptivePlanner.ts';
import {derivePastExamWorkspace,derivePastExamSessionAdmission,projectPastExamSessionAdmissions} from '../src/pastExamPlanning.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {runIntegrityAudit} from '../src/integrityEngine.ts';
import {adaptivePlanDayToTasks} from '../src/adaptiveTodayPlan.ts';
import {deriveCurrentTodayProjection} from '../src/currentTodayProjection.ts';
import {addCalendarDays} from '../src/reviewSchedulePolicy.ts';

// Synthetic explicit exposure and execution evidence, not a complete production export.
const setup=(year=2017,withNeed=false)=>{
  const rec=record();
  rec.data.pastExamProblems=[year,2022].flatMap(y=>[1,2,3,4,5].map(q=>pastProblem(y,q,['c1'],
    {exposure_default:y===year?'fully_attempted':'unseen'})));
  const sessions=withNeed?[{id:9,year:2018,date:'2026-09-29',session_kind:'selected_three_timed',
    attempt_completed_at:'2026-09-29T12:00:00Z',actual_total_minutes:110,
    questions:[1,2,3].map(q=>({questionLabel:`問${q}`,selected:true,completed:true,actualScore:50,actualMinutes:35}))}]:[];
  const catalog=buildPastExamCatalog({record:rec,sessions,attempts:[]});
  const problems=catalog.map(r=>({...problem(r.canonicalProblemId,null,'past_exam'),source_type:'past_exam'}));
  const sticky={problem_id:`PY-${year}-Q4`,title:`${year}年 本番型session`,mode:'exam_90min',minutes:90,triage:'must',
    past_exam_year:year,past_exam_year_role:'training_pool',past_exam_task_type:'timed_three_question_session',
    past_exam_session_state:'planned',stable_session_key:`past_exam_session:${year}:timed_three_question_session:session-${year}-1`,
    session_problem_ids:[1,2,3,4,5].map(q=>`PY-${year}-Q${q}`),clean_selection_evidence:false,
    selected_year_reason:'既露出年度の選題・時間内完遂'};
  const args={record:rec,catalog,problems,attempts:[],reviews:[],pastSessions:sessions,weaknesses:[],repairCandidates:[],
    currentTasks:[sticky],today:'2026-10-06',examDate:'2026-11-15',targetMinutes:120};
  return {args,sticky};
};
for(const year of [2017,2020])test(`fully exposed ${year} without session deficit cannot displace clean measurement`,()=>{
  const {args,sticky}=setup(year);
  const day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(!day.tasks.some(t=>t.stableSessionKey===sticky.stable_session_key&&t.slot==='score_building'));
  assert.ok(day.tasks.some(t=>t.pastExamYear===2022&&t.cleanSelectionEvidence));
});
test('observed time overrun permits an exposed timed retraining session',()=>{
  const {args,sticky}=setup(2017,true);
  args.catalog=args.catalog.filter(row=>row.year!==2022); // No higher-information measurement is available.
  const day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(day.tasks.some(t=>t.stableSessionKey===sticky.stable_session_key));
});
test('a clean measurement wins over unstarted exposed retraining even when timed weakness exists',()=>{
  const {args}=setup(2017,true);
  assert.equal(buildAdaptivePlannerShadow(args).plan14.plan[0].tasks.find(t=>t.kind==='timed')?.pastExamYear,2022);
});
test('workspace and planner do not pin an unstarted low-value raw session',()=>{
  const {args}=setup();
  args.pastSessions.push({id:1,year:2017,date:'2026-10-02',session_kind:'selected_three_timed',
    selected_year_reason:'既露出年度',scan_evidence_kind:'practice',questions:[],session_state:'planned'});
  const workspace=derivePastExamWorkspace({...args,daysRemaining:40});
  assert.equal(workspace.recommended?.year,2022);
  assert.equal(buildAdaptivePlannerShadow(args).plan14.plan[0].tasks.find(t=>t.kind==='timed')?.pastExamYear,2022);
});
test('14 read-only daily replans never turn unsupported exposed training into must',()=>{
  const {args,sticky}=setup();
  const trace=[];
  for(let i=0;i<14;i++){
    const today=addCalendarDays(args.today,i),day=buildAdaptivePlannerShadow({...args,today}).plan14.plan[0];
    assert.ok(!day.tasks.some(t=>t.stableSessionKey===sticky.stable_session_key&&t.slot==='score_building'));
    assert.ok(day.totalMinutes<=120);
    trace.push({today,selected:day.tasks.map(t=>t.problemId)});
  }
  assert.equal(args.pastSessions.length,0); // Selection is not execution.
});

test('an unexecuted carried session does not count as weekly scan or timed execution',()=>{
  const {args}=setup();
  args.pastSessions.push({id:1,year:2017,date:args.today,session_kind:'selected_three_timed',
    scan_evidence_kind:'practice',questions:[],session_state:'planned'});
  const actual=buildAdaptivePlannerShadow(args).weeklyActual;
  assert.equal(actual.scan5,0);assert.equal(actual.fullOrTimed,0);assert.equal(actual.pastExam,0);
});

const major=(args,id=11)=>{
  const a={id,problem_id:'PY-2017-Q3',date:'2026-10-05',mode:'full',time_minutes:30,score_numeric:45,
    score_label:'C',mark:'△',error_type:'W',error_types:['W'],policy_validity:'valid',grading_confidence:.99,
    actual_reference_level:0,session_role:'selected_timed',review_outcome:'failed',
    grading_contract:{gradedParts:[{id:'major_calculation',masteryLevel:2,rootSkillIds:['c1'],
      stableTargetKey:'target:PY-2017-Q3:slot:major_calculation'}]},
    graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'主要計算を完遂できない'}]};
  const root=deriveFailureEpisode(a).rootWeaknesses[0];
  args.attempts=[a];
  const c={sourceAttemptId:id,sourceProblemId:a.problem_id,sourceFindingId:'major_calculation',sourceFindingIds:['major_calculation'],
    rootWeaknessId:root.rootWeaknessId,conceptId:'c1',conceptLabel:'主要計算',required:true,repairKind:'same_problem',
    materiality:'major',examImpact:'high',recurrence:0,weaknessSkillIds:['c1'],matchedSkillIds:[],
    whitebookProblemIds:[],transferProblemIds:[],reason:'実答案のmajor失点',matchReason:'同一問題の失点箇所だけ局所補修'};
  return {a,c};
};
test('today admits a short local repair without waiting forever for tomorrow slot',()=>{
  const {args}=setup(),{c}=major(args);
  args.repairCandidates=[c];
  const day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(day.tasks.some(t=>t.repairLineage?.rootWeaknessId===c.rootWeaknessId&&t.minutes===7&&t.mode==='skeleton'));
  assert.ok(day.tasks.some(t=>t.pastExamYear===2022&&t.kind==='timed'));
  assert.ok(day.totalMinutes<=120);
});
test('an eligible different PastExam transfer fits as exam practice, not a >30 minute local repair',()=>{
  const {args}=setup(),{c}=major(args);
  args.targetMinutes=150;
  args.problems.push({...problem('PY-2023-Q1',null,'past_exam'),source_type:'past_exam'});
  args.repairCandidates=[{...c,repairKind:'transfer',transferProblemIds:['PY-2023-Q1'],
    repairSuccessEvidenceId:'fixture-repair-success'}]; // Canonical eligible candidate input, not a success assertion.
  const day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(day.tasks.some(t=>t.purpose==='transfer_check'&&t.problemId==='PY-2023-Q1'&&t.minutes===35));
  assert.ok(day.tasks.some(t=>t.kind==='timed'&&t.pastExamYear===2022));
  assert.ok(day.totalMinutes<=150);
});
test('budget shortage retains a genuine prerequisite blocker, not its 90 minute measurement',()=>{
  const {args}=setup(),{a}=major(args);
  args.targetMinutes=90;
  const contract={...a.grading_contract,sourceAttemptId:a.id,problemId:a.problem_id,reviewId:41,
    contractId:'review:41:1',contractVersion:'STAT1-CONTRACT-v2',contractHash:'fixture-blocker',sourceReviewId:41,
    createdAt:'2026-10-05T00:00:00Z',targetKind:'part',
    learningPurpose:'error_repair',learningStage:'repair',mode:'main_calc',reviewScope:'targeted_patch',
    estimatedMinutes:12,allowedReferenceLevel:0,targetedParts:['major_calculation'],
    gradedParts:a.grading_contract.gradedParts.map(p=>({...p,label:'主要計算',cueLabel:'主要計算',
      allowedErrorTypes:['W','C','none'],completionCriterionId:'reproduce'})),
    completionCriteria:[{id:'reproduce',displayText:'主要計算を再現'}],explicitlyOutOfScopePartIds:[],
    explicitlyOutOfScopeParts:[],hiddenAnswerKey:[],completionConditions:['主要計算を再現'],
    requiredEvidence:['計算過程'],allowedErrorTypes:['W','C'],requiresKEvidence:false,sheetType:'main_calc_sheet'};
  args.reviews=[{id:41,problem_id:a.problem_id,status:'pending',source_attempt_id:a.id,generated_from_attempt_id:a.id,
    review_type:'main_calc_retry',learning_purpose:'error_repair',learning_stage:'repair',effective_mode:'main_calc',
    due_date:'2026-10-06',earliest_date:'2026-10-06',preferred_date:'2026-10-06',latest_date:'2026-10-07',
    estimated_minutes:12,grading_contract:contract}];
  const day=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(day.tasks.some(t=>t.reviewId===41&&t.hardBlocker),JSON.stringify({tasks:day.tasks,root:deriveFailureEpisode(a).rootWeaknesses}));
  assert.ok(!day.tasks.some(t=>t.kind==='timed'));
  assert.ok(day.totalMinutes<=90);
  assert.ok(buildAdaptivePlannerShadow(args).plan14.sessionDecisions.some(d=>
    d.year===2022&&d.disposition==='deferred'&&/予算/.test(d.reason)));
  args.reviews[0].estimated_minutes=35;
  args.reviews[0].grading_contract.estimatedMinutes=35;
  const longer=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(longer.tasks.some(t=>t.reviewId===41&&t.hardBlocker&&t.minutes===35));
  assert.ok(longer.totalMinutes<=90);
  args.targetMinutes=150;
  const largeBudget=buildAdaptivePlannerShadow(args).plan14.plan[0];
  assert.ok(largeBudget.tasks.some(t=>t.reviewId===41&&t.hardBlocker));
  assert.ok(!largeBudget.tasks.some(t=>t.kind==='timed')); // Preserve the pre-session 30-minute cap.
});
test('completed execution deficits differ from pending answers and low scores',()=>{
  const {args}=setup();
  const prior={id:7,year:2018,date:'2026-10-01',session_kind:'selected_three_timed',
    questions:[1,2,3].map(q=>({questionLabel:`問${q}`,selected:true,completed:q!==3,actualScore:20,actualMinutes:25})),
    actual_total_minutes:85};
  const decide=s=>derivePastExamSessionAdmission({year:2017,catalog:args.catalog,pastSessions:[s],today:args.today});
  assert.equal(decide(prior).required,false); // ongoing or ungraded is not a verified deficit
  assert.equal(decide({...prior,attempt_completed_at:'2026-10-01T12:00:00Z'}).required,true);
  assert.equal(decide({...prior,questions:prior.questions.map(q=>({...q,completed:true})),
    attempt_completed_at:'2026-10-01T12:00:00Z'}).required,false); // low score alone
});
test('projection, explanation, audit and roundtrip share one intentional deferral',()=>{
  const {args,sticky}=setup();
  const shadow=buildAdaptivePlannerShadow(args),day=shadow.plan14.plan[0];
  const tasks=adaptivePlanDayToTasks({day,problems:args.problems,reviews:[],today:args.today});
  const snapshot={date:args.today,created_at:'2026-10-05T20:00:00Z',tasks:[sticky],start_of_day_planned_minutes:90};
  const current=deriveCurrentTodayProjection({snapshot,generatedTasks:tasks,attempts:[],pastSessions:[],reviews:[],
    today:args.today,completedMinutes:0,targetMinutes:120});
  assert.ok(!current.tasks.some(t=>t.stable_session_key===sticky.stable_session_key));
  assert.equal(snapshot.tasks[0],sticky);
  assert.equal(shadow.plan14.sessionDecisions[0].disposition,'deferred');
  assert.ok(shadow.plan14.sessionDecisions[0].reason);
  const audit=t=>runIntegrityAudit({attempts:[],reviews:[],problems:args.problems,pastExamCatalog:args.catalog,
    today:args.today,todayPlanSnapshots:[snapshot],currentTodayTasks:t,currentPlanSummary:shadow.plan14});
  assert.equal(audit([sticky]).counts.unsupported_exposed_session_required,1);
  const after=audit(current.tasks);
  assert.equal(after.counts.unsupported_exposed_session_required,0);
  assert.equal(after.counts.unexecuted_past_session_replaced,0);
  assert.deepEqual(buildAdaptivePlannerShadow(JSON.parse(JSON.stringify(args))).plan14,shadow.plan14);
  const raw=[{id:1,year:2017,date:'2026-10-02',session_kind:'selected_three_timed',questions:[],selected_year_reason:'training'}];
  const projected=projectPastExamSessionAdmissions({catalog:args.catalog,pastSessions:raw,today:args.today,daysRemaining:40});
  assert.equal(projected[0].session_state,'deferred');assert.equal(raw[0].session_state,undefined);
  assert.deepEqual(projectPastExamSessionAdmissions({catalog:args.catalog,pastSessions:projected,today:args.today,daysRemaining:40}),projected);
});
