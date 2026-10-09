import test from 'node:test';
import assert from 'node:assert/strict';
import {attempt,record,pastProblem,problem} from './adaptiveFixture.mjs';
import {buildPastExamRepairCandidates} from '../src/conceptWeakness.ts';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {buildAdaptivePlannerShadow} from '../src/adaptivePlanner.ts';
import {buildPastExamYearCandidates} from '../src/pastExamPlanning.ts';
import {resolvePersistedAttemptLifecycle} from '../src/reviewTransition.ts';

// Structural reproduction, not supplemented production records.
const legacy=(id,p='PY-2016-Q4')=>attempt(id,p,'2026-08-23',{
  learning_purpose:'integration_check',graded_findings:[],error_types:['W'],error_type:'W',
  error_point:'係数を失って主要計算が未完',grading_contract:undefined});
const success=(id,source,p='PY-2016-Q4',purpose='error_repair')=>attempt(id,p,'2026-09-26',{
  learning_purpose:purpose,score_numeric:100,actual_reference_level:0,grading_confidence:.99,
  error_types:['none'],error_type:'none',minimum_pass_condition_met:true,target_issue_resolved:true,review_outcome:'success',
  grading_contract:{gradedParts:[{id:`part:${p}:${source}:1`,stableTargetKey:`target:${p}:root:f1d91adc-3626-4cf8-81da-542149f100fb`}]},
  graded_findings:[{graded_part_id:`part:${p}:${source}:1`,error_type:'none',resolved:true,evidence:'参照なし再現'}]});
