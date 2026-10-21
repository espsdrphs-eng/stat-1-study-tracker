import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTransferEvidence,currentTransferEvidence} from '../src/skillEvidence.ts';
import {deriveTransferTrainingCandidates} from '../src/generatedTransfer.ts';
import {deriveProblemMasteryState} from '../src/masteryProjection.ts';
import {record,pastProblem,problem} from './adaptiveFixture.mjs';

const skill='moment_generating_function',sourceId='PY-2021-Q3',destId='PY-2023-Q3';
const part=(pid,id)=>({id,label:id,stableTargetKey:`target:${pid}:${id}`,
  masteryLevel:id==='first_step'?1:2,rootSkillIds:[skill],allowedErrorTypes:['none','W','N','C']});
const fact=(id,pid,ids,success,purpose='exam_performance',extra={})=>({id,problem_id:pid,
  date:`2026-10-${String(id).padStart(2,'0')}`,mode:'full',source_type:'past_exam',
  actual_reference_level:0,reference_level:0,hint_used:false,grading_confidence:.99,
  score_numeric:success?100:40,learning_purpose:purpose,
  assessment_timing:purpose==='retrieval_check'?'delayed_retrieval':'independent_performance',
  error_type:success?'none':'W',error_types:[success?'none':'W'],target_issue_resolved:success,
  minimum_pass_condition_met:success,review_outcome:success?'success':'failed',graded_part_ids:ids,
  grading_contract:{problemId:pid,learningPurpose:purpose,mode:'full',gradedParts:ids.map(id=>part(pid,id))},
  graded_findings:ids.map(id=>({graded_part_id:id,error_type:success?'none':'W',resolved:success,
    evidence:success?'MGFを自力で正しく構成し、この採点項目の計算を完成した。':'MGFに関するこの採点項目の計算を完成できなかった。'})),...extra});
const rec=record();rec.data.concepts=[{concept_id:skill,status:'verified',source_confidence:'high',display_name:'積率母関数'}];
rec.data.pastExamProblems=[pastProblem(2021,3,[skill]),pastProblem(2023,3,[skill])];
const problems=[sourceId,destId].map(id=>({...problem(id),source_type:'past_exam',category:'past_exam',
  root_skill_ids:[skill],classification_confidence:'high'}));
const candidates=attempts=>deriveTransferTrainingCandidates({record:rec,attempts,problems,planningMode:'ranked'});
const source=fact(1,sourceId,['major_calculation'],false);
const repair=fact(2,sourceId,['major_calculation'],true,'error_repair');
const retrieval=fact(3,sourceId,['major_calculation'],true,'retrieval_check');

test('a first-step-only success cannot suppress an unconfirmed major-calculation training candidate',()=>{
  const baseline=[source,repair,retrieval],first=fact(4,destId,['first_step'],true);
  assert.equal(candidates(baseline).length,1);
  assert.equal(candidates([...baseline,first]).length,1);
  assert.equal(deriveTransferEvidence([...baseline,first]).length,0);
});
test('only matching current source-operation proof suppresses the training candidate',()=>{
  const whole=fact(4,destId,['major_calculation'],true);
  assert.equal(candidates([source,repair,retrieval,whole]).length,0);
  for(const extra of [{hint_used:true,actual_reference_level:2},{grading_confidence:.3}])
    assert.equal(candidates([source,repair,retrieval,{...whole,...extra}]).length,1);
});

