import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const {todayString}=await import("../src/importParser.ts");

const part=(id)=>({id,label:id,cueLabel:id,allowedErrorTypes:["K","W","N","C","none"],completionCriterionId:`criterion-${id}`});
const contract=(reviewId,ids)=>({
  contractId:`review:${reviewId}:1`,contractVersion:"STAT1-CONTRACT-v2",contractHash:`hash-${reviewId}-${ids.join("-")}`,
  createdAt:"2026-08-01T00:00:00Z",problemId:"WB-4-A-29",reviewId,sourceReviewId:reviewId,sourceAttemptId:1,
  learningPurpose:"error_repair",learningStage:"repair",mode:"skeleton",reviewScope:"targeted_patch",
  targetKind:"mathematical_patch",targetedParts:ids,gradedParts:ids.map(part),
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:["対象外"],completionCriteria:[{id:"repair",displayText:"再現"}],
  hiddenAnswerKey:[],completionConditions:["再現"],requiredEvidence:ids,allowedErrorTypes:["K","W","N","C"],
  requiresKEvidence:true,allowedReferenceLevel:0,estimatedMinutes:10,sheetType:"skeleton_sheet",
});
const finding=(id,error="N",resolved=false)=>({graded_part_id:id,error_type:error,evidence:`${id}-evidence`,resolved});

test("safe integrity repair replaces a partially stale repair and hydrates Today action without rewriting snapshot",async()=>{
  const today=todayString();
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.meta],async()=>{
    await Promise.all([db.attempts.clear(),db.reviews.clear(),db.weakNotes.clear()]);
    await db.problems.put({id:429,problem_id:"WB-4-A-29",source_type:"whitebook",category:"A",chapter:4,problem_number:29,
      title:"匿名fixture",display_label:"第4章A問29",theme:"多変量",canonical_problem_type:"変数変換",canonical_keywords:[],
      priority:"repair",role:"training",recommended_mode:"check",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",
      notes:"",completion_status:"review_pending",master_version:"fixture",metadata_status:"ok"});
    await db.attempts.bulkAdd([
      {id:1,problem_id:"WB-4-A-29",date:"2026-08-01",mode:"full",time_minutes:30,mark:"△",score_label:"B",
        error_type:"N",error_point:"old",next_action:"old",memo:"",error_types:["N","W"],
        graded_part_ids:["A","B","C","D"],graded_parts:["A","B","C","D"],
        graded_findings:[finding("A"),finding("B","W"),finding("C"),finding("D","W")]},
      {id:2,problem_id:"WB-4-A-29",date:"2026-08-05",mode:"check",time_minutes:5,mark:"△",score_label:"A",
        error_type:"N",error_point:"E only",next_action:"E",memo:"",error_types:["N"],
        graded_part_ids:["A","B","D","E"],graded_parts:["A","B","D","E"],
        graded_findings:[finding("A","none",true),finding("B","none",true),finding("D","none",true),finding("E")],
        minimum_pass_condition_met:false,target_issue_resolved:false},
    ]);
    const grading=contract(10,["A","B","C","D"]);
    await db.reviews.add({id:10,problem_id:"WB-4-A-29",due_date:today,review_type:"targeted_patch",status:"pending",
      generated_from_attempt_id:1,source_attempt_id:1,source_date:"2026-08-01",review_after_days:9,interval_days:9,
      schedule_origin:"policy",learning_purpose:"error_repair",learning_stage:"repair",assessment_timing:"delayed_retrieval",
      effective_mode:"skeleton",review_scope:"targeted_patch",sheet_type:"skeleton_sheet",target_kind:"mathematical_patch",
      targeted_parts:["A","B","C","D"],graded_part_ids:["A","B","C","D"],grading_contract:grading,
      contract_id:grading.contractId,contract_version:grading.contractVersion,contract_hash:grading.contractHash,
      policy_version:"STAT1-LEARNING-v1",origin:"direct_attempt",origin_verified:true});
    const snapshot={date:today,task_ids:["review:10"],start_of_day_planned_minutes:10,
      initial_bucket:{"review:10":"must"},initial_estimated_minutes:{"review:10":10},created_at:"fixture",
      tasks:[{id:10,problem_id:"WB-4-A-29",title:"第4章A問29",kind:"復習",reason:"old action",mode:"skeleton",
        minutes:10,load:.5,review_type:"targeted_patch",triage:"must",targeted_parts:["A","B","C","D"],grading_contract:grading}]};
    await db.meta.put({key:`today-plan-snapshot:${today}`,value:JSON.stringify(snapshot)});
  });

  const snapshotBefore=(await db.meta.get(`today-plan-snapshot:${today}`)).value;
  const preview=await localPost("/api/integrity/preview",{});
  assert.equal(preview.changes.staleReviewsSuperseded,1);
  assert.equal(preview.changes.reviewsReplaced,1);
  assert.equal(preview.changes.todayActionsUpdated,1);
  await assert.rejects(()=>localPost("/api/reviews/10/contract-lock",{}),/最新答案/);
  await assert.rejects(()=>localPost("/api/reviews/10/reference",{actual_reference_level:1}),/最新答案/);
  await localPost("/api/integrity/repair",{});
  const rows=await db.reviews.toArray();
  assert.equal(rows.find(row=>row.id===10).status,"superseded");
  const active=rows.filter(row=>["pending","overdue"].includes(row.status));
  assert.equal(active.length,1);
  assert.deepEqual(active[0].grading_contract.gradedParts.map(row=>row.id).sort(),["C","E"]);
  assert.equal((await db.meta.get(`today-plan-snapshot:${today}`)).value,snapshotBefore);
  const bootstrap=await localGet("/api/bootstrap");
  assert.equal(bootstrap.today.tasks.length,1);
  assert.equal(bootstrap.today.tasks[0].id,active[0].id);
  assert.deepEqual(bootstrap.today.tasks[0].grading_contract.gradedParts.map(row=>row.id).sort(),["C","E"]);
  assert.equal(bootstrap.today.tasks[0].minutes,10);
  assert.equal(bootstrap.today.tasks[0].triage,"must");
  const count=await db.reviews.count();
  await localPost("/api/integrity/repair",{});
  await localPost("/api/integrity/repair",{});
  assert.equal(await db.reviews.count(),count);
});

