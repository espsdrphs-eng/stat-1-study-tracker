import test from "node:test";
import assert from "node:assert/strict";
import {calculateExamReadinessMetrics} from "../src/examReadiness.ts";
import {analyzeConceptWeaknesses,buildPastExamRepairCandidates} from "../src/conceptWeakness.ts";
import {attempt,problem,record,pastProblem} from "./adaptiveFixture.mjs";
import {buildAdaptivePlannerShadow} from "../src/adaptivePlanner.ts";
import {buildPastExamCatalog} from "../src/examReferencePack.ts";

// Scores, roles and elapsed times observed in the 2026-09-09 export.
export const selectedFixture=()=>{
  const scores=[58,78,55,38,18],minutes=[30,40,30,20,10];
  const attempts=scores.map((score,i)=>attempt(i+1,`PY-2019-Q${i+1}`,"2026-09-08",{
    score_numeric:score,time_minutes:minutes[i],exam_score_eligible:true}));
  const questions=scores.map((score,i)=>({problemId:`PY-2019-Q${i+1}`,selected:i<3,
    completed:true,actualScore:score,actualMinutes:minutes[i],referenceUsed:false,hintUsed:false}));
  return {problems:attempts.map(a=>problem(a.problem_id,null,"past_exam")),attempts,aliases:[],today:"2026-09-09",
    pastSessions:[{id:10,year:2019,date:"2026-09-07",session_type:"scan5",session_kind:"selected_three_timed",
      session_state:"completed",scan_evidence_kind:"clean",stage:"calibration",scan_set_source:"past_exam_year",
      scan_minutes:10,actual_total_minutes:100,session_elapsed_minutes:110,selected_solve_minutes:100,time_limit_minutes:90,
      initial_selected_problem_ids:questions.slice(0,3).map(q=>q.problemId),questions,
      selected_timed_attempt_ids:[1,2,3],counterfactual_calibration_attempt_ids:[4,5],linked_attempt_ids:[1,2,3,4,5],
      exam_score_eligible:true}]};
};
test("9/9 selected-three excludes diagnostic scores and linked standalone copies, even over time",()=>{
  const result=calculateExamReadinessMetrics(selectedFixture());
  assert.equal(result.pastExamScoreRate,64);
  assert.equal(result.sampleSizes.pastExams,1);
  assert.equal(result.evidence.selectedThree.numerator,191);
  assert.equal(result.evidence.selectedThree.denominator,3);
  assert.equal(result.evidence.selectedThree.sessions[0].score,191/3);
  assert.equal(result.evidence.timed.denominator,1);
  assert.equal(result.evidence.timed.numerator,0);
  assert.equal(result.evidence.selectedThree.lastUpdated,"2026-09-08");
  assert.equal(result.evidence.selectedThree.confidence,"low");
});
test("short repair evidence never enters full/timed scope, even with stale eligible flag",()=>{
  const fixture=selectedFixture();fixture.pastSessions=[];
  fixture.attempts=[{...fixture.attempts[0],mode:"main_calc",is_review_attempt:true,time_minutes:5}];
  const result=calculateExamReadinessMetrics(fixture);
  assert.equal(result.sampleSizes.timed,0);assert.equal(result.pastExamScoreRate,null);
});

const contract={gradedParts:[{id:"calc",label:"変換",rootCauseKey:"c1",fineConceptIds:["c1"]}]};
const failure=(id,p,date)=>attempt(id,p,date,{grading_contract:contract,grading_confidence:.95,
  graded_findings:[{graded_part_id:"calc",error_type:"W",resolved:false,evidence:"係数を落とした"}]});
const success=(id,p,date)=>attempt(id,p,date,{grading_contract:contract,grading_confidence:.95,
  mark:"○",score_numeric:85,error_type:"none",error_types:["none"],review_outcome:"success",
  graded_findings:[{graded_part_id:"calc",error_type:"none",resolved:true,evidence:"参照なしで係数を正しく再現"}]});
