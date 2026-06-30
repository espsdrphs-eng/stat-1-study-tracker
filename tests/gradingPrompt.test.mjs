import test from "node:test";
import assert from "node:assert/strict";
import { buildGradingPrompt, GRADING_RUBRIC_VERSION } from "../src/gradingPrompt.ts";

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
