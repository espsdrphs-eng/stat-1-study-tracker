import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptFingerprint, bindContractToReview, classifyExactDuplicateAttempts, contractIdForReview,
  logicalReviewKey, reviewExecutionMessage, reviewExecutionState, runIntegrityAudit,
  selectCurrentReviewsForProblem,
} from "../src/integrityEngine.ts";

const attempt=(id,patch={})=>({
  id,problem_id:"WB-4-A-24",date:"2026-07-26",mode:"check",time_minutes:5,mark:"◎",
  score_label:"A",error_type:"none",error_point:"",next_action:"",memo:"",
  error_types:["none"],primary_error_type:"none",...patch,
});
const contract=(problemId="WB-4-A-24",partId="critical_condition")=>({
  contractId:"review:pending:fixture",contractVersion:"STAT1-CONTRACT-v2",contractHash:`gc-${partId}`,
  createdAt:"2026-07-26T00:00:00Z",problemId,sourceAttemptId:1,
  learningPurpose:"retrieval_check",learningStage:"maintenance",mode:"check",reviewScope:"check_only",
  targetedParts:[],gradedParts:[{id:partId,label:"注意点",cueLabel:"注意点",allowedErrorTypes:["N","C","none"],completionCriterionId:"recall"}],
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:"recall",displayText:"短く想起"}],
  hiddenAnswerKey:[],completionConditions:["短く想起"],requiredEvidence:["注意点"],allowedErrorTypes:["N","C"],
  requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet",
});
const review=(id,sourceAttemptId=1,patch={})=>{
  const gradingContract=bindContractToReview(contract(),id,1);
  return {
    id,problem_id:"WB-4-A-24",due_date:"2026-07-28",review_type:"light_check",status:"pending",
    generated_from_attempt_id:sourceAttemptId,source_attempt_id:sourceAttemptId,interval_days:2,
    source_date:"2026-07-26",review_after_days:2,schedule_origin:"policy",policy_version:"STAT1-CONTRACT-v2",
    learning_purpose:"retrieval_check",assessment_timing:"delayed_retrieval",effective_mode:"check",
    review_scope:"check_only",sheet_type:"check_sheet",graded_part_ids:["critical_condition"],
    grading_contract:gradingContract,contract_id:gradingContract.contractId,
    contract_version:gradingContract.contractVersion,contract_hash:gradingContract.contractHash,...patch,
  };
};

test("exact duplicate Attempts are detected without deleting either row",()=>{
  const first=attempt(73),second=attempt(74);
  assert.equal(attemptFingerprint(first),attemptFingerprint(second));
  assert.deepEqual(classifyExactDuplicateAttempts([first,second]),[{
    fingerprint:attemptFingerprint(first),canonicalAttemptId:73,duplicateAttemptId:74,
  }]);
});

test("duplicate classification metadata does not change content fingerprint, but an intentional submission does",()=>{
  const first=attempt(73,{canonical_attempt_id:73});
  const second=attempt(74,{duplicate_of_attempt_id:73,exclude_from_metrics:true});
  assert.equal(attemptFingerprint(first),attemptFingerprint(second));
  assert.notEqual(attemptFingerprint({...first,submission_id:"one"}),attemptFingerprint({...first,submission_id:"two"}));
});

test("logical Review key is stable and includes canonical Attempt identity",()=>{
  const source=attempt(10,{canonical_attempt_id:10,submission_id:"submission-1"});
  const a=review(277,10),b=review(278,10,{contract_id:"other"});
  assert.equal(logicalReviewKey({review:a,sourceAttempt:source}),logicalReviewKey({review:b,sourceAttempt:source}));
  assert.notEqual(logicalReviewKey({review:a,sourceAttempt:source}),
    logicalReviewKey({review:a,sourceAttempt:{...source,submission_id:"submission-2"}}));
});

test("contractId is unique per persisted Review while contractHash may be equal",()=>{
  const content=contract();
  const left=bindContractToReview(content,277,1),right=bindContractToReview(content,278,1);
  assert.equal(left.contractHash,right.contractHash);
  assert.equal(left.contractId,contractIdForReview(277,1));
  assert.notEqual(left.contractId,right.contractId);
});

