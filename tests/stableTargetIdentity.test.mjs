import test from "node:test";
import assert from "node:assert/strict";
import {buildStableTargetIndex} from "../src/stableTargetIdentity.ts";
import {analyzeReviewReconciliation} from "../src/reviewReconciliation.ts";

const problemId="WB-4-A-29";
const part=(id,stableTargetKey)=>({id,label:id,cueLabel:id,allowedErrorTypes:["K","W","N","C","none"],
  completionCriterionId:`criterion:${id}`,...(stableTargetKey?{stableTargetKey}:{})});
const contract=(parts,purpose="error_repair")=>({contractId:"fixture",contractVersion:"v2",contractHash:"fixture",
  createdAt:"2026-08-01",problemId,learningPurpose:purpose,learningStage:"repair",mode:"check",
  reviewScope:purpose==="error_repair"?"targeted_patch":"check_only",targetKind:"mathematical_patch",
  targetedParts:parts.map(row=>row.label),gradedParts:parts,explicitlyOutOfScopePartIds:[],completionCriteria:[],
  hiddenAnswerKey:[],allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet"});
const finding=(id,resolved=false)=>({graded_part_id:id,error_type:resolved?"none":"N",evidence:id,resolved});
const attempt=(id,parts,findings,patch={})=>({id,problem_id:problemId,date:`2026-08-${String(id).padStart(2,"0")}`,
  mode:"check",time_minutes:5,mark:"△",score_label:"B",error_type:findings.some(row=>!row.resolved)?"N":"none",
  error_types:findings.some(row=>!row.resolved)?["N"]:["none"],error_point:"",next_action:"",memo:"",
  graded_part_ids:parts.map(row=>row.id),graded_parts:parts.map(row=>row.label),graded_findings:findings,
  grading_contract:contract(parts),minimum_pass_condition_met:findings.every(row=>row.resolved),
  target_issue_resolved:findings.every(row=>row.resolved),actual_reference_level:0,...patch});
const review=(id,sourceAttemptId,parts,patch={})=>({id,problem_id:problemId,due_date:"2026-08-20",
  review_type:"targeted_patch",status:"pending",generated_from_attempt_id:sourceAttemptId,
  source_attempt_id:sourceAttemptId,learning_purpose:"error_repair",assessment_timing:"delayed_retrieval",
  grading_contract:contract(parts),graded_part_ids:parts.map(row=>row.id),...patch});

test("explicit Review lineage keeps one stable identity across Attempt-specific raw IDs",()=>{
  const first=part(`part:${problemId}:1:1`),second=part(`part:${problemId}:2:1`);
  const sourceReview=review(40,1,[first]);
  const child=attempt(2,[second],[finding(second.id)],{source_review_id:40,generated_from_review_id:40});
  const index=buildStableTargetIndex({attempts:[attempt(1,[first],[finding(first.id)]),child],reviews:[sourceReview]});
  assert.equal(index.attemptPart(1,first.id).key,index.attemptPart(2,second.id).key);
  assert.equal(index.reviewPart(40,first.id).key,index.attemptPart(2,second.id).key);
});

test("same stable target is represented at most once in current active repair",()=>{
  const key=`target:${problemId}:review:40:slot:1`;
  const generations=[1,2,3].map(id=>part(`part:${problemId}:${id}:1`,key));
  const attempts=generations.map((row,index)=>attempt(index+1,[row],[finding(row.id)]));
  const bloated=review(50,3,generations);
  const plan=analyzeReviewReconciliation({attempts,reviews:[bloated],today:"2026-08-20"}).problems[0];
  assert.equal(plan.activeReviewTargetCount,3);
  assert.equal(plan.distinctStableTargetCount,1);
  assert.equal(plan.multiGenerationDuplicateCount,2);
  assert.equal(plan.desiredRepairParts.length,1);
  assert.equal(plan.replacementRequired,true);
});

test("WB-4-A-29 shape shrinks 17 generations to four unresolved stable targets",()=>{
  const keys=Array.from({length:8},(_,index)=>`target:${problemId}:review:501:slot:${index+1}`);
  const p150=keys.map((key,index)=>part(`part:${problemId}:150:${index+1}`,key));
  const p172=keys.map((key,index)=>part(`part:${problemId}:172:${index+1}`,key));
  const a150=attempt(150,p150,p150.map(row=>finding(row.id)));
  const a172=attempt(172,p172,p172.map((row,index)=>finding(row.id,index<4)));
  const thirdGeneration=part(`part:${problemId}:119:1`,keys[0]);
  const seventeen=[...p150,...p172,thirdGeneration];
  const active=review(600,172,seventeen);
  const plan=analyzeReviewReconciliation({attempts:[a150,a172],reviews:[active],today:"2026-08-20"}).problems[0];
  assert.equal(plan.activeReviewTargetCount,17);
  assert.equal(plan.distinctStableTargetCount,8);
  assert.equal(plan.multiGenerationDuplicateCount,9);
  assert.equal(plan.desiredRepairParts.length,4);
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.stableTargetKey),keys.slice(4));
});

test("an omitted targeted-patch slot remains unresolved while an evaluated slot resolves",()=>{
  const ka=`target:${problemId}:review:1:slot:1`,kb=`target:${problemId}:review:1:slot:2`;
  const a=part(`part:${problemId}:1:1`,ka),b=part(`part:${problemId}:1:2`,kb);
  const a2=part(`part:${problemId}:2:1`,ka);
  const plan=analyzeReviewReconciliation({attempts:[attempt(1,[a,b],[finding(a.id),finding(b.id)]),
    attempt(2,[a2],[finding(a2.id,true)])],reviews:[review(10,1,[a,b])],today:"2026-08-20"}).problems[0];
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.stableTargetKey),[kb]);
});

test("ambiguous legacy roots are reported rather than fuzzy-merged",()=>{
  const row=part(`part:${problemId}:99:1`);
  const index=buildStableTargetIndex({attempts:[attempt(99,[row],[finding(row.id)])],reviews:[]});
  assert.equal(index.attemptPart(99,row.id).key,undefined);
  assert.equal(index.ambiguousTargetCount,1);
});

test("past-exam scan-only never creates mathematical stable evidence",()=>{
  const row=part("problem_type");
  const scan=attempt(1,[row],[finding(row.id)],{problem_id:"PY-2021-Q1",mode:"scan5",evaluation_scope:"scan_only"});
  const audit=analyzeReviewReconciliation({attempts:[scan],reviews:[],today:"2026-08-20"});
  assert.equal(audit.problems.length,0);
});

test("reconciliation is idempotent for an already normalized active Review",()=>{
  const key=`target:${problemId}:review:1:slot:1`,row=part(`part:${problemId}:1:1`,key);
  const args={attempts:[attempt(1,[row],[finding(row.id)])],reviews:[review(10,1,[row])],today:"2026-08-20"};
  const first=analyzeReviewReconciliation(args),second=analyzeReviewReconciliation(args);
  assert.deepEqual(second.problems,first.problems);
  assert.equal(first.problems[0].replacementRequired,false);
});
