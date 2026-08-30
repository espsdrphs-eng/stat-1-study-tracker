import test from "node:test";
import assert from "node:assert/strict";
import {analyzeConceptWeaknesses,buildPastExamRepairCandidates} from "../src/conceptWeakness.ts";
import {attempt,pastProblem,problem,record} from "./adaptiveFixture.mjs";

const problems=[problem("PY-2021-Q1",null,"past_exam"),problem("PY-2022-Q1",null,"past_exam")];
const analyze=attempts=>analyzeConceptWeaknesses({record:record(),problems,attempts,reviews:[],weakNotes:[],today:"2026-07-29"})[0];

test("同日・同一問題・同一文脈の複数指摘を独立失敗1回へ集約する",()=>{
  const row=analyze([attempt(1,"PY-2021-Q1","2026-07-01"),attempt(2,"PY-2021-Q1","2026-07-01",{error_types:["N"]})]);
  assert.equal(row.independentFailures,1);
  assert.equal(row.independentOpportunities,1);
});

test("暫定失敗20/25でも強い証拠0件なら確認済みにせず要診断のままにする",()=>{
  const rows=[];
  for(let index=1;index<=25;index++)rows.push(attempt(index,index%2?"PY-2021-Q1":"PY-2022-Q1",
    `2026-07-${String(index).padStart(2,"0")}`,index<=20
      ?{mode:"check",review_scope:"check_only",mark:"△",error_types:["W"]}
      :{mode:"check",review_scope:"check_only",mark:"○",error_type:"none",error_types:["none"],score_numeric:80}));
  const row=analyze(rows);
  assert.equal(row.independentFailures,20);
  assert.equal(row.independentOpportunities,25);
  assert.equal(row.strongFailures,0);
  assert.equal(row.state,"suspected");
  assert.equal(row.evidenceConfidence,"low");
  assert.match(row.nextRecommendedAction,/診断/);
});

test("過去問での出題年度数とユーザー実答案の失敗年度数を分離する",()=>{
  const row=analyze([attempt(1,"PY-2021-Q1","2026-07-01")]);
  assert.equal(row.examOccurrenceYearCount,2);
  assert.equal(row.pastExamFailureYearCount,1);
  assert.equal(row.pastExamFailureCount,1);
});

test("2回中2回失敗は10回中2回より弱点度が高い",()=>{
  const two=analyze([attempt(1,"PY-2021-Q1","2026-07-01"),attempt(2,"PY-2022-Q1","2026-07-02")]);
  const tenAttempts=[attempt(1,"PY-2021-Q1","2026-07-01"),attempt(2,"PY-2022-Q1","2026-07-02")];
  for(let index=3;index<=10;index++)tenAttempts.push(attempt(index,index%2?"PY-2021-Q1":"PY-2022-Q1",`2026-07-${String(index).padStart(2,"0")}`,{mark:"○",error_type:"none",error_types:["none"],score_numeric:80}));
  const ten=analyze(tenAttempts);
  assert.ok(two.failureRate>ten.failureRate);
  assert.ok(two.weaknessScore>ten.weaknessScore);
});

test("遅延・別問題成功で解消し、その後の失敗を再発にする",()=>{
  const base=[attempt(1,"PY-2021-Q1","2026-07-01"),attempt(2,"PY-2022-Q1","2026-07-02"),
    attempt(3,"PY-2021-Q1","2026-07-05",{mark:"○",error_type:"none",error_types:["none"],score_numeric:80}),
    attempt(4,"PY-2022-Q1","2026-07-06",{mark:"○",error_type:"none",error_types:["none"],score_numeric:85})];
  assert.equal(analyze(base).state,"resolved");
  assert.equal(analyze([...base,attempt(5,"PY-2022-Q1","2026-07-12")]).state,"relapsed");
});

test("scan_onlyから数学的補修候補を作らず、通常答案でも最大2件",()=>{
  const rec=record({data:{...record().data,concepts:[
    record().data.concepts[0],{...record().data.concepts[0],concept_id:"c2",display_name:"尤度"}
  ],pastExamProblems:[pastProblem(2021,1,["c1","c2"]),pastProblem(2022,1,["c1","c2"])]}});
  const weaknesses=analyzeConceptWeaknesses({record:rec,problems,attempts:[attempt(1,"PY-2021-Q1","2026-07-01")],reviews:[],weakNotes:[],today:"2026-07-29"});
  const scan={id:1,date:"2026-07-01",session_kind:"scan_only",session_type:"scan5",stage:"discrimination",scan_set_source:"past_exam_year",questions:[],linked_attempt_ids:[1]};
  assert.equal(buildPastExamRepairCandidates({record:rec,sessions:[scan],attempts:[attempt(1,"PY-2021-Q1","2026-07-01")],conceptWeaknesses:weaknesses}).length,0);
  const one={...scan,id:2,session_kind:"scan_plus_one"};
  assert.ok(buildPastExamRepairCandidates({record:rec,sessions:[one],attempts:[attempt(1,"PY-2021-Q1","2026-07-01")],conceptWeaknesses:weaknesses}).length<=2);
});

test("過去問の単発Cは任意、major反復はsource lineage付きrequired repairになる",()=>{
  const link={past_exam_problem_id:"PE-2021-Q01",whitebook_problem_id:"WB-4-A-01",relation_type:"remediation",
    priority_rank:1,reason:"変数変換",confidence:"verified",requires_user_confirmation_before_task_creation:true,
    requires_live_problem_master_reconciliation:true,resolved_whitebook_problem_id:"WB-4-A-01",reconciliation_status:"exact"};
  const rec=record({data:{...record().data,whitebookLinks:[link]}});
  const session={id:2,date:"2026-08-29",session_kind:"scan_plus_one",session_type:"scan5",stage:"calibration",
    scan_set_source:"past_exam_year",questions:[],linked_attempt_ids:[1]};
  const wb={...problem("WB-4-A-01"),fine_concept_ids:["c1"]};
  const minor=attempt(1,"PY-2021-Q1","2026-08-29",{error_type:"C",error_types:["C"],score_numeric:82,review_outcome:"partial"});
  const minorWeakness=[{...analyzeConceptWeaknesses({record:rec,problems,attempts:[minor],reviews:[],weakNotes:[],today:"2026-08-30"})[0],
    recurrenceCount:0,pastExamFailureCount:1}];
  const minorRows=buildPastExamRepairCandidates({record:rec,sessions:[session],attempts:[minor],conceptWeaknesses:minorWeakness,problems:[wb]});
  assert.equal(minorRows[0].required,false);assert.equal(minorRows[0].materiality,"minor");
  const major=attempt(1,"PY-2021-Q1","2026-08-29",{error_type:"W",error_types:["W"],score_numeric:55,review_outcome:"failed"});
  const majorWeakness=[{...minorWeakness[0],recurrenceCount:2,strongFailures:2}];
  const majorRows=buildPastExamRepairCandidates({record:rec,sessions:[session],attempts:[major],conceptWeaknesses:majorWeakness,problems:[wb]});
  assert.equal(majorRows[0].required,true);assert.equal(majorRows[0].whitebookProblemIds.length,1);
  assert.equal(majorRows[0].sourceAttemptId,1);assert.match(majorRows[0].matchReason,/fine concept/);
});
