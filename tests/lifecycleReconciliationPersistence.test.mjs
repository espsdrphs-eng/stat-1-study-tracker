import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {buildGradingContractSnapshot,taskFieldsFromContract} from "../src/gradingContract.ts";

const {db,localGet,localPost}=await import("../src/localDb.ts");

async function seedPersistedGraduationMismatch(problemId,fixtureAttemptId){
  await localGet("/api/bootstrap");
  await db.attempts.where("problem_id").equals(problemId).delete();
  await db.reviews.where("problem_id").equals(problemId).delete();
  await db.problems.update(problemId,{completion_status:"review_pending"});
  const problem=await db.problems.get(problemId);
  assert.ok(problem);
  const sourceId=Number(await db.attempts.add({problem_id:problemId,date:"2026-08-01",mode:"check",time_minutes:5,
    mark:"\u25cb",score_label:"A",score_numeric:90,error_type:"none",primary_error_type:"none",error_types:["none"],
    target_issue_resolved:true,minimum_pass_condition_met:true,unresolved_carryover:[],
    error_point:"",next_action:"retention",memo:""}));
  const draft={problem_id:problemId,due_date:"2026-08-13",review_type:"light_check",status:"pending",
    generated_from_attempt_id:sourceId,source_attempt_id:sourceId,learning_purpose:"retrieval_check",
    learning_stage:"maintenance",assessment_timing:"delayed_retrieval",targeted_parts:["retention"],
    duration_minutes:5,exclude_from_planning:false};
  const source=await db.attempts.get(sourceId);
  const {contract}=buildGradingContractSnapshot({review:draft,problem,sourceAttempt:source});
  const reviewId=Number(await db.reviews.add({...draft,...taskFieldsFromContract(contract)}));
  const attemptId=Number(await db.attempts.add({id:fixtureAttemptId,problem_id:problemId,date:"2026-08-13",
    mode:"check",time_minutes:5,mark:"\u25cb",score_label:"A",score_numeric:95,error_type:"none",
    primary_error_type:"none",error_types:["none"],effective_error_types:["none"],error_point:"",next_action:"",memo:"",
    generated_from_review_id:reviewId,source_review_id:reviewId,is_review_attempt:true,
    learning_purpose:"retrieval_check",learning_stage:"maintenance",assessment_timing:"delayed_retrieval",
    retention_eligible:true,target_issue_resolved:true,minimum_pass_condition_met:true,
    actual_reference_level:0,allowed_reference_level:0,hint_used:false,reference_closed_reproduction:true,
    unresolved_carryover:[],graded_part_ids:contract.gradedParts.map(part=>part.id),
    graded_findings:contract.gradedParts.map(part=>({graded_part_id:part.id,error_type:"none",evidence:"ok",resolved:true})),
    grading_contract:contract,contract_id:contract.contractId,contract_version:contract.contractVersion,
    contract_hash:contract.contractHash,submission_id:`fixture-${fixtureAttemptId}`,saved_at:"2026-08-13T10:00:00+09:00"}));
  await db.reviews.update(reviewId,{status:"done",completion_result:"success",completed_at:"2026-08-13T10:00:00+09:00"});
  const completed=await db.reviews.get(reviewId);
  const successorId=Number(await db.reviews.add({...completed,id:undefined,status:"pending",due_date:"2026-08-20",
    completion_result:undefined,completed_at:undefined,generated_from_attempt_id:attemptId,source_attempt_id:attemptId,
    generated_at:"2026-08-13T10:01:00+09:00"}));
  return {attemptId,successorId};
}

test("reconciliation repairs Attempt 186/167 lifecycle, status, and unnecessary next Review atomically",async()=>{
  const fixtures=[await seedPersistedGraduationMismatch("WB-6-A-20",186),
    await seedPersistedGraduationMismatch("WB-6-A-29",167)];
  const preview=await localPost("/api/integrity/preview",{});
  assert.equal(preview.changes.lifecycleAttemptsCorrected,2);
  assert.equal(preview.changes.problemStatusesCorrected,2);
  assert.equal(preview.before.counts.graduated_mark_mismatch,2);
  assert.equal(preview.before.counts.lifecycle_status_mismatch,2);
  assert.equal(preview.before.counts.graduated_but_rescheduled>=2,true);

  await localPost("/api/integrity/repair",{});
  for(const fixture of fixtures){
    const attempt=await db.attempts.get(fixture.attemptId);
    assert.equal(attempt.mark,"\u25ce");
    assert.equal(attempt.review_outcome,"success");
    assert.equal((await db.reviews.get(fixture.successorId)).status,"superseded");
    assert.equal((await db.problems.get(attempt.problem_id)).completion_status,"completed");
  }
  const second=await localPost("/api/integrity/preview",{});
  assert.equal(second.changes.lifecycleAttemptsCorrected,0);
  assert.equal(second.changes.problemStatusesCorrected,0);
  assert.equal(second.before.counts.graduated_mark_mismatch,0);
  assert.equal(second.before.counts.graduated_but_rescheduled,0);
  assert.equal(second.before.counts.lifecycle_status_mismatch,0);
});
