import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {buildGradingContractSnapshot,taskFieldsFromContract} from "../src/gradingContract.ts";
import {bindContractToReview,reviewExecutionState} from "../src/integrityEngine.ts";
import {buildAttemptReplacementGradingPrompt} from "../src/gradingPrompt.ts";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const problemId="WB-4-A-06";
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

async function seedReview(){
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],async()=>{
    await Promise.all([db.attempts.clear(),db.reviews.clear(),db.weakNotes.clear(),db.sMemory.clear()]);
    for(const row of await db.meta.where("key").startsWith("today-plan-snapshot:").toArray())await db.meta.delete(row.key);
  });
  const problem=await db.problems.get(problemId);
  const source={id:141,problem_id:problemId,date:today(),mode:"skeleton",time_minutes:10,mark:"○",score_label:"S",score_numeric:95,
    error_type:"N",error_types:["N"],error_point:"初手を保持する",next_action:"初手を再現",memo:"",
    submission_id:"replace-source",saved_at:`${today()}T08:00:00+09:00`};
  await db.attempts.add(source);
  const draft={id:410,problem_id:problemId,due_date:today(),review_type:"light_check",status:"pending",
    generated_from_attempt_id:141,source_attempt_id:141,source_date:today(),review_after_days:0,interval_days:0,
    schedule_origin:"manual",learning_purpose:"retrieval_check",learning_stage:"maintenance",assessment_timing:"delayed_retrieval",
    review_scope:"check_only",effective_mode:"check",sheet_type:"check_sheet",allowed_reference_level:0,
    retention_eligible:true,success_transition:"stable",failure_transition:"error_repair",estimated_minutes:5,duration_minutes:5,
    generated_at:new Date().toISOString()};
  const contract=bindContractToReview(buildGradingContractSnapshot({review:{...draft,id:undefined},problem,sourceAttempt:source,
    createdAt:new Date().toISOString()}).contract,410,1);
  await db.reviews.add({...draft,...taskFieldsFromContract(contract)});
  return {problem,source,review:await db.reviews.get(410),contract};
}

const updateFor=(contract,submission,overrides={})=>({submission_id:submission,problem_id:problemId,problem_id_confirmed:true,date:today(),
  mode:contract.mode,actual_minutes:5,score_label:"B",score_numeric:60,mark:"△",error_type:"N",error_types:["N"],
  primary_error_type:"N",error_point:"初手を再現できない",next_action:"初手を修復する",
  generated_from_review_id:contract.reviewId,source_review_id:contract.reviewId,contract_id:contract.contractId,
  contract_version:contract.contractVersion,contract_hash:contract.contractHash,learning_purpose:contract.learningPurpose,
  learning_stage:contract.learningStage,assessment_timing:"delayed_retrieval",review_scope:contract.reviewScope,
  target_kind:contract.targetKind,graded_part_ids:contract.gradedParts.map(row=>row.id),
  graded_findings:contract.gradedParts.map((row,index)=>({graded_part_id:row.id,error_type:index?"none":"N",
    evidence:index?"再現":"初手を誤った",resolved:index>0})),target_issue_resolved:false,minimum_pass_condition_met:false,
  review_outcome:"failed",actual_reference_level:0,allowed_reference_level:0,hint_used:false,unresolved_carryover:[],...overrides});

