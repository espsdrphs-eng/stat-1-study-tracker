import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {delayedTrainingPrerequisites,deriveTransferTrainingCandidates} from '../src/generatedTransfer.ts';
import {findingSkillIds} from '../src/skillEvidence.ts';
import {projectAdaptiveSnapshotTasks} from '../src/adaptiveTodayPlan.ts';
import {deriveCurrentTodayProjection} from '../src/currentTodayProjection.ts';
import {explainPastExamYearSelection,currentPastExamSessionExplanation} from '../src/pastExamPlanning.ts';
import {BUILT_IN_EXAM_REFERENCE_PACK} from '../src/builtinExamReferencePack.ts';
import {runIntegrityAudit} from '../src/integrityEngine.ts';
import {buildAdaptivePlannerShadow} from '../src/adaptivePlanner.ts';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {adaptivePlanDayToTasks} from '../src/adaptiveTodayPlan.ts';
import {GENERATION_CHECKS} from '../src/generatedTransfer.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {deriveTransferEvidence} from '../src/skillEvidence.ts';

// Field excerpts supplied from the 10/5 export, not a complete production copy.
// Unprovided contract labels/criteria below are minimal local fixture scaffolding.
const skill='coefficient_tracking_scale_reciprocal';
const part=(problem,id)=>({id,label:id,cueLabel:id,completionCriterionId:id,
  allowedErrorTypes:['W','N','C','none'],masteryLevel:2,
  stableTargetKey:`target:${problem}:slot:${id}`,evidenceSourceAttemptId:251});
const ids=['answer_conclusion','critical_condition','major_calculation'];
const source={id:251,problem_id:'PY-2019-Q2',date:'2026-09-08',mode:'full',mark:'△',score_numeric:78,
  actual_reference_level:0,grading_confidence:.99,learning_purpose:'exam_performance',
  grading_contract:{gradedParts:ids.map(id=>part('PY-2019-Q2',id))},
  graded_findings:[
    {graded_part_id:'answer_conclusion',error_type:'W',resolved:false,evidence:'係数2の欠落により最適値を誤った。正しい結論はalphaはsqrt(2)。'},
    {graded_part_id:'critical_condition',error_type:'C',resolved:false,evidence:'alpha>0なのに負の候補を残した。'},
    {graded_part_id:'major_calculation',error_type:'W',resolved:false,
      evidence:'XbarはU/2から1/Xbarは2/Uとすべきところ係数2を落とし、R(alpha)はalpha+1/alpha-2と誤計算した。'}]};
const success=(id,date,purpose,review)=>({...structuredClone(source),id,date,mark:purpose==='error_repair'?'○':'◎',
  mode:purpose==='error_repair'?'main_calc':'check',score_numeric:100,score_max:100,
  learning_purpose:purpose,learning_stage:purpose==='error_repair'?'repair':'maintenance',
  generated_from_review_id:review,assessment_timing:'delayed_retrieval',review_outcome:'success',
  target_issue_resolved:true,minimum_pass_condition_met:true,reference_level:0,actual_reference_level:0,
  hint_used:false,no_hint:true,policy_validity:'valid',exclude_from_metrics:false,exclude_from_planning:false,
  exclude_from_recurrence_metrics:false,exam_score_eligible:false,
  grading_contract:{...source.grading_contract,contractVersion:'STAT1-CONTRACT-v2',problemId:source.problem_id,
    sourceAttemptId:purpose==='error_repair'?251:269,reviewId:review,sourceReviewId:review,
    learningPurpose:purpose,learningStage:purpose==='error_repair'?'repair':'maintenance',
    mode:purpose==='error_repair'?'main_calc':'check',reviewScope:purpose==='error_repair'?'main_calc_target':'check_only',
    allowedReferenceLevel:0,contractId:`review:${review}:1`,contractHash:review===516?'gc-40c60f4c':'fixture-repair'},
  graded_findings:ids.map(id=>({graded_part_id:id,error_type:'none',resolved:true,evidence:'対象部分を参照なしで再現した。'}))});
