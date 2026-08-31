import test from "node:test";
import assert from "node:assert/strict";
import {canonicalizePastExamSessions,pastExamSessionKey} from "../src/pastExamPlanning.ts";
import {attemptPlanningEligible} from "../src/legacyKPolicy.ts";
import {deriveFailureEpisode} from "../src/failureEpisode.ts";
import {analyzeReviewReconciliation} from "../src/reviewReconciliation.ts";
import {deriveLearningPolicy} from "../src/examOptimizationPolicy.ts";
import {buildAdaptivePlannerShadow} from "../src/adaptivePlanner.ts";
import {buildPastExamCatalog} from "../src/examReferencePack.ts";
import {pastProblem,problem,record} from "./adaptiveFixture.mjs";

const question=(n,selected=false)=>({problemId:`PY-2018-Q${n}`,questionLabel:`問${n}`,predictedType:`type-${n}`,
  firstStep:`step-${n}`,predictedScore:60+n,predictedMinutes:25+n,sinkRisk:"low",selected,
  selectionReason:selected?"得点候補":"",plannedOrder:selected?n:null});

test("latest-pack F1/F2: 日付違いの2018 clean/practiceを1 current sessionへ統合し入力とclean snapshotを保持",()=>{
  const clean={id:1,year:2018,date:"2026-08-30",session_type:"scan5",session_kind:"selected_three_timed",
    session_purpose:"clean_scan5",session_ordinal:1,scan_evidence_kind:"clean",prompt_scanned_at:"2026-08-30T09:00:00Z",
    exposure_snapshot_at_start:{classification:"clean",exposed_problem_ids:[],total_problem_count:5,captured_at:"2026-08-30T09:00:00Z"},
    questions:[1,2,3,4,5].map(n=>question(n,false))};
  const practice={...clean,id:2,date:"2026-08-31",session_purpose:"practice_scan5",scan_evidence_kind:"practice",
    exposure_snapshot_at_start:{classification:"practice",exposed_problem_ids:["PY-2018-Q1"],total_problem_count:5,captured_at:"2026-08-31T09:00:00Z"},
    questions:[1,2,3,4,5].map(n=>question(n,[1,3,5].includes(n))),
    initial_selected_problem_ids:["PY-2018-Q1","PY-2018-Q3","PY-2018-Q5"],
    final_selected_problem_ids:["PY-2018-Q1","PY-2018-Q3","PY-2018-Q5"],selection_strategy:"得点候補3問"};
  const projection=canonicalizePastExamSessions([clean,practice]);
  assert.equal(projection.current.length,1);
  assert.equal(projection.superseded.length,1);
  assert.equal(projection.current[0].scan_evidence_kind,"clean");
  assert.equal(projection.current[0].session_purpose,"clean_scan5");
  assert.deepEqual(projection.current[0].final_selected_problem_ids,["PY-2018-Q1","PY-2018-Q3","PY-2018-Q5"]);
  assert.equal(projection.current[0].questions.filter(row=>row.selected).length,3);
  assert.doesNotMatch(pastExamSessionKey(projection.current[0]),/2026-08-(30|31)/);
  assert.ok(projection.current[0].selected_year_reason);
  const loser=projection.superseded[0];
  const second=canonicalizePastExamSessions([projection.current[0],{...practice,superseded_by_session_id:loser.canonicalSessionId}]);
  assert.equal(second.current.length,1);assert.equal(second.superseded.length,0);
});

