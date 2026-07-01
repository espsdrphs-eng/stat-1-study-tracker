import test from "node:test";
import assert from "node:assert/strict";
import { buildGradingPrompt, buildReviewGradingPrompt, GRADING_RUBRIC_VERSION, REVIEW_RUBRIC_VERSION } from "../src/gradingPrompt.ts";

test("採点プロンプトは版番号・根拠・確信度・YAMLを要求する",()=>{
  const prompt=buildGradingPrompt("2026-06-30");
  assert.match(prompt,new RegExp(GRADING_RUBRIC_VERSION));
  assert.match(prompt,/grading_confidence/);
  assert.match(prompt,/uncertain_points/);
  assert.match(prompt,/study_update:/);
  assert.match(prompt,/各減点.*根拠/);
  assert.match(prompt,/score_label:/);
  assert.doesNotMatch(prompt,/score_text:/);
  assert.match(prompt,/exam_selection_rank.*出力しない/);
});

test("復習採点プロンプトは前回課題と今回の改善を比較する",()=>{
  const prompt=buildReviewGradingPrompt({
    reviewId:12,problemId:"WB-2-S-06",title:"第2章S問6",theme:"期待値表示",date:"2026-07-02",mode:"skeleton",
    previousDate:"2026-06-29",previousScore:"B 72点",previousErrors:["W","N"],
    previousErrorPoint:"和の順序交換が不安定",previousNextAction:"3行を見ずに書く",
    reviewMethod:"ノート補修＋骨格再現",reviewInstruction:"添字範囲を確認する",
    reviewSteps:["出発式を書く","和を入れ替える"],requiresFullAnswer:false
  });
  assert.match(prompt,new RegExp(REVIEW_RUBRIC_VERSION));
  assert.match(prompt,/和の順序交換が不安定/);
  assert.match(prompt,/指定部分以外の省略は減点しない/);
  assert.match(prompt,/generated_from_review_id: 12/);
  assert.match(prompt,/review_outcome/);
  assert.match(prompt,/time_minutes/);
});