test("answer replacement preserves history and atomically makes only the new Attempt current",async()=>{
  const {problem,source,review,contract}=await seedReview();
  await localPost("/api/import",{updates:[updateFor(contract,"replacement-A")]});
  const attemptA=(await db.attempts.toArray()).find(row=>row.submission_id==="replacement-A");
  assert.ok(attemptA);assert.equal((await db.reviews.get(410)).status,"done");
  const descendant=(await db.reviews.toArray()).find(row=>row.generated_from_attempt_id===attemptA.id&&reviewExecutionState(row,today())==="actionable");
  assert.ok(descendant);

  const prompt=buildAttemptReplacementGradingPrompt({attempt:attemptA,problemContext:{problemId,canonicalProblemId:problemId,
    displayLabel:problem.display_label,title:problem.title,theme:problem.theme,canonicalProblemType:problem.canonical_problem_type||"",
    canonicalKeywords:problem.canonical_keywords||[],problemMaster:problem,contextCompleteness:"metadata_only",currentSourceAttempt:source,
    previousAttempts:[],previousReviews:[],verifiedRelations:[]},sourceReview:review,sourceAttempt:source,date:today()});
  assert.match(prompt,new RegExp(`replacement_for_attempt_id: ${attemptA.id}`));

  const replacement={...updateFor(contract,"replacement-B",{replacement_for_attempt_id:attemptA.id,
    replacement_reason:"誤った画像を正しい答案へ差し替え",score_label:"S",score_numeric:100,error_type:"none",error_types:["none"],
    primary_error_type:"none",error_point:"大きな問題なし",next_action:"保持完了",review_outcome:"success",
    target_issue_resolved:true,minimum_pass_condition_met:true,
    graded_findings:contract.gradedParts.map(row=>({graded_part_id:row.id,error_type:"none",evidence:"再現",resolved:true}))})};
  await localPost("/api/import",{updates:[replacement]});
  const attempts=await db.attempts.toArray(),savedA=attempts.find(row=>row.id===attemptA.id),attemptB=attempts.find(row=>row.submission_id==="replacement-B");
  assert.ok(savedA);assert.ok(attemptB);assert.equal(savedA.superseded_by_attempt_id,attemptB.id);
  assert.equal(savedA.exclude_from_planning,true);assert.equal(savedA.exclude_from_metrics,true);
  assert.equal(attemptB.replaces_attempt_id,attemptA.id);assert.equal(attemptB.score_numeric,100);
  assert.equal((await db.reviews.get(descendant.id)).status,"superseded");
  const currentAttempts=(await db.attempts.where("problem_id").equals(problemId).toArray()).filter(row=>
    !row.exclude_from_planning&&!row.exclude_from_metrics&&row.id!==source.id);
  assert.deepEqual(currentAttempts.map(row=>row.id),[attemptB.id]);

  await localPost("/api/import",{updates:[replacement]});
  assert.equal((await db.attempts.toArray()).filter(row=>row.submission_id==="replacement-B").length,1);
  assert.equal((await db.reviews.toArray()).filter(row=>reviewExecutionState(row,today())==="actionable").length,
    new Set((await db.reviews.toArray()).filter(row=>reviewExecutionState(row,today())==="actionable").map(row=>row.logical_review_key)).size);
  const contractB=attemptB.grading_contract;
  const replacementC={...updateFor(contractB,"replacement-C",{replacement_for_attempt_id:attemptB.id,
    replacement_reason:"二回目の答案差し替え",score_label:"S",score_numeric:98,error_type:"none",error_types:["none"],
    primary_error_type:"none",error_point:"大きな問題なし",next_action:"別問題へ進む",review_outcome:"success",
    target_issue_resolved:true,minimum_pass_condition_met:true,
    graded_findings:contractB.gradedParts.map(row=>({graded_part_id:row.id,error_type:"none",evidence:"再現",resolved:true}))})};
  await localPost("/api/import",{updates:[replacementC]});
  const attemptC=(await db.attempts.toArray()).find(row=>row.submission_id==="replacement-C");
  assert.ok(attemptC);assert.equal((await db.attempts.get(attemptB.id)).superseded_by_attempt_id,attemptC.id);
  assert.equal((await db.attempts.where("problem_id").equals(problemId).toArray()).filter(row=>
    !row.exclude_from_planning&&!row.exclude_from_metrics&&row.id!==source.id).length,1);
  const reload=await localGet("/api/bootstrap");
  assert.equal(reload.attempts.find(row=>row.id===attemptC.id)?.replaces_attempt_id,attemptB.id);
  const first=await localPost("/api/integrity/preview",{}),second=await localPost("/api/integrity/preview",{});
  assert.equal(first.changes.reviewsReplaced,0);assert.equal(second.changes.reviewsReplaced,0);
});

test("whole-answer rediagnosis does not stale the grading contract and delete is a soft invalidation",async()=>{
  const {contract}=await seedReview();
  await localPost("/api/import",{updates:[updateFor(contract,"rediagnose-before-delete")]});
  const attempt=(await db.attempts.toArray()).find(row=>row.submission_id==="rediagnose-before-delete");
  const before={score:attempt.score_numeric,mark:attempt.mark,hash:attempt.contract_hash,review:attempt.source_review_id};
  const diagnostic=`whole_answer_diagnostic_update:\n  attempt_id: ${attempt.id}\n  problem_id: ${problemId}\n  whole_answer_scan:\n    performed: false\n    app_reference_coverage: insufficient\n    effective_reference_coverage: insufficient\n    written_answer_coverage: partial\n    confidence: low\n    attachments: []\n    regions: []\n  observed_out_of_scope_findings: []\n  diagnostic_uncertainties: []`;
  await localPost(`/api/attempts/${attempt.id}/whole-diagnostic/save`,{text:diagnostic});
  const diagnosed=await db.attempts.get(attempt.id);
  assert.deepEqual({score:diagnosed.score_numeric,mark:diagnosed.mark,hash:diagnosed.contract_hash,review:diagnosed.source_review_id},before);
  await localPost(`/api/attempts/${attempt.id}/delete`,{});
  const invalidated=await db.attempts.get(attempt.id);
  assert.ok(invalidated);assert.ok(invalidated.invalidated_at);assert.equal(invalidated.exclude_from_metrics,true);
});
