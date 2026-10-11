import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {deriveTaskIntroduction} from '../src/learningFeedback.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');
test('a truly unnumbered synthetic task retains manual scope through reload and export/restore without changing facts',async()=>{
 const b=await localGet('/api/bootstrap'),base=b.problems.find(p=>p.problem_id==='PY-2019-Q3');
 const p={...base,problem_id:'PY-2000-Q3',title:'SYNTHETIC: 番号のない小問範囲',notes:'SYNTHETIC ONLY'};
 await db.problems.put(p);const c=buildInitialGradingContract({problem:p,mode:'full'});
 await localPost('/api/attempts',{problem_id:p.problem_id,problem_id_confirmed:true,date:b.dashboard.today,mode:c.mode,score_numeric:50,mark:'△',score_label:'C',error_type:'W',error_types:['W'],error_point:'SYNTHETIC: 主要計算が未完',next_action:'指定箇所を再現する',actual_reference_level:0,grading_confidence:99,time_minutes:null,
  learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(part=>({graded_part_id:part.id,error_type:part.allowedErrorTypes.includes('W')?'W':'none',resolved:!part.allowedErrorTypes.includes('W'),evidence:'SYNTHETIC: 小問番号の記録なし'}))});
 const current=await localGet('/api/bootstrap'),scope=deriveTaskIntroduction(current,p).answerScope;
 assert.equal(scope.status,'unknown');
 const before=await exportBackup();
 await localPost('/api/task-answer-scope',{problemId:p.problem_id,scopeKey:scope.scopeKey,primaryTargetParts:['(3)'],secondaryTargetParts:['(1)'],referenceOnlyParts:['(2)']});
 const after=await exportBackup();assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.reviews,before.reviews);
 await restoreBackup(after);const restored=await localGet('/api/bootstrap'),intro=deriveTaskIntroduction(restored,p);
 assert.equal(intro.subparts,'主対象：(3) ／ 補助確認：(1) ／ 参照のみ：(2)');
 assert.equal(intro.answerScope.targetEvidence[0].source,'manual.task_scope');
 assert.deepEqual((await localGet('/api/bootstrap')).taskAnswerScopeOverrides,restored.taskAnswerScopeOverrides);
});
