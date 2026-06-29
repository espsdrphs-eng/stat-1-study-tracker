import test from "node:test";
import assert from "node:assert/strict";
import { applyWeakNoteQuizResult } from "../src/weakNoteQuiz.ts";

const note={
  id:1,date:"2026-06-29",problem_id:"WB-2-A-20",error_type:"N",theme:"期待値",
  mistake:"平均の存在確認を省略した",correction_rule:"絶対値の期待値が有限か確認する",
  is_resolved:0,quiz_correct_count:0,quiz_wrong_count:0
};

test("弱点クイズは2回できたら定着扱いになる",()=>{
  const first=applyWeakNoteQuizResult(note,"remembered","2026-06-29T10:00:00Z");
  assert.equal(first.quiz_correct_count,1);
  assert.equal(first.is_resolved,0);
  const second=applyWeakNoteQuizResult({...note,...first},"remembered","2026-06-30T10:00:00Z");
  assert.equal(second.quiz_correct_count,2);
  assert.equal(second.is_resolved,1);
});

test("まだ不安なら連続正解を戻して再出題対象にする",()=>{
  const result=applyWeakNoteQuizResult({...note,quiz_correct_count:1},"retry");
  assert.equal(result.quiz_correct_count,0);
  assert.equal(result.quiz_wrong_count,1);
  assert.equal(result.is_resolved,0);
});
