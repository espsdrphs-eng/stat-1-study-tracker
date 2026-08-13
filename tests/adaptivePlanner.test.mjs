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
const reviewFixture=(id,problemId,{due="2026-08-14",earliest=due,latest=due,minutes=12}={})=>{
  const contract={contractId:`review:${id}:1`,contractVersion:"STAT1-CONTRACT-v2",contractHash:`hash-${id}`,
    createdAt:"2026-08-13T00:00:00Z",problemId,reviewId:id,sourceAttemptId:id,
    learningPurpose:"error_repair",learningStage:"repair",mode:"main_calc",reviewScope:"main_calc_target",
    targetKind:"mathematical_patch",targetedParts:["target"],gradedParts:[{id:`part-${id}`,label:"target",cueLabel:"target",
      allowedErrorTypes:["W","none"],completionCriterionId:`criterion-${id}`,stableTargetKey:`target:${problemId}:root:${id}`}],
    explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],completionCriteria:[{id:`criterion-${id}`,displayText:"repair target"}],
    hiddenAnswerKey:[],completionConditions:["repair target"],requiredEvidence:["target"],allowedErrorTypes:["W"],
    requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:minutes,sheetType:"main_calc_sheet"};
  return {id,problem_id:problemId,due_date:due,earliest_date:earliest,preferred_date:due,latest_date:latest,
    interval_days:2,review_type:"main_calc_retry",status:due<"2026-08-14"?"overdue":"pending",generated_from_attempt_id:id,
    source_attempt_id:id,learning_purpose:"error_repair",effective_mode:"main_calc",review_scope:"main_calc_target",
    sheet_type:"main_calc_sheet",contract_id:contract.contractId,contract_hash:contract.contractHash,grading_contract:contract};
};

test("残り91日以上の30日計画で第5・7章、scan5、fullが0件にならない",()=>{
  const shadow=build("2026-07-29");
  assert.ok(shadow.plan30.counts.chapter5>0);
  assert.ok(shadow.plan30.counts.chapter7>0);
  assert.ok(shadow.plan30.counts.scan5>0);
  assert.ok(shadow.plan30.counts.full>0);
  assert.equal(shadow.plan30.dailyCapacityViolations,0);
});

test("期限Reviewが多くても得点形成枠を残し、repairは分単位budget内で複数配置する",()=>{
  const reviews=Array.from({length:3},(_,index)=>reviewFixture(index+1,whitebook[index].problem_id,
    {due:"2026-07-20",earliest:"2026-07-19",latest:"2026-07-22",minutes:12}));
  const shadow=build("2026-07-29","2026-11-15",reviews);
  assert.equal(shadow.plan14.plan[0].tasks.filter(task=>task.slot==="repair").length,3);
  assert.equal(shadow.plan14.plan[0].tasks.filter(task=>task.slot==="score_building").length>=1,true);
  assert.equal(shadow.plan14.dailyCapacityViolations,0);
});

test("active Review problem is not duplicated as generic score-building and is scheduled within latest",()=>{
  const special=[problem("WB-7-A-07",7),problem("WB-7-A-08",7),...whitebook];
  const review=reviewFixture(384,"WB-7-A-07",{due:"2026-08-15",earliest:"2026-08-14",latest:"2026-08-16",minutes:12});
  const shadow=buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[],problems:special,attempts:[],reviews:[review],
    pastSessions:[],currentTasks:[],today:"2026-08-14",examDate:"2026-11-15",targetMinutes:150});
  const rows=shadow.plan14.plan.flatMap(day=>day.tasks);
  assert.equal(rows.some(task=>task.problemId==="WB-7-A-07"&&task.kind!=="review"),false);
  const placed=rows.find(task=>task.reviewId===384);
  assert.ok(placed);
  assert.ok(placed.date>="2026-08-14"&&placed.date<="2026-08-16");
  assert.equal(placed.mode,"main_calc");
  assert.equal(placed.minutes,12);
  assert.equal(shadow.plan14.reviewSchedule.capacityConflicts.length,0);
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

test("将来フェーズ診断はunknownを実DBで変更せず、素材確認後という仮定を明示する",()=>{
  const unknownCatalog=expandedCatalog.map(row=>({...row,exposure:"unknown"}));
  const before=structuredClone(unknownCatalog);
  const result=buildAdaptivePlannerShadow({record:expandedRecord,catalog:unknownCatalog,weaknesses:[],problems:whitebook,
    attempts:[],reviews:[],pastSessions:[],currentTasks:[],today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150});
  assert.deepEqual(unknownCatalog,before);
  assert.equal(result.plan14.plan.flatMap(day=>day.tasks).some(task=>task.referenceProblemId),false);
  const d60=result.phaseDiagnostics.find(row=>row.checkpoint==="D60");
  assert.ok(d60.timed>=2);
  assert.ok(d60.pastExamShare>=50);
  assert.match(d60.assumption,/素材選択確認/);
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
  const plan=buildAdaptivePlannerShadow({record:baseRecord,catalog,problems:candidates,attempts:[{
    id:90,problem_id:"WB-4-A-99",date:"2026-08-04",mode:"full",error_types:["none"],exam_score_eligible:false
  }],reviews:[],pastSessions:[{id:91,date:"2026-08-04",session_kind:"scan_only",questions:[]}],
    currentTasks:[],today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150,
    weaknesses:[weakness("concept-low","resolved",200,0,2),weakness("concept-strong","confirmed",50,2)]});
  const score=plan.plan14.plan[0].tasks.find(task=>task.slot==="score_building");
  assert.equal(score.problemId,"WB-2-A-02");
  assert.match(score.reason,/強い証拠/);
});

