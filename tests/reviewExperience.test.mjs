import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedReferenceLevel, emptyReferenceState, referenceDecision, referenceReviewInterval, revealReference,
  reviewAim, safeReviewActions, completionChecklist, reviewFormat, correctionTheme, oneLineHint, referenceEntryPoint
} from "../src/reviewExperience.ts";

test("参照段階を上げると見た内容を保持する",()=>{
  const none=emptyReferenceState();
  const hint=revealReference(none,1);
  const answer=revealReference(hint,4);
  assert.equal(none.no_hint,true);
  assert.equal(answer.reference_level,4);
  assert.equal(answer.one_line_hint,true);
  assert.equal(answer.official_answer,true);
  assert.equal(answer.no_hint,false);
});

test("許可範囲内の前回ミス参照は完了でき、超過参照だけ補正する",()=>{
  assert.equal(allowedReferenceLevel({previous_errors:["N"],mode:"skeleton"}),2);
  assert.equal(allowedReferenceLevel({previous_errors:["W"],mode:"main_calc"}),2);
  assert.equal(referenceDecision("success",2,2,true).result,"success");
  assert.equal(referenceDecision("success",2,2,true).shortenReview,false);
  assert.equal(referenceDecision("success",0,2,true).result,"success");
  assert.equal(referenceDecision("success",0,2,true).shortenReview,true);
  assert.equal(referenceDecision("success",2,4,true).result,"partial");
  assert.equal(referenceDecision("success",2,2,false).result,"partial");
  assert.equal(referenceReviewInterval(4,2),3);
  assert.equal(referenceReviewInterval(2,2),undefined);
});

test("初期表示用の狙いと行動は具体的な前回答えを含まない",()=>{
  const item={
    previous_errors:["N"],
    previous_error_point:"Yの定義域は0<Y<1と書く",
    previous_next_action:"密度は具体式f(y)を書く",
    review_method:"ノート補修＋骨格再現"
  };
  const initial=[reviewAim(item),...safeReviewActions(item),...completionChecklist(item),reviewFormat(item)].join("\n");
  assert.doesNotMatch(initial,/0<Y<1|f\(y\)/);
  assert.match(initial,/骨格|修正ルール/);
  assert.match(initial,/表示を隠してから/);
  assert.doesNotMatch(initial,/参照を閉じたあと/);
  assert.doesNotMatch(initial,/GPT採点|結果を保存|プロンプトをコピー/);
});

test("修正テーマと1行ヒントは問題マスター情報から具体化される",()=>{
  const item={
    mode:"skeleton",
    previous_errors:["K"],
    theme:"U(0,θ)、十分統計量、不偏推定量、MSE、MLE",
    canonical_problem_type:"一様分布の推定・十分統計量・MSE比較",
    canonical_keywords:["U(0,θ)","最大統計量","十分統計量","MSE","最尤推定量"],
    answer_excerpt:"X1,...,Xn が U(0,θ) に従う設定。θに対する十分統計量、最大統計量に基づく不偏推定量、MSE比較、MLEを扱う問題。"
  };
  assert.match(correctionTheme(item),/一様分布|最大統計量/);
  assert.match(correctionTheme(item),/骨格|十分性|MSE|MLE/);
  assert.notEqual(correctionTheme(item),"答案の設計図を自力で再構築する");
  assert.match(referenceEntryPoint(item),/まず最大統計量の分布関数/);
  assert.match(oneLineHint(item),/まず最大統計量の分布関数/);
  assert.doesNotMatch(oneLineHint(item),/^結論ではなく、直前の式から次の式へ進む根拠/);
});

test("main_calcとcheckは復習方法に応じた粒度で具体語を出す",()=>{
  const calcItem={
    mode:"main_calc",
    previous_errors:["W"],
    theme:"期待値表示・尾確率",
    canonical_keywords:["添字","二重和","尾確率","1-F(n)"],
    previous_error_point:"和の順序交換で添字範囲が不安定"
  };
  assert.match(correctionTheme(calcItem),/和または積分の範囲|添字/);
  assert.match(correctionTheme(calcItem),/不等号|端点/);
  assert.match(completionChecklist(calcItem).join("\n"),/和または積分の範囲|添字|作業/);

  const checkItem={mode:"check",previous_errors:["C"],theme:"AIC・自由度",canonical_keywords:["AIC","最大対数尤度","自由パラメータ数"]};
  assert.match(correctionTheme(checkItem),/AIC比較|最大対数尤度|自由パラメータ数/);
  assert.match(oneLineHint(checkItem),/まずAICに入れる最大対数尤度と自由パラメータ数/);
});
