import test from "node:test";
import assert from "node:assert/strict";
import {adaptivePlanDayToTasks,projectAdaptiveSnapshotTasks} from "../src/adaptiveTodayPlan.ts";

const problem=(id)=>({
  id:1,problem_id:id,title:id,display_label:id,category:"A",chapter:4,problem_number:1,
  theme:"theme",canonical_problem_type:"type",canonical_keywords:[],strategy_rank:"A+"
});

test("正式日次計画は得点形成・補修・維持を同じToday Task表現へ変換する",()=>{
  const contract={contractId:"review:9:1",contractVersion:"STAT1-CONTRACT-v2",contractHash:"hash",
    createdAt:"2026-08-01T00:00:00Z",problemId:"WB-4-A-02",sourceAttemptId:2,
    learningPurpose:"retrieval_check",learningStage:"maintenance",mode:"check",reviewScope:"check_only",
    targetedParts:[],gradedParts:[{id:"first_step",label:"初手",cueLabel:"初手",allowedErrorTypes:["N","none"],completionCriterionId:"recall"}],
    explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:"recall",displayText:"短く想起"}],
    hiddenAnswerKey:[],completionConditions:["短く想起"],requiredEvidence:["初手"],allowedErrorTypes:["N"],
    requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet"};
  const review={id:9,problem_id:"WB-4-A-02",due_date:"2026-08-04",interval_days:3,
    review_type:"main_calc_retry",status:"pending",generated_from_attempt_id:2,
    policy_validity:"valid",exclude_from_planning:false,effective_mode:"check",
    grading_contract:contract,contract_id:contract.contractId,contract_hash:contract.contractHash};
  const day={date:"2026-08-04",totalMinutes:55,tasks:[
    {taskKey:"score",date:"2026-08-04",slot:"score_building",kind:"whitebook",label:"A",
      problemId:"WB-4-A-01",minutes:35,reason:"得点形成",requiresUserSelection:false,todayCategory:"repair"},
    {taskKey:"repair",date:"2026-08-04",slot:"repair",kind:"review",label:"repair",
      problemId:"WB-4-A-02",reviewId:9,minutes:5,reason:"局所補修",requiresUserSelection:false},
    {taskKey:"maint",date:"2026-08-04",slot:"maintenance_selection",kind:"whitebook",label:"M",
      problemId:"WB-5-A-01",minutes:15,reason:"維持",requiresUserSelection:false}
  ]};
  const tasks=adaptivePlanDayToTasks({day,problems:[problem("WB-4-A-01"),problem("WB-4-A-02"),problem("WB-5-A-01")],
    reviews:[review],today:"2026-08-04"});
  assert.equal(tasks.filter(row=>row.kind==="得点形成").length,1);
  assert.equal(tasks.filter(row=>row.id===9).length,1);
  assert.equal(tasks.filter(row=>row.kind==="維持・選択").length,1);
  assert.equal(tasks.every(row=>row.plan_origin==="adaptive_planner"),true);
  assert.equal(tasks.find(row=>row.id===9)?.triage,"must");
  assert.equal(tasks.find(row=>row.kind==="維持・選択")?.triage,"if_time");
  assert.equal(tasks.find(row=>row.problem_id==="WB-4-A-01")?.today_category,"repair");
  assert.equal(tasks.find(row=>row.id===9)?.today_category,"repair");
});

test("選択確認と同一論理課題は確定計画へ重複投入しない",()=>{
  const day={date:"2026-08-04",totalMinutes:45,tasks:[
    {taskKey:"confirm",date:"2026-08-04",slot:"maintenance_selection",kind:"exposure_confirmation",
      label:"素材確認",minutes:10,reason:"unknown",requiresUserSelection:true},
    ...[1,2].map(index=>({taskKey:`score-${index}`,date:"2026-08-04",slot:"score_building",
      kind:"whitebook",label:"A",problemId:"WB-4-A-01",minutes:35,reason:"得点形成",requiresUserSelection:false}))
  ]};
  const tasks=adaptivePlanDayToTasks({day,problems:[problem("WB-4-A-01")],reviews:[],today:"2026-08-04"});
  assert.equal(tasks.length,1);
  assert.equal(tasks[0].problem_id,"WB-4-A-01");
});

