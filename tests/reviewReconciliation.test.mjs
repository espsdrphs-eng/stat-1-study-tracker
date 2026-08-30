import test from "node:test";
import assert from "node:assert/strict";
import {analyzeReviewReconciliation} from "../src/reviewReconciliation.ts";

const part=(id)=>({id,label:id,cueLabel:id,allowedErrorTypes:["K","W","N","C","none"],completionCriterionId:`c-${id}`});
const contract=(ids,purpose="error_repair")=>({
  contractId:"fixture",contractVersion:"STAT1-CONTRACT-v2",contractHash:`hash-${ids.join("-")}`,createdAt:"2026-08-01",
  problemId:"WB-4-A-29",sourceAttemptId:1,learningPurpose:purpose,learningStage:purpose==="error_repair"?"repair":"maintenance",
  mode:"check",reviewScope:purpose==="error_repair"?"targeted_patch":"check_only",targetKind:"mathematical_patch",
  targetedParts:ids,gradedParts:ids.map(part),explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],
  completionCriteria:[{id:"done",displayText:"再現"}],hiddenAnswerKey:[],completionConditions:["再現"],requiredEvidence:ids,
  allowedErrorTypes:["K","W","N","C"],requiresKEvidence:true,allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet",
});
const finding=(id,error="N",resolved=false,evidence=`${id}-evidence`)=>({graded_part_id:id,error_type:error,evidence,resolved});
const attempt=(id,date,findings,patch={})=>({
  id,problem_id:"WB-4-A-29",date,mode:"check",time_minutes:5,mark:"△",score_label:"B",
  error_type:findings.find(row=>!row.resolved)?.error_type||"none",error_point:"",next_action:"",memo:"",
  error_types:[...new Set(findings.filter(row=>!row.resolved).map(row=>row.error_type))].filter(value=>value!=="none"),
  graded_part_ids:findings.map(row=>row.graded_part_id),graded_parts:findings.map(row=>row.graded_part_id),
  graded_findings:findings,minimum_pass_condition_met:findings.every(row=>row.resolved),
  target_issue_resolved:findings.every(row=>row.resolved),actual_reference_level:0,no_hint:true,
  assessment_timing:"delayed_retrieval",...patch,
});
const review=(id,source,ids,patch={})=>({
  id,problem_id:"WB-4-A-29",due_date:"2026-08-10",review_type:"targeted_patch",status:"pending",
  generated_from_attempt_id:source,source_attempt_id:source,learning_purpose:"error_repair",
  assessment_timing:"delayed_retrieval",grading_contract:contract(ids),graded_part_ids:ids,
  contract_id:"fixture",contract_version:"STAT1-CONTRACT-v2",contract_hash:`hash-${ids.join("-")}`,...patch,
});

test("WB-4-A-29 pattern keeps ungraded C, removes resolved A/B/D, and adds new E",()=>{
  const old=attempt(1,"2026-08-01",[finding("A"),finding("B"),finding("C"),finding("D")]);
  const newer=attempt(2,"2026-08-05",[
    finding("A","none",true),finding("B","none",true),finding("D","none",true),finding("E","N",false),
  ]);
  const audit=analyzeReviewReconciliation({attempts:[old,newer],reviews:[review(10,1,["A","B","C","D"])],today:"2026-08-10"});
  const plan=audit.problems.find(row=>row.problemId==="WB-4-A-29");
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.id),["C","E"]);
  assert.equal(plan.reviewsToSupersede[0].category,"partially_stale_repair");
  assert.equal(plan.desiredSourceAttemptId,2);
  assert.equal(plan.replacementRequired,true);
});

test("a target omitted by the latest targeted patch is not guessed resolved",()=>{
  const old=attempt(1,"2026-08-01",[finding("A"),finding("C")]);
  const newer=attempt(2,"2026-08-05",[finding("A","none",true)]);
  const audit=analyzeReviewReconciliation({attempts:[old,newer],reviews:[review(10,1,["A","C"])],today:"2026-08-10"});
  assert.deepEqual(audit.problems[0].desiredRepairParts.map(row=>row.id),["C"]);
});

