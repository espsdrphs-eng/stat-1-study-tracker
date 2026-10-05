import test from 'node:test';
import assert from 'node:assert/strict';
import {record,pastProblem,problem,attempt} from './adaptiveFixture.mjs';
import {buildPastExamRepairCandidates} from '../src/conceptWeakness.ts';
import {reviewPlanningDecision} from '../src/todayLearningPolicy.ts';
import {runIntegrityAudit} from '../src/integrityEngine.ts';
import {resolveReviewCard} from '../src/reviewCardResolver.ts';
import {buildAdaptivePlannerShadow} from '../src/adaptivePlanner.ts';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {adaptivePlanDayToTasks} from '../src/adaptiveTodayPlan.ts';
import {deriveCurrentTodayProjection} from '../src/currentTodayProjection.ts';
import {reviewExecutionState} from '../src/reviewCurrentState.ts';
import {addCalendarDays} from '../src/reviewSchedulePolicy.ts';
import {buildRepairPrompt} from '../src/gradingPrompt.ts';

// Synthetic, complete contracts and explicit operations; not a production export.
export const source=(id,problemId,date='2026-09-03',patch={})=>attempt(id,problemId,date,{
  score_numeric:45,review_outcome:'failed',grading_confidence:.99,policy_validity:'valid',
  learning_purpose:'error_repair',mode:'main_calc',
  grading_contract:{gradedParts:[{id:'major_calculation',label:'主要計算',masteryLevel:2,
    rootCauseKey:`operation:${problemId}`,stableTargetKey:`target:${problemId}:slot:major_calculation`}]},
  graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'主要計算を完遂できなかった'}],...patch});
