import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {record} from "./adaptiveFixture.mjs";

const {db,localGet,localPost}=await import("../src/localDb.ts");

test("同じ参照パックを2回処理しても重複せず学習履歴とsnapshotを変更しない",async()=>{
  await localGet("/api/bootstrap");
  const fixture=record(),today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",
    year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const snapshotBefore=(await db.meta.get(`today-plan-snapshot:${today}`))?.value;
  const before={problems:await db.problems.count(),attemptIds:(await db.attempts.toArray()).map(row=>row.id),
    reviewIds:(await db.reviews.toArray()).map(row=>row.id),pastIds:(await db.pastSessions.toArray()).map(row=>row.id)};
  const body={data:fixture.data,packHash:fixture.packHash,validation:fixture.validation};
  const first=await localPost("/api/exam-reference-pack/import",body),afterFirst=await db.problems.count();
  const second=await localPost("/api/exam-reference-pack/import",body),afterSecond=await db.problems.count();
  assert.equal(first.unchanged,false);
  assert.equal(second.unchanged,true);
  assert.ok(afterFirst>=before.problems);
  assert.equal(afterSecond,afterFirst);
  assert.deepEqual((await db.attempts.toArray()).map(row=>row.id),before.attemptIds);
  assert.deepEqual((await db.reviews.toArray()).map(row=>row.id),before.reviewIds);
  assert.deepEqual((await db.pastSessions.toArray()).map(row=>row.id),before.pastIds);
  assert.equal((await db.meta.get(`today-plan-snapshot:${today}`))?.value,snapshotBefore);
});

test("metadata onlyをproblem masterへ追加しない",async()=>{
  const status=(await localGet("/api/bootstrap")).adaptiveLearning.referencePack;
  assert.equal(status.counts.metadataOnly,0);
  assert.equal((await db.problems.toArray()).some(row=>row.past_exam_availability==="metadata_only"),false);
});

test("core過去問の露出状態を保存し、unknownとunseenを区別する",async()=>{
  await localPost("/api/exam-reference-pack/exposure",{problemId:"PY-2021-Q1",exposure:"prompt_scanned"});
  const bootstrap=await localGet("/api/bootstrap");
  assert.equal(bootstrap.adaptiveLearning.pastExamCatalog.find(row=>row.canonicalProblemId==="PY-2021-Q1")?.exposure,"prompt_scanned");
  await assert.rejects(()=>localPost("/api/exam-reference-pack/exposure",{problemId:"PY-2021-Q1",exposure:"mystery"}),/露出状態が不正/);
});