const source=failure(1,"PY-2021-Q1","2026-09-01");
const session={id:1,year:2021,date:"2026-09-01",session_kind:"scan_plus_one",linked_attempt_ids:[1]};
const analyze=(attempts,rec=record(),problems=[])=>analyzeConceptWeaknesses({record:rec,problems,attempts,reviews:[],weakNotes:[],today:"2026-09-09"});
test("same-problem successful reproduction is repair, not different-problem transfer",()=>{
  const rows=analyze([source,success(2,source.problem_id,"2026-09-03"),success(3,source.problem_id,"2026-09-05")]);
  assert.equal(rows[0].transferSuccesses,0);assert.equal(rows[0].state,"transfer_pending");
  const invalid={...source,graded_findings:source.graded_findings.map(f=>({...f,planning_eligible:false}))};
  const result=calculateExamReadinessMetrics({problems:[{...problem("PY-2022-Q1",null,"past_exam"),fine_concept_ids:["c1"]}],
    attempts:[invalid],pastSessions:[],aliases:[],today:"2026-09-09"});
  assert.equal(result.evidence.transfer.denominator,0,"an invalid finding must not create a transfer obligation");
});
test("repair success generates a different-problem transfer, not the resolved original repair",()=>{
  const attempts=[source,success(2,source.problem_id,"2026-09-03")];
  const rows=buildPastExamRepairCandidates({record:record(),sessions:[session],attempts,conceptWeaknesses:analyze(attempts),
    problems:[problem(source.problem_id,null,"past_exam"),problem("PY-2022-Q1",null,"past_exam")]});
  assert.equal(rows[0].repairKind,"transfer");
  assert.equal(rows[0].repairSuccessEvidenceId,2);
  assert.deepEqual(rows[0].transferProblemIds,["PY-2022-Q1"]);
});

test("a transfer candidate must cover the same root skills required for success",()=>{
  const both={gradedParts:[{...contract.gradedParts[0],fineConceptIds:["c1","additional_operation"]}]};
  const attempts=[{...source,grading_contract:both},{...success(2,source.problem_id,"2026-09-03"),grading_contract:both}];
  const rows=buildPastExamRepairCandidates({record:record(),sessions:[session],attempts,conceptWeaknesses:analyze(attempts),
    problems:[problem(source.problem_id,null,"past_exam"),problem("PY-2022-Q1",null,"past_exam")]});
  assert.equal(rows.some(row=>row.repairKind==="transfer"),false);
});
test("transfer requires relevant graded success, confidence and another problem; resolved transfer leaves no repair",()=>{
  const attempts=[source,success(2,source.problem_id,"2026-09-03"),success(3,"PY-2022-Q1","2026-09-05")];
  assert.equal(analyze(attempts)[0].transferSuccesses,1);
  assert.equal(buildPastExamRepairCandidates({record:record(),sessions:[session],attempts,conceptWeaknesses:analyze(attempts)}).length,0);
  assert.equal(analyze([source,{...attempts[2],grading_confidence:.4}])[0].transferSuccesses,0);
  assert.equal(analyze([source,{...attempts[2],actual_reference_level:1}])[0].transferSuccesses,0);
  assert.equal(analyze([source,{...attempts[2],graded_findings:[]}])[0].transferSuccesses,0);
  assert.equal(analyze([source,{...attempts[2],grading_confidence:900}])[0].transferSuccesses,0);
  assert.equal(analyze([source,{...attempts[2],actual_reference_level:undefined,reference_level:undefined}])[0].transferSuccesses,0);
});
test("WB is selected live from failed skill, without a static past-problem link",()=>{
  const wb={...problem("WB-4-A-01"),fine_concept_ids:["c1"]};
  const rows=buildPastExamRepairCandidates({record:record(),sessions:[session],attempts:[source],
    conceptWeaknesses:analyze([source]),problems:[wb]});
  assert.deepEqual(rows[0].whitebookProblemIds,[wb.problem_id]);assert.equal(rows[0].matchConfidence,"high");
  assert.deepEqual(rows[0].sourceFindingIds,["calc"]);assert.deepEqual(rows[0].matchedSkillIds,["c1"]);
});

