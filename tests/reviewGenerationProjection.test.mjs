import test from "node:test";
import assert from "node:assert/strict";
import {resolveSemanticReviewGeneration} from "../src/reviewGeneration.ts";
import {deriveCurrentTodayProjection} from "../src/currentTodayProjection.ts";
import {runIntegrityAudit} from "../src/integrityEngine.ts";

const problemId="WB-4-A-06";
const part={id:"first_step",label:"初手",cueLabel:"初手",allowedErrorTypes:["K","none"],
  completionCriterionId:"retain-first-step",stableTargetKey:`target:${problemId}:root:first-step`};
const contract=(reviewId,hash="gc-same",parts=[part])=>({
  contractId:`review:${reviewId}:1`,contractVersion:"STAT1-CONTRACT-v2",contractHash:hash,
  createdAt:"2026-08-18T07:44:00+09:00",problemId,sourceAttemptId:141,sourceReviewId:reviewId,
  learningPurpose:"retrieval_check",learningStage:"maintenance",mode:"check",reviewScope:"check_only",
  targetKind:"retrieval_item",targetedParts:parts.map(row=>row.label),gradedParts:parts,
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:"retain",displayText:"初手を再現"}],
  hiddenAnswerKey:[],completionConditions:["初手を再現"],requiredEvidence:["初手"],allowedErrorTypes:["K"],
  requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet",
});
const review=(id,status,grading=contract(id))=>({id,problem_id:problemId,due_date:"2026-08-18",review_type:"light_check",status,
  generated_from_attempt_id:141,source_attempt_id:141,logical_review_key:"same-logical-review",learning_purpose:"retrieval_check",
  assessment_timing:"delayed_retrieval",review_scope:"check_only",effective_mode:"check",allowed_reference_level:0,
  grading_contract:grading,contract_id:grading.contractId,contract_hash:grading.contractHash});
const sourceAttempt={id:141,problem_id:problemId,date:"2026-08-01",mode:"skeleton",time_minutes:10,mark:"○",score_label:"S",
  error_type:"none",error_types:["none"],error_point:"",next_action:"保持確認",memo:"",submission_id:"source-141",
  saved_at:"2026-08-01T10:00:00+09:00"};

test("semantic-equivalent Review generation is safely rebound while history stays terminal",()=>{
  const oldReview=review(395,"done"),currentReview=review(397,"pending");
  const update={problem_id:problemId,generated_from_review_id:395,source_review_id:395,
    contract_id:"review:395:1",contract_hash:"gc-same",contract_version:"STAT1-CONTRACT-v2",
    learning_purpose:"retrieval_check",mode:"check",review_scope:"check_only",target_kind:"retrieval_item",graded_part_ids:[part.id],
    actual_reference_level:0};
  const result=resolveSemanticReviewGeneration({update,reviews:[oldReview,currentReview],attempts:[sourceAttempt],today:"2026-08-18"});
  assert.equal(result.kind,"rebound");
  assert.equal(result.update.generated_from_review_id,397);
  assert.equal(result.update.contract_id,"review:397:1");
  assert.equal(oldReview.status,"done");
});

test("semantic rebind rejects a changed target set or contract hash",()=>{
  const oldReview=review(395,"done"),changedPart={...part,id:"critical_condition",stableTargetKey:`target:${problemId}:root:condition`};
  const currentReview=review(397,"pending",contract(397,"gc-changed",[changedPart]));
  const result=resolveSemanticReviewGeneration({update:{problem_id:problemId,generated_from_review_id:395,
    contract_id:"review:395:1",contract_hash:"gc-same",contract_version:"STAT1-CONTRACT-v2",learning_purpose:"retrieval_check",
    mode:"check",review_scope:"check_only",target_kind:"retrieval_item",graded_part_ids:[part.id]},reviews:[oldReview,currentReview],attempts:[sourceAttempt],today:"2026-08-18"});
  assert.equal(result.kind,"mismatch");
});

