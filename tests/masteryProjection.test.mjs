import test from "node:test";
import assert from "node:assert/strict";
import {deriveProblemMasteryState} from "../src/masteryProjection.ts";
import {materializeObservedOutOfScopeFindings} from "../src/outOfScopeObservations.ts";
import {parseStudyText} from "../src/importParser.ts";
import {buildReviewGradingPrompt} from "../src/gradingPrompt.ts";

const problemId="WB-5-A-14";
const part=(id,level)=>({id,label:id,cueLabel:id,allowedErrorTypes:["N","none"],completionCriterionId:`c-${id}`,
  stableTargetKey:`target:${problemId}:slot:${id}`,masteryLevel:level});
const contract=(purpose,parts,mode="check")=>({contractId:"review:1:1",contractVersion:"v",contractHash:"h",createdAt:"2026-08-18",
  problemId,learningPurpose:purpose,learningStage:purpose==="retrieval_check"?"maintenance":"repair",mode,
  reviewScope:purpose==="retrieval_check"?"check_only":"targeted_patch",targetedParts:parts.map(row=>row.label),gradedParts:parts,
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[],hiddenAnswerKey:[],completionConditions:[],
  requiredEvidence:[],allowedErrorTypes:["N"],requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet"});
const attempt=(id,parts,findings,overrides={})=>({id,problem_id:problemId,date:"2026-08-18",mode:"check",time_minutes:5,mark:"◎",
  score_label:"S",error_type:findings.some(row=>!row.resolved)?"N":"none",error_point:"",next_action:"",memo:"",
  error_types:findings.some(row=>!row.resolved)?["N"]:["none"],learning_purpose:"retrieval_check",learning_stage:"maintenance",
  assessment_timing:"delayed_retrieval",review_outcome:findings.some(row=>!row.resolved)?"partial":"success",
  target_issue_resolved:findings.every(row=>row.resolved),minimum_pass_condition_met:findings.every(row=>row.resolved),
  actual_reference_level:0,hint_used:false,graded_part_ids:parts.map(row=>row.id),graded_findings:findings,grading_contract:contract("retrieval_check",parts),...overrides});

test("in-scope skeleton success remains retained while an out-of-scope Level 2 major target repairs",()=>{
  const l1=part("first_step",1),l2=part("calculation_range",2);
  const retained=attempt(1,[l1],[{graded_part_id:l1.id,error_type:"none",evidence:"骨格を再現",resolved:true}]);
  const review={id:2,problem_id:problemId,due_date:"2026-08-18",review_type:"targeted_patch",status:"pending",generated_from_attempt_id:2,
    learning_purpose:"error_repair",grading_contract:contract("error_repair",[l2],"main_calc")};
  const result=deriveProblemMasteryState({problemId,attempts:[retained],reviews:[review]});
  assert.equal(result.levels[0].status,"retained");
  assert.equal(result.levels[1].status,"repairing");
  assert.equal(result.activeTargetCount,1);
});

test("partial delayed retention keeps three successful targets and repairs only one",()=>{
  const parts=[1,2,3,4].map(index=>part(`calc_${index}`,2));
  const findings=parts.map((row,index)=>({graded_part_id:row.id,error_type:index===3?"N":"none",evidence:`e${index}`,resolved:index!==3}));
  const partial=attempt(2,parts,findings);
  const repair={id:3,problem_id:problemId,due_date:"2026-08-18",review_type:"targeted_patch",status:"pending",generated_from_attempt_id:2,
    learning_purpose:"error_repair",grading_contract:contract("error_repair",[parts[3]],"main_calc")};
  const result=deriveProblemMasteryState({problemId,attempts:[partial],reviews:[repair]});
  assert.equal(result.levels[1].status,"repairing");
  assert.equal(result.levels[1].retainedTargetCount,3);
  assert.equal(result.levels[1].activeTargetCount,1);
});

test("Level 1 and 2 retained ends same-problem review while transfer remains independent",()=>{
  const l1=part("problem_type",1),l2=part("main_calculation",2);
  const l1Attempt=attempt(1,[l1],[{graded_part_id:l1.id,error_type:"none",evidence:"ok",resolved:true}]);
  const l2Attempt=attempt(2,[l2],[{graded_part_id:l2.id,error_type:"none",evidence:"ok",resolved:true}]);
  const before=deriveProblemMasteryState({problemId,attempts:[l1Attempt,l2Attempt],reviews:[]});
  assert.deepEqual(before.levels.map(row=>row.status),["retained","retained","unconfirmed"]);
  assert.equal(before.normalReviewComplete,true);
  const transfer=attempt(3,[],[],{problem_id:"WB-5-A-15",source_problem_id:problemId,transfer_evidence:true,
    learning_purpose:"transfer_check",assessment_timing:"independent_performance",review_outcome:"success",
    target_issue_resolved:true,minimum_pass_condition_met:true});
  const after=deriveProblemMasteryState({problemId,attempts:[l1Attempt,l2Attempt,transfer],reviews:[]});
  assert.equal(after.levels[2].status,"retained");
  assert.equal(after.normalReviewComplete,true);
});

test("a Level 1 collapse keeps evidence but marks upper mastered levels for recheck",()=>{
  const l2=part("main_calculation",2),l1=part("first_step",1);
  const retainedL2=attempt(1,[l2],[{graded_part_id:l2.id,error_type:"none",evidence:"ok",resolved:true}]);
  const repair={id:4,problem_id:problemId,due_date:"2026-08-18",review_type:"targeted_patch",status:"pending",generated_from_attempt_id:2,
    learning_purpose:"error_repair",grading_contract:contract("error_repair",[l1],"skeleton")};
  const result=deriveProblemMasteryState({problemId,attempts:[retainedL2],reviews:[repair]});
  assert.equal(result.levels[0].status,"repairing");
  assert.equal(result.levels[1].status,"needs_recheck");
  assert.equal(result.levels[1].retainedTargetCount,1);
  assert.equal(result.currentLevel,1);
});

test("only app-validated major high-confidence observations receive a new stable target",()=>{
  let issued=0;
  const rows=[
    {mastery_level:2,finding:"積分範囲が逆",evidence:"上限1と記載",materiality:"major",confidence:"high",create_target_candidate:true},
    {mastery_level:2,finding:"表記を改善",evidence:"添字が読みづらい",materiality:"minor",confidence:"high",create_target_candidate:true},
    {mastery_level:2,finding:"既存target",evidence:"既存根拠",materiality:"major",confidence:"high",create_target_candidate:true},
  ];
  const result=materializeObservedOutOfScopeFindings({rows,mode:"skeleton",currentPayloads:["既存target"],issueKey:()=>`root-${++issued}`});
  assert.equal(result[0].stable_target_key,"root-1");
  assert.equal(result[1].stable_target_key,undefined);
  assert.equal(result[2].stable_target_key,undefined);
  assert.equal(issued,1);
  assert.equal(materializeObservedOutOfScopeFindings({rows:[rows[0]],mode:"scan5",currentPayloads:[],issueKey:()=>"bad"})[0].stable_target_key,undefined);
});

test("review prompt and import keep in-scope grading separate from out-of-scope observation",()=>{
  const prompt=buildReviewGradingPrompt({reviewId:1,problemId,date:"2026-08-18",mode:"check",timeMinutes:5});
  assert.match(prompt,/observed_out_of_scope_findings/);
  assert.match(prompt,/今回のscore・mark・successへ影響させない/);
  const problems=[{problem_id:problemId,source_type:"whitebook",category:"A",chapter:5,problem_number:14,title:"x",theme:"変数変換",
    priority:"core",role:"score",recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active"}];
  const parsed=parseStudyText(`study_update:\n  problem_id: ${problemId}\n  date: 2026-08-18\n  mode: check\n  score_label: S\n  score_numeric: 100\n  error_types: [none]\n  primary_error_type: none\n  error_point: \"\"\n  next_action: \"\"\n  observed_out_of_scope_findings:\n    - mastery_level: 2\n      finding: 積分範囲が逆\n      evidence: 上限を1と書いた\n      materiality: major\n      confidence: high\n      create_target_candidate: true`,problems);
  assert.equal(parsed.updates[0].observed_out_of_scope_findings.length,1);
  assert.equal(parsed.updates[0].observed_out_of_scope_findings[0].mastery_level,2);
});
