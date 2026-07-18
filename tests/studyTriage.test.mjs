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

test("予定超過時も補修は最大1件、実行枠は上限内にする",()=>{
  const tasks=[
    task("K",20,"K"),task("N",20,"N"),task("APLUS",20,"none","A+演習"),
    task("W",20,"W"),task("C",10,"C"),task("S",10,"none","S点検")
  ];
  const problems=[problem("K"),problem("N"),problem("APLUS","A","A+"),problem("W"),problem("C"),problem("S","S","S")];
  const result=triageTodayTasks(tasks,80,problems);
  assert.equal(result.tasks[0].triage,"must");
  assert.equal(result.tasks[1].triage,"tomorrow");
  assert.ok(result.tasks.filter(row=>row.triage==="must").length<=3);
  assert.ok(result.tasks.filter(row=>row.triage==="if_time").length<=2);
  assert.ok(result.minutes.must<=72);
  assert.ok(result.minutes.must+result.minutes.if_time<=80);
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

test("関連S確認は通常後回しだが、重要A由来なら優先する",()=>{
  const s={id:1,problem_id:"WB-6-S-04",source_type:"whitebook",category:"S",chapter:6,problem_number:4,title:"S4",theme:"推定",priority:"core",role:"foundation",recommended_mode:"check",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active"};
  const important={...s,id:2,problem_id:"WB-6-A-20",category:"A",strategy_rank:"A+"};
  const ordinary={...s,id:3,problem_id:"WB-2-A-03",category:"A",strategy_rank:"A"};
  const linked={problem_id:s.problem_id,title:"S4",kind:"S確認",reason:"関連",mode:"check",minutes:5,load:.2,task_origin:"linked_s_check"};
  assert.equal(taskPriority({...linked,source_problem_id:ordinary.problem_id},s,"2026-07-06",ordinary),8);
  assert.equal(taskPriority({...linked,source_problem_id:important.problem_id},s,"2026-07-06",important),2);
});

test("17件318分を必須3件・任意2件・150分以内へ整理する",()=>{
  const tasks=Array.from({length:17},(_,index)=>({
    ...task(`P${index+1}`,index<2?35:index<6?20:14,index===0?"K":index===1?"N":index===2?"W":"none",index<8?"A演習":"Sメンテ"),
    mode:index<2?"full":index<6?"skeleton":"check",task_origin:index===6||index===7?"linked_s_check":"review_attempt"
  }));
  const problems=tasks.map((row,index)=>problem(row.problem_id,index<8?"A":"S",index<4?"A+":"A"));
  const result=triageTodayTasks(tasks,150,problems,"2026-07-18");
  const must=result.tasks.filter(row=>row.triage==="must"),optional=result.tasks.filter(row=>row.triage==="if_time");
  assert.ok(must.length<=3);assert.ok(optional.length<=2);
  assert.ok(result.minutes.must<=135);assert.ok(result.minutes.must+result.minutes.if_time<=150);
  assert.ok(result.tasks.filter(row=>row.triage!=="tomorrow"&&row.task_origin==="linked_s_check").length<=1);
  assert.equal(result.tasks.length,17);
});