test("90分PastExamSessionはanchor problemではなくsession identityで表示する",()=>{
  const day={date:"2026-08-30",totalMinutes:90,tasks:[{
    taskKey:"session",date:"2026-08-30",slot:"score_building",kind:"timed",label:"2018年 本番型session",
    problemId:"PY-2018-Q1",referenceProblemId:"PE-2018-Q01",minutes:90,reason:"本番型",requiresUserSelection:false,
    pastExamTaskType:"timed_three_question_session",pastExamYear:2018,
    sessionProblemIds:[1,2,3,4,5].map(n=>`PY-2018-Q${n}`),stableSessionKey:"past_exam_session:2018:timed:2026-08-30",
    sessionWorkflow:"5問scan → 3問選択 → 3問答案 → 採点",todayCategory:"exam_practice"
  }]};
  const tasks=adaptivePlanDayToTasks({day,problems:[problem("PY-2018-Q1")],reviews:[],today:"2026-08-30"});
  assert.equal(tasks[0].title,"2018年 本番型session");
  assert.equal(tasks[0].stable_session_key,"past_exam_session:2018:timed:2026-08-30");
  assert.equal(tasks[0].session_workflow,"5問scan → 3問選択 → 3問答案 → 採点");
});

test("stale morning generic task is replaced by current eligible plan without mutating snapshot",()=>{
  const saved={problem_id:"WB-7-A-07",title:"old",kind:"score",reason:"old",mode:"skeleton",minutes:25,load:1,
    triage:"must",plan_origin:"adaptive_planner"};
  const current={problem_id:"WB-7-A-08",title:"new",kind:"score",reason:"current",mode:"skeleton",minutes:25,load:1,
    triage:"must",plan_origin:"adaptive_planner"};
  const contract={contractId:"review:384:1",contractVersion:"STAT1-CONTRACT-v2",contractHash:"hash384",
    createdAt:"2026-08-13",problemId:"WB-7-A-07",reviewId:384,sourceAttemptId:1,learningPurpose:"error_repair",
    learningStage:"repair",mode:"main_calc",reviewScope:"main_calc_target",targetKind:"mathematical_patch",
    targetedParts:["x"],gradedParts:[{id:"x",label:"x",cueLabel:"x",allowedErrorTypes:["W","none"],completionCriterionId:"x",
      stableTargetKey:"target:WB-7-A-07:root:x"}],explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],
    completionCriteria:[{id:"x",displayText:"x"}],hiddenAnswerKey:[],completionConditions:["x"],requiredEvidence:["x"],
    allowedErrorTypes:["W"],requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:12,sheetType:"main_calc_sheet"};
  const review={id:384,problem_id:"WB-7-A-07",due_date:"2026-08-15",earliest_date:"2026-08-14",latest_date:"2026-08-16",
    interval_days:2,review_type:"main_calc_retry",status:"pending",generated_from_attempt_id:1,source_attempt_id:1,
    learning_purpose:"error_repair",effective_mode:"main_calc",review_scope:"main_calc_target",sheet_type:"main_calc_sheet",
    contract_id:contract.contractId,contract_hash:contract.contractHash,grading_contract:contract};
  const snapshot=[structuredClone(saved)];
  const result=projectAdaptiveSnapshotTasks({snapshotTasks:snapshot,generatedTasks:[current],reviews:[review],today:"2026-08-14"});
  assert.equal(result.length,1);
  assert.equal(result[0].problem_id,"WB-7-A-08");
  assert.equal(snapshot[0].problem_id,"WB-7-A-07");
});