test("done, superseded, invalid and expired same-session Reviews are not actionable",()=>{
  assert.equal(reviewExecutionState(review(1,1,{status:"done"}),"2026-07-26"),"completed");
  assert.equal(reviewExecutionState(review(2,1,{status:"superseded"}),"2026-07-26"),"superseded");
  assert.equal(reviewExecutionState(review(3,1,{policy_validity:"invalid_legacy_k"}),"2026-07-26"),"invalid");
  assert.equal(reviewExecutionState(review(4,1,{assessment_timing:"same_session_correction",due_date:"2026-07-25"}),"2026-07-26"),"expired_same_session");
});

test("problem current Review selection never substitutes terminal history",()=>{
  const superseded=review(209,1,{problem_id:"WB-6-S-21",status:"superseded",policy_validity:"invalid_legacy_k",exclude_from_planning:true});
  const none=selectCurrentReviewsForProblem({reviews:[superseded],problemId:"WB-6-S-21",today:"2026-07-29"});
  assert.deepEqual(none.current,[]);
  assert.deepEqual(none.history.map(row=>[row.review.id,row.state]),[[209,"superseded"]]);
  assert.match(reviewExecutionMessage(none.history[0].state,superseded),/終了しました/);
});

test("active Review wins over superseded history for the same canonical problem",()=>{
  const old=review(220,1,{problem_id:"WB-6-S-22",status:"superseded",policy_validity:"invalid_legacy_k",exclude_from_planning:true});
  const current=review(231,1,{problem_id:"WB-6-S-22",due_date:"2026-07-28"});
  const selection=selectCurrentReviewsForProblem({reviews:[old,current],problemId:"WB-6-S-22",today:"2026-07-29"});
  assert.deepEqual(selection.current.map(row=>row.id),[231]);
  assert.deepEqual(selection.history.map(row=>row.review.id),[220]);
});

test("different-purpose actionable Reviews for one problem are all retained",()=>{
  const repair=review(249,1,{problem_id:"WB-6-A-20",learning_purpose:"error_repair",
    grading_contract:{...review(249).grading_contract,contractId:"review:249:1",learningPurpose:"error_repair"}});
  const retrieval=review(250,1,{problem_id:"WB-6-A-20",learning_purpose:"retrieval_check",
    grading_contract:{...review(250).grading_contract,contractId:"review:250:1",learningPurpose:"retrieval_check"}});
  const selection=selectCurrentReviewsForProblem({reviews:[retrieval,repair],problemId:"WB-6-A-20",today:"2026-07-29"});
  assert.deepEqual(selection.current.map(row=>row.id),[249,250]);
});

test("done, invalid, needs-review and expired rows stay out of current selection",()=>{
  const rows=[
    review(1,1,{status:"done"}),review(2,1,{policy_validity:"invalid_legacy_k"}),
    review(3,1,{status:"review_needed"}),review(4,1,{assessment_timing:"same_session_correction",due_date:"2026-07-28"}),
  ];
  const selection=selectCurrentReviewsForProblem({reviews:rows,problemId:"WB-4-A-24",today:"2026-07-29"});
  assert.equal(selection.current.length,0);
  assert.deepEqual(new Set(selection.history.map(row=>row.state)),
    new Set(["completed","invalid","needs_review","expired_same_session"]));
});

test("one audit detects duplicate logical key, contract id, dedup key, expiry and stale snapshot",()=>{
  const source=attempt(1);
  const shared="review:277:1";
  const rows=[
    review(277,1,{contract_id:shared,grading_contract:{...contract(),contractId:shared},deduplication_key:"same"}),
    review(278,1,{contract_id:shared,grading_contract:{...contract(),contractId:shared},deduplication_key:"same"}),
    review(238,1,{assessment_timing:"same_session_correction",due_date:"2026-07-25"}),
  ];
  const snapshot={date:"2026-07-26",task_ids:["review:999"],start_of_day_planned_minutes:5,
    initial_bucket:{"review:999":"must"},initial_estimated_minutes:{"review:999":5},
    tasks:[{id:999,problem_id:"WB-4-A-24",title:"fixture",kind:"review",reason:"fixture",mode:"check",minutes:5,load:.2,review_type:"light_check"}],
    created_at:"fixture"};
  const audit=runIntegrityAudit({attempts:[source],reviews:rows,today:"2026-07-26",todayPlanSnapshots:[snapshot]});
  assert.equal(audit.counts.duplicate_logical_review,1);
  assert.equal(audit.counts.duplicate_contract_id,1);
  assert.equal(audit.counts.repeated_deduplication_key,1);
  assert.equal(audit.counts.expired_same_session,1);
  assert.equal(audit.counts.stale_today_snapshot,1);
});

