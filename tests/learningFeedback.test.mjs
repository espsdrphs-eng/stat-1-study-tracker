import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTransferEvidence,rootProgress} from '../src/skillEvidence.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {deriveCurrentLearningDiagnosis,preAnswerReason} from '../src/learningFeedback.ts';
import {deriveTransferTrainingCandidates} from '../src/generatedTransfer.ts';
import {deriveRankedStudyCandidates} from '../src/canonicalStudyPlan.ts';
import {resolvePersistedAttemptLifecycle} from '../src/reviewTransition.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {runIntegrityAudit} from '../src/integrityEngine.ts';
import {readFile} from 'node:fs/promises';
import * as skillEvidence from '../src/skillEvidence.ts';
import * as feedback from '../src/learningFeedback.ts';
const pack=JSON.parse(await readFile(new URL('../src/data/examReferencePackV1.json',import.meta.url),'utf8'));

const skill='finite_population_correction';
const fact=(id,problem,success,extra={})=>({id,problem_id:problem,date:`2026-10-${String(id).padStart(2,'0')}`,mode:'full',
  actual_reference_level:0,grading_confidence:.95,learning_purpose:'exam_performance',
  grading_contract:{gradedParts:[{id:'major_calculation',rootSkillIds:[skill],masteryLevel:2}]},
  graded_findings:[{graded_part_id:'major_calculation',error_type:success?'none':'W',resolved:success,evidence:'二次積から分散を導出'}],...extra});
const source=fact(1,'PY-2023-Q5',false);
const lineage={key:`training:${skill}`,rootWeaknessId:deriveFailureEpisode(source).rootWeaknesses[0].rootWeaknessId,
  rootSkillId:skill,sourceProblemId:source.problem_id,sourceAttemptId:1,sourceFindingIds:['major_calculation'],
  repairAttemptId:2,retrievalAttemptId:3,matchConfidence:'high',observedFailure:'共分散の分散計算への接続',successCriteria:'分散まで閉じる',examImpact:'high'};
const target={self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'答案の二次積と分散を独立に確認'};

