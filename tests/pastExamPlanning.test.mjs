import test from "node:test";
import assert from "node:assert/strict";
import {buildPastExamYearCandidates,derivePastExamSessionState,derivePastExamWorkspace,generatedUnseenPolicy,selectPastExamYear} from "../src/pastExamPlanning.ts";
import {buildPastExamCatalog} from "../src/examReferencePack.ts";
import {pastProblem,record} from "./adaptiveFixture.mjs";
import {deriveCurrentTodayState} from "../src/todayTaskProjection.ts";
import {currentActionFingerprint} from "../src/examOptimizationPolicy.ts";

const source=record({data:{...record().data,pastExamProblems:[2016,2017,2018,2019,2024,2025]
  .flatMap(year=>Array.from({length:5},(_,index)=>pastProblem(year,index+1)))}});

test("D80はcalendar bucketよりclean scan価値を優先し、露出済み2016・部分露出2017の次に2018を選ぶ",()=>{
  const attempts=[{id:1,problem_id:"PY-2016-Q1",date:"2026-08-01"},{id:2,problem_id:"PY-2017-Q1",date:"2026-08-05"}];
  const catalog=buildPastExamCatalog({record:source,sessions:[],attempts,exposureOverrides:{}});
  const candidates=buildPastExamYearCandidates({catalog,attempts,pastSessions:[],today:"2026-08-27",daysRemaining:80});
  const session=selectPastExamYear({candidates,taskType:"timed_three_question_session"});
  assert.equal(session.year,2018);assert.equal(session.cleanScanEligible,true);
  const individual=selectPastExamYear({candidates,taskType:"individual_full"});
  assert.equal(individual.cleanScanEligible,false);
  assert.ok([2016,2017].includes(individual.year));
});

test("部分露出年度はpractice、完全未露出年度だけclean selection evidenceにする",()=>{
  const attempts=[{id:1,problem_id:"PY-2017-Q1",date:"2026-08-05"}];
  const catalog=buildPastExamCatalog({record:source,sessions:[],attempts,exposureOverrides:{}});
  const candidates=buildPastExamYearCandidates({catalog,attempts,pastSessions:[],today:"2026-08-27",daysRemaining:80});
  assert.equal(candidates.find(row=>row.year===2017).cleanScanEligible,false);
  assert.equal(candidates.find(row=>row.year===2018).cleanScanEligible,true);
});

test("workspaceはD80でscan・選択・3問答案・採点を一つの推奨sessionにする",()=>{
  const attempts=[{id:1,problem_id:"PY-2016-Q1",date:"2026-08-01"},{id:2,problem_id:"PY-2017-Q1",date:"2026-08-05"}];
  const catalog=buildPastExamCatalog({record:source,sessions:[],attempts,exposureOverrides:{}});
  const workspace=derivePastExamWorkspace({catalog,attempts,pastSessions:[],today:"2026-08-27",daysRemaining:80});
  assert.equal(workspace.recommended.year,2018);
  assert.equal(workspace.recommended.taskType,"timed_three_question_session");
  assert.match(workspace.recommended.workflow,/5問scan.+3問選択.+3問答案.+採点/);
});

test("clean年度の選択理由と前年度の未見individual poolを同時に返す",()=>{
  const attempts=[
    ...[1,2,3,4,5].map(n=>({id:n,problem_id:`PY-2016-Q${n}`,date:`2026-07-${10+n}`})),
    ...[1,2,3].map((n,index)=>({id:10+n,problem_id:`PY-2017-Q${index+1}`,date:`2026-08-0${n}`})),
  ];
  const catalog=buildPastExamCatalog({record:source,sessions:[],attempts,exposureOverrides:{}});
  const workspace=derivePastExamWorkspace({catalog,attempts,pastSessions:[],today:"2026-08-30",daysRemaining:77});
  assert.equal(workspace.recommended.year,2018);
  assert.match(workspace.recommended.selectedYearReason,/2017.*3\/5.*2018.*0\/5/);
  assert.deepEqual(workspace.unseenIndividualPool.filter(row=>row.year===2017).map(row=>row.canonicalProblemId),
    ["PY-2017-Q4","PY-2017-Q5"]);
});

