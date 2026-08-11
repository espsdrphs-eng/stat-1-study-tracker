import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const {todayString}=await import("../src/importParser.ts");

const problem=(problemId,number)=>({id:500+number,problem_id:problemId,source_type:"whitebook",category:"A",chapter:5,
  problem_number:number,title:problemId,display_label:problemId,theme:"fixture",canonical_problem_type:"fixture",canonical_keywords:[],
  priority:"score",role:"training",recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",
  related_s_problem_ids:[],notes:"",completion_status:"active",master_version:"fixture",metadata_status:"ok"});

test("WB-5-A-28 qualifying full Attempt completes Today slot and advances the dashboard projection",async()=>{
  const today=todayString();
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],async()=>{
    await Promise.all([db.attempts.clear(),db.reviews.clear(),db.weakNotes.clear(),db.sMemory.clear()]);
    await db.problems.bulkPut([problem("WB-5-A-28",28),problem("WB-5-A-20",20)]);
    for(const row of await db.meta.where("key").startsWith("today-plan-snapshot:").toArray())await db.meta.delete(row.key);
    const tasks=[
      {problem_id:"WB-5-A-28",title:"A28",kind:"score",reason:"full",mode:"full",minutes:35,load:1,triage:"must",checked:false},
      {problem_id:"WB-5-A-20",title:"A20",kind:"score",reason:"skeleton",mode:"skeleton",minutes:10,load:.5,triage:"must",checked:false},
    ];
    const createdAt=new Date(Date.now()-60_000).toISOString();
    await db.meta.put({key:`today-plan-snapshot:${today}`,value:JSON.stringify({date:today,
      task_ids:["task:A28","task:A20"],start_of_day_planned_minutes:45,
      initial_bucket:{"task:A28":"must","task:A20":"must"},
      initial_estimated_minutes:{"task:A28":35,"task:A20":10},tasks,created_at:createdAt,
      planner_source:"adaptive",planner_version:"fixture"})});
  });

  const submission="wb-5-a-28-logical-save";
  await localPost("/api/attempts",{submission_id:submission,problem_id:"WB-5-A-28",problem_id_confirmed:true,
    problem_id_source:"manual",date:today,mode:"full",actual_minutes:35,mark:"△",score_label:"D",score_numeric:45,
    error_type:"N",primary_error_type:"N",error_types:["N"],error_point:"定義域の説明が不足",
    next_action:"定義域を確認して説明する",target_issue_resolved:false,minimum_pass_condition_met:false});

  const data=await localGet("/api/bootstrap");
  const a28=data.today.tasks.find(row=>row.problem_id==="WB-5-A-28");
  const a20=data.today.tasks.find(row=>row.problem_id==="WB-5-A-20");
  assert.equal(a28.checked,true);
  assert.equal(a20.checked,false);
  assert.equal(data.today.tasks.find(row=>!row.checked&&row.triage!=="tomorrow").problem_id,"WB-5-A-20");
  assert.equal(data.today.active_remaining_minutes,10);
  const saved=(await db.attempts.toArray()).filter(row=>row.submission_id===submission);
  assert.equal(saved.length,1);
  assert.notEqual(saved[0].exclude_from_planning,true);
  const activeRepair=(await db.reviews.toArray()).find(row=>row.problem_id==="WB-5-A-28"&&["pending","overdue"].includes(row.status));
  assert.ok(activeRepair);
  assert.equal(activeRepair.grading_contract.gradedParts.length,1);
  assert.equal(activeRepair.grading_contract.gradedParts[0].currentCorrection,"定義域を確認して説明する");

  const reviewCount=await db.reviews.count();
  await localPost("/api/attempts",{submission_id:submission,problem_id:"WB-5-A-28"});
  assert.equal((await db.attempts.toArray()).filter(row=>row.submission_id===submission).length,1);
  assert.equal(await db.reviews.count(),reviewCount);
});
