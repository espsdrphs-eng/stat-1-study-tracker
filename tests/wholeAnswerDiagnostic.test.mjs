import test from "node:test";
import assert from "node:assert/strict";
import {buildReviewGradingPrompt} from "../src/gradingPrompt.ts";
import {parseStudyText} from "../src/importParser.ts";
import {materializeObservedOutOfScopeFindings} from "../src/outOfScopeObservations.ts";
import {suppliedReferenceCoverage,wholeAnswerScanSummary} from "../src/wholeAnswerDiagnostic.ts";

const problemId="WB-5-A-21";
const problem={id:521,problem_id:problemId,source_type:"whitebook",category:"A",chapter:5,problem_number:21,
  title:"順序統計量",display_label:"第5章A問21",theme:"順序統計量",priority:"core",role:"score",
  recommended_mode:"main_calc",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",
  question_excerpt:"Y=X_(n)-X_(1) の密度を求めよ。",official_answer:"X=X_(1) と置き、xについて正しい支持領域で積分する。"};
const context={problemId,canonicalProblemId:problemId,displayLabel:"第5章A問21",title:problem.title,theme:problem.theme,
  canonicalProblemType:"順序統計量",canonicalKeywords:["最大値","最小値"],problemMaster:problem,
  problemStatement:problem.question_excerpt,officialAnswerText:problem.official_answer,contextCompleteness:"complete",
  previousAttempts:[],previousReviews:[],verifiedRelations:[]};

const yaml=(scan,findings="[]")=>`study_update:
  problem_id: ${problemId}
  date: 2026-08-18
  mode: main_calc
  score_label: S
  score_numeric: 100
  error_types: [none]
  primary_error_type: none
  error_point: ""
  next_action: ""
  target_issue_resolved: true
  minimum_pass_condition_met: true
  review_outcome: success
  whole_answer_scan:
    performed: ${scan.performed}
    reference_coverage: ${scan.reference_coverage}
    confidence: ${scan.confidence}
    reason: "${scan.reason}"
  observed_out_of_scope_findings: ${findings}`;

test("review prompt supplies authoritative context and locks Layer A before Layer B",()=>{
  const prompt=buildReviewGradingPrompt({reviewId:10,problemId,date:"2026-08-18",mode:"main_calc",problemContext:context});
  assert.match(prompt,/STEP 1[\s\S]*current grading contract/i);
  assert.match(prompt,/STEP 2[\s\S]*whole-answer diagnostic/i);
  assert.match(prompt,/STEP 1[^\n]*score[^\n]*変更しない/);
  assert.match(prompt,/Y=X_\(n\)-X_\(1\) の密度を求めよ/);
  assert.match(prompt,/X=X_\(1\) と置き/);
  assert.match(prompt,/app_reference_coverage：full/);
  assert.match(prompt,/whole_answer_scan:/);
  assert.match(prompt,/答案に実際に書かれていない/);
  assert.equal(suppliedReferenceCoverage(context),"full");
});

test("Fixture A keeps S100 while recording a full-reference major out-of-scope error",()=>{
  const text=yaml({performed:true,reference_coverage:"full",confidence:"high",reason:"問題文と参照解答で全式を照合"},`\n    - mastery_level: main_calc
      finding: 積分の支持領域が誤っている
      evidence: 0<y<1 で x の上限を常に1と書いた
      correction: yに応じた支持領域で積分する
      materiality: major
      confidence: high
      create_target_candidate: true`);
  const parsed=parseStudyText(text,[problem]).updates[0];
  assert.equal(parsed.score_numeric,100);
  assert.equal(parsed.review_outcome,"success");
  assert.deepEqual(parsed.whole_answer_scan,{performed:true,reference_coverage:"full",confidence:"high",reason:"問題文と参照解答で全式を照合"});
  assert.equal(parsed.observed_out_of_scope_findings.length,1);
  assert.equal(parsed.observed_out_of_scope_findings[0].mastery_level,2);
  assert.equal(parsed.observed_out_of_scope_findings[0].correction,"yに応じた支持領域で積分する");
  const promoted=materializeObservedOutOfScopeFindings({rows:parsed.observed_out_of_scope_findings,
    scan:parsed.whole_answer_scan,mode:"main_calc",currentPayloads:[],issueKey:()=>"target:new"});
  assert.equal(promoted[0].stable_target_key,"target:new");
});

test("Fixture B distinguishes a verified empty scan from Fixture C insufficient reference",()=>{
  const verified=parseStudyText(yaml({performed:true,reference_coverage:"full",confidence:"high",reason:"全体照合済み"}),[problem]).updates[0];
  assert.match(wholeAnswerScanSummary(verified.whole_answer_scan,0).title,/major errorなし/);
  const insufficient=parseStudyText(yaml({performed:false,reference_coverage:"insufficient",confidence:"low",reason:"参照解答なし"}),[problem]).updates[0];
  assert.equal(insufficient.score_numeric,100);
  assert.match(wholeAnswerScanSummary(insufficient.whole_answer_scan,0).title,/未確認/);
  assert.doesNotMatch(wholeAnswerScanSummary(insufficient.whole_answer_scan,0).title,/errorなし/);
});

test("Fixture D/E do not invent unwritten or minor targets",()=>{
  const noWriting=parseStudyText(yaml({performed:true,reference_coverage:"full",confidence:"high",reason:"答案にscope外記述なし"}),[problem]).updates[0];
  assert.equal(noWriting.observed_out_of_scope_findings.length,0);
  const minor=parseStudyText(yaml({performed:true,reference_coverage:"full",confidence:"high",reason:"全体照合済み"},`\n    - mastery_level: other
      finding: 添字を読みやすくする
      evidence: 添字が小さい
      correction: 添字を明瞭に書く
      materiality: minor
      confidence: high
      create_target_candidate: false`),[problem]).updates[0];
  const rows=materializeObservedOutOfScopeFindings({rows:minor.observed_out_of_scope_findings,scan:minor.whole_answer_scan,
    mode:"main_calc",currentPayloads:[],issueKey:()=>"bad"});
  assert.equal(rows[0].stable_target_key,undefined);
});

test("Fixture F/G never duplicate an existing stable target and insufficient scans cannot promote",()=>{
  const row={mastery_level:2,finding:"積分の支持領域が誤っている",evidence:"上限を常に1とした",correction:"支持領域を直す",
    materiality:"major",confidence:"high",create_target_candidate:true};
  const full={performed:true,reference_coverage:"full",confidence:"high",reason:"全体照合済み"};
  const first=materializeObservedOutOfScopeFindings({rows:[row],scan:full,mode:"main_calc",currentPayloads:[],issueKey:()=>"target:root:1"});
  assert.equal(first[0].stable_target_key,"target:root:1");
  const second=materializeObservedOutOfScopeFindings({rows:[row],scan:full,mode:"main_calc",
    currentPayloads:[row.finding,row.evidence],issueKey:()=>"duplicate"});
  assert.equal(second[0].stable_target_key,undefined);
  const blocked=materializeObservedOutOfScopeFindings({rows:[row],scan:{performed:false,reference_coverage:"insufficient",confidence:"low",reason:"不足"},
    mode:"main_calc",currentPayloads:[],issueKey:()=>"bad"});
  assert.equal(blocked[0].stable_target_key,undefined);
});
