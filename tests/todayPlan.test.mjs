import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTodayTime } from "../src/todayPlan.ts";

const task=(minutes,triage,checked=false)=>({
  problem_id:`P-${minutes}-${triage}`,title:"",kind:"",reason:"",mode:"skeleton",
  minutes,load:.5,triage,checked
});

test("先送り候補は今日の実行見込みに含めない",()=>{
  const result=summarizeTodayTime([
    task(60,"must"),task(45,"if_time"),task(40,"tomorrow")
  ],75,150,220);
  assert.equal(result.activeRemainingMinutes,105);
  assert.equal(result.postponeCandidateMinutes,40);
  assert.equal(result.activeTotalIfDone,180);
  assert.equal(result.startOfDayMinutes,220);
  assert.match(result.warning,/目標150分を30分超え/);
});

test("完了済みタスクと先送り候補は残り予定へ重複加算しない",()=>{
  const result=summarizeTodayTime([
    task(30,"must",true),task(70,"if_time"),task(40,"tomorrow")
  ],75,150,140);
  assert.equal(result.activeRemainingMinutes,70);
  assert.equal(result.activeTotalIfDone,145);
  assert.equal(result.warning,"");
  assert.match(result.guidance,/先送り候補40分は今日の実行予定に含めていません/);
});
