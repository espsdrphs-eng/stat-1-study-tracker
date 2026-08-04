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
const manyPast=Array.from({length:30},(_,index)=>({
  ...baseRecord.data.pastExamProblems[index%2],year:2019+Math.floor(index/5),
  question_number:index%5+1,problem_id:`PE-${2019+Math.floor(index/5)}-Q${String(index%5+1).padStart(2,"0")}`,
  simulation_protection_default:false
})).filter(row=>row.year!==2020);
const expandedRecord=record({data:{...baseRecord.data,pastExamProblems:manyPast}});
const expandedCatalog=buildPastExamCatalog({record:expandedRecord,sessions:[],
  exposureOverrides:Object.fromEntries(manyPast.map(row=>[`PY-${row.year}-Q${row.question_number}`,"prompt_scanned"]))});
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
  const confirmations=shadow.plan30.plan.flatMap(day=>day.tasks).filter(task=>task.kind==="exposure_confirmation");
  assert.ok(confirmations.length>0);
  assert.equal(confirmations.every(task=>task.requiresUserSelection&&task.minutes===10&&task.purpose==="material_selection_confirmation"),true);
});

test("残り60日以下で90分演習と過去問比率50%以上を満たす",()=>{
  const shadow=buildAdaptivePlannerShadow({record:expandedRecord,catalog:expandedCatalog,weaknesses:[],problems:whitebook,
    attempts:[],reviews:[],pastSessions:[],currentTasks:[],today:"2026-09-20",examDate:"2026-11-15",targetMinutes:150});
  assert.ok(shadow.plan14.counts.timed>0);
  assert.equal(shadow.plan14.dailyCapacityViolations,0);
  assert.equal(shadow.plan14.weeklyMinimumViolations.filter(value=>value.includes("50%未満")).length,0);
});

test("参照なし本番得点が良好なら過去問を前倒しし、不十分でも週scanを延期しない",()=>{
  const successes=[1,2].map(id=>({id,problem_id:`WB-4-A-0${id}`,date:`2026-07-${20+id}`,mode:"full",
    mark:"○",score_label:"A",score_numeric:80,error_type:"none",error_types:["none"],
    exam_score_eligible:true,actual_reference_level:0,time_minutes:35}));
  const acceleratedExpanded=buildAdaptivePlannerShadow({record:expandedRecord,catalog:expandedCatalog,weaknesses:[],problems:whitebook,
    attempts:successes,reviews:[],pastSessions:[],currentTasks:[],today:"2026-07-29",examDate:"2026-11-15",targetMinutes:150});
  const normalExpanded=buildAdaptivePlannerShadow({record:expandedRecord,catalog:expandedCatalog,weaknesses:[],problems:whitebook,
    attempts:[],reviews:[],pastSessions:[],currentTasks:[],today:"2026-07-29",examDate:"2026-11-15",targetMinutes:150});
  assert.ok(acceleratedExpanded.plan14.counts.pastExam>normalExpanded.plan14.counts.pastExam);
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

test("同じ過去問を根拠のない同一目的で再配置せず、配置目的と露出根拠を持つ",()=>{
  const tasks=build("2026-07-29").plan30.plan.flatMap(day=>day.tasks).filter(task=>task.referenceProblemId);
  assert.equal(new Set(tasks.map(task=>task.referenceProblemId)).size,tasks.length);
  assert.equal(tasks.every(task=>task.purpose&&task.purposeLabel&&task.basis&&task.exposure),true);
});

test("D90・D60・D30診断は純粋にフェーズを切り替え、D60以降にtimedを確保する",()=>{
  const shadow=buildAdaptivePlannerShadow({record:expandedRecord,catalog:expandedCatalog,weaknesses:[],problems:whitebook,
    attempts:[],reviews:[],pastSessions:[],currentTasks:[],today:"2026-08-01",examDate:"2026-11-15",targetMinutes:150});
  const d90=shadow.phaseDiagnostics.find(row=>row.checkpoint==="D90");
  const d60=shadow.phaseDiagnostics.find(row=>row.checkpoint==="D60");
  const d30=shadow.phaseDiagnostics.find(row=>row.checkpoint==="D30");
  assert.equal(d90.phase,"A_and_past_parallel");
  assert.ok(d90.pastExam>0);
  assert.ok(d60.timed>=2);
  assert.ok(d60.pastExamShare>=50);
  assert.ok(d30.timed>=2);
  assert.ok(d30.pastExamShare>=50);
});

test("正式順位はraw weakNoteではなくconcept evidenceの強い証拠を優先する",()=>{
  const candidates=[
    {...problem("WB-2-A-01",2),fine_concept_ids:["concept-low"]},
    {...problem("WB-2-A-02",2),fine_concept_ids:["concept-strong"]}
  ];
  const weakness=(conceptId,state,priorityScore,strongFailures,delayedNoReferenceSuccesses=0)=>({
    conceptId,displayName:conceptId,state,independentOpportunities:5,independentFailures:2,failureRate:.4,
    strongFailures,weakFailures:0,delayedNoReferenceSuccesses,transferSuccesses:0,distinctProblemCount:1,
    distinctFailureDateCount:1,recurrenceCount:0,examYearCount:1,examOccurrenceYearCount:1,pastExamFailureCount:0,
    pastExamFailureYearCount:0,recentExamYearCount:0,examImportance:1,weaknessScore:priorityScore,
    priorityScore,estimatedRepairMinutes:10,mappingConfidence:"verified",evidenceConfidence:"high",
    nextRecommendedAction:"",latestEvidenceDate:null,evidenceSummary:[]
  });
  const plan=buildAdaptivePlannerShadow({record:baseRecord,catalog,problems:candidates,attempts:[],reviews:[],
    pastSessions:[],currentTasks:[],today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150,
    weaknesses:[weakness("concept-low","resolved",200,0,2),weakness("concept-strong","confirmed",50,2)]});
  const score=plan.plan14.plan[0].tasks.find(task=>task.slot==="score_building");
  assert.equal(score.problemId,"WB-2-A-02");
  assert.match(score.reason,/強い証拠/);
});
