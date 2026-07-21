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