const repair=success(269,'2026-09-17','error_repair',466);
const retrieval=success(307,'2026-10-05','retrieval_check',516);
const problem={problem_id:'PY-2017-Q4',source_type:'past_exam',title:'2017年問4'};
const contract={contractVersion:'STAT1-CONTRACT-v2',problemId:problem.problem_id,sourceAttemptId:299,
  reviewId:527,sourceReviewId:527,learningPurpose:'error_repair',learningStage:'repair',mode:'skeleton',
  reviewScope:'targeted_patch',allowedReferenceLevel:0,estimatedMinutes:10,contractId:'review:527:1',
  contractHash:'gc-92eb0583',gradedParts:[{...part(problem.problem_id,'answer_conclusion'),evidenceSourceAttemptId:299}],
  targetedParts:['answer_conclusion'],completionConditions:['対象を再現'],requiredEvidence:['結論'],sheetType:'skeleton_sheet'};
const review={id:527,problem_id:problem.problem_id,status:'pending',source_attempt_id:299,generated_from_attempt_id:299,
  earliest_date:'2026-10-01',preferred_date:'2026-10-02',latest_date:'2026-10-03',due_date:'2026-10-02',
  review_type:'skeleton_retry',learning_purpose:'error_repair',learning_stage:'repair',assessment_timing:'delayed_retrieval',
  mode:'skeleton',effective_mode:'skeleton',minutes:10,estimated_minutes:10,duration_minutes:5,grading_contract:contract};
const session={problem_id:problem.problem_id,title:'2017年 本番型session',minutes:90,triage:'must',kind:'得点形成',
  mode:'exam_90min',plan_origin:'adaptive_planner',past_exam_year:2017,past_exam_year_role:'training_pool',
  clean_selection_evidence:false,past_exam_task_type:'timed_three_question_session',
  stable_session_key:'past_exam_session:2017:timed_three_question_session:session-2017-1',
  session_problem_ids:[1,2,3,4,5].map(n=>`PY-2017-Q${n}`),past_exam_session_state:'planned',
  selected_year_reason:'2017年は5/5問露出でclean選題証拠を取得できるため'};
const reviewTask={...review,kind:'局所補修',minutes:10,triage:'must',plan_origin:'adaptive_planner'};
const snapshot={date:'2026-10-05',created_at:'2026-10-04T20:42:45.278Z',start_of_day_planned_minutes:112,tasks:[session]};