test('explicit legacy source target success removes old required repair, not root transfer pending',()=>{
  const rec=record();rec.data.pastExamProblems=[pastProblem(2016,4)];
  const a=legacy(214),b=success(286,214),c=success(316,214,a.problem_id,'retrieval_check');
  const derive=aa=>buildPastExamRepairCandidates({record:rec,sessions:[],attempts:aa,conceptWeaknesses:[],problems:[problem(a.problem_id)]});
  assert.equal(derive([a,b,c]).some(r=>r.required),false);
  assert.ok(derive([a,b,c]).some(r=>r.repairSuccessEvidenceId===286&&r.repairKind==='transfer_wait'));
  // A different source/target must not silently heal this legacy failure.
  assert.equal(derive([a,success(286,213)]).some(r=>r.required),true);
});
const benchmarkFixture=(blocked=false)=>{
  const rec=record();rec.data.pastExamProblems=[2022,2024,2025].flatMap(y=>[1,2,3,4,5].map(q=>pastProblem(y,q)));
  const s={id:22,year:2022,date:'2026-10-01',session_kind:'selected_three_timed',session_instance_id:'session-2022-1',
    scan_minutes:10,scan_submitted:true,scan_evidence_kind:'clean',session_state:'completed',
    attempt_completed_at:'2026-10-01T10:00:00Z',initial_selected_problem_ids:[2,3,4].map(q=>`PY-2022-Q${q}`),
    final_selected_problem_ids:[],selected_timed_attempt_ids:[302,303,304],
    questions:[1,2,3,4,5].map(q=>({problemId:`PY-2022-Q${q}`,questionLabel:`問${q}`,selected:[2,3,4].includes(q),
      actualScore:[2,3,4].includes(q)?60:20,actualMinutes:[2,3,4].includes(q)?80/3:15,completed:[2,3,4].includes(q)}))};
  const aa=[2,3,4].map((q,i)=>attempt(302+i,`PY-2022-Q${q}`,'2026-10-01',{
    score_numeric:60,time_minutes:80/3,actual_reference_level:0,error_type:blocked?'W':'none',error_types:blocked?['W']:[],
    grading_contract:{gradedParts:[{id:'major_calculation',rootSkillIds:['c1'],stableTargetKey:`target:PY-2022-Q${q}:slot:major_calculation`}]},
    graded_findings:[{graded_part_id:'major_calculation',error_type:blocked?'W':'none',resolved:!blocked,evidence:'答案'}]}));
  const catalog=buildPastExamCatalog({record:rec,sessions:[s],attempts:aa});
  const key='past_exam_session:2024:timed_three_question_session:session-2024-1';
  const sticky={problem_id:'PY-2024-Q1',past_exam_year:2024,past_exam_task_type:'timed_three_question_session',
    session_problem_ids:[1,2,3,4,5].map(q=>`PY-2024-Q${q}`),stable_session_key:key,mode:'exam_90min',minutes:90,
    triage:'must',clean_selection_evidence:true,past_exam_session_state:'planned',selected_year_reason:'benchmark'};
  return {record:rec,catalog,attempts:aa,pastSessions:[s],problems:catalog.map(r=>problem(r.canonicalProblemId,null,'past_exam')),
    reviews:[],weaknesses:[],repairCandidates:[],currentTasks:[sticky],today:'2026-10-09',examDate:'2026-11-15',targetMinutes:120,key};
};
test('sticky benchmark cannot bypass unresolved required repair protection',()=>{
  const args=benchmarkFixture(true),shadow=buildAdaptivePlannerShadow(args);
  assert.ok(!shadow.plan14.plan.flatMap(d=>d.tasks).some(t=>t.pastExamYear===2024));
});
test('admitted sticky benchmark consumes its year/identity once in forecast',()=>{
  const args=benchmarkFixture(),shadow=buildAdaptivePlannerShadow(args);
  assert.equal(shadow.plan14.plan.flatMap(d=>d.tasks).filter(t=>t.stableSessionKey===args.key).length,1);
});
test('benchmark release is independent of Attempt storage iteration order',()=>{
  const args=benchmarkFixture(true);
  // Two equal-impact W targets on each selected answer; Q3 repaired, Q2 not.
  for(const a of args.attempts.slice(0,2)){
    const p={...a.grading_contract.gradedParts[0],id:'answer_conclusion',stableTargetKey:`target:${a.problem_id}:slot:answer_conclusion`};
    a.grading_contract.gradedParts.push(p);
    a.graded_findings.push({...a.graded_findings[0],graded_part_id:p.id});
  }
  const a=args.attempts[1],good=structuredClone(a);
  good.id=312;good.date='2026-10-05';good.learning_purpose='error_repair';good.grading_confidence=.99;
  good.actual_reference_level=0;good.error_type='none';good.error_types=['none'];
  good.graded_findings.forEach(f=>{f.resolved=true;f.error_type='none';});
  args.attempts[2].graded_findings.forEach(f=>{f.resolved=true;f.error_type='none';});
  args.attempts[2].error_type='none';args.attempts[2].error_types=['none'];
  args.attempts.push(good);
  const released=aa=>!!buildPastExamYearCandidates({...args,attempts:aa,daysRemaining:37}).find(c=>c.year===2024);
  assert.equal(released(args.attempts),false);
  assert.equal(released([...args.attempts].reverse()),false);
});
test('manual annual postponement is eligibility, not a downstream Today omission',()=>{
  const args=benchmarkFixture();
  args.taskPostponements=[{problem_id:'PY-2024-Q1',kind:'得点形成',mode:'exam_90min',
    postponed_to:'2026-10-10',postpone_reason:'予算を超えたため'}];
  const shadow=buildAdaptivePlannerShadow(args);
  assert.ok(!shadow.plan14.plan[0].tasks.some(t=>t.stableSessionKey===args.key));
  assert.ok(shadow.plan14.plan.some(d=>d.date>='2026-10-10'&&d.tasks.some(t=>t.stableSessionKey===args.key)));
});
test('graduated problem is not a generic individual candidate; later real failure remains eligible',()=>{
  const rec=record();rec.data.pastExamProblems=[2016,2017].flatMap(y=>[1,2,3,4,5].map(q=>pastProblem(y,q)));
  const good=success(316,214);good.learning_purpose='retrieval_check';good.mode='check';good.mark='◎';
  good.assessment_timing='delayed_retrieval';good.date='2026-10-09';good.generated_from_review_id=99;
  good.graded_part_ids=good.grading_contract.gradedParts.map(p=>p.id);
  assert.equal(resolvePersistedAttemptLifecycle(good).graduated,true);
  const args={record:rec,attempts:[legacy(214),good],pastSessions:[],problems:rec.data.pastExamProblems.map(r=>problem(`PY-${r.year}-Q${r.question_number}`,null,'past_exam')),
    reviews:[],weaknesses:[],repairCandidates:[],currentTasks:[],today:'2026-10-09',examDate:'2026-11-15',targetMinutes:120};
  const derive=()=>buildAdaptivePlannerShadow({...args,catalog:buildPastExamCatalog({record:rec,sessions:[],attempts:args.attempts})});
  assert.ok(!derive().plan14.plan.flatMap(d=>d.tasks).some(t=>t.pastExamTaskType==='individual_full'&&t.problemId===good.problem_id));
  const relapse=legacy(317);relapse.date='2026-10-10';args.attempts.push(relapse);
  assert.ok(derive().plan14.plan.flatMap(d=>d.tasks).some(t=>t.problemId===good.problem_id&&t.pastExamTaskType==='individual_full'));
});
