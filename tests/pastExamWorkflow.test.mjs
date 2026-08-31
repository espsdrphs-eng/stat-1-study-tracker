import test from "node:test";
import assert from "node:assert/strict";
import { buildScan5Prompt, deriveExposure, normalizePastExamSession, parseScan5Update, protectedUnseenYears, scanMetrics, selectionSuccessRate, sessionStudyMinutes, simulateScanPlan, stageForDays, validatePastExamSession } from "../src/pastExamWorkflow.ts";
import {reconcilePastExamSessionEvidence} from "../src/pastExamPlanning.ts";

test("selected_three_timed permits a pre-decision save before solving",()=>{
  const row=session("selected_three_timed");
  row.questions=row.questions.map(question=>({...question,completed:false,actualScore:null,actualMinutes:null}));
  row.actual_total_minutes=0;
  const result=validatePastExamSession(row);
  assert.equal(result.valid,true);
  assert.equal(result.examScoreEligible,false);
});

test("initial and final selections are stored separately",()=>{
  const row=normalizePastExamSession({session_kind:"scan_plus_one",questions:questions(),initial_selected_problem_ids:["PY-2024-Q1","PY-2024-Q2","PY-2024-Q3"],final_selected_problem_ids:["PY-2024-Q1","PY-2024-Q2","PY-2024-Q4"]});
  assert.equal(row.changed_selection,true);
  assert.deepEqual(row.initial_selected_problem_ids,["PY-2024-Q1","PY-2024-Q2","PY-2024-Q3"]);
  assert.deepEqual(row.final_selected_problem_ids,["PY-2024-Q1","PY-2024-Q2","PY-2024-Q4"]);
});

const questions=()=>Array.from({length:5},(_,i)=>({problemId:`PY-2024-Q${i+1}`,questionLabel:`問${i+1}`,predictedType:"尤度",firstStep:"尤度を書く",predictedScore:20-i,predictedMinutes:25+i,sinkRisk:i===4?"high":"low",selected:i<3,selectionReason:"得点可能",plannedOrder:i<3?i+1:null,actualScore:null,actualMinutes:null,typeJudgmentCorrect:null,firstStepCorrect:null,sank:null,hintUsed:false,referenceUsed:false,completed:false}));
const session=(kind="scan_only",patch={})=>normalizePastExamSession({session_kind:kind,date:"2026-07-22",year:2024,stage:"discrimination",scan_set_source:"past_exam_year",scan_minutes:10,questions:questions(),...patch});

