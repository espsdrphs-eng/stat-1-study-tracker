import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

const today=()=>new Intl.DateTimeFormat("sv-SE",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",
}).format(new Date());
const yesterday=()=>{const date=new Date(`${today()}T12:00:00`);date.setDate(date.getDate()-1);return new Intl.DateTimeFormat("sv-SE").format(date)};

const update=(submissionId)=>({
  submission_id:submissionId,problem_id:"WB-6-S-22",problem_id_confirmed:true,problem_id_source:"manual",
  date:yesterday(),mode:"check",actual_minutes:5,mark:"△",score_label:"B",score_numeric:75,
  error_type:"C",error_types:["C"],primary_error_type:"C",error_point:"記号の転記",
  next_action:"記号を確認",review_after_days:7,target_issue_resolved:false,minimum_pass_condition_met:false,
});

test("snapshot, dashboard and GPT save share the persisted Review execution state",async()=>{
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],async()=>{
    await Promise.all([db.attempts.clear(),db.reviews.clear(),db.weakNotes.clear(),db.sMemory.clear()]);
    await db.problems.put({
      id:622,problem_id:"WB-6-S-22",source_type:"whitebook",category:"S",chapter:6,problem_number:22,
      title:"匿名fixture",display_label:"第6章S問22",theme:"fixture",canonical_problem_type:"fixture",
      canonical_keywords:["fixture"],priority:"repair",role:"training",recommended_mode:"check",
      linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",related_s_problem_ids:[],
      notes:"",completion_status:"active",master_version:"fixture-v1",metadata_status:"ok",
    });
  });
  await localPost("/api/attempts",update("current-review-state-1"));
  const active=(await db.reviews.toArray()).find(row=>["pending","overdue"].includes(row.status));
  assert.ok(active?.grading_contract);
  await db.reviews.update(active.id,{due_date:today(),earliest_date:today(),preferred_date:today(),latest_date:today(),schedule_origin:"manual"});
  const oldId=Number(await db.reviews.add({
    ...active,id:undefined,status:"superseded",policy_validity:"invalid_legacy_k",
    exclude_from_planning:true,contract_id:"review:old:1",
    grading_contract:{...active.grading_contract,contractId:"review:old:1"},
  }));
  const activeTask={...active,id:active.id,due_date:today(),status:"pending",problem_id:"WB-6-S-22",
    title:"current",kind:"復習",reason:"fixture",mode:"check",minutes:5,load:.2,review_type:"light_check"};
  const oldTask={...activeTask,id:oldId,title:"old"};
  const key=`today-plan-snapshot:${today()}`;
  const snapshot={date:today(),task_ids:[`review:${oldId}`,`review:${active.id}`],
    start_of_day_planned_minutes:10,
    initial_bucket:{[`review:${oldId}`]:"must",[`review:${active.id}`]:"must"},
    initial_estimated_minutes:{[`review:${oldId}`]:5,[`review:${active.id}`]:5},
    tasks:[oldTask,activeTask],created_at:"fixture"};
  await db.meta.put({key,value:JSON.stringify(snapshot)});
  const snapshotBefore=(await db.meta.get(key)).value;

  const bootstrap=await localGet("/api/bootstrap");
  assert.deepEqual(bootstrap.today.tasks.filter(task=>task.id).map(task=>task.id),[active.id]);
  assert.equal(bootstrap.dashboard.pending,1);
  assert.equal(bootstrap.today.active_remaining_minutes,
    bootstrap.today.tasks.filter(task=>!task.checked&&task.triage!=="tomorrow")
      .reduce((sum,task)=>sum+Number(task.minutes||0),0));
  assert.ok(bootstrap.today.active_remaining_minutes>=5);
  assert.equal((await db.meta.get(key)).value,snapshotBefore);

  const countsBefore={attempts:await db.attempts.count(),reviews:await db.reviews.count()};
  await assert.rejects(
    ()=>localPost("/api/import",{updates:[{...update("old-review-save"),generated_from_review_id:oldId}]}),
    /終了しました/,
  );
  await assert.rejects(
    ()=>localPost(`/api/reviews/${oldId}/postpone`,{days:1,action:"tomorrow"}),
    /終了しました/,
  );
  assert.equal((await db.reviews.get(oldId)).status,"superseded");
  assert.deepEqual({attempts:await db.attempts.count(),reviews:await db.reviews.count()},countsBefore);
});
