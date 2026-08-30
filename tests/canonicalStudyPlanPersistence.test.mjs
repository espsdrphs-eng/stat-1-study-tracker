import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const {todayString}=await import("../src/importParser.ts");
const {rollingPastExamShare}=await import("../src/adaptivePlanner.ts");

test("bootstrap/reload/reconcileは同じcanonical Study Planと未実施PastExamSessionを維持する",async()=>{
  const today=todayString();
  const first=await localGet("/api/bootstrap");
  const session=first.today.tasks.find(task=>task.past_exam_task_type==="timed_three_question_session");
  assert.ok(session,JSON.stringify(first.today.tasks));
  assert.ok(session.stable_session_key);
  assert.match(session.title,/\d{4}年 本番型session/);
  assert.match(session.session_workflow,/5問scan.*3問選択.*3問答案.*採点/);
  assert.equal(first.today.currentTask.stable_session_key,first.today.canonicalStudyPlan.primaryAction.stable_session_key);
  assert.equal(first.dashboard.kpis.nextAction.value,session.title);
  const snapshotKey=`today-plan-snapshot:${today}`;
  const rawBefore=(await db.meta.get(snapshotKey)).value;
  const second=await localGet("/api/bootstrap");
  const rawAfter=(await db.meta.get(snapshotKey)).value;
  assert.equal(rawAfter,rawBefore,"reload must not rewrite start-of-day history");
  assert.equal(second.today.currentTask.stable_session_key,session.stable_session_key);
  assert.equal(second.today.canonicalStudyPlan.sourceStateVersion,first.today.canonicalStudyPlan.sourceStateVersion);
  assert.ok(rollingPastExamShare(second.adaptiveLearning.plannerShadow.plan14.plan.slice(0,7))>=.65);
  const audit=await localPost("/api/integrity/audit",{});
  for(const category of ["canonical_action_mismatch","unexecuted_past_session_replaced","past_exam_single_problem_90min",
    "past_exam_session_identity_mismatch","minor_issue_promoted_to_required_repair","repair_without_source_lineage",
    "whitebook_repair_low_match","preferred_date_marked_hard_overdue","maintenance_suppressing_exam_practice",
    "duplicate_past_exam_session","past_exam_share_below_target_due_to_low_value_review"])
    assert.equal(audit.counts[category],0,category);
  await localPost("/api/integrity/repair",{});
  const secondRepair=await localPost("/api/integrity/repair",{});
  assert.equal(Object.values(secondRepair.changes).reduce((sum,value)=>sum+Number(value||0),0),0);
  assert.equal(secondRepair.after.activeIssueCount,0,JSON.stringify(secondRepair.after.issues));
});
