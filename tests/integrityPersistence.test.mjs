import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

const update=(submissionId)=>({
  submission_id:submissionId,problem_id:"WB-4-A-24",problem_id_confirmed:true,problem_id_source:"manual",
  date:"2026-07-26",mode:"check",actual_minutes:5,mark:"◎",score_label:"A",
  score_numeric:90,error_type:"none",error_types:["none"],primary_error_type:"none",
  error_point:"",next_action:"14日後に短く想起",review_after_days:14,
  target_issue_resolved:true,minimum_pass_condition_met:true,
});

test("the same submissionId saves one Attempt and one logical next Review",async()=>{
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],async()=>{
    await Promise.all([db.attempts.clear(),db.reviews.clear(),db.weakNotes.clear(),db.sMemory.clear()]);
    await db.problems.put({
      id:424,problem_id:"WB-4-A-24",source_type:"whitebook",category:"A",chapter:4,problem_number:24,
      title:"匿名fixture",display_label:"第4章A問24",theme:"fixture",canonical_problem_type:"fixture",
      canonical_keywords:["fixture"],priority:"repair",role:"training",recommended_mode:"check",
      linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",related_s_problem_ids:[],
      notes:"",completion_status:"active",master_version:"fixture-v1",metadata_status:"ok",
    });
  });
  await localPost("/api/attempts",update("fixture-submission-1"));
  const attemptCount=await db.attempts.count(),reviewCount=await db.reviews.count();
  await localPost("/api/attempts",update("fixture-submission-1"));
  assert.equal(await db.attempts.count(),attemptCount);
  assert.equal(await db.reviews.count(),reviewCount);
  assert.equal(attemptCount,1);
  const active=(await db.reviews.toArray()).filter(row=>["pending","overdue"].includes(row.status));
  assert.equal(active.length,1);
  assert.match(active[0].contract_id,new RegExp(`^review:${active[0].id}:1$`));
  assert.equal(active[0].contract_id,active[0].grading_contract.contractId);
});

test("unified repair is idempotent, keeps physical history and does not alter Today Plan",async()=>{
  await localGet("/api/bootstrap");
  const source=(await db.attempts.toArray())[0];
  const base=(await db.reviews.toArray()).find(row=>["pending","overdue"].includes(row.status));
  assert.ok(source&&base);
  const duplicateId=Number(await db.reviews.add({
    ...base,id:undefined,contract_id:base.contract_id,
    grading_contract:{...base.grading_contract,contractId:base.contract_id},
  }));
  const snapshot={date:"2026-07-26",task_ids:[`review:${base.id}`,`review:${duplicateId}`],
    start_of_day_planned_minutes:10,initial_bucket:{[`review:${base.id}`]:"must",[`review:${duplicateId}`]:"must"},
    initial_estimated_minutes:{[`review:${base.id}`]:5,[`review:${duplicateId}`]:5},
    tasks:[
      {id:base.id,problem_id:base.problem_id,title:"one",kind:"review",reason:"fixture",mode:"check",minutes:5,load:.2,review_type:base.review_type},
      {id:duplicateId,problem_id:base.problem_id,title:"two",kind:"review",reason:"fixture",mode:"check",minutes:5,load:.2,review_type:base.review_type},
    ],created_at:"fixture"};
  await db.meta.put({key:"today-plan-snapshot:2026-07-26",value:JSON.stringify(snapshot)});
  const attemptRowsBefore=JSON.stringify(await db.attempts.toArray());
  const reviewCountBefore=await db.reviews.count();
  const snapshotBefore=(await db.meta.get("today-plan-snapshot:2026-07-26")).value;
  const preview=await localPost("/api/integrity/preview",{});
  assert.ok(preview.before.counts.duplicate_logical_review>=1);
  await localPost("/api/integrity/repair",{});
  const afterFirst=await localPost("/api/integrity/audit",{});
  assert.equal(afterFirst.counts.duplicate_logical_review,0);
  assert.equal(afterFirst.counts.duplicate_contract_id,0);
  assert.equal(afterFirst.counts.repeated_deduplication_key,0);
  const statusesAfterFirst=(await db.reviews.toArray()).map(row=>[row.id,row.status]);
  await localPost("/api/integrity/repair",{});
  await localPost("/api/integrity/repair",{});
  assert.equal(await db.reviews.count(),reviewCountBefore);
  assert.deepEqual((await db.reviews.toArray()).map(row=>[row.id,row.status]),statusesAfterFirst);
  assert.equal(JSON.stringify(await db.attempts.toArray()),attemptRowsBefore);
  assert.equal((await db.meta.get("today-plan-snapshot:2026-07-26")).value,snapshotBefore);
});
