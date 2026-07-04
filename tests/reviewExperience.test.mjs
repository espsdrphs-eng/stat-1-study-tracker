import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyReferenceState, referenceCompletion, referenceReviewInterval, revealReference,
  reviewAim, safeReviewActions, completionChecklist, reviewFormat
} from "../src/reviewExperience.ts";

test("参照段階を上げると見た内容を保持する",()=>{
  const none=emptyReferenceState();
  const hint=revealReference(none,2);
  const answer=revealReference(hint,4);
  assert.equal(none.no_hint,true);
  assert.equal(answer.reference_level,4);
  assert.equal(answer.one_line_hint,true);
  assert.equal(answer.official_answer,true);
  assert.equal(answer.no_hint,false);
});

test("前回ミス以降は完了にせず公式解答とGPT解説は3日後になる",()=>{
  const hint=revealReference(emptyReferenceState(),2);
  const mistake=revealReference(emptyReferenceState(),3);
  assert.equal(referenceCompletion("success",hint,true),"success");
  assert.equal(referenceCompletion("success",hint,false),"partial");
  assert.equal(referenceCompletion("success",mistake,true),"partial");
  assert.equal(referenceReviewInterval(4),3);
  assert.equal(referenceReviewInterval(5),3);
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
});
