import test from "node:test";
import assert from "node:assert/strict";
import {buildAdaptivePlannerShadow} from "../src/adaptivePlanner.ts";
import {buildPastExamCatalog} from "../src/examReferencePack.ts";
import {problem,record} from "./adaptiveFixture.mjs";

const whitebook=[
  ...[2,4,6].flatMap(ch=>Array.from({length:8},(_,i)=>problem(`WB-${ch}-A-${String(i+1).padStart(2,"0")}`,ch))),
  ...[5,7,8].flatMap(ch=>Array.from({length:4},(_,i)=>problem(`WB-${ch}-A-${String(i+1).padStart(2,"0")}`,ch)))
];
const baseRecord=record();
const catalog=buildPastExamCatalog({record:baseRecord,sessions:[],exposureOverrides:{"PY-2021-Q1":"prompt_scanned","PY-2022-Q1":"unseen"}});
const build=(today,examDate="2026-11-15",reviews=[])=>
  buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[],problems:whitebook,attempts:[],reviews,pastSessions:[],
    currentTasks:[],today,examDate,targetMinutes:150});

test("残り91日以上の30日計画で第5・7章、scan5、fullが0件にならない",()=>{
  const shadow=build("2026-07-29");
  assert.ok(shadow.plan30.counts.chapter5>0);
  assert.ok(shadow.plan30.counts.chapter7>0);
  assert.ok(shadow.plan30.counts.scan5>0);
  assert.ok(shadow.plan30.counts.full>0);
  assert.equal(shadow.plan30.dailyCapacityViolations,0);
});

test("期限Reviewが多くても得点形成枠を残し、repairは1日最大1件",()=>{
  const reviews=Array.from({length:20},(_,index)=>({id:index+1,problem_id:whitebook[index%whitebook.length].problem_id,
    due_date:"2026-07-01",interval_days:3,review_type:"main_calc_retry",status:"pending",generated_from_attempt_id:index+1,
    learning_purpose:"error_repair",grading_contract:{estimatedMinutes:20}}));
  const shadow=build("2026-07-29","2026-11-15",reviews);
  assert.equal(shadow.plan14.plan.every(day=>day.tasks.filter(task=>task.slot==="score_building").length===1),true);
  assert.equal(shadow.plan14.plan.every(day=>day.tasks.filter(task=>task.slot==="repair").length<=1),true);
  assert.equal(shadow.plan14.dailyCapacityViolations,0);
});

test("unknown exposureを特定の未見年度として推薦せず、2024・2025を61日以上で保護する",()=>{
  const protectedRecord=record({data:{...baseRecord.data,pastExamProblems:[
    {...baseRecord.data.pastExamProblems[0],year:2024,problem_id:"PE-2024-Q01",simulation_protection_default:true},
    {...baseRecord.data.pastExamProblems[1],year:2025,problem_id:"PE-2025-Q01",simulation_protection_default:true}
  ]}});
  const protectedCatalog=buildPastExamCatalog({record:protectedRecord,sessions:[],exposureOverrides:{}});
  const shadow=buildAdaptivePlannerShadow({record:protectedRecord,catalog:protectedCatalog,weaknesses:[],problems:whitebook,
    attempts:[],reviews:[],pastSessions:[],currentTasks:[],today:"2026-07-29",examDate:"2026-11-15",targetMinutes:150});
  assert.equal(shadow.plan30.plan.flatMap(day=>day.tasks).some(task=>task.referenceProblemId),false);
  assert.equal(shadow.plan30.plan.flatMap(day=>day.tasks).filter(task=>["scan5","past_exam","timed"].includes(task.kind)).every(task=>task.requiresUserSelection),true);
});

test("残り60日以下で90分演習と過去問比率50%以上を満たす",()=>{
  const shadow=build("2026-09-20");
  assert.ok(shadow.plan14.counts.timed>0);
  assert.equal(shadow.plan14.dailyCapacityViolations,0);
  assert.equal(shadow.plan14.weeklyMinimumViolations.filter(value=>value.includes("50%未満")).length,0);
});

test("参照なし本番得点が良好なら過去問を前倒しし、不十分でも週scanを延期しない",()=>{
  const successes=[1,2].map(id=>({id,problem_id:`WB-4-A-0${id}`,date:`2026-07-${20+id}`,mode:"full",
    mark:"○",score_label:"A",score_numeric:80,error_type:"none",error_types:["none"],
    exam_score_eligible:true,actual_reference_level:0,time_minutes:35}));
  const accelerated=buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[],problems:whitebook,
    attempts:successes,reviews:[],pastSessions:[],currentTasks:[],today:"2026-07-29",examDate:"2026-11-15",targetMinutes:150});
  assert.ok(accelerated.plan14.counts.pastExam>build("2026-07-29").plan14.counts.pastExam);
  const insufficient=build("2026-07-29");
  assert.ok(insufficient.plan14.counts.scan5>=2);
});

test("残り30日以下は未実施の新規白本Aを自動追加しない",()=>{
  const shadow=build("2026-10-20");
  assert.equal(shadow.plan14.plan.flatMap(day=>day.tasks).some(task=>task.kind==="whitebook"),false);
  assert.ok(shadow.plan14.counts.pastExam>0);
});

test("shadowはtodayPlanSnapshotを変更する出力を持たない",()=>{
  const current=[{problem_id:"WB-2-A-01",title:"既存",theme:"既存",kind:"A",reason:"固定",mode:"full",minutes:35,load:1,status:"pending"}];
  const copy=structuredClone(current);
  buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[],problems:whitebook,attempts:[],reviews:[],pastSessions:[],
    currentTasks:current,today:"2026-07-29",examDate:"2026-11-15",targetMinutes:150});
  assert.deepEqual(current,copy);
});
