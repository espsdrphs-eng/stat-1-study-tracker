import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import JSZip from "jszip";
import {buildGradingContractSnapshot,taskFieldsFromContract} from "../src/gradingContract.ts";
import {bindContractToReview,logicalReviewKey,reviewExecutionState} from "../src/integrityEngine.ts";
import {createDiagnosticPack} from "../src/diagnosticPack.ts";

const {db,localGet,localPost}=await import("../src/localDb.ts");
const problemId="WB-4-A-06";
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const addDays=(date,days)=>{const value=new Date(`${date}T12:00:00+09:00`);value.setDate(value.getDate()+days);return new Intl.DateTimeFormat("sv-SE").format(value)};

test("delete rollback restores the logical Review into Current Today and stale GPT output rebinds",async()=>{
  await localGet("/api/bootstrap");
  await db.transaction("rw",[db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],async()=>{
    await Promise.all([db.attempts.clear(),db.reviews.clear(),db.weakNotes.clear(),db.sMemory.clear()]);
    for(const row of await db.meta.where("key").startsWith("today-plan-snapshot:").toArray())await db.meta.delete(row.key);
  });
  const problem=await db.problems.get(problemId);
  assert.ok(problem);
  const sourceDate=addDays(today(),-14);
  const source={id:141,problem_id:problemId,date:sourceDate,mode:"skeleton",time_minutes:10,mark:"○",score_label:"S",score_numeric:95,
    error_type:"none",error_types:["none"],error_point:"初手と主役を保持する",next_action:"初手を参照なしで確認",memo:"",
    target_issue_resolved:true,minimum_pass_condition_met:true,submission_id:"source-141",saved_at:`${sourceDate}T10:00:00+09:00`};
  await db.attempts.add(source);
  const reviewDraft={id:395,problem_id:problemId,due_date:today(),review_type:"light_check",status:"pending",
    generated_from_attempt_id:141,source_attempt_id:141,source_date:sourceDate,review_after_days:14,interval_days:14,
    schedule_origin:"policy",learning_purpose:"retrieval_check",learning_stage:"maintenance",assessment_timing:"delayed_retrieval",
    review_scope:"check_only",effective_mode:"check",sheet_type:"check_sheet",allowed_reference_level:0,
    retention_eligible:true,success_transition:"stable",failure_transition:"error_repair",estimated_minutes:5,duration_minutes:5,
    generated_at:new Date().toISOString()};
  const built=buildGradingContractSnapshot({review:{...reviewDraft,id:undefined},problem,sourceAttempt:source,createdAt:new Date().toISOString()}).contract;
  const oldContract=bindContractToReview(built,395,1);
  const oldReview={...reviewDraft,...taskFieldsFromContract(oldContract),
    logical_review_key:logicalReviewKey({review:{...reviewDraft,grading_contract:oldContract},sourceAttempt:source})};
  await db.reviews.add(oldReview);
  const oldTask={...oldReview,title:"A06",kind:"局所補修",reason:"朝の保持確認",mode:"check",minutes:5,load:0,
    triage:"must",plan_origin:"adaptive_planner",checked:false};
  const snapshot={date:today(),task_ids:["review:395"],start_of_day_planned_minutes:5,
    initial_bucket:{"review:395":"must"},initial_estimated_minutes:{"review:395":5},tasks:[oldTask],
    created_at:new Date().toISOString(),planner_source:"adaptive",planner_version:"adaptive-v1"};
  const snapshotKey=`today-plan-snapshot:${today()}`;
  await db.meta.put({key:snapshotKey,value:JSON.stringify(snapshot)});
  const snapshotBefore=(await db.meta.get(snapshotKey)).value;

  const errorType=oldContract.gradedParts[0].allowedErrorTypes.find(value=>value!=="none")||"N";
  const failedUpdate={submission_id:"delete-rollback-attempt",problem_id:problemId,problem_id_confirmed:true,date:today(),
    mode:oldContract.mode,actual_minutes:5,score_label:"B",score_numeric:60,mark:"△",error_type:errorType,
    error_types:[errorType],primary_error_type:errorType,error_point:"初手を再現できない",next_action:"初手だけを修復する",
    generated_from_review_id:395,source_review_id:395,contract_id:oldContract.contractId,
    contract_version:oldContract.contractVersion,contract_hash:oldContract.contractHash,learning_purpose:oldContract.learningPurpose,
    learning_stage:oldContract.learningStage,assessment_timing:"delayed_retrieval",review_scope:oldContract.reviewScope,
    target_kind:oldContract.targetKind,graded_part_ids:oldContract.gradedParts.map(row=>row.id),
    graded_findings:oldContract.gradedParts.map((row,index)=>({graded_part_id:row.id,error_type:index?"none":errorType,
      evidence:index?"再現":"初手を誤った",resolved:index>0})),target_issue_resolved:false,minimum_pass_condition_met:false,
    review_outcome:"failed",actual_reference_level:0,allowed_reference_level:0,hint_used:false,unresolved_carryover:[]};
  await localPost("/api/import",{updates:[failedUpdate]});
  const failed=(await db.attempts.toArray()).find(row=>row.submission_id==="delete-rollback-attempt");
  assert.ok(failed);
  const successorBeforeDelete=(await db.reviews.toArray()).find(row=>row.generated_from_attempt_id===failed.id&&
    ["pending","overdue"].includes(row.status));
  assert.ok(successorBeforeDelete);
  assert.equal((await db.reviews.get(395)).status,"done");

  await localPost(`/api/attempts/${failed.id}/delete`,{});
  assert.equal((await db.reviews.get(successorBeforeDelete.id)).status,"superseded");
  const currentReviews=(await db.reviews.toArray()).filter(row=>row.problem_id===problemId&&reviewExecutionState(row,today())==="actionable");
  assert.equal(currentReviews.length,1);
  const replacement=currentReviews[0];
  assert.notEqual(replacement.id,395);
  assert.equal(replacement.logical_review_key,oldReview.logical_review_key);
  assert.equal(replacement.contract_hash,oldReview.contract_hash);

  const reloaded=await localGet("/api/bootstrap");
  assert.equal(reloaded.today.tasks.find(task=>task.problem_id===problemId&&!task.checked)?.id,replacement.id);
  assert.equal(reloaded.today.tasks.find(task=>task.id===replacement.id)?.action_class,"maintenance");
  assert.equal(reloaded.today.tasks.find(task=>task.id===replacement.id)?.triage,"tomorrow");
  assert.notEqual(reloaded.today.currentTask?.id,replacement.id);
  assert.equal((await db.meta.get(snapshotKey)).value,snapshotBefore);

  await assert.rejects(()=>localPost("/api/import",{updates:[{...failedUpdate,submission_id:"semantic-mismatch",
    contract_hash:"gc-different"}]}),/採点契約|復習内容が更新/);
  const reboundUpdate={...failedUpdate,submission_id:"semantic-rebind-save"};
  await localPost("/api/import",{updates:[reboundUpdate]});
  const rebound=(await db.attempts.toArray()).find(row=>row.submission_id==="semantic-rebind-save");
  assert.equal(rebound.source_review_id,replacement.id);
  assert.equal(rebound.semantic_rebind_from_review_id,395);
  assert.equal((await db.reviews.get(395)).status,"done");

  await localPost(`/api/attempts/${rebound.id}/delete`,{});
  const generation2=(await db.reviews.toArray()).filter(row=>row.problem_id===problemId&&reviewExecutionState(row,today())==="actionable");
  assert.equal(generation2.length,1);
  await localPost("/api/import",{updates:[{...failedUpdate,submission_id:"semantic-rebind-cycle-2"}]});
  const cycle2=(await db.attempts.toArray()).find(row=>row.submission_id==="semantic-rebind-cycle-2");
  assert.equal(cycle2.source_review_id,generation2[0].id);
  await localPost(`/api/attempts/${cycle2.id}/delete`,{});
  const generation3=(await db.reviews.toArray()).filter(row=>row.problem_id===problemId&&reviewExecutionState(row,today())==="actionable");
  assert.equal(generation3.length,1);
  assert.equal(new Set(generation3.map(row=>row.logical_review_key)).size,1);

  const firstPreview=await localPost("/api/integrity/preview",{}),secondPreview=await localPost("/api/integrity/preview",{});
  assert.equal(firstPreview.changes.reviewsReplaced,0);
  assert.equal(secondPreview.changes.reviewsReplaced,0);
  assert.equal(secondPreview.changes.staleReviewsSuperseded,0);
  const finalBootstrap=await localGet("/api/bootstrap");
  for(const category of ["current_today_missing_active_review","current_today_stale_review",
    "formal_plan_current_projection_mismatch","deleted_attempt_active_descendant"])
    assert.equal(finalBootstrap.masterStatus.integrity_summary.counts[category],0,category);
  const pack=await createDiagnosticPack(),zip=await JSZip.loadAsync(await pack.blob.arrayBuffer());
  const plannerAudit=JSON.parse(await zip.file("planner-audit.json").async("string"));
  assert.equal(plannerAudit.calculations.sources.current,"canonical Current Today projection");
  assert.equal(plannerAudit.currentPlan.some(task=>task.id===395),false);
  assert.equal(plannerAudit.currentPlan.some(task=>task.id===generation3[0].id),true);
});