test('10/5 excerpts: empty skill does not erase 269 → 307 stable-target retention success',()=>{
  const root=deriveFailureEpisode(source).rootWeaknesses.find(r=>r.sourceFindingIds.includes('answer_conclusion'));
  const result=delayedTrainingPrerequisites(source,{...root,skillIds:[]},[source,repair,retrieval]);
  assert.equal(result.repair?.id,269);assert.equal(result.retrieval?.id,307);
  assert.equal(root.rootWeaknessId,'root:PY-2019-Q2:626e1250');
});
test('grounded coefficient operation links causal findings, not the distribution chapter',()=>{
  const before=JSON.stringify(source);
  for(const id of ['major_calculation','answer_conclusion'])
    assert.deepEqual(findingSkillIds(source,source.graded_findings.find(f=>f.graded_part_id===id)),[skill]);
  const vague={...source,graded_findings:[{graded_part_id:'answer_conclusion',error_type:'W',resolved:false,evidence:'指数分布で結論が違った'}]};
  assert.deepEqual(findingSkillIds(vague,vague.graded_findings[0]),[]);
  assert.equal(JSON.stringify(source),before);
});
test('sibling roots produce one canonical JIT candidate after repair/retrieval, not two successes',()=>{
  const rows=deriveTransferTrainingCandidates({record:BUILT_IN_EXAM_REFERENCE_PACK,attempts:[source,repair,retrieval],
    problems:[],pastSessions:[{year:2024,session_kind:'selected_three_timed',session_state:'completed'}]});
  assert.equal(rows.length,1);assert.equal(rows[0].lineage.rootSkillId,skill);
  assert.equal(rows[0].kind,'generated');assert.equal(rows[0].lineage.retrievalAttemptId,307);
});
for(const admitted of [false,true])test(`session anchor does not conflict with Review 527 (admitted=${admitted})`,()=>{
  const result=projectAdaptiveSnapshotTasks({snapshotTasks:[session],generatedTasks:admitted?[session,reviewTask]:[session],
    reviews:[review],today:snapshot.date,isCompleted:()=>false});
  assert.ok(result.some(t=>t.stable_session_key===session.stable_session_key));
  assert.equal(result.some(t=>t.id===527),admitted);
  assert.ok(result.reduce((n,t)=>n+t.minutes,0)<=100);
});
test('same anchor, distinct session instances remain distinct',()=>{
  const second={...session,stable_session_key:session.stable_session_key.replace('-1','-2')};
  const result=projectAdaptiveSnapshotTasks({snapshotTasks:[],generatedTasks:[session,second],reviews:[],today:snapshot.date});
  assert.equal(result.length,2);
});
test('individual → selected Review substitution has an auditable reason, not a lost task',()=>{
  const individual={...session,stable_session_key:undefined,past_exam_task_type:'individual_full',mode:'full',minutes:35};
  const result=deriveCurrentTodayProjection({snapshot:{...snapshot,tasks:[]},generatedTasks:[individual,reviewTask],
    attempts:[],pastSessions:[],reviews:[review],today:snapshot.date,completedMinutes:0,targetMinutes:120});
  assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].id,527);
  assert.ok(result.exclusions?.some(e=>e.reason==='review_substitution'&&e.replacedBy==='review:527'));
});
test('exposed training reason is not clean; benchmark/retest reasons are nonempty',()=>{
  const year={year:2017,yearRole:'training_pool',cleanScanEligible:false,exposedCount:5,eligibleRows:Array(5).fill({})};
  assert.doesNotMatch(explainPastExamYearSelection(year),/clean選題証拠を取得できる/);
  for(const [year,yearRole] of [[2024,'current_benchmark_simulation'],[2025,'historical_retest']])
    assert.equal(typeof explainPastExamYearSelection({year,yearRole,cleanScanEligible:false,exposedCount:0,eligibleRows:Array(5).fill({})}),'string');
});

test('unknown operation keeps retention success but cannot unlock theme-based transfer',()=>{
  const unknown={...source,graded_findings:source.graded_findings.map(f=>({...f,evidence:'指数分布の結論が違った'}))};
  const root=deriveFailureEpisode(unknown).rootWeaknesses[0];
  assert.equal(delayedTrainingPrerequisites(unknown,root,[unknown,repair,retrieval]).retrieval.id,307);
  assert.deepEqual(deriveTransferTrainingCandidates({record:BUILT_IN_EXAM_REFERENCE_PACK,attempts:[unknown,repair,retrieval],problems:[]}),[]);
});

test('start snapshot stays clean after own exposure; historical explanation is preserved',()=>{
  const rows=Array.from({length:5},(_,i)=>({year:2017,schedulable:true,gradable:true,exposure:'prompt_scanned',canonicalProblemId:`PY-2017-Q${i+1}`}));
  const raw={year:2017,scan_evidence_kind:'practice',selected_year_reason:'historical explanation'};
  assert.match(currentPastExamSessionExplanation(raw,rows),/clean選題証拠には含めない/);
  assert.match(currentPastExamSessionExplanation({...raw,exposure_snapshot_at_start:{classification:'clean'}},rows),/clean選題証拠を取得できる/);
  assert.equal(raw.selected_year_reason,'historical explanation');
});

