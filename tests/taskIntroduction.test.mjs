import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as feedback from '../src/learningFeedback.ts';
const problem={problem_id:'PY-2019-Q2',source_type:'past_exam',category:'past_exam',title:'2019年 問2'};
const part={id:'major_calculation',label:'係数2を落とした。正しくは1/Xbar=2/U',currentCorrection:'小問4を再答案化する。1/Xbar=2/Uから計算',currentErrorType:'W',completionCriterionId:'complete_major_calculation',evidenceSourceAttemptId:251};
const contract={problemId:problem.problem_id,sourceAttemptId:269,learningPurpose:'retrieval_check',allowedReferenceLevel:0,gradedParts:[part],completionCriteria:[{id:'retrieval_short_recall',displayText:'型・初手・主役・重要条件を参照なしで想起'}]};
const task={id:516,problem_id:problem.problem_id,mode:'check',review_type:'light_check',learning_purpose:'retrieval_check',source_attempt_id:269,grading_contract:contract};
const data={attempts:[{id:251,problem_id:problem.problem_id,date:'2026-09-08',policy_validity:'valid',graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:part.label}]},{id:269,problem_id:problem.problem_id,date:'2026-09-17',policy_validity:'valid',graded_findings:[{graded_part_id:'major_calculation',error_type:'none',resolved:true}]}],reviews:[task],problemAliases:[],dashboard:{today:'2026-10-11'},masteryByProblem:{},learningWorkByProblem:{},today:{tasks:[task],canonicalStudyPlan:{ranked:{waiting:[]}}}};
test('retention introduction traces original finding but shows no formula or answer',()=>{
 const v=feedback.deriveTaskIntroduction(data,problem,task);
 assert.equal(v.workLabel,'保持確認');assert.match(v.target,/2019年.*問2/);assert.match(v.subparts,/小問4/);
 assert.match(v.previousDifficulty,/主要計算/);assert.deepEqual(v.evidenceAttemptIds,[251]);
 assert.match(v.recoveryGoal,/参照なし/);assert.doesNotMatch(JSON.stringify(v),/Xbar|2\/U|正しくは/);
 assert.equal(task.actual_reference_level,undefined,'display never changes hint history');
});
test('same task introduction across current queue and explicit entry',()=>{
 assert.deepEqual(feedback.deriveTaskIntroduction(data,problem),feedback.deriveTaskIntroduction(data,problem,task));
});
test('legacy root-specific parts remain a registered scope without exposing corrective equations',()=>{
 const legacy={...task,grading_contract:{...contract,gradedParts:[{...part,id:'part:PY-2019-Q2:251:1',completionCriterionId:'reproduce_251:1',label:'小問4の係数2を落とした。1/Xbar=2/Uが正しい。'}],completionCriteria:[{id:'reproduce_targeted_points',displayText:'指定対象を再現'}]}};
 const v=feedback.deriveTaskIntroduction(data,problem,legacy);assert.match(v.scope,/採点対象1/);assert.match(v.scope,/係数/);assert.doesNotMatch(v.scope,/未登録|Xbar|2\/U/);
});
test('blind exam transfer cannot reveal source diagnosis, skill or targeted subparts',()=>{
 const v=feedback.deriveTaskIntroduction(data,problem,{...task,learning_purpose:'transfer_check',grading_contract:{...contract,learningPurpose:'transfer_check'}});
 // The new scope explicitly names the transfer problem's full requirements, never the source parts.
 assert.equal(v.blind,true);assert.equal(v.subparts,'問題全体（問題文の要求範囲）');assert.equal(v.previousDifficulty,'独立性を守るため解答前は表示しません');
 assert.deepEqual(v.evidenceAttemptIds,[]);assert.doesNotMatch(JSON.stringify(v),/小問4|主要計算|Xbar/);
});
test('missing diagnosis and goals remain missing, not fabricated',()=>{
 const v=feedback.deriveTaskIntroduction({...data,attempts:[],reviews:[],today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}},problem,{problem_id:problem.problem_id,learning_purpose:'error_repair'});
 assert.equal(v.previousDifficulty,'診断未登録');assert.equal(v.recoveryGoal,'回収条件未設定');assert.equal(v.subparts,'対象小問未特定・指定が必要');assert.notEqual(v.answerScope.status,'whole');
});
test('root-based task without Review ID has explicit assistance from its valid source only',()=>{
 const source={...data.attempts[0],next_action:'小問4で1/Xbar=2/Uを確認する'};
 const rootTask={problem_id:problem.problem_id,source_attempt_id:251,learning_purpose:'error_repair'};
 assert.equal(feedback.taskAssistanceText({...data,attempts:[source]},rootTask),source.next_action);
 assert.equal(feedback.taskAssistanceText({...data,attempts:[{...source,exclude_from_planning:true}]},rootTask),'');
 assert.equal(feedback.taskAssistanceText(data,{...rootTask,source_attempt_id:999}),'');
 assert.equal(feedback.taskAssistanceText({...data,attempts:[{...source,graded_findings:[{graded_part_id:'major_calculation',resolved:true,error_type:'none'}],next_action:'保持確認へ進む'}]},rootTask),'','administrative learning goals are not solution assistance');
 assert.equal(feedback.taskAssistanceText(data,task),part.currentCorrection,'retention assistance uses original finding lineage, not successful repair as a new failure');
});
test('original problem reference is a source locator, not a viewer or a missing-PDF warning',()=>{
 const p={...problem,official_answer_url:'file:///C:/answers.pdf',official_answer:'SECRET',question_excerpt:'求める量を答えよ。'};
 const v=feedback.deriveProblemReference(p);
 assert.equal(v.statement,null);assert.match(v.locator,/2019年.*問2/);
 assert.doesNotMatch(JSON.stringify(v),/SECRET|file:|answers.pdf/);
 const absent=feedback.deriveProblemReference(problem);assert.equal(absent.statement,null);assert.doesNotMatch(absent.availability,/PDF|画像|ページ|未登録/);
});

