import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

test("selected_three_timed updates post-results on the same saved session",async()=>{
  const date=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const initial=await localGet("/api/bootstrap"),initialMinutes=initial.today.actualMinutes;
  const selected=questions.map((row,index)=>({...row,selected:index<3,plannedOrder:index<3?index+1:null,completed:false,actualScore:null,actualMinutes:null}));
  const created=await localPost("/api/past-sessions",{session_kind:"selected_three_timed",date,year:2023,stage:"calibration",scan_set_source:"past_exam_year",scan_minutes:10,actual_total_minutes:0,questions:selected});
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

test("past_exam full/timedのclean答案は採点対象だが同一問題の定期Reviewを作らない",async()=>{
  await localGet("/api/bootstrap");
  const problemId="PY-2019-Q1";
  const oldAttempts=(await db.attempts.toArray()).filter(row=>row.problem_id===problemId).map(row=>row.id);
  const oldReviews=(await db.reviews.toArray()).filter(row=>row.problem_id===problemId).map(row=>row.id);
  if(oldAttempts.length)await db.attempts.bulkDelete(oldAttempts);
  if(oldReviews.length)await db.reviews.bulkDelete(oldReviews);
  await localPost("/api/attempts",{
    submission_id:"past-full-clean-2019-q1",problem_id:problemId,problem_id_confirmed:true,problem_id_source:"yaml",
    date:"2026-08-10",mode:"full",actual_minutes:30,time_limit_minutes:35,conclusion_reached:true,
    mark:"◎",score_text:"A",score_numeric:88,error_types:["none"],primary_error_type:"none",
    error_point:"",next_action:"別問題で転移確認",review_outcome:"success",target_issue_resolved:true,
    minimum_pass_condition_met:true,actual_reference_level:0,evaluation_scope:"full",
    learning_purpose:"exam_performance",assessment_timing:"independent_performance",rubric_version:"STAT1-REVIEW-v9"
  });
  const saved=(await db.attempts.toArray()).find(row=>row.submission_id==="past-full-clean-2019-q1");
  assert.ok(saved);
  assert.equal(saved.mark,"○");
  assert.equal(saved.exam_score_eligible,true);
  assert.equal((await db.reviews.toArray()).filter(row=>row.problem_id===problemId&&["pending","overdue"].includes(row.status)).length,0);
  assert.equal((await db.problems.get(problemId)).completion_status,"completed");
});

test("past_exam full/timed失敗は即時訂正後の同一problem delayed確認だけを作りcandidate relationを自動採用しない",async()=>{
  await localGet("/api/bootstrap");
  const problemId="PY-2021-Q1";
  const oldAttempts=(await db.attempts.toArray()).filter(row=>row.problem_id===problemId).map(row=>row.id);
  const oldReviews=(await db.reviews.toArray()).filter(row=>row.problem_id===problemId).map(row=>row.id);
  if(oldAttempts.length)await db.attempts.bulkDelete(oldAttempts);
  if(oldReviews.length)await db.reviews.bulkDelete(oldReviews);
  await localPost("/api/attempts",{
    submission_id:"past-timed-fail-2021-q1",problem_id:problemId,problem_id_confirmed:true,problem_id_source:"yaml",
    date:"2026-08-10",mode:"timed_single",actual_minutes:35,time_limit_minutes:35,conclusion_reached:true,
    mark:"○",score_text:"C",score_numeric:48,error_types:["W"],primary_error_type:"W",
    error_point:"主要計算の式変形を誤った",next_action:"主要計算だけを再現する",review_outcome:"partial",
    target_issue_resolved:false,minimum_pass_condition_met:false,actual_reference_level:0,evaluation_scope:"full",
    targeted_parts:["主要計算の式変形"],learning_purpose:"exam_performance",
    assessment_timing:"independent_performance",rubric_version:"STAT1-REVIEW-v9"
  });
  const saved=(await db.attempts.toArray()).find(row=>row.submission_id==="past-timed-fail-2021-q1");
  assert.ok(saved);
  assert.equal(saved.mark,"×");
  assert.equal(saved.exam_score_eligible,true);
  const delayed=(await db.reviews.toArray()).filter(row=>row.problem_id===problemId&&
    ["pending","overdue"].includes(row.status));
  assert.equal(delayed.length,1);
  assert.equal(delayed[0].grading_contract?.learningPurpose||delayed[0].learning_purpose,"retrieval_check");
  assert.equal(delayed[0].assessment_timing,"delayed_retrieval");
  assert.equal(delayed[0].correction_provided,true);
  assert.equal(delayed[0].retention_pending,true);
  assert.equal(delayed[0].problem_id,problemId);
  assert.ok(!delayed[0].target_problem_id||delayed[0].target_problem_id===problemId);
  assert.ok(!delayed[0].relation_id);
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
