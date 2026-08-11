import test from "node:test";
import assert from "node:assert/strict";
import {currentTargetDisplay,currentTargetPayloadMatches,withCurrentFindingPayload} from "../src/currentTargetPayload.ts";

const part=(id,label)=>({id,label,cueLabel:label,allowedErrorTypes:["N","none"],
  completionCriterionId:`criterion-${id}`,stableTargetKey:`target:WB-4-A-29:slot:${id}`});

test("current finding changes payload but preserves immutable target identity",()=>{
  const original=part("range","古い全体エラー");
  const current=withCurrentFindingPayload(original,{graded_part_id:"range",error_type:"N",
    evidence:"(5)の積分範囲だけが未解決",resolved:false},{
    id:172,problem_id:"WB-4-A-29",date:"2026-08-10",mode:"check",time_minutes:5,mark:"△",
    score_label:"B",error_type:"N",error_point:"",next_action:"(5)だけ再現",memo:"",saved_at:"2026-08-10T10:00:00Z",
  });
  assert.equal(current.stableTargetKey,original.stableTargetKey);
  assert.equal(current.label,"(5)の積分範囲だけが未解決");
  assert.equal(current.currentEvidence,"(5)の積分範囲だけが未解決");
  assert.equal(current.evidenceSourceAttemptId,172);
});

test("one-line hint says only for one target and multiple actions disclose omissions",()=>{
  const one=currentTargetDisplay([part("pit","PITを再現")]);
  assert.match(one.oneLineHint,/だけ/);
  const four=currentTargetDisplay([
    part("a","範囲"),part("b","上限"),part("c","場合分け"),part("d","PIT"),
  ],3);
  assert.doesNotMatch(four.oneLineHint,/だけ/);
  assert.match(four.oneLineHint,/残り3点/);
  assert.deepEqual(four.todayActions,["範囲","上限","場合分け","ほか1件も確認する"]);
  assert.equal(four.targetCount,4);
  assert.equal(four.omittedCount,1);
});

test("legacy payload is compatible only when its displayed label already matches latest evidence",()=>{
  const latest={...part("range","latest residual error"),currentLabel:"latest residual error",
    currentEvidence:"latest residual error",currentErrorType:"N",evidenceSourceAttemptId:172};
  assert.equal(currentTargetPayloadMatches(part("range","latest residual error"),latest),true);
  assert.equal(currentTargetPayloadMatches(part("range","old broad error"),latest),false);
});
