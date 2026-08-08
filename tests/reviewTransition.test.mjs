import test from "node:test";
import assert from "node:assert/strict";
import { resolveLearningPolicy } from "../src/learningPolicyResolver.ts";
import { isObjectiveDelayedRetrievalSuccess,resolveReviewTransition } from "../src/reviewTransition.ts";

test("same-session success never counts as retention",()=>{
  const prescription=resolveLearningPolicy({problemId:"WB-6-A-20",source:{error_types:["W"],assessment_timing:"same_session_correction"}});
  const result=resolveReviewTransition({prescription,result:"success",referenceClosedReproduction:true});
  assert.equal(result.retentionSuccess,false);
  assert.equal(result.nextTiming,"delayed_retrieval");
});

test("delayed repair success transitions to integration",()=>{
  const prescription=resolveLearningPolicy({problemId:"WB-6-A-20",source:{error_types:["N"],assessment_timing:"delayed_retrieval",learning_purpose:"error_repair"}});
  const result=resolveReviewTransition({prescription,result:"success",referenceClosedReproduction:true});
  assert.equal(result.retentionSuccess,true);
  assert.equal(result.nextPurpose,"integration_check");
});

const objectiveEvidence=(overrides={})=>({assessmentTiming:"delayed_retrieval",result:"success",actualReferenceLevel:0,
  hintUsed:false,targetIssueResolved:true,minimumPassConditionMet:true,errorTypes:["none"],unresolvedCarryover:[],
  gradedPartIds:["part-a","part-b"],gradedFindings:[
    {graded_part_id:"part-a",error_type:"none",resolved:true},
    {graded_part_id:"part-b",error_type:"none",resolved:true},
  ],...overrides});

test("v9の客観的な遅延想起成功はmarkに依存せずretrieval系列を卒業する",()=>{
  assert.equal(isObjectiveDelayedRetrievalSuccess(objectiveEvidence()),true);
  const prescription=resolveLearningPolicy({problemId:"WB-2-A-24",source:{error_types:["none"],assessment_timing:"delayed_retrieval",learning_purpose:"retrieval_check"}});
  const transition=resolveReviewTransition({prescription,result:"success",referenceClosedReproduction:true,objectiveRetentionSuccess:true});
  assert.equal(transition.retentionSuccess,true);
  assert.equal(transition.nextPurpose,undefined);
  assert.equal(transition.userSelectionRequired,true);
});

test("参照・ヒント・未解決・finding失敗のいずれかがあれば卒業しない",()=>{
  assert.equal(isObjectiveDelayedRetrievalSuccess(objectiveEvidence({actualReferenceLevel:1})),false);
  assert.equal(isObjectiveDelayedRetrievalSuccess(objectiveEvidence({hintUsed:true})),false);
  assert.equal(isObjectiveDelayedRetrievalSuccess(objectiveEvidence({unresolvedCarryover:["残り"]})),false);
  assert.equal(isObjectiveDelayedRetrievalSuccess(objectiveEvidence({gradedFindings:[
    {graded_part_id:"part-a",error_type:"W",resolved:false},
    {graded_part_id:"part-b",error_type:"none",resolved:true},
  ]})),false);
});
