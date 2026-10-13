import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';
import yaml from 'js-yaml';
import {buildReviewGradingPrompt} from '../src/gradingPrompt.ts';
import {appendTaskAnswerScope,deriveTaskAnswerScope} from '../src/taskAnswerScope.ts';
import {deriveProblemLearningView,imageGradingPrompt} from '../src/learningFeedback.ts';
import {parseStudyText} from '../src/importParser.ts';
const raw=await readFile('outputs/target-kind-20261013/stat-study-2026-10-13.json','utf8').then(JSON.parse).catch(()=>null);
const {db,localGet,localPost,restoreBackup,exportBackup}=await import('../src/localDb.ts');
test('complete export copy: prompt-derived modern, nested and missing-kind grades save once and survive roundtrip',{skip:!raw},async()=>{
 // Only grading observations are synthetic. Task IDs, scope and reference
 // history come unchanged from the app's real 10/13 started-task snapshot.
 for(const form of ['modern','nested','legacy-missing']){
  await restoreBackup(structuredClone(raw));
  const b=await localGet('/api/bootstrap'),p=b.problems.find(p=>p.problem_id==='PY-2021-Q4'),work=b.learningWorkByProblem[p.problem_id];
  const c=work.task.grading_contract,scope=deriveTaskAnswerScope({problem:p,task:work.task,attempts:b.attempts,overrides:b.taskAnswerScopeOverrides});
  const prompt=appendTaskAnswerScope(imageGradingPrompt(buildReviewGradingPrompt({problemId:p.problem_id,date:b.dashboard.today,mode:c.mode,gradingContract:c,actualReferenceLevel:work.referenceLevel}),work.referenceLevel),scope,c);
  const template=yaml.load(prompt.slice(prompt.lastIndexOf('\nstudy_update:')+1).split(/\n\n(?:STEP|【)/)[0]).study_update;
  const body={...template,score_numeric:55,score_label:'B',score_text:'B',error_types:['W'],primary_error_type:'W',actual_minutes:null,time_minutes:null,
   grading_confidence:.9,review_outcome:'partial',target_issue_resolved:false,minimum_pass_condition_met:false,
   error_point:'FIXTURE: 最終結論は追加確認',next_action:'FIXTURE: 後日確認',uncertain_points:['FIXTURE: 設問5は判定不能'],
   graded_findings:template.graded_findings.map((f,i)=>({...f,error_type:i?'none':'W',resolved:!!i,evidence:'FIXTURE: 画像答案の判定'}))};
  if(form==='nested'){delete body.target_kind;delete body.task_context;body.grading_contract={targetKind:c.targetKind};}
  if(form==='legacy-missing'){delete body.target_kind;delete body.task_context;delete body.source_attempt_id;}
  const parsed=parseStudyText(JSON.stringify({study_update:body}),b.problems,b.answerIndex,b.problemAliases).updates[0];
  const before=await db.attempts.toArray(),saved=await localPost('/api/import',{updates:[parsed]});
  assert.equal(saved.savedAttemptIds.length,1);const id=saved.savedAttemptIds[0],a=await db.attempts.get(id);
  assert.equal(a.target_kind,c.targetKind);assert.equal(a.score_numeric,55);assert.equal(a.actual_reference_level,2);assert.equal(a.exam_score_eligible,false);
  assert.deepEqual((await db.attempts.toArray()).filter(a=>a.id!==id),before,'all historical Attempts stay byte-equivalent as records');
  const retry=await localPost('/api/import',{updates:[parsed]});assert.deepEqual(retry.savedAttemptIds,[id]);assert.equal(await db.attempts.count(),before.length+1);
  const after=await localGet('/api/bootstrap');assert.equal(deriveProblemLearningView(after,p).workStatus,'graded');
  const same=after.today.tasks.filter(t=>t.grading_contract?.contractId===c.contractId);
  assert.ok(same.every(t=>t.checked),'completed task is not still actionable: '+JSON.stringify(same.map(t=>({id:t.id,checked:t.checked,reason:t.reason,source:t.source_attempt_id,purpose:t.learning_purpose,identity:t.stable_task_key}))));
  const backup=await exportBackup();await restoreBackup(JSON.parse(JSON.stringify(backup)));const restored=await db.attempts.get(id);
  assert.equal(restored.target_kind,c.targetKind);assert.equal(restored.grading_contract.contractId,c.contractId);
  assert.deepEqual(restored.task_context?.answer_scope,a.task_context?.answer_scope);
 }
});
