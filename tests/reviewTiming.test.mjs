import test from "node:test";
import assert from "node:assert/strict";
import {
  findTimingExpressions,
  removeTimingExpressions,
  reviewDaysForErrors,
  sanitizeStudyUpdateTiming
} from "../src/reviewTiming.ts";

test("K/W/N/Cの複数分類は最短の復習間隔を採用する",()=>{
  assert.equal(reviewDaysForErrors(["K","N"]),1);
  assert.equal(reviewDaysForErrors(["W","N"]),2);
  assert.equal(reviewDaysForErrors(["W","C"]),3);
  assert.equal(reviewDaysForErrors(["C"]),7);
  assert.equal(reviewDaysForErrors([]),14);
});

test("次回課題から日付表現を除去する",()=>{
  assert.equal(
    removeTimingExpressions("7日後に WB-6-S-01 を骨格だけ再確認する"),
    "WB-6-S-01 を骨格だけ再確認する"
  );
  assert.deepEqual(findTimingExpressions("明日または来週に確認する"),["明日","来週"]);
});

test("取り込み時は分類から間隔を再計算し全対象欄を警告付きで清掃する",()=>{
  const update=sanitizeStudyUpdateTiming({
    problem_id:"WB-6-A-05",date:"2026-07-05",mode:"skeleton",mark:"△",score_label:"B",
    error_type:"K",primary_error_type:"K",error_types:["K","N"],error_point:"骨格不足",
    next_action:"7日後に関連Sを確認する",result_summary:"次回復習は来週に行う",
    review_after_days:7,
    weak_notes:[{theme:"推定",error_type:"N",mistake:"明日見直す",correction_rule:"数日後に再現する"}],
    s_check_suggestions:[{problem_id:"WB-6-S-01",reason:"2日後に土台を確認する"}]
  });
  assert.equal(update.review_after_days,1);
  assert.equal(update.next_action,"関連Sを確認する");
  assert.equal(update.result_summary,"行う");
  assert.equal(update.weak_notes?.[0].mistake,"見直す");
  assert.equal(update.s_check_suggestions?.[0].reason,"土台を確認する");
  assert.equal(update.date_expressions_removed,true);
  assert.equal(update.date_expression_warnings?.length,6);
});
