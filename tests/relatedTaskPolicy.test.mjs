import test from "node:test";
import assert from "node:assert/strict";
import { eligibleAutomaticRemediation, selectAutomaticRemediation } from "../src/relatedTaskPolicy.ts";

const relation=(id,overrides={})=>({relationId:id,sourceProblemId:"WB-4-A-06",targetProblemId:`WB-4-S-0${id}`,relationType:"remediation",
  sourceIssue:"変換後の定義域",targetFocus:"定義域とヤコビアン",reason:"元問題の失点箇所を直接補修できる",relationSource:"user_confirmed",status:"confirmed",createdAt:"",updatedAt:"",...overrides});

test("汎用関連指定やGPT候補は自動タスク化しない",()=>{
  assert.equal(eligibleAutomaticRemediation(relation(1,{status:"candidate"})),false);
  assert.equal(eligibleAutomaticRemediation(relation(1,{sourceIssue:"元問題で崩れた基礎型を確認する",targetFocus:"要確認"})),false);
});

test("confirmedな具体的補修が複数あっても1Attemptから最大1件",()=>{
  assert.equal(selectAutomaticRemediation([relation(1),relation(2)]).length,1);
});
