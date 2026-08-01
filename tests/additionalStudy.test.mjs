import test from "node:test";
import assert from "node:assert/strict";
import {buildAdditionalStudyCandidates} from "../src/additionalStudy.ts";

const shadow={
  available:true,mode:"shadow",generatedAt:"",phase:"foundation_to_A",daysRemaining:106,targetMinutes:150,
  plan14:{days:14,totalMinutes:0,counts:{},weeklyMinimumViolations:[],dailyCapacityViolations:0,plan:[
    {date:"2026-08-01",totalMinutes:50,tasks:[
      {taskKey:"score",date:"2026-08-01",slot:"score_building",kind:"scan5",label:"2021年問1",
        problemId:"PY-2021-Q1",referenceProblemId:"PE-2021-Q01",minutes:50,reason:"得点形成",
        purpose:"first_answer",purposeLabel:"初回答案",basis:"prompt_scanned",exposure:"prompt_scanned",requiresUserSelection:false}
    ]},
    {date:"2026-08-02",totalMinutes:15,tasks:[
      {taskKey:"maintain",date:"2026-08-02",slot:"maintenance_selection",kind:"whitebook",label:"第5章A問1",
        problemId:"WB-5-A-01",minutes:15,reason:"第5章を維持",requiresUserSelection:false}
    ]},
    {date:"2026-08-03",totalMinutes:50,tasks:[
      {taskKey:"protected",date:"2026-08-03",slot:"score_building",kind:"past_exam",label:"2025年問1",
        problemId:"PY-2025-Q1",minutes:50,reason:"保護中",exposure:"unseen",simulationProtected:true,requiresUserSelection:false}
    ]}
  ]},
  plan30:{days:0,plan:[],totalMinutes:0,counts:{},weeklyMinimumViolations:[],dailyCapacityViolations:0},
  legacy30:{scan5:0,full:0,timed:0,totalTasks:0},comparisonReasons:[],activationEligible:false,
  activationBlockers:[],weeklyTarget:{},weeklyActual:{},phaseDiagnostics:[]
};

test("61/150分で正式snapshotを変えず、設定時間内の追加候補を提示する",()=>{
  const tasks=[{problem_id:"WB-4-A-01",title:"完了",kind:"A",reason:"朝",mode:"full",minutes:61,load:1,checked:true,triage:"must"}];
  const copy=structuredClone(tasks);
  const result=buildAdditionalStudyCandidates({today:"2026-08-01",targetMinutes:150,completedMinutes:61,
    activeRemainingMinutes:0,currentTasks:tasks,shadow});
  assert.equal(result.capacity,89);
  assert.ok(result.candidates.length>0);
  assert.ok(result.candidates.reduce((sum,row)=>sum+row.minutes,0)<=89);
  assert.equal(result.candidates.some(row=>row.task.problem_id==="PY-2025-Q1"),false);
  assert.deepEqual(tasks,copy);
});

test("既に今日の計画にある問題を追加候補へ重複表示しない",()=>{
  const result=buildAdditionalStudyCandidates({today:"2026-08-01",targetMinutes:150,completedMinutes:61,
    activeRemainingMinutes:0,currentTasks:[{problem_id:"PY-2021-Q1",title:"既存",kind:"過去問",reason:"朝",mode:"full",minutes:50,load:1}],
    shadow});
  assert.equal(result.candidates.some(row=>row.task.problem_id==="PY-2021-Q1"),false);
});
