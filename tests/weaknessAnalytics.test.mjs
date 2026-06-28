import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWeaknesses } from "../src/weaknessAnalytics.ts";

const problem=(id,category,theme,links="")=>({
  id:1,problem_id:id,source_type:"whitebook",category,chapter:6,problem_number:5,title:id,theme,
  priority:"core",role:category==="S"?"foundation":"training",recommended_mode:"full",
  linked_past_exams:"",linked_s_problems:links,linked_a_problems:"",notes:"",completion_status:"active"
});
const attempt=(id,date,error,mark="△",score=70)=>({
  id,problem_id:"WB-6-A-05",date,mode:"full",time_minutes:30,mark,score_label:"B",
  error_type:error,error_types:error==="none"?[]:[error],error_point:"ミス",next_action:"再演習",memo:"",
  score_numeric:score
});

test("K再発、低得点、期限切れを加味して関連S/Aを提案する",()=>{
  const problems=[
    problem("WB-6-A-05","A","AIC・自由度","WB-6-S-04"),
    problem("WB-6-S-04","S","AIC・自由度")
  ];
  const attempts=[attempt(1,"2026-06-20","K","△",62),attempt(2,"2026-06-25","K","△",72)];
  const reviews=[{id:1,problem_id:"WB-6-A-05",due_date:"2026-06-26",review_type:"skeleton_retry",status:"overdue",generated_from_attempt_id:2}];
  const result=analyzeWeaknesses(problems,attempts,reviews,[],"2026-06-29");
  assert.equal(result.confidence,"参考");
  assert.equal(result.insights[0].theme,"AIC・自由度");
  assert.equal(result.insights[0].dominantError,"K");
  assert.equal(result.insights[0].recurrence,1);
  assert.equal(result.insights[0].level,"重点");
  assert.deepEqual(result.insights[0].recommendedA,["WB-6-A-05"]);
  assert.deepEqual(result.insights[0].recommendedS,["WB-6-S-04"]);
  assert.match(result.insights[0].action,/関連Sを10分骨格/);
});

test("直近で改善した場合は苦手度を減点する",()=>{
  const problems=[problem("WB-6-A-05","A","AIC・自由度","WB-6-S-04")];
  const failed=analyzeWeaknesses(problems,[attempt(1,"2026-06-20","W")],[],[],"2026-06-29").insights[0];
  const improved=analyzeWeaknesses(problems,[
    attempt(1,"2026-06-20","W"),
    attempt(2,"2026-06-28","none","◎",95)
  ],[],[],"2026-06-29").insights[0];
  assert.ok(improved.score<failed.score+2);
});

test("学習記録数に応じて分析信頼度を段階表示する",()=>{
  const problems=[problem("WB-6-A-05","A","AIC・自由度")];
  assert.equal(analyzeWeaknesses(problems,Array.from({length:5},(_,i)=>attempt(i+1,`2026-06-${20+i}`,"W")),[],[],"2026-06-29").confidence,"暫定");
  assert.equal(analyzeWeaknesses(problems,Array.from({length:15},(_,i)=>attempt(i+1,`2026-06-${String(i+1).padStart(2,"0")}`,"W")),[],[],"2026-06-29").confidence,"分析可能");
});