test("stable-key backfill hydrates the same pending Review and is idempotent",async()=>{
  const today=todayString();
  await db.transaction("rw",[db.attempts,db.reviews,db.meta],async()=>{
    await db.attempts.clear();await db.reviews.clear();
    for(const row of await db.meta.where("key").startsWith("today-plan-snapshot:").toArray())await db.meta.delete(row.key);
    await db.attempts.add({id:3,problem_id:"WB-4-A-29",date:"2026-08-09",mode:"check",time_minutes:5,
      mark:"△",score_label:"B",error_type:"N",error_types:["N"],error_point:"A",next_action:"A",memo:"",
      graded_part_ids:["A"],graded_parts:["A"],graded_findings:[finding("A")]});
    const legacy=contract(20,["A"]);
    await db.reviews.add({id:20,problem_id:"WB-4-A-29",due_date:today,review_type:"targeted_patch",status:"pending",
      generated_from_attempt_id:3,source_attempt_id:3,learning_purpose:"error_repair",assessment_timing:"delayed_retrieval",
      effective_mode:"skeleton",review_scope:"targeted_patch",sheet_type:"skeleton_sheet",target_kind:"mathematical_patch",
      targeted_parts:["A"],graded_part_ids:["A"],grading_contract:legacy,contract_id:legacy.contractId,
      contract_version:legacy.contractVersion,contract_hash:legacy.contractHash,policy_version:"STAT1-LEARNING-v1"});
  });
  const beforeCount=await db.reviews.count();
  const preview=await localPost("/api/integrity/preview",{});
  assert.equal(preview.changes.reviewsReplaced,1);
  await localPost("/api/integrity/repair",{});
  assert.equal(await db.reviews.count(),beforeCount);
  const hydrated=await db.reviews.get(20);
  assert.equal(hydrated.status,"pending");
  assert.equal(hydrated.grading_contract.gradedParts[0].stableTargetKey,"target:WB-4-A-29:slot:A");
  const second=await localPost("/api/integrity/repair",{});
  assert.equal(Object.values(second.changes).every(value=>Number(value)===0),true);
  assert.equal(await db.reviews.count(),beforeCount);
});
