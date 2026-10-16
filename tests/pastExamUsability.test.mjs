import test from 'node:test';import assert from 'node:assert/strict';import yaml from 'js-yaml';import {readFile} from 'node:fs/promises';
import {buildInitialGradingContract,completeGradingTaskContext} from '../src/gradingContract.ts';
import {buildFirstAttemptGradingPrompt} from '../src/gradingPrompt.ts';import {parseStudyText} from '../src/importParser.ts';
import * as results from '../src/pastExamGrading.ts';import * as planning from '../src/pastExamPlanning.ts';
const p={problem_id:'PY-2016-Q1',category:'past_exam',source_type:'past_exam',recommended_mode:'full',title:'2016年問1'};
const template=()=>{const c=buildInitialGradingContract({problem:p,mode:'full'}),prompt=buildFirstAttemptGradingPrompt({problemId:p.problem_id,mode:'full',gradingContract:c});return {c,prompt,u:yaml.load([...prompt.matchAll(/```yaml\s*([\s\S]*?)```/g)][0][1]).study_update}};
test('full_answer is a whole-answer scope alias, never a mathematical repair kind or purpose conversion',()=>{
 const {c,prompt,u}=template();assert.match(prompt,/full_answer.*review_scope/);u.target_kind='full_answer';u.task_context.target_kind='full_answer';
 const parsed=parseStudyText(JSON.stringify({study_update:u}),[p]).updates[0];assert.equal(parsed.target_kind,undefined);assert.equal(parsed.review_scope,'full_answer');assert.equal(parsed.learning_purpose,'exam_performance');assert.equal(completeGradingTaskContext(c,parsed).learning_purpose,'exam_performance');
 for(const change of [{review_scope:'main_calc_target'},{learning_purpose:'error_repair'},{mode:'main_calc'},{contract_hash:''}])assert.throws(()=>parseStudyText(JSON.stringify({study_update:{...u,...change,task_context:undefined}}),[p]),/full_answer|契約|一致/);
 assert.throws(()=>parseStudyText(JSON.stringify({study_update:{...u,targetKind:'mathematical_patch'}}),[p]),/矛盾|一致/);
});
test('2016 individual history is visible without inventing a selected-three exam result',async()=>{
 const raw=await readFile('outputs/dashboard-redesign-20261015/stat-study-2026-10-15.json','utf8').then(JSON.parse).catch(()=>null);
 const attempts=raw?.attempts||[38,48,40,52,47].map((score,i)=>({id:i+1,problem_id:`PY-2016-Q${i+1}`,date:'2026-08-23',score_numeric:score,task_origin:'first_attempt',learning_purpose:'integration_check'}));
 const r=results.pastExamIndividualResults(2016,attempts);assert.equal(r.studiedCount,5);assert.deepEqual(r.questions.map(q=>q.initial?.score),[38,48,40,52,47]);assert.equal(r.examScore,undefined);assert.ok(r.questions.every(q=>q.history.length));
 const rows=[{id:1,problem_id:p.problem_id,date:'2026-01-01',score_numeric:38,task_origin:'first_attempt'},{id:2,problem_id:p.problem_id,date:'2026-01-02',score_numeric:100,learning_purpose:'error_repair'},{id:3,problem_id:p.problem_id,date:'2026-01-03',score_numeric:0,invalidated_at:'now'}];
 assert.equal(results.pastExamIndividualResults(2016,rows).questions[0].initial.score,38);assert.equal(results.pastExamIndividualResults(2016,rows).questions[0].latest.score,100);
});
test('protected problem directs to the year session with real blockers while ordinary and already answered problems remain available',()=>{
 const catalog=[{canonicalProblemId:'PY-2024-Q1',year:2024,simulationProtected:true,availability:'verified_problem',schedulable:true,gradable:true,fineConceptIds:[]},{canonicalProblemId:'PY-2024-Q2',year:2024,simulationProtected:true,availability:'verified_problem',schedulable:true,gradable:true,fineConceptIds:[]},{canonicalProblemId:'PY-2016-Q1',year:2016,simulationProtected:false}];
 const args={catalog,attempts:[],tasks:[],pastSessions:[],today:'2026-10-16',daysRemaining:30};
 const blocked=planning.derivePastExamProblemStart({...args,problemId:'PY-2024-Q1'});assert.equal(blocked.blocked,true);assert.equal(blocked.year,2024);assert.ok(blocked.reasons.length);assert.equal(blocked.sessionEligible,false);
 assert.equal(planning.derivePastExamProblemStart({...args,problemId:'PY-2016-Q1'}).blocked,false);
 assert.equal(planning.derivePastExamProblemStart({...args,problemId:'PY-2024-Q1',attempts:[{id:1,problem_id:'PY-2024-Q1',date:'2026-10-16',score_numeric:50,mode:'full',policy_validity:'valid'}]}).blocked,false);
 assert.equal(planning.derivePastExamProblemStart({...args,problemId:'PY-2024-Q2',attempts:[{id:1,problem_id:'PY-2024-Q1',date:'2026-10-16',score_numeric:50,mode:'full',policy_validity:'valid'}]}).blocked,true);
});
