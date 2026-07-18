import test from "node:test";
import assert from "node:assert/strict";
import { calculateExamReadinessMetrics, resolveCanonicalProblemId } from "../src/examReadiness.ts";

const problems = [
  { problem_id: "WB-2-A-06", category: "A", theme: "変数変換", canonical_keywords: ["変数変換"] },
  { problem_id: "PY-2025-Q1", category: "past_exam", theme: "AIC", canonical_keywords: ["AIC"] },
];
const aliases = [{ alias: "WB-2-S-06", problem_id: "WB-2-A-06", corrected_problem_id: "WB-2-A-06" }];

test("alias IDをcanonical IDへ解決する", () => {
  assert.equal(resolveCanonicalProblemId("WB-2-S-06", aliases), "WB-2-A-06");
});

test("未見得点率・時間内完走率・選題成功率を計算する", () => {
  const attempts = [
    { id: 1, problem_id: "WB-2-S-06", date: "2026-07-01", mode: "full", time_minutes: 30, score_numeric: 70, mark: "○", error_type: "none", error_types: ["none"], actual_reference_level: 0 },
    { id: 2, problem_id: "PY-2025-Q1", date: "2026-07-02", mode: "full", time_minutes: 32, score_numeric: 65, mark: "○", error_type: "K", error_types: ["K"], actual_reference_level: 0 },
    { id: 3, problem_id: "PY-2025-Q1", date: "2026-07-03", mode: "full", time_minutes: 40, score_numeric: 50, mark: "△", error_type: "K", error_types: ["K"], actual_reference_level: 0 },
  ];
  const pastSessions = [
    { id: 1, year: 2025, date: "2026-07-04", session_type: "scan_5_questions", selected_questions: "A;B;C", final_selected_problem_ids: "A;B;D" },
  ];
  const metrics = calculateExamReadinessMetrics({ problems, attempts, pastSessions, aliases, today: "2026-07-05" });
  assert.equal(metrics.unseenScoreRate, 68);
  assert.equal(metrics.timedCompletionRate, 67);
  assert.equal(metrics.selectionSuccessRate, 67);
  assert.equal(metrics.kRecurrenceRate, 100);
});

test("pastSessionsが0件なら本番指標は0%ではなく未計測値null", () => {
  const metrics = calculateExamReadinessMetrics({ problems: [], attempts: [], pastSessions: [], aliases: [], today: "2026-07-18" });
  assert.equal(metrics.unseenScoreRate, null);
  assert.equal(metrics.timedCompletionRate, null);
  assert.equal(metrics.selectionSuccessRate, null);
  assert.equal(metrics.pastExamScoreRate, null);
  assert.equal(metrics.sampleSizes.scans, 0);
});