test("PastExamSession progressはscan・選択・答案・採点の事実から導出する",()=>{
  assert.equal(derivePastExamSessionState(null),"planned");
  assert.equal(derivePastExamSessionState({prompt_scanned_at:"2026-08-30T00:00:00Z"}),"scan_started");
  assert.equal(derivePastExamSessionState({final_selected_problem_ids:["a","b","c"]}),"selection_committed");
  assert.equal(derivePastExamSessionState({questions:[{completed:true,actualScore:null}]}),"grading_pending");
  assert.equal(derivePastExamSessionState({attempt_completed_at:"2026-08-30T02:00:00Z",
    questions:[1,2,3].map(()=>({completed:true,actualScore:70}))}),"completed");
});

test("PastExamSession identityは内部anchor problemの変更に依存しない",()=>{
  const base={title:"2018年 本番型session",kind:"得点形成",mode:"full",past_exam_task_type:"timed_three_question_session",
    stable_session_key:"past_exam_session:2018:timed_three_question_session:clean:2026-08-30"};
  assert.equal(currentActionFingerprint({...base,problem_id:"PY-2018-Q1"}),
    currentActionFingerprint({...base,problem_id:"PY-2018-Q5"}));
});

test("2024/2025は通常trainingから保護し最終simulationだけで選択可能",()=>{
  const catalog=buildPastExamCatalog({record:source,sessions:[],attempts:[],exposureOverrides:{}});
  const training=buildPastExamYearCandidates({catalog,attempts:[],pastSessions:[],today:"2026-08-27",daysRemaining:80});
  assert.equal(training.some(row=>[2024,2025].includes(row.year)),false);
  const final=buildPastExamYearCandidates({catalog,attempts:[],pastSessions:[],today:"2026-10-26",daysRemaining:20});
  assert.equal(selectPastExamYear({candidates:final,taskType:"simulation"}).year,2024);
});

test("generated unseenは複数年度の本番証拠後だけtransfer訓練として10〜20%を許可する",()=>{
  assert.equal(generatedUnseenPolicy({distinctPastExamYears:2,examEvidenceCount:5}).eligible,false);
  assert.deepEqual(generatedUnseenPolicy({distinctPastExamYears:3,examEvidenceCount:4}),{
    eligible:true,shareMin:.1,shareMax:.2,countsAsPastExamEvidence:false,role:"transfer_training"});
});

test("3問90分taskは単一Attemptで完了せず、同年度の3問session完了でCurrent Todayから進む",()=>{
  const task={problem_id:"PY-2018-Q1",title:"2018年 5問scan→3問選択→3問timed",kind:"得点形成",reason:"本番型",
    mode:"exam_90min",minutes:90,load:0,triage:"must",past_exam_task_type:"timed_three_question_session",
    past_exam_year:2018,session_problem_ids:[1,2,3,4,5].map(n=>`PY-2018-Q${n}`)};
  const next={problem_id:"WB-4-A-01",title:"補修",kind:"得点形成",reason:"次",mode:"full",minutes:35,load:0,triage:"must"};
  const snapshot={date:"2026-08-27",created_at:"2026-08-27T05:00:00+09:00",tasks:[task,next],
    initial_bucket:{},initial_estimated_minutes:{},start_of_day_planned_minutes:125};
  const oneAttempt=deriveCurrentTodayState({tasks:[task,next],attempts:[{id:1,problem_id:"PY-2018-Q1",date:"2026-08-27",mode:"full",saved_at:"2026-08-27T08:00:00+09:00"}],pastSessions:[],snapshot,completedMinutes:35,targetMinutes:150});
  assert.equal(oneAttempt.currentTask.problem_id,"PY-2018-Q1");
  const questions=[1,2,3,4,5].map((n,index)=>({problemId:`PY-2018-Q${n}`,questionLabel:`問${n}`,completed:index<3}));
  const completed=deriveCurrentTodayState({tasks:[task,next],attempts:[],pastSessions:[{id:1,year:2018,date:"2026-08-27",
    session_type:"scan5",session_kind:"selected_three_timed",actual_total_minutes:89,questions}],snapshot,completedMinutes:90,targetMinutes:150});
  assert.equal(completed.tasks[0].checked,true);assert.equal(completed.currentTask.problem_id,"WB-4-A-01");
});
