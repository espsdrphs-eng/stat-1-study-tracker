import test from 'node:test';import assert from 'node:assert/strict';
import * as overview from '../src/learningOverview.ts';import * as generation from '../src/generatedTransfer.ts';
import {transferGradingPayload,validateTransferGrade} from '../src/transferTrainingApi.ts';
const lineage={key:'training:fixture-skill',rootWeaknessId:'fixture-root',rootSkillId:'fixture-skill',sourceProblemId:'PY-fixture',sourceAttemptId:1,sourceFindingIds:['major_calculation'],repairAttemptId:2,retrievalAttemptId:3,matchConfidence:'high',observedFailure:'FIXTURE: 尺度の係数を失った',successCriteria:'FIXTURE: 別状況で係数を保持',examImpact:'high'};
test('weakness detail uses the same qualified problem-and-skill match as the priority cards',()=>{
 assert.equal(typeof overview.weaknessSourceTransferAction,'function');const source={problemId:lineage.sourceProblemId,skillIds:[lineage.rootSkillId]},t={problem_id:source.problemId,transfer_training_key:lineage.key,ranking:{eligible:true},checked:false};
 assert.equal(overview.weaknessSourceTransferAction(source,[t]).key,lineage.key);
 for(const s of [{...source,skillIds:[]},{...source,skillIds:['other']},{...source,problemId:'another'}])assert.equal(overview.weaknessSourceTransferAction(s,[t]).key,undefined);
 for(const t2 of [{...t,checked:true},{...t,ranking:{eligible:false}}])assert.equal(overview.weaknessSourceTransferAction(source,[t2]).key,undefined);
});
test('bundle generation includes known source scope and explicitly missing original conditions, not fabricated text',()=>{
 const prompt=generation.generationPrompt({key:lineage.key,lineage,status:'requested',rounds:[]},[],{displayLabel:'FIXTURE 原問題',answerScopeText:'[3]'});
 assert.match(prompt,/原問題の本文・条件.*未登録/);assert.match(prompt,/統計数理/);assert.match(prompt,/方針.*理由/);assert.match(prompt,/FIXTURE 原問題/);assert.match(prompt,/\[3\]/);assert.match(prompt,/reference_solution/);assert.match(prompt,/grading_rubric/);
});
test('generation preview exposes statement only before registration, never reference answer, rubric or root',()=>{
 assert.equal(typeof generation.generationDraftPreview,'function');const draft={problem_text:'FIXTURE: 問題の全文がここに表示されます。',reference_solution:'SECRET ANSWER',grading_rubric:'SECRET RUBRIC',difficulty:'統計検定1級',estimated_minutes:12};
 const preview=generation.generationDraftPreview({lineage,status:'validation_pending',rounds:[{draft,hash:'fixture-hash'}]});assert.equal(preview.problem_text,draft.problem_text);assert.ok(!JSON.stringify(preview).includes('SECRET'));assert.ok(!JSON.stringify(preview).includes(lineage.rootSkillId));assert.equal(generation.generationDraftPreview({rounds:[]}),undefined);
});
test('the grading prompt YAML and legacy JSON share strict identity validation; ambiguous or malformed documents are refused',()=>{
 const u={problem_id:'GEN-fixture',score_numeric:90,grading_confidence:99,graded_findings:[{graded_part_id:'major_calculation',resolved:true}],target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'FIXTURE: 対象操作が確認できた'}};
 const yaml='study_update:\n  problem_id: GEN-fixture\n  score_numeric: 90\n  grading_confidence: 99\n  graded_findings: [{graded_part_id: major_calculation, resolved: true}]\n  target_skill_assessment: {self_selected: true, major_calculation_success: true, no_major_error: true, evidence: "FIXTURE: 対象操作が確認できた"}';
 for(const text of [JSON.stringify({study_update:u}),yaml,'結果\n```yaml\n'+yaml+'\n```']){const raw=transferGradingPayload(text);assert.deepEqual(raw.study_update,u);validateTransferGrade(raw,'GEN-fixture');assert.throws(()=>validateTransferGrade(raw,'GEN-other'),/対象問題/)}
 for(const text of ['{broken','[]','study_update: []','```yaml\n'+yaml+'\n```\n```json\n'+JSON.stringify({study_update:u})+'\n```'])assert.throws(()=>transferGradingPayload(text),/JSON \/ YAML/);
});
