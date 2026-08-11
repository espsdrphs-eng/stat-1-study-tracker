import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {buildGradingContractSnapshot,taskFieldsFromContract} from "../src/gradingContract.ts";
import {projectStudyUpdateLifecycle} from "../src/studyUpdateLifecycle.ts";

const {db,localGet,localPost}=await import("../src/localDb.ts");

async function makeRetrievalReview(problemId){
  await localGet("/api/bootstrap");
  const problem=await db.problems.get(problemId);
  assert.ok(problem);
  const sourceId=Number(await db.attempts.add({problem_id:problemId,date:"2026-08-01",mode:"check",time_minutes:5,
    mark:"○",score_label:"A",score_numeric:90,error_type:"none",primary_error_type:"none",error_types:["none"],
    target_issue_resolved:true,minimum_pass_condition_met:true,unresolved_carryover:[],
    error_point:"",next_action:"短く想起する",memo:""}));
  const draft={problem_id:problemId,due_date:"2026-08-08",review_type:"light_check",status:"pending",
    generated_from_attempt_id:sourceId,source_attempt_id:sourceId,learning_purpose:"retrieval_check",
    assessment_timing:"delayed_retrieval",targeted_parts:["型・初手"],duration_minutes:5,exclude_from_planning:false};
  const source=await db.attempts.get(sourceId);
  const {contract}=buildGradingContractSnapshot({review:draft,problem,sourceAttempt:source});
  const reviewId=Number(await db.reviews.add({...draft,...taskFieldsFromContract(contract)}));
  return {reviewId,contract};
}

async function makeRepairReview(problemId){
  await localGet("/api/bootstrap");
  let problem=await db.problems.get(problemId);
  if(!problem){
    await db.problems.put({id:990014,problem_id:problemId,source_type:"whitebook",category:"A",chapter:5,
      problem_number:14,title:"第5章A問14",theme:"変数変換",priority:"A",role:"得点形成",
      recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",
      completion_status:"not_started",canonical_problem_type:"変数変換",canonical_keywords:["逆変換","ヤコビアン"]});
    problem=await db.problems.get(problemId);
  }
  assert.ok(problem);
  await db.attempts.where("problem_id").equals(problemId).delete();
  await db.reviews.where("problem_id").equals(problemId).delete();
  const sourceId=Number(await db.attempts.add({problem_id:problemId,date:"2026-08-08",mode:"full",time_minutes:35,
    mark:"△",score_label:"C",score_numeric:48,error_type:"N",primary_error_type:"N",error_types:["N","C"],
    target_issue_resolved:false,minimum_pass_condition_met:false,
    error_point:"逆変換、ヤコビアン、同時密度の積分範囲が未修復",
    next_action:"逆変換、ヤコビアン、同時密度の積分範囲だけを再現する",memo:""}));
  const draft={problem_id:problemId,due_date:"2026-08-10",review_type:"targeted_patch",status:"pending",
    generated_from_attempt_id:sourceId,source_attempt_id:sourceId,learning_purpose:"error_repair",
    assessment_timing:"delayed_retrieval",targeted_parts:["逆変換","ヤコビアン","同時密度の積分範囲"],
    duration_minutes:10,exclude_from_planning:false};
  const source=await db.attempts.get(sourceId);
  const {contract}=buildGradingContractSnapshot({review:draft,problem,sourceAttempt:source});
  const reviewId=Number(await db.reviews.add({...draft,...taskFieldsFromContract(contract)}));
  return {reviewId,contract};
}

function successUpdate(problemId,reviewId,contract,overrides={}){
  return {submission_id:`graduation-${problemId}-${reviewId}`,problem_id:problemId,problem_id_confirmed:true,
    problem_id_source:"yaml",date:"2026-08-08",mode:contract.mode,actual_minutes:5,mark:"○",score_numeric:90,
    score_text:"A",error_types:["none"],primary_error_type:"none",error_point:"",next_action:"別問題で転移確認",
    review_after_days:14,review_outcome:"success",target_issue_resolved:true,minimum_pass_condition_met:true,
    unresolved_carryover:[],generated_from_review_id:reviewId,rubric_version:"STAT1-REVIEW-v9",
    contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
    learning_purpose:contract.learningPurpose,review_scope:contract.reviewScope,target_kind:contract.targetKind,
    evaluation_scope:"conditional_full",graded_parts:contract.gradedParts.map(part=>part.label),
    graded_part_ids:contract.gradedParts.map(part=>part.id),graded_findings:contract.gradedParts.map(part=>({
      graded_part_id:part.id,error_type:"none",evidence:"参照なしで再現",resolved:true
    })),actual_reference_level:0,hint_used:false,reference_closed_reproduction:true,...overrides};
}

