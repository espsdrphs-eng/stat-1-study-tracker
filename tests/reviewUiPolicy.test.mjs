import test from "node:test";
import assert from "node:assert/strict";
import {shouldShowReviewPrompt} from "../src/reviewUiPolicy.ts";
import {buildReviewGradingPrompt} from "../src/gradingPrompt.ts";

test("every actionable resolved Review exposes the canonical grading prompt control",()=>{
  assert.equal(shouldShowReviewPrompt({reviewId:384,problemId:"WB-7-A-07",executionState:"actionable",hasResolvedCard:true}),true);
  assert.equal(shouldShowReviewPrompt({reviewId:384,problemId:"WB-7-A-07",executionState:"completed",hasResolvedCard:true}),false);
  assert.equal(shouldShowReviewPrompt({reviewId:384,problemId:"WB-7-A-07",executionState:"actionable",hasResolvedCard:false}),false);
});

test("the visible control copies the canonical generated Review prompt",()=>{
  const contract={contractId:"review:384:1",contractVersion:"STAT1-CONTRACT-v2",contractHash:"hash384",
    createdAt:"2026-08-14",problemId:"WB-7-A-07",reviewId:384,sourceAttemptId:1,learningPurpose:"error_repair",
    learningStage:"repair",mode:"main_calc",reviewScope:"main_calc_target",targetKind:"mathematical_patch",
    targetedParts:["target"],gradedParts:[{id:"target",label:"target",cueLabel:"target",allowedErrorTypes:["W","none"],
      completionCriterionId:"target",stableTargetKey:"target:WB-7-A-07:root:target"}],explicitlyOutOfScopePartIds:[],
    explicitlyOutOfScopeParts:[],completionCriteria:[{id:"target",displayText:"target"}],hiddenAnswerKey:[],
    completionConditions:["target"],requiredEvidence:["target"],allowedErrorTypes:["W"],requiresKEvidence:false,
    allowedReferenceLevel:0,estimatedMinutes:12,sheetType:"main_calc_sheet"};
  const prompt=buildReviewGradingPrompt({reviewId:384,problemId:"WB-7-A-07",date:"2026-08-14",mode:"main_calc",
    timeMinutes:12,gradingContract:contract});
  assert.match(prompt,/review:384:1/);
  assert.match(prompt,/WB-7-A-07/);
  assert.ok(prompt.length>100);
});