test("150分設定で候補が十分ならfoundationのcore planを60〜90分にし、直近卒業問題を避ける",()=>{
  const graduated={id:501,problem_id:"WB-2-A-01",date:"2026-08-03",mode:"check",error_types:["none"],
    assessment_timing:"delayed_retrieval",actual_reference_level:0,hint_used:false,target_issue_resolved:true,
    minimum_pass_condition_met:true,unresolved_carryover:[],graded_part_ids:["problem_type"],
    graded_findings:[{graded_part_id:"problem_type",error_type:"none",resolved:true}]};
  const plan=buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[],problems:whitebook,attempts:[graduated],
    reviews:[],pastSessions:[],currentTasks:[],today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150});
  const firstWeek=plan.plan14.plan.slice(0,7);
  assert.equal(firstWeek.every(day=>day.totalMinutes>=60&&day.totalMinutes<=90),true);
  assert.equal(firstWeek.flatMap(day=>day.tasks).some(task=>task.problemId==="WB-2-A-01"),false);
});

test("直近7日の実績不足を翌日の正式候補へ優先し、実績があれば重ねて強制しない",()=>{
  const missing=buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[],problems:whitebook,attempts:[],reviews:[],
    pastSessions:[],currentTasks:[],today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150});
  const firstThree=missing.plan14.plan.slice(0,3).flatMap(day=>day.tasks);
  assert.ok(firstThree.some(task=>task.kind==="scan5"));
  assert.ok(firstThree.some(task=>task.reason.includes("第5章実績不足")));
  assert.ok(firstThree.some(task=>task.reason.includes("第7章実績不足")));
  const attempts=[5,7].map((chapter,index)=>({id:600+index,problem_id:`WB-${chapter}-A-01`,date:"2026-08-03",mode:"skeleton",error_types:["none"]}));
  const satisfied=buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[],problems:whitebook,attempts,reviews:[],
    pastSessions:[{id:610,date:"2026-08-03",session_kind:"scan_only",questions:[]}],currentTasks:[],
    today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150});
  assert.equal(satisfied.plan14.plan[0].tasks.some(task=>/(scan5|第5章|第7章)実績不足/.test(task.reason)),false);
});

test("残り60日より前はprompt_scannedでも2024・2025の保護問題を最終選択しない",()=>{
  const protectedRecord=record({data:{...baseRecord.data,pastExamProblems:[
    {...baseRecord.data.pastExamProblems[0],year:2024,problem_id:"PE-2024-Q01",simulation_protection_default:true},
    {...baseRecord.data.pastExamProblems[1],year:2021,problem_id:"PE-2021-Q01",simulation_protection_default:false}
  ]}});
  const protectedCatalog=buildPastExamCatalog({record:protectedRecord,sessions:[],exposureOverrides:{
    "PY-2024-Q1":"prompt_scanned","PY-2021-Q1":"prompt_scanned"
  }});
  const plan=buildAdaptivePlannerShadow({record:protectedRecord,catalog:protectedCatalog,weaknesses:[],problems:whitebook,
    attempts:[],reviews:[],pastSessions:[],currentTasks:[],today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150});
  const selected=plan.plan14.plan.flatMap(day=>day.tasks).filter(task=>task.referenceProblemId);
  assert.equal(selected.some(task=>task.referenceProblemId==="PE-2024-Q01"),false);
  assert.ok(selected.some(task=>task.referenceProblemId==="PE-2021-Q01"));
});

test("同一問題を卒業したconceptは別問題のtransfer_checkへ展開できる",()=>{
  const candidates=[
    {...problem("WB-2-A-01",2),fine_concept_ids:["concept-transfer"]},
    {...problem("WB-2-A-02",2),fine_concept_ids:["concept-transfer"]},
  ];
  const graduated={id:701,problem_id:"WB-2-A-01",date:"2026-08-03",mode:"check",error_types:["none"],
    assessment_timing:"delayed_retrieval",actual_reference_level:0,hint_used:false,target_issue_resolved:true,
    minimum_pass_condition_met:true,unresolved_carryover:[],graded_part_ids:["problem_type"],
    graded_findings:[{graded_part_id:"problem_type",error_type:"none",resolved:true}]};
  const weakness={conceptId:"concept-transfer",displayName:"転移対象",state:"transfer_pending",independentOpportunities:3,
    independentFailures:1,failureRate:33,strongFailures:1,weakFailures:0,delayedNoReferenceSuccesses:1,
    transferSuccesses:0,distinctProblemCount:1,distinctFailureDateCount:1,recurrenceCount:0,examYearCount:1,
    examOccurrenceYearCount:1,pastExamFailureCount:0,pastExamFailureYearCount:0,recentExamYearCount:0,
    examImportance:1,weaknessScore:10,priorityScore:10,estimatedRepairMinutes:10,mappingConfidence:"verified",
    evidenceConfidence:"medium",nextRecommendedAction:"別問題",latestEvidenceDate:"2026-08-03",evidenceSummary:[]};
  const plan=buildAdaptivePlannerShadow({record:baseRecord,catalog,weaknesses:[weakness],problems:candidates,
    attempts:[graduated,{id:702,problem_id:"WB-4-A-99",date:"2026-08-03",mode:"full",error_types:["none"]}],
    reviews:[],pastSessions:[{id:703,date:"2026-08-03",session_kind:"scan_only",questions:[]}],currentTasks:[],
    today:"2026-08-04",examDate:"2026-11-15",targetMinutes:150});
  const transfer=plan.plan14.plan[0].tasks.find(task=>task.problemId==="WB-2-A-02");
  assert.equal(transfer?.purpose,"transfer_check");
  assert.equal(transfer?.purposeLabel,"別問題で転移確認");
});
