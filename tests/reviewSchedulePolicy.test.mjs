import test from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,auditReviewSchedules,differenceInCalendarDays,
  pendingReviewIdentityKey,resolveReviewSchedule
} from "../src/reviewSchedulePolicy.ts";

const attempt=(id,problem_id,date)=>({
  id,problem_id,date,mode:"check",time_minutes:5,mark:"○",score_label:"A",
  error_type:"N",error_types:["N"],primary_error_type:"N",error_point:"説明不足",next_action:"再現",memo:""
});

const contract=(partIds=["part_a"],purpose="error_repair")=>({
  contractId:"contract",contractVersion:"v1",contractHash:"hash",createdAt:"2026-07-24T00:00:00Z",
  problemId:"WB-4-A-29",learningPurpose:purpose,learningStage:"repair",mode:"check",
  reviewScope:"targeted_patch",targetKind:"mathematical_patch",targetedParts:partIds,
  gradedParts:partIds.map(id=>({id,label:id,cueLabel:id,allowedErrorTypes:["N","none"],completionCriterionId:`do_${id}`})),
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],
  completionCriteria:partIds.map(id=>({id:`do_${id}`,displayText:id})),hiddenAnswerKey:[],
  completionConditions:["再現する"],requiredEvidence:[],allowedErrorTypes:["N","none"],requiresKEvidence:false,
  allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet"
});

const review=(id,problemId,sourceAttemptId,dueDate,parts=["part_a"],patch={})=>({
  id,problem_id:problemId,due_date:dueDate,review_type:"targeted_patch",status:"pending",
  generated_from_attempt_id:sourceAttemptId,source_attempt_id:sourceAttemptId,interval_days:2,
  learning_purpose:"error_repair",effective_mode:"check",review_scope:"targeted_patch",
  graded_part_ids:parts,grading_contract:{...contract(parts),problemId},policy_version:"policy-v1",
  ...patch
});

test("calendar day arithmetic never crosses a JST/UTC boundary",()=>{
  assert.equal(addCalendarDays("2026-07-24",2),"2026-07-26");
  assert.equal(addCalendarDays("2026-07-20",2),"2026-07-22");
  assert.equal(addCalendarDays("2026-07-19",2),"2026-07-21");
  assert.equal(addCalendarDays("2024-02-28",1),"2024-02-29");
  assert.equal(addCalendarDays("2024-02-29",1),"2024-03-01");
  assert.equal(addCalendarDays("2026-01-01",-1),"2025-12-31");
  assert.equal(differenceInCalendarDays("2026-07-26","2026-07-24"),2);
});

test("policy schedule uses source date and interval as one prescription",()=>{
  const source=attempt(1,"WB-4-A-29","2026-07-24");
  const schedule=resolveReviewSchedule(review(10,"WB-4-A-29",1,"2026-07-27"),source);
  assert.equal(schedule.expectedReviewDate,"2026-07-26");
  assert.equal(schedule.mismatch,true);
  assert.equal(schedule.scheduleOrigin,"policy");
});

test("manual date is preserved and is not classified as an error",()=>{
  const source=attempt(1,"WB-4-A-29","2026-07-24");
  const schedule=resolveReviewSchedule(review(10,"WB-4-A-29",1,"2026-08-01",["part_a"],{
    schedule_origin:"manual",postponed_at:"2026-07-25T00:00:00Z",postponed_to:"2026-08-01"
  }),source);
  assert.equal(schedule.mismatch,false);
  assert.equal(schedule.manualDatePreserved,true);
});

test("legacy unknown is previewed separately",()=>{
  const source=attempt(1,"WB-4-A-29","2026-07-24");
  const row=review(10,"WB-4-A-29",1,"2026-07-27");
  delete row.policy_version;delete row.grading_contract;row.schedule_origin="legacy_unknown";
  const schedule=resolveReviewSchedule(row,source);
  assert.equal(schedule.scheduleOrigin,"legacy_unknown");
  assert.equal(schedule.mismatch,false);
});

test("duplicates ignore source attempt but require the same purpose, mode, scope and part IDs",()=>{
  const aliases=[];
  const a=review(10,"WB-4-A-29",1,"2026-07-26",["b","a"]);
  const b=review(11,"WB-4-A-29",2,"2026-07-26",["a","b"]);
  const different=review(12,"WB-4-A-29",2,"2026-07-26",["a","c"]);
  assert.equal(pendingReviewIdentityKey(a,aliases),pendingReviewIdentityKey(b,aliases));
  assert.notEqual(pendingReviewIdentityKey(a,aliases),pendingReviewIdentityKey(different,aliases));
});

test("newest valid source attempt is retained and completed cards are never grouped",()=>{
  const attempts=[
    attempt(1,"WB-4-A-29","2026-07-20"),
    attempt(2,"WB-4-A-29","2026-07-24"),
    attempt(3,"WB-4-A-26","2026-07-25"),
  ];
  const older=review(10,"WB-4-A-29",1,"2026-07-22");
  const newest=review(11,"WB-4-A-29",2,"2026-07-26");
  const wrongSource=review(12,"WB-4-A-29",3,"2026-07-27");
  const done={...review(13,"WB-4-A-29",2,"2026-07-26"),status:"done"};
  const different=review(14,"WB-4-A-29",2,"2026-07-26",["other"]);
  const audit=auditReviewSchedules({reviews:[older,newest,wrongSource,done,different],attempts,aliases:[],today:"2026-07-26"});
  assert.equal(audit.duplicateGroups.length,1);
  assert.equal(audit.duplicateGroups[0].keepReviewId,11);
  assert.deepEqual(new Set(audit.duplicateGroups[0].supersedeReviewIds),new Set([10,12]));
  assert.equal(audit.completedUnchanged,1);
});

test("audit separates policy corrections, manual dates, legacy rows and past due dates",()=>{
  const attempts=[
    attempt(1,"WB-4-A-29","2026-07-24"),
    attempt(2,"WB-4-A-26","2026-07-20"),
    attempt(3,"WB-4-A-24","2026-07-19"),
  ];
  const policy=review(10,"WB-4-A-29",1,"2026-07-27");
  const manual=review(11,"WB-4-A-26",2,"2026-07-27",["part_b"],{schedule_origin:"manual"});
  const legacy=review(12,"WB-4-A-24",3,"2026-07-26",["part_c"]);
  delete legacy.policy_version;delete legacy.grading_contract;legacy.schedule_origin="legacy_unknown";
  const audit=auditReviewSchedules({reviews:[policy,manual,legacy],attempts,aliases:[],today:"2026-07-26"});
  assert.equal(audit.policyDateCorrections,1);
  assert.equal(audit.manualDatePreserved,1);
  assert.equal(audit.legacyUnknown,1);
  assert.equal(audit.pastDueCorrections,0);
});
