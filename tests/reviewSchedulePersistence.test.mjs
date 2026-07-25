import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

const problem=id=>({
  id:1,problem_id:id,source_type:"whitebook",category:"A",chapter:4,problem_number:Number(id.split("-").at(-1)),
  title:id,display_label:id,theme:"fixture",canonical_problem_type:"fixture type",canonical_keywords:["fixture"],
  priority:"repair",role:"training",recommended_mode:"check",linked_past_exams:"",linked_s_problems:"",
  linked_a_problems:"",related_s_problem_ids:[],notes:"",completion_status:"active",master_version:"fixture-v1"
});
const attempt=(id,problem_id,date)=>({
  id,problem_id,date,mode:"check",time_minutes:5,mark:"○",score_label:"A",score_numeric:90,
  error_type:"N",error_types:["N"],primary_error_type:"N",error_point:"説明不足",next_action:"再現",memo:""
});
const contract=(problemId,parts)=>({
  contractId:`${problemId}:${parts.join("-")}`,contractVersion:"STAT1-CONTRACT-v2",contractHash:`hash:${parts.join("-")}`,
  createdAt:"2026-07-24T00:00:00Z",problemId,learningPurpose:"error_repair",learningStage:"repair",
  mode:"check",reviewScope:"targeted_patch",targetKind:"mathematical_patch",targetedParts:parts,
  gradedParts:parts.map(id=>({id,label:id,cueLabel:id,allowedErrorTypes:["N","none"],completionCriterionId:`do_${id}`})),
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],
  completionCriteria:parts.map(id=>({id:`do_${id}`,displayText:"指定箇所を再現する"})),hiddenAnswerKey:[],
  completionConditions:["指定箇所を再現する"],requiredEvidence:[],allowedErrorTypes:["N","none"],requiresKEvidence:false,
  allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet"
});
const review=(id,problemId,attemptId,dueDate,parts,patch={})=>({
  id,problem_id:problemId,due_date:dueDate,review_type:"targeted_patch",status:"pending",
  generated_from_attempt_id:attemptId,source_attempt_id:attemptId,derived_from_attempt_id:attemptId,
  interval_days:2,learning_purpose:"error_repair",effective_mode:"check",review_scope:"targeted_patch",
  graded_part_ids:parts,grading_contract:contract(problemId,parts),policy_version:"policy-v1",...patch
});

test("repair corrects policy dates, preserves manual dates and snapshot, and supersedes old duplicates idempotently",async()=>{
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.problemAliases,db.meta],async()=>{
    await Promise.all([db.problems.clear(),db.attempts.clear(),db.reviews.clear(),db.problemAliases.clear()]);
    await db.problems.bulkPut([problem("WB-4-A-29"),problem("WB-4-A-26"),problem("WB-4-A-24")]);
    await db.attempts.bulkPut([
      attempt(901,"WB-4-A-29","2026-07-20"),attempt(902,"WB-4-A-29","2026-07-24"),
      attempt(903,"WB-4-A-26","2026-07-20"),attempt(904,"WB-4-A-24","2026-07-19")
    ]);
    await db.reviews.bulkPut([
      review(900,"WB-4-A-29",901,"2026-07-27",["same"]),
      review(901,"WB-4-A-29",902,"2026-07-27",["same"]),
      review(902,"WB-4-A-26",903,"2026-07-27",["manual"],{schedule_origin:"manual",postponed_at:"2026-07-21T00:00:00Z"}),
      review(903,"WB-4-A-24",904,"2026-07-26",["legacy"],{policy_version:undefined,grading_contract:undefined,schedule_origin:"legacy_unknown"}),
      review(904,"WB-4-A-29",902,"2026-07-26",["different"]),
      {...review(905,"WB-4-A-26",903,"2026-07-27",["done"]),status:"done"}
    ]);
    await db.meta.put({key:"today-plan-snapshot:2026-07-26",value:JSON.stringify({
      date:"2026-07-26",task_ids:["review:900"],start_of_day_planned_minutes:5,
      initial_bucket:{"review:900":"must"},initial_estimated_minutes:{"review:900":5},
      tasks:[{id:900,problem_id:"WB-4-A-29",title:"WB-4-A-29",kind:"復習",reason:"fixture",mode:"check",minutes:5,load:.2,review_type:"targeted_patch"}],
      created_at:"fixture"
    })});
  });
  const snapshotBefore=(await db.meta.get("today-plan-snapshot:2026-07-26")).value;
  const attemptsBefore=JSON.stringify(await db.attempts.toArray());
  const doneBefore=JSON.stringify(await db.reviews.get(905));
  const preview=await localPost("/api/review-schedule/preview",{});
  assert.equal(preview.policy_date_correction_count,2);
  assert.equal(preview.manual_date_preserved_count,1);
  assert.equal(preview.legacy_unknown_count,1);
  assert.equal(preview.duplicates_superseded_count,1);

  const result=await localPost("/api/review-schedule/repair",{});
  assert.equal(result.success,true);
  assert.equal(result.policy_date_correction_count,3);
  assert.equal(result.duplicates_superseded_count,1);
  assert.equal(result.today_plan_snapshot_unchanged,true);
  assert.equal((await db.reviews.get(900)).status,"superseded");
  assert.equal((await db.reviews.get(901)).due_date,"2026-07-26");
  assert.equal((await db.reviews.get(902)).due_date,"2026-07-27");
  assert.equal((await db.reviews.get(902)).schedule_origin,"manual");
  assert.equal((await db.reviews.get(903)).due_date,"2026-07-21");
  assert.equal((await db.reviews.get(904)).status,"pending");
  assert.equal(JSON.stringify(await db.attempts.toArray()),attemptsBefore);
  assert.equal(JSON.stringify(await db.reviews.get(905)),doneBefore);
  assert.equal((await db.meta.get("today-plan-snapshot:2026-07-26")).value,snapshotBefore);

  const secondPreview=await localPost("/api/review-schedule/preview",{});
  assert.equal(secondPreview.policy_date_correction_count,0);
  assert.equal(secondPreview.duplicates_superseded_count,0);
  assert.equal(secondPreview.legacy_unknown_count,0);
  const second=await localPost("/api/review-schedule/repair",{});
  assert.equal(second.policy_date_correction_count,0);
  assert.equal(second.duplicates_superseded_count,0);
  assert.equal((await db.meta.get("today-plan-snapshot:2026-07-26")).value,snapshotBefore);
});
