import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptFingerprint, bindContractToReview, classifyExactDuplicateAttempts, contractIdForReview,
  logicalReviewKey, reviewExecutionState, runIntegrityAudit,
} from "../src/integrityEngine.ts";

const attempt=(id,patch={})=>({
  id,problem_id:"WB-4-A-24",date:"2026-07-26",mode:"check",time_minutes:5,mark:"◎",
  score_label:"A",error_type:"none",error_point:"",next_action:"",memo:"",
  error_types:["none"],primary_error_type:"none",...patch,
});
const contract=(problemId="WB-4-A-24",partId="critical_condition")=>({
  contractId:"review:pending:fixture",contractVersion:"STAT1-CONTRACT-v2",contractHash:`gc-${partId}`,
  createdAt:"2026-07-26T00:00:00Z",problemId,sourceAttemptId:1,
  learningPurpose:"retrieval_check",learningStage:"maintenance",mode:"check",reviewScope:"check_only",
  targetedParts:[],gradedParts:[{id:partId,label:"注意点",cueLabel:"注意点",allowedErrorTypes:["N","C","none"],completionCriterionId:"recall"}],
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:"recall",displayText:"短く想起"}],
  hiddenAnswerKey:[],completionConditions:["短く想起"],requiredEvidence:["注意点"],allowedErrorTypes:["N","C"],
  requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet",
});
const review=(id,sourceAttemptId=1,patch={})=>{
  const gradingContract=bindContractToReview(contract(),id,1);
  return {
    id,problem_id:"WB-4-A-24",due_date:"2026-07-28",review_type:"light_check",status:"pending",
    generated_from_attempt_id:sourceAttemptId,source_attempt_id:sourceAttemptId,interval_days:2,
    source_date:"2026-07-26",review_after_days:2,schedule_origin:"policy",policy_version:"STAT1-CONTRACT-v2",
    learning_purpose:"retrieval_check",assessment_timing:"delayed_retrieval",effective_mode:"check",
    review_scope:"check_only",sheet_type:"check_sheet",graded_part_ids:["critical_condition"],
    grading_contract:gradingContract,contract_id:gradingContract.contractId,
    contract_version:gradingContract.contractVersion,contract_hash:gradingContract.contractHash,...patch,
  };
};

test("exact duplicate Attempts are detected without deleting either row",()=>{
  const first=attempt(73),second=attempt(74);
  assert.equal(attemptFingerprint(first),attemptFingerprint(second));
  assert.deepEqual(classifyExactDuplicateAttempts([first,second]),[{
    fingerprint:attemptFingerprint(first),canonicalAttemptId:73,duplicateAttemptId:74,
  }]);
});

test("duplicate classification metadata does not change content fingerprint, but an intentional submission does",()=>{
  const first=attempt(73,{canonical_attempt_id:73});
  const second=attempt(74,{duplicate_of_attempt_id:73,exclude_from_metrics:true});
  assert.equal(attemptFingerprint(first),attemptFingerprint(second));
  assert.notEqual(attemptFingerprint({...first,submission_id:"one"}),attemptFingerprint({...first,submission_id:"two"}));
});

test("logical Review key is stable and includes canonical Attempt identity",()=>{
  const source=attempt(10,{canonical_attempt_id:10,submission_id:"submission-1"});
  const a=review(277,10),b=review(278,10,{contract_id:"other"});
  assert.equal(logicalReviewKey({review:a,sourceAttempt:source}),logicalReviewKey({review:b,sourceAttempt:source}));
  assert.notEqual(logicalReviewKey({review:a,sourceAttempt:source}),
    logicalReviewKey({review:a,sourceAttempt:{...source,submission_id:"submission-2"}}));
});

test("contractId is unique per persisted Review while contractHash may be equal",()=>{
  const content=contract();
  const left=bindContractToReview(content,277,1),right=bindContractToReview(content,278,1);
  assert.equal(left.contractHash,right.contractHash);
  assert.equal(left.contractId,contractIdForReview(277,1));
  assert.notEqual(left.contractId,right.contractId);
});

test("done, superseded, invalid and expired same-session Reviews are not actionable",()=>{
  assert.equal(reviewExecutionState(review(1,1,{status:"done"}),"2026-07-26"),"completed");
  assert.equal(reviewExecutionState(review(2,1,{status:"superseded"}),"2026-07-26"),"superseded");
  assert.equal(reviewExecutionState(review(3,1,{policy_validity:"invalid_legacy_k"}),"2026-07-26"),"invalid");
  assert.equal(reviewExecutionState(review(4,1,{assessment_timing:"same_session_correction",due_date:"2026-07-25"}),"2026-07-26"),"expired_same_session");
});

test("one audit detects duplicate logical key, contract id, dedup key, expiry and stale snapshot",()=>{
  const source=attempt(1);
  const shared="review:277:1";
  const rows=[
    review(277,1,{contract_id:shared,grading_contract:{...contract(),contractId:shared},deduplication_key:"same"}),
    review(278,1,{contract_id:shared,grading_contract:{...contract(),contractId:shared},deduplication_key:"same"}),
    review(238,1,{assessment_timing:"same_session_correction",due_date:"2026-07-25"}),
  ];
  const snapshot={date:"2026-07-26",task_ids:["review:999"],start_of_day_planned_minutes:5,
    initial_bucket:{"review:999":"must"},initial_estimated_minutes:{"review:999":5},
    tasks:[{id:999,problem_id:"WB-4-A-24",title:"fixture",kind:"review",reason:"fixture",mode:"check",minutes:5,load:.2,review_type:"light_check"}],
    created_at:"fixture"};
  const audit=runIntegrityAudit({attempts:[source],reviews:rows,today:"2026-07-26",todayPlanSnapshots:[snapshot]});
  assert.equal(audit.counts.duplicate_logical_review,1);
  assert.equal(audit.counts.duplicate_contract_id,1);
  assert.equal(audit.counts.repeated_deduplication_key,1);
  assert.equal(audit.counts.expired_same_session,1);
  assert.equal(audit.counts.stale_today_snapshot,1);
});

test("manual date is preserved but policy date mismatch is diagnosed",()=>{
  const source=attempt(1,{date:"2026-07-24"});
  const manual=review(1,1,{due_date:"2026-07-30",schedule_origin:"manual"});
  const policy=review(2,1,{due_date:"2026-07-27",schedule_origin:"policy"});
  const audit=runIntegrityAudit({attempts:[source],reviews:[manual,policy],today:"2026-07-26"});
  assert.equal(audit.counts.date_interval_mismatch,1);
});

test("changing a problem-specific label keeps the persisted part id",()=>{
  const original=contract("WB-4-A-24","part:WB-4-A-24:101:1");
  const renamed={...original,gradedParts:[{...original.gradedParts[0],label:"更新した表示名"}]};
  assert.equal(original.gradedParts[0].id,renamed.gradedParts[0].id);
});