test('partial delayed retrieval preserves successful targets without claiming the whole level retained when Review is missing',()=>{
  const a=fact(1,sourceId,['major_calculation','answer_conclusion'],false);
  const r=fact(2,sourceId,['major_calculation','answer_conclusion'],true,'error_repair');
  const partial=fact(3,sourceId,['major_calculation','answer_conclusion'],true,'retrieval_check',{
    target_issue_resolved:false,minimum_pass_condition_met:false,review_outcome:'partial',error_type:'W',error_types:['W']});
  partial.graded_findings[1]={...partial.graded_findings[1],resolved:false,error_type:'W'};
  const before=structuredClone([a,r,partial]);
  const m=deriveProblemMasteryState({problemId:sourceId,attempts:[a,r,partial],reviews:[]});
  assert.notEqual(m.levels[1].status,'retained');
  assert.equal(m.levels[1].retainedTargetCount,1,'keep the successful operation as historical evidence');
  assert.equal(m.normalReviewComplete,false);
  assert.equal(m.activeTargetCount,1,'a missing Review cannot hide the outstanding target count');
  assert.deepEqual([a,r,partial],before);
  const completed=fact(4,sourceId,['answer_conclusion'],true,'retrieval_check');
  const fixed=deriveProblemMasteryState({problemId:sourceId,attempts:[a,r,partial,completed],reviews:[]});
  assert.equal(fixed.levels[1].status,'retained','later exact-scope independent retention can complete remaining target');
});
test('a later failure invalidates the current retention of that target, not its historical success',()=>{
  const failure=fact(4,sourceId,['major_calculation'],false,'retrieval_check');
  const m=deriveProblemMasteryState({problemId:sourceId,attempts:[source,repair,retrieval,failure],reviews:[]});
  assert.notEqual(m.levels[1].status,'retained');
  assert.equal(m.normalReviewComplete,false);
  assert.equal(m.levels[1].retainedTargetCount,0,'a later failure is not current retention; the old Attempt remains in history');
});
test('an immediate repair is not delayed retention and an assisted or unknown-reference retrieval is not independent retention',()=>{
  const repairing=deriveProblemMasteryState({problemId:sourceId,attempts:[source,repair],reviews:[]});
  assert.notEqual(repairing.levels[1].status,'retained');
  for(const patch of [{hint_used:true,actual_reference_level:2},{actual_reference_level:undefined,reference_level:undefined}]){
    const m=deriveProblemMasteryState({problemId:sourceId,attempts:[source,repair,{...retrieval,...patch}],reviews:[]});
    assert.notEqual(m.levels[1].status,'retained');
  }
});
test('a legacy transfer flag without distinct-problem and scoped proof cannot certify transfer',()=>{
  for(const pid of [sourceId,destId]){
    const legacy={...fact(4,pid,['first_step'],true,'transfer_check'),source_problem_id:sourceId,transfer_evidence:true};
    const m=deriveProblemMasteryState({problemId:sourceId,attempts:[source,legacy],reviews:[]});
    assert.notEqual(m.levels[2].status,'retained');
    assert.deepEqual(currentTransferEvidence([source,legacy]),[]);
  }
});
test('a compatible old record with genuine scoped distinct-problem proof remains verified without rewriting history',()=>{
  const legacy={...fact(4,destId,['major_calculation'],true,'transfer_check'),source_problem_id:sourceId,transfer_evidence:true};
  const before=structuredClone(legacy),m=deriveProblemMasteryState({problemId:sourceId,attempts:[source,legacy],reviews:[]});
  assert.equal(m.levels[2].status,'retained');assert.deepEqual(legacy,before);
});
test('an explicit generated-training lineage records only its selected source operation despite an older sibling failure',()=>{
  const older=fact(0,sourceId,['first_step'],false),generated=fact(4,'GEN-selected-scope',['major_calculation'],true,'transfer_check',{
    source_type:'generated',evidence_strength:'training',target_skill_prompted:true,
    transfer_lineage:{key:`training:${skill}`,rootSkillId:skill,sourceProblemId:sourceId,sourceAttemptId:source.id,
      sourceFindingIds:['major_calculation'],repairAttemptId:repair.id,retrievalAttemptId:retrieval.id,matchConfidence:'high'},
    target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'対象のMGF計算を自力で完成した。'}});
  const evidence=deriveTransferEvidence([older,source,repair,retrieval,generated]);
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].sourceAttemptId,source.id);assert.deepEqual(evidence[0].sourceFindingIds,['major_calculation']);
  assert.equal(evidence[0].evidenceStrength,'training');
});
test('implicit natural transfer still requires every unresolved source operation; scoped training is not a blanket exception',()=>{
  const older=fact(0,sourceId,['first_step'],false),calculation=fact(4,destId,['major_calculation'],true);
  assert.deepEqual(deriveTransferEvidence([older,source,calculation]),[]);
  const full=fact(4,destId,['first_step','major_calculation'],true);
  assert.equal(deriveTransferEvidence([older,source,full]).length,2);
});
