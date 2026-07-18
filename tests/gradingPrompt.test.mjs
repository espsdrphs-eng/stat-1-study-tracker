import test from "node:test";
import assert from "node:assert/strict";
import { buildFirstAttemptGradingPrompt, buildGradingPrompt, buildRepairPrompt, buildReviewGradingPrompt, GRADING_RUBRIC_VERSION, REVIEW_RUBRIC_VERSION } from "../src/gradingPrompt.ts";

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
  assert.match(prompt,/今回の答案に沿った修正版答案/);
  assert.match(prompt,/省略してはいけない途中計算/);
  assert.match(prompt,/main_calcまたはfullで必要な計算は、「整理すると」で飛ばさず/);
  assert.match(prompt,/improvement_guidance:/);
  assert.match(prompt,/required_derivation:/);
  assert.match(prompt,/corrected_answer:/);
  assert.match(prompt,/どの解答モードでも同じフル答案ルーブリック/);
  assert.match(prompt,/main_calc：指定された主要計算/);
  assert.match(prompt,/evaluation_scope:/);
  assert.match(prompt,/assumed_correct_parts:/);
  assert.match(prompt,/next_actionには日付や復習間隔を書かない/);
  assert.match(prompt,/skeletonでは、最終式や完成答案を求めない/);
  assert.match(prompt,/check：思い出せるかだけを確認する/);
});

test("初回採点プロンプトはproblem_id固定とfirst_attemptを要求する",()=>{
  const prompt=buildFirstAttemptGradingPrompt({
    problemId:"WB-4-A-05",displayLabel:"第4章A問5",theme:"モーメント母関数",canonicalProblemType:"正規分布の平方完成",mode:"full",estimatedMinutes:35
  });
  assert.match(prompt,/初回答案/);
  assert.match(prompt,/GPT側で別の problem_id を推測して変更しない/);
  assert.match(prompt,/problem_id: "WB-4-A-05"/);
  assert.match(prompt,/task_origin: "first_attempt"/);
  assert.match(prompt,/next_action には日付/);
  assert.match(prompt,/time_minutes:/);
});

test("理解補修プロンプトは答えを先に出さない",()=>{
  const prompt=buildRepairPrompt({problemId:"WB-6-S-01",theme:"指数型分布族",canonicalProblemType:"指数型分布族の読み取り"});
  assert.match(prompt,/答えや模範解答を出さない/);
  assert.match(prompt,/1問ずつ/);
  assert.match(prompt,/修正ルール/);
});

test("復習採点プロンプトは前回課題と今回の改善を比較する",()=>{
  const prompt=buildReviewGradingPrompt({
    reviewId:12,problemId:"WB-2-S-06",title:"第2章S問6",theme:"期待値表示",date:"2026-07-02",mode:"skeleton",
    previousDate:"2026-06-29",previousScore:"B 72点",previousErrors:["W","N"],
    previousErrorPoint:"和の順序交換が不安定",previousNextAction:"3行を見ずに書く",
    reviewMethod:"ノート補修＋骨格再現",reviewInstruction:"添字範囲を確認する",
    reviewSteps:["出発式を書く","和を入れ替える"],requiresFullAnswer:false,
    timeMinutes:18,hintLevel:"minimal_hint",afterHintReproduced:true,
    reviewScope:"targeted_patch",targetedParts:["和の順序交換"],
    completionConditions:["和の順序交換を白紙で再現した"],allowedErrorTypes:["W","N","C"]
  });
  assert.match(prompt,new RegExp(REVIEW_RUBRIC_VERSION));
  assert.match(prompt,/和の順序交換が不安定/);
  assert.match(prompt,/指定範囲外の空欄や未記入を誤りの根拠にしない/);
  assert.match(prompt,/generated_from_review_id: 12/);
  assert.match(prompt,/review_outcome/);
  assert.match(prompt,/time_minutes/);
  assert.match(prompt,/main_calc\/fullまたは前回N\/Wの修正確認に必要な途中計算/);
  assert.match(prompt,/今回改善したので残す部分/);
  assert.match(prompt,/和の順序交換を白紙で再現した/);
  assert.doesNotMatch(prompt,/骨格全体（方針/);
  assert.match(prompt,/minimum_pass_condition_met/);
  assert.match(prompt,/resolution_evidence/);
  assert.match(prompt,/required_work_shown/);
  assert.match(prompt,/unresolved_carryover/);
  assert.match(prompt,/今回かかった時間（分）：18/);
  assert.match(prompt,/参照した内容：1行ヒント/);
  assert.match(prompt,/参照表示を隠してから白紙で再現したか：はい/);
  assert.match(prompt,/hint_level: "minimal_hint"/);
  assert.match(prompt,/after_hint_reproduced: true/);
  assert.match(prompt,/actual_reference_level: 1/);
  assert.match(prompt,/one_line_hint: true/);
  assert.match(prompt,/Kを返す場合は答案中の根拠をk_evidenceへ引用/);
  const mainCalc=buildReviewGradingPrompt({
    problemId:"WB-6-A-05",date:"2026-07-03",mode:"main_calc",previousErrors:["N"],
    previousErrorPoint:"尤度微分を省略",requiresFullAnswer:false
  });
  assert.match(mainCalc,/問題全体や骨格全項目を要求しない/);
  assert.match(prompt,/next_actionに日付を書かない/);
});
