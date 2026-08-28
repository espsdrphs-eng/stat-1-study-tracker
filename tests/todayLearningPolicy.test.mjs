import test from "node:test";
import assert from "node:assert/strict";
import {reviewPlanningDecision,todayLearningCategory,whyToday} from "../src/todayLearningPolicy.ts";

const problem={id:1,problem_id:"WB-6-A-01",source_type:"whitebook",category:"A",chapter:6,problem_number:1,
  title:"A1",theme:"推定",priority:"core",role:"training",recommended_mode:"full",linked_past_exams:"",
  linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",fine_concept_ids:["c1"]};
const part={id:"legacy-part",label:"係数を保持",cueLabel:"係数",allowedErrorTypes:["W","none"],
  completionCriterionId:"criterion",stableTargetKey:"target:WB-6-A-01:root:stable"};
const contract=(purpose="retrieval_check")=>({contractId:"review:10:1",contractVersion:"STAT1-CONTRACT-v2",contractHash:"hash",
  createdAt:"2026-08-01",problemId:problem.problem_id,reviewId:10,sourceAttemptId:1,learningPurpose:purpose,
  learningStage:purpose==="error_repair"?"repair":"maintenance",mode:"check",reviewScope:"check_only",
  targetedParts:["係数"],gradedParts:[part],explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[],
  hiddenAnswerKey:[],completionConditions:["係数"],requiredEvidence:["係数"],allowedErrorTypes:["W"],requiresKEvidence:false,
  allowedReferenceLevel:0,estimatedMinutes:7,sheetType:"check_sheet"});
const review=(patch={})=>({id:10,problem_id:problem.problem_id,due_date:"2026-08-28",review_type:"light_check",status:"pending",
  generated_from_attempt_id:1,source_attempt_id:1,learning_purpose:"retrieval_check",grading_contract:contract(),...patch});
const weakness=(patch={})=>({conceptId:"c1",displayName:"係数追跡",state:"confirmed",independentOpportunities:2,
  independentFailures:1,failureRate:50,strongFailures:1,weakFailures:0,delayedNoReferenceSuccesses:0,transferSuccesses:0,
  distinctProblemCount:1,distinctFailureDateCount:1,recurrenceCount:0,examYearCount:2,examOccurrenceYearCount:2,
  pastExamFailureCount:0,pastExamFailureYearCount:0,recentExamYearCount:0,examImportance:50,weaknessScore:60,
  priorityScore:60,estimatedRepairMinutes:10,mappingConfidence:"verified",evidenceConfidence:"medium",
  nextRecommendedAction:"",latestEvidenceDate:"2026-08-01",evidenceSummary:[],...patch});

test("◎済み・transfer成功・再発なしの通常maintenanceは必須Todayへ入れない",()=>{
  const source={id:1,problem_id:problem.problem_id,date:"2026-08-01",mode:"check",mark:"◎",score_label:"S",score_numeric:100,
    error_type:"none",error_types:["none"],learning_purpose:"retrieval_check",assessment_timing:"delayed_retrieval",
    actual_reference_level:0,hint_used:false,target_issue_resolved:true,minimum_pass_condition_met:true,
    graded_part_ids:[part.id],graded_findings:[{graded_part_id:part.id,error_type:"none",evidence:"保持",resolved:true}]};
  const transfer={id:2,problem_id:"PY-2018-Q1",source_problem_id:problem.problem_id,date:"2026-08-20",mode:"full",mark:"◎",
    score_label:"A",score_numeric:80,error_type:"none",error_types:["none"],transfer_evidence:true,review_outcome:"success",
    actual_reference_level:0};
  const decision=reviewPlanningDecision({review:review(),attempts:[source,transfer],problems:[problem],
    weaknesses:[weakness({state:"resolved",transferSuccesses:1})]});
  assert.equal(decision.tier,"deferred_maintenance");
  assert.equal(decision.scheduleAsRequired,false);
});

test("past_exam major修復後でdelayed retention未確認なら補修として残す",()=>{
  const source={id:1,problem_id:problem.problem_id,date:"2026-08-20",mode:"full",mark:"○",score_label:"B",score_numeric:65,
    error_type:"W",error_types:["W"],parent_past_session_id:20,review_outcome:"success"};
  const decision=reviewPlanningDecision({review:review({correction_provided:true,retention_pending:true,
    generated_from_past_session_id:20}),attempts:[source],problems:[problem],weaknesses:[weakness({pastExamFailureCount:1})]});
  assert.equal(decision.tier,"high_value_repair");
  assert.equal(decision.scheduleAsRequired,true);
  assert.match(decision.reason,/過去問/);
});

test("別問題で同一Wが再発したcurrent targetは一般maintenanceへ落とさない",()=>{
  const source={id:1,problem_id:problem.problem_id,date:"2026-08-20",mode:"full",mark:"△",score_label:"B",score_numeric:55,
    error_type:"W",error_types:["W"]};
  const decision=reviewPlanningDecision({review:review(),attempts:[source],problems:[problem],
    weaknesses:[weakness({state:"relapsed",recurrenceCount:2,distinctProblemCount:3})]});
  assert.equal(decision.scheduleAsRequired,true);
});

test("Todayの表示分類は本番演習と補修の2本に集約する",()=>{
  const exam={problem_id:"PY-2018-Q1",kind:"90分演習",past_exam_task_type:"timed_three_question_session"};
  const repair={problem_id:problem.problem_id,kind:"局所補修",review_type:"main_calc_retry"};
  assert.equal(todayLearningCategory(exam),"exam_practice");
  assert.equal(todayLearningCategory(repair),"repair");
  assert.match(whyToday(exam),/初見|選題/);
  assert.match(whyToday(repair),/局所補修|再発/);
});