test("the newest eligible finding replaces mutable payload without changing stable identity",()=>{
  const stableTargetKey="target:WB-4-A-29:root:00000000-0000-4000-8000-000000000099";
  const oldPart={...part("part:WB-4-A-29:1:1"),label:"A/B/C/Dの古い広範囲な失敗",stableTargetKey};
  const newPart={...oldPart,id:"part:WB-4-A-29:2:1"};
  const old=attempt(1,"2026-08-01",[finding(oldPart.id,"N",false,"A/B/C/Dが未解決")],{
    grading_contract:{...contract([oldPart.id]),gradedParts:[oldPart]},
  });
  const newer=attempt(2,"2026-08-05",[finding(newPart.id,"N",false,"Dだけが未解決")],{
    next_action:"Dだけを再現する",saved_at:"2026-08-05T12:00:00Z",
    grading_contract:{...contract([newPart.id]),sourceAttemptId:2,gradedParts:[newPart]},
  });
  const stalePart={...newPart,label:"A/B/C/Dの古い広範囲な失敗"};
  const current=review(10,2,[newPart.id],{
    grading_contract:{...contract([newPart.id]),sourceAttemptId:2,gradedParts:[stalePart]},
  });
  const plan=analyzeReviewReconciliation({attempts:[old,newer],reviews:[current],today:"2026-08-10"}).problems[0];
  assert.equal(plan.desiredRepairParts[0].stableTargetKey,stableTargetKey);
  assert.equal(plan.desiredRepairParts[0].label,"Dだけが未解決");
  assert.equal(plan.desiredRepairParts[0].currentEvidence,"Dだけが未解決");
  assert.equal(plan.desiredRepairParts[0].evidenceSourceAttemptId,2);
  assert.equal(plan.stalePayloadCount,1);
  assert.equal(plan.replacementRequired,true);
});

test("a later full answer does not guess that differently-keyed targets were graded",()=>{
  const old=attempt(1,"2026-08-01",[finding("old-broad-A"),finding("old-broad-B")]);
  const newer=attempt(2,"2026-08-05",[finding("current-N","N",false)],{
    mode:"full",review_scope:"full_answer",
    grading_contract:{...contract(["current-N"]),mode:"full",reviewScope:"full_answer"},
  });
  const plan=analyzeReviewReconciliation({attempts:[old,newer],
    reviews:[review(10,1,["old-broad-A","old-broad-B"])],today:"2026-08-10"}).problems[0];
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.id),["current-N","old-broad-A","old-broad-B"]);
});

test("a later full answer updates old targets when their stable slots are explicit",()=>{
  const a=part("part:WB-4-A-29:1:1"),b=part("part:WB-4-A-29:1:2");
  a.stableTargetKey="target:WB-4-A-29:root:00000000-0000-4000-8000-000000000001";
  b.stableTargetKey="target:WB-4-A-29:root:00000000-0000-4000-8000-000000000002";
  const old=attempt(1,"2026-08-01",[finding(a.id),finding(b.id)],{
    grading_contract:{...contract([a.id]),gradedParts:[a,b]},graded_part_ids:[a.id,b.id],graded_parts:[a.id,b.id],
  });
  const a2={...a,id:"part:WB-4-A-29:2:1"},b2={...b,id:"part:WB-4-A-29:2:2"},e={...part("new-E"),stableTargetKey:"target:WB-4-A-29:slot:new-E"};
  const newer=attempt(2,"2026-08-05",[
    finding(a2.id,"none",true),finding(b2.id,"none",true),finding(e.id,"N",false),
  ],{mode:"full",review_scope:"full_answer",grading_contract:{...contract([a2.id,b2.id,e.id]),mode:"full",reviewScope:"full_answer",gradedParts:[a2,b2,e]}});
  const oldReview=review(10,1,[a.id,b.id],{grading_contract:{...contract([a.id,b.id]),gradedParts:[a,b]}});
  const plan=analyzeReviewReconciliation({attempts:[old,newer],reviews:[oldReview],today:"2026-08-10"}).problems[0];
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.stableTargetKey),["target:WB-4-A-29:slot:new-E"]);
  assert.equal(plan.reviewsToSupersede[0].category,"stale_repair");
});

