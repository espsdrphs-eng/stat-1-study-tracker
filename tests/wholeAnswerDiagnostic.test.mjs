import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildReviewGradingPrompt,buildWholeAnswerRediagnosisPrompt} from "../src/gradingPrompt.ts";
import {parseStudyText} from "../src/importParser.ts";
import {materializeObservedOutOfScopeFindings} from "../src/outOfScopeObservations.ts";
import {normalizeWholeAnswerScan,parseWholeAnswerRediagnosis,suppliedReferenceCoverage,wholeAnswerDiagnosticIssues,wholeAnswerScanSummary} from "../src/wholeAnswerDiagnostic.ts";

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
    written_answer_coverage: full
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
  assert.equal(parsed.whole_answer_scan.performed,true);
  assert.equal(parsed.whole_answer_scan.effective_reference_coverage,"full");
  assert.equal(parsed.whole_answer_scan.written_answer_coverage,"full");
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

test("attached complete official reference overrides partial app metadata and accounts every written region",()=>{
  const scan=normalizeWholeAnswerScan({performed:true,app_reference_coverage:"partial",effective_reference_coverage:"partial",
    written_answer_coverage:"full",confidence:"high",attachments:[
      {attachment_id:"problem.png",kind:"problem_statement",description:"問題全文",coverage:"full",page_count:1},
      {attachment_id:"official.png",kind:"official_reference_answer",description:"公式解答",coverage:"full",page_count:2},
      {attachment_id:"answer-1.png",kind:"current_answer",description:"答案1-2頁",coverage:"full",page_count:2},
    ],regions:[
      {region_id:"r1",description:"尤度の構成",answer_present:true,readable:true,reference_available:true,status:"checked_correct",finding_ids:[]},
      {region_id:"r2",description:"制約下最大化",answer_present:true,readable:true,reference_available:true,status:"checked_error",finding_ids:["f1"]},
    ]});
  assert.equal(scan.app_reference_coverage,"partial");
  assert.equal(scan.effective_reference_coverage,"full");
  assert.equal(scan.regions.length,2);
  assert.deepEqual(wholeAnswerDiagnosticIssues(scan,[],[]),[]);
});

test("same-root downstream errors share one stable target while an independent major gets another",()=>{
  let issued=0;const rows=[
    {mastery_level:2,mastery_area:"main_calc",finding:"上流の周辺化未完了",evidence:"中間式に補助変数が残る",correction:"補助変数を積分する",materiality:"major",confidence:"high",create_target_candidate:true,root_cause_key:"root:marginal"},
    {mastery_level:2,mastery_area:"main_calc",finding:"下流の期待値にも補助変数",evidence:"同じ未完了式を使用",correction:"完成した周辺分布を使う",materiality:"major",confidence:"high",create_target_candidate:true,root_cause_key:"root:marginal"},
    {mastery_level:2,mastery_area:"main_calc",finding:"独立した係数追跡ミス",evidence:"展開係数が異なる",correction:"展開係数を照合する",materiality:"major",confidence:"high",create_target_candidate:true,root_cause_key:"root:coefficient"},
  ];
  const promoted=materializeObservedOutOfScopeFindings({rows,scan:normalizeWholeAnswerScan({performed:true,reference_coverage:"full",written_answer_coverage:"full",confidence:"high"}),
    mode:"main_calc",currentPayloads:[],issueKey:()=>`target:${++issued}`});
  assert.equal(promoted[0].stable_target_key,promoted[1].stable_target_key);
  assert.notEqual(promoted[0].stable_target_key,promoted[2].stable_target_key);
  assert.equal(issued,2);
});

test("material handwriting uncertainty is surfaced and never treated as no additional error",()=>{
  const parsed=parseWholeAnswerRediagnosis(`whole_answer_diagnostic_update:
  attempt_id: 21
  problem_id: ${problemId}
  whole_answer_scan:
    performed: true
    app_reference_coverage: partial
    effective_reference_coverage: full
    written_answer_coverage: partial
    confidence: medium
    attachments:
      - {attachment_id: official, kind: official_reference_answer, description: 公式解答, coverage: full}
      - {attachment_id: problem, kind: problem_statement, description: 問題, coverage: full}
      - {attachment_id: answer, kind: current_answer, description: 2ページ答案, coverage: partial}
    regions:
      - {region_id: proof, description: 論証の結論, answer_present: true, readable: partial, reference_available: true, status: uncertain, finding_ids: []}
  observed_out_of_scope_findings: []
  diagnostic_uncertainties:
    - region_id: proof
      description: 結論直前の式が判読不能
      reason: handwriting
      potential_materiality: major
      confidence: low
      candidate_interpretations: []
      user_action_required: true`,context);
  assert.equal(parsed.uncertainties.length,1);
  assert.equal(wholeAnswerDiagnosticIssues(parsed.wholeAnswerScan,parsed.findings,parsed.uncertainties).length,0);
  assert.match(wholeAnswerScanSummary(parsed.wholeAnswerScan,0,1).title,/判定不能/);
});

test("rediagnosis prompt preserves historical grading and uses one domain-neutral region pipeline",()=>{
  const attempt={id:21,problem_id:problemId,date:"2026-08-18",mode:"main_calc",time_minutes:20,mark:"○",score_label:"S",score_numeric:100,
    error_type:"none",error_point:"",next_action:"",memo:""};
  const prompt=buildWholeAnswerRediagnosisPrompt(attempt,context);
  assert.match(prompt,/元の点数・mark・graded_findings・Review完了結果は変更しません/);
  assert.match(prompt,/continuation/);assert.match(prompt,/root_cause_key/);assert.match(prompt,/diagnostic_uncertainties/);
  assert.doesNotMatch(prompt,/WB-5-A-21専用|二項展開専用|周辺化専用/);
});

test("cross-domain written regions use the same status vocabulary without problem-specific branches",()=>{
  const domains=["分布","多次元分布","変数変換","順序統計","推定","最尤推定","制約付き推定","仮説検定","尤度比","回帰","モーメント","漸近","証明・説明","過去問"];
  for(const [index,description] of domains.entries()){
    const scan=normalizeWholeAnswerScan({performed:true,reference_coverage:"full",written_answer_coverage:"full",confidence:"high",
      regions:[{region_id:`r${index}`,description,answer_present:true,readable:true,reference_available:true,status:index%2?"checked_correct":"checked_error",finding_ids:[]}]});
    assert.equal(scan.regions[0].description,description);assert.ok(["checked_correct","checked_error"].includes(scan.regions[0].status));
  }
});

test("whole-answer pipeline has no problem, chapter, theme, or formula-specific branch",async()=>{
  const source=(await Promise.all(["src/wholeAnswerDiagnostic.ts","src/outOfScopeObservations.ts"].map(file=>readFile(file,"utf8")))).join("\n");
  assert.doesNotMatch(source,/if\s*\([^)]*(?:WB-|PY-|chapter|theme|周辺化|二項展開)/i);
});
