import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptGenerationDraft,generationPrompt,acceptGenerationValidation,registerGeneratedProblem,validateGeneratedContent,validateManualGradingReference,GENERATION_CHECKS} from '../src/generatedTransfer.ts';
import {generatedAttemptFields,validateTransferGrade} from '../src/transferTrainingApi.ts';
import {calculateExamReadinessMetrics} from '../src/examReadiness.ts';
const lineage={key:'training:coefficient_tracking_scale_reciprocal',rootWeaknessId:'fixture-root',rootSkillId:'coefficient_tracking_scale_reciprocal',sourceProblemId:'PY-2019-Q2',sourceAttemptId:251,sourceFindingIds:['major_calculation'],repairAttemptId:269,retrievalAttemptId:307,matchConfidence:'high',observedFailure:'係数を失った',successCriteria:'係数を保持',examImpact:'high'};
const record=()=>({key:lineage.key,lineage,createdAt:'2026-10-11',status:'requested',rounds:[],input_format:'statement_only_v1'});
const statement={problem_text:'正の確率変数Zは0<z<1で密度3z²を持つ。記録値A=5Zに対し、0<t<5でF(t)=E[A^{-1}1{A>t}]を求めよ。',difficulty:'統計検定1級',estimated_minutes:10,surface_features:['切断された重み付き平均','連続記録値'],generator_pass_id:'generation-fixture'};
test('manual generation prompt requests only the statement, never a solution or rubric',()=>{
  assert.doesNotMatch(generationPrompt(record(),[]),/reference_solution|grading_rubric/);
});
test('statement-only draft registers after independent quality checks and keeps immutable content on restore',async()=>{
  let r=await acceptGenerationDraft(record(),JSON.stringify(statement));
  assert.equal(r.rounds[0].draft.reference_solution,'');
  assert.equal(r.rounds[0].draft.grading_rubric,'');
  r=acceptGenerationValidation(r,JSON.stringify({draft_hash:r.rounds[0].hash,validator_pass_id:'separate-fixture',checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'FIXTURE: 別会話で独立に条件と解答可能性を検算'}]))}));
  const p=registerGeneratedProblem(r,'GEN-manual-fixture','2026-10-11');
  await validateGeneratedContent(JSON.parse(JSON.stringify(p)));
  assert.equal(p.generated_transfer.input_format,'statement_only_v1');
});
test('manual intake refuses accidentally pasted solutions and malformed JSON',async()=>{
  await assert.rejects(()=>acceptGenerationDraft(record(),JSON.stringify({...statement,reference_solution:'解答を含めない'})),/解答/);
  await assert.rejects(()=>acceptGenerationDraft(record(),'{broken'),/JSON/);
});
test('manual generation records possible prompt exposure and never claims strong evidence',()=>{
  const p={generated_transfer:{lineage,answer_submission:{referenceLevel:0,minutes:10}}};
  const f=generatedAttemptFields(p,{target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'実答案で対象操作を使用'}});
  assert.equal(f.target_skill_prompted,true);
  assert.equal(f.evidence_strength,'training');assert.equal(f.exam_score_eligible,false);
  assert.equal(generatedAttemptFields(p,{hint_used:true,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'ヒント後に解いた'}}).actual_reference_level,3);
});
test('strong transfer denominator distinguishes unmeasured roots, a graded natural failure and natural success',()=>{
  const skill=lineage.rootSkillId;
  const p=id=>({problem_id:id,category:'past_exam',source_type:'past_exam',root_skill_ids:[skill]});
  const a=(id,problem_id,ok)=>({id,problem_id,date:`2026-10-${10+id}`,mode:'full',learning_purpose:'exam_performance',actual_reference_level:0,grading_confidence:.99,
    grading_contract:{gradedParts:[{id:'major_calculation',rootSkillIds:[skill]}]},graded_findings:[{graded_part_id:'major_calculation',error_type:ok?'none':'W',resolved:ok}],score_numeric:ok?100:30});
  const calc=attempts=>calculateExamReadinessMetrics({problems:[p('PY-2019-Q2'),p('PY-2022-Q2')],attempts,pastSessions:[],aliases:[],today:'2026-10-15'}).evidence.transfer;
  const source=a(1,'PY-2019-Q2',false);
  assert.deepEqual(calc([source]).statusCounts,{total:1,attempted:0,successful:0,failed:0,uncertain:0,unattempted:1});
  assert.equal(calc([source,a(2,'PY-2022-Q2',false)]).statusCounts.failed,1);
  assert.equal(calc([source,a(2,'PY-2022-Q2',true)]).statusCounts.successful,1);
  assert.equal(calc([source,{...a(2,'GEN-training',true),source_type:'generated',evidence_strength:'training'}]).statusCounts.attempted,0);
});
test('manual grading rejects invalid scores, a different identity and incomplete target assessment',()=>{
  const u={problem_id:'GEN-fixture',score_numeric:70,grading_confidence:.9,graded_findings:[{graded_part_id:'major_calculation',resolved:false}],
    target_skill_assessment:{self_selected:true,major_calculation_success:false,no_major_error:false,evidence:'実答案で停止'}};
  validateTransferGrade({study_update:u},u.problem_id);
  assert.doesNotThrow(()=>validateTransferGrade({study_update:{...u,grading_confidence:90}},u.problem_id),'the existing grading prompt requests confidence on a 0–100 scale');
  for(const score of [-1,101,'100',null,NaN])assert.throws(()=>validateTransferGrade({study_update:{...u,score_numeric:score}},u.problem_id),/点数/);
  assert.throws(()=>validateTransferGrade({study_update:u},'GEN-other'),/対象問題/);
  assert.throws(()=>validateTransferGrade({study_update:{...u,target_skill_assessment:null}},u.problem_id),/対象能力/);
  assert.throws(()=>validateTransferGrade({study_update:{...u,graded_findings:[]}},u.problem_id),/採点根拠/);
  assert.throws(()=>validateTransferGrade({study_update:{...u,grading_confidence:101}},u.problem_id),/確信度/);
  assert.throws(()=>validateTransferGrade({study_update:{...u,actual_reference_level:9}},u.problem_id),/参照段階/);
});
test('post-answer mathematical quality is mandatory, tied to immutable content and survives roundtrip separately',async()=>{
  let r=await acceptGenerationDraft(record(),JSON.stringify(statement));
  r=acceptGenerationValidation(r,JSON.stringify({draft_hash:r.rounds[0].hash,validator_pass_id:'independent-fixture',checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'FIXTURE: 内部検算で条件と採点可能性を確認'}]))}));
  const p=registerGeneratedProblem(r,'GEN-post-grade-fixture','2026-10-11');
  const quality={problem_id:p.problem_id,content_hash:p.generated_transfer.content_hash,reference_solution:'Aの逆数は1/(5Z)。F(t)=(3/5)∫(t/5から1) z dz=(3/10)(1-t²/25)。',grading_rubric:'係数・積分の下限・主要積分・最終結果の対応を採点。',
    checks:Object.fromEntries(['well_defined','solution_correct','rubric_aligned'].map(k=>[k,{pass:true,evidence:'FIXTURE: 密度と積分範囲を独立に照合し一致'}]))};
  assert.throws(()=>validateManualGradingReference(p,quality),/対象問題/);
  p.generated_transfer.answer_submission={text:'確定答案',minutes:10,referenceLevel:0,submittedAt:'2026-10-11'};
  assert.throws(()=>validateManualGradingReference(p,{...quality,problem_id:'GEN-other'}),/対象問題/);
  assert.throws(()=>validateManualGradingReference(p,{...quality,content_hash:'wrong'}),/対象問題/);
  assert.throws(()=>validateManualGradingReference(p,{...quality,checks:{...quality.checks,well_defined:{pass:false,evidence:'条件が不足し解答不能'}}}),/採点不能/);
  assert.throws(()=>generatedAttemptFields(p,{target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'target success'}}),/対象問題/);
  p.generated_transfer.grading_reference=validateManualGradingReference(p,quality);
  await validateGeneratedContent(JSON.parse(JSON.stringify(p)));
  assert.equal(p.generated_transfer.reference_solution,'','never mutate pre-answer content');
});
