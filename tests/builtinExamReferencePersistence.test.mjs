import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet}=await import("../src/localDb.ts");

const pastProblem=(year,question)=>({
  id:year*10+question,problem_id:`PY-${year}-Q${question}`,source_type:"past_exam",
  category:"past_exam",chapter:null,problem_number:question,title:`${year}年問${question}`,
  theme:"過去問・テーマ未登録",priority:"core",role:"exam",recommended_mode:"scan",
  linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",
  completion_status:"active",display_label:`${year}年問${question}`,difficulty:null,
  roadmap_label:`${year}年問${question}`,normalized_label:`${year}年問${question}`,
  related_s_problem_ids:[],linked_past_exam_ids:[]
});

test("既存20問DBへ2016〜2019・2021を冪等追加し履歴・露出・snapshotを保持する",async()=>{
  await db.open();
  await db.transaction("rw",db.tables,async()=>{for(const table of db.tables)await table.clear()});
  await db.problems.bulkPut([2022,2023,2024,2025].flatMap(year=>
    Array.from({length:5},(_,index)=>pastProblem(year,index+1))
  ));
  await db.attempts.put({id:7,problem_id:"PY-2024-Q1",date:"2026-07-20",mode:"full",
    time_minutes:35,mark:"○",score_label:"A",score_numeric:80,error_type:"none",error_types:["none"]});
  await db.reviews.put({id:8,problem_id:"PY-2024-Q1",due_date:"2026-08-01",status:"done",
    review_type:"light_check",generated_from_attempt_id:7,duration_minutes:5,reason:"履歴"});
  await db.pastSessions.put({id:9,year:2024,date:"2026-07-20",session_type:"scan5",
    session_kind:"scan_only",scan_set_source:"past_exam_year",questions:[],scan_minutes:10});
  await db.meta.bulkPut([
    {key:"seeded",value:"1"},
    {key:"exam-reference-pack:exposure-overrides",value:JSON.stringify({"PY-2024-Q1":"prompt_scanned"})},
    {key:"today-plan-snapshot:2026-07-29",value:JSON.stringify({date:"2026-07-29",task_ids:["review:8"],tasks:[]})}
  ]);
  const before={
    attemptIds:(await db.attempts.toArray()).map(row=>row.id),
    reviewIds:(await db.reviews.toArray()).map(row=>row.id),
    sessionIds:(await db.pastSessions.toArray()).map(row=>row.id),
    snapshot:(await db.meta.get("today-plan-snapshot:2026-07-29"))?.value
  };
  const first=await localGet("/api/bootstrap");
  const core=first.problems.filter(row=>row.category==="past_exam"&&row.schedulable);
  assert.equal(core.length,45);
  assert.deepEqual([...new Set(core.map(row=>Number(row.problem_id.slice(3,7))))].sort(),
    [2016,2017,2018,2019,2021,2022,2023,2024,2025]);
  assert.equal(first.adaptiveLearning.pastExamCatalog.length,45);
  assert.equal(first.adaptiveLearning.pastExamCatalog.some(row=>row.year===2020),false);
  assert.equal(first.adaptiveLearning.pastExamCatalog.filter(row=>[2016,2017,2018].includes(row.year)).every(row=>
    row.availability==="verified_problem"&&row.schedulable&&row.exposure==="unknown"&&!row.simulationProtected),true);
  assert.equal(first.adaptiveLearning.pastExamCatalog.find(row=>row.canonicalProblemId==="PY-2024-Q1")?.exposure,
    "prompt_scanned");
  const countAfterFirst=await db.problems.count();
  await localGet("/api/bootstrap");
  assert.equal(await db.problems.count(),countAfterFirst);
  assert.deepEqual((await db.attempts.toArray()).map(row=>row.id),before.attemptIds);
  assert.deepEqual((await db.reviews.toArray()).map(row=>row.id),before.reviewIds);
  assert.deepEqual((await db.pastSessions.toArray()).map(row=>row.id),before.sessionIds);
  assert.equal((await db.meta.get("today-plan-snapshot:2026-07-29"))?.value,before.snapshot);
});