test("all repaired targets end the old repair",()=>{
  const old=attempt(1,"2026-08-01",[finding("A"),finding("B")]);
  const newer=attempt(2,"2026-08-05",[finding("A","none",true),finding("B","none",true)]);
  const plan=analyzeReviewReconciliation({attempts:[old,newer],reviews:[review(10,1,["A","B"])],today:"2026-08-10"}).problems[0];
  assert.deepEqual(plan.desiredRepairParts,[]);
  assert.equal(plan.reviewsToSupersede[0].category,"contradictory_review");
});

test("a delayed check sourced from an unresolved Attempt is stale",()=>{
  const failed=attempt(2,"2026-08-05",[finding("A","N",false)]);
  const delayed=review(12,2,["A"],{learning_purpose:"retrieval_check",grading_contract:contract(["A"],"retrieval_check")});
  const plan=analyzeReviewReconciliation({attempts:[failed],reviews:[delayed],today:"2026-08-10"}).problems[0];
  assert.equal(plan.reviewsToSupersede[0].category,"stale_delayed_check");
  assert.equal(plan.replacementRequired,true);
});

test("past exam major W/N with correction feedback remains error_repair until success evidence",()=>{
  const failed=attempt(223,"2026-08-29",[finding("major-calculation","W",false),finding("answer-conclusion","N",false)],{
    problem_id:"PY-2017-Q3",score_numeric:58,review_outcome:"partial",saved_gpt_feedback:true,
    learning_event_kind:"assessment",next_action:"訂正方法を確認した",parent_past_session_id:18,
    grading_contract:{...contract(["major-calculation","answer-conclusion"]),problemId:"PY-2017-Q3",sourceAttemptId:223},
  });
  const plan=analyzeReviewReconciliation({attempts:[failed],reviews:[],today:"2026-08-30"}).problems[0];
  assert.equal(plan.desiredReviewPurpose,"error_repair");
});

test("feedback alone does not supersede an existing repair with delayed retrieval",()=>{
  const stableTargetKey="target:WB-4-A-29:root:00000000-0000-4000-8000-000000000055";
  const stablePart={...part("A"),stableTargetKey,currentLabel:"A-evidence",currentEvidence:"A-evidence",
    currentErrorType:"N",currentCorrection:"Aをその場で訂正済み",evidenceSourceAttemptId:2,evidenceUpdatedAt:"2026-08-05"};
  const failed=attempt(2,"2026-08-05",[finding("A","N",false)],{next_action:"Aをその場で訂正済み",saved_gpt_feedback:true,
    learning_event_kind:"assessment",grading_contract:{...contract(["A"]),sourceAttemptId:2,gradedParts:[stablePart]}});
  const repairRow=review(11,2,["A"],{learning_purpose:"error_repair",
    grading_contract:{...contract(["A"],"error_repair"),sourceAttemptId:2,gradedParts:[stablePart]}});
  const delayed=review(12,2,["A"],{review_type:"light_check",learning_purpose:"retrieval_check",
    assessment_timing:"delayed_retrieval",correction_provided:true,retention_pending:true,
    grading_contract:{...contract(["A"],"retrieval_check"),sourceAttemptId:2,gradedParts:[stablePart]}});
  const plan=analyzeReviewReconciliation({attempts:[failed],reviews:[repairRow,delayed],today:"2026-08-10"}).problems[0];
  assert.equal(plan.desiredReviewPurpose,"error_repair");
  assert.equal(plan.reviewsToSupersede.some(row=>row.reviewId===12),true);
  assert.equal(plan.reviewsToSupersede.some(row=>row.reviewId===11),false);
  assert.equal(plan.replacementRequired,false);
});

