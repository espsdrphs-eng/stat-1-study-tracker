import test from "node:test";
import assert from "node:assert/strict";
import {
  gradedPartContracts,
  sameGradedPartIds,
  validateGradedFindings,
} from "../src/gradedParts.ts";
import {
  buildGradingContractSnapshot,
  contractDifferences,
  isActionableReview,
} from "../src/gradingContract.ts";

const baseAttempt={
  id:69,problem_id:"WB-4-A-21",date:"2026-07-20",mode:"full",time_minutes:30,
  mark:"△",score_label:"B",memo:"",error_type:"C",primary_error_type:"C",error_types:["K","C"],
  policy_validity:"invalid_legacy_k",k_evidence:[],error_point:"標準化対象と密度公式の向きが不一致",
  next_action:"標準化対象と密度公式の向きを直す",
  required_work_shown:["同時密度を分解した","独立性を示した","共分散を展開した"],
};

test("採点項目ごとのNだけを許可し、数式実行項目のNは拒否する",()=>{
  const parts=gradedPartContracts({
    texts:["積分を0で分ける理由","分布関数による一様分布への変換理由","密度公式の向き"],
    problemId:"WB-2-S-07",purpose:"error_repair",
  });
  assert.equal(validateGradedFindings(parts,[
    {graded_part_id:"split_integral_reason",error_type:"N",evidence:"理由なし",resolved:false},
    {graded_part_id:"probability_integral_transform_explanation",error_type:"N",evidence:"説明なし",resolved:false},
  ]).length,0);
  assert.match(validateGradedFindings(parts,[
    {graded_part_id:"density_transform_direction",error_type:"N",evidence:"説明なし",resolved:false},
  ])[0].reason,/許可分類/);
});

test("採点項目ID集合は日本語表記と順序に依存しない",()=>{
  const parts=gradedPartContracts({
    texts:["Hの配置","WとW1の区別","長さ保存","Qの展開"],
    problemId:"WB-6-A-20",purpose:"error_repair",
  });
  assert.equal(sameGradedPartIds(parts,["q_expansion","h_orientation","norm_preservation","w_w1_distinction"]),true);
  const {contract}=buildGradingContractSnapshot({
    review:{id:1,problem_id:"WB-6-A-20",status:"pending",learning_purpose:"error_repair",
      targeted_parts:["Hの配置","WとW1の区別","長さ保存","Qの展開"]},
    sourceAttempt:{...baseAttempt,id:1,problem_id:"WB-6-A-20",policy_validity:"valid",error_types:["W"],primary_error_type:"W",
      error_point:"",next_action:"",unresolved_carryover:[]},
  });
  assert.equal(contractDifferences(contract,{
    contractId:contract.contractId,contractVersion:contract.contractVersion,
    contractHash:contract.contractHash,problemId:contract.problemId,learningPurpose:contract.learningPurpose,
    mode:contract.mode,reviewScope:contract.reviewScope,targetKind:contract.targetKind,
    gradedParts:["q_expansion","h_orientation","norm_preservation","w_w1_distinction"],
  }).length,0);
});

test("Review 186相当のinvalid legacy Kは実行不可で成功証拠を採点対象にしない",()=>{
  const review={id:186,problem_id:"WB-4-A-21",status:"pending",policy_validity:"invalid_legacy_k",
    exclude_from_planning:false,superseded_by_policy_version:"STAT1-POLICY-v1",learning_purpose:"error_repair",
    targeted_parts:[...(baseAttempt.required_work_shown||[]),"標準化対象","密度公式の向き"]};
  const {contract}=buildGradingContractSnapshot({review,sourceAttempt:baseAttempt});
  assert.deepEqual(contract.gradedParts.map(part=>part.id).sort(),[
    "density_transform_direction","standardization_target",
  ]);
  assert.equal(contract.completionCriteria.some(row=>/[=√]/.test(row.displayText)),false);
  assert.equal(isActionableReview({...review,grading_contract:contract},contract),false);
});

test("retrieval_checkはcheck契約から昇格しない",()=>{
  const {contract}=buildGradingContractSnapshot({
    review:{id:87,problem_id:"WB-6-A-23",status:"pending",review_type:"light_check",
      duration_minutes:5,learning_purpose:"integration_check",effective_mode:"skeleton"},
    sourceAttempt:{...baseAttempt,id:35,problem_id:"WB-6-A-23",error_types:["none"],primary_error_type:"none",
      policy_validity:"valid",target_issue_resolved:true,minimum_pass_condition_met:true},
  });
  assert.equal(contract.learningPurpose,"retrieval_check");
  assert.equal(contract.mode,"check");
  assert.equal(contract.reviewScope,"check_only");
  assert.equal(contract.sheetType,"check_sheet");
  assert.equal(contract.estimatedMinutes,5);
});
