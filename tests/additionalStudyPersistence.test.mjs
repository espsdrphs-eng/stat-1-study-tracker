import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

test("順位付きTodayは追加学習枠を要求せず、旧snapshotと完了履歴を保全する",async()=>{
  await db.open();
  await db.transaction("rw",db.tables,async()=>{for(const table of db.tables)await table.clear()});
  await localGet("/api/bootstrap");
  const date=today(),problem=(await db.problems.filter(row=>row.category==="A").first());
  assert.ok(problem);
  const originalTask={problem_id:problem.problem_id,title:problem.display_label||problem.title,kind:"完了",
    reason:"fixture",mode:"full",minutes:61,load:1,checked:true,triage:"must"};
  await db.attempts.put({id:9901,problem_id:problem.problem_id,date,mode:"full",time_minutes:61,
    mark:"○",score_label:"A",score_numeric:80,error_type:"none",error_types:["none"],error_point:"",next_action:""});
  // Keep enough spare capacity after the formal D87 concrete past-exam slot;
  // this fixture verifies opt-in persistence, not the 150-minute planner mix.
  await db.meta.put({key:"daily_study_minutes",value:"240"});
  await db.meta.put({key:`today-plan-snapshot:${date}`,value:JSON.stringify({
    date,task_ids:["fixture"],start_of_day_planned_minutes:61,initial_bucket:{fixture:"must"},
    initial_estimated_minutes:{fixture:61},tasks:[originalTask],created_at:new Date().toISOString()
  })});
  const before=await localGet("/api/bootstrap");
  assert.equal(before.today.active_remaining_minutes,
    before.today.tasks.filter(task=>!task.checked).reduce((sum,task)=>sum+Number(task.minutes||0),0));
  assert.ok(before.today.active_remaining_minutes>0,"current projection should include the formal adaptive tasks");
  assert.equal(before.today.remaining_learning_capacity_minutes,
    Math.max(0,240-61-before.today.active_remaining_minutes));
  assert.equal(before.today.canonicalStudyPlan.ranked.version,"learning-value-v1");
  const queueBefore=before.today.tasks.filter(t=>t.ranking).map(t=>t.ranking);
  const rawBefore=(await db.meta.get(`today-plan-snapshot:${date}`)).value;
  await localGet("/api/bootstrap");
  assert.equal((await db.meta.get(`today-plan-snapshot:${date}`)).value,rawBefore);
  // Daily opt-in is intentionally retired for the normal ranked mode. The
  // standalone legacy additionalStudy unit tests still cover its old caps.
  await assert.rejects(()=>localPost("/api/today/add-candidate",{candidateKey:"retired-slot"}),/順位付きToday/);
  assert.deepEqual((await localGet("/api/bootstrap")).today.tasks.filter(t=>t.ranking).map(t=>t.ranking),queueBefore);
  const snapshot=JSON.parse((await db.meta.get(`today-plan-snapshot:${date}`)).value);
  assert.equal(snapshot.tasks.filter(task=>task.additional_candidate_key).length,0);
  assert.equal((await db.attempts.get(9901)).score_numeric,80);
  assert.equal(snapshot.start_of_day_planned_minutes,61);
});
