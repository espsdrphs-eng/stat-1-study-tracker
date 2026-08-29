import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {buildGradingContractSnapshot,repairTargets} from "../src/gradingContract.ts";
import {analyzeReviewReconciliation} from "../src/reviewReconciliation.ts";
import {attemptModeSatisfiesTask,deriveCurrentTodayState,projectTodayTaskChecked,qualifyingAttemptForTodayTask} from "../src/todayTaskProjection.ts";
import {runIntegrityAudit} from "../src/integrityEngine.ts";

const problem=(problemId)=>({id:1,problem_id:problemId,source_type:"whitebook",category:"A",chapter:5,problem_number:28,
  title:"fixture",display_label:"fixture",theme:"fixture",canonical_problem_type:"fixture",canonical_keywords:[],
  priority:"repair",role:"training",recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",
  notes:"",completion_status:"active",master_version:"fixture",metadata_status:"ok"});
const legacyAttempt=(id,problemId,errorPoint,nextAction)=>({id,problem_id:problemId,date:"2026-08-11",mode:"full",
  time_minutes:35,mark:"△",score_label:"C",error_type:"N",error_types:["N"],error_point:errorPoint,next_action:nextAction,memo:""});

test("legacy error_point is one target and next_action is correction payload",()=>{
  const attempt=legacyAttempt(10,"WB-5-A-28","積分区間を誤った","境界を確認して場合分けする");
  const review={id:364,problem_id:attempt.problem_id,learning_purpose:"error_repair",targeted_parts:[attempt.error_point,attempt.next_action]};
  assert.deepEqual(repairTargets(review,attempt),[attempt.error_point]);
  const built=buildGradingContractSnapshot({review,problem:problem(attempt.problem_id),sourceAttempt:attempt,createdAt:"2026-08-11"});
  assert.equal(built.contract.gradedParts.length,1);
  assert.equal(built.contract.gradedParts[0].currentEvidence,attempt.error_point);
  assert.equal(built.contract.gradedParts[0].currentCorrection,attempt.next_action);
});

test("structured findings alone define targets and legacy prose adds none",()=>{
  const attempt={...legacyAttempt(11,"WB-5-A-28","legacy error","legacy correction"),
    graded_part_ids:["A","B"],graded_parts:["A","B"],graded_findings:[
      {graded_part_id:"A",error_type:"N",evidence:"A evidence",resolved:false},
      {graded_part_id:"B",error_type:"W",evidence:"B evidence",resolved:false},
    ],grading_contract:{gradedParts:[
      {id:"A",label:"A",cueLabel:"A",allowedErrorTypes:["N","none"],completionCriterionId:"A"},
      {id:"B",label:"B",cueLabel:"B",allowedErrorTypes:["W","none"],completionCriterionId:"B"},
    ]}};
  assert.deepEqual(repairTargets({problem_id:attempt.problem_id,targeted_parts:[attempt.error_point,attempt.next_action]},attempt),
    ["A evidence","B evidence"]);
  const built=buildGradingContractSnapshot({review:{problem_id:attempt.problem_id,learning_purpose:"error_repair"},
    problem:problem(attempt.problem_id),sourceAttempt:attempt,createdAt:"2026-08-11"});
  assert.deepEqual(built.contract.gradedParts.map(row=>row.id),["A","B"]);
});

