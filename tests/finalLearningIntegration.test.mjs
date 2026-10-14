import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveProblemMasteryState} from '../src/masteryProjection.ts';
import {deriveProblemLearningView} from '../src/learningFeedback.ts';
import {deriveTaskAnswerScope} from '../src/taskAnswerScope.ts';
import * as execution from '../src/reviewCurrentState.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {groundedFindingSkills} from '../src/groundedSkills.ts';
import * as feedback from '../src/learningFeedback.ts';
import * as coach from '../src/coachDiagnosis.ts';
import * as skills from '../src/skillEvidence.ts';

test('no active Reviews is not evidence of retained knowledge on an untouched protected problem',()=>{
 const problem={problem_id:'PY-2024-Q1',source_type:'past_exam',category:'past_exam'};
 const mastery=deriveProblemMasteryState({problemId:problem.problem_id,attempts:[],reviews:[]});
 const data={problems:[problem],attempts:[],reviews:[],problemAliases:[],masteryByProblem:{[problem.problem_id]:mastery},learningWorkByProblem:{},dashboard:{today:'2026-10-14'},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 const view=deriveProblemLearningView(data,problem);
 assert.equal(mastery.normalReviewComplete,true,'queue state remains backward compatible');
 assert.equal(view.workStatus,'unstarted');assert.equal(view.retentionLabel,'保持未確認');
 assert.doesNotMatch(view.statusLabel,/保持確認済み/);
});

test('untouched queue-complete problems are not counted as strengths in the diagnosis',()=>{
 const d={attempts:[],reviews:[],masteryByProblem:{'PY-2024-Q1':{normalReviewComplete:true,levels:[]}},dashboard:{kpis:{}},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 assert.deepEqual(feedback.deriveCurrentLearningDiagnosis(d).strengths,[]);
});

test('330-like partial improvements do not exclude whole numbered questions from its explicit next repair',()=>{
 const problem={problem_id:'PY-2022-Q4',source_type:'past_exam'};
 const source={id:330,problem_id:problem.problem_id,next_action:'参照なしで問3〜5だけを書き直し、正しい密度と期待値・分散の最終式まで再現する。',graded_findings:[
 {graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'問3はCDFの積から密度の積へ修正され、最尤推定量まで到達した。ただし密度の指数が欠落している。また問5の分散計算が未実施。'},
 {graded_part_id:'critical_condition',error_type:'C',resolved:false,evidence:'問4で単調変換は正しいが、CDFの記号と右辺の変数が混在している。'}]};
 const task={id:555,problem_id:problem.problem_id,source_attempt_id:330,learning_purpose:'error_repair',grading_contract:{contractHash:'scope',sourceAttemptId:330,learningPurpose:'error_repair',gradedParts:source.graded_findings.map(f=>({id:f.graded_part_id,label:f.evidence}))}};
 const before=JSON.stringify({source,task});const scope=deriveTaskAnswerScope({problem,task,attempts:[source]});
 assert.equal(scope.status,'identified');assert.deepEqual(scope.primaryTargetParts,['問3','問4','問5']);
 assert.deepEqual(scope.excludedParts,[]);assert.equal(JSON.stringify({source,task}),before);
});

test('valid Review contracts have a shared date/postponement admission independent of preview validity',()=>{
 assert.equal(typeof execution.reviewExecutionAdmission,'function');
 const problem={problem_id:'PY-2000-Q1',source_type:'past_exam',category:'past_exam'};
 const review={id:555,problem_id:problem.problem_id,status:'pending',earliest_date:'2026-10-15',due_date:'2026-10-16',grading_contract:buildInitialGradingContract({problem,mode:'full'})};
 assert.equal(execution.reviewExecutionState(review,'2026-10-14'),'actionable','preview and contract validity remain unchanged');
 assert.equal(execution.reviewExecutionAdmission(review,'2026-10-14').eligible,false);
 assert.equal(execution.reviewExecutionAdmission(review,'2026-10-15').eligible,true);
 assert.equal(execution.reviewExecutionAdmission({...review,postponed_to:'2026-10-18'},'2026-10-15').eligible,false);
 assert.equal(execution.reviewExecutionAdmission({...review,status:'done'},'2026-10-20').eligible,false);
});

test('a grounded likelihood operation is recognized, never inherited from a distribution name alone',()=>{
 const f=evidence=>({graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence});
 assert.ok(groundedFindingSkills({},f('CDFの積を尤度として書き、密度の積から対数尤度・微分・最尤推定量へ進めていない。')).some(s=>s.skillId==='maximum_likelihood'&&s.confidence==='high'));
 assert.deepEqual(groundedFindingSkills({},f('パレート分布の問題で最尤推定が未完成。')),[]);
});

test('latest local grading explains completed work versus unchanged exam measurements',()=>{
 assert.equal(typeof feedback.deriveLearningUpdateSummary,'function');
 const latest={id:330,problem_id:'PY-2022-Q4',date:'2026-10-14',learning_purpose:'error_repair',score_numeric:65,graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false}]};
 const summary=feedback.deriveLearningUpdateSummary({attempts:[latest],dashboard:{readiness:{evidence:{selectedThree:{eligibleEvidenceIds:['session:7']},timed:{eligibleEvidenceIds:['session:7']},transfer:{eligibleEvidenceIds:[]}}}}});
 assert.equal(summary.attemptId,330);assert.equal(summary.unresolved,1);assert.match(summary.reason,/局所補修/);
 assert.match(summary.reason,/本番得点|本番session/);
});