test("scan_onlyはAttempt対象を持たず本番得点対象外",()=>{const result=validatePastExamSession(session());assert.equal(result.valid,true);assert.equal(result.solvedQuestions.length,0);assert.equal(result.examScoreEligible,false)});
test("scan_plus_oneは解いた1問だけを許可する",()=>{const rows=questions();rows[0].completed=true;rows[0].actualScore=18;const result=validatePastExamSession(session("scan_plus_one",{questions:rows}));assert.equal(result.valid,true);assert.equal(result.solvedQuestions.length,1);assert.equal(result.examScoreEligible,false)});
test("scan_plus_oneで2問解答は拒否する",()=>{const rows=questions();rows[0].completed=rows[1].completed=true;assert.match(validatePastExamSession(session("scan_plus_one",{questions:rows})).errors.join(" "),/1問/)});
test("selected_three_timedだけ条件を満たせば本番得点対象",()=>{const rows=questions();rows.slice(0,3).forEach(row=>{row.completed=true;row.actualScore=20;row.actualMinutes=30});const result=validatePastExamSession(session("selected_three_timed",{questions:rows,actual_total_minutes:90}));assert.equal(result.valid,true);assert.equal(result.examScoreEligible,true)});
test("未解答問題の得点はnullのまま",()=>{const row=session();assert.equal(row.questions[4].actualScore,null)});
test("選択が3問でなければ警告し予定90分超も拒否",()=>{const rows=questions();rows[2].selected=false;assert.match(validatePastExamSession(session("selected_three_timed",{questions:rows})).errors.join(" "),/3問/);rows[2].selected=true;rows.slice(0,3).forEach(row=>row.predictedMinutes=31);assert.match(validatePastExamSession(session("selected_three_timed",{questions:rows})).errors.join(" "),/90分/)});
test("全5問の比較根拠がなければ選題成功率はnull",()=>{assert.equal(selectionSuccessRate(session("scan_plus_one")),null);assert.equal(scanMetrics(session()).selectionSuccessRate,null)});
test("未評価を0へ変換しない",()=>{const metrics=scanMetrics(session());assert.equal(metrics.typeIdentificationAccuracy,null);assert.equal(metrics.firstStepAccuracy,null)});
test("スキャン後はunseenへ戻らず解答閲覧を保持する",()=>{assert.equal(deriveExposure({...session(),prompt_scanned_at:"2026-07-22T00:00:00Z"}),"prompt_scanned");assert.equal(deriveExposure({...session(),prompt_scanned_at:"2026-07-22T00:00:00Z",answer_viewed_at:"2026-07-23T00:00:00Z"}),"answer_exposed")});
test("unknown年度を未見推薦用の既知unseenとみなさず直近2年度を保護する",()=>{assert.deepEqual(protectedUnseenYears([], [2025,2024,2023],119),[2025,2024]);assert.deepEqual(protectedUnseenYears([], [2025,2024],30),[])});
test("scan_plus_oneと3問90分は時間を二重計上しない",()=>{const one={...session("scan_plus_one"),linked_attempt_ids:[8]};assert.equal(sessionStudyMinutes(one,[{id:8,time_minutes:30}]),40);const three={...session("selected_three_timed"),actual_total_minutes:90,linked_attempt_ids:[1,2,3]};assert.equal(sessionStudyMinutes(three,[{id:1,time_minutes:30},{id:2,time_minutes:30},{id:3,time_minutes:30}]),90)});
test("専用プロンプトはSTAT1-SCAN5-v1でK/W/N/Cを要求しない",()=>{const prompt=buildScan5Prompt({...session(),id:4},119);assert.match(prompt,/STAT1-SCAN5-v1/);assert.match(prompt,/K\/W\/N\/Cは出力しません/);assert.doesNotMatch(prompt,/STAT1-REVIEW-v9/)});
test("STAT1-SCAN5-v1結果を取り込める",()=>{const parsed=parseScan5Update('scan_update:\n  session_id: "4"\n  primary_selection_error: "none"\n  rubric_version: "STAT1-SCAN5-v1"');assert.equal(parsed.session_id,"4")});
test("smart quote付きscan_updateを互換正規化しconfidenceをcanonical化する",()=>{
  const parsed=parseScan5Update(`scan_update:\n  session_id: “3”\n  primary_selection_error: “type_misclassification”\n  candidate_review_problem_id: “PY-2018-Q3”\n  grading_confidence: 99\n  rubric_version: “STAT1-SCAN5-v1”`);
  assert.equal(parsed.session_id,"3");assert.equal(parsed.grading_confidence,.99);
  assert.ok(parsed.import_normalization_logs.some(row=>row.fieldName==="input_quotes"));
});
test("known scan fieldsのindent落ちは救済するが未知fieldは推測しない",()=>{
  const parsed=parseScan5Update(`scan_update:\nsession_id: "3"\nprimary_selection_error: "none"\ngrading_confidence: 0.99\nrubric_version: "STAT1-SCAN5-v1"`);
  assert.equal(parsed.session_id,"3");assert.ok(parsed.import_normalization_logs.some(row=>row.fieldName==="scan_update_indent"));
  assert.throws(()=>parseScan5Update(`scan_update:\nsession_id: "3"\nunknown: true\nprimary_selection_error: "none"\nrubric_version: "STAT1-SCAN5-v1"`),/未知の項目/);
});
test("rubric absent / unsupported / YAML parseを区別する",()=>{
  assert.throws(()=>parseScan5Update('scan_update:\n  session_id: "3"\n  primary_selection_error: "none"'),error=>error.stage==="rubric_absent");
  assert.throws(()=>parseScan5Update('scan_update:\n  session_id: "3"\n  primary_selection_error: "none"\n  rubric_version: "old"'),error=>error.stage==="rubric_unsupported");
  assert.throws(()=>parseScan5Update('scan_update: [}'),error=>error.stage==="yaml_parse");
});