test("latest-pack F6/F8: invalid legacy Kだけを除外し同Attemptのvalid W/Nをmajor repair evidenceへ残す",()=>{
  const parts=["legacy-k","major-calc","answer-conclusion"].map((id,index)=>({id,label:id,cueLabel:id,
    allowedErrorTypes:["K","W","N","none"],completionCriterionId:`c-${id}`,
    stableTargetKey:`target:PY-2017-Q3:slot:${id}`,rootCauseKey:index?"poisson-mgf-root":"legacy-k-root",masteryLevel:index?2:1}));
  const attempt={id:235,problem_id:"PY-2017-Q3",date:"2026-08-30",mode:"full",score_numeric:58,mark:"△",
    score_label:"C",error_type:"K",error_types:["K","W","N"],review_outcome:"partial",policy_validity:"invalid_legacy_k",
    exclude_from_planning:true,error_point:"major calculation and conclusion are incomplete",saved_gpt_feedback:true,
    graded_part_ids:parts.map(row=>row.id),graded_findings:[
      {graded_part_id:"legacy-k",error_type:"K",evidence:"legacy K",resolved:false,validity:"invalid_legacy_k",planning_eligible:false},
      {graded_part_id:"major-calc",error_type:"W",evidence:"主要計算未完",resolved:false,validity:"valid",planning_eligible:true},
      {graded_part_id:"answer-conclusion",error_type:"N",evidence:"結論未完",resolved:false,validity:"valid",planning_eligible:true},
    ],grading_contract:{contractId:"c",contractVersion:"v",contractHash:"h",createdAt:"2026-08-30",problemId:"PY-2017-Q3",
      sourceAttemptId:235,learningPurpose:"exam_performance",learningStage:"performance",mode:"full",reviewScope:"full_answer",
      targetedParts:parts.map(row=>row.id),gradedParts:parts,explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],
      completionCriteria:[],hiddenAnswerKey:[],completionConditions:[],requiredEvidence:[],allowedErrorTypes:["K","W","N"],
      requiresKEvidence:true,allowedReferenceLevel:0,estimatedMinutes:35,sheetType:"full_answer_sheet"}};
  assert.equal(attemptPlanningEligible(attempt),true);
  const episode=deriveFailureEpisode(attempt);
  assert.equal(episode.rootWeaknesses.some(root=>root.errorTypes.includes("K")),false);
  const root=episode.rootWeaknesses.find(row=>row.errorTypes.includes("W"));
  assert.deepEqual(new Set(root.errorTypes),new Set(["W","N"]));
  assert.equal(root.requiredRepair,true);
  const check={id:448,problem_id:"PY-2017-Q3",due_date:"2026-09-02",review_type:"light_check",status:"pending",
    generated_from_attempt_id:235,source_attempt_id:235,learning_purpose:"retrieval_check",correction_provided:true,retention_pending:true,
    grading_contract:{...attempt.grading_contract,reviewId:448,learningPurpose:"retrieval_check",learningStage:"maintenance",mode:"check",reviewScope:"check_only"}};
  const lifecycle=analyzeReviewReconciliation({attempts:[attempt],reviews:[check],today:"2026-08-31"}).problems[0];
  assert.equal(lifecycle.desiredReviewPurpose,"error_repair");
  assert.equal(lifecycle.reviewsToSupersede.some(row=>row.reviewId===448),true);
});

test("latest-pack F9: isolated Cはconservativeにminor optional",()=>{
  const attempt={id:250,problem_id:"WB-5-A-20",date:"2026-08-30",mode:"full",score_numeric:88,mark:"△",score_label:"A",
    error_type:"C",error_types:["C"],review_outcome:"partial",error_point:"V^2をE[V^2]と転記",
    graded_findings:[{graded_part_id:"notation",error_type:"C",evidence:"単発転記",resolved:false}]};
  const root=deriveFailureEpisode(attempt).rootWeaknesses[0];
  assert.equal(root.materiality,"minor");assert.equal(root.requiredRepair,false);assert.equal(root.examImpact,"low");
});

