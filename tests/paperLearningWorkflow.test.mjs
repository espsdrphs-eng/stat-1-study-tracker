import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as feedback from '../src/learningFeedback.ts';
import * as transfer from '../src/transferTrainingApi.ts';
import {reconcilePastExamSessionEvidence} from '../src/pastExamPlanning.ts';
import {calculateExamReadinessMetrics} from '../src/examReadiness.ts';
const minimal=(overrides={})=>({attempts:[],reviews:[],problemAliases:[],dashboard:{today:'2026-10-11'},masteryByProblem:{},learningWorkByProblem:{},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}},...overrides});
const problem={problem_id:'PY-2019-Q2',source_type:'past_exam',category:'past_exam'};
test('paper image submission does not require typed answer or known time',()=>{
 const s=transfer.transferAnswerSubmission({answer_medium:'paper_image',answer_completed:true,referenceLevel:0});
 assert.equal(s.text,'');assert.equal(s.minutes,null);assert.equal(s.medium,'paper_image');
 assert.throws(()=>transfer.transferAnswerSubmission({answer_medium:'paper_image',referenceLevel:0}),/答案完成/);
});
test('net answer minutes: unknown is null, never zero; bad values refused',()=>{
 for(const v of [undefined,null,''])assert.equal(feedback.optionalNetMinutes(v),null);
 assert.equal(feedback.netMinutesText(null),'時間不明');assert.equal(feedback.netMinutesText(undefined),'時間不明');
 assert.equal(feedback.netMinutesText(0),'0分','recorded historical zero is not rewritten');
 assert.equal(feedback.optionalNetMinutes('12.5'),12.5);
 for(const v of [0,-1,'bad'])assert.throws(()=>feedback.optionalNetMinutes(v),/正味/);
});
test('graded session answers with unknown time retain scores but cannot prove timed completion',()=>{
 const ids=[1,2,3].map(n=>`PY-2020-Q${n}`);
 const s={id:1,year:2020,date:'2026-10-11',session_kind:'selected_three_timed',initial_selected_problem_ids:ids,scan_minutes:10,
  questions:[1,2,3,4,5].map(n=>({problemId:`PY-2020-Q${n}`,questionLabel:`問${n}`,selected:n<=3}))};
 const a=ids.map((id,i)=>({id:i+1,problem_id:id,date:s.date,mode:'full',score_numeric:80,time_minutes:null,exam_score_eligible:true,actual_reference_level:0}));
 const p=reconcilePastExamSessionEvidence(s,a);
 assert.equal(p.selected_answer_count,3);assert.equal(p.questions[0].actualScore,80);
 assert.equal(p.questions[0].actualMinutes,null);assert.equal(p.session_elapsed_minutes,undefined);assert.equal(p.exam_score_eligible,false);
 const metrics=calculateExamReadinessMetrics({problems:ids.map(id=>({problem_id:id,category:'past_exam',source_type:'past_exam'})),attempts:a,pastSessions:[p],aliases:[],today:s.date}).evidence;
 assert.equal(metrics.selectedThree.numerator,240);assert.equal(metrics.selectedThree.denominator,3);
 assert.equal(metrics.timed.denominator,0,'scan time alone is not full-session timing evidence');
});
test('paper submission retains reference evidence even without text',()=>{
 const a=feedback.attachSubmittedAnswer({problem_id:problem.problem_id,actual_reference_level:0},{problemId:problem.problem_id,text:'',referenceLevel:3});
 assert.equal(a.actual_reference_level,3);assert.ok(!a.memo?.includes('確定答案'));
});
test('work status and mastery are independent; latest grade is not unseen',()=>{
 const a={id:251,problem_id:problem.problem_id,date:'2026-09-08',score_numeric:78,mark:'△'};
 const v=feedback.deriveProblemLearningView(minimal({attempts:[a],masteryByProblem:{[problem.problem_id]:{normalReviewComplete:false,levels:[{status:'repairing'}]}}}),problem);
 assert.equal(v.workStatus,'graded');assert.equal(v.latestAttempt.id,251);assert.equal(v.needsRepair,true);
});
test('pending work survives reload but a newer grade closes it, not prompt copying',()=>{
 const work={problemId:problem.problem_id,baselineAttemptId:251,stage:'awaiting_grading',updatedAt:'2026-10-11'};
 const old={id:251,problem_id:problem.problem_id,date:'2026-09-08',score_numeric:78};
 const data=minimal({attempts:[old],learningWorkByProblem:{[problem.problem_id]:work}});
 assert.equal(feedback.deriveProblemLearningView(data,problem).workStatus,'awaiting_grading');
 assert.equal(feedback.deriveProblemLearningView({...data,attempts:[{...old,id:269},old]},problem).workStatus,'graded');
});
test('a legacy graduation record suppresses obsolete failure display, but does not document delayed reproduction or strong transfer',()=>{
 const data=minimal({attempts:[{id:307,problem_id:problem.problem_id,date:'2026-10-05',mark:'◎',score_numeric:100}],masteryByProblem:{[problem.problem_id]:{normalReviewComplete:true,levels:[{status:'retained'}]}}});
 const v=feedback.deriveProblemLearningView(data,problem);assert.equal(v.needsRepair,false);assert.equal(v.retentionLabel,'再現記録あり・遅延未確認');assert.equal(v.transferLabel,'本番転移未測定');assert.equal(data.attempts[0].mark,'◎');assert.equal(data.attempts[0].score_numeric,100);
});
test('graded generated problem is visible as training, never exam transfer',()=>{
 const p={problem_id:'GEN-test',source_type:'generated',generated_transfer:{lifecycle_status:'graded',lineage:{key:'training:test',sourceProblemId:problem.problem_id}}};
 const a={id:400,problem_id:p.problem_id,date:'2026-10-11',source_type:'generated',evidence_strength:'training',actual_reference_level:3,transfer_lineage:p.generated_transfer.lineage};
 const v=feedback.deriveProblemLearningView(minimal({attempts:[a]}),p);assert.equal(v.workStatus,'graded');assert.match(v.transferLabel,/訓練/);assert.doesNotMatch(v.transferLabel,/本番転移確認済み/);
});
test('generated registration is training pending, not source graduation or strong transfer',()=>{
 const p={problem_id:'GEN-paper',category:'generated',source_type:'generated',generated_transfer:{lifecycle_status:'ready'}};
 const v=feedback.deriveProblemLearningView(minimal(),p);
 assert.equal(v.workStatus,'unstarted');assert.equal(v.waitingTransfer,true);assert.equal(v.retentionLabel,'保持未確認');assert.equal(v.transferLabel,'転移訓練中');
});
test('batch list and individual Today projection use the identical status evaluator',()=>{
 const p={...problem},data=minimal({problems:[p],learningWorkByProblem:{[p.problem_id]:{baselineAttemptId:0,stage:'awaiting_grading'}}});
 assert.deepEqual(feedback.deriveProblemLearningViews(data)[p.problem_id],feedback.deriveProblemLearningView(data,p));
});
test('paper grading prompt requests image, unknown time and exact existing contract',()=>{
 const p=feedback.imageGradingPrompt('contract_hash: existing',2,null);
 assert.match(p,/答案画像/);assert.match(p,/actual_minutes: null/);assert.match(p,/contract_hash: existing/);assert.match(p,/参照段階 2/);
});
test('obsolete answer-sheet, timer and three-way prompt controls are removed from UI',async()=>{
 const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
 assert.match(app,/post\("\/api\/learning-work",\{problemId:canonicalId/);
 assert.doesNotMatch(app,/sheetHref\(|setSolvingSince|setInterval\(|初回採点プロンプトをコピー|理解補修プロンプト|解答用の空欄シート/);
 const panel=await readFile(new URL('../src/TransferTrainingPanel.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(panel,/<label>答案<textarea|!answer.trim\(\)/);
});