test("manual date is preserved but policy date mismatch is diagnosed",()=>{
  const source=attempt(1,{date:"2026-07-24"});
  const manual=review(1,1,{due_date:"2026-07-30",schedule_origin:"manual"});
  const policy=review(2,1,{due_date:"2026-07-27",schedule_origin:"policy"});
  const audit=runIntegrityAudit({attempts:[source],reviews:[manual,policy],today:"2026-07-26"});
  assert.equal(audit.counts.date_interval_mismatch,1);
});

test("changing a problem-specific label keeps the persisted part id",()=>{
  const original=contract("WB-4-A-24","part:WB-4-A-24:101:1");
  const renamed={...original,gradedParts:[{...original.gradedParts[0],label:"更新した表示名"}]};
  assert.equal(original.gradedParts[0].id,renamed.gradedParts[0].id);
});

test("a non-hydratable current target keeps System status non-normal without mislabelling snapshot history",()=>{
  const source=attempt(1),old=review(10,1,{status:"superseded"});
  const ambiguousContract={...contract(),gradedParts:[{...contract().gradedParts[0],id:"part:WB-4-A-24:999:1"}]};
  const current=review(11,1,{grading_contract:ambiguousContract,contract_id:ambiguousContract.contractId,
    contract_hash:ambiguousContract.contractHash,graded_part_ids:["part:WB-4-A-24:999:1"]});
  const snapshot={date:"2026-07-26",task_ids:["review:10"],start_of_day_planned_minutes:5,
    initial_bucket:{"review:10":"must"},initial_estimated_minutes:{"review:10":5},created_at:"fixture",
    tasks:[{id:10,problem_id:"WB-4-A-24",title:"old",kind:"review",reason:"old",mode:"check",minutes:5,
      load:.2,review_type:"light_check",grading_contract:old.grading_contract}]};
  const audit=runIntegrityAudit({attempts:[source],reviews:[old,current],today:"2026-07-26",todayPlanSnapshots:[snapshot]});
  assert.equal(audit.counts.obsolete_today_action,0);
  assert.equal(audit.counts.orphan_active_target>0,true);
  assert.equal(audit.activeIssueCount>0,true);
});

test("Attempt-dependent stable keys are retained only as explicit history warnings",()=>{
  const source=attempt(1);
  source.grading_contract={...contract(),gradedParts:[{
    ...contract().gradedParts[0],
    stableTargetKey:"target:WB-4-A-24:attempt:1:slot:1",
  }]};
  const audit=runIntegrityAudit({attempts:[source],reviews:[],today:"2026-07-26"});
  const warning=audit.issues.find(issue=>issue.category==="invalid_stable_target_key"&&issue.attemptIds?.includes(1));
  assert.equal(warning?.severity,"history");
  assert.equal(audit.activeIssueCount,0);
});

test("exact duplicate active target labels are a sanity warning and never an identity merge rule",()=>{
  const source=attempt(1);
  const duplicateLabelContract={...contract(),gradedParts:[
    {...contract().gradedParts[0],id:"part:WB-4-A-24:1:1",label:"same label",
      stableTargetKey:"target:WB-4-A-24:root:00000000-0000-4000-8000-000000000001"},
    {...contract().gradedParts[0],id:"part:WB-4-A-24:1:2",label:"same label",
      stableTargetKey:"target:WB-4-A-24:root:00000000-0000-4000-8000-000000000002"},
  ]};
  const row=review(12,1,{grading_contract:duplicateLabelContract,contract_id:duplicateLabelContract.contractId,
    contract_hash:duplicateLabelContract.contractHash,graded_part_ids:duplicateLabelContract.gradedParts.map(part=>part.id)});
  const audit=runIntegrityAudit({attempts:[source],reviews:[row],today:"2026-07-26"});
  assert.equal(audit.counts.duplicate_active_target_label,1);
  assert.equal(audit.counts.duplicate_stable_target,0);
});

