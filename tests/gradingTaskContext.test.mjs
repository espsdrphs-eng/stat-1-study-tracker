import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import yaml from 'js-yaml';
import {buildFirstAttemptGradingPrompt,buildReviewGradingPrompt} from '../src/gradingPrompt.ts';
import {imageGradingPrompt} from '../src/learningFeedback.ts';import {appendTaskAnswerScope,deriveTaskAnswerScope} from '../src/taskAnswerScope.ts';
import {parseStudyText} from '../src/importParser.ts';import * as contracts from '../src/gradingContract.ts';
import {gradingTaskContext,normalizeGradingContextInput} from '../src/gradingTaskContext.ts';
// Portable boundary fixture; no private export or invented production diagnosis.
const fixtureContract={contractId:'review:pending:fixture',contractHash:'gc-fixture',contractVersion:'STAT1-CONTRACT-v2',problemId:'PY-FIXTURE-Q4',sourceAttemptId:7,
 learningPurpose:'error_repair',learningStage:'repair',mode:'main_calc',reviewScope:'main_calc_target',targetKind:'mathematical_patch',
 gradedParts:[{id:'major_calculation',label:'主要計算',allowedErrorTypes:['W','none']}],hiddenAnswerKey:[],targetedParts:[],completionConditions:[]};
