import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {record,pastProblem,problem,attempt} from './adaptiveFixture.mjs';
import {buildAdaptivePlannerShadow} from '../src/adaptivePlanner.ts';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {buildPastExamRepairCandidates} from '../src/conceptWeakness.ts';
import {buildPastExamYearCandidates} from '../src/pastExamPlanning.ts';
import {resolvePersistedAttemptLifecycle} from '../src/reviewTransition.ts';
import {addCalendarDays} from '../src/reviewSchedulePolicy.ts';
const traces=[];
const source=(id,p,date,failed=true)=>attempt(id,p,date,{source_type:'past_exam',score_numeric:failed?50:100,grading_confidence:.99,
 learning_purpose:'exam_performance',error_type:failed?'W':'none',error_types:failed?['W']:['none'],actual_reference_level:0,hint_used:false,
 grading_contract:{gradedParts:[{id:'major_calculation',masteryLevel:2,rootSkillIds:[`skill:${p}`],stableTargetKey:`target:${p}:slot:major_calculation`}]},
 graded_part_ids:['major_calculation'],graded_findings:[{graded_part_id:'major_calculation',error_type:failed?'W':'none',resolved:!failed,evidence:'isolated evidence'}],
 target_issue_resolved:!failed,minimum_pass_condition_met:!failed,review_outcome:failed?'failed':'success'});
