import test from "node:test";
import assert from "node:assert/strict";
import { parseStudyText } from "../src/importParser.ts";

const problems = [{
  id: 1,
  problem_id: "WB-2-S-06",
  source_type: "whitebook",
  category: "S",
  chapter: 2,
  problem_number: 6,
  title: "第2章S問6",
  theme: "非負整数値確率変数の期待値",
  priority: "repair",
  role: "foundation",
  recommended_mode: "skeleton",
  linked_past_exams: "",
  linked_s_problems: "",
  linked_a_problems: "",
  notes: "",
  completion_status: "active",
  display_label: "第2章S問6",
  difficulty: null
}];

const smartQuoteUnindentedYaml = `study_update:
problem_id: “WB-2-S-06”
display_label: “第2章S問6”
date: “2026-06-29”
mode: “詳細版”
mark: “△”
score_text: “72/100”
score_numeric: 72
result_summary: “Yes寄りの部分一致。非負整数値確率変数の期待値を尾確率の和に直す発想は見えているが、添字範囲の入れ替えと 1-F(n) への接続が不安定。”
exam_selection_rank: “A”
error_types:
- “W”
- “N”
primary_error_type: “W”
error_point: “和の順序交換で、0<=n<=k-1 を k>=n+1 に直し、内側の和を 1-F(n) と見る部分が弱い。”
next_action: “E[X]=sum_{k=1}^∞ kf(k)、E[X]=sum_{k=1}^∞ sum_{n=0}^{k-1} f(k)、E[X]=sum_{n=0}^∞ sum_{k=n+1}^∞ f(k) の3行を何も見ずに書く。”
review_after_days: 2
grading_confidence: 85
rubric_version: “STAT1-GRADE-v2”
uncertain_points:
- “模範解答が未提示”
linked_s_problems:
- “WB-2-S-07”
linked_past_exams: []
ignored_parts: []
weak_notes:
- “f(k)=P(X=k) を最初に明記する。”
- “添字は k と n の2つに固定する。”
- “集合 {(k,n) | k>=1, 0<=n<=k-1} を {(k,n) | n>=0, k>=n+1} に変換する。”
- “sum_{k=n+1}^∞ f(k)=P(X>n)=1-F(n) の理由を1行添える。”
- “第2章S問7では、この離散の二重和が連続の二重積分に変わる。”`;

test("imports smart-quoted, unindented study_update output", () => {
  const result = parseStudyText(smartQuoteUnindentedYaml, problems);
  assert.equal(result.structured, true);
  assert.equal(result.updates.length, 1);
  const update = result.updates[0];
  assert.equal(update.problem_id, "WB-2-S-06");
  assert.equal(update.display_label, "第2章S問6");
  assert.equal(update.master_matched, true);
  assert.equal(update.mode, "full");
  assert.equal(update.mark, "△");
  assert.equal(update.score_text, "72/100");
  assert.equal(update.score_numeric, 72);
  assert.equal(update.exam_selection_rank, "A");
  assert.deepEqual(update.error_types, ["W", "N"]);
  assert.equal(update.primary_error_type, "W");
  assert.equal(update.secondary_error_type, "N");
  assert.equal(update.review_after_days, 2);
  assert.equal(update.review_reason, "Nが含まれるため2日後");
  assert.equal(update.grading_confidence, .85);
  assert.equal(update.rubric_version, "STAT1-GRADE-v2");
  assert.deepEqual(update.uncertain_points, ["模範解答が未提示"]);
  assert.deepEqual(update.related_s_problem_ids, ["WB-2-S-07"]);
  assert.equal(update.weak_notes?.length, 5);
  assert.equal(update.weak_notes?.[0].correction_rule, "f(k)は、Xがkとなる確率を最初に明記する。");
  assert.equal(update.math_localized, true);
});

test("fills confirmation score and theme from score_label and problem master", () => {
  const result = parseStudyText(`study_update:
problem_id: "WB-2-S-06"
date: "2026-06-30"
mode: "full"
mark: "○"
score_label: "A-"
score_numeric: 78
error_types:
  - "N"
`, problems);
  const update = result.updates[0];
  assert.equal(update.score_text, "A-");
  assert.equal(update.score_label, "A");
  assert.deepEqual(update.themes, [problems[0].theme]);
});

test("accepts fenced YAML, lowercase category, and Unicode dashes", () => {
  const text = `\`\`\`yaml
study_update:
problem_id: “WB–2–s–06”
display_label: “第2章S問6”
date: “2026-06-29”
mode: “詳細版”
mark: “△”
score_numeric: 72
error_types:
- “W”
- “N”
review_after_days: 2
\`\`\``;
  const result = parseStudyText(text, problems);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].problem_id, "WB-2-S-06");
  assert.equal(result.updates[0].master_matched, true);
  assert.equal(result.updates[0].mode, "full");
  assert.deepEqual(result.updates[0].error_types, ["W", "N"]);
});