const fixtureScope={scopeKey:'problem:PY-FIXTURE-Q4:gc-fixture',status:'identified',primaryTargetParts:['設問4','設問5'],secondaryTargetParts:[],referenceOnlyParts:[],excludedParts:[],targetEvidence:[]};
const fixtureBody=()=>promptTemplate(appendTaskAnswerScope(buildReviewGradingPrompt({problemId:fixtureContract.problemId,date:'2026-10-13',mode:'main_calc',gradingContract:fixtureContract}),fixtureScope,fixtureContract));
test('portable prompt/parser contract retains flat, camelCase and nested target kind without silent conflicts',()=>{
 const body=fixtureBody();assert.deepEqual(body.task_context,JSON.parse(JSON.stringify(gradingTaskContext(fixtureContract,fixtureScope))));
 for(const nested of [{targetKind:body.target_kind},{task_context:body.task_context},{grading_contract:{targetKind:body.target_kind}}]){
  const input={...body,task_context:undefined,target_kind:undefined,...nested};assert.equal(normalizeGradingContextInput(input).target_kind,'mathematical_patch');
 }
 assert.throws(()=>normalizeGradingContextInput({...body,targetKind:'skeleton_expression_patch'}),/矛盾|一致/);
});
test('portable omitted-kind completion rejects missing/wrong task identity and different physical scope',()=>{
 const body=fixtureBody();delete body.target_kind;delete body.task_context;
 assert.equal(contracts.completeGradingTaskContext(fixtureContract,body,fixtureScope).target_kind,'mathematical_patch');
 for(const key of ['contract_id','contract_hash','contract_version','problem_id','mode','learning_purpose','review_scope','graded_part_ids'])assert.throws(()=>contracts.completeGradingTaskContext(fixtureContract,{...body,[key]:undefined},fixtureScope),/不足|一致/);
 assert.throws(()=>contracts.completeGradingTaskContext(fixtureContract,{...body,task_context:{...gradingTaskContext(fixtureContract,fixtureScope),answer_scope:{...gradingTaskContext(fixtureContract,fixtureScope).answer_scope,primary_target_parts:['設問4','設問6']}}},fixtureScope),/小問|範囲/);
});
test('portable manual target requires physical scope echo even when kind is supplied',()=>{
 const body=fixtureBody(),manual={...fixtureScope,targetEvidence:[{source:'manual.task_scope'}]};delete body.task_context;
 assert.throws(()=>contracts.completeGradingTaskContext(fixtureContract,body,manual),/小問|手動/);
 assert.equal(contracts.completeGradingTaskContext(fixtureContract,{...body,task_context:gradingTaskContext(fixtureContract,manual)},manual).target_kind,'mathematical_patch');
});
const raw=await readFile('outputs/target-kind-20261013/stat-study-2026-10-13.json','utf8').then(JSON.parse).catch(()=>null);
const w=raw&&JSON.parse(raw.meta.find(m=>m.key==='learning-work:PY-2021-Q4').value),c=w?.task.grading_contract,p=raw?.problems.find(p=>p.problem_id===w.problemId);
const scope=raw&&deriveTaskAnswerScope({problem:p,task:w.task,attempts:raw.attempts});
export function promptTemplate(prompt){prompt=prompt.replace(/\r\n/g,'\n');const fenced=prompt.match(/```yaml\s*\n([\s\S]*?)```/);const text=fenced?.[1]||prompt.slice(prompt.lastIndexOf('\nstudy_update:')+1).split(/\n\n(?:STEP|【)/)[0];return yaml.load(text).study_update;}
export function gradeTemplate(template){return {...template,score_numeric:55,score_text:'B',score_label:'B',time_minutes:null,actual_minutes:null,error_types:['W'],primary_error_type:'W',grading_confidence:.9,review_outcome:'partial',target_issue_resolved:false,minimum_pass_condition_met:false,result_summary:'FIXTURE: 部分改善と判定不能',error_point:'FIXTURE: 結論は追加確認が必要',next_action:'FIXTURE: 後日の対象確認',uncertain_points:['FIXTURE: 設問5の最終条件は判定不能'],graded_findings:template.graded_findings.map((f,i)=>({...f,error_type:i?'none':'W',resolved:!!i,evidence:'FIXTURE: 対象答案の採点'}))};}
const first=()=>appendTaskAnswerScope(imageGradingPrompt(buildFirstAttemptGradingPrompt({problemId:p.problem_id,mode:c.mode,gradingContract:c}),w.referenceLevel),scope,c);
const parsed=body=>parseStudyText(JSON.stringify({study_update:body}),raw.problems,raw.answerIndex,raw.problemAliases).updates[0];
test('actual root contract prompt return schema includes the required kind and is not an initial-attempt instruction',{skip:!raw},()=>{
 const prompt=first(),t=promptTemplate(prompt);assert.equal(t.target_kind,c.targetKind);assert.doesNotMatch(prompt,/今回は初回答案です/);assert.equal(t.task_origin,'review_attempt');
 assert.deepEqual(t.task_context.answer_scope.primary_target_parts,['設問4','設問5']);assert.equal(t.task_context.contract_id,c.contractId);
});
test('Review/root prompt generators share the same task-context wire schema',{skip:!raw},()=>{
 const a=promptTemplate(first()),b=promptTemplate(appendTaskAnswerScope(imageGradingPrompt(buildReviewGradingPrompt({problemId:p.problem_id,date:'2026-10-13',mode:c.mode,gradingContract:c}),w.referenceLevel),scope,c));
 assert.deepEqual(a.task_context,b.task_context);assert.equal(parsed(a).target_kind,c.targetKind);
});
test('camelCase and known nested contract forms normalize without guessing identities',{skip:!raw},()=>{
 const body=gradeTemplate(promptTemplate(first()));delete body.task_context;delete body.target_kind;
 assert.equal(parsed({...body,targetKind:c.targetKind}).target_kind,c.targetKind);
 assert.equal(parsed({...body,grading_contract:{targetKind:c.targetKind}}).target_kind,c.targetKind);
 assert.throws(()=>parsed({...body,target_kind:'mathematical_patch',targetKind:'skeleton_expression_patch'}),/矛盾|一致/);
 assert.throws(()=>parsed({...body,targetKind:'unknown_kind'}),/target_kind|targetKind/);
});
test('legacy missing kind completes only with all other exact contract identifiers and assigned parts',{skip:!raw},()=>{
 const body=gradeTemplate(promptTemplate(first()));delete body.target_kind;delete body.task_context;const u=parsed(body);
 assert.equal(contracts.completeGradingTaskContext(c,u,scope).target_kind,c.targetKind);
 for(const key of ['contract_id','contract_hash','contract_version','review_scope','graded_part_ids'])assert.throws(()=>contracts.completeGradingTaskContext(c,{...u,[key]:undefined},scope),new RegExp(key+'|不足|一致'));
 assert.throws(()=>contracts.completeGradingTaskContext(c,{...u,contract_id:'review:pending:other'},scope),/一致|課題/);
 assert.throws(()=>contracts.completeGradingTaskContext(c,{...u,graded_part_ids:['major_calculation']},scope),/一致|採点/);
});
test('wrong source and physical subquestions cannot pass matching generic grading-slot IDs',{skip:!raw},()=>{
 const u=parsed(gradeTemplate(promptTemplate(first())));
 assert.throws(()=>contracts.completeGradingTaskContext(c,{...u,source_attempt_id:999},scope),/source_attempt_id|元答案/);
 assert.throws(()=>contracts.completeGradingTaskContext(c,{...u,task_context:{...u.task_context,answer_scope:{...u.task_context.answer_scope,primary_target_parts:['設問4','設問6']}}},scope),/小問|範囲/);
});
