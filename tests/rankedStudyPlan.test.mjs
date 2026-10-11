import test from 'node:test';
import assert from 'node:assert/strict';
import * as canonical from '../src/canonicalStudyPlan.ts';
import {problem,attempt,record,pastProblem} from './adaptiveFixture.mjs';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {addCalendarDays} from '../src/reviewSchedulePolicy.ts';
import {deriveCurrentTodayProjection} from '../src/currentTodayProjection.ts';
import {qualifyingAttemptForTodayTask} from '../src/todayTaskProjection.ts';
const contract=(r)=>({contractId:`review:${r.id}:1`,contractVersion:'STAT1-CONTRACT-v2',contractHash:`hash-${r.id}`,createdAt:'2026-07-01T00:00:00Z',problemId:r.problem_id,sourceAttemptId:r.source_attempt_id||1,learningPurpose:r.learning_purpose,learningStage:r.learning_purpose==='error_repair'?'repair':'maintenance',mode:'check',reviewScope:'check_only',targetedParts:[],gradedParts:[{id:'answer_conclusion',label:'結論',cueLabel:'結論',allowedErrorTypes:['N','C','none'],completionCriterionId:'recall'}],explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:'recall',displayText:'自力再現'}],hiddenAnswerKey:[],completionConditions:['自力再現'],requiredEvidence:['結論'],allowedErrorTypes:['N','C'],requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:7,sheetType:'check_sheet'});

