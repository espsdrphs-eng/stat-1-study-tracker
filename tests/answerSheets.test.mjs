import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const expectedPages={
  "00-all-answer-sheets.pdf":9,
  "01-skeleton.pdf":1,
  "02-main-calculation.pdf":1,
  "03-full-answer.pdf":2,
  "04-five-question-scan.pdf":1,
  "05-exam-90min.pdf":4
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
  assert.match(html,/骨格答案シート/);
  assert.match(html,/主要計算シート/);
  assert.match(html,/5問スキャン・選題シート/);
  assert.match(html,/90分演習・作戦シート/);
});
