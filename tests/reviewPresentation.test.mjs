import test from "node:test";
import assert from "node:assert/strict";
import { reviewMode, reviewTemplate } from "../src/reviewPresentation.ts";

test("ノート補修には骨格シートと専用の記入欄を出す",()=>{
  const template=reviewTemplate({review_method:"ノート補修＋骨格再現",review_type:"skeleton_retry"});
  assert.equal(template.sheetMode,"skeleton");
  assert.equal(template.sheetLabel,"骨格シート");
  assert.deepEqual(template.fields.map(field=>field.label),["修正ルール1行","不足していた説明","骨格"]);
});

test("局所的な省略とWには主要計算シートを出す",()=>{
  const omission=reviewTemplate({review_method:"省略部分の局所再現"});
  const work=reviewTemplate({review_method:"該当作業だけ再演習"});
  assert.equal(omission.sheetMode,"main_calc");
  assert.equal(work.sheetMode,"main_calc");
  assert.match(omission.fields[1].hint,/理由付き/);
});

test("復習種別から表示シートのモードを補完する",()=>{
  assert.equal(reviewMode({review_type:"main_calc_retry"}),"main_calc");
  assert.equal(reviewMode({review_type:"careless_check"}),"scan");
  assert.equal(reviewMode({requires_full_answer:true}),"exam_90min");
});
