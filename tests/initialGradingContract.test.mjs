import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {buildInitialGradingContract} from "../src/gradingContract.ts";
import {buildFirstAttemptGradingPrompt} from "../src/gradingPrompt.ts";

const {db,localGet,localPost}=await import("../src/localDb.ts");

const updateFor=(problem,contract,submissionId,failed=false)=>{
  const failedId=contract.gradedParts.find(row=>row.masteryLevel===2)?.id||contract.gradedParts[0].id;
  const findings=contract.gradedParts.map(row=>row.id===failedId&&failed
    ?{graded_part_id:row.id,error_type:"W",evidence:"主要計算を完遂できない",resolved:false}
    :{graded_part_id:row.id,error_type:"none",evidence:"答案で確認",resolved:true});
  return {submission_id:submissionId,problem_id:problem.problem_id,problem_id_confirmed:true,date:"2026-08-27",
    mode:contract.mode,actual_minutes:contract.estimatedMinutes,score_label:failed?"B":"S",score_numeric:failed?60:100,
    error_type:failed?"W":"none",primary_error_type:failed?"W":"none",error_types:failed?["W"]:["none"],
    error_point:failed?"主要計算を完遂できない":"",next_action:failed?"主要計算だけを修正する":"別問題で転移確認",
    contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
    learning_purpose:contract.learningPurpose,learning_stage:contract.learningStage,review_scope:contract.reviewScope,
    assessment_timing:"independent_performance",graded_part_ids:contract.gradedParts.map(row=>row.id),graded_findings:findings,
    target_issue_resolved:!failed,minimum_pass_condition_met:!failed,review_outcome:failed?"failed":"success",
    actual_reference_level:0,allowed_reference_level:0};
};

test("Whitebook完全初回はReviewなしで固定initial contractと採点promptを生成する",async()=>{
  await localGet("/api/bootstrap");
  const problem=await db.problems.get("WB-4-A-05");
  assert.ok(problem);
  const attempts=await db.attempts.where("problem_id").equals(problem.problem_id).toArray();
  const reviews=await db.reviews.where("problem_id").equals(problem.problem_id).toArray();
  if(attempts.length)await db.attempts.bulkDelete(attempts.map(row=>row.id));
  if(reviews.length)await db.reviews.bulkDelete(reviews.map(row=>row.id));
  const before=await db.reviews.where("problem_id").equals(problem.problem_id).count();
  const contract=buildInitialGradingContract({problem,mode:"full",createdAt:"2026-08-27T00:00:00Z"});
  const prompt=buildFirstAttemptGradingPrompt({problemId:problem.problem_id,mode:"full",gradingContract:contract});
  assert.match(contract.contractId,/^initial:WB-4-A-05:full:[0-9a-f]{8}$/);
  assert.doesNotMatch(contract.contractId,/review:|attempt:/);
  assert.match(prompt,new RegExp(contract.contractId.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(prompt,/Reviewを参照しない/);
  assert.equal(await db.reviews.where("problem_id").equals(problem.problem_id).count(),before,"prompt生成はdummy Reviewを作らない");
});

test("past exam完全初回fullもReviewなしで正式initial contractを生成する",async()=>{
  await localGet("/api/bootstrap");
  const problem=await db.problems.get("PY-2018-Q1");
  assert.ok(problem);
  const contract=buildInitialGradingContract({problem,mode:"full",createdAt:"2026-08-27T00:00:00Z"});
  const prompt=buildFirstAttemptGradingPrompt({problemId:problem.problem_id,mode:"full",gradingContract:contract});
  assert.equal(contract.learningPurpose,"exam_performance");
  assert.equal(contract.reviewScope,"full_answer");
  assert.match(prompt,/task_origin: "first_attempt"/);
  assert.doesNotMatch(prompt,/generated_from_review_id:/);
});

test("initial contractはAttemptへ保存され、失敗後だけ必要Reviewを作る",async()=>{
  await localGet("/api/bootstrap");
  const failedProblem=await db.problems.get("WB-4-A-05"),successProblem=(await db.problems.toArray())
    .find(row=>row.category==="A"&&row.problem_id!=="WB-4-A-05");
  assert.ok(failedProblem&&successProblem);
  for(const problem of [failedProblem,successProblem]){
    const attempts=await db.attempts.where("problem_id").equals(problem.problem_id).toArray();
    const reviews=await db.reviews.where("problem_id").equals(problem.problem_id).toArray();
    if(attempts.length)await db.attempts.bulkDelete(attempts.map(row=>row.id));
    if(reviews.length)await db.reviews.bulkDelete(reviews.map(row=>row.id));
  }
  const failedContract=buildInitialGradingContract({problem:failedProblem,mode:"full",createdAt:"2026-08-27T00:00:00Z"});
  await localPost("/api/attempts",updateFor(failedProblem,failedContract,"initial-contract-failed",true));
  const failedAttempt=(await db.attempts.toArray()).find(row=>row.submission_id==="initial-contract-failed");
  assert.equal(failedAttempt?.grading_contract?.contractId,failedContract.contractId);
  assert.equal(failedAttempt?.generated_from_review_id,undefined);
  const failedReviews=(await db.reviews.where("problem_id").equals(failedProblem.problem_id).toArray())
    .filter(row=>["pending","overdue"].includes(row.status));
  assert.ok(failedReviews.length>0);
  assert.ok(failedReviews.some(row=>(row.grading_contract?.gradedParts||[]).length>0),"major failureの未解決targetをReviewへ引き継ぐ");

  const successContract=buildInitialGradingContract({problem:successProblem,mode:"full",createdAt:"2026-08-27T00:00:00Z"});
  await localPost("/api/attempts",updateFor(successProblem,successContract,"initial-contract-success",false));
  const successAttempt=(await db.attempts.toArray()).find(row=>row.submission_id==="initial-contract-success");
  assert.equal(successAttempt?.grading_contract?.contractId,successContract.contractId);
  const successRepairs=(await db.reviews.where("problem_id").equals(successProblem.problem_id).toArray())
    .filter(row=>["pending","overdue"].includes(row.status)&&(row.grading_contract?.learningPurpose||row.learning_purpose)==="error_repair");
  assert.equal(successRepairs.length,0);
  await assert.rejects(()=>localPost("/api/attempts",{...updateFor(successProblem,successContract,"stale-initial-contract",false),
    submission_id:"stale-initial-contract"}),/初回採点契約は現在の初回答案にだけ/);
});
