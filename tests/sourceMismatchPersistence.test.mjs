import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

const problem=(id,links=[])=>({id:Math.abs([...id].reduce((n,c)=>n+c.charCodeAt(0),0)),problem_id:id,source_type:"whitebook",category:id.includes("-S-")?"S":"A",chapter:Number(id.split("-")[1]),problem_number:Number(id.split("-")[3]),title:id,display_label:id,theme:`${id}の確認`,canonical_problem_type:`${id}の型`,canonical_keywords:[id],priority:"repair",role:"foundation",recommended_mode:"check",linked_past_exams:"",linked_s_problems:links.join(";"),linked_a_problems:"",related_s_problem_ids:links,notes:"",completion_status:"active",master_version:"fixture-v1",metadata_status:"ok"});
const attempt=(id,problem_id,errors=["N"],patch={})=>({id,problem_id,date:"2026-07-20",mode:"check",time_minutes:5,mark:"△",score_label:"B",score_numeric:80,error_type:errors[0],error_types:errors,primary_error_type:errors[0],error_point:"対象箇所の説明が不足",next_action:"対象箇所を再現する",memo:"",rubric_version:"STAT1-REVIEW-v9",k_evidence:[],...patch});
const review=(id,target,sourceAttemptId,sourceProblemId,status="pending",patch={})=>({id,problem_id:target,target_problem_id:target,due_date:"2026-07-25",review_type:"s_check",status,generated_from_attempt_id:sourceAttemptId,task_origin:"linked_s_check",source_problem_id:sourceProblemId,duration_minutes:5,...patch});

test("実機バックアップ相当の18件を履歴3・verified移行1・invalid整理14へ安全に分類する",async()=>{
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.problemAliases,db.meta],async()=>{
    await Promise.all([db.problems.clear(),db.attempts.clear(),db.reviews.clear(),db.problemAliases.clear()]);
    const targets=["WB-2-S-07","WB-4-S-03","WB-4-S-04","WB-4-S-07","WB-4-S-10","WB-4-S-14","WB-4-S-16","WB-6-S-01","WB-6-S-04","WB-6-S-06","WB-6-S-12","WB-6-S-13","WB-6-S-15","WB-6-S-21","WB-6-S-22"];
    await db.problems.bulkPut([problem("WB-2-S-06",["WB-2-S-07"]),problem("WB-6-A-20"),problem("WB-4-A-23"),problem("WB-6-A-19"),...targets.map(id=>problem(id))]);
    await db.attempts.bulkPut([
      attempt(1,"WB-2-S-06"),attempt(3,"WB-2-S-07",["W","N"]),attempt(23,"WB-6-A-20"),attempt(52,"WB-2-S-06",["N"]),
      attempt(70,"WB-4-A-23",["K"],{policy_validity:"invalid_legacy_k",exclude_from_planning:true,exclude_from_recurrence_metrics:true}),
      attempt(71,"WB-6-A-19",["K"],{policy_validity:"invalid_legacy_k",exclude_from_planning:true,exclude_from_recurrence_metrics:true}),
      attempt(25,"WB-6-S-01",["none"]),attempt(26,"WB-6-S-04",["none"]),attempt(27,"WB-6-S-21",["none"]),attempt(28,"WB-6-S-22",["none"]),
      attempt(33,"WB-6-S-12",["N","C"]),attempt(49,"WB-6-S-13",["N","C"])
    ]);
    const invalidPatch={policy_validity:"invalid_legacy_k",exclude_from_planning:false,exclude_from_recurrence_metrics:true,superseded_by_policy_version:"STAT1-LEARNING-v1"};
    await db.reviews.bulkPut([
      review(2,"WB-2-S-07",1,"WB-2-S-06","done"),review(72,"WB-6-S-21",23,"WB-6-A-20","done"),review(73,"WB-6-S-22",23,"WB-6-A-20","done"),
      review(115,"WB-2-S-07",52,"WB-2-S-06"),
      ...[[194,"WB-4-S-03"],[195,"WB-4-S-04"],[196,"WB-4-S-07"],[197,"WB-4-S-10"],[198,"WB-4-S-14"],[199,"WB-4-S-16"]].map(([id,target])=>review(id,target,70,"WB-4-A-23","pending",invalidPatch)),
      ...[[203,"WB-6-S-01"],[204,"WB-6-S-04"],[205,"WB-6-S-06"],[206,"WB-6-S-12"],[207,"WB-6-S-13"],[208,"WB-6-S-15"],[209,"WB-6-S-21"],[210,"WB-6-S-22"]].map(([id,target])=>review(id,target,71,"WB-6-A-19","pending",invalidPatch))
    ]);
    await db.meta.put({key:"today-plan-snapshot:2026-07-22",value:JSON.stringify({date:"2026-07-22",task_ids:["fixture"],tasks:[],created_at:"fixture"})});
  });
  const before={attemptKeys:await db.attempts.toCollection().primaryKeys(),reviewKeys:await db.reviews.toCollection().primaryKeys(),
    scoreTime:(await db.attempts.toArray()).map(row=>[row.id,row.score_numeric,row.time_minutes]),
    done:(await db.reviews.where("status").equals("done").primaryKeys()),snapshot:(await db.meta.get("today-plan-snapshot:2026-07-22")).value};
  const preview=await localPost("/api/source-mismatch/preview",{});
  assert.equal(preview.active_source_mismatch,15);assert.equal(preview.historical_completed_linked_reviews,3);
  assert.equal(preview.pending_verified_link_needs_migration,1);assert.equal(preview.invalid_legacy_cards_to_supersede,14);
  assert.equal(preview.regenerated_count,2);assert.equal(preview.unresolved_needs_review,0);
  const result=await localPost("/api/source-mismatch/reorganize",{});
  assert.equal(result.active_source_mismatch_after,0);assert.equal(result.superseded_count,14);assert.equal(result.verified_relation_migrated,1);assert.equal(result.regenerated_count,2);
  const migrated=await db.reviews.get(115);assert.equal(migrated.status,"pending");assert.equal(migrated.origin,"verified_linked_problem");assert.equal(migrated.relation_id,"master:fixture-v1:WB-2-S-06:WB-2-S-07:remediation");
  for(const id of [194,195,196,197,198,199,203,204,205,206,207,208,209,210]){const row=await db.reviews.get(id);assert.equal(row.status,"superseded");assert.equal(row.exclude_from_planning,true)}
  const generated=(await db.reviews.toArray()).filter(row=>row.id>210);assert.equal(generated.length,2);
  assert.deepEqual(new Set(generated.map(row=>row.generated_from_attempt_id)),new Set([33,49]));
  assert.ok(generated.every(row=>row.generated_from_attempt_id===row.source_attempt_id&&row.source_attempt_id===row.derived_from_attempt_id));
  assert.ok(generated.every(row=>!String(row.reason).includes("同じ章")));
  const second=await localPost("/api/source-mismatch/preview",{});assert.equal(second.active_source_mismatch,0);assert.equal(second.superseded_count,0);assert.equal(second.regenerated_count,0);
  assert.deepEqual(await db.attempts.toCollection().primaryKeys(),before.attemptKeys);
  assert.ok((await Promise.all(before.reviewKeys.map(id=>db.reviews.get(id)))).every(Boolean));
  assert.deepEqual((await db.attempts.toArray()).map(row=>[row.id,row.score_numeric,row.time_minutes]),before.scoreTime);
  assert.deepEqual(await db.reviews.where("status").equals("done").primaryKeys(),before.done);
  assert.equal((await db.meta.get("today-plan-snapshot:2026-07-22")).value,before.snapshot);
});
