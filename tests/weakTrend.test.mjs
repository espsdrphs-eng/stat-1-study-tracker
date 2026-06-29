import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWeakTrends, buildQuizPrompt } from "../src/weakTrend.ts";

const problems=[
  {problem_id:"WB-6-A-05",category:"A",chapter:6,theme:"AIC・自由度"},
  {problem_id:"WB-4-A-26",category:"A",chapter:4,theme:"変数変換"}
];
const attempts=[
  {id:1,problem_id:"WB-6-A-05",date:"2026-06-20",error_type:"K",error_types:["K"],primary_error_type:"K"},
  {id:2,problem_id:"WB-6-A-05",date:"2026-06-27",error_type:"W",error_types:["W"],primary_error_type:"W"},
  {id:3,problem_id:"WB-4-A-26",date:"2026-06-28",error_type:"N",error_types:["N"],primary_error_type:"N"}
];
const notes=[
  {id:1,problem_id:"WB-6-A-05",date:"2026-06-20",theme:"AIC・自由度",error_type:"K",mistake:"自由パラメータ数",correction_rule:"制約後の個数を数える",is_resolved:0}
];

test("問題と採点結果から重み付きの弱点傾向を集計する",()=>{
  const trend=analyzeWeakTrends(problems,attempts,notes);
  assert.equal(trend.attemptCount,3);
  assert.equal(trend.topTheme,"AIC・自由度");
  assert.equal(trend.themes[0].score,7);
  assert.equal(trend.errors.find(row=>row.error==="K").score,5);
  assert.equal(trend.kRate,33);
});

test("選択テーマから1問ずつ進むGPTクイズ用プロンプトを作る",()=>{
  const prompt=buildQuizPrompt(["AIC・自由度"],problems,attempts,notes,5);
  assert.match(prompt,/全5問/);
  assert.match(prompt,/必ず1問ずつ/);
  assert.match(prompt,/答えるまで正解を表示しない/);
  assert.match(prompt,/WB-6-A-05/);
  assert.match(prompt,/自由パラメータ数/);
});

test("採点データの編集・削除後は弱点傾向が再計算される",()=>{
  const edited=attempts.map(attempt=>attempt.id===1?{...attempt,error_type:"C",primary_error_type:"C",error_types:["C"]}:attempt);
  const afterEdit=analyzeWeakTrends(problems,edited,notes);
  assert.equal(afterEdit.themes[0].score,3);
  assert.equal(afterEdit.errors.find(row=>row.error==="K").count,0);

  const afterDelete=analyzeWeakTrends(problems,attempts.filter(attempt=>attempt.id!==1),[]);
  assert.equal(afterDelete.attemptCount,2);
  assert.equal(afterDelete.themes.find(row=>row.label==="AIC・自由度").score,2);
});
