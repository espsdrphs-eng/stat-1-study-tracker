import test from 'node:test';
import assert from 'node:assert/strict';
import * as skills from '../src/skillEvidence.ts';
import * as feedback from '../src/learningFeedback.ts';
import * as transfer from '../src/transferTrainingApi.ts';
const skill='coefficient_tracking_scale_reciprocal';
const fact=(id,problem,ok,extra={})=>({id,problem_id:problem,date:'2026-10-14',mode:'main_calc',learning_purpose:'error_repair',assessment_timing:'delayed_retrieval',
 error_type:ok?'none':'W',error_types:[ok?'none':'W'],score_numeric:ok?100:45,actual_reference_level:0,grading_confidence:.99,
 grading_contract:{contractId:`review:fixture:${id}`,contractHash:`gc-fixture-${id}`,learningPurpose:'error_repair',reviewScope:'targeted_patch',mode:'main_calc',targetKind:'mathematical_patch',
  gradedParts:[{id:'major_calculation',stableTargetKey:`target:${problem}:slot:major_calculation`,label:'主要計算',rootSkillIds:[skill]}]},
 graded_findings:[{graded_part_id:'major_calculation',materiality:'major',resolved:ok,error_type:ok?'none':'W',evidence:ok?'対象の係数を保持して計算を完了':'逆数へ変換する係数2を落とした'}],...extra});
const data=attempts=>({attempts,reviews:[],problems:attempts.map(a=>({problem_id:a.problem_id,source_type:'past_exam'})),problemAliases:[],masteryByProblem:{},
 dashboard:{today:'2026-10-14'},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}},adaptiveLearning:{conceptWeaknesses:[]}});

test('stage2: scoped skill observations distinguish success, assisted, failure, uncertainty and excluded evidence',()=>{
 assert.equal(typeof skills.findingEvidenceStatus,'function');
 const good=fact(1,'PY-fixture-Q1',true),bad=fact(2,good.problem_id,false),observe=a=>skills.findingEvidenceStatus(a,a.graded_findings[0]);
 assert.equal(observe(good).outcome,'success');assert.equal(observe({...good,actual_reference_level:3,hint_used:true}).outcome,'assisted_success');
 assert.equal(observe(bad).outcome,'failure');assert.equal(observe({...good,grading_confidence:.4}).outcome,'uncertain');
 assert.equal(observe({...good,graded_findings:[{...good.graded_findings[0],resolved:false}]}).outcome,'uncertain');
 assert.equal(observe({...bad,exclude_from_planning:true}).outcome,'excluded');
 assert.deepEqual(observe(good).skillIds,[skill]);
});

test('stage5: latest assisted or uncertain transfer is visible without erasing prior retention or claiming transfer success',()=>{
 const source=fact(1,'PY-fixture-Q1',false,{date:'2026-10-10'}),repair=fact(2,source.problem_id,true,{date:'2026-10-11'}),retention=fact(3,source.problem_id,true,{date:'2026-10-12',learning_purpose:'retrieval_check'});
 const lineage={key:`training:${skill}`,sourceProblemId:source.problem_id,sourceAttemptId:1,rootSkillId:skill,sourceFindingIds:['major_calculation'],matchConfidence:'high'};
 const training=fact(4,'GEN-fixture',true,{date:'2026-10-13',learning_purpose:'transfer_check',source_type:'generated',transfer_lineage:lineage,actual_reference_level:3,hint_used:true,
  target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'援助を使って対象計算を確認'}});
 const current=feedback.deriveWeaknessDisplayRows(data([source,repair,retention,training]))[0].sources[0];
 assert.equal(current.lastCheckedAttemptId,4);assert.equal(current.retrievalAttemptId,3);assert.equal(current.transferAttemptId,undefined);assert.equal(current.observations[0].outcome,'assisted_success');
 const uncertain={...training,id:5,actual_reference_level:0,hint_used:false,grading_confidence:.4};
 const row=feedback.deriveWeaknessDisplayRows(data([source,repair,retention,uncertain]))[0].sources[0];
 assert.equal(row.lastCheckedAttemptId,5);assert.equal(row.observations[0].outcome,'uncertain');assert.equal(row.transferAttemptId,undefined);
});

test('stage3: a repeated success on the same destination is one current transfer opportunity, history stays intact',()=>{
 const source=fact(1,'PY-fixture-Q1',false);
 const success=id=>fact(id,'GEN-fixture',true,{learning_purpose:'transfer_check',source_type:'generated',transfer_lineage:{key:`training:${skill}`,sourceProblemId:source.problem_id,sourceAttemptId:1,rootSkillId:skill,sourceFindingIds:['major_calculation'],matchConfidence:'high'},
  target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'別問題の対象操作を自力で確認'}});
 const facts=[source,success(2),success(3)];assert.equal(skills.deriveTransferEvidence(facts).length,2,'keep historical attempts');
 assert.equal(skills.currentTransferEvidence(facts).length,1);assert.equal(skills.currentTransferEvidence(facts)[0].successAttemptId,3);
 const d=data(facts);d.today.canonicalStudyPlan.ranked.waiting=[{task:{problem_id:source.problem_id},reason:'転移候補なし：技能照合を待つ',reevaluateWhen:'別問題成功後'}];
 const rows=feedback.deriveCurrentWeaknessRows(d);
 assert.ok(rows.flatMap(r=>r.sources).every(s=>s.transferAttemptId&&s.nextAction==='次の自然な過去問で再測定'),'verified transfer must supersede the obsolete pre-transfer waiting explanation');
});

