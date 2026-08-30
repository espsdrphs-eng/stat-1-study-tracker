import test from "node:test";
import assert from "node:assert/strict";
import {deriveCanonicalStudyPlan} from "../src/canonicalStudyPlan.ts";

test("canonical Study PlanはDashboard/Today用の同じprimary actionを返す",()=>{
  const maintenance={problem_id:"WB-6-A-19",title:"任意維持",kind:"局所補修",reason:"14日経過",mode:"check",
    minutes:5,load:0,triage:"tomorrow",review_type:"light_check",learning_purpose:"retrieval_check",
    review_planning_tier:"deferred_maintenance"};
  const session={problem_id:"PY-2018-Q1",title:"2018年 本番型session",kind:"得点形成",reason:"本番型",mode:"full",
    minutes:90,load:0,triage:"must",past_exam_task_type:"timed_three_question_session",past_exam_year:2018,
    stable_session_key:"past_exam_session:2018:timed:2026-08-30"};
  const plan=deriveCanonicalStudyPlan({tasks:[maintenance,session],today:"2026-08-30",generatedAt:"2026-08-30T00:00:00Z"});
  assert.equal(plan.primaryAction.stable_session_key,session.stable_session_key);
  assert.deepEqual(plan.examPractice.map(row=>row.stable_session_key),[session.stable_session_key]);
  assert.deepEqual(plan.optionalMaintenance.map(row=>row.problem_id),[maintenance.problem_id]);
  assert.equal(plan.requiredRepairs.length,0);
  assert.equal(plan.rollingAllocation.examPracticeMinutes,90);
});
