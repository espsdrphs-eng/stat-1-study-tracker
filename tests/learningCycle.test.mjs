import test from "node:test";
import assert from "node:assert/strict";
import { recurrenceInterventions, selectVerifiedTransferTarget } from "../src/learningPolicyResolver.ts";
import { simulateThirtyDays } from "../src/learningSimulation.ts";

test("recurrent errors change the intervention instead of only shortening the interval",()=>{
  assert.deepEqual(recurrenceInterventions("K",2),["compare_problem_types","justify_method_choice","unseen_first_step"]);
  assert.deepEqual(recurrenceInterventions("W",1),[]);
});

test("generic metadata never guesses a transfer target",()=>{
  const source={problem_id:"WB-1-A-01",metadata_status:"review_needed",canonical_problem_type:"generic"};
  const target={problem_id:"WB-1-A-02",metadata_status:"ok",canonical_problem_type:"generic"};
  assert.equal(selectVerifiedTransferTarget({sourceProblemId:source.problem_id,problems:[source,target],relations:[]}),null);
});

test("confirmed transfer relation can select a different problem",()=>{
  const result=selectVerifiedTransferTarget({sourceProblemId:"WB-1-A-01",problems:[],relations:[{sourceProblemId:"WB-1-A-01",targetProblemId:"WB-1-A-02",status:"confirmed",targetFocus:"same type"}]});
  assert.equal(result?.problemId,"WB-1-A-02");
});

test("30-day simulation preserves daily caps and detects no duplicate transition keys",()=>{
  const tasks=Array.from({length:8},(_,index)=>({problem_id:`WB-1-A-0${index+1}`,title:"A",kind:"A",reason:"",mode:index===0?"scan5":index===1?"full":"skeleton",minutes:index<2?35:15,load:1,due_date:"2026-07-18",deduplication_key:`key-${index}`,review_scope:index===2?"full_skeleton":"targeted_patch"}));
  const result=simulateThirtyDays({startDate:"2026-07-18",tasks,problems:tasks.map((task,index)=>({problem_id:task.problem_id,category:"A",strategy_rank:index<2?"A+":"A"})),targetMinutes:150});
  assert.ok(result.maxMust<=3);assert.ok(result.maxOptional<=2);assert.equal(result.limitViolations,0);assert.equal(result.duplicateTransitions,0);
  assert.ok(result.purposeCounts.fullSkeleton>0);assert.ok(result.purposeCounts.timedFull>0);assert.ok(result.purposeCounts.scan5>0);
});
