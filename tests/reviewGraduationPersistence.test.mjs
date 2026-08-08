import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {buildGradingContractSnapshot,taskFieldsFromContract} from "../src/gradingContract.ts";

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

function successUpdate(problemId,reviewId,contract,overrides={}){
  return {submission_id:`graduation-${problemId}-${reviewId}`,problem_id:problemId,problem_id_confirmed:true,
    problem_id_source:"yaml",date:"2026-08-08",mode:contract.mode,actual_minutes:5,mark:"○",score_numeric:90,
    score_text:"A",error_types:["none"],primary_error_type:"none",error_point:"",next_action:"別問題で転移確認",
    review_after_days:14,review_outcome:"success",target_issue_resolved:true,minimum_pass_condition_met:true,
    unresolved_carryover:[],generated_from_review_id:reviewId,rubric_version:"STAT1-REVIEW-v9",
    contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
    learning_purpose:contract.learningPurpose,review_scope:contract.reviewScope,target_kind:contract.targetKind,
    graded_part_ids:contract.gradedParts.map(part=>part.id),graded_findings:contract.gradedParts.map(part=>({
      graded_part_id:part.id,error_type:"none",evidence:"参照なしで再現",resolved:true
    })),actual_reference_level:0,hint_used:false,reference_closed_reproduction:true,...overrides};
}

test("WB-2-A-24相当の客観成功は○のまま同一retrieval系列を卒業する",async()=>{
  const {reviewId,contract}=await makeRetrievalReview("WB-2-A-24");
  await localPost("/api/attempts",successUpdate("WB-2-A-24",reviewId,contract));
  assert.equal((await db.reviews.get(reviewId)).status,"done");
  const saved=(await db.attempts.toArray()).find(row=>row.generated_from_review_id===reviewId);
  assert.equal(saved.mark,"○");
  const active=(await db.reviews.where("problem_id").equals("WB-2-A-24").toArray()).filter(row=>
    ["pending","overdue"].includes(row.status)&&(row.grading_contract?.learningPurpose||row.learning_purpose)==="retrieval_check");
  assert.equal(active.length,0);
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