test('audit accepts only a real admitted individual→Review replacement, not a missing session',()=>{
  const individual={...session,stable_session_key:undefined,past_exam_task_type:'individual_full',mode:'full',minutes:35};
  const audit=(eligible,current)=>runIntegrityAudit({attempts:[],reviews:[review],today:snapshot.date,
    todayPlanSnapshots:[snapshot],eligibleTodayTasks:eligible,currentTodayTasks:current});
  const substitutions=audit([individual,reviewTask],[reviewTask]);
  assert.equal(substitutions.counts.current_planner_eligibility_mismatch||0,0);
  assert.equal(substitutions.counts.formal_plan_current_projection_mismatch||0,0);
  const missing=audit([session,reviewTask],[reviewTask]);
  assert.ok(missing.issues.some(i=>i.category==='formal_plan_current_projection_mismatch'&&i.detail.includes(session.stable_session_key)));
  const both=audit([session,reviewTask],[session,reviewTask]);
  assert.equal(both.counts.duplicate_problem_task||0,0);
  assert.equal(audit([session],[session,session]).counts.duplicate_problem_task,1);
  const second={...session,stable_session_key:session.stable_session_key.replace('-1','-2')};
  assert.equal(audit([session,second],[session,second]).counts.duplicate_problem_task||0,0);
});

for(const budget of [90,120])test(`formal budget ${budget}: priority/caps remain before Today projection`,()=>{
  const record={...BUILT_IN_EXAM_REFERENCE_PACK,validation:{valid:true},reconciliation:{unresolvedWhitebookIds:[]}};
  const catalog=buildPastExamCatalog({record,sessions:[],attempts:[],exposureOverrides:{}});
  const problems=catalog.filter(r=>r.schedulable&&r.gradable).map(r=>({...problem,problem_id:r.canonicalProblemId}));
  const a={id:299,problem_id:problem.problem_id,date:'2026-09-30',mode:'full',mark:'△',score_numeric:80,
    actual_reference_level:0,grading_confidence:.99,grading_contract:contract,
    graded_findings:[{graded_part_id:'answer_conclusion',error_type:'W',resolved:false,evidence:'必須結論へ到達できず結果を失った'}]};
  const plan=buildAdaptivePlannerShadow({record,catalog,problems,attempts:[a],reviews:[review],pastSessions:[],weaknesses:[],
    currentTasks:[session],today:snapshot.date,examDate:'2026-11-15',targetMinutes:budget});
  const day=plan.plan14.plan[0];
  const admitted=adaptivePlanDayToTasks({day,problems,reviews:[review],today:snapshot.date});
  const projected=projectAdaptiveSnapshotTasks({snapshotTasks:[session],generatedTasks:admitted,reviews:[review],today:snapshot.date});
  assert.ok(projected.some(t=>t.stable_session_key===session.stable_session_key));
  assert.ok(projected.reduce((n,t)=>n+t.minutes,0)<=budget);
  assert.equal(projected.some(t=>t.id===527),admitted.some(t=>t.id===527));
  assert.ok(day.tasks.filter(t=>t.slot==='repair').length<=2);
  assert.ok(day.tasks.filter(t=>t.slot==='repair').reduce((n,t)=>n+t.minutes,0)<=30);
  if(budget===90)assert.equal(projected.some(t=>t.id===527),false);
  else assert.ok(projected.some(t=>t.id===527));
  assert.doesNotMatch(projected.find(t=>t.stable_session_key)?.selected_year_reason||'',/5\/5問露出でclean選題証拠を取得できる/);
});