test("2018 selected_three_timedへ翌日の5 Attemptを役割別に照合し90分sessionを完成する",()=>{
  const session2018=normalizePastExamSession({id:3,year:2018,date:"2026-08-30",session_kind:"selected_three_timed",
    scan_evidence_kind:"clean",scan_minutes:10,questions:Array.from({length:5},(_,index)=>({
      problemId:`PY-2018-Q${index+1}`,questionLabel:`問${index+1}`,selected:[0,2,4].includes(index),
      predictedScore:[60,20,80,0,60][index],predictedMinutes:20,completed:false,
    })),initial_selected_problem_ids:["PY-2018-Q1","PY-2018-Q3","PY-2018-Q5"]});
  const attempts=[[236,1,56,40],[237,3,50,20],[238,5,32,20],[239,2,24,15],[240,4,12,15]].map(([id,q,score,time])=>({
    id,problem_id:`PY-2018-Q${q}`,date:"2026-08-31",mode:"full",score_numeric:score,time_minutes:time,
    mark:"△",score_label:"C",error_type:"W",error_point:"",next_action:"",memo:"",actual_reference_level:0,
  }));
  const result=reconcilePastExamSessionEvidence(session2018,attempts,[2,3]);
  assert.equal(result.session_state,"completed");assert.equal(result.selected_answer_count,3);
  assert.deepEqual(result.selected_timed_attempt_ids,[236,237,238]);
  assert.deepEqual(result.counterfactual_calibration_attempt_ids,[239,240]);
  assert.equal(result.selected_solve_minutes,80);assert.equal(result.session_elapsed_minutes,90);assert.equal(result.actual_total_minutes,90);
  assert.equal(result.selection_success_count,3);assert.equal(result.selection_success_rate,1);
  assert.deepEqual(result.score_calibration.map(row=>row.error),[-4,4,-30,12,-28]);
  assert.equal(scanMetrics(result).predictedScoreDifference,-9);
  assert.equal(result.analysis_status,"not_started");assert.equal(result.questions.filter(row=>row.completed).length,3);
});
test("SCAN5プロンプトはprimary_selection_errorの正式enumと型認識不足の扱いを固定する",()=>{const prompt=buildScan5Prompt({...session(),id:4},119);assert.match(prompt,/primary_selection_errorは次の正式値から厳密に1つ/);assert.match(prompt,/problem.*type|type_misclassification/);assert.match(prompt,/問題型を部分的にしか認識できない/)});
test("primary_selection_errorの正式値は変換せず保存する",()=>{const parsed=parseScan5Update('scan_update:\n  session_id: 1\n  primary_selection_error: "time_underestimate"\n  rubric_version: "STAT1-SCAN5-v1"');assert.equal(parsed.primary_selection_error,"time_underestimate");assert.equal(parsed.import_normalization_logs.length,0)});
test("problem_type_underclassificationとtype_underclassificationを正式値へ正規化する",()=>{for(const value of ["problem_type_underclassification","type_underclassification"]){const parsed=parseScan5Update(`scan_update:\n  session_id: 1\n  primary_selection_error: "${value}"\n  rubric_version: "STAT1-SCAN5-v1"`);assert.equal(parsed.primary_selection_error,"type_misclassification");assert.equal(parsed.raw_primary_selection_error,value);assert.deepEqual(parsed.import_normalization_logs[0].normalizedValue,"type_misclassification")}});
test("time_overrunをtime_underestimateへ正規化する",()=>{const parsed=parseScan5Update('scan_update:\n  session_id: 1\n  primary_selection_error: "time_overrun"\n  rubric_version: "STAT1-SCAN5-v1"');assert.equal(parsed.primary_selection_error,"time_underestimate");assert.equal(parsed.import_normalization_logs[0].fieldName,"primary_selection_error")});
test("未知のprimary_selection_errorはnoneへ変換せず具体的に拒否する",()=>{assert.throws(()=>parseScan5Update('scan_update:\n  session_id: 1\n  primary_selection_error: "mystery_error"\n  rubric_version: "STAT1-SCAN5-v1"'),error=>{assert.match(error.message,/受信値：mystery_error/);assert.match(error.message,/使用可能な正式値/);return true})});
test("STAT1-SCAN5-v1以外は専用parserで拒否する",()=>{assert.throws(()=>parseScan5Update('scan_update:\n  session_id: 1\n  primary_selection_error: "none"\n  rubric_version: "STAT1-REVIEW-v9"'),/STAT1-SCAN5-v1/)});
test("残り119・90・60・30日で段階とsoft quotaが切り替わる",()=>{assert.equal(stageForDays(119),"discrimination");assert.equal(stageForDays(90),"calibration");assert.equal(stageForDays(30),"simulation");assert.equal(simulateScanPlan({startDate:"2026-07-22",daysRemaining:119}).mandatoryCount,0);assert.ok(simulateScanPlan({startDate:"2026-07-22",daysRemaining:119}).count<=5);assert.ok(simulateScanPlan({startDate:"2026-07-22",daysRemaining:60}).count>simulateScanPlan({startDate:"2026-07-22",daysRemaining:119}).count)});