for(const scenario of ['success','failure','partial'])test(`14-day closed loop: ${scenario}`,()=>{
 const rec=record();rec.data.pastExamProblems=[2022,2024,2025].flatMap(y=>[1,2,3,4,5].map(q=>pastProblem(y,q)));
 const pp=rec.data.pastExamProblems.map(p=>({...problem(`PY-${p.year}-Q${p.question_number}`,null,'past_exam'),source_type:'past_exam'}));
 let aa=[source(1,'PY-2022-Q2','2026-10-01'),source(2,'PY-2022-Q3','2026-10-01'),source(3,'PY-2022-Q4','2026-10-01',false)];
 let sessions=[{id:22,year:2022,date:'2026-10-01',session_kind:'selected_three_timed',session_type:'exam_90min',session_instance_id:'measured-2022',
  scan_evidence_kind:'clean',scan_submitted:true,scan_minutes:10,selected_solve_minutes:80,session_elapsed_minutes:90,actual_total_minutes:90,
  session_state:'completed',attempt_completed_at:'2026-10-01T10:00:00Z',selected_timed_attempt_ids:[1,2,3],linked_attempt_ids:[1,2,3],
  initial_selected_problem_ids:[2,3,4].map(q=>`PY-2022-Q${q}`),final_selected_problem_ids:[],
  questions:[1,2,3,4,5].map(q=>({problemId:`PY-2022-Q${q}`,questionLabel:`問${q}`,selected:[2,3,4].includes(q),
   actualScore:[2,3,4].includes(q)?60:20,actualMinutes:[2,3,4].includes(q)?80/3:15,completed:[2,3,4].includes(q)}))}];
 let nextId=10,executions=0;const trace=[];
 const key='past_exam_session:2024:timed_three_question_session:session-2024-1';
 const sticky={problem_id:'PY-2024-Q1',past_exam_year:2024,past_exam_task_type:'timed_three_question_session',stable_session_key:key,
  session_problem_ids:[1,2,3,4,5].map(q=>`PY-2024-Q${q}`),mode:'exam_90min',minutes:90,triage:'must',clean_selection_evidence:true,past_exam_session_state:'planned'};
 for(let n=0;n<14;n++){
  const today=addCalendarDays('2026-10-09',n),catalog=buildPastExamCatalog({record:rec,sessions,attempts:aa});
  const repairCandidates=buildPastExamRepairCandidates({record:rec,sessions,attempts:aa,conceptWeaknesses:[],problems:pp});
  const shadow=buildAdaptivePlannerShadow({record:rec,catalog,attempts:aa,reviews:[],pastSessions:sessions,problems:pp,weaknesses:[],repairCandidates,
   currentTasks:executions?[]:[sticky],today,examDate:'2026-11-15',targetMinutes:120,
   taskPostponements:[{problem_id:'PY-2024-Q1',kind:'得点形成',mode:'exam_90min',stable_session_key:key,postponed_to:'2026-10-12'}]});
  const day=shadow.plan14.plan[0];assert.ok(day.totalMinutes<=120);
  const protectedTasks=day.tasks.filter(t=>t.pastExamYear===2024);
  if(n<3||scenario!=='success')assert.equal(protectedTasks.length,0,`${scenario} ${today}: protected release`);
  assert.ok(!day.tasks.some(t=>t.pastExamYear===2025));
  for(const d of shadow.plan14.plan)assert.ok(d.totalMinutes<=120);
  for(const p of ['PY-2022-Q2','PY-2022-Q3'])if(aa.some(a=>a.problem_id===p&&resolvePersistedAttemptLifecycle(a).graduated))
   assert.ok(!shadow.plan14.plan.flatMap(d=>d.tasks).some(t=>t.problemId===p&&t.pastExamTaskType==='individual_full'));
  trace.push({date:today,total:day.totalMinutes,required:repairCandidates.filter(c=>c.required).map(c=>c.sourceProblemId),
   tasks:day.tasks.filter(t=>!t.requiresUserSelection).map(t=>({problem:t.problemId,type:t.pastExamTaskType,source:t.repairLineage?.sourceAttemptId})),protectedAdmitted:protectedTasks.length>0});
  // Actual synthetic outcomes are fed into the next day's derivation.
  if(n===0){for(const original of aa.slice(0,2)){
   const pass=scenario==='success'||scenario==='partial'&&original.id===1;
   const out=source(nextId++,original.problem_id,today,!pass);out.learning_purpose='error_repair';aa.push(out);
   assert.equal(resolvePersistedAttemptLifecycle(out).graduated,false);
  }}
  if(n===2&&scenario==='success')for(const original of aa.slice(0,2)){
   const good=source(nextId++,original.problem_id,today,false);Object.assign(good,{learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval',generated_from_review_id:100+original.id,mode:'check'});
   assert.equal(resolvePersistedAttemptLifecycle(good).graduated,true);aa.push(good);
  }
  if(protectedTasks.some(t=>t.pastExamTaskType==='timed_three_question_session')){
   executions++;assert.equal(executions,1,'one real benchmark execution');
   const selected=[1,2,3].map(q=>`PY-2024-Q${q}`),ids=[];
   for(const p of selected){const good=source(nextId++,p,today,false);ids.push(good.id);aa.push(good);}
   sessions.push({...structuredClone(sessions[0]),id:24,year:2024,date:today,session_instance_id:'session-2024-1',stable_session_key:key,
    selected_timed_attempt_ids:ids,linked_attempt_ids:ids,initial_selected_problem_ids:selected,final_selected_problem_ids:selected,
    attempt_completed_at:today+'T10:00:00Z',simulation_completed_at:today+'T10:00:00Z',
    questions:[1,2,3,4,5].map(q=>({problemId:`PY-2024-Q${q}`,questionLabel:`問${q}`,selected:q<=3,actualScore:90,actualMinutes:80/3,completed:q<=3}))});
  }
 }
 assert.equal(executions,scenario==='success'?1:0);traces.push({scenario,days:trace,executions});
});

test('all 45 past-exam IDs: legacy failures stay healed through scoped success and graduation',()=>{
 for(const year of [2016,2017,2018,2019,2021,2022,2023,2024,2025])for(let q=1;q<=5;q++){
  const p=`PY-${year}-Q${q}`,rec=record();rec.data.pastExamProblems=[pastProblem(year,q)];
  const old=attempt(1,p,'2026-08-01',{grading_contract:undefined,graded_findings:[],error_type:'W',error_types:['W']});
  const repair=source(2,p,'2026-10-05',false);repair.learning_purpose='error_repair';repair.grading_contract.gradedParts[0].id=`part:${p}:1:1`;
  repair.grading_contract.gradedParts[0].stableTargetKey=`target:${p}:root:f1d91adc-3626-4cf8-81da-542149f100fb`;
  repair.graded_findings[0].graded_part_id=repair.grading_contract.gradedParts[0].id;repair.graded_part_ids=[repair.graded_findings[0].graded_part_id];
  const graduate=structuredClone(repair);Object.assign(graduate,{id:3,date:'2026-10-09',learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval',generated_from_review_id:9});
  assert.equal(resolvePersistedAttemptLifecycle(graduate).graduated,true);
  const candidates=buildPastExamRepairCandidates({record:rec,sessions:[],attempts:[old,repair,graduate],conceptWeaknesses:[],problems:[problem(p)]});
  assert.ok(!candidates.some(c=>c.required),p);
 }
});
test.after(async()=>{await writeFile('outputs/closed-loop-trace.json',JSON.stringify(traces,null,2));});

test('final-phase share warning displays the canonical 70 percent threshold',()=>{
 const rec=record();rec.data.pastExamProblems=[];
 const shadow=buildAdaptivePlannerShadow({record:rec,catalog:[],attempts:[],reviews:[],pastSessions:[],problems:[],weaknesses:[],currentTasks:[],today:'2026-10-20',examDate:'2026-11-15',targetMinutes:120});
 const warnings=shadow.plan14.weeklyMinimumViolations.filter(x=>x.includes('本番形式比率'));
 assert.ok(warnings.length);assert.ok(warnings.every(x=>x.includes('目標70%以上')));
});
