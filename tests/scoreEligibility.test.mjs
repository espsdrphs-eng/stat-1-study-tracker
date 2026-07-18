import test from "node:test";
import assert from "node:assert/strict";
import { examScoreEligibility, taskScoreForAttempt } from "../src/scoreEligibility.ts";

test("conditional full score is a task score and never an exam score",()=>{
  const attempt={mode:"full",evaluation_scope:"conditional_full",score_numeric:88,time_minutes:30,time_limit_minutes:35,actual_reference_level:0,conclusion_reached:true};
  assert.equal(taskScoreForAttempt(attempt),88);
  assert.equal(examScoreEligibility(attempt).eligible,false);
});

test("no-reference timed full can be exam-score eligible",()=>{
  const result=examScoreEligibility({mode:"full",evaluation_scope:"full",score_numeric:72,time_minutes:32,time_limit_minutes:35,actual_reference_level:0,conclusion_reached:true});
  assert.equal(result.eligible,true);
  assert.equal(result.examScore,72);
});