test("a superseded repair without success evidence rolls an active retrieval back to repair",()=>{
  const stableTargetKey="target:WB-4-A-29:root:00000000-0000-4000-8000-000000000056";
  const stablePart={...part("A"),stableTargetKey,currentLabel:"A-evidence",currentEvidence:"A-evidence",
    currentErrorType:"W",currentCorrection:"Aを訂正",evidenceSourceAttemptId:223,evidenceUpdatedAt:"2026-08-29"};
  const failed=attempt(223,"2026-08-29",[finding("A","W",false)],{next_action:"Aを訂正",saved_gpt_feedback:true,
    learning_event_kind:"assessment",grading_contract:{...contract(["A"]),sourceAttemptId:223,gradedParts:[stablePart]}});
  const oldRepair=review(436,223,["A"],{status:"superseded",learning_purpose:"error_repair",
    grading_contract:{...contract(["A"],"error_repair"),sourceAttemptId:223,gradedParts:[stablePart]}});
  const currentCheck=review(437,223,["A"],{learning_purpose:"retrieval_check",correction_provided:true,retention_pending:true,
    grading_contract:{...contract(["A"],"retrieval_check"),sourceAttemptId:223,gradedParts:[stablePart]}});
  const plan=analyzeReviewReconciliation({attempts:[failed],reviews:[oldRepair,currentCheck],today:"2026-08-30"}).problems[0];
  assert.equal(plan.desiredReviewPurpose,"error_repair");
  assert.equal(plan.reviewsToSupersede.some(row=>row.reviewId===437),true);
  assert.equal(plan.replacementRequired,true);
});

test("explicit success on another problem substitutes the same-problem delayed Review",()=>{
  const failed=attempt(2,"2026-08-05",[finding("A","N",false)],{next_action:"Aを訂正",saved_gpt_feedback:true});
  const transfer={...attempt(3,"2026-08-08",[],{problem_id:"PY-2021-Q1",source_problem_id:"WB-4-A-29",
    transfer_evidence:true,learning_purpose:"transfer_check",assessment_timing:"independent_performance",
    review_outcome:"success",error_type:"none",error_types:["none"],actual_reference_level:0}),graded_part_ids:[],graded_findings:[]};
  const delayed=review(12,2,["A"],{review_type:"light_check",learning_purpose:"retrieval_check",
    assessment_timing:"delayed_retrieval",grading_contract:contract(["A"],"retrieval_check")});
  const plan=analyzeReviewReconciliation({attempts:[failed,transfer],reviews:[delayed],today:"2026-08-10"})
    .problems.find(row=>row.problemId==="WB-4-A-29");
  assert.deepEqual(plan.desiredRepairParts,[]);
  assert.match(plan.reviewsToSupersede[0].reason,/transfer成功/);
});

test("duplicate active repairs reconcile to one current target set",()=>{
  const old=attempt(1,"2026-08-01",[finding("A")]);
  const rows=[review(10,1,["A"]),review(11,1,["A"])];
  const plan=analyzeReviewReconciliation({attempts:[old],reviews:rows,today:"2026-08-10"}).problems[0];
  assert.equal(plan.reviewsToSupersede.length,1);
  assert.equal(plan.reviewsToSupersede[0].category,"duplicate_active_review");
});

test("objective delayed retrieval graduation closes same-problem repair and check",()=>{
  const old=attempt(1,"2026-08-01",[finding("A")]);
  const graduated=attempt(2,"2026-08-08",[finding("A","none",true)],{
    mark:"◎",learning_purpose:"retrieval_check",minimum_pass_condition_met:true,target_issue_resolved:true,
  });
  const delayed=review(12,1,["A"],{learning_purpose:"retrieval_check",grading_contract:contract(["A"],"retrieval_check")});
  const plan=analyzeReviewReconciliation({attempts:[old,graduated],reviews:[review(10,1,["A"]),delayed],today:"2026-08-10"}).problems[0];
  assert.equal(plan.graduated,true);
  assert.equal(plan.reviewsToSupersede.filter(row=>row.category==="graduated_but_pending").length,2);
});

