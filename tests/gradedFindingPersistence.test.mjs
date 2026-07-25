import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { buildGradingContractSnapshot, taskFieldsFromContract } from "../src/gradingContract.ts";

const {db,localGet,localPost}=await import("../src/localDb.ts");

async function makeReview(targets){
  await localGet("/api/bootstrap");
  const sourceId=Number(await db.attempts.add({
    problem_id:"WB-2-S-07",date:"2026-07-20",mode:"check",time_minutes:5,mark:"△",score_label:"B",
    error_type:"N",primary_error_type:"N",error_types:["N"],error_point:targets.join(" / "),
    next_action:"指定箇所を説明する",memo:"",policy_validity:"valid",
  }));
  const draft={problem_id:"WB-2-S-07",due_date:"2026-07-26",review_type:"retry",status:"pending",
    generated_from_attempt_id:sourceId,source_attempt_id:sourceId,learning_purpose:"error_repair",
    targeted_parts:targets,duration_minutes:5,exclude_from_planning:false};
  const source=await db.attempts.get(sourceId),problem=await db.problems.get("WB-2-S-07");
  const {contract}=buildGradingContractSnapshot({review:draft,problem,sourceAttempt:source});
  const reviewId=Number(await db.reviews.add({...draft,...taskFieldsFromContract(contract)}));
  return {reviewId,contract};
}

test("WB-2-S-07の説明項目に対する正当なNは保存できる",async()=>{
  const {reviewId,contract}=await makeReview(["積分を0で分ける理由","分布関数による一様分布への変換理由"]);
  const before=await db.attempts.count();
  await localPost("/api/attempts",{
    problem_id:"WB-2-S-07",problem_id_confirmed:true,problem_id_source:"yaml",date:"2026-07-26",mode:contract.mode,actual_minutes:5,mark:"△",
    score_numeric:70,score_text:"B",error_types:["N"],primary_error_type:"N",
    error_point:"理由の説明がない",next_action:"理由を1行で説明する",review_after_days:2,
    generated_from_review_id:reviewId,rubric_version:"STAT1-REVIEW-v9",
    contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
    learning_purpose:contract.learningPurpose,review_scope:contract.reviewScope,target_kind:contract.targetKind,
    graded_part_ids:contract.gradedParts.map(part=>part.id),
    graded_findings:[
      {graded_part_id:"split_integral_reason",error_type:"N",evidence:"理由の説明がない",resolved:false},
      {graded_part_id:"probability_integral_transform_explanation",error_type:"N",evidence:"変換理由がない",resolved:false},
    ],
  });
  assert.equal(await db.attempts.count(),before+1);
});

test("数式実行項目に契約外Nを返した結果は保存しない",async()=>{
  const {reviewId,contract}=await makeReview(["密度公式の向き"]);
  const before=await db.attempts.count();
  await assert.rejects(()=>localPost("/api/attempts",{
    problem_id:"WB-2-S-07",problem_id_confirmed:true,problem_id_source:"yaml",date:"2026-07-26",mode:contract.mode,actual_minutes:5,mark:"△",
    score_numeric:70,score_text:"B",error_types:["N"],primary_error_type:"N",
    error_point:"説明がない",next_action:"再現する",review_after_days:2,
    generated_from_review_id:reviewId,rubric_version:"STAT1-REVIEW-v9",
    contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
    learning_purpose:contract.learningPurpose,review_scope:contract.reviewScope,target_kind:contract.targetKind,
    graded_part_ids:contract.gradedParts.map(part=>part.id),
    graded_findings:[{graded_part_id:"density_transform_direction",error_type:"N",evidence:"説明がない",resolved:false}],
  }),/許可分類/);
  assert.equal(await db.attempts.count(),before);
});