test("Reviews 345/347/359/364 legacy correction rows reconcile from two targets to one",()=>{
  const ids=[345,347,359,364],problems=["WB-5-A-20","WB-5-A-21","WB-5-A-26","WB-5-A-28"];
  const attempts=[],reviews=[];
  ids.forEach((reviewId,index)=>{
    const problemId=problems[index],attempt=legacyAttempt(100+index,problemId,`error-${index}`,`correction-${index}`);
    attempts.push(attempt);
    const parts=[
      {id:`legacy_error_${index}`,label:attempt.error_point,cueLabel:"target",allowedErrorTypes:["N","none"],completionCriterionId:"target",
        stableTargetKey:`target:${problemId}:slot:legacy_error_${index}`},
      {id:`legacy_correction_${index}`,label:attempt.next_action,cueLabel:"correction",allowedErrorTypes:["N","none"],completionCriterionId:"correction",
        stableTargetKey:`target:${problemId}:slot:legacy_correction_${index}`},
    ];
    reviews.push({id:reviewId,problem_id:problemId,due_date:"2026-08-11",review_type:"targeted_patch",status:"pending",
      generated_from_attempt_id:attempt.id,source_attempt_id:attempt.id,learning_purpose:"error_repair",
      grading_contract:{contractId:`review:${reviewId}:1`,contractVersion:"STAT1-CONTRACT-v2",contractHash:`h${reviewId}`,
        createdAt:"2026-08-11",problemId,sourceAttemptId:attempt.id,learningPurpose:"error_repair",learningStage:"repair",
        mode:"skeleton",reviewScope:"targeted_patch",targetKind:"mathematical_patch",targetedParts:parts.map(row=>row.label),
        gradedParts:parts,explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:"repair",displayText:"repair"}],
        hiddenAnswerKey:[],completionConditions:["2 targets"],requiredEvidence:parts.map(row=>row.label),allowedErrorTypes:["N"],
        requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:10,sheetType:"skeleton_sheet"}});
  });
  const audit=analyzeReviewReconciliation({attempts,reviews,today:"2026-08-11"});
  for(const [index,reviewId] of ids.entries()){
    const plan=audit.problems.find(row=>row.problemId===problems[index]);
    assert.equal(plan.activeReviewTargetCount,2,`Review ${reviewId} before`);
    assert.equal(plan.desiredRepairParts.length,1,`Review ${reviewId} after`);
    assert.equal(plan.desiredRepairParts[0].currentCorrection,attempts[index].next_action);
  }
});

test("Today projection requires task mode, creation time, and exact Review contract",()=>{
  const snapshot={date:"2026-08-11",task_ids:[],start_of_day_planned_minutes:45,initial_bucket:{},
    initial_estimated_minutes:{},tasks:[],created_at:"2026-08-11T00:00:00Z"};
  const fullTask={problem_id:"WB-5-A-28",title:"A28",kind:"score",reason:"new",mode:"full",minutes:35,load:1};
  const attempt={...legacyAttempt(200,"WB-5-A-28","remaining N","repair N"),saved_at:"2026-08-11T01:00:00Z"};
  assert.equal(attemptModeSatisfiesTask("full","full"),true);
  assert.equal(attemptModeSatisfiesTask("full","skeleton"),false);
  assert.equal(attemptModeSatisfiesTask("skeleton","main_calc"),true,
    "a main calculation submission executes a planned skeleton task");
  assert.equal(projectTodayTaskChecked({task:fullTask,attempts:[attempt],snapshot}),true);
  assert.equal(projectTodayTaskChecked({task:{...fullTask,checked:true},attempts:[],snapshot}),false,
    "snapshot checked state is not current Attempt evidence");
  assert.equal(qualifyingAttemptForTodayTask({task:fullTask,attempts:[{...attempt,saved_at:"2026-08-10T23:00:00Z"}],snapshot}),undefined);

  const reviewTask={...fullTask,id:364,review_type:"targeted_patch",mode:"check",graded_part_ids:["A"],contract_hash:"hash"};
  assert.equal(projectTodayTaskChecked({task:reviewTask,attempts:[attempt],snapshot}),false);
  const reviewAttempt={...attempt,mode:"check",source_review_id:364,generated_from_review_id:364,contract_hash:"hash",
    graded_part_ids:["A"],graded_findings:[{graded_part_id:"A",error_type:"N",evidence:"N",resolved:false}]};
  assert.equal(projectTodayTaskChecked({task:reviewTask,attempts:[reviewAttempt],snapshot}),true);
});

test("integrity audit rejects an unprojected completed Today task and accepts the canonical projection",()=>{
  const task={problem_id:"WB-5-A-28",title:"A28",kind:"score",reason:"new",mode:"full",minutes:35,load:1,checked:false};
  const snapshot={date:"2026-08-11",task_ids:[],start_of_day_planned_minutes:35,initial_bucket:{},
    initial_estimated_minutes:{},tasks:[task],created_at:"2026-08-11T00:00:00Z"};
  const attempt={...legacyAttempt(210,"WB-5-A-28","remaining N","repair N"),saved_at:"2026-08-11T01:00:00Z"};
  const stale=runIntegrityAudit({attempts:[attempt],reviews:[],today:"2026-08-11",todayPlanSnapshots:[snapshot],
    currentTodayTasks:[task]});
  assert.equal(stale.counts.today_task_completion_mismatch,1);
  const current={...task,checked:projectTodayTaskChecked({task,attempts:[attempt],snapshot})};
  const healthy=runIntegrityAudit({attempts:[attempt],reviews:[],today:"2026-08-11",todayPlanSnapshots:[snapshot],
    currentTodayTasks:[current]});
  assert.equal(healthy.counts.today_task_completion_mismatch,0);
});

