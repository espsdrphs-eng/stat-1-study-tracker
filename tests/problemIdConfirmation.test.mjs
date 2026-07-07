import test from "node:test";
import assert from "node:assert/strict";
import { parseStudyText } from "../src/importParser.ts";

const baseProblem = {
  id: 1,
  source_type: "whitebook",
  category: "A",
  chapter: 6,
  problem_number: 29,
  title: "Chapter 6 A29",
  theme: "nonregular estimation",
  priority: "core",
  role: "training",
  recommended_mode: "full",
  linked_past_exams: "",
  linked_s_problems: "",
  linked_a_problems: "",
  notes: "",
  completion_status: "active",
  display_label: "Chapter 6 A29",
  difficulty: null,
  canonical_problem_type: "nonregular estimation",
  canonical_keywords: ["nonregular", "boundary", "MLE"]
};

const problems = [
  { ...baseProblem, problem_id: "WB-6-A-29" },
  {
    ...baseProblem,
    id: 2,
    problem_id: "WB-2-A-20",
    chapter: 2,
    problem_number: 20,
    title: "Chapter 2 A20",
    theme: "example notation target",
    display_label: "Chapter 2 A20",
    canonical_problem_type: "example notation target",
    canonical_keywords: ["example-keyword", "notation-sample"]
  }
];

const answers = [
  { problem_id: "WB-6-A-29", answer_available: true, answer_excerpt: "nonregular boundary MLE", canonical_keywords: ["nonregular", "boundary", "MLE"] },
  { problem_id: "WB-2-A-20", answer_available: true, answer_excerpt: "example-keyword notation-sample", canonical_keywords: ["example-keyword", "notation-sample"] }
];

test("YAML problem_id is locked even when prompt examples contain another ID", () => {
  const text = `認識する表記例
WB-2-A-20
example-keyword notation-sample

study_update:
  problem_id: "WB-6-A-29"
  date: "2026-07-08"
  mode: "full"
  time_minutes: 25
  mark: "○"
  score_numeric: 82
  error_types:
    - "none"
  primary_error_type: "none"
  next_action: "Confirm the nonregular estimation skeleton."
`;
  const update = parseStudyText(text, problems, answers).updates[0];
  assert.equal(update.problem_id, "WB-6-A-29");
  assert.equal(update.problem_id_source, "yaml");
  assert.equal(update.problem_id_confirmed, true);
  assert.equal(update.requires_problem_confirmation, false);
});

test("text candidate detection ignores IDs under recognized example sections", () => {
  const text = `認識する表記例
WB-2-A-20

問題
WB-6-A-29`;
  const update = parseStudyText(text, problems, answers).updates[0];
  assert.equal(update.problem_id, "WB-6-A-29");
  assert.equal(update.problem_id_source, "text");
});