test("partial Whitebook skill overlap cannot be high-confidence required repair",()=>{
  const both={...source,grading_contract:{gradedParts:[{...contract.gradedParts[0],fineConceptIds:["c1","c2"]}]}};
  const rows=buildPastExamRepairCandidates({record:record(),sessions:[session],attempts:[both],
    conceptWeaknesses:analyze([both]),problems:[{...problem("WB-4-A-01"),fine_concept_ids:["c1"]}]});
  assert.deepEqual(rows[0].whitebookProblemIds,[]);
  assert.equal(rows[0].repairKind,"concept_mini");
});

test("repair success without a verified transfer destination stays visible as an optional evidence gap",()=>{
  const both={gradedParts:[{...contract.gradedParts[0],fineConceptIds:["c1","missing_skill"]}]};
  const attempts=[{...source,grading_contract:both},{...success(2,source.problem_id,"2026-09-03"),grading_contract:both}];
  const rows=buildPastExamRepairCandidates({record:record(),sessions:[session],attempts,
    conceptWeaknesses:analyze(attempts),problems:[]});
  assert.equal(rows.length,1);
  assert.equal(rows[0].repairKind,"transfer_wait");
  assert.equal(rows[0].required,false);
  assert.match(rows[0].reason,/transfer候補なし/);
});
test("whole-problem theme is not proof that a particular finding failed every concept",()=>{
  const rec=record();rec.data.concepts.push({...rec.data.concepts[0],concept_id:"c2"});
  rec.data.pastExamProblems=[pastProblem(2021,1,["c1","c2"])];
  const rows=analyze([source],rec);
  assert.equal(rows.find(r=>r.conceptId==="c2").strongFailures,0);
});

test("repair-to-transfer candidate is actually materialized by the Planner with source provenance",()=>{
  const rec=record(),attempts=[source,success(2,source.problem_id,"2026-09-03")];
  const problems=[problem(source.problem_id,null,"past_exam"),problem("PY-2022-Q1",null,"past_exam")];
  const weaknesses=analyze(attempts),repairCandidates=buildPastExamRepairCandidates({record:rec,sessions:[session],attempts,
    conceptWeaknesses:weaknesses,problems});
  const plan=buildAdaptivePlannerShadow({record:rec,catalog:buildPastExamCatalog({record:rec,sessions:[session],attempts}),
    weaknesses,problems,attempts,reviews:[],pastSessions:[session],currentTasks:[],repairCandidates,
    today:"2026-09-09",examDate:"2026-11-15",targetMinutes:150});
  const transfer=plan.plan14.plan.flatMap(day=>day.tasks).find(t=>t.purpose==="transfer_check");
  assert.ok(transfer,"an eligible transfer must be executable, not only a candidate in diagnostics");
  assert.equal(transfer.problemId,"PY-2022-Q1");
  assert.equal(transfer.repairLineage.sourceAttemptId,1);
  assert.equal(transfer.repairLineage.repairSuccessEvidenceId,2);
});

test("chapter-only Whitebook falls back to mini repair; holdouts cannot be transfer candidates",()=>{
  const rec=record();rec.data.pastExamProblems.push(pastProblem(2024),pastProblem(2025));
  const rows=buildPastExamRepairCandidates({record:rec,sessions:[session],attempts:[source],
    conceptWeaknesses:analyze([source],rec),problems:[problem("WB-4-A-01",4)]});
  assert.equal(rows[0].repairKind,"concept_mini");assert.deepEqual(rows[0].whitebookProblemIds,[]);
  assert.equal(rows[0].transferProblemIds.some(id=>/202[45]/.test(id)),false);
});
