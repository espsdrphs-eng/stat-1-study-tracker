import test from 'node:test';import assert from 'node:assert/strict';
import * as feedback from '../src/learningFeedback.ts';
import {deriveRankedStudyCandidates} from '../src/canonicalStudyPlan.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {derivePastExamRoleRelease} from '../src/pastExamPlanning.ts';
const skill='coefficient_tracking_scale_reciprocal';
const fact=(id,problem,ok,purpose='error_repair',extra={})=>({id,problem_id:problem,date:`2026-10-${String(id).padStart(2,'0')}`,mode:'main_calc',learning_purpose:purpose,
 // Mirror the top-level grading summary used by the existing contract builder,
 // not just the findings. Production Q2 contains W/C summary codes as well.
 error_type:ok?'none':'W',error_types:[ok?'none':'W'],primary_error_type:ok?'none':'W',score_numeric:ok?100:45,
 assessment_timing:purpose==='retrieval_check'?'delayed_retrieval':'independent_performance',actual_reference_level:0,grading_confidence:.99,
 grading_contract:{gradedParts:[{...buildInitialGradingContract({problem:{problem_id:problem},mode:'main_calc'}).gradedParts.find(p=>p.id==='major_calculation'),rootSkillIds:[skill]}]},
 graded_findings:[{graded_part_id:'major_calculation',materiality:'major',error_type:ok?'none':'W',resolved:ok,evidence:ok?'対象計算を完遂':'係数の追跡で停止'}],...extra});