test("canonical Today projection completes planned skeleton with main_calc and advances NEXT ACTION",()=>{
  const first={problem_id:"WB-5-A-29",title:"A29",kind:"score",reason:"skeleton",mode:"skeleton",minutes:25,load:1,triage:"must",checked:false};
  const second={problem_id:"WB-5-A-20",title:"A20",kind:"score",reason:"skeleton",mode:"skeleton",minutes:10,load:.5,triage:"must",checked:false};
  const snapshot={date:"2026-08-13",task_ids:[],start_of_day_planned_minutes:35,initial_bucket:{},
    initial_estimated_minutes:{},tasks:[first,second],created_at:"2026-08-13T00:00:00Z"};
  const attempt={...legacyAttempt(180,"WB-5-A-29","remaining calculation error","repair calculation"),
    date:"2026-08-13",mode:"main_calc",time_minutes:25,score_numeric:58,saved_at:"2026-08-13T01:00:00Z"};
  const current=deriveCurrentTodayState({tasks:snapshot.tasks,attempts:[attempt],snapshot,completedMinutes:25,targetMinutes:150});
  assert.equal(snapshot.tasks[0].checked,false,"the historical start-of-day snapshot remains unchanged");
  assert.equal(current.tasks[0].checked,true);
  assert.equal(current.currentTask?.problem_id,"WB-5-A-20");
  assert.equal(current.timeSummary.activeRemainingMinutes,10);
  assert.equal(current.timeSummary.completedMinutes,25);

  // Independent sanity check: evidence and the raw slot are inspected without consulting audit output.
  assert.equal(attempt.problem_id,first.problem_id);
  assert.equal(attemptModeSatisfiesTask(first.mode,attempt.mode),true);
  assert.notEqual(current.currentTask?.problem_id,attempt.problem_id);

  const healthy=runIntegrityAudit({attempts:[attempt],reviews:[],today:"2026-08-13",todayPlanSnapshots:[snapshot],
    currentTodayTasks:current.tasks,currentNextTask:current.currentTask});
  assert.equal(healthy.counts.today_task_completion_mismatch,0);
  assert.equal(healthy.counts.today_next_action_mismatch,0);
  const staleDashboard=runIntegrityAudit({attempts:[attempt],reviews:[],today:"2026-08-13",todayPlanSnapshots:[snapshot],
    currentTodayTasks:current.tasks,currentNextTask:current.tasks[0]});
  assert.equal(staleDashboard.counts.today_next_action_mismatch,1);
});

test("canonical Today priority makes exam practice the Dashboard/Today first action and defers maintenance",()=>{
  const maintenance={problem_id:"WB-6-A-19",title:"WB maintenance",kind:"review",reason:"generic",mode:"check",minutes:5,load:.2,
    triage:"must",id:378,review_type:"light_check",learning_purpose:"retrieval_check",review_planning_tier:"deferred_maintenance",
    preferred_date:"2026-08-25",latest_date:"2026-09-01"};
  const exam={problem_id:"PY-2018-Q5",title:"2018 Q5",kind:"past_exam",reason:"timed completion",mode:"full",minutes:35,load:1,
    triage:"must",past_exam_task_type:"individual_full"};
  const snapshot={date:"2026-08-30",task_ids:[],start_of_day_planned_minutes:40,initial_bucket:{},initial_estimated_minutes:{},
    tasks:[maintenance,exam],created_at:"2026-08-30T00:00:00Z"};
  const current=deriveCurrentTodayState({tasks:snapshot.tasks,attempts:[],snapshot,completedMinutes:0,targetMinutes:150});
  assert.equal(current.currentTask?.problem_id,"PY-2018-Q5");
  assert.equal(current.remainingTasks.find(task=>task.id===378)?.triage,"tomorrow");
  assert.equal(current.remainingTasks.find(task=>task.id===378)?.action_class,"maintenance");
  assert.equal(current.remainingTasks.find(task=>task.problem_id==="PY-2018-Q5")?.action_class,"exam_practice");
});
