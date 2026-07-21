import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

test("selected_three_timed updates post-results on the same saved session",async()=>{
  const initial=await localGet("/api/bootstrap"),initialMinutes=initial.today.actualMinutes;
  const selected=questions.map((row,index)=>({...row,selected:index<3,plannedOrder:index<3?index+1:null,completed:false,actualScore:null,actualMinutes:null}));
  const created=await localPost("/api/past-sessions",{session_kind:"selected_three_timed",date:"2026-07-22",year:2023,stage:"calibration",scan_set_source:"past_exam_year",scan_minutes:10,actual_total_minutes:0,questions:selected});
  const before=await db.pastSessions.count();
  const completed=selected.map((row,index)=>index<3?{...row,completed:true,actualScore:70-index*5,actualMinutes:30}:{...row,completed:false,actualScore:null,actualMinutes:null});
  await localPost(`/api/past-sessions/${created.sessionId}/update`,{questions:completed,actual_total_minutes:90});
  const saved=await db.pastSessions.get(created.sessionId);
  assert.equal(await db.pastSessions.count(),before);
  assert.equal(saved.exam_score_eligible,true);
  assert.equal(saved.questions.filter(row=>row.completed).length,3);
  assert.equal((await localGet("/api/bootstrap")).today.actualMinutes,initialMinutes+90);
});

const questions=Array.from({length:5},(_,i)=>({problemId:`PY-2024-Q${i+1}`,questionLabel:`問${i+1}`,predictedType:"尤度",firstStep:"尤度を書く",predictedScore:20,predictedMinutes:25,sinkRisk:"low",selected:i<3,selectionReason:"得点可能",plannedOrder:i<3?i+1:null,actualScore:null,actualMinutes:null,completed:false}));

test("scan_only保存はAttemptもReviewも作らず通常答案採点と混同しない",async()=>{
  await localGet("/api/bootstrap");
  const before={attempts:await db.attempts.count(),reviews:await db.reviews.count(),sessions:await db.pastSessions.count()};
  await localPost("/api/past-sessions",{session_kind:"scan_only",date:"2026-07-22",year:2024,stage:"discrimination",scan_set_source:"past_exam_year",scan_minutes:10,questions});
  assert.equal(await db.attempts.count(),before.attempts);assert.equal(await db.reviews.count(),before.reviews);assert.equal(await db.pastSessions.count(),before.sessions+1);
  const saved=await db.pastSessions.orderBy("id").last();assert.equal(saved.exam_score_eligible,false);assert.equal(saved.questions[4].actualScore,null);
});

test("scan5分析は専用rubricでpastSessionへ保存しReviewを作らない",async()=>{
  const saved=await db.pastSessions.orderBy("id").last(),before=await db.reviews.count();
  await localPost(`/api/past-sessions/${saved.id}/analysis`,{text:`scan_update:\n  session_id: "${saved.id}"\n  primary_selection_error: "none"\n  rubric_version: "STAT1-SCAN5-v1"`});
  const updated=await db.pastSessions.get(saved.id);assert.equal(updated.rubric_version,"STAT1-SCAN5-v1");assert.equal(await db.reviews.count(),before);
});

test("提示されたSCAN5 YAMLをalias正規化し、未解決candidateをラベルとして安全に保存する",async()=>{
  await db.pastSessions.clear();
  await db.pastSessions.put({id:1,year:2025,date:"2026-07-22",session_type:"scan5",session_kind:"scan_only",stage:"discrimination",scan_set_source:"past_exam_year",questions,scan_minutes:10,exam_score_eligible:false});
  await db.meta.put({key:"today-plan-snapshot:2026-07-22",value:JSON.stringify({date:"2026-07-22",task_ids:["x"],tasks:[]})});
  const before={attempts:await db.attempts.count(),reviews:await db.reviews.count(),sessions:await db.pastSessions.count(),snapshot:(await db.meta.get("today-plan-snapshot:2026-07-22")).value};
  const yaml=`scan_update:
  session_id: "1"
  date: "2026-07-22"
  session_kind: "scan_only"
  stage: "discrimination"
  good_decisions: []
  bad_decisions: []
  primary_selection_error: "problem_type_underclassification"
  calibration_findings: []
  next_selection_rule: ""
  next_scan_focus: ""
  candidate_review_problem_id: "2025-統計数理-問2"
  candidate_review_reason: "型の粒度を確認する"
  grading_confidence: 0.8
  rubric_version: "STAT1-SCAN5-v1"`;
  await localPost("/api/past-sessions/1/analysis",{text:yaml});
  const saved=await db.pastSessions.get(1),analysis=saved.analysis;
  assert.equal(analysis.primary_selection_error,"type_misclassification");
  assert.equal(analysis.raw_primary_selection_error,"problem_type_underclassification");
  assert.equal(analysis.candidate_review_problem_id,null);
  assert.equal(analysis.candidate_review_label,"2025-統計数理-問2");
  assert.equal(analysis.candidate_review_reason,"型の粒度を確認する");
  assert.ok(analysis.import_normalization_logs.some(row=>row.fieldName==="primary_selection_error"&&row.rawValue==="problem_type_underclassification"));
  assert.ok(analysis.import_normalization_logs.some(row=>row.fieldName==="candidate_review_problem_id"&&row.normalizedValue===null));
  assert.equal(await db.attempts.count(),before.attempts);assert.equal(await db.reviews.count(),before.reviews);assert.equal(await db.pastSessions.count(),before.sessions);
  assert.equal((await db.meta.get("today-plan-snapshot:2026-07-22")).value,before.snapshot);
});

test("SCAN5 session_idは文字列と数値を同一視し、存在しないIDを作らない",async()=>{
  await localPost("/api/past-sessions/1/analysis",{text:'scan_update:\n  session_id: 1\n  session_kind: "scan_only"\n  stage: "discrimination"\n  primary_selection_error: "none"\n  rubric_version: "STAT1-SCAN5-v1"'});
  const before=await db.pastSessions.count();
  await assert.rejects(()=>localPost("/api/past-sessions/999/analysis",{text:'scan_update:\n  session_id: 999\n  primary_selection_error: "none"\n  rubric_version: "STAT1-SCAN5-v1"'}),/対象の5問スキャンセッションが見つかりません/);
  assert.equal(await db.pastSessions.count(),before);
});

test("SCAN5分析はsession_kindとstageの不一致を保存しない",async()=>{
  await assert.rejects(()=>localPost("/api/past-sessions/1/analysis",{text:'scan_update:\n  session_id: 1\n  session_kind: "scan_plus_one"\n  stage: "discrimination"\n  primary_selection_error: "none"\n  rubric_version: "STAT1-SCAN5-v1"'}),/session_kind/);
  await assert.rejects(()=>localPost("/api/past-sessions/1/analysis",{text:'scan_update:\n  session_id: 1\n  session_kind: "scan_only"\n  stage: "simulation"\n  primary_selection_error: "none"\n  rubric_version: "STAT1-SCAN5-v1"'}),/stage/);
});
