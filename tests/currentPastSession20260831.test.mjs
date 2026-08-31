import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

const questions=Array.from({length:5},(_,index)=>({
  problemId:`PY-2018-Q${index+1}`,questionLabel:`問${index+1}`,
  predictedType:["確率分布","推定","漸近","回帰","検定"][index],firstStep:"式を立てる",
  predictedScore:[60,20,80,0,60][index],predictedMinutes:20,sinkRisk:"medium",
  selected:[0,2,4].includes(index),selectionReason:"得点候補",plannedOrder:[0,2,4].includes(index)?[0,2,4].indexOf(index)+1:null,
  actualScore:null,actualMinutes:null,completed:false,
}));

test("latest 2018 current stateはduplicateを保持したままAttempt evidenceで1件のclean completed sessionへ収束する",async()=>{
  await localGet("/api/bootstrap");
  const sessionIds=(await db.pastSessions.toArray()).filter(row=>row.year===2018).map(row=>row.id);
  if(sessionIds.length)await db.pastSessions.bulkDelete(sessionIds);
  const attemptIds=(await db.attempts.toArray()).filter(row=>/^PY-2018-Q[1-5]$/.test(row.problem_id)).map(row=>row.id);
  if(attemptIds.length)await db.attempts.bulkDelete(attemptIds);
  const cleanId=Number(await db.pastSessions.add({year:2018,date:"2026-08-30",session_type:"scan5",session_kind:"selected_three_timed",
    session_purpose:"timed_three_question_session",stage:"calibration",scan_set_source:"past_exam_year",scan_evidence_kind:"clean",
    scan_minutes:0,questions:questions.map(row=>({...row,selected:false})),initial_selected_problem_ids:[],
    exposure_snapshot_at_start:{classification:"clean",exposed_problem_ids:[],total_problem_count:5,captured_at:"2026-08-30T00:00:00Z"}}));
  const practiceId=Number(await db.pastSessions.add({year:2018,date:"2026-08-30",session_type:"scan5",session_kind:"selected_three_timed",
    session_purpose:"timed_three_question_session",stage:"calibration",scan_set_source:"past_exam_year",scan_evidence_kind:"practice",
    scan_minutes:10,questions,initial_selected_problem_ids:["PY-2018-Q1","PY-2018-Q3","PY-2018-Q5"],
    selected_year_reason:"完全未見5問からclean選題・時間内完遂を測るため"}));
  const rows=[[1,56,40],[3,50,20],[5,32,20],[2,24,15],[4,12,15]];
  for(const [q,score,time] of rows)await db.attempts.add({problem_id:`PY-2018-Q${q}`,date:"2026-08-31",mode:"full",time_minutes:time,
    score_numeric:score,score_label:"C",mark:"△",error_type:"W",error_point:"主要計算",next_action:"補修",memo:"",actual_reference_level:0});

  const first=await localPost("/api/integrity/repair",{});
  const raw=await db.pastSessions.toArray(),current=raw.filter(row=>row.year===2018&&!row.superseded_by_session_id);
  assert.equal(current.length,1);
  const session=current[0];
  assert.equal(session.scan_evidence_kind,"clean");assert.equal(session.session_state,"completed");
  assert.deepEqual(session.initial_selected_problem_ids,["PY-2018-Q1","PY-2018-Q3","PY-2018-Q5"]);
  assert.equal(session.selected_answer_count,3);assert.deepEqual(session.questions.filter(row=>row.completed).map(row=>row.actualScore),[56,50,32]);
  assert.equal(session.selected_solve_minutes,80);assert.equal(session.scan_minutes,10);assert.equal(session.session_elapsed_minutes,90);
  assert.deepEqual(session.questions.filter(row=>!row.completed&&row.actualScore!=null).map(row=>row.actualScore),[24,12]);
  assert.equal(session.selection_success_count,3);assert.equal(session.selection_success_rate,1);assert.equal(session.analysis_status,"not_started");
  const supersededId=raw.find(row=>row.year===2018&&row.superseded_by_session_id)?.id;
  assert.ok([cleanId,practiceId].includes(supersededId));

  const analysisId=supersededId;
  const result=await localPost(`/api/past-sessions/${analysisId}/analysis`,{text:`scan_update:
session_id: “${analysisId}”
primary_selection_error: “type_misclassification”
good_decisions: []
bad_decisions: []
calibration_findings: []
next_selection_rule: “複合設問を分解する”
next_scan_focus: “型の粒度と得点較正”
candidate_review_problem_id: “PY-2018-Q3”
grading_confidence: 99
rubric_version: “STAT1-SCAN5-v1”`});
  assert.equal(result.canonicalSessionId,session.id);
  const analyzed=await db.pastSessions.get(session.id);
  assert.equal(analyzed.analysis_status,"completed");assert.equal(analyzed.analysis.grading_confidence,.99);
  assert.equal(analyzed.analysis.candidate_review_problem_id,"PY-2018-Q3");

  const second=await localPost("/api/integrity/repair",{});
  assert.equal(second.changes.pastSessionsSuperseded,0);
  assert.ok(first.changes.pastSessionsSuperseded>0);
  const live=await localGet("/api/bootstrap");
  assert.equal(live.masterStatus.integrity_summary.blockingIntegrityIssueCount,0,
    JSON.stringify(live.masterStatus.integrity_summary.activeCategories));
  assert.equal(live.masterStatus.integrity_summary.plannerPolicyViolationCount,0,
    JSON.stringify(live.masterStatus.integrity_summary.activeCategories));
});