test("WB-2-A-24相当の客観成功はscoreに依存せず◎となり同一retrieval系列を卒業する",async()=>{
  const {reviewId,contract}=await makeRetrievalReview("WB-2-A-24");
  await localPost("/api/attempts",successUpdate("WB-2-A-24",reviewId,contract));
  assert.equal((await db.reviews.get(reviewId)).status,"done");
  const saved=(await db.attempts.toArray()).find(row=>row.generated_from_review_id===reviewId);
  assert.equal(saved.mark,"◎");
  assert.equal((await db.problems.get("WB-2-A-24")).completion_status,"completed");
  const active=(await db.reviews.where("problem_id").equals("WB-2-A-24").toArray()).filter(row=>
    ["pending","overdue"].includes(row.status)&&(row.grading_contract?.learningPurpose||row.learning_purpose)==="retrieval_check");
  assert.equal(active.length,0);
});

test("Review 365 equivalent preview, save, and reload share the canonical repair mark",async()=>{
  const problemId="WB-6-A-19",repair=await makeRepairReview(problemId);
  const sourceReview=await db.reviews.get(repair.reviewId);
  const sourceAttempt=await db.attempts.get(sourceReview.generated_from_attempt_id);
  const problem=await db.problems.get(problemId);
  const update=successUpdate(problemId,repair.reviewId,repair.contract,{
    date:"2026-08-11",score_numeric:95,mark:"△",assessment_timing:"delayed_retrieval",
    resolution_evidence:"採点対象を参照なしで修正した",answer_change_summary:"対象を修正した",
    required_work_shown:repair.contract.gradedParts.map(part=>part.label),
  });
  const preview=projectStudyUpdateLifecycle({update,sourceReview,sourceAttempt,problem});
  assert.equal(preview.update.mark,"○");
  assert.equal(preview.lifecycle.graduated,false);
  assert.equal(preview.lifecycle.nextTransition,"retrieval_check");
  await localPost("/api/attempts",update);
  const saved=(await db.attempts.where("problem_id").equals(problemId).toArray())
    .find(row=>row.generated_from_review_id===repair.reviewId);
  assert.equal(saved.mark,preview.update.mark);
  await localGet("/api/bootstrap");
  assert.equal((await db.attempts.get(saved.id)).mark,preview.update.mark);
  const retrieval=(await db.reviews.where("problem_id").equals(problemId).toArray()).filter(row=>
    ["pending","overdue"].includes(row.status)&&(row.grading_contract?.learningPurpose||row.learning_purpose)==="retrieval_check");
  assert.equal(retrieval.length,1);
});

test("参照を使った成功は卒業せず同じ目的の遅延確認を残す",async()=>{
  const {reviewId,contract}=await makeRetrievalReview("WB-2-A-24");
  await localPost("/api/attempts",successUpdate("WB-2-A-24",reviewId,contract,{
    actual_reference_level:1,hint_used:true,reference_closed_reproduction:true,
  }));
  const active=(await db.reviews.where("problem_id").equals("WB-2-A-24").toArray()).filter(row=>
    ["pending","overdue"].includes(row.status)&&(row.grading_contract?.learningPurpose||row.learning_purpose)==="retrieval_check");
  assert.equal(active.length,1);
  assert.notEqual(active[0].generated_from_attempt_id,(await db.reviews.get(reviewId)).generated_from_attempt_id);
});

test("WB-5-A-14相当はrepair成功○から1回のdelayed checkを経て◎で卒業する",async()=>{
  const problemId="WB-5-A-14";
  const repair=await makeRepairReview(problemId);
  await localPost("/api/attempts",successUpdate(problemId,repair.reviewId,repair.contract,{
    date:"2026-08-10",actual_minutes:10,score_numeric:98,mark:"◎",
    resolution_evidence:"逆変換、ヤコビアン、同時密度の積分範囲を答案中で整合させた",
    answer_change_summary:"3点を修正した",required_work_shown:["逆変換","ヤコビアン","積分範囲"]
  }));
  const repairAttempt=(await db.attempts.where("problem_id").equals(problemId).toArray())
    .find(row=>row.generated_from_review_id===repair.reviewId);
  assert.equal(repairAttempt.mark,"○");
  assert.equal((await db.problems.get(problemId)).completion_status,"review_pending");

  const checks=(await db.reviews.where("problem_id").equals(problemId).toArray()).filter(row=>
    ["pending","overdue"].includes(row.status)&&(row.grading_contract?.learningPurpose||row.learning_purpose)==="retrieval_check");
  assert.equal(checks.length,1);
  const check=checks[0],contract=check.grading_contract;
  assert.ok(contract);
  await localPost("/api/attempts",successUpdate(problemId,check.id,contract,{
    date:"2026-08-20",score_numeric:88,score_text:"A",mark:"○"
  }));
  const retentionAttempt=(await db.attempts.where("problem_id").equals(problemId).toArray())
    .find(row=>row.generated_from_review_id===check.id);
  assert.equal(retentionAttempt.mark,"◎");
  assert.equal((await db.problems.get(problemId)).completion_status,"completed");
  const active=(await db.reviews.where("problem_id").equals(problemId).toArray()).filter(row=>
    ["pending","overdue"].includes(row.status)&&["error_repair","retrieval_check"].includes(row.grading_contract?.learningPurpose||row.learning_purpose));
  assert.equal(active.length,0);
});