test("current Today adds a newly due Review without mutating the morning snapshot",()=>{
  const currentReview=review(397,"pending");
  const generatedTask={...currentReview,title:"A06",kind:"局所補修",reason:"期限到来",mode:"check",minutes:5,load:0,
    triage:"must",plan_origin:"adaptive_planner"};
  const oldTask={problem_id:"WB-5-A-20",title:"A20",kind:"得点形成",reason:"朝の計画",mode:"skeleton",minutes:25,
    load:1,triage:"must",plan_origin:"adaptive_planner",checked:false};
  const snapshot={date:"2026-08-18",task_ids:["problem:WB-5-A-20"],start_of_day_planned_minutes:25,
    initial_bucket:{"problem:WB-5-A-20":"must"},initial_estimated_minutes:{"problem:WB-5-A-20":25},
    tasks:[oldTask],created_at:"2026-08-18T05:57:00+09:00"};
  const before=JSON.stringify(snapshot);
  const current=deriveCurrentTodayProjection({snapshot,generatedTasks:[generatedTask],attempts:[sourceAttempt],
    reviews:[currentReview],today:"2026-08-18",completedMinutes:0,targetMinutes:150});
  assert.equal(current.tasks[0].id,397);
  assert.equal(current.currentTask?.id,397);
  assert.equal(JSON.stringify(snapshot),before);
});

test("audit treats a terminal Review in Current Today as active stale state",()=>{
  const terminal=review(395,"done"),task={...terminal,title:"A06",kind:"局所補修",reason:"朝の計画",
    mode:"check",minutes:5,load:0,triage:"must",checked:false};
  const snapshot={date:"2026-08-18",task_ids:["review:395"],start_of_day_planned_minutes:5,
    initial_bucket:{"review:395":"must"},initial_estimated_minutes:{"review:395":5},tasks:[task],
    created_at:"2026-08-18T05:57:00+09:00"};
  const audit=runIntegrityAudit({attempts:[sourceAttempt],reviews:[terminal],today:"2026-08-18",
    todayPlanSnapshots:[snapshot],currentTodayTasks:[task]});
  assert.equal(audit.counts.current_today_stale_review,1);
});

test("audit detects a formal active Review missing from Current Today",()=>{
  const current=review(397,"pending"),eligible={...current,title:"A06",kind:"局所補修",reason:"期限到来",
    mode:"check",minutes:5,load:0,triage:"must",checked:false};
  const snapshot={date:"2026-08-18",task_ids:[],start_of_day_planned_minutes:0,
    initial_bucket:{},initial_estimated_minutes:{},tasks:[],created_at:"2026-08-18T05:57:00+09:00"};
  const audit=runIntegrityAudit({attempts:[sourceAttempt],reviews:[current],today:"2026-08-18",
    todayPlanSnapshots:[snapshot],currentTodayTasks:[],eligibleTodayTasks:[eligible]});
  assert.equal(audit.counts.current_today_missing_active_review,1);
  assert.equal(audit.counts.formal_plan_current_projection_mismatch,1);
});

test("audit distinguishes missing-source descendants and safe stale-contract replacements",()=>{
  const orphan={...review(398,"pending"),source_attempt_id:999,generated_from_attempt_id:999,
    grading_contract:{...contract(398),sourceAttemptId:999}};
  const oldReview=review(395,"done"),currentReview=review(397,"pending");
  const update={problem_id:problemId,generated_from_review_id:395,source_review_id:395,
    contract_id:"review:395:1",contract_hash:"gc-same",contract_version:"STAT1-CONTRACT-v2",
    learning_purpose:"retrieval_check",mode:"check",review_scope:"check_only",target_kind:"retrieval_item",
    graded_part_ids:[part.id],actual_reference_level:0};
  const audit=runIntegrityAudit({attempts:[sourceAttempt],reviews:[oldReview,currentReview,orphan],today:"2026-08-18",
    pendingImportUpdates:[update]});
  assert.equal(audit.counts.deleted_attempt_active_descendant,1);
  assert.equal(audit.counts.stale_contract_equivalent_replacement,1);
});
