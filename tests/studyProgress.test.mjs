import test from "node:test";
import assert from "node:assert/strict";
import { buildProgressPlan, daysUntilExam, phaseForDays } from "../src/studyProgress.ts";
import { getExamPhase, sheetUsageForPhase } from "../src/examReadiness.ts";

const metrics = {
  a14: 12, sCore14: 4, aPlus14: 6, criticalSStable: 2, criticalSTotal: 2,
  past14: 1, pastFull14: 0, pastSkeleton14: 0, scan14: 1, exam14: 0, kRepeat: 1,
  skeletonCount: 5, skeletonRate: 80, studyDays14: 14, actualMinutes14: 2100,
  delayed3: 0, dailyTargetMinutes: 150,
};

test("残り日数から4か月用フェーズへ切り替える", () => {
  assert.deepEqual(
    [getExamPhase(120), getExamPhase(80), getExamPhase(45), getExamPhase(20)],
    ["foundation_to_A", "A_and_past_parallel", "past_exam_main", "final_stabilization"],
  );
  assert.deepEqual(
    [phaseForDays(120), phaseForDays(80), phaseForDays(45), phaseForDays(20)],
    ["foundation", "integration", "past_practice", "final"],
  );
});

test("残り120日以上はS全面復習ではなくA着手と型識別を評価する", () => {
  const plan = buildProgressPlan(120, metrics);
  assert.equal(plan.phase, "foundation");
  assert.match(plan.phaseLabel, /S限定補修/);
  assert.match(plan.allocation, /A問題45%/);
  assert.equal(plan.checks.find(item => item.label === "型識別").status, "ok");
  assert.equal(plan.label, "合格ペース");
});

test("過去問主軸期は過去問と5問スキャン不足を警告する", () => {
  const plan = buildProgressPlan(45, { ...metrics, past14: 0, pastFull14: 0, scan14: 0 });
  assert.equal(plan.phase, "past_practice");
  assert.equal(plan.checks.find(item => item.label === "過去問主軸").status, "pending");
  assert.equal(plan.checks.find(item => item.label === "選題練習").status, "pending");
});

test("試験日未設定時は136日を概算値として使う", () => {
  assert.equal(daysUntilExam("2026-07-02", ""), 136);
  assert.equal(daysUntilExam("2026-07-02", "2026-07-12"), 10);
});

test("記録不足だけでは危険判定にしない", () => {
  const plan = buildProgressPlan(120, {
    ...metrics, sCore14: 0, aPlus14: 0, a14: 0, scan14: 0,
    studyDays14: 1, actualMinutes14: 25,
  });
  assert.equal(plan.label, "判定保留");
});

test("フェーズ別にシート使用方法が変わる", () => {
  assert.match(sheetUsageForPhase("skeleton", "foundation_to_A"), /全欄/);
  assert.match(sheetUsageForPhase("skeleton", "past_exam_main"), /縮約骨格/);
  assert.match(sheetUsageForPhase("scan", "final_stabilization"), /週2回以上/);
});
