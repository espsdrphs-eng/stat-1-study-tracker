import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const expectedPages={
  "00-all-answer-sheets.pdf":10,
  "00-check.pdf":1,
  "01-skeleton.pdf":1,
  "02-main-calculation.pdf":1,
  "03-full-answer.pdf":2,
  "04-five-question-scan.pdf":1,
  "05-exam-90min.pdf":4,
  "06-filled-examples.pdf":5
};

test("GoodNotes解答シートPDFが方式別のページ数で生成されている",()=>{
  for(const [name,pages] of Object.entries(expectedPages)){
    const bytes=readFileSync(new URL(`../public/answer-sheets/${name}`,import.meta.url));
    assert.equal(bytes.subarray(0,4).toString(),"%PDF");
    const source=bytes.toString("latin1");
    assert.equal([...source.matchAll(/\/Type\s*\/Page(?!s)/g)].length,pages,name);
  }
});

test("解答シートはiPad横画面の4対3で定義されている",()=>{
  const html=readFileSync(new URL("../tools/answer-sheets.html",import.meta.url),"utf8");
  assert.match(html,/@page\s*\{\s*size:\s*12in 9in/);
  assert.match(html,/短時間チェックシート/);
  assert.match(html,/骨格答案シート/);
  assert.match(html,/主要計算シート/);
  assert.match(html,/5問スキャン・選題シート/);
  assert.match(html,/90分演習・作戦シート/);
  assert.match(html,/class="sheet exam-plan"/);
  assert.match(html,/模範記入例 5：90分作戦/);
  assert.match(html,/examples.*===\s*"1"/);
  assert.match(html,/方針・入口/);
  assert.match(html,/ここから先は計算/);
  assert.match(html,/ゴールの形/);
  assert.match(html,/具体的な最終式はここでは書かない/);
  assert.doesNotMatch(html.match(/data-mode="skeleton"[\s\S]*?<\/section>/)?.[0]||"",/最終結論/);
});