test("WB-5-A-20 latest evidence: resolved Wを復活させず残る単発Cだけをoptionalにする",()=>{
  const makePart=(id,key,label)=>({id,label,cueLabel:label,allowedErrorTypes:["W","C","none"],completionCriterionId:`c-${id}`,
    stableTargetKey:key,masteryLevel:2});
  const variance=makePart("variance","target:WB-5-A-20:slot:variance","分散分解"),notation=makePart("notation","target:WB-5-A-20:slot:notation","V^2の記号位置");
  const baseContract={contractId:"c",contractVersion:"v",contractHash:"h",createdAt:"2026-08-01",problemId:"WB-5-A-20",
    learningPurpose:"error_repair",learningStage:"repair",mode:"main_calc",reviewScope:"main_calc_target",targetedParts:[],
    explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[],hiddenAnswerKey:[],completionConditions:[],
    requiredEvidence:[],allowedErrorTypes:["W","C","none"],requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:7,sheetType:"main_calc_sheet"};
  const old={id:206,problem_id:"WB-5-A-20",date:"2026-08-20",mode:"main_calc",score_numeric:55,mark:"×",score_label:"C",
    error_type:"W",error_types:["W"],review_outcome:"failed",error_point:"分散分解",graded_findings:[{graded_part_id:"variance",error_type:"W",evidence:"旧W",resolved:false}],
    grading_contract:{...baseContract,sourceAttemptId:206,gradedParts:[variance]}};
  const latest={id:212,problem_id:"WB-5-A-20",date:"2026-08-30",mode:"main_calc",score_numeric:90,mark:"○",score_label:"A",
    error_type:"C",error_types:["C"],review_outcome:"partial",error_point:"V^2を書く位置にE[V^2]と書いた",
    graded_findings:[{graded_part_id:"variance",error_type:"none",evidence:"主要式を再現",resolved:true},
      {graded_part_id:"notation",error_type:"C",evidence:"単発記号位置",resolved:false}],
    grading_contract:{...baseContract,sourceAttemptId:212,gradedParts:[variance,notation]}};
  const plan=analyzeReviewReconciliation({attempts:[old,latest],reviews:[],today:"2026-08-31"}).problems[0];
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.stableTargetKey),[notation.stableTargetKey]);
  const root=deriveFailureEpisode(latest).rootWeaknesses[0];
  assert.equal(root.materiality,"minor");assert.equal(root.requiredRepair,false);
});

test("latest-pack F14/F15/F16: current policyは65〜70%、30日forecastにgeneric Whitebookとpolicy violationを残さない",()=>{
  const policy=deriveLearningPolicy(76);
  assert.deepEqual(policy.examPracticeTargetRange,{min:.65,max:.7});
  const rows=[2018,2019,2021,2022,2023,2024,2025].flatMap(year=>Array.from({length:5},(_,i)=>pastProblem(year,i+1)));
  const source=record({data:{...record().data,pastExamProblems:rows}});
  const catalog=buildPastExamCatalog({record:source,sessions:[],attempts:[],exposureOverrides:{}});
  const problems=[problem("WB-7-A-04",7),problem("WB-7-A-08",7),...rows.map((row,index)=>({
    ...problem(`PY-${row.year}-Q${row.question_number}`,7,"past_exam"),id:5000+index,source_type:"past_exam",category:"past_exam"
  }))];
  const shadow=buildAdaptivePlannerShadow({record:source,catalog,weaknesses:[],problems,attempts:[],reviews:[],pastSessions:[],
    currentTasks:[],today:"2026-08-31",examDate:"2026-11-15",targetMinutes:150,repairCandidates:[]});
  assert.match(String(shadow.weeklyTarget.targetMix),/0\.65/);
  assert.doesNotMatch(String(shadow.weeklyTarget.targetMix),/0\.3[,\]]/);
  for(const summary of [shadow.plan7,shadow.plan14,shadow.plan30]){
    assert.deepEqual(summary.weeklyMinimumViolations,[]);
    assert.equal(summary.plan.flatMap(day=>day.tasks).some(task=>task.kind==="whitebook"&&!task.repairLineage),false);
  }
});