test('a confirmed different-problem transfer failure is not erased by same-problem graduation',()=>{
  // Local fixture: retention facts plus a new, unreferenced transfer failure.
  const problem={problem_id:source.problem_id,source_type:'past_exam',category:'past_exam',title:'検証用過去問',recommended_mode:'full'};
  const contract=buildInitialGradingContract({problem,mode:'full'});
  const original={...source,error_type:'W',error_types:['W'],mark:'△',score_numeric:35,
    grading_contract:{...contract,gradedParts:contract.gradedParts.map(p=>({...p,rootSkillIds:p.id==='major_calculation'?[skill]:[]}))},
    graded_part_ids:contract.gradedParts.map(p=>p.id),graded_findings:contract.gradedParts.map(p=>({graded_part_id:p.id,error_type:p.id==='major_calculation'?'W':'none',resolved:p.id!=='major_calculation',evidence:'対象の分散計算で停止'}))};
  const retained=fact(3,source.problem_id,true,{mark:'◎',learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval',
    review_outcome:'success',target_issue_resolved:true,minimum_pass_condition_met:true,score_numeric:100,graded_part_ids:['major_calculation']});
  assert.equal(resolvePersistedAttemptLifecycle(retained).graduated,true);
  const failure=fact(4,'WB-fixture-failure',false,{learning_purpose:'transfer_check',transfer_lineage:lineage,
    target_skill_assessment:{...target,major_calculation_success:false,no_major_error:false}});
  const progress=rootProgress(original,deriveFailureEpisode(original).rootWeaknesses[0],[original,retained,failure]);
  assert.equal(progress.transferFailure?.id,4);
  const c={sessionId:1,sourceAttemptId:1,sourceProblemId:source.problem_id,sourceFindingId:'major_calculation',sourceFindingIds:['major_calculation'],
    rootWeaknessId:deriveFailureEpisode(original).rootWeaknesses[0].rootWeaknessId,conceptId:skill,conceptLabel:'分散の計算',materiality:'major',recurrence:0,examImpact:'high',
    required:true,matchReason:'対象能力の独立失敗',whitebookProblemIds:[],transferProblemIds:[],reason:'別問題の対象能力に再失敗',
    requiresUserConfirmation:true,weaknessSkillIds:[skill],repairKind:'rediagnosis',interventionChanged:true,
    transferFailureEvidenceId:progress.transferFailure.id};
  const args={today:'2026-10-11',daysRemaining:30,problems:[problem],
    attempts:[original,retained,failure],reviews:[],pastSessions:[],catalog:[],weaknesses:[],repairCandidates:[c]};
  const after=deriveRankedStudyCandidates(args);
  const repair=after.tasks.find(t=>t.repair_lineage?.transferFailureEvidenceId===4);
  assert.ok(repair,JSON.stringify({message:'retained same-problem status must not hide independent transfer failure',waiting:after.waiting.map(w=>w.reason)}));
  assert.equal(repair.kind,'局所再診断');
  const d=deriveCurrentLearningDiagnosis({attempts:args.attempts,masteryByProblem:{[source.problem_id]:{normalReviewComplete:true}},
    dashboard:{kpis:{assessment:{level:2.5}}},today:{tasks:after.tasks,canonicalStudyPlan:{ranked:after}}});
  assert.equal(d.deficits.length,1,JSON.stringify({purpose:repair.learning_purpose,contractPurpose:repair.grading_contract?.learningPurpose,lineage:repair.repair_lineage,deficits:d.deficits}));assert.equal(d.transfer.failed,1);
  assert.match(d.deficits[0].evidence,/WB-fixture-failure.*Attempt #4/);
  const audit=tasks=>runIntegrityAudit({...args,currentTodayTasks:tasks,rankingMode:true});
  assert.equal(audit([repair]).counts.graduated_but_rescheduled,0,'a verified independent failure allows root re-diagnosis, not ordinary Review resurrection');
  assert.equal(audit([{...repair,repair_lineage:{...repair.repair_lineage,transferFailureEvidenceId:99}}]).counts.graduated_but_rescheduled,1,'forged or stale failure lineage is still audited');
  const oldOnly=deriveRankedStudyCandidates({...args,attempts:[original,retained],repairCandidates:[{...c,transferFailureEvidenceId:undefined}]});
  assert.equal(oldOnly.tasks.some(t=>t.learning_purpose==='error_repair'),false,'historical failures alone still do not resurrect a graduate');
});

test('submitted answer reaches grading and is retained in the new Attempt memo without overwriting old facts',()=>{
  const u={problem_id:'PY-2018-Q5',memo:'採点メモ',actual_reference_level:0},submission={problemId:u.problem_id,text:'独立した今回の答案',referenceLevel:2};
  const saved=feedback.attachSubmittedAnswer?.(u,submission);
  assert.match(saved?.memo||'',/採点メモ[\s\S]*独立した今回の答案/);assert.equal(saved?.actual_reference_level,2);
  assert.equal(u.memo,'採点メモ');
  assert.match(feedback.appendSubmittedAnswer?.('採点契約',submission.text,2)||'',/独立した今回の答案[\s\S]*参照.*2/);
});

test('structured completion criteria display their text, never object coercion',()=>{
  const text='記号を整合させ、対象範囲を参照なしで再現';
  const task={problem_id:source.problem_id,learning_purpose:'error_repair',source_attempt_id:1,ranking:{eligible:true},grading_contract:{learningPurpose:'error_repair',gradedParts:[],completionCriteria:[{id:'keep_symbols',displayText:text}]}};
  const data={attempts:[source],masteryByProblem:{},dashboard:{},today:{tasks:[task],canonicalStudyPlan:{ranked:{waiting:[]}}}};
  assert.equal(deriveCurrentLearningDiagnosis(data).deficits[0].successCriterion,text);
});

test('transfer feedback distinguishes insufficient grading from failure and assisted training',()=>{
  const a=fact(4,'WB-fixture',true,{transfer_lineage:lineage,target_skill_assessment:target});
  assert.equal(skillEvidence.transferTrainingOutcome({...a,grading_confidence:.4}), '転移未確認（採点の根拠・確信度が不足）');
  assert.equal(skillEvidence.transferTrainingOutcome({...a,target_skill_assessment:{...target,no_major_error:false}}), 'training transfer failure');
  assert.equal(skillEvidence.transferTrainingOutcome({...a,actual_reference_level:2}), '参照ありの転移訓練（独立成功ではありません）');
  assert.equal(skillEvidence.transferTrainingOutcome(a,true), 'training transfer success');
  assert.match(skillEvidence.transferTrainingOutcome(a), /転移未確認/);
});

test('existing training uses explicit target assessment and source lineage, not missing historical skill tags',()=>{
  const a=fact(4,'WB-fixture',true,{source_type:'whitebook',learning_purpose:'transfer_check',evidence_strength:'training',
    transfer_lineage:lineage,target_skill_assessment:target,grading_contract:{gradedParts:[{id:'major_calculation'}]}});
  const e=deriveTransferEvidence([source,a]);assert.equal(e.length,1);assert.equal(e[0].skillId,skill);assert.equal(e[0].evidenceStrength,'training');
});
test('high overall score cannot bypass an existing transfer target failure or reference use',()=>{
  const a=fact(4,'WB-fixture',true,{source_type:'whitebook',learning_purpose:'transfer_check',score_numeric:99,
    transfer_lineage:lineage,target_skill_assessment:{...target,major_calculation_success:false}});
  assert.equal(deriveTransferEvidence([source,a]).length,0);
  assert.equal(deriveTransferEvidence([source,{...a,target_skill_assessment:target,actual_reference_level:2}]).length,0);
});

test('target success cannot override a conflicting major finding for the same skill',()=>{
  const a=fact(4,'WB-fixture',false,{learning_purpose:'transfer_check',transfer_lineage:lineage,target_skill_assessment:target,score_numeric:99});
  assert.equal(deriveTransferEvidence([source,a]).length,0);
});
test('failed existing transfer returns source root to repair just like generated training',()=>{
  const repair=fact(2,source.problem_id,true,{learning_purpose:'error_repair'});
  const failed=fact(4,'WB-fixture',true,{source_type:'whitebook',learning_purpose:'transfer_check',transfer_lineage:lineage,
    target_skill_assessment:{...target,no_major_error:false}});
  const progress=rootProgress(source,deriveFailureEpisode(source).rootWeaknesses[0],[source,repair,failed]);
  assert.equal(progress.transferFailure?.id,4);assert.equal(progress.repairSuccess,undefined);assert.equal(progress.transfer,undefined);
});
test('same-problem retention is not transfer and natural PastExam remains separate strong evidence',()=>{
  assert.equal(deriveTransferEvidence([source,fact(3,source.problem_id,true,{learning_purpose:'retrieval_check'})]).length,0);
  const e=deriveTransferEvidence([source,fact(4,'PY-2018-Q2',true,{source_type:'past_exam'})]);assert.equal(e[0].evidenceStrength,'strong');
});
test('ranked transfer is not deadlocked behind a benchmark after valid repair and delayed retention',()=>{
  const repair=fact(2,source.problem_id,true,{learning_purpose:'error_repair'}),retrieval=fact(3,source.problem_id,true,{learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval'});
  const args={record:pack,attempts:[source,repair,retrieval],problems:[],pastSessions:[]};
  assert.equal(deriveTransferTrainingCandidates({...args,planningMode:'ranked'})[0]?.kind,'generated');
  assert.equal(deriveTransferTrainingCandidates({...args,planningMode:'scheduled'})[0]?.kind,'pending','advanced scheduled compatibility retains its timing policy');
  assert.equal(deriveTransferTrainingCandidates({...args,planningMode:'ranked',attempts:[source,repair]}).length,0);
});
test('pre-answer reason never renders prior failure, correction, target skill or formula',()=>{
  const task={learning_purpose:'error_repair',why_today:'MGFのhを代入し係数2を落とさない',previous_next_action:'Jacobianを計算',repair_lineage:{observedFailure:'逆変換',weaknessSkillIds:[skill]}};
  assert.equal(preAnswerReason(task),'未完成の解答範囲に再挑戦します。');
  assert.ok(!/MGF|Jacobian|係数|逆変換/.test(preAnswerReason(task)));
});
test('current diagnosis ignores raw weakNote totals and graduated old failures, but keeps legitimate new repair',()=>{
  const task={problem_id:source.problem_id,learning_purpose:'error_repair',source_attempt_id:1,mode:'main_calc',minutes:12,title:'局所補修',ranking:{eligible:true,rank:2}};
  const data={attempts:[source],weakNotes:Array.from({length:100},()=>({resolved:false})),masteryByProblem:{[source.problem_id]:{normalReviewComplete:true}},
    dashboard:{kpis:{assessment:{level:2.5,label:'実戦得点化',confidence:'medium'}}},today:{tasks:[task],canonicalStudyPlan:{ranked:{waiting:[]}}}};
  assert.equal(deriveCurrentLearningDiagnosis(data).deficits.length,0);
  data.masteryByProblem[source.problem_id].normalReviewComplete=false;
  assert.equal(deriveCurrentLearningDiagnosis(data).deficits[0].sourceAttemptId,1);
  assert.equal(deriveCurrentLearningDiagnosis(data).deficits[0].task.ranking.rank,2);
  assert.equal(deriveCurrentLearningDiagnosis(data).assessment,data.dashboard.kpis.assessment,'does not invent a second level evaluator');
});
