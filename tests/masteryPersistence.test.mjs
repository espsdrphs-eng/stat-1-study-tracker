import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {buildGradingContractSnapshot,taskFieldsFromContract} from "../src/gradingContract.ts";

const {db,localGet,localPost}=await import("../src/localDb.ts");

test("in-scope retrieval graduation and a major out-of-scope Level 2 future retention coexist",async()=>{
  const problemId="WB-2-S-07";
  await localGet("/api/bootstrap");
  await db.attempts.where("problem_id").equals(problemId).delete();
  await db.reviews.where("problem_id").equals(problemId).delete();
  const problem=await db.problems.get(problemId);
  const sourceId=Number(await db.attempts.add({problem_id:problemId,date:"2026-08-01",mode:"skeleton",time_minutes:10,
    mark:"○",score_label:"S",score_numeric:98,error_type:"none",error_types:["none"],error_point:"",next_action:"保持確認",memo:"",
    target_issue_resolved:true,minimum_pass_condition_met:true}));
  const source=await db.attempts.get(sourceId);
  const draft={problem_id:problemId,due_date:"2026-08-18",review_type:"light_check",status:"pending",
    generated_from_attempt_id:sourceId,source_attempt_id:sourceId,learning_purpose:"retrieval_check",learning_stage:"maintenance",
    assessment_timing:"delayed_retrieval",duration_minutes:5,allowed_reference_level:0,retention_eligible:true,
    success_transition:"stable",failure_transition:"error_repair",exclude_from_planning:false};
  const {contract}=buildGradingContractSnapshot({review:draft,problem,sourceAttempt:source});
  const reviewId=Number(await db.reviews.add({...draft,...taskFieldsFromContract(contract)}));
  const update={submission_id:"mastery-observation",problem_id:problemId,problem_id_confirmed:true,date:"2026-08-18",
    mode:contract.mode,actual_minutes:5,score_label:"S",score_numeric:100,mark:"○",error_type:"none",error_types:["none"],
    primary_error_type:"none",error_point:"",next_action:"",generated_from_review_id:reviewId,
    contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
    learning_purpose:contract.learningPurpose,learning_stage:contract.learningStage,assessment_timing:"delayed_retrieval",
    review_scope:contract.reviewScope,graded_part_ids:contract.gradedParts.map(row=>row.id),
    graded_findings:contract.gradedParts.map(row=>({graded_part_id:row.id,error_type:"none",evidence:"参照なしで再現",resolved:true})),
    target_issue_resolved:true,minimum_pass_condition_met:true,review_outcome:"success",actual_reference_level:0,
    allowed_reference_level:0,hint_used:false,reference_closed_reproduction:true,unresolved_carryover:[],
    observed_out_of_scope_findings:[{mastery_level:2,finding:"積分範囲を場合分けできない",evidence:"後半で全区間を0から1とした",
      materiality:"major",confidence:"high",create_target_candidate:true}]};
  await localPost("/api/attempts",update);
  const saved=(await db.attempts.where("problem_id").equals(problemId).toArray()).find(row=>row.submission_id==="mastery-observation");
  assert.equal(saved.mark,"◎");
  assert.equal(saved.score_numeric,100);
  assert.match(saved.observed_out_of_scope_findings[0].stable_target_key,/^target:WB-2-S-07:root:/);
  const active=(await db.reviews.where("problem_id").equals(problemId).toArray()).filter(row=>["pending","overdue"].includes(row.status));
  assert.equal(active.length,1);
  assert.equal(active[0].grading_contract.gradedParts.length,1);
  assert.equal(active[0].grading_contract.gradedParts[0].masteryLevel,2);
  assert.equal(active[0].learning_purpose,"retrieval_check");
  assert.equal(active[0].assessment_timing,"delayed_retrieval");
  assert.equal(active[0].correction_provided,true);
  assert.equal(active[0].earliest_date,"2026-08-21");
  assert.equal(active[0].latest_date,"2026-08-25");
  const bootstrap=await localGet("/api/bootstrap");
  assert.equal(bootstrap.masteryByProblem[problemId].levels[0].status,"retained");
  assert.equal(bootstrap.masteryByProblem[problemId].levels[1].status,"retention_pending");
  const preview=await localPost("/api/integrity/preview",{});
  assert.equal(preview.changes.reviewsReplaced,0);
});