test("stale current payload keeps System status non-normal even when stable key matches",()=>{
  const stableTargetKey="target:WB-4-A-24:root:00000000-0000-4000-8000-000000000099";
  const currentPart={...contract().gradedParts[0],id:"part:WB-4-A-24:1:1",label:"古い広範囲エラー",stableTargetKey};
  const source=attempt(1,{error_type:"N",error_types:["N"],graded_part_ids:[currentPart.id],
    graded_parts:[currentPart.label],graded_findings:[{graded_part_id:currentPart.id,error_type:"N",
      evidence:"最新の局所エラー",resolved:false}],grading_contract:{...contract(),gradedParts:[currentPart]}});
  const grading={...contract(),learningPurpose:"error_repair",learningStage:"repair",reviewScope:"targeted_patch",
    targetedParts:[currentPart.label],requiredEvidence:[currentPart.label],gradedParts:[currentPart],
    completionConditions:["指定された1点を再現できた"]};
  const row=review(12,1,{learning_purpose:"error_repair",review_scope:"targeted_patch",
    targeted_parts:[currentPart.label],graded_parts:[currentPart.label],required_evidence:[currentPart.label],
    grading_contract:grading,contract_id:grading.contractId,contract_hash:grading.contractHash,
    graded_part_ids:[currentPart.id]});
  const audit=runIntegrityAudit({attempts:[source],reviews:[row],today:"2026-07-26"});
  assert.equal(audit.counts.stale_target_payload,1);
  assert.equal(audit.activeIssueCount>0,true);
});

test("stale one-line hint and truncated actions keep System status non-normal",()=>{
  const stableTargetKey="target:WB-4-A-24:root:00000000-0000-4000-8000-000000000100";
  const parts=[1,2,3,4].map(index=>({...contract().gradedParts[0],id:`slot-${index}`,label:`latest-${index}`,
    stableTargetKey:`${stableTargetKey.slice(0,-3)}${String(100+index).padStart(3,"0")}`}));
  const grading={...contract(),learningPurpose:"error_repair",learningStage:"repair",reviewScope:"targeted_patch",
    targetedParts:parts.map(part=>part.label),requiredEvidence:parts.map(part=>part.label),gradedParts:parts,
    completionConditions:["指定された4点を再現できた"]};
  const source=attempt(1,{error_type:"N",error_types:["N"],graded_part_ids:parts.map(part=>part.id),
    graded_parts:parts.map(part=>part.label),graded_findings:parts.map(part=>({graded_part_id:part.id,error_type:"N",
      evidence:part.label,resolved:false})),grading_contract:grading});
  const row=review(13,1,{learning_purpose:"error_repair",review_scope:"targeted_patch",
    targeted_parts:grading.targetedParts,graded_parts:grading.targetedParts,required_evidence:grading.targetedParts,
    grading_contract:grading,contract_id:grading.contractId,contract_hash:grading.contractHash,
    graded_part_ids:parts.map(part=>part.id),derived_fields:{oneLineHint:{value:"PITだけを確認"},
      todayActions:{value:["latest-1","latest-2","latest-3"]}}});
  const audit=runIntegrityAudit({attempts:[source],reviews:[row],today:"2026-07-26"});
  assert.equal(audit.counts.current_target_display_mismatch,1);
  assert.equal(audit.activeIssueCount>0,true);
});

test("planner audit detects duplicate problem tasks, window violations, and optional-before-urgent",()=>{
  const generic={problem_id:"WB-7-A-07",title:"generic",kind:"score",reason:"score",mode:"skeleton",minutes:25,load:1,
    triage:"must",checked:false};
  const reviewTask={id:384,problem_id:"WB-7-A-07",title:"review",kind:"review",reason:"review",mode:"main_calc",
    minutes:12,load:.4,triage:"must",checked:false,review_type:"main_calc_retry"};
  const snapshot={date:"2026-08-14",task_ids:[],start_of_day_planned_minutes:37,initial_bucket:{},
    initial_estimated_minutes:{},tasks:[generic],created_at:"2026-08-14T00:00:00Z"};
  const summary={days:1,plan:[],totalMinutes:0,counts:{scoreBuilding:0,repair:0,maintenance:0,scan5:0,full:0,timed:0,
    pastExam:0,chapter5:0,chapter7:0,chapter8:0},weeklyMinimumViolations:[],dailyCapacityViolations:0,
    reviewSchedule:{repairBudgetMinutes:45,placements:[{reviewId:384,problemId:"WB-7-A-07",date:"2026-08-17",
      latestDate:"2026-08-16",status:"within_window"}],capacityConflicts:[{reviewId:385,problemId:"WB-7-A-08",
      earliestDate:"2026-08-13",preferredDate:"2026-08-14",latestDate:"2026-08-14",minutes:12,reason:"capacity"}]}};
  const audit=runIntegrityAudit({attempts:[],reviews:[],today:"2026-08-14",todayPlanSnapshots:[snapshot],
    currentTodayTasks:[generic,reviewTask],currentPlanSummary:summary,
    additionalCandidates:[{candidateKey:"extra",source:"adaptive",priority:1,purposeLabel:"extra",reason:"extra",minutes:20,task:generic}]});
  assert.equal(audit.counts.duplicate_problem_task,1);
  assert.equal(audit.counts.review_window_violation,1);
  assert.equal(audit.counts.overdue_starvation,1);
  assert.equal(audit.counts.optional_extra_priority_violation,1);
});

