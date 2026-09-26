import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {deriveTransferTrainingCandidates,delayedTrainingPrerequisites} from '../src/generatedTransfer.ts';
import {reviewPlanningDecision} from '../src/todayLearningPolicy.ts';
import {analyzeReviewReconciliation} from '../src/reviewReconciliation.ts';
import {buildGradingContractSnapshot} from '../src/gradingContract.ts';

const pack=JSON.parse(await readFile(new URL('../src/data/examReferencePackV1.json',import.meta.url),'utf8'));
const finding=(part,error,evidence)=>({graded_part_id:part,error_type:error,evidence,resolved:error==='none'});
const part=id=>({id,stableTargetKey:`target:PY-2023-Q5:slot:${id}`,masteryLevel:2,label:id});
const source={id:283,problem_id:'PY-2023-Q5',date:'2026-09-23',source_type:'past_exam',mode:'full',
  score_numeric:6,actual_reference_level:0,grading_confidence:.97,learning_purpose:'exam_performance',
  assessment_timing:'independent_performance',error_types:['N','W'],review_outcome:'partial',
  grading_contract:{gradedParts:[part('critical_condition'),part('major_calculation')]},graded_findings:[
    finding('critical_condition','N','非復元抽出でU_i同士は独立ではなく、負の共分散を持つ条件が答案に反映されない。'),
    finding('major_calculation','W','分散の共分散展開、有限母集団修正が未完遂。')]};
const success=(id,date,purpose,timing)=>({...source,id,date,score_numeric:100,error_types:['none'],
  review_outcome:'success',learning_purpose:purpose,assessment_timing:timing,graded_findings:[
    finding('critical_condition','none','異なる抽出位置の共分散を正しく導いた。'),
    finding('major_calculation','none','分散式を正しく完遂した。')]});

test('production-style past-exam findings carry a grounded stable skill through repair and delayed retrieval',()=>{
  const root=deriveFailureEpisode(source).rootWeaknesses.find(row=>row.sourceFindingIds.includes('major_calculation'));
  assert.deepEqual(root.skillIds,['finite_population_correction']);
  const repair=success(284,'2026-09-24','error_repair','delayed_retrieval');
  const retrieval=success(285,'2026-09-26','retrieval_check','delayed_retrieval');
  assert.equal(delayedTrainingPrerequisites(source,root,[source,repair,retrieval]).repair?.id,284);
  assert.equal(delayedTrainingPrerequisites(source,root,[source,repair,retrieval]).retrieval?.id,285);
  const candidates=deriveTransferTrainingCandidates({record:pack,attempts:[source,repair,retrieval],problems:[]});
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].lineage.rootSkillId,'finite_population_correction');
  assert.equal(candidates[0].kind,'generated');
});

test('partial reproduction of a multi-finding root does not unlock transfer',()=>{
  const root={sourceFindingIds:['critical_condition','major_calculation'],skillIds:['finite_population_correction']};
  const partial={...success(284,'2026-09-24','error_repair','delayed_retrieval'),
    grading_contract:{gradedParts:[part('critical_condition')]},
    graded_findings:[finding('critical_condition','none','負の共分散を正しく導いた。')]};
  assert.equal(delayedTrainingPrerequisites(source,root,[source,partial]).repair,undefined);
});

test('a proven repair Attempt keeps its delayed check required when a legacy Review omitted provenance',()=>{
  const failure={...source,problem_id:'PY-2016-Q2',id:244,date:'2026-09-04',graded_findings:[finding('q_expansion','W','Gamma密度積分への変換が未完遂。')],
    grading_contract:{gradedParts:[{id:'q_expansion',stableTargetKey:'target:PY-2016-Q2:slot:q_expansion',label:'積分変換'}]}};
  const repair={...failure,id:257,date:'2026-09-12',learning_purpose:'error_repair',score_numeric:100,
    error_types:['none'],review_outcome:'success',graded_findings:[finding('q_expansion','none','Gamma密度積分への変換を完遂。')]};
  const review={id:475,problem_id:'PY-2016-Q2',status:'pending',learning_purpose:'retrieval_check',
    source_attempt_id:257,due_date:'2026-09-26',preferred_date:'2026-09-26',latest_date:'2026-09-30',
    grading_contract:{gradedParts:[{id:'q_expansion',stableTargetKey:'target:PY-2016-Q2:slot:q_expansion'}]}};
  const decision=reviewPlanningDecision({review,attempts:[failure,repair],problems:[{problem_id:'PY-2016-Q2',source_type:'past_exam'}],
    weaknesses:[],pastExamIsPrimary:true,repairCandidates:[],pastSessions:[]});
  assert.equal(decision.scheduleAsRequired,true);
});

test('legacy generic check is replaced by the exact graded repair target with success provenance',()=>{
  const failed={...source,id:244,problem_id:'PY-2016-Q2',date:'2026-09-04',
    grading_contract:{gradedParts:[{id:'q_expansion',stableTargetKey:'target:PY-2016-Q2:slot:q_expansion',label:'Gamma積分変換'}]},
    graded_findings:[finding('q_expansion','W','Gamma積分変換が未完遂。')]};
  const repaired={...failed,id:257,date:'2026-09-12',learning_purpose:'error_repair',review_outcome:'success',
    minimum_pass_condition_met:true,target_issue_resolved:true,error_types:['none'],
    graded_findings:[finding('q_expansion','none','Gamma積分変換を参照なしで完遂。')],targeted_parts:['Gamma積分変換']};
  const generic={id:475,problem_id:'PY-2016-Q2',status:'pending',source_attempt_id:257,
    learning_purpose:'retrieval_check',grading_contract:{gradedParts:[
      {id:'problem_type',stableTargetKey:'target:PY-2016-Q2:slot:problem_type'}]}};
  const done={id:457,problem_id:'PY-2016-Q2',status:'done',source_attempt_id:244,learning_purpose:'error_repair',
    grading_contract:{gradedParts:[{id:'q_expansion',stableTargetKey:'target:PY-2016-Q2:slot:q_expansion'}]}};
  const current=analyzeReviewReconciliation({attempts:[failed,repaired],reviews:[done,generic],today:'2026-09-26'})
    .problems.find(p=>p.problemId==='PY-2016-Q2');
  assert.equal(current.retentionCheckRequired,true);
  assert.equal(current.retentionSourceAttemptId,257);
  assert.ok(current.reviewsToSupersede.some(row=>row.reviewId===475));
  const contract=buildGradingContractSnapshot({review:{problem_id:'PY-2016-Q2',learning_purpose:'retrieval_check',
    targeted_parts:repaired.targeted_parts},problem:{problem_id:'PY-2016-Q2',source_type:'past_exam'},sourceAttempt:repaired}).contract;
  assert.deepEqual(contract.gradedParts.map(part=>part.id),['q_expansion']);
});

test('a general chapter or sampling mention alone cannot create a transfer skill',()=>{
  const vague={...source,graded_findings:[finding('major_calculation','W','標本抽出の分散計算が未完遂。')]};
  assert.deepEqual(deriveFailureEpisode(vague).rootWeaknesses[0].skillIds,[]);
});
