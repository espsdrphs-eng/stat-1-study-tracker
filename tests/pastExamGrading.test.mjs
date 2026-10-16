import test from 'node:test';import assert from 'node:assert/strict';import yaml from 'js-yaml';
import {buildPastSessionGradingPrompt,pastSessionResult,buildPastSessionContract} from '../src/pastExamGrading.ts';
import {normalizePastExamSession} from '../src/pastExamWorkflow.ts';
import {parseStudyText} from '../src/importParser.ts';
const problem={problem_id:'PY-2024-Q2',category:'past_exam',source_type:'past_exam',title:'2024年問2',recommended_mode:'full'};
const session=normalizePastExamSession({id:71,year:2024,date:'2026-10-16',session_kind:'selected_three_timed',scan_minutes:10,answer_finished_at:'2026-10-16T01:00:00Z',answered_problem_ids:['PY-2024-Q2','PY-2024-Q3','PY-2024-Q4'],initial_selected_problem_ids:['PY-2024-Q2','PY-2024-Q3','PY-2024-Q4'],questions:Array.from({length:5},(_,i)=>({questionLabel:`問${i+1}`,selected:[1,2,3].includes(i)}))});
test('finished session returns an image-grading prompt with the persistent year, selection and shared contract',()=>{
 const contract=buildPastSessionContract(session,problem),prompt=buildPastSessionGradingPrompt(session,problem,contract);
 assert.match(prompt,/2024/);assert.match(prompt,/scanを含めて90分/);assert.match(prompt,/PY-2024-Q3/);assert.match(prompt,/本人が.*添付/);assert.doesNotMatch(prompt,/送信済み/);
 const raw=[...prompt.matchAll(/```yaml\s*([\s\S]*?)```/g)].map(m=>yaml.load(m[1])).find(v=>v?.study_update);assert.ok(raw);
 const u=parseStudyText(JSON.stringify(raw),[problem]).updates[0];assert.equal(u.contract_id,contract.contractId);assert.equal(u.learning_purpose,'exam_performance');assert.equal(u.assessment_timing,'independent_performance');assert.equal(u.parent_past_session_id,71);assert.equal(u.session_role,'selected_timed');
 assert.notEqual(buildPastSessionContract({...session,id:72},problem).contractId,contract.contractId);
});
test('session grading rejects unselected or not-yet-finished work',()=>{
 assert.throws(()=>buildPastSessionContract({...session,answer_finished_at:undefined},problem),/終了/);
 assert.throws(()=>buildPastSessionContract(session,{...problem,problem_id:'PY-2024-Q1'}),/対象/);
});
test('year results never turn ungraded into zero or include diagnostic and repair scores in the selected-three score',()=>{
 const a=(id,pid,score,purpose='exam_performance')=>({id,problem_id:pid,parent_past_session_id:71,session_role:'selected_timed',learning_purpose:purpose,score_numeric:score,score_max:100,mode:'full',date:'2026-10-16'});
 let r=pastSessionResult(session,[a(1,'PY-2024-Q2',60)]);assert.equal(r.status,'採点待ち');assert.equal(r.examScore,null);assert.equal(r.questions.find(q=>q.problemId==='PY-2024-Q3').score,null);
 r=pastSessionResult(session,[a(1,'PY-2024-Q2',60),a(2,'PY-2024-Q3',75),a(3,'PY-2024-Q4',90),a(4,'PY-2024-Q1',100),a(5,'PY-2024-Q2',100,'error_repair')]);assert.equal(r.examScore,75);assert.equal(r.status,'採点済み');assert.equal(r.questions[0].role,'非選択・診断');assert.equal(r.questions[1].score,60);
});
