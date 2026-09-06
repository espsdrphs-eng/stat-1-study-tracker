import test from "node:test";
import assert from "node:assert/strict";
import {buildPastExamYearCandidates,canonicalizePastExamSessions,derivePastExamSessionState,derivePastExamWorkspace,generatedUnseenPolicy,selectPastExamYear,
  validatePastExamSessionIdentity,validatePastExamTaskIdentity} from "../src/pastExamPlanning.ts";
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

test("scan_onlyは保存済みscan evidenceだけでterminalになり3問答案を要求しない",()=>{
  const session={id:25,year:2025,date:"2026-09-05",session_type:"scan5",session_kind:"scan_only",
    session_purpose:"practice_scan5",prompt_scanned_at:"2026-09-05T12:00:00Z",scan_minutes:10,
    questions:[1,2,3,4,5].map(n=>({problemId:`PY-2025-Q${n}`,questionLabel:`問${n}`,predictedType:"type"})),
    analysis:{rubric_version:"STAT1-SCAN5-v1"}};
  assert.equal(derivePastExamSessionState(session),"completed");
  assert.equal(derivePastExamSessionState({...session,prompt_scanned_at:undefined,analysis:undefined,
    questions:[1,2,3,4,5].map(n=>({problemId:`PY-2025-Q${n}`,questionLabel:`問${n}`}))}),"scan_started");
});

test("PastExamSession identityはyear・problem year・stable keyの混在を拒否する",()=>{
  const session={id:19,year:2019,date:"2026-09-06",session_type:"scan5",session_kind:"selected_three_timed",
    session_purpose:"timed_three_question_session",session_instance_id:"session-2",
    stable_session_key:"past_exam_session:2025:scan5:session-1",
    selected_year_reason:"2019は未露出で次の測定に適するため",
    questions:[1,2,3,4,5].map(n=>({problemId:`PY-2019-Q${n}`,questionLabel:`問${n}`}))};
  const validation=validatePastExamSessionIdentity(session);
  assert.equal(validation.valid,false);assert.ok(validation.errors.some(row=>/stable/i.test(row)));
  const taskValidation=validatePastExamTaskIdentity({past_exam_year:2019,past_exam_task_type:"timed_three_question_session",
    stable_session_key:"past_exam_session:2025:scan5:session-1",selected_year_reason:"2019を選択",
    session_problem_ids:[1,2,3,4,5].map(n=>`PY-2019-Q${n}`),title:"2019年 本番型session"});
  assert.equal(taskValidation.valid,false);
});

test("2025 identityを参照する2019 active sessionは新しい2019 identityへ冪等収束する",()=>{
  const historical={id:25,year:2025,date:"2026-09-05",session_type:"scan5",session_kind:"scan_only",
    session_purpose:"practice_scan5",session_state:"completed",session_instance_id:"session-2025-shared",
    stable_session_key:"past_exam_session:2025:scan5:session-2025-shared",scan_minutes:10,
    questions:[1,2,3,4,5].map(n=>({problemId:`PY-2025-Q${n}`,predictedType:"type"}))};
  const mixed={id:26,year:2019,date:"2026-09-06",session_type:"scan5",session_kind:"selected_three_timed",
    session_purpose:"timed_three_question_session",session_instance_id:"session-2025-shared",
    stable_session_key:"past_exam_session:2025:scan5:session-2025-shared",
    selected_year_reason:"2018完了後、2019のclean選題を測るため",
    questions:[1,2,3,4,5].map(n=>({problemId:`PY-2019-Q${n}`}))};
  const first=canonicalizePastExamSessions([historical,mixed]).current.find(row=>row.year===2019);
  assert.match(first.session_instance_id,/^session-2019-/);
  assert.match(first.stable_session_key,/^past_exam_session:2019:timed_three_question_session:/);
  assert.equal(validatePastExamSessionIdentity(first).valid,true);
  const second=canonicalizePastExamSessions([historical,first]).current.find(row=>row.year===2019);
  assert.equal(second.session_instance_id,first.session_instance_id);
  assert.equal(second.stable_session_key,first.stable_session_key);
});

test("PastExamSession identityは内部anchor problemの変更に依存しない",()=>{
  const base={title:"2018年 本番型session",kind:"得点形成",mode:"full",past_exam_task_type:"timed_three_question_session",
    stable_session_key:"past_exam_session:2018:timed_three_question_session:clean:2026-08-30"};
  assert.equal(currentActionFingerprint({...base,problem_id:"PY-2018-Q1"}),
    currentActionFingerprint({...base,problem_id:"PY-2018-Q5"}));
});

test("未完了2018は次年度をblockし、completed後だけ理由付き2019候補へ進む",()=>{
  const exposureOverrides=Object.fromEntries([2016,2017].flatMap(year=>[1,2,3,4,5].map(n=>[`PY-${year}-Q${n}`,"fully_attempted"])));
  const catalog=buildPastExamCatalog({record:source,sessions:[],attempts:[],exposureOverrides});
  const base={id:18,year:2018,date:"2026-08-30",session_type:"scan5",session_kind:"selected_three_timed",
    session_purpose:"timed_three_question_session",scan_minutes:10,
    selected_year_reason:"2018は完全未見でclean選題を測れるため",
    questions:[1,2,3,4,5].map(n=>({problemId:`PY-2018-Q${n}`,questionLabel:`問${n}`,completed:false}))};
  const blocked=derivePastExamWorkspace({catalog,attempts:[],pastSessions:[base],today:"2026-08-31",daysRemaining:76});
  assert.equal(blocked.recommended.year,2018);
  const completed={...base,attempt_completed_at:"2026-08-31T23:59:59",simulation_completed_at:"2026-08-31T23:59:59",
    session_state:"completed",questions:base.questions.map((row,index)=>({...row,completed:index<3,actualScore:index<3?50-index*5:null}))};
  const next=derivePastExamWorkspace({catalog,attempts:[],pastSessions:[completed],today:"2026-09-01",daysRemaining:75});
  assert.equal(next.recommended.year,2019);assert.match(next.recommended.selectedYearReason,/2018.*2019/);
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
