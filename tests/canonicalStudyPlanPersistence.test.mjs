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
    "duplicate_past_exam_session","past_exam_share_below_target_due_to_low_value_review","duplicate_active_past_session",
    "session_clean_kind_mutated","past_session_identity_mismatch","past_exam_major_failure_in_maintenance",
    "correction_mistaken_for_success","minor_issue_promoted_to_required","required_whitebook_without_lineage",
    "whitebook_match_low_confidence_required","old_review_suppressing_past_exam","dashboard_today_action_mismatch",
    "duplicate_root_weakness_targets","year_selection_reason_missing"])
    assert.equal(audit.counts[category],0,category);
  await localPost("/api/integrity/repair",{});
  const secondRepair=await localPost("/api/integrity/repair",{});
  assert.equal(Object.values(secondRepair.changes).reduce((sum,value)=>sum+Number(value||0),0),0);
  assert.equal(secondRepair.after.activeIssueCount,0,JSON.stringify(secondRepair.after.issues));
});

test("latest-data相当の2018 clean/practice重複は履歴を残して1 current sessionへ収束する",async()=>{
  const today=todayString(),year=2018;
  const old=(await db.pastSessions.toArray()).filter(row=>row.date===today&&row.year===year).map(row=>row.id);
  if(old.length)await db.pastSessions.bulkDelete(old);
  const base={date:today,year,session_kind:"selected_three_timed",session_purpose:"timed_three_question_session",
    session_ordinal:1,stage:"calibration",scan_set_source:"past_exam_year",questions:[]};
  await db.pastSessions.add({...base,scan_minutes:10,scan_evidence_kind:"clean",
    exposure_snapshot_at_start:{classification:"clean",exposed_problem_ids:[],total_problem_count:5,captured_at:`${today}T00:00:00Z`}});
  await db.pastSessions.add({...base,scan_minutes:20,scan_evidence_kind:"practice"});
  const before=await localPost("/api/integrity/audit",{});
  assert.equal(before.counts.duplicate_active_past_session,1);
  const repaired=await localPost("/api/integrity/repair",{});
  assert.ok(repaired.changes.pastSessionsSuperseded>=1);
  const raw=await db.pastSessions.toArray();
  const active=raw.filter(row=>row.date===today&&row.year===year&&!row.superseded_by_session_id);
  assert.equal(active.length,1);
  assert.equal(active[0].scan_evidence_kind,"clean");
  assert.equal(active[0].session_purpose,"timed_three_question_session");
  assert.equal(active[0].exposure_snapshot_at_start.classification,"clean");
  assert.equal(raw.filter(row=>row.date===today&&row.year===year).length,2,"history rows are retained");
  const current=await localGet("/api/bootstrap");
  assert.equal(current.today.currentTask.stable_session_key,current.today.canonicalStudyPlan.primaryAction.stable_session_key);
  const again=await localPost("/api/integrity/repair",{});
  assert.equal(Object.values(again.changes).reduce((sum,value)=>sum+Number(value||0),0),0);
  assert.equal(again.after.counts.duplicate_active_past_session,0);
  assert.equal(again.after.counts.session_clean_kind_mutated,0);
});
