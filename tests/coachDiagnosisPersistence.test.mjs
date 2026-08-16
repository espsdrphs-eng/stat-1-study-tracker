import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
const {db,localGet,localPost}=await import("../src/localDb.ts");

const yaml=(cutoff,reviewedAt)=>`coach_update:
  schema_version: stat1-coach-v1
  reviewed_at: "${reviewedAt}"
  evidence_cutoff_attempt_id: ${cutoff}
  level:
    value: 3.5
    label: A/S問題を解けるが再現不安定
    pass_outlook: 境界手前〜境界圏
    confidence: medium
    rationale: 現在の答案証拠
  primary_bottleneck:
    title: 変数・係数・制約の追跡
    explanation: 複数問題で再発
    evidence_problem_ids: [WB-6-A-20]
    effect_on_exam: 途中式の失点
  next_actions:
    - title: 置換後の全式更新
      purpose: 追跡力
      practice_method: 別問題で再現
      success_condition: 参照なし成功
  strengths: []
  improvements: []
  unknowns:
    - title: 時間内完走
      evidence_needed: timed答案
  optional_pass_probability: null`;

test("coach preview/saveはraw factを変えず履歴・current・staleを管理する",async()=>{
  await localGet("/api/bootstrap");await db.meta.delete("coach-diagnosis-history-v1");
  const before={attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),problems:await db.problems.toArray()};
  const cutoff=Math.max(0,...before.attempts.map(row=>row.id));
  const first=yaml(cutoff,"2026-08-17T10:00:00+09:00");
  const preview=await localPost("/api/coach/preview",{text:first});
  assert.equal(preview.diff.level,"未診断 → 3.5");
  await localPost("/api/coach/save",{text:first});await localPost("/api/coach/save",{text:first});
  let bootstrap=await localGet("/api/bootstrap");
  assert.equal(bootstrap.coach.current.level.value,3.5);assert.equal(bootstrap.coach.history.length,1);
  assert.equal(bootstrap.coach.stale,false);assert.equal(bootstrap.coach.display.primaryBottleneck.title,"変数・係数・制約の追跡");
  assert.deepEqual(await db.attempts.toArray(),before.attempts);assert.deepEqual(await db.reviews.toArray(),before.reviews);
  assert.deepEqual(await db.problems.toArray(),before.problems);

  const newId=Number(await db.attempts.add({problem_id:"WB-6-A-20",date:"2026-08-17",mode:"full",time_minutes:5,
    mark:"○",score_label:"A",error_type:"none",error_point:"",next_action:"",memo:""}));
  bootstrap=await localGet("/api/bootstrap");assert.equal(bootstrap.coach.stale,true);assert.equal(bootstrap.coach.newAttemptCount,1);
  await assert.rejects(()=>localPost("/api/coach/save",{text:first}),/採点が更新/);
  const second=yaml(newId,"2026-08-17T11:00:00+09:00");await localPost("/api/coach/save",{text:second});
  bootstrap=await localGet("/api/bootstrap");assert.equal(bootstrap.coach.stale,false);assert.equal(bootstrap.coach.history.length,2);
});