test('coach evidence fingerprint detects edits and invalidation even without a newer ID',()=>{
 assert.equal(typeof coach.coachEvidenceVersion,'function');
 const a={id:330,problem_id:'PY-2022-Q4',score_numeric:65,graded_findings:[]};
 const before=coach.coachEvidenceVersion([a]);
 assert.notEqual(before,coach.coachEvidenceVersion([{...a,score_numeric:45}]));
 assert.notEqual(before,coach.coachEvidenceVersion([{...a,exclude_from_metrics:true}]));
 assert.notEqual(before,coach.coachEvidenceVersion([{...a,reference_level:1}]));
 assert.notEqual(before,coach.coachEvidenceVersion([{...a,grading_confidence:.4}]));
 assert.equal(before,coach.coachEvidenceVersion([structuredClone(a)]));
});

test('a subsequent verified target failure removes an old success from CURRENT transfer display, not history',()=>{
 assert.equal(typeof skills.currentTransferEvidence,'function');
 const part={id:'major_calculation',skillIds:['coefficient_tracking_scale_reciprocal']};
 const contract={gradedParts:[part]};
 const source={id:1,problem_id:'PY-2000-Q1',grading_contract:contract,graded_findings:[{graded_part_id:part.id,error_type:'W',resolved:false,evidence:'逆数の係数2を落とした。'}]};
 const lineage={key:'training:s',sourceProblemId:source.problem_id,sourceAttemptId:1,rootSkillId:'coefficient_tracking_scale_reciprocal',sourceFindingIds:[part.id],matchConfidence:'high'};
 const success={id:2,problem_id:'GEN-fixture',mode:'full',assessment_timing:'independent_performance',reference_level:0,grading_confidence:.99,source_type:'generated',transfer_lineage:lineage,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'係数と主要計算を再現'}};
 const failed={...success,id:3,problem_id:'GEN-second-fixture',target_skill_assessment:{...success.target_skill_assessment,major_calculation_success:false}};
 assert.equal(skills.deriveTransferEvidence([source,success,failed]).length,1);
 assert.equal(skills.currentTransferEvidence([source,success,failed]).length,0);
 const data={attempts:[source,success,failed],masteryByProblem:{},dashboard:{kpis:{}},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 assert.equal(feedback.deriveCurrentLearningDiagnosis(data).transfer.trainingSuccess,0,'diagnosis uses the same CURRENT evidence as problem state');
});
