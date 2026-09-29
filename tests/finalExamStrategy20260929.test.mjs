import test from "node:test";
import assert from "node:assert/strict";
import {pastProblem,record} from "./adaptiveFixture.mjs";
import {buildPastExamCatalog} from "../src/examReferencePack.ts";
import {buildPastExamYearCandidates,selectPastExamYear} from "../src/pastExamPlanning.ts";
import {deriveActionPriority,reviewPlanningDecision} from "../src/todayLearningPolicy.ts";
import {transferEvidenceStrength} from "../src/skillEvidence.ts";
import {buildAdaptivePlannerShadow} from "../src/adaptivePlanner.ts";

const rows=[2022,2024,2025].flatMap(year=>Array.from({length:5},(_,index)=>pastProblem(year,index+1)));
const source=record({data:{...record().data,pastExamProblems:rows}});
const completed=(year,date)=>({id:year,year,date,session_type:"scan5",session_kind:"selected_three_timed",
  session_purpose:"timed_three_question_session",simulation_completed_at:`${date}T12:00:00Z`,
  questions:[],scan_minutes:10});
const candidates=(today,sessions)=>buildPastExamYearCandidates({
  catalog:buildPastExamCatalog({record:source,sessions,attempts:[],exposureOverrides:{}}),
  attempts:[],pastSessions:sessions,today,daysRemaining:Math.round((Date.parse("2026-11-15")-Date.parse(today))/86400000)});

test("2022完了後の10月第2週は2024 benchmarkを選べるが2025 retestは保留",()=>{
  const available=candidates("2026-10-10",[completed(2022,"2026-10-02")]);
  assert.ok(available.some(row=>row.year===2024));
  assert.equal(available.some(row=>row.year===2025),false);
  assert.equal(selectPastExamYear({candidates:available,taskType:"timed_three_question_session"})?.year,2024);
});

test("2022選択答案のmajor Wは最小補修まで2024 benchmarkを保留する",()=>{
  const failed={id:801,problem_id:"PY-2022-Q1",date:"2026-10-02",mode:"timed",score_numeric:40,
    actual_reference_level:0,grading_confidence:.95,learning_purpose:"exam_performance",
    grading_contract:{gradedParts:[{id:"major_calculation",rootSkillIds:["moment_generating_function"],masteryLevel:2}]},
    graded_findings:[{graded_part_id:"major_calculation",error_type:"W",resolved:false,evidence:"主要計算が停止"}]};
  const repaired={...failed,id:802,date:"2026-10-04",learning_purpose:"error_repair",score_numeric:90,
    graded_findings:[{graded_part_id:"major_calculation",error_type:"none",resolved:true,evidence:"参照なしで主要計算を再現"}]};
  const sessions=[{...completed(2022,"2026-10-02"),selected_timed_attempt_ids:[801]}];
  const available=attempts=>buildPastExamYearCandidates({catalog:buildPastExamCatalog({record:source,sessions,attempts,exposureOverrides:{}}),
    attempts,pastSessions:sessions,today:"2026-10-10",daysRemaining:36});
  assert.equal(available([failed]).some(row=>row.year===2024),false);
  assert.equal(available([failed,repaired]).some(row=>row.year===2024),true);
});

test("2025 historical retestは2024終了と追加本番証拠の後だけ選ぶ",()=>{
  const first=[completed(2022,"2026-10-02"),completed(2024,"2026-10-12")];
  assert.equal(candidates("2026-10-25",first).some(row=>row.year===2025),false);
  const ready=candidates("2026-10-25",[...first,completed(2023,"2026-10-20")]);
  assert.equal(selectPastExamYear({candidates:ready,taskType:"simulation"})?.year,2025);
});

test("過去問sessionは古い保持確認より先。真のhard blockerだけ先に置く",()=>{
  const today="2026-09-29";
  const exam={problem_id:"PY-2022-Q1",past_exam_task_type:"timed_three_question_session",triage:"must"};
  const old={id:506,problem_id:"WB-5-A-21",review_type:"light_check",learning_purpose:"retrieval_check",
    review_planning_tier:"high_value_repair",latest_date:"2026-09-12",triage:"must",hard_blocker:false};
  assert.ok(deriveActionPriority(exam,today)<deriveActionPriority(old,today));
  assert.ok(deriveActionPriority({...old,hard_blocker:true},today)<deriveActionPriority(exam,today));
});

test("Whitebookの古いretrievalは成功証拠があっても本番由来high matchなしでは任意",()=>{
  const sourceAttempt={id:211,problem_id:"WB-5-A-21",date:"2026-08-22",mode:"check",score_numeric:100,
    mark:"○",error_type:"none",error_types:["none"],learning_purpose:"error_repair",
    review_outcome:"success",actual_reference_level:0,grading_confidence:.99,
    minimum_pass_condition_met:true,target_issue_resolved:true};
  const review={id:506,problem_id:"WB-5-A-21",status:"pending",due_date:"2026-09-05",
    learning_purpose:"retrieval_check",source_attempt_id:211,lifecycle_success_evidence_id:"attempt:211",
    grading_contract:{learningPurpose:"retrieval_check",sourceAttemptId:211,gradedParts:[{id:"target"}]}};
  const decision=reviewPlanningDecision({review,attempts:[sourceAttempt],problems:[{problem_id:"WB-5-A-21",source_type:"whitebook"}],
    weaknesses:[],pastExamIsPrimary:true,repairCandidates:[]});
  assert.equal(decision.scheduleAsRequired,false);
});

test("2025の既習答案は自然な初見strong transferに分類しない",()=>{
  assert.equal(transferEvidenceStrength({problem_id:"PY-2025-Q1",source_type:"past_exam",mode:"full",
    actual_reference_level:0}),"training");
});

test("30日forecastは各日のphaseで2024を解放し、早すぎる2025を置かない",()=>{
  const sessions=[completed(2022,"2026-09-28")];
  const catalog=buildPastExamCatalog({record:source,sessions,attempts:[],exposureOverrides:{}});
  const plan=buildAdaptivePlannerShadow({record:source,catalog,weaknesses:[],problems:[],attempts:[],reviews:[],
    pastSessions:sessions,currentTasks:[],today:"2026-09-29",examDate:"2026-11-15",targetMinutes:150});
  const future=plan.plan30.plan.flatMap(day=>day.tasks.map(task=>({date:day.date,task})));
  assert.ok(future.some(row=>row.task.pastExamYear===2024&&row.date>="2026-10-07"));
  assert.ok(!future.some(row=>row.task.pastExamYear===2024&&row.date<"2026-10-07"));
  assert.ok(!future.some(row=>row.task.pastExamYear===2025));
});
