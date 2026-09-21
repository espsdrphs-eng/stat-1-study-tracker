import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTransferEvidence} from '../src/skillEvidence.ts';
import {calculateExamReadinessMetrics} from '../src/examReadiness.ts';
const attempt=(id,problem_id,success=false)=>({id,problem_id,date:`2026-09-${20+id}`,mode:'main_calc',
  actual_reference_level:0,reference_level:0,grading_confidence:.95,learning_purpose:success?'transfer_check':'error_repair',
  grading_contract:{gradedParts:[{id:'calculation',rootSkillIds:['operation:fixture']} ]},
  graded_findings:[{graded_part_id:'calculation',error_type:success?'none':'W',resolved:success}]});
test('a later failure of the same skill on another problem must not erase the first transfer source',()=>{
  const evidence=deriveTransferEvidence([attempt(1,'source-a'),attempt(2,'source-b'),attempt(3,'destination',true)]);
  assert.deepEqual(evidence.map(e=>e.sourceProblemId).sort(),['source-a','source-b']);
});
test('one successful transfer resolving three roots remains one independent evidence sample',()=>{
  const attempts=[attempt(1,'a'),attempt(2,'b'),attempt(3,'c'),attempt(4,'destination',true)];
  const metric=calculateExamReadinessMetrics({attempts,problems:[],pastSessions:[],aliases:[],today:'2026-09-25'}).evidence.transfer;
  assert.equal(metric.numerator,3);assert.equal(metric.denominator,3);
  assert.equal(metric.evidenceCount,1);assert.equal(metric.confidence,'low');
  assert.ok(metric.eligibleEvidenceIds.some(id=>id.startsWith('transfer:')));
});
test('latest failure per source is used, and same-problem success is never its own transfer',()=>{
  const evidence=deriveTransferEvidence([attempt(1,'source-a'),attempt(2,'source-a'),attempt(3,'source-a',true)]);
  assert.equal(evidence.length,0);
  const later=deriveTransferEvidence([attempt(1,'source-a'),attempt(2,'source-a'),attempt(3,'destination',true)]);
  assert.equal(later.length,1);assert.equal(later[0].sourceAttemptId,2);
});
