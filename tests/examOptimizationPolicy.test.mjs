import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailureStrength,currentActionFingerprint,examHorizonPolicy,learningEventKind,
  retentionWindow,reviewPurposeAfterCorrection,
} from "../src/examOptimizationPolicy.ts";

test("corrective feedback and a delayed test are separate learning events",()=>{
  assert.equal(learningEventKind({purpose:"integration_check",timing:"independent_performance",isAssessment:true}),"assessment");
  assert.equal(learningEventKind({purpose:"error_repair",timing:"same_session_correction"}),"corrective_feedback");
  assert.equal(learningEventKind({purpose:"retrieval_check",timing:"delayed_retrieval"}),"delayed_retrieval");
  assert.equal(reviewPurposeAfterCorrection({attempt:{next_action:"積分範囲を訂正する"}}),"retrieval_check");
  assert.equal(reviewPurposeAfterCorrection({attempt:{next_action:"積分範囲を訂正する"},explicitSameSessionRequested:true}),"error_repair");
});

test("an ordinary Level 2 weakness at D89 uses a 3-to-7 day retention window",()=>{
  const result=retentionWindow({sourceDate:"2026-08-18",daysRemaining:89,masteryLevel:2,failureStrength:"standard"});
  assert.deepEqual(result,{earliestDate:"2026-08-21",preferredDate:"2026-08-23",latestDate:"2026-08-25",
    scheduleSameProblem:true,reason:"即時訂正とは分離し、時間を空けた保持確認window"});
});

test("strong Level 2 failure and Level 1 collapse use the shared 1-to-3 day window",()=>{
  assert.equal(classifyFailureStrength({masteryLevel:2,unresolvedTargetCount:3,errorTypes:["W"]}),"strong");
  assert.equal(classifyFailureStrength({masteryLevel:1,unresolvedTargetCount:1,errorTypes:["K"]}),"level1_collapse");
  for(const failureStrength of ["strong","level1_collapse"]){
    const result=retentionWindow({sourceDate:"2026-08-18",daysRemaining:89,masteryLevel:failureStrength==="strong"?2:1,
      failureStrength});
    assert.deepEqual([result.earliestDate,result.latestDate],["2026-08-19","2026-08-21"]);
  }
});

test("explicit transfer success or a low-ROI transfer opportunity can replace same-problem repetition",()=>{
  assert.equal(retentionWindow({sourceDate:"2026-08-18",daysRemaining:70,masteryLevel:2,failureStrength:"standard",
    transferAlreadySucceeded:true}).scheduleSameProblem,false);
  assert.equal(retentionWindow({sourceDate:"2026-08-18",daysRemaining:20,masteryLevel:2,failureStrength:"standard",
    examRelevance:"low",strategyRank:"A",alternativeTransferOpportunity:true}).scheduleSameProblem,false);
});

test("exam horizon moves rolling study time from whitebook to past exams",()=>{
  assert.deepEqual([examHorizonPolicy(89).pastExamShareMin,examHorizonPolicy(89).pastExamShareMax],[.3,.4]);
  assert.deepEqual([examHorizonPolicy(79).pastExamShareMin,examHorizonPolicy(79).pastExamShareMax],[.65,.7]);
  assert.equal(examHorizonPolicy(20).allowNewWhitebook,false);
  assert.equal(examHorizonPolicy(20).pastExamIsPrimary,true);
});

test("current action identity changes when level, purpose, mode or target changes on the same problem",()=>{
  const task={problem_id:"WB-4-A-06",kind:"局所補修",mode:"check"};
  const base={id:1,logical_review_key:"logical",learning_purpose:"retrieval_check",effective_mode:"check",
    grading_contract:{learningPurpose:"retrieval_check",mode:"check",gradedParts:[{id:"x",stableTargetKey:"target:root:x",masteryLevel:1}]}};
  const next={...base,id:2,logical_review_key:"logical-2",learning_purpose:"error_repair",effective_mode:"main_calc",
    grading_contract:{learningPurpose:"error_repair",mode:"main_calc",gradedParts:[{id:"y",stableTargetKey:"target:root:y",masteryLevel:2}]}};
  assert.notEqual(currentActionFingerprint(task,base),currentActionFingerprint(task,next));
});

test("current action identity does not change for a generation-only Review id change",()=>{
  const task={problem_id:"WB-4-A-06",logical_review_key:"logical:level2",mode:"check"};
  const contract={contractHash:"same-contract",learningPurpose:"retrieval_check",mode:"check",
    gradedParts:[{id:"slot",stableTargetKey:"target:WB-4-A-06:root:x",masteryLevel:2}]};
  assert.equal(currentActionFingerprint(task,{id:395,logical_review_key:"logical:level2",grading_contract:contract}),
    currentActionFingerprint(task,{id:397,logical_review_key:"logical:level2",grading_contract:contract}));
});