test("a retrieval successor generated from the graduating Attempt itself is closed",()=>{
  const graduated=attempt(2,"2026-08-08",[finding("A","none",true)],{
    mark:"◎",learning_purpose:"retrieval_check",minimum_pass_condition_met:true,target_issue_resolved:true,
  });
  const delayed=review(12,2,["A"],{learning_purpose:"retrieval_check",grading_contract:contract(["A"],"retrieval_check")});
  const plan=analyzeReviewReconciliation({attempts:[graduated],reviews:[delayed],today:"2026-08-10"}).problems[0];
  assert.equal(plan.graduated,true);
  assert.equal(plan.reviewsToSupersede[0].category,"graduated_but_pending");
});

test("scan-only evidence never creates or resolves mathematical repair targets",()=>{
  const old=attempt(1,"2026-08-01",[finding("A")]);
  const scan=attempt(2,"2026-08-05",[finding("A","none",true)],{mode:"scan5",evaluation_scope:"scan_only"});
  const plan=analyzeReviewReconciliation({attempts:[old,scan],reviews:[review(10,1,["A"])],today:"2026-08-10"}).problems[0];
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.id),["A"]);
  assert.equal(plan.reviewsToSupersede.length,0);
});

test("a stale Today Plan copy is overlaid from current Review while the stored snapshot remains input-only",()=>{
  const old=attempt(1,"2026-08-01",[finding("A")]);
  const newer=attempt(2,"2026-08-05",[finding("A","none",true),finding("E")]);
  const currentPart={...part("E"),label:"E-evidence",currentLabel:"E-evidence",currentEvidence:"E-evidence",
    currentErrorType:"N",evidenceSourceAttemptId:2,evidenceUpdatedAt:"2026-08-05"};
  const stale=review(10,1,["A"]),current=review(11,2,["E"],{
    grading_contract:{...contract(["E"]),sourceAttemptId:2,gradedParts:[currentPart]},
  });
  const snapshot={date:"2026-08-10",task_ids:["review:10"],start_of_day_planned_minutes:5,
    initial_bucket:{"review:10":"must"},initial_estimated_minutes:{"review:10":5},created_at:"fixture",
    tasks:[{id:10,problem_id:"WB-4-A-29",title:"fixture",kind:"復習",reason:"old",mode:"check",minutes:5,load:.2,review_type:"targeted_patch"}]};
  const audit=analyzeReviewReconciliation({attempts:[old,newer],reviews:[stale,current],today:"2026-08-10",todayPlanSnapshots:[snapshot]});
  assert.equal(audit.staleTodayActions,0);
  assert.equal(snapshot.tasks[0].id,10);
});

test("historical Today Plan wording remains immutable history and is not an obsolete current action",()=>{
  const old=attempt(1,"2026-08-01",[finding("A")]);
  const newer=attempt(2,"2026-08-05",[finding("A","none",true),finding("E")]);
  const stale=review(10,1,["A"]),current=review(11,2,["E"]);
  const snapshot={date:"2026-08-09",task_ids:["review:10"],start_of_day_planned_minutes:5,
    initial_bucket:{"review:10":"must"},initial_estimated_minutes:{"review:10":5},created_at:"fixture",
    tasks:[{id:10,problem_id:"WB-4-A-29",title:"fixture",kind:"review",reason:"old",mode:"check",minutes:5,load:.2,review_type:"targeted_patch"}]};
  const audit=analyzeReviewReconciliation({attempts:[old,newer],reviews:[stale,current],today:"2026-08-10",todayPlanSnapshots:[snapshot]});
  assert.equal(audit.staleTodayActions,0);
});