test('original locator uses recorded subject, year and question without defaulting all exams to mathematical statistics',()=>{
 const catalog=[{canonicalProblemId:problem.problem_id,subject:'統計応用',year:2019,questionNumber:2}];
 const v=feedback.deriveProblemReference(problem,catalog);assert.match(v.locator,/統計応用.*2019年.*問2/);assert.deepEqual(v.missing,[]);
 const unknown=feedback.deriveProblemReference({problem_id:'CUSTOM',source_type:'past_exam',title:'名称のみ'});
 assert.deepEqual(unknown.missing,['科目','年度','問番号']);assert.doesNotMatch(unknown.locator,/統計数理|2026/);
 const book=feedback.deriveProblemReference({problem_id:'WB-6-A-05',source_type:'whitebook',source_book:'白本',chapter:6,category:'A',problem_number:5});assert.match(book.locator,/白本.*第6章.*A問5/);
});

test('Next Action and list expose the common task purpose but do not require a question document',async()=>{
 const src=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
 assert.match(src.slice(src.indexOf('function DashboardView'),src.indexOf('function TodayView')),/TaskPurposeSummary/);
 assert.match(src.slice(src.indexOf('function ProblemsView'),src.indexOf('function ProblemDetail')),/TaskPurposeSummary/);
 assert.doesNotMatch(src,/問題PDF・画像・ページ番号は未登録|問題文・原本の場所/);
});
test('session identity and generated training do not masquerade as an anchor review',()=>{
 const session={problem_id:problem.problem_id,past_exam_task_type:'timed_three_question_session',stable_session_key:'past_exam_session:2019:timed:1'};
 const v=feedback.deriveTaskIntroduction(data,problem,session);assert.equal(v.blind,true);assert.match(v.workLabel,/本番/);assert.equal(v.taskIdentity,'session:past_exam_session:2019:timed:1');
 const generated={...problem,source_type:'generated',generated_transfer:{problem_text:'別文脈の問題',display_label:'生成確認問題',lineage:{key:'training:k'}}};
 assert.equal(feedback.deriveTaskIntroduction(data,generated).workLabel,'生成転移訓練');assert.equal(feedback.deriveProblemReference(generated).statement,'別文脈の問題');
});
test('legacy Today detail does not auto-display unrecorded solution advice',async()=>{
 const src=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
 const details=src.slice(src.indexOf('function TodayTaskDetails'),src.indexOf('function TodayTaskRows'));
 assert.doesNotMatch(details,/resolved\?\.entryHint|resolved\?\.oneLineHint|referenceEntryPoint\(/);
});