test('stage4: saved target changes and evidence stages explain improvement without adding repair scores to exam metrics',()=>{
 const source=fact(1,'PY-fixture-Q1',false,{date:'2026-10-10'}),repair=fact(2,source.problem_id,true,{date:'2026-10-11'});
 repair.grading_contract={...repair.grading_contract,sourceAttemptId:source.id};
 const d=data([source,repair]);d.pastSessions=[];
 const summary=feedback.deriveLearningUpdateSummary(d);
 assert.ok(summary.targets.some(t=>t.improved&&t.outcome==='success'));
 assert.ok(summary.stageChanges.some(s=>/補修が必要/.test(s.before)&&/補修成功.*保持未確認/.test(s.after)));
 assert.ok(summary.metricChanges.length>=4);assert.ok(summary.metricChanges.every(m=>!m.changed));
 const uncertain=feedback.deriveLearningUpdateSummary({...d,attempts:[source,{...repair,grading_confidence:.4}]});
 assert.ok(uncertain.targets.every(t=>!t.improved&&t.outcome==='uncertain'));
 const failed=fact(3,source.problem_id,false,{date:'2026-10-12',grading_contract:{...repair.grading_contract,sourceAttemptId:repair.id}});
 assert.ok(feedback.deriveLearningUpdateSummary({...d,attempts:[source,repair,failed]}).targets.some(t=>t.newFailure));
});

test('stage3: generated and existing grading echo the app-owned source, destination and skill, rejecting a different source',()=>{
 assert.equal(typeof transfer.transferGradingContext,'function');
 const lineage={key:`training:${skill}`,rootWeaknessId:'root:fixture',rootSkillId:skill,sourceProblemId:'PY-fixture-Q1',sourceAttemptId:1,sourceFindingIds:['major_calculation'],repairAttemptId:2,retrievalAttemptId:3,matchConfidence:'high'};
 const context=transfer.transferGradingContext(lineage,'GEN-fixture');
 assert.equal(context.source_problem_id,lineage.sourceProblemId);assert.equal(context.destination_problem_id,'GEN-fixture');assert.equal(context.root_skill_id,skill);
 const u={...fact(4,'GEN-fixture',true),problem_id_confirmed:true,actual_reference_level:0,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'実答案の対象計算を確認'},transfer_task_context:context};
 assert.doesNotThrow(()=>transfer.validateTransferGrade({study_update:u},u.problem_id,context));
 assert.throws(()=>transfer.validateTransferGrade({study_update:{...u,transfer_task_context:{...context,source_attempt_id:99}}},u.problem_id,context),/転移.*一致/);
 assert.throws(()=>transfer.validateTransferGrade({study_update:{...u,transfer_task_context:{...context,root_skill_id:'other_skill'}}},u.problem_id,context),/転移.*一致/);
 const old={...u};delete old.transfer_task_context;assert.doesNotThrow(()=>transfer.validateTransferGrade({study_update:old},old.problem_id,context),'legacy output still passes only the existing destination contract checks at save');
 const scoped=transfer.transferGradingContext(lineage,'GEN-fixture',{status:'identified',primaryTargetParts:['[2]'],secondaryTargetParts:[],referenceOnlyParts:[]});
 const reordered={...scoped,source_answer_scope:{reference_only_parts:[],secondary_target_parts:[],primary_target_parts:['[2]'],status:'identified'}};
 assert.doesNotThrow(()=>transfer.validateTransferGrade({study_update:{...u,transfer_task_context:reordered}},u.problem_id,scoped),'JSON object field order is not a different task');
});

test('stage2: one grounded skill is displayed by its canonical name with independent task scopes, no history rewrite',()=>{
 // Physical scope comes from the linked graded Attempt, not an invented Review
 // field; mirror the same source representation as existing scope regressions.
 const a=fact(1,'PY-fixture-Q1',false,{next_action:'[2]だけを解く。'}),b=fact(2,'PY-fixture-Q2',false,{next_action:'[3]だけを解く。'}),d=data([a,b]);
 d.reviews=[a,b].map((f,i)=>({id:10+i,problem_id:f.problem_id,status:'pending',source_attempt_id:f.id,learning_purpose:'error_repair',next_action:`[${i+2}]だけを解く。`,grading_contract:f.grading_contract}));
 const before=JSON.stringify(d),rows=feedback.deriveWeaknessDisplayRows(d);
 assert.equal(rows.length,1);assert.equal(rows[0].skillName,'定数倍・逆数をまたぐ係数追跡');
 assert.deepEqual(rows[0].sources.map(s=>s.answerScope.primaryTargetParts),[['[2]'],['[3]']]);
 assert.ok(rows[0].sources.every(s=>s.observations[0].outcome==='failure'));assert.equal(JSON.stringify(d),before);
 const ungrounded={...b,grading_contract:undefined,graded_findings:[{...b.graded_findings[0],evidence:'指数分布の問題で計算が未完成'}]};
 assert.ok(feedback.deriveWeaknessDisplayRows(data([a,ungrounded])).some(r=>r.identityPending));
});
