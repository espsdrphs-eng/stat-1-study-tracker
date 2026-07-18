import test from "node:test";
import assert from "node:assert/strict";
import { metadataQuality, safeGenericGuidance } from "../src/metadataQuality.ts";

const generic={problem_id:"WB-6-A-05",theme:"推定",canonical_problem_type:"推定",canonical_keywords:[],metadata_status:"ok"};

test("粗いproblem_masterから問題固有らしい具体語を捏造しない",()=>{
  assert.equal(metadataQuality(generic),"generic");
  const guide=safeGenericGuidance(generic);
  assert.equal(guide.correctionTheme,"前回指定された箇所を確認する");
  assert.equal(guide.oneLineHint,"問題固有の内容は要確認");
  assert.doesNotMatch(JSON.stringify(guide),/AIC|尤度|残差平方和/);
});

test("genericでも対象問題自身の前回記録だけは使用できる",()=>{
  const guide=safeGenericGuidance(generic,{error_point:"添字範囲の説明不足"});
  assert.equal(guide.correctionTheme,"添字範囲の説明不足");
  assert.match(guide.oneLineHint,/添字範囲/);
});