function fixture(){
 const rec=record();rec.data.pastExamProblems=[2018,2021,2022,2024,2025].flatMap(y=>[1,2,3,4,5].map(q=>pastProblem(y,q,[],{exposure_default:[2018,2021].includes(y)?'fully_attempted':'unseen'})));
 const problems=rec.data.pastExamProblems.map(p=>({...problem(`PY-${p.year}-Q${p.question_number}`,null,'past_exam'),source_type:'past_exam',schedulable:true,gradable:true}));
 return {today:'2026-10-11',daysRemaining:35,record:rec,problems,attempts:[],reviews:[],pastSessions:[],weaknesses:[],repairCandidates:[],catalog:buildPastExamCatalog({record:rec,attempts:[],sessions:[]})};
}
const derive=args=>{assert.equal(typeof canonical.deriveRankedStudyCandidates,'function','full candidate selector must exist');return canonical.deriveRankedStudyCandidates({...args,reviews:args.reviews.map(r=>({...r,grading_contract:r.grading_contract||contract(r)}))})};
test('eligible pool and ordering do not depend on daily budget, weekdays or display count',()=>{
 const a=fixture(),small=derive({...a,targetMinutes:5}),large=derive({...a,targetMinutes:500});
 assert.deepEqual(small.tasks,large.tasks);assert.ok(small.tasks.length>10);
 assert.ok(small.tasks.some(t=>t.stable_session_key&&t.minutes===90));
 assert.ok(small.waiting.some(w=>w.task.past_exam_year===2024&&w.reason&&w.reevaluateWhen));
 assert.ok(!small.tasks.some(t=>t.past_exam_year===2024));
});
test('Whitebook maintenance is not normal Today; explicit high-confidence PastExam repair remains',()=>{
 const a=fixture(),wb={...problem('WB-6-A-19'),source_type:'whitebook'};a.problems.push(wb);
 a.reviews=[{id:378,problem_id:wb.problem_id,status:'pending',due_date:'2026-08-25',learning_purpose:'retrieval_check',estimated_minutes:5}];
 let out=derive(a);assert.ok(!out.tasks.some(t=>t.problem_id===wb.problem_id));assert.ok(out.waiting.some(w=>w.task.id===378));
 a.repairCandidates=[{sessionId:1,sourceAttemptId:1,sourceProblemId:'PY-2018-Q3',sourceFindingId:'major_calculation',sourceFindingIds:['major_calculation'],rootWeaknessId:'root:coefficient',weaknessSkillIds:['coefficient_tracking'],matchedSkillIds:['coefficient_tracking'],conceptId:'coefficient_tracking',conceptLabel:'係数追跡',materiality:'major',recurrence:1,examImpact:'high',required:true,matchReason:'explicit operation evidence',whitebookProblemIds:[wb.problem_id],transferProblemIds:[],matchConfidence:'high',repairKind:'whitebook',reason:'current major loss',requiresUserConfirmation:true}];
 out=derive(a);assert.ok(out.tasks.some(t=>t.problem_id===wb.problem_id&&t.repair_lineage?.matchConfidence==='high'));
});
test('graduated problem does not return from old failures; a later valid failure can repair',()=>{
 const a=fixture(),id='PY-2018-Q3';a.attempts=[attempt(1,id,'2026-09-01'),attempt(2,id,'2026-10-09',{mark:'◎',score_numeric:100,error_type:'none',error_types:['none'],learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval',review_outcome:'success',minimum_pass_condition_met:true,target_issue_resolved:true,retention_eligible:true})];
 let out=derive(a);assert.ok(!out.tasks.some(t=>t.problem_id===id&&!t.stable_session_key));
 a.attempts.push(attempt(3,id,'2026-10-10',{review_outcome:'failed'}));
 a.reviews=[{id:9,problem_id:id,status:'pending',source_attempt_id:3,due_date:'2026-10-11',earliest_date:'2026-10-11',learning_purpose:'error_repair',mode:'main_calc',estimated_minutes:12}];
 out=derive(a);assert.ok(out.tasks.some(t=>t.id===9));
});
test('all actionable PastExam reviews remain ranked; future retention stays waiting',()=>{
 const a=fixture();a.reviews=a.problems.filter(p=>p.problem_id.startsWith('PY-2018')).map((p,i)=>({id:10+i,problem_id:p.problem_id,status:'pending',learning_purpose:'error_repair',due_date:'2026-10-01',earliest_date:'2026-09-30',estimated_minutes:12}));
 a.reviews.push({id:99,problem_id:'PY-2021-Q1',status:'pending',learning_purpose:'retrieval_check',due_date:'2026-10-14',earliest_date:'2026-10-12',estimated_minutes:7});
 const out=derive({...a,targetMinutes:5});assert.equal(out.tasks.filter(t=>t.review_type).length,5);assert.ok(out.waiting.some(w=>w.task.id===99));
});

test('ranked projection ignores stale snapshot eligibility/order, and keeps completed history only',()=>{
 const a=fixture(),pool=derive(a),snapshot={date:a.today,created_at:'2026-10-11T00:00:00Z',tasks:[{problem_id:'WB-6-A-19',kind:'得点形成',mode:'check',minutes:5,title:'stale',reason:'old due',triage:'must'}],start_of_day_planned_minutes:5};
 const out=deriveCurrentTodayProjection({ranked:true,snapshot,generatedTasks:pool.tasks,attempts:[],reviews:[],today:a.today,targetMinutes:5,completedMinutes:0});
 assert.deepEqual(out.tasks.map(t=>t.problem_id),pool.tasks.map(t=>t.problem_id));assert.ok(out.tasks.reduce((s,t)=>s+t.minutes,0)>5);
 assert.equal(out.currentTask.ranking.rank,1);assert.deepEqual(snapshot.tasks.map(t=>t.title),['stale']);
});

const graded=(id,p,date,success,purpose='exam_performance')=>attempt(id,p,date,{learning_purpose:purpose,assessment_timing:purpose==='exam_performance'?'independent_performance':'delayed_retrieval',score_numeric:success?100:40,grading_confidence:.99,mark:success?(purpose==='retrieval_check'?'◎':'○'):'×',review_outcome:success?'success':'failed',target_issue_resolved:success,minimum_pass_condition_met:success,retention_eligible:purpose==='retrieval_check',error_type:success?'none':'W',error_types:success?['none']:['W'],grading_contract:{gradedParts:[{id:'major_calculation',label:'主要計算',cueLabel:'主要計算',allowedErrorTypes:['W','N','C','none'],completionCriterionId:'calculation',masteryLevel:2,stableTargetKey:`target:${p}:slot:major_calculation`,rootSkillIds:['coefficient_tracking']}]},graded_part_ids:['major_calculation'],graded_findings:[{graded_part_id:'major_calculation',error_type:success?'none':'W',resolved:success,evidence:'synthetic answer evidence'}]});

test('2024 waits for minimal current root repair, not completion of every retention Review',()=>{
 const a=fixture();a.attempts=[graded(100,'PY-2022-Q2','2026-10-01',false),graded(101,'PY-2022-Q4','2026-10-01',false),graded(102,'PY-2022-Q3','2026-10-01',true)];
 // Synthetic Q3 assesses a DIFFERENT operation: an unrelated exam success
 // must not accidentally provide natural transfer for both prerequisite roots.
 a.attempts[2].grading_contract.gradedParts[0].rootSkillIds=['other_operation'];
 a.pastSessions=[{id:22,year:2022,date:'2026-10-01',session_kind:'selected_three_timed',session_state:'completed',attempt_completed_at:'2026-10-01T12:00:00Z',scan_submitted:true,scan_minutes:10,actual_total_minutes:90,session_elapsed_minutes:90,selected_timed_attempt_ids:[100,101,102],linked_attempt_ids:[100,101,102],initial_selected_problem_ids:['PY-2022-Q2','PY-2022-Q3','PY-2022-Q4'],questions:[2,3,4].map(q=>({problemId:`PY-2022-Q${q}`,selected:true,completed:true,actualMinutes:80/3}))}];
 a.catalog=buildPastExamCatalog({record:a.record,attempts:a.attempts,sessions:a.pastSessions});
 assert.ok(!derive(a).tasks.some(t=>t.past_exam_year===2024));
 a.attempts.push(graded(104,'PY-2022-Q2','2026-10-08',true,'error_repair'),graded(105,'PY-2022-Q4','2026-10-08',true,'error_repair'));
 a.reviews=[{id:200,problem_id:'PY-2022-Q2',source_attempt_id:104,status:'pending',learning_purpose:'retrieval_check',earliest_date:'2026-10-14',due_date:'2026-10-15',estimated_minutes:7}];
 const out=derive(a);assert.ok(out.tasks.some(t=>t.past_exam_year===2024&&t.minutes===90));assert.ok(out.waiting.some(w=>w.task.id===200));
 assert.ok(!out.tasks.some(t=>t.past_exam_year===2025));
});

test('14-day closed loop advances both comparable old repairs and incomplete PastExam without quota/budget',()=>{
 const a=fixture(),trace=[];let id=300;
 a.attempts=[1,2,3].map(q=>graded(id++,`PY-2018-Q${q}`,'2026-09-01',false));
 a.pastSessions=[{id:18,year:2018,session_kind:'selected_three_timed',session_state:'completed',attempt_completed_at:'2026-09-01',date:'2026-09-01',actual_total_minutes:90,scan_minutes:10,initial_selected_problem_ids:[1,2,3].map(q=>`PY-2018-Q${q}`),questions:[1,2,3].map(q=>({problemId:`PY-2018-Q${q}`,selected:true,completed:true,actualMinutes:80/3}))}];
 a.reviews=a.attempts.map((s,i)=>({id:400+i,problem_id:s.problem_id,source_attempt_id:s.id,status:'pending',learning_purpose:'error_repair',earliest_date:'2026-09-03',due_date:'2026-09-05',estimated_minutes:12}));
 let repaired=0,completed=0,retained=0,measured=0;
 for(let day=0;day<14;day++){
  a.today=addCalendarDays('2026-10-11',day);a.daysRemaining=35-day;
  // Variable user-chosen stopping points, NOT a Planner quota or budget.
  for(let turn=0;turn<[2,1,3,1,2,2,1,3,1,2,1,3,2,1][day];turn++){
  a.catalog=buildPastExamCatalog({record:a.record,attempts:a.attempts,sessions:a.pastSessions});
  const pool=derive({...a,targetMinutes:1});assert.deepEqual(pool.tasks,derive({...a,targetMinutes:1000}).tasks);
  assert.ok(!pool.tasks.some(t=>t.problem_id.startsWith('WB-')));
  const first=pool.tasks[0];if(!first)continue;
  trace.push({date:a.today,identity:first.id?`review:${first.id}`:first.problem_id,category:first.ranking.category,wait:first.ranking.waitingDays});
  if(first.stable_session_key){
   // Execute the actual PRIMARY annual candidate; do not skip it to make
   // repair/retention counts look better. Results below are sandbox assumptions.
   const year=first.past_exam_year,selected=[1,2,3].map(q=>`PY-${year}-Q${q}`);
   const answers=selected.map(p=>graded(id++,p,a.today,true));a.attempts.push(...answers);
   a.pastSessions.push({id:900+measured,year,date:a.today,session_kind:'selected_three_timed',session_state:'completed',
    stable_session_key:first.stable_session_key,simulation_completed_at:`${a.today}T12:00:00Z`,scan_minutes:10,
    actual_total_minutes:90,selected_solve_minutes:80,selected_timed_attempt_ids:answers.map(s=>s.id),initial_selected_problem_ids:selected,
    questions:[1,2,3,4,5].map(q=>({problemId:`PY-${year}-Q${q}`,selected:q<=3,completed:q<=3,actualMinutes:q<=3?80/3:null}))});
   measured++;
  }else if(first.id){
   const current=a.reviews.find(r=>r.id===first.id);current.status='done';
   const retention=current.learning_purpose==='retrieval_check';
   const success=graded(id++,first.problem_id,a.today,true,retention?'retrieval_check':'error_repair');
   success.generated_from_review_id=current.id;a.attempts.push(success);
   if(retention)retained++;
   else {
    repaired++;
    const next={id:500+repaired,problem_id:first.problem_id,source_attempt_id:success.id,status:'pending',learning_purpose:'retrieval_check',earliest_date:addCalendarDays(a.today,2),due_date:addCalendarDays(a.today,3),estimated_minutes:5};
    next.grading_contract={...contract(next),estimatedMinutes:5,gradedParts:success.grading_contract.gradedParts};
    a.reviews.push(next);
   }
  }
  else {a.attempts.push(graded(id++,first.problem_id,a.today,true));completed++;}
  }
 }
 assert.equal(repaired,3,JSON.stringify(trace));assert.ok(completed>=2,JSON.stringify(trace));
 assert.ok(retained>=1,JSON.stringify(trace));assert.ok(measured>=1,JSON.stringify(trace));
 assert.ok(trace.slice(0,7).some(t=>t.category==='未完成過去問'),JSON.stringify(trace));
 assert.equal(new Set(trace.map(t=>t.identity)).size,trace.length,'only actually recorded results change the next queue');
});

test('same-problem pending repeated failure changes intervention; no false transfer or graduation',()=>{
 const a=fixture(),p='PY-2018-Q1',source=graded(1,p,'2026-10-01',false);a.attempts=[source];
 const root=deriveFailureEpisode(source).rootWeaknesses[0];
 a.reviews=[{id:20,problem_id:p,source_attempt_id:1,status:'pending',due_date:'2026-10-05',earliest_date:'2026-10-03',learning_purpose:'error_repair',estimated_minutes:12}];
 a.repairCandidates=[{sessionId:-1,sourceAttemptId:1,sourceProblemId:p,sourceFindingId:'major_calculation',sourceFindingIds:['major_calculation'],rootWeaknessId:root.rootWeaknessId,conceptId:'coefficient_tracking',conceptLabel:'係数追跡',materiality:'major',recurrence:2,examImpact:'high',required:true,matchReason:'explicit current root',whitebookProblemIds:[],transferProblemIds:[],repairKind:'rediagnosis',interventionChanged:true,sameRootFailureCount:2,reason:'同rootの再診断を局所化',requiresUserConfirmation:true}];
 const out=derive(a);assert.ok(out.tasks.some(t=>t.repair_lineage?.intervention==='rediagnosis'));assert.ok(out.waiting.some(w=>w.task.id===20));
 assert.ok(!out.tasks.some(t=>t.transfer_training_key));assert.equal(source.mark,'×');
});

test('a source failure saved today cannot complete its newly ranked repair',()=>{
 const a=fixture(),source=graded(30,'PY-2018-Q1',a.today,false);
 const task={problem_id:source.problem_id,source_attempt_id:source.id,kind:'局所補修',mode:'full',minutes:12,ranking:{eligible:true}};
 const snapshot={date:a.today,created_at:'2026-10-11T00:00:00Z',tasks:[task],start_of_day_planned_minutes:12};
 assert.equal(qualifyingAttemptForTodayTask({task,snapshot,attempts:[source]}),undefined);
 const result=graded(31,source.problem_id,a.today,true,'error_repair');
 assert.equal(qualifyingAttemptForTodayTask({task,snapshot,attempts:[source,result]})?.id,31);
});

test('high-confidence observed prerequisite failure leads without any Whitebook match',()=>{
 const a=fixture(),source=graded(30,'PY-2018-Q1','2026-10-01',false);
 source.policy_validity='valid';source.error_types=['K'];source.error_type='K';
 source.graded_findings[0].error_type='K';source.graded_findings[0].evidence='synthetic: starting theorem not selected';
 source.grading_contract.gradedParts[0].masteryLevel=1;
 a.attempts=[source];
 const r={id:88,problem_id:source.problem_id,source_attempt_id:source.id,status:'pending',learning_purpose:'error_repair',due_date:a.today};
 r.grading_contract=contract(r);
 r.grading_contract.gradedParts=[{...source.grading_contract.gradedParts[0],currentErrorType:'K',allowedErrorTypes:['K','W','N','C','none']}];
 a.reviews=[r];
 const out=derive(a);assert.equal(out.tasks[0].id,88);assert.equal(out.tasks[0].ranking.band,0);
 assert.equal(out.tasks[0].hard_blocker,true);
});
