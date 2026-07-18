import test from "node:test";
import assert from "node:assert/strict";
import { resolveReviewScope, effectiveErrorsForAutomation } from "../src/reviewScopeResolver.ts";
import { finalizeStudyUpdateForSave } from "../src/studyCycle.ts";

const attempt={id:1,problem_id:"WB-6-A-20",date:"2026-07-18",mode:"skeleton",time_minutes:15,mark:"△",score_label:"B",
  error_type:"N",error_types:["N"],primary_error_type:"N",error_point:"和の順序交換の説明",next_action:"該当式変形だけ書く",memo:""};

test("targeted_patch＋skeletonでも指定部分以外を要求しない",()=>{
  const result=resolveReviewScope({item:{mode:"skeleton",review_scope:"targeted_patch",targeted_parts:["和の順序交換"]},targetAttempt:attempt});
  assert.equal(result.effectiveReviewScope,"targeted_patch");
  assert.equal(result.targetedParts[0],"和の順序交換");
  assert.ok(result.targetedParts.includes("該当式変形だけ書く"));
  assert.equal(result.completionConditions.some(row=>/方針・出発式・今見る量/.test(row)),false);
  assert.equal(result.allowedErrorTypes.includes("K"),false);
});

test("Kに答案引用がなければ1日間隔や自動モードへ反映しない",()=>{
  assert.deepEqual(effectiveErrorsForAutomation(["K"],"STAT1-REVIEW-v9",[]),[]);
  const saved=finalizeStudyUpdateForSave({problem_id:"WB-6-A-20",date:"2026-07-18",mode:"skeleton",mark:"△",score_label:"B",
    error_type:"K",primary_error_type:"K",error_types:["K"],error_point:"方針が違う",next_action:"入口を確認",rubric_version:"STAT1-REVIEW-v9",k_evidence:[]});
  assert.deepEqual(saved.error_types,["K"]);
  assert.deepEqual(saved.effective_error_types,["none"]);
  assert.equal(saved.review_after_days,14);
  assert.equal(saved.review_method,"check");
});

test("Kの答案引用があれば従来どおり1日後の骨格復習にする",()=>{
  const saved=finalizeStudyUpdateForSave({problem_id:"WB-6-A-20",date:"2026-07-18",mode:"skeleton",mark:"△",score_label:"B",
    error_type:"K",primary_error_type:"K",error_types:["K"],error_point:"方針が違う",next_action:"入口を確認",rubric_version:"STAT1-REVIEW-v9",
    k_evidence:["答案には『標本平均から始める』と記載されている"]});
  assert.deepEqual(saved.effective_error_types,["K"]);
  assert.equal(saved.review_after_days,1);
  assert.equal(saved.review_method,"skeleton");
});

test("none結果から弱点ノートを新規生成しない",()=>{
  const saved=finalizeStudyUpdateForSave({problem_id:"WB-6-A-20",date:"2026-07-18",mode:"check",mark:"◎",score_label:"A",
    error_type:"none",error_types:["none"],primary_error_type:"none",error_point:"",next_action:"軽く確認",
    weak_notes:[{theme:"誤生成",error_type:"none",mistake:"なし",correction_rule:"なし"}]});
  assert.deepEqual(saved.weak_notes,[]);
});
