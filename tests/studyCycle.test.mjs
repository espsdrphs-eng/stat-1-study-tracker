import test from "node:test";
import assert from "node:assert/strict";
import {
  finalizeStudyUpdateForSave,
  inferTaskOrigin,
  normalizedErrorTypes,
  prepareImportedStudyUpdate,
  reviewMethodForErrors
} from "../src/studyCycle.ts";

test("normalizes errors and keeps the shortest app-owned review interval", () => {
  const update = finalizeStudyUpdateForSave({
    problem_id: "WB-6-A-29",
    date: "2026-07-10",
    mode: "full",
    mark: "△",
    score_label: "B",
    score_numeric: 72,
    error_type: "W",
    primary_error_type: "W",
    error_types: ["W", "N", "C"],
    review_after_days: 14,
    review_method: "check",
    error_point: "calculation omitted",
    next_action: "7日後に omitted calculation を確認する"
  });

  assert.deepEqual(update.error_types, ["N", "W", "C"]);
  assert.equal(update.primary_error_type, "N");
  assert.equal(update.review_after_days, 2);
  assert.equal(update.review_method, "skeleton");
  assert.equal(update.next_action, "omitted calculation を確認する");
});

test("none result can be saved without error point or weak notes", () => {
  const update = finalizeStudyUpdateForSave({
    problem_id: "WB-6-A-29",
    date: "2026-07-10",
    mode: "skeleton",
    mark: "○",
    score_label: "A",
    score_numeric: 90,
    error_type: "none",
    primary_error_type: "none",
    error_types: ["none"],
    error_point: "",
    next_action: "軽く骨格を確認する",
    review_after_days: 1,
    review_method: "main_calc"
  });

  assert.deepEqual(update.error_types, ["none"]);
  assert.equal(update.primary_error_type, "none");
  assert.equal(update.review_after_days, 14);
  assert.equal(update.review_method, "check");
  assert.equal(update.error_point, "大きな問題なし");
  assert.deepEqual(update.weak_notes || [], []);
});

test("prepares imported update with app-owned date and task origin", () => {
  const attempts = [{ id: 1, problem_id: "WB-6-A-29", date: "2026-07-09" }];
  const update = prepareImportedStudyUpdate({
    problem_id: "WB-6-A-29",
    date: "2020-01-01",
    mode: "exam90",
    mark: "○",
    score_label: "A",
    score_numeric: 85,
    error_type: "none",
    primary_error_type: "none",
    error_types: ["none"],
    error_point: "",
    next_action: "骨格を軽く確認する"
  }, { attempts, today: "2026-07-10" });

  assert.equal(update.date, "2026-07-10");
  assert.equal(update.task_origin, "review_attempt");
  assert.equal(update.mode, "exam_90min");
  assert.equal(update.review_after_days, 14);
});

test("task origin and review method helpers encode the final responsibility split", () => {
  assert.equal(inferTaskOrigin("WB-1-A-01", [], undefined), "first_attempt");
  assert.equal(inferTaskOrigin("WB-1-A-01", [{ id: 1, problem_id: "WB-1-A-01" }], undefined), "review_attempt");
  assert.equal(inferTaskOrigin("WB-1-A-01", [], 4), "review_attempt");

  assert.deepEqual(normalizedErrorTypes({ error_types: ["C", "K", "none"], primary_error_type: "C", error_type: "C" }), ["K", "C"]);
  assert.equal(reviewMethodForErrors(["K"]), "skeleton");
  assert.equal(reviewMethodForErrors(["W"]), "main_calc");
  assert.equal(reviewMethodForErrors(["none"]), "check");
});
