import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

test("追加候補は明示操作だけでsnapshotへ入り、同じ操作を2回しても二重計上しない",async()=>{
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
  assert.ok(before.today.additionalCandidates.length);
  const candidate=before.today.additionalCandidates[0];
  const rawBefore=(await db.meta.get(`today-plan-snapshot:${date}`)).value;
  await localGet("/api/bootstrap");
  assert.equal((await db.meta.get(`today-plan-snapshot:${date}`)).value,rawBefore);
  await localPost("/api/today/add-candidate",{candidateKey:candidate.candidateKey});
  await localPost("/api/today/add-candidate",{candidateKey:candidate.candidateKey});
  const snapshot=JSON.parse((await db.meta.get(`today-plan-snapshot:${date}`)).value);
  assert.equal(snapshot.tasks.filter(task=>task.additional_candidate_key===candidate.candidateKey).length,1);
  assert.equal(snapshot.start_of_day_planned_minutes,61);
});
