import test from "node:test";
import assert from "node:assert/strict";
import { problemTypeStable, resolveLearningPolicy } from "../src/learningPolicyResolver.ts";

test("same-session correction is local, at most five minutes, and never proves retention",()=>{
  const result=resolveLearningPolicy({problemId:"WB-6-A-20",source:{error_types:["K"],assessment_timing:"same_session_correction",review_scope:"full_skeleton",targeted_parts:["入口"]}});
  assert.equal(result.assessmentTiming,"same_session_correction");
  assert.equal(result.reviewScope,"targeted_patch");
  assert.ok(result.estimatedMinutes<=5);
  assert.notEqual(result.mode,"full");
  assert.equal(result.successTransition,"delayed_retrieval");
});

test("explicit targeted patch remains targeted even when mode is skeleton",()=>{
  const result=resolveLearningPolicy({problemId:"WB-6-A-20",source:{mode:"skeleton",error_types:["N"],review_scope:"targeted_patch",targeted_parts:["定義域"]}});
  assert.equal(result.reviewScope,"targeted_patch");
  assert.deepEqual(result.targetedParts,["定義域"]);
  assert.ok(!result.completionConditions.join(" ").includes("8"));
});

test("same problem alone does not make a problem type stable",()=>{
  const base={id:1,date:"2026-07-18",mode:"full",time_minutes:30,mark:"◎",score_label:"A",score_numeric:80,error_type:"none",error_point:"",next_action:"",memo:"",problem_type_key:"MLE",exam_score_eligible:true,learning_purpose:"exam_performance"};
  assert.equal(problemTypeStable({problemTypeKey:"MLE",attempts:[{...base,problem_id:"WB-6-A-01"},{...base,id:2,problem_id:"WB-6-A-01"}]}),false);
  assert.equal(problemTypeStable({problemTypeKey:"MLE",attempts:[{...base,problem_id:"WB-6-A-01"},{...base,id:2,problem_id:"WB-6-A-02"}]}),true);
});
