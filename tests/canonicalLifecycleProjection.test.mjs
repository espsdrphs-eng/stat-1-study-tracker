import test from "node:test";
import assert from "node:assert/strict";
import {buildGradingContractSnapshot} from "../src/gradingContract.ts";
import {projectStudyUpdateLifecycle} from "../src/studyUpdateLifecycle.ts";

const problem={id:619,problem_id:"WB-6-A-19",source_type:"whitebook",category:"A",chapter:6,problem_number:19,
  title:"fixture",display_label:"fixture",theme:"fixture",canonical_problem_type:"fixture",canonical_keywords:[],
  priority:"repair",role:"training",recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",
  linked_a_problems:"",notes:"",completion_status:"review_pending",master_version:"fixture",metadata_status:"ok"};
const sourceAttempt={id:300,problem_id:problem.problem_id,date:"2026-08-01",mode:"skeleton",time_minutes:10,
  mark:"△",score_label:"B",score_numeric:70,error_type:"N",primary_error_type:"N",error_types:["N"],
  error_point:"修正対象",next_action:"修正する",memo:""};

function review(id,learningPurpose){
  const draft={id,problem_id:problem.problem_id,due_date:"2026-08-11",review_type:learningPurpose==="retrieval_check"?"light_check":"targeted_patch",
    status:"pending",generated_from_attempt_id:sourceAttempt.id,source_attempt_id:sourceAttempt.id,learning_purpose:learningPurpose,
    learning_stage:learningPurpose==="retrieval_check"?"maintenance":"repair",assessment_timing:"delayed_retrieval",
    targeted_parts:["修正対象"],duration_minutes:5,exclude_from_planning:false};
  const {contract}=buildGradingContractSnapshot({review:draft,problem,sourceAttempt,createdAt:"2026-08-11T00:00:00Z"});
  return {...draft,grading_contract:contract,contract_id:contract.contractId,contract_hash:contract.contractHash};
}

function successUpdate(row,gptMark="△"){
  const contract=row.grading_contract;
  return {submission_id:`lifecycle-${row.id}`,problem_id:row.problem_id,date:"2026-08-11",mode:contract.mode,
    mark:gptMark,score_label:"A",score_numeric:95,error_type:"none",primary_error_type:"none",error_types:["none"],
    effective_error_types:["none"],review_outcome:"success",target_issue_resolved:true,minimum_pass_condition_met:true,
    resolution_evidence:"採点対象を参照なしで正しく再現した",required_work_shown:["採点対象を再現"],
    answer_change_summary:"対象を修正して再現した",unresolved_carryover:[],evaluation_scope:"conditional_full",
    generated_from_review_id:row.id,rubric_version:"STAT1-REVIEW-v9",learning_purpose:contract.learningPurpose,
    assessment_timing:"delayed_retrieval",contract_id:contract.contractId,contract_version:contract.contractVersion,
    contract_hash:contract.contractHash,review_scope:contract.reviewScope,target_kind:contract.targetKind,
    graded_parts:contract.gradedParts.map(part=>part.label),graded_part_ids:contract.gradedParts.map(part=>part.id),
    graded_findings:contract.gradedParts.map(part=>({graded_part_id:part.id,error_type:"none",evidence:"参照なしで再現",resolved:true})),
    actual_reference_level:0,allowed_reference_level:0,hint_used:false,reference_closed_reproduction:true,
    next_action:"保持確認へ進む",review_after_days:14};
}

test("Review 365相当のrepair成功はpreviewでも○となりretrievalへ進む",()=>{
  const row=review(365,"error_repair");
  const result=projectStudyUpdateLifecycle({update:successUpdate(row),sourceReview:row,sourceAttempt,problem});
  assert.equal(result.update.mark,"○");
  assert.equal(result.lifecycle.lifecyclePhase,"error_repair");
  assert.equal(result.lifecycle.graduationEligible,false);
  assert.equal(result.lifecycle.graduated,false);
  assert.equal(result.lifecycle.nextTransition,"retrieval_check");
});

test("delayed_retrievalという時刻情報だけではrepairを◎にしない",()=>{
  const row=review(365,"error_repair");
  const result=projectStudyUpdateLifecycle({update:successUpdate(row,"◎"),sourceReview:row,sourceAttempt,problem});
  assert.equal(result.update.mark,"○");
  assert.equal(result.lifecycle.graduated,false);
});

test("Review 378相当のretrieval成功だけが◎で卒業する",()=>{
  const row=review(378,"retrieval_check");
  const result=projectStudyUpdateLifecycle({update:successUpdate(row,"○"),sourceReview:row,sourceAttempt,problem});
  assert.equal(result.update.mark,"◎");
  assert.equal(result.lifecycle.graduationEligible,true);
  assert.equal(result.lifecycle.graduated,true);
  assert.equal(result.lifecycle.nextTransition,"graduated");
});
