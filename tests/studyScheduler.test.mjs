import test from "node:test";
import assert from "node:assert/strict";
import { selectMixedPractice } from "../src/studyScheduler.ts";

const problems=[1,2,3,4,5].map(number=>({problem_id:`WB-${number}-A-01`,category:"A",chapter:number}));
const attempts=problems.map((problem,index)=>({
  id:index+1,problem_id:problem.problem_id,date:`2026-06-${String(10+index).padStart(2,"0")}`,
  mark:"○",error_type:"none",error_types:[]
}));

test("4題以上の成功履歴から最も古い問題を混合確認に選ぶ",()=>{
  assert.equal(selectMixedPractice(problems,attempts,new Set(),"2026-06-30")?.problem_id,"WB-1-A-01");
});

test("期限タスクと重なる問題は混合確認から除外する",()=>{
  assert.equal(selectMixedPractice(problems,attempts,new Set(["WB-1-A-01"]),"2026-06-30")?.problem_id,"WB-2-A-01");
});
