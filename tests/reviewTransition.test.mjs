import test from "node:test";
import assert from "node:assert/strict";
import { resolveLearningPolicy } from "../src/learningPolicyResolver.ts";
import { resolveReviewTransition } from "../src/reviewTransition.ts";

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