test('Q2 excerpt sandbox: graduated retention → Planner JIT → blind grading → training → roundtrip → strong',async()=>{
  await import('fake-indexeddb/auto');
  const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');
  await localGet('/api/bootstrap');
  await db.attempts.bulkPut([source,repair,retrieval]);
  await db.reviews.put({id:516,problem_id:source.problem_id,status:'done',source_attempt_id:269,
    due_date:'2026-10-01',review_type:'light_check',grading_contract:{...retrieval.grading_contract,
      // Only these unprovided UI-contract details are local scaffolding.
      targetedParts:ids,explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],hiddenAnswerKey:[],
      completionCriteria:ids.map(id=>({id,displayText:'対象部分を再現'})),completionConditions:['対象部分を再現'],
      requiredEvidence:ids,allowedErrorTypes:['W','N','C','none'],requiresKEvidence:false,
      estimatedMinutes:5,sheetType:'check_sheet'}});
  const historicalAttempts=await db.attempts.toArray(),historicalReviews=await db.reviews.toArray();
  // Upgrade boundary: an existing, fully supplemented v1 pack must receive the
  // bounded operation without replacement of its manual/reference content.
  const legacyPack=JSON.parse((await db.meta.get('exam-reference-pack:active')).value);
  legacyPack.packHash='legacy-verified-manual-pack';
  legacyPack.validation.packHash=legacyPack.packHash;
  legacyPack.data.concepts=legacyPack.data.concepts.filter(c=>c.concept_id!==skill);
  legacyPack.data.manifest.counts.concepts=legacyPack.data.concepts.length;
  legacyPack.data.readme+='\nmanual content must survive';
  const legacyData=structuredClone(legacyPack.data);
  await db.meta.put({key:'exam-reference-pack:active',value:JSON.stringify(legacyPack)});
  await localGet('/api/bootstrap');
  const upgraded=JSON.parse((await db.meta.get('exam-reference-pack:active')).value);
  assert.equal(upgraded.data.concepts.filter(c=>c.concept_id===skill).length,1,'existing verified pack receives the canonical operation');
  assert.ok(upgraded.data.concepts.find(c=>c.concept_id===skill).operation_evidence);
  assert.deepEqual(upgraded.data.pastExamProblems,legacyData.pastExamProblems);
  assert.deepEqual(upgraded.data.whitebookLinks,legacyData.whitebookLinks);
  assert.equal(upgraded.data.readme,legacyData.readme);
  assert.deepEqual(await db.attempts.toArray(),historicalAttempts,'pack upgrade does not rewrite learning facts');
  assert.deepEqual(await db.reviews.toArray(),historicalReviews,'graduated historical Review stays unchanged');
  await localGet('/api/bootstrap');
  assert.deepEqual(JSON.parse((await db.meta.get('exam-reference-pack:active')).value),upgraded,'second upgrade makes no semantic change');
  await db.meta.put({key:'daily_study_minutes',value:'150'});
  const key=`training:${skill}`,call=(action,extra={})=>localPost('/api/transfer-training',{key,action,...extra});
  const preBenchmark=await localGet('/api/bootstrap');
  assert.ok(!preBenchmark.today.tasks.some(t=>t.transfer_training_key===key),'before benchmark, pending root is not a generated assignment');
  await assert.rejects(()=>call('start'),/実行対象|候補|保留/,'no JIT bypass before the existing eligibility condition');
  // Sandbox benchmark completion permits the existing post-benchmark JIT rule.
  await db.attempts.bulkPut([1,2,3].map(q=>({id:310+q,problem_id:`PY-2024-Q${q}`,date:'2026-10-04',
    mode:'timed',mark:'○',time_minutes:20,score_numeric:60,actual_reference_level:0,
    grading_confidence:.99,learning_purpose:'exam_performance',graded_findings:[],grading_contract:{gradedParts:[]}})));
  await db.pastSessions.put({id:800,year:2024,date:'2026-10-04',session_kind:'selected_three_timed',
    session_state:'completed',simulation_completed_at:'2026-10-04',scan_minutes:10,
    final_selected_problem_ids:[1,2,3].map(q=>`PY-2024-Q${q}`),
    questions:[1,2,3,4,5].map(q=>({questionLabel:`問${q}`,problemId:`PY-2024-Q${q}`,selected:q<=3}))});
  for(const row of await db.meta.where('key').startsWith('today-plan-snapshot:').toArray())await db.meta.delete(row.key);
  const before=await localGet('/api/bootstrap');
  assert.ok(before.today.tasks.some(t=>t.transfer_training_key===key));
  assert.ok(!before.reviews.some(r=>r.problem_id===source.problem_id&&['pending','overdue'].includes(r.status)));
  assert.equal(deriveTransferEvidence(await db.attempts.toArray()).length,0,'same-problem ◎ is not transfer');
  const draft={problem_text:'正の確率変数Zは0<z<1で密度3z²を持つ。記録値A=5Zに対し、0<t<5でF(t)=E[A^{-1}1{A>t}]を求めよ。',
    reference_solution:'A^{-1}=1/(5Z)、A>tはZ>t/5。F(t)=(3/5)∫_{t/5}^1 z dz=(3/10)(1-t²/25)。',
    grading_rubric:'自力で尺度変更と逆数の係数を保持し、切断範囲と積分を完遂。対象部分を独立評価。',
    difficulty:'統計検定1級',estimated_minutes:10,surface_features:['切断された重み付き平均','連続記録値'],generator_pass_id:'local-coefficient-generation'};
  assert.equal((await call('start')).status,'requested');
  await call('draft',{text:JSON.stringify(draft)});
  const gen=JSON.parse((await db.meta.get(`transfer-generation:${key}`)).value);
  await call('validate',{text:JSON.stringify({draft_hash:gen.rounds[0].hash,validator_pass_id:'independent-local-coefficient-check',
    checks:Object.fromEntries(GENERATION_CHECKS.map(c=>[c,{pass:true,evidence:'sandbox: 尺度変換後の密度f_A(a)=3a²/125から別計算してF(t)=3(25-t²)/250と一致。'}]))})});
  const blind=await call('view');
  assert.equal(blind.status,'ready');assert.ok(!JSON.stringify(blind).includes(skill));
  assert.ok(!JSON.stringify(blind).includes('reference_solution'));
  const pid=blind.problem.problem_id,p=await db.problems.get(pid),gc=buildInitialGradingContract({problem:p,mode:'full'});
  await call('submit',{answer:draft.reference_solution,minutes:10,referenceLevel:0});
  const update={problem_id:pid,problem_id_confirmed:true,date:'2026-10-05',mode:'full',score_numeric:100,
    score_label:'A',mark:'○',error_type:'none',error_types:['none'],error_point:'',next_action:'本番へ戻る',
    learning_purpose:'transfer_check',learning_stage:'transfer',review_scope:'full_answer',grading_confidence:.99,
    contract_id:gc.contractId,contract_hash:gc.contractHash,contract_version:gc.contractVersion,
    graded_part_ids:gc.gradedParts.map(p=>p.id),graded_findings:gc.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'尺度と逆数の係数を保持した'})),
    target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'1/(5Z)と下限t/5を自力で選択し積分した'}};
  await call('grade',{text:JSON.stringify({study_update:update})});
  let evidence=deriveTransferEvidence(await db.attempts.toArray());
  assert.equal(evidence.filter(e=>e.evidenceStrength==='training').length,1,'sibling lineage does not double-count');
  assert.equal(evidence.filter(e=>e.evidenceStrength==='strong').length,0);
  const after=await localGet('/api/bootstrap');
  assert.deepEqual(after.dashboard.readiness.evidence.selectedThree,before.dashboard.readiness.evidence.selectedThree);
  const exported=await exportBackup();await restoreBackup(exported);
  await localGet('/api/bootstrap');await localGet('/api/bootstrap');
  assert.equal((await call('view')).problem.problem_id,pid);
  assert.equal((await db.problems.toArray()).filter(p=>p.source_type==='generated').length,1);
  assert.equal(deriveTransferEvidence(await db.attempts.toArray()).filter(e=>e.evidenceStrength==='training').length,1);
  const audit=await localPost('/api/integrity/audit',{});
  assert.equal(audit.blockingIntegrityIssueCount,0);assert.equal(audit.plannerPolicyViolationCount,0);
  const last=Math.max(...(await db.attempts.toArray()).map(a=>a.id));
  await db.attempts.put({...retrieval,id:last+1,problem_id:'PY-2016-Q1',mode:'full',date:'2026-10-06',
    learning_purpose:'exam_performance',generated_from_review_id:undefined,source_type:'past_exam',
    grading_contract:{gradedParts:[{id:'major_calculation',rootSkillIds:[skill]}]},
    graded_findings:[{graded_part_id:'major_calculation',error_type:'none',resolved:true,evidence:'係数を保持し参照なし自然成功'}]});
  evidence=deriveTransferEvidence(await db.attempts.toArray());
  assert.equal(evidence.filter(e=>e.evidenceStrength==='strong').length,1);
});