const data=attempts=>({attempts,reviews:[],problemAliases:[],problems:[],dashboard:{today:'2026-10-14'},masteryByProblem:{},adaptiveLearning:{pastExamRepairCandidates:[]},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}});
const rows=attempts=>{assert.equal(typeof feedback.deriveCurrentWeaknessRows,'function','current weakness evidence must be available without raw memo flags');return feedback.deriveCurrentWeaknessRows(data(attempts));};
test('current root view distinguishes repair, delayed retention, training and exam evidence without memo toggles',()=>{
 const source=fact(1,'PY-fixture-Q1',false,'exam_performance'),repair=fact(2,source.problem_id,true),retrieval=fact(3,source.problem_id,true,'retrieval_check');
 assert.match(rows([source])[0].status,/補修が必要/);
 assert.match(rows([source,repair])[0].status,/補修成功.*保持未確認/);
 assert.match(rows([source,repair,retrieval])[0].status,/保持成功.*転移未確認/);
 const line={key:`training:${skill}`,rootSkillId:skill,sourceProblemId:source.problem_id,sourceAttemptId:source.id,sourceFindingIds:['major_calculation'],matchConfidence:'high'};
 const transfer=fact(4,'GEN-fixture',true,'transfer_check',{source_type:'generated',transfer_lineage:line,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'別問題で係数を維持'}});
 assert.match(rows([source,repair,retrieval,transfer])[0].status,/転移訓練確認済み.*本番転移未確認/);
 const hinted={...transfer,hint_used:true,actual_reference_level:3};assert.match(rows([source,repair,retrieval,hinted])[0].status,/保持成功.*転移未確認/);
 const failure={...transfer,target_skill_assessment:{...transfer.target_skill_assessment,major_calculation_success:false}};
 assert.match(rows([source,repair,retrieval,failure])[0].status,/補修が必要/);assert.equal(rows([source,repair,retrieval,failure])[0].sources[0].transferFailureAttemptId,4);
});
test('matching canonical skill groups independent roots for display but retains each source and unresolved scope',()=>{
 const a=fact(1,'PY-fixture-Q1',false),b=fact(2,'PY-fixture-Q2',false),r=fact(3,a.problem_id,true);
 const result=rows([a,b,r]);assert.equal(result.length,1);assert.equal(result[0].sources.length,2);assert.match(result[0].status,/補修が必要/);
 const noSkill={...b,grading_contract:{gradedParts:[{...b.grading_contract.gradedParts[0],rootSkillIds:[]}]},graded_findings:[{...b.graded_findings[0],evidence:'計算途中で停止'}]};
 assert.equal(rows([a,noSkill]).length,2,'chapter or generic calculation must not merge unknown operations');
 assert.ok(rows([a,noSkill]).some(r=>r.identityPending));
});
test('partial or invalid success cannot clear a current multi-target root and fresh success does not erase history',()=>{
 const s=fact(1,'PY-fixture-Q1',false),r=fact(2,s.problem_id,true,'error_repair',{exclude_from_planning:true});
 assert.match(rows([s,r])[0].status,/補修が必要/);
 const d=data([s,fact(2,s.problem_id,true),fact(3,s.problem_id,true,'retrieval_check')]);d.weakNotes=[{is_resolved:0,problem_id:s.problem_id}];
 const before=JSON.stringify(d);feedback.deriveCurrentWeaknessRows(d);assert.equal(JSON.stringify(d),before);
});
test('historical string-only grading parts remain evidence-insufficient instead of crashing current root view',()=>{
 const source=fact(1,'PY-fixture-Q1',false,'exam_performance',{grading_contract:undefined,graded_findings:undefined,error_type:'W',error_types:['W'],error_point:'係数の計算途中で停止',score_numeric:35});
 const old=fact(2,source.problem_id,true,'error_repair',{grading_contract:{gradedParts:['major_calculation']}});
 assert.doesNotThrow(()=>rows([source,old]));assert.ok(rows([source,old]).length);
 assert.ok(rows([source,old]).every(r=>!r.sources.some(s=>s.retrievalAttemptId||s.transferAttemptId)));
});
test('legacy source retains the exact target issued by its Review through later repair and delayed success',()=>{
 const source=fact(1,'PY-fixture-Q1',false,'exam_performance',{grading_contract:undefined,graded_findings:undefined,error_type:'W',error_types:['W'],error_point:'計算途中で停止',score_numeric:35});
 const part={id:`part:${source.problem_id}:1:1`,stableTargetKey:`target:${source.problem_id}:root:fixture`,label:'主要計算'};
 const later=(id,purpose)=>fact(id,source.problem_id,true,purpose,{grading_contract:{gradedParts:[part]},graded_findings:[{graded_part_id:part.id,error_type:'none',resolved:true,evidence:'対象を再現'}]});
 const result=rows([source,later(2,'error_repair'),later(3,'retrieval_check')]);assert.match(result[0].status,/保持成功.*転移未確認/);assert.equal(result[0].sources[0].retrievalAttemptId,3);
 const repeat={...later(2,'error_repair'),graded_findings:[{graded_part_id:part.id,error_type:'W',resolved:false,materiality:'major',evidence:'計算途中で停止'}],error_type:'W',error_types:['W']};
 const grouped=rows([source,repeat,later(3,'error_repair'),later(4,'retrieval_check')]);assert.equal(grouped.length,1,'same exact persisted target is one current group, not two new weaknesses');assert.equal(grouped[0].sources.length,2,'historical roots are not rewritten or discarded');
});
test('unreferenced same-session repair is repair only; independent delayed retrieval is still required',()=>{
 const source=fact(1,'PY-fixture-Q1',false,'exam_performance'),repair=fact(2,source.problem_id,true,'error_repair',{assessment_timing:'same_session_correction'}),retrieval=fact(3,source.problem_id,true,'retrieval_check');
 assert.match(rows([source,repair])[0].status,/補修成功.*保持未確認/);
 assert.match(rows([source,repair,retrieval])[0].status,/保持成功.*転移未確認/);
 const hinted={...repair,hint_used:true,actual_reference_level:3};assert.ok(!rows([source,hinted])[0].sources[0].retrievalAttemptId);
 assert.match(rows([source,repair,{...retrieval,assessment_timing:'same_session_correction'}])[0].status,/補修成功.*保持未確認/);
 const supervised={...repair,actual_reference_level:3,hint_used:true,grading_contract:{...repair.grading_contract,allowedReferenceLevel:3}};
 assert.match(rows([source,supervised])[0].status,/補修成功.*保持未確認/);
 assert.match(rows([source,supervised,retrieval])[0].status,/保持成功.*転移未確認/);
});
test('new transfer failure is not suppressed by a parent-linked same-problem success from before that failure',()=>{
 const source=fact(1,'PY-fixture-Q1',false,'exam_performance');const repair=fact(2,source.problem_id,true);repair.grading_contract.sourceAttemptId=1;
 const retrieval=fact(3,source.problem_id,true,'retrieval_check',{mark:'◎',score_numeric:100});retrieval.grading_contract.sourceAttemptId=2;
 const failure=fact(4,'GEN-fixture',false,'transfer_check',{source_type:'generated',transfer_lineage:{key:`training:${skill}`,rootSkillId:skill,sourceProblemId:source.problem_id,sourceFindingIds:['major_calculation'],matchConfidence:'high'},target_skill_assessment:{self_selected:true,major_calculation_success:false,no_major_error:false,evidence:'別問題の主要計算で停止'}});
 const c={sessionId:1,sourceProblemId:source.problem_id,sourceAttemptId:1,sourceFindingId:'major_calculation',sourceFindingIds:['major_calculation'],rootWeaknessId:deriveFailureEpisode(source).rootWeaknesses[0].rootWeaknessId,conceptId:skill,conceptLabel:'係数追跡',weaknessSkillIds:[skill],matchedSkillIds:[],materiality:'major',examImpact:'high',recurrence:0,required:true,whitebookProblemIds:[],transferProblemIds:[],repairKind:'rediagnosis',interventionChanged:true,transferFailureEvidenceId:4,reason:'別問題で対象計算に失敗',requiresUserConfirmation:true};
 const pool=deriveRankedStudyCandidates({today:'2026-10-14',daysRemaining:39,problems:[{problem_id:source.problem_id,source_type:'past_exam',category:'past_exam',title:'fixture'}],attempts:[source,repair,retrieval,failure],reviews:[],pastSessions:[],catalog:[],weaknesses:[],repairCandidates:[c]});
 const task=pool.tasks.find(t=>t.repair_lineage?.transferFailureEvidenceId===4);assert.ok(task,JSON.stringify(pool.waiting.map(w=>w.reason)));assert.equal(task.source_attempt_id,1);
 assert.deepEqual(task.grading_contract.gradedParts.map(p=>p.id),['major_calculation']);
 assert.equal(task.ranking.waitingDays,10,'a newly reopened root waits from its transfer failure, not the resolved original failure');
 assert.ok(task.ranking.evidenceIds.includes('attempt:4'));
 const b=data([source,repair,retrieval,failure]);b.today.tasks=pool.tasks;b.masteryByProblem[source.problem_id]={normalReviewComplete:true,levels:[]};
 const view=feedback.deriveProblemLearningView(b,{problem_id:source.problem_id});assert.equal(view.needsRepair,true,'list/detail must reflect verified transfer re-diagnosis, while same-problem retention remains complete');
 assert.match(view.retentionLabel,/保持確認済み/);
 b.today.tasks=[{...task,repair_lineage:{...task.repair_lineage,transferFailureEvidenceId:99}}];
 assert.equal(feedback.deriveProblemLearningView(b,{problem_id:source.problem_id}).needsRepair,false,'unverified failure IDs cannot reopen a graduate');
});
test('training and later natural PastExam success remain separate evidence strengths in current root view',()=>{
 const source=fact(1,'PY-fixture-Q1',false,'exam_performance'),r=fact(2,source.problem_id,true),ret=fact(3,source.problem_id,true,'retrieval_check');
 const natural=fact(4,'PY-fixture-Q2',true,'exam_performance',{source_type:'past_exam',mode:'full',target_skill_prompted:false});
 assert.match(rows([source,r,ret,natural])[0].status,/本番転移確認済み/);
 const uncertain={...natural,grading_confidence:.4};assert.match(rows([source,r,ret,uncertain])[0].status,/保持成功.*転移未確認/);
});
test('assisted repair progress never releases the protected benchmark by itself',()=>{
 const source=fact(1,'PY-2022-Q2',false,'exam_performance'),assisted=fact(2,source.problem_id,true,'error_repair',{hint_used:true,actual_reference_level:3,grading_contract:{...fact(2,source.problem_id,true).grading_contract,allowedReferenceLevel:3}});
 const session={id:1,year:2022,date:'2026-10-01',session_kind:'selected_three_timed',session_state:'completed',simulation_completed_at:'2026-10-01T12:00:00Z',selected_timed_attempt_ids:[1],selected_answer_count:3,initial_selected_problem_ids:['PY-2022-Q2','PY-2022-Q3','PY-2022-Q4'],final_selected_problem_ids:['PY-2022-Q2','PY-2022-Q3','PY-2022-Q4']};
 const release=attempts=>derivePastExamRoleRelease({attempts,pastSessions:[session],daysRemaining:30});
 assert.equal(release([source,assisted]).benchmarkReleased,false,'repair display is not permission to release a blind benchmark after hints');
 assert.equal(release([source,assisted,fact(3,source.problem_id,true)]).benchmarkReleased,true,'valid unassisted repair still releases after the minimal prerequisite, without all Reviews');
});
