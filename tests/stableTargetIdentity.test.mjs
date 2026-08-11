import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStableTargetIndex,isValidStableTargetKey,issueStableTargetKey,
} from "../src/stableTargetIdentity.ts";
import {analyzeReviewReconciliation} from "../src/reviewReconciliation.ts";
import {runIntegrityAudit} from "../src/integrityEngine.ts";

const problemId="WB-4-A-29";
const uuid=index=>`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`;
const root=index=>`target:${problemId}:root:${uuid(index)}`;
const legacy=(reviewId,index)=>`target:${problemId}:review:${reviewId}:slot:${index}`;
const part=(id,stableTargetKey,label=id)=>({id,label,cueLabel:label,allowedErrorTypes:["K","W","N","C","none"],
  completionCriterionId:`criterion:${id}`,...(stableTargetKey?{stableTargetKey}:{})});
const contract=(parts,purpose="error_repair")=>({contractId:"fixture",contractVersion:"v2",contractHash:"fixture",
  createdAt:"2026-08-01",problemId,learningPurpose:purpose,learningStage:"repair",mode:"check",
  reviewScope:purpose==="error_repair"?"targeted_patch":"check_only",targetKind:"mathematical_patch",
  targetedParts:parts.map(row=>row.label),gradedParts:parts,explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],
  completionCriteria:[],completionConditions:[],requiredEvidence:[],allowedErrorTypes:["K","W","N","C"],
  requiresKEvidence:true,hiddenAnswerKey:[],allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet"});
const finding=(id,resolved=false)=>({graded_part_id:id,error_type:resolved?"none":"N",evidence:id,resolved});
const attempt=(id,parts,findings,patch={})=>({id,problem_id:problemId,date:`2026-08-${String(Math.min(id,28)).padStart(2,"0")}`,
  mode:"check",time_minutes:5,mark:"△",score_label:"B",error_type:findings.some(row=>!row.resolved)?"N":"none",
  error_types:findings.some(row=>!row.resolved)?["N"]:["none"],error_point:"",next_action:"",memo:"",
  graded_part_ids:parts.map(row=>row.id),graded_parts:parts.map(row=>row.label),graded_findings:findings,
  grading_contract:contract(parts),minimum_pass_condition_met:findings.every(row=>row.resolved),
  target_issue_resolved:findings.every(row=>row.resolved),actual_reference_level:0,...patch});
const review=(id,sourceAttemptId,parts,patch={})=>({id,problem_id:problemId,due_date:"2026-08-20",
  review_type:"targeted_patch",status:"pending",generated_from_attempt_id:sourceAttemptId,
  source_attempt_id:sourceAttemptId,learning_purpose:"error_repair",assessment_timing:"delayed_retrieval",
  grading_contract:contract(parts),graded_part_ids:parts.map(row=>row.id),...patch});

test("legacy Review/Attempt identities are never accepted as stable target keys",()=>{
  assert.equal(isValidStableTargetKey(problemId,legacy(286,1)),false);
  assert.equal(isValidStableTargetKey(problemId,`target:${problemId}:attempt:172:slot:1`),false);
  assert.equal(isValidStableTargetKey(problemId,`target:${problemId}:submission:abc:slot:1`),false);
  const issued=issueStableTargetKey(problemId);
  const nextIssued=issueStableTargetKey(problemId);
  assert.equal(isValidStableTargetKey(problemId,issued),true);
  assert.notEqual(nextIssued,issued);
  assert.doesNotMatch(issued,/:review:|:attempt:|:submission:/);
});

test("explicit Review lineage keeps one identity before backfill without persisting row ids",()=>{
  const first=part(`part:${problemId}:1:1`),second=part(`part:${problemId}:2:1`);
  const sourceReview=review(40,1,[first]);
  const child=attempt(2,[first],[finding(first.id)],{source_review_id:40,generated_from_review_id:40});
  const successor=review(41,2,[second]);
  const index=buildStableTargetIndex({attempts:[attempt(1,[],[]),child],reviews:[sourceReview,successor]});
  const left=index.reviewPart(40,first.id),right=index.reviewPart(41,second.id);
  assert.equal(left.identityKey,right.identityKey);
  assert.equal(index.attemptPart(2,first.id).identityKey,right.identityKey);
  assert.equal(right.key,undefined);
  assert.equal(right.needsBackfill,true);
});

test("one persistent root survives three Review and Attempt generations unchanged",()=>{
  const key=root(1);
  const p1=part(`part:${problemId}:1:1`,key),p2=part(`part:${problemId}:2:1`),
    p3=part(`part:${problemId}:3:1`),p4=part(`part:${problemId}:4:1`);
  const r1=review(10,1,[p1]);
  const a2=attempt(2,[p1],[finding(p1.id)],{source_review_id:10,generated_from_review_id:10});
  const r2=review(20,2,[p2]);
  const a3=attempt(3,[p2],[finding(p2.id)],{source_review_id:20,generated_from_review_id:20});
  const r3=review(30,3,[p3]);
  const a4=attempt(4,[p3],[finding(p3.id)],{source_review_id:30,generated_from_review_id:30});
  const r4=review(40,4,[p4]);
  const index=buildStableTargetIndex({attempts:[attempt(1,[],[]),a2,a3,a4],reviews:[r1,r2,r3,r4]});
  const keys=[index.reviewPart(10,p1.id),index.attemptPart(2,p1.id),index.reviewPart(20,p2.id),
    index.attemptPart(3,p2.id),index.reviewPart(30,p3.id),index.attemptPart(4,p3.id),index.reviewPart(40,p4.id)]
    .filter(Boolean).map(row=>row.key);
  assert.deepEqual(keys,[key,key,key,key,key,key,key]);
});

test("same stable target is represented at most once in current active repair",()=>{
  const key=root(2);
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

function wb429Fixture(){
  const rows=(generation,reviewId,slots)=>slots.map(slot=>
    part(`part:${problemId}:${generation}:${slot}`,legacy(reviewId,slot),`target-${slot}`));
  const pit=reviewId=>part("probability_integral_transform_explanation",legacy(reviewId,6),"PIT explanation");
  const p93=rows(93,286,[1,2]);
  const p119=[...rows(119,296,[1,2,3,4,5]),pit(296),...rows(119,296,[7])];
  const p136=[...rows(136,313,[1,2,3,4,5]),pit(313),...rows(136,313,[7,8])];
  const p150=[...rows(150,327,[1,2,3,4,5]),pit(327),...rows(150,327,[7,8])];
  const a93={...attempt(93,[],[]),graded_part_ids:[],graded_parts:[],graded_findings:[],grading_contract:undefined};
  const r286=review(286,93,p93,{status:"done"});
  const a119=attempt(119,p93,p93.map(row=>finding(row.id)),{source_review_id:286,generated_from_review_id:286});
  const r296=review(296,119,p119,{status:"done"});
  const a136=attempt(136,p119,p119.map((row,index)=>finding(row.id,[2,3,5].includes(index))),
    {source_review_id:296,generated_from_review_id:296});
  const r313=review(313,136,p136,{status:"done"});
  const a150=attempt(150,p136,p136.map((row,index)=>finding(row.id,index!==5)),
    {source_review_id:313,generated_from_review_id:313});
  const r327=review(327,150,p150,{status:"done"});
  const a172=attempt(172,p150,p150.map((row,index)=>finding(row.id,[1,2,3,6].includes(index))),
    {source_review_id:327,generated_from_review_id:327});
  // Production Review 363 accumulated two oldest targets, four intermediate
  // targets and the four still-unresolved current targets.
  const bloated=[...p93,p119[0],p119[1],p119[4],p119[6],p150[0],p150[4],p150[7],p150[5]];
  const r363=review(363,172,bloated);
  return {attempts:[a93,a119,a136,a150,a172],reviews:[r286,r296,r313,r327,r363],active:r363};
}

test("WB-4-A-29 production lineage shrinks ten current rows to four unresolved roots",()=>{
  const fixture=wb429Fixture();
  const plan=analyzeReviewReconciliation({...fixture,today:"2026-08-20"}).problems.find(row=>row.problemId===problemId);
  assert.equal(plan.activeReviewTargetCount,10);
  assert.equal(plan.distinctStableTargetCount,6);
  assert.equal(plan.multiGenerationDuplicateCount,4);
  assert.equal(plan.desiredRepairParts.length,4);
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.id).sort(),[
    `part:${problemId}:150:1`,`part:${problemId}:150:5`,`part:${problemId}:150:8`,"probability_integral_transform_explanation",
  ].sort());
  assert.equal(plan.desiredRepairParts.some(row=>/:93:|:119:/.test(row.id)),false);
  assert.equal(plan.replacementRequired,true);
  const audit=runIntegrityAudit({...fixture,today:"2026-08-20"});
  assert.equal(audit.counts.invalid_stable_target_key>0,true);
  assert.equal(audit.counts.duplicate_stable_target>0,true);
  assert.equal(audit.counts.current_review_target_mismatch>0,true);
  assert.equal(audit.activeIssueCount>0,true);
});

test("an omitted targeted-patch slot remains unresolved while an evaluated slot resolves",()=>{
  const ka=root(11),kb=root(12);
  const a=part(`part:${problemId}:1:1`,ka),b=part(`part:${problemId}:1:2`,kb);
  const a2=part(`part:${problemId}:2:1`,ka);
  const plan=analyzeReviewReconciliation({attempts:[attempt(1,[a,b],[finding(a.id),finding(b.id)]),
    attempt(2,[a2],[finding(a2.id,true)])],reviews:[review(10,1,[a,b])],today:"2026-08-20"}).problems[0];
  assert.deepEqual(plan.desiredRepairParts.map(row=>row.stableTargetKey),[kb]);
});

test("ambiguous legacy roots are reported rather than fuzzy-merged",()=>{
  const row=part(`part:${problemId}:99:1`);
  const index=buildStableTargetIndex({attempts:[attempt(99,[row],[finding(row.id)])],reviews:[]});
  assert.equal(index.attemptPart(99,row.id).identityKey,undefined);
  assert.equal(index.ambiguousTargetCount,1);
});

test("past-exam scan-only never creates mathematical stable evidence",()=>{
  const row=part("problem_type");
  const scan=attempt(1,[row],[finding(row.id)],{problem_id:"PY-2021-Q1",mode:"full",evaluation_scope:"scan_only"});
  const audit=analyzeReviewReconciliation({attempts:[scan],reviews:[],today:"2026-08-20"});
  assert.equal(audit.problems.length,0);
});

test("past-exam full and timed evidence inherit the same persistent root",()=>{
  const pastId="PY-2021-Q1",key=`target:${pastId}:root:${uuid(30)}`;
  const first=part(`part:${pastId}:1:1`,key),second=part(`part:${pastId}:2:1`,key);
  const pastContract=(parts)=>({...contract(parts),problemId:pastId,gradedParts:parts,
    targetedParts:parts.map(row=>row.label)});
  const source={...attempt(1,[first],[finding(first.id)]),problem_id:pastId,mode:"full",evaluation_scope:"full",
    grading_contract:pastContract([first])};
  const repair={...review(10,1,[first]),problem_id:pastId,grading_contract:pastContract([first])};
  const timed={...attempt(2,[second],[finding(second.id)]),problem_id:pastId,mode:"full",evaluation_scope:"timed",
    source_review_id:10,generated_from_review_id:10,grading_contract:pastContract([second])};
  const index=buildStableTargetIndex({attempts:[source,timed],reviews:[repair]});
  assert.equal(index.reviewPart(10,first.id).key,key);
  assert.equal(index.attemptPart(2,second.id).key,key);
  const audit=analyzeReviewReconciliation({attempts:[source,timed],reviews:[repair],today:"2026-08-20"});
  assert.equal(audit.problems[0].desiredRepairParts.length,1);
});

test("reconciliation is idempotent for an already normalized active Review",()=>{
  const key=root(20),row=part(`part:${problemId}:1:1`,key);
  const args={attempts:[attempt(1,[row],[finding(row.id)])],reviews:[review(10,1,[row])],today:"2026-08-20"};
  const first=analyzeReviewReconciliation(args),second=analyzeReviewReconciliation(args);
  assert.deepEqual(second.problems,first.problems);
  assert.equal(first.problems[0].replacementRequired,false);
});
