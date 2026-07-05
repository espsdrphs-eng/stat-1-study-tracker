import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedReferenceLevel, emptyReferenceState, referenceDecision, referenceReviewInterval, revealReference,
  reviewAim, safeReviewActions, completionChecklist, reviewFormat
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
