import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(new Date());

test("新規日次snapshotは合格逆算プランナーを正式生成元にする",async()=>{
  const data=await localGet("/api/bootstrap");
  const row=await db.meta.get(`today-plan-snapshot:${today()}`);
  const snapshot=JSON.parse(row.value);
  assert.equal(data.adaptiveLearning.plannerMode,"adaptive");
  assert.equal(snapshot.planner_source,"adaptive");
  assert.equal(snapshot.planner_version,"adaptive-v1");
  assert.equal(snapshot.tasks.every(task=>task.plan_origin==="adaptive_planner"),true);
});

test("公開更新とplanner mode変更は既存当日snapshotを上書きしない",async()=>{
  const key=`today-plan-snapshot:${today()}`;
  const before=(await db.meta.get(key)).value;
  await localGet("/api/bootstrap");
  assert.equal((await db.meta.get(key)).value,before);
  await localPost("/api/planner/mode",{mode:"legacy"});
  assert.equal((await db.meta.get(key)).value,before);
  assert.equal((await localGet("/api/bootstrap")).today.planner_source,"adaptive");
  await localPost("/api/planner/mode",{mode:"adaptive"});
  assert.equal((await db.meta.get(key)).value,before);
});

test("同日切替は差分previewだけでは変更せず、明示確定後も履歴を残す",async()=>{
  const key=`today-plan-snapshot:${today()}`;
  const before=(await db.meta.get(key)).value;
  const preview=await localPost("/api/today/adaptive-preview",{});
  assert.equal(preview.preview,true);
  assert.equal((await db.meta.get(key)).value,before);
  await localPost("/api/today/recalculate",{});
  const after=JSON.parse((await db.meta.get(key)).value);
  assert.equal(after.planner_source,"adaptive");
  assert.ok((await db.meta.where("key").startsWith(`today-plan-snapshot-history:${today()}:`).count())>=1);
});
