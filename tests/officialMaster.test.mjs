import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAPTER6_ORIGINAL_A,CHAPTER6_ORIGINAL_S,officialProblemEntries,
  STRATEGY_A_PLUS_ORDER,STRATEGY_S_ORDER
} from "../src/officialMaster.ts";

test("第6章21・22は原典Sとして固定される",()=>{
  const entries=officialProblemEntries(),ids=new Set(entries.map(entry=>entry.problem_id));
  assert.deepEqual(CHAPTER6_ORIGINAL_S,[1,4,6,12,13,15,21,22]);
  assert.equal(ids.has("WB-6-S-21"),true);
  assert.equal(ids.has("WB-6-S-22"),true);
  assert.equal(ids.has("WB-6-A-21"),false);
  assert.equal(ids.has("WB-6-A-22"),false);
  assert.deepEqual(CHAPTER6_ORIGINAL_A,[2,3,5,7,8,9,10,14,16,17,18,19,20,23,24,25,26,27,29,31,32]);
});

test("第6章S重要核とA+重要核が戦略順に入る",()=>{
  assert.deepEqual(STRATEGY_S_ORDER.slice(0,8),[
    "WB-6-S-21","WB-6-S-22","WB-6-S-12","WB-6-S-13","WB-6-S-15","WB-6-S-01","WB-6-S-04","WB-6-S-06"
  ]);
  assert.deepEqual(STRATEGY_A_PLUS_ORDER.slice(0,5),[
    "WB-6-A-19","WB-6-A-20","WB-6-A-23","WB-6-A-26","WB-6-A-29"
  ]);
});
