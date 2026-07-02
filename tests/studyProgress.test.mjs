import test from "node:test";
import assert from "node:assert/strict";
import { buildProgressPlan, daysUntilExam, phaseForDays } from "../src/studyProgress.ts";

const metrics={
  a14:12,sCore14:8,aPlus14:6,criticalSStable:2,criticalSTotal:2,
  past14:0,pastFull14:0,pastSkeleton14:0,scan14:0,exam14:0,kRepeat:1,skeletonCount:5,skeletonRate:80,
  studyDays14:14,actualMinutes14:2100,delayed3:0,dailyTargetMinutes:150
};

test("残り140日は基礎期として過去問未実施を減点しない",()=>{
  const plan=buildProgressPlan(140,metrics);
  assert.equal(plan.phase,"foundation");
  const pastCheck=plan.checks.find(item=>item.label==="過去問の軽い接続");
  assert.equal(pastCheck.status,"pending");
  assert.match(pastCheck.detail,/必須にしない/);
  assert.equal(plan.label,"合格ペース");
});

test("残り日数に応じて正式4フェーズへ切り替える",()=>{
  assert.deepEqual([phaseForDays(140),phaseForDays(80),phaseForDays(45),phaseForDays(20)],
    ["foundation","integration","past_practice","final"]);
  assert.equal(buildProgressPlan(80,metrics).checks[1].status,"warning");
  assert.equal(buildProgressPlan(45,{...metrics,past14:5,pastFull14:3,pastSkeleton14:2}).checks[0].status,"ok");
  assert.equal(buildProgressPlan(20,{...metrics,exam14:2}).checks[0].status,"ok");
});

test("試験日未設定時は140日を概算値として使う",()=>{
  assert.equal(daysUntilExam("2026-07-02",""),140);
  assert.equal(daysUntilExam("2026-07-02","2026-07-12"),10);
});

test("正式問題追加直後は記録不足だけで危険判定にしない",()=>{
  const plan=buildProgressPlan(140,{...metrics,sCore14:0,aPlus14:0,criticalSStable:0,criticalSTotal:0,
    studyDays14:1,actualMinutes14:25});
  assert.equal(plan.label,"判定保留");
});