test("planner audit detects eligible past-exam false negatives and never counts material confirmation as exam study",()=>{
  const warning={taskKey:"warning",date:"2026-08-20",slot:"maintenance_selection",kind:"exposure_confirmation",
    label:"過去問素材の露出状態を確認",minutes:10,reason:"missing",requiresUserSelection:true};
  const plan=Array.from({length:7},(_,index)=>({date:`2026-08-${20+index}`,tasks:index===0?[warning]:[],
    totalMinutes:index===0?10:0}));
  const summary={days:7,plan,totalMinutes:10,counts:{scoreBuilding:0,repair:0,maintenance:1,scan5:0,full:0,timed:0,
    pastExam:0,chapter5:0,chapter7:0,chapter8:0},weeklyMinimumViolations:[],dailyCapacityViolations:0,
    reviewSchedule:{repairBudgetMinutes:0,placements:[],capacityConflicts:[]}};
  const catalog=[{referenceProblemId:"PE-2016-Q01",canonicalProblemId:"PY-2016-Q1",year:2016,questionNumber:1,
    title:"2016年問1",availability:"verified_problem",schedulable:true,gradable:true,fineConceptIds:[],coarseTopics:[],
    exposure:"unseen",simulationProtected:false,classificationConfidence:"verified"}];
  const audit=runIntegrityAudit({attempts:[],reviews:[],today:"2026-08-20",examDate:"2026-11-15",
    currentPlanSummary:summary,pastExamCatalog:catalog});
  assert.equal(audit.counts.eligible_past_exam_but_confirmation_scheduled,1);
  assert.equal(audit.counts.past_exam_candidate_false_negative,1);
  assert.equal(audit.counts.current_plan_zero_past_exam_when_phase_requires,1);
  assert.equal(audit.counts.past_exam_share_counted_from_non_exam_task,1);
  assert.ok(audit.activeIssueCount>=4);
});

test("planner audit rejects one-problem 90-minute work and skipping an older clean year",()=>{
  const task={taskKey:"bad",date:"2026-08-27",slot:"score_building",kind:"timed",label:"2019年問1",
    referenceProblemId:"PE-2019-Q01",problemId:"PY-2019-Q1",minutes:90,reason:"3問90分",requiresUserSelection:false,
    pastExamYear:2019};
  const plan=Array.from({length:7},(_,index)=>({date:`2026-08-${27+index}`,tasks:index===0?[task]:[],totalMinutes:index===0?90:0}));
  const summary={days:7,plan,totalMinutes:90,counts:{scoreBuilding:1,repair:0,maintenance:0,scan5:0,full:0,timed:1,
    pastExam:1,chapter5:0,chapter7:0,chapter8:0},weeklyMinimumViolations:[],dailyCapacityViolations:0,
    reviewSchedule:{repairBudgetMinutes:0,placements:[],capacityConflicts:[]}};
  const catalog=[2018,2019].flatMap(year=>Array.from({length:5},(_,index)=>({referenceProblemId:`PE-${year}-Q0${index+1}`,
    canonicalProblemId:`PY-${year}-Q${index+1}`,year,questionNumber:index+1,title:"past",availability:"verified_problem",
    schedulable:true,gradable:true,fineConceptIds:[],coarseTopics:[],exposure:"unseen",simulationProtected:false,
    classificationConfidence:"verified"})));
  const audit=runIntegrityAudit({attempts:[],reviews:[],today:"2026-08-27",examDate:"2026-11-15",
    currentPlanSummary:summary,pastExamCatalog:catalog});
  assert.equal(audit.counts.single_problem_ninety_minute_session,1);
  assert.equal(audit.counts.clean_scan_year_skipped,1);
});