export const makeReview=(id,a)=>{
  const part={...a.grading_contract.gradedParts[0],cueLabel:'主要計算',completionCriterionId:'reproduce',allowedErrorTypes:['W','C','none']};
  const c={contractId:`review:${id}:1`,contractVersion:'STAT1-CONTRACT-v2',contractHash:`gc-${id}`,createdAt:'2026-09-01T00:00:00Z',
    problemId:a.problem_id,sourceAttemptId:a.id,reviewId:id,sourceReviewId:id,learningPurpose:'error_repair',learningStage:'repair',
    mode:'main_calc',reviewScope:'targeted_patch',targetKind:'part',targetedParts:['major_calculation'],gradedParts:[part],
    explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:'reproduce',displayText:'主要計算を再現'}],
    hiddenAnswerKey:[],completionConditions:['主要計算を再現'],requiredEvidence:['計算過程'],allowedErrorTypes:['W','C'],
    requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:10,sheetType:'main_calc_sheet'};
  return {id,problem_id:a.problem_id,status:'pending',source_attempt_id:a.id,generated_from_attempt_id:a.id,
    due_date:'2026-09-05',earliest_date:'2026-09-04',preferred_date:'2026-09-05',latest_date:'2026-09-06',
    review_type:'main_calc_retry',learning_purpose:'error_repair',learning_stage:'repair',assessment_timing:'delayed_retrieval',
    effective_mode:'main_calc',estimated_minutes:10,grading_contract:c};
};
const setup=(aa,sessions=[])=>{
  const ids=[...new Set(aa.map(a=>a.problem_id))];
  const rec=record({data:{...record().data,pastExamProblems:ids.map(id=>pastProblem(Number(id.slice(3,7)),Number(id.split('Q')[1])))}});
  const pp=ids.map(id=>({...problem(id,null,'past_exam'),source_type:'past_exam'}));
  return {record:rec,sessions,attempts:aa,conceptWeaknesses:[],problems:pp};
};
test('all current major roots survive eligibility; daily cap is not a per-session eligibility cap',()=>{
  const aa=[1,2,3].map(n=>source(n,`PY-2021-Q${n}`));
  const s={id:1,year:2021,session_kind:'selected_three_timed',linked_attempt_ids:[1,2,3],selected_timed_attempt_ids:[1,2,3],final_selected_problem_ids:aa.map(a=>a.problem_id)};
  const args=setup(aa,[s]),candidates=buildPastExamRepairCandidates(args);
  assert.equal(candidates.filter(c=>c.required).length,3);
  for(const a of aa)assert.equal(reviewPlanningDecision({review:makeReview(a.id,a),attempts:aa,problems:args.problems,
    weaknesses:[],pastExamIsPrimary:true,pastSessions:[s],repairCandidates:candidates}).scheduleAsRequired,true);
});
test('individual repeated failure reaches rediagnosis before repair/retrieval success',()=>{
  const a=source(1,'PY-2017-Q3'),b=source(2,a.problem_id,'2026-09-05');
  const rows=buildPastExamRepairCandidates(setup([a,b]));
  assert.equal(rows.length,1);assert.equal(rows[0].sameRootFailureCount,2);
  assert.equal(rows[0].repairKind,'rediagnosis');assert.equal(rows[0].interventionChanged,true);
});
test('same-day and invalid/duplicate evidence do not inflate recurrence',()=>{
  const a=source(1,'PY-2017-Q3');
  const aa=[a,source(2,a.problem_id,a.date),source(3,a.problem_id,'2026-09-06',{duplicate_of_attempt_id:1}),
    source(4,a.problem_id,'2026-09-07',{exclude_from_recurrence_metrics:true,exclude_from_planning:true})];
  const row=buildPastExamRepairCandidates(setup(aa))[0];
  assert.ok(row);assert.equal(row.sameRootFailureCount,1);assert.equal(row.interventionChanged,false);
});
test('graduation audit distinguishes a session anchor from an individual repeat',()=>{
  const id='PY-2017-Q2',a=source(308,id,'2026-10-06',{mark:'◎',error_type:'none',error_types:['none'],
    mode:'check',learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval',generated_from_review_id:509,
    review_outcome:'success',target_issue_resolved:true,minimum_pass_condition_met:true,graded_part_ids:['major_calculation'],
    graded_findings:[{graded_part_id:'major_calculation',error_type:'none',resolved:true,evidence:'参照なし成功'}]});
  const session={problem_id:id,mode:'exam_90min',minutes:90,past_exam_year:2017,
    past_exam_task_type:'timed_three_question_session',stable_session_key:'session-2017-fixture'};
  const audit=tasks=>runIntegrityAudit({attempts:[a],reviews:[],problems:[{...problem(id),completion_status:'completed'}],
    today:a.date,currentTodayTasks:tasks});
  assert.equal(audit([session]).counts.graduated_but_rescheduled,0);
  assert.equal(audit([{problem_id:id,mode:'full'}]).counts.graduated_but_rescheduled,1);
});
test('session resolver does not resolve an anchor Attempt as individual correction guidance',()=>{
  const a=source(299,'PY-2017-Q4','2026-09-30',{error_point:'Bayes係数',next_action:'最終平均分散'});
  a.date='2026-09-30';
  const p={...problem(a.problem_id),theme:'Bayes',canonical_problem_type:'Bayes'};
  const card=resolveReviewCard({item:{problem_id:a.problem_id,past_exam_year:2017,
    past_exam_task_type:'timed_three_question_session',mode:'exam_90min',stable_session_key:'session-2017-fixture'},
    problems:[p],attempts:[a],aliases:[],today:'2026-10-06'});
  assert.equal(card.targetAttempt,undefined);
  assert.doesNotMatch([card.entryHint.value,card.oneLineHint.value,card.correctionTheme.value].join(' '),/Bayes|最終平均分散/);
});
test('multi-day admission rescues comparable old eligible roots without evicting a carried session',()=>{
  const aa=['PY-2018-Q3','PY-2018-Q5','PY-2021-Q1','PY-2016-Q1','PY-2017-Q4','PY-2023-Q1']
    .map((id,i)=>source(10+i,id,i<4?'2026-09-03':'2026-10-05'));
  const args=setup(aa),reviews=aa.map((a,i)=>makeReview(400+i,a));
  // A recent repeated root coexists with old unprocessed roots. The prior
  // failure is a distinct valid date, not another Review or a same-day copy.
  aa.push(source(8,'PY-2017-Q4','2026-09-28'));
  assert.equal(buildPastExamRepairCandidates(args).find(r=>r.sourceProblemId==='PY-2017-Q4')?.sameRootFailureCount,2);
  for(const r of reviews.slice(4)){r.latest_date='2026-10-06';r.preferred_date=r.due_date='2026-10-06';}
  const optional=makeReview(900,source(900,'WB-2-A-01'));
  optional.problem_id='WB-2-A-01';optional.grading_contract.problemId=optional.problem_id;
  reviews.push(optional);args.problems.push(problem(optional.problem_id));
  args.record.data.pastExamProblems.push(...[1,2,3,4,5].map(n=>pastProblem(2017,n)),pastProblem(2024),pastProblem(2025));
  const catalog=buildPastExamCatalog({record:args.record,sessions:[],attempts:aa});
  const session={problem_id:'PY-2017-Q4',title:'2017年 本番型session',mode:'exam_90min',minutes:90,triage:'must',
    past_exam_year:2017,past_exam_year_role:'training_pool',past_exam_task_type:'timed_three_question_session',
    past_exam_session_state:'planned',stable_session_key:'past_exam_session:2017:timed_three_question_session:session-2017-fixture',
    session_problem_ids:[1,2,3,4,5].map(n=>`PY-2017-Q${n}`),clean_selection_evidence:false,
    selected_year_reason:'既露出の2017をtraining sessionとして実施する'};
  for(const row of catalog)if(!args.problems.some(p=>p.problem_id===row.canonicalProblemId))
    args.problems.push({...problem(row.canonicalProblemId,null,'past_exam'),source_type:'past_exam'});
  assert.ok(reviews.every(r=>reviewExecutionState(r,'2026-10-06')==='actionable'));
  const admitted=new Set(),trace=[];
  for(let offset=0;offset<4;offset++){
    const today=addCalendarDays('2026-10-06',offset);
    const shadow=buildAdaptivePlannerShadow({...args,catalog,reviews,pastSessions:[],weaknesses:[],
      currentTasks:[session],today,examDate:'2026-11-15',targetMinutes:120,repairCandidates:[]});
    const day=shadow.plan14.plan[0],required=day.tasks.filter(t=>t.slot==='repair');
    assert.ok(day.tasks.some(t=>t.stableSessionKey===session.stable_session_key));
    assert.ok(day.totalMinutes<=120);assert.ok(required.length<=2);
    assert.ok(required.reduce((n,t)=>n+t.minutes,0)<=30);
    assert.ok(!day.tasks.some(t=>t.reviewId===900&&t.slot==='repair'));
    assert.ok(!day.tasks.some(t=>t.pastExamYear===2024||t.pastExamYear===2025));
    const decisions=shadow.plan14.reviewSchedule.decisions.filter(d=>d.date===today);
    assert.ok(decisions.filter(d=>!d.admitted&&['root_cap','budget'].includes(d.reason)).every(d=>d.reevaluateOn===addCalendarDays(today,1)));
    trace.push({today,admitted:required.map(t=>t.reviewId),waiting:decisions.filter(d=>!d.admitted).map(d=>[d.reviewId,d.waitingDays,d.reason])});
    // Sandbox execution events only: a displayed/selected session is NOT completed.
    for(const t of required){admitted.add(t.reviewId);reviews.find(r=>r.id===t.reviewId).status='done';}
  }
  assert.ok([400,401,402,403].every(id=>admitted.has(id)),JSON.stringify(trace));
  assert.equal(args.sessions.length,0); // Repeated plan appearances did not create execution rows.
  console.log('FIXTURE admission trace',JSON.stringify(trace));
});
test('graduated baseline Review stays history through projection and JSON roundtrip',()=>{
  const a=source(308,'PY-2017-Q2','2026-10-06',{mode:'check',learning_purpose:'retrieval_check',
    assessment_timing:'delayed_retrieval',generated_from_review_id:509,score_numeric:100,mark:'◎',
    review_outcome:'success',error_type:'none',error_types:['none'],graded_part_ids:['major_calculation'],
    target_issue_resolved:true,minimum_pass_condition_met:true,
    graded_findings:[{graded_part_id:'major_calculation',resolved:true,error_type:'none',evidence:'成功'}]});
  const r=makeReview(509,a);r.status='done';r.effective_mode='check';
  const baseline={...r,mode:'check',minutes:5,triage:'must'};
  const session={problem_id:a.problem_id,mode:'exam_90min',minutes:90,triage:'must',past_exam_year:2017,
    past_exam_task_type:'timed_three_question_session',stable_session_key:'session-fixture',past_exam_session_state:'planned'};
  const snapshot={date:a.date,created_at:'2026-10-05T20:00:00Z',tasks:[baseline,session],start_of_day_planned_minutes:95};
  const state={snapshot,generatedTasks:[session],attempts:[a],reviews:[r],today:a.date,completedMinutes:5,targetMinutes:120};
  const first=deriveCurrentTodayProjection(state),second=deriveCurrentTodayProjection(JSON.parse(JSON.stringify(state)));
  assert.ok(!first.tasks.some(t=>t.id===509));assert.deepEqual(first.tasks,second.tasks);
  assert.equal(snapshot.tasks[0].id,509);assert.equal(snapshot.tasks.length,2);
  assert.equal(first.tasks[0].stable_session_key,session.stable_session_key);
});
test('re-diagnosis prompt is scoped scaffold work, not another full answer or transfer success',()=>{
  const text=buildRepairPrompt({problemId:'PY-2017-Q3',repairLineage:{sourceProblemId:'PY-2017-Q3',sourceAttemptId:300,
    sourceFindingId:'major_calculation',sourceFindingIds:['major_calculation'],rootWeaknessId:'root:fixture',
    intervention:'rediagnosis',observedFailure:'Taylor一次項の相殺',rootConceptId:'operation:fixture',
    materiality:'major',recurrence:2,examImpact:'high',repairProblemId:'PY-2017-Q3',matchReason:'同rootの再失敗'}});
  assert.match(text,/Taylor一次項の相殺/);assert.match(text,/最小の一段/);assert.match(text,/保持・transfer成功とは判定しない/);
});

test('graduated individual is not readmitted inside cooldown while an annual session may include it',()=>{
  const a=source(308,'PY-2017-Q2','2026-10-06',{mode:'check',learning_purpose:'retrieval_check',
    assessment_timing:'delayed_retrieval',mark:'◎',score_numeric:100,review_outcome:'success',
    target_issue_resolved:true,minimum_pass_condition_met:true,error_type:'none',error_types:['none'],
    graded_findings:[{graded_part_id:'major_calculation',resolved:true,error_type:'none',evidence:'参照なし成功'}]});
  const args=setup([a]);
  const catalog=buildPastExamCatalog({record:args.record,sessions:[],attempts:[a]});
  const shadow=buildAdaptivePlannerShadow({...args,catalog,reviews:[],pastSessions:[],weaknesses:[],
    currentTasks:[],today:a.date,examDate:'2026-11-15',targetMinutes:120,repairCandidates:[]});
  assert.ok(!shadow.plan14.plan.flatMap(d=>d.tasks).some(t=>t.problemId===a.problem_id&&t.pastExamTaskType==='individual_full'));
});
