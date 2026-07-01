import test from "node:test";
import assert from "node:assert/strict";
import { buildProgressPlan, daysUntilExam, phaseForDays } from "../src/studyProgress.ts";

const metrics={
  a14:12,past14:0,scan14:0,exam14:0,kRepeat:1,skeletonCount:5,skeletonRate:80,
  studyDays14:14,actualMinutes14:2100,delayed3:0,dailyTargetMinutes:150
};

test("残り140日は基礎期として過去問未実施を減点しない",()=>{
  const plan=buildProgressPlan(140,metrics);
  assert.equal(plan.phase,"foundation");
  assert.equal(plan.checks.at(-1).status,"ok");
  assert.match(plan.checks.at(-1).detail,/必須にしない/);
  assert.equal(plan.label,"合格ペース");
});

test("残り日数に応じて過去問要求を段階的に上げる",()=>{
  assert.deepEqual([phaseForDays(140),phaseForDays(110),phaseForDays(80),phaseForDays(45),phaseForDays(20)],
    ["foundation","integration","past_practice","answer_training","final"]);
  assert.equal(buildProgressPlan(80,metrics).checks.at(-1).status,"warning");
  assert.equal(buildProgressPlan(45,{...metrics,exam14:1}).checks.at(-1).status,"ok");
  assert.equal(buildProgressPlan(20,{...metrics,exam14:2}).checks.at(-1).status,"ok");
});

test("試験日未設定時は140日を概算値として使う",()=>{
  assert.equal(daysUntilExam("2026-07-02",""),140);
  assert.equal(daysUntilExam("2026-07-02","2026-07-12"),10);
});
