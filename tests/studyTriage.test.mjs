import test from "node:test";
import assert from "node:assert/strict";
import { taskPriority, triageTodayTasks } from "../src/studyTriage.ts";

const task=(problem_id,minutes,error_type,kind="復習")=>({
  problem_id,title:problem_id,minutes,error_type,kind,reason:"",mode:"skeleton",load:.5
});
const problem=(problem_id,category="A",strategy_rank="A")=>({
  id:1,problem_id,source_type:"whitebook",category,chapter:6,problem_number:1,title:problem_id,
  theme:"",priority:"core",role:"training",recommended_mode:"skeleton",linked_past_exams:"",
  linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",strategy_rank
});

test("予定超過時はK、N、過去問直結Aを必須にする",()=>{
  const tasks=[
    task("K",20,"K"),task("N",20,"N"),task("APLUS",20,"none","A+演習"),
    task("W",20,"W"),task("C",10,"C"),task("S",10,"none","S点検")
  ];
  const problems=[problem("K"),problem("N"),problem("APLUS","A","A+"),problem("W"),problem("C"),problem("S","S","S")];
  const result=triageTodayTasks(tasks,80,problems);
  assert.deepEqual(result.tasks.slice(0,3).map(row=>row.triage),["must","must","must"]);
  assert.equal(result.tasks[3].triage,"if_time");
  assert.equal(result.tasks[4].triage,"tomorrow");
  assert.equal(result.tasks[5].triage,"tomorrow");
  assert.deepEqual(result.minutes,{must:60,if_time:20,tomorrow:20});
});

test("仕分け優先度はK、N、必修A、W、C、none、Sメンテの順",()=>{
  const problems=[problem("A+","A","A+")];
  assert.deepEqual([
    taskPriority(task("K",5,"K")),
    taskPriority(task("N",5,"N")),
    taskPriority(task("A+",5,"none"),problems[0]),
    taskPriority(task("W",5,"W")),
    taskPriority(task("C",5,"C")),
    taskPriority(task("none",5,"none")),
    taskPriority(task("S",5,"none","Sメンテ"))
  ],[0,1,2,4,5,6,7]);
});

test("期限切れはWより優先し、長いA+は余裕枠へ回す",()=>{
  const overdue={...task("late",15,"none"),due_date:"2026-07-01"};
  assert.equal(taskPriority(overdue,problem("late"),"2026-07-05"),3);
  const result=triageTodayTasks([
    task("K",30,"K"),task("A+",50,"none","A+演習"),overdue,task("W",20,"W")
  ],70,[problem("K"),problem("A+","A","A+"),problem("late"),problem("W")],"2026-07-05");
  assert.equal(result.tasks[0].triage,"must");
  assert.notEqual(result.tasks[1].triage,"must");
});
