import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {readFile,writeFile} from 'node:fs/promises';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {deriveTransferTrainingCandidates,GENERATION_CHECKS} from '../src/generatedTransfer.ts';
import {deriveTransferEvidence} from '../src/skillEvidence.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const skill='finite_population_correction',key=`training:${skill}`;
const sourceId='PY-2023-Q5';
const fact=(id,date,purpose,success)=>({id,problem_id:sourceId,date,mode:'main_calc',time_minutes:12,
  score_numeric:success?90:35,score_label:success?'A':'C',mark:success?'○':'△',error_type:success?'none':'W',error_types:[success?'none':'W'],
  error_point:success?'':'共分散と有限修正へ到達できない',next_action:'局所再現',actual_reference_level:0,grading_confidence:.95,
  learning_purpose:purpose,assessment_timing:purpose==='retrieval_check'?'delayed_retrieval':'independent_performance',
  grading_contract:{gradedParts:[{id:'major_calculation',label:'主要計算',rootSkillIds:[skill],masteryLevel:2}]},
  graded_findings:[{graded_part_id:'major_calculation',error_type:success?'none':'W',resolved:success,evidence:success?'共分散を独立に導出した':'共分散から分散を導けない'}]});
const generatedDraft={problem_text:'M>1 個の記録 z_1,...,z_M があり、その和は0である。1≤r<M とする。無作為に r 個だけへ印を付け、印付き平均と残りの平均の差 D を作る。D の期待値と分散を、M,r と S²=M^{-1}Σz_j² で表せ。必要な二次積の期待値も示せ。',
  reference_solution:'印を I_j とする。E I_j=r/M, E I_j I_k=r(r−1)/(M(M−1)) (j≠k)。D=M/[r(M−r)] ΣI_j z_j。Σz_j=0 より E D=0、Σ_{j≠k}z_jz_k=−Σz_j²。Var ΣI_jz_j=r(M−r)S²/(M−1)。従って Var D=M² S²/[r(M−r)(M−1)]。',
  grading_rubric:'固定個数の割付による依存を二次積へ接続し、差の分散を導く。targetを自力で選んだか、主要計算、major errorの有無を個別確認。対象外のminor表記誤りは独立判定。',
  difficulty:'統計検定1級',estimated_minutes:12,surface_features:['固定個数のラベル割付','印付き平均と残りの差D'],generator_pass_id:'sandbox-generation'};

test('sandbox: canonical Planner selection → two-pass generation → blind Attempt → training → strong → restore',async()=>{
  await localGet('/api/bootstrap');
  await db.meta.put({key:'daily_study_minutes',value:'150'});
  // Optional real snapshot is restored only inside this isolated fake IndexedDB.
  if(process.env.STAT_STUDY_FIXTURE)await restoreBackup(JSON.parse(await readFile(process.env.STAT_STUDY_FIXTURE,'utf8')));
  await db.attempts.bulkPut([fact(9001,'2026-09-20','exam_performance',false),fact(9002,'2026-09-21','error_repair',true),fact(9003,'2026-09-23','retrieval_check',true)]);
  // Prevent intentional reuse of the already-exposed same-skill 2018 problem.
  await db.meta.put({key:'exam-reference-pack:exposure-overrides',value:JSON.stringify({'PY-2018-Q2':'answer_exposed'})});
  if(!(await db.attempts.where('problem_id').equals('PY-2018-Q2').count()))await db.attempts.put({...fact(8999,'2026-09-19','exam_performance',true),problem_id:'PY-2018-Q2'});
  await db.pastSessions.put({id:9001,year:2023,date:'2026-09-20',session_kind:'individual_full',linked_attempt_ids:[9001],
    initial_selected_problem_ids:[sourceId],final_selected_problem_ids:[sourceId],questions:[],execution_status:'completed'});
  for(const row of await db.meta.where('key').startsWith('today-plan-snapshot:').toArray())await db.meta.delete(row.key);
  const call=(action,extra={})=>localPost('/api/transfer-training',{key,action,...extra});
  let state=await localGet('/api/bootstrap');
  const training=state.adaptiveLearning?.pastExamRepairCandidates;
  let task=state.today.tasks.find(t=>t.transfer_training_key===key);
  for(let round=0;!task&&process.env.STAT_STUDY_FIXTURE&&round<12;round++){
    await assert.rejects(()=>call('start'),/実行対象/,'real backlog cannot be bypassed just to generate a question');
    // In the copy only, explicitly defer other current repairs to test the
    // later available training slot. Do not invent successes for those roots.
    for(const t of state.today.tasks.filter(t=>t.review_type&&t.triage==='must')){
      await localPost(`/api/reviews/${t.id}/postpone`,{unscheduled:true,postpone_reason:'sandboxのみ：後日の空き補修枠を検証'});
    }
    for(const row of await db.meta.where('key').startsWith('today-plan-snapshot:').toArray())await db.meta.delete(row.key);
    state=await localGet('/api/bootstrap');task=state.today.tasks.find(t=>t.transfer_training_key===key);
  }
  assert.ok(task,`canonical Planner selection: ${JSON.stringify({training,tasks:state.today.tasks.map(t=>({id:t.problem_id,key:t.transfer_training_key}))})}`);
  assert.equal(task.today_category,'repair');
  const plannedAudit=await localPost('/api/integrity/audit',{});
  console.log(JSON.stringify({plannedAudit:{blocking:plannedAudit.blockingIntegrityIssueCount,
    planner:plannedAudit.plannerPolicyViolationCount,issues:plannedAudit.issues.filter(i=>i.severity==='active').map(i=>({category:i.category,detail:i.detail}))}}));
  assert.equal(plannedAudit.issues.filter(i=>i.category==='transfer_required_but_no_candidate_generation').length,0,
    'JIT candidate is a valid generation outcome before a problem ID exists');
  assert.equal((await db.problems.toArray()).filter(p=>p.source_type==='generated').length,0,'D: no generation before execution selection');
  if(process.env.TRANSFER_BROWSER_FIXTURE)await writeFile(process.env.TRANSFER_BROWSER_FIXTURE,JSON.stringify(await exportBackup()));
  const started=await call('start');assert.ok(started.prompt);assert.equal(started.status,'requested');
  await call('draft',{text:JSON.stringify(generatedDraft)});
  const record=JSON.parse((await db.meta.get(`transfer-generation:${key}`)).value);
  await call('validate',{text:JSON.stringify({draft_hash:record.rounds[0].hash,validator_pass_id:'sandbox-independent-solution-check',
    checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:`sandbox ${k}: 独立に二次積とゼロ和制約から分散を照合した。`}]))})});
  const blind=await call('view');assert.equal(blind.status,'ready');
  assert.ok(!JSON.stringify(blind).includes('reference_solution'));assert.ok(!JSON.stringify(blind).includes(skill));
  await assert.rejects(()=>call('grading-prompt'));
  const p=await db.problems.get(blind.problem.problem_id),contract=buildInitialGradingContract({problem:p,mode:'full'});
  await call('submit',{answer:generatedDraft.reference_solution,minutes:12,referenceLevel:0});
  assert.ok((await call('grading-prompt')).prompt.includes(skill));
  const beforeReviews=await db.reviews.count();
  const update={problem_id:p.problem_id,problem_id_confirmed:true,date:today(),mode:'full',score_numeric:90,score_label:'A',
    mark:'○',error_type:'C',error_types:['C'],error_point:'target外の記号のminor誤り',next_action:'本番へ戻る',
    learning_purpose:'transfer_check',learning_stage:'transfer',review_scope:'full_answer',grading_confidence:.95,
    contract_id:contract.contractId,contract_hash:contract.contractHash,contract_version:contract.contractVersion,
    graded_part_ids:contract.gradedParts.map(p=>p.id),graded_findings:contract.gradedParts.map(p=>({graded_part_id:p.id,
      error_type:p.id==='answer_conclusion'?'C':'none',resolved:p.id!=='answer_conclusion',evidence:'答案で対象操作を確認'})),
    target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'固定個数の割付で二次積を導き、差の分散へ接続した'}};
  await call('grade',{text:JSON.stringify({study_update:update})});
  const a=(await db.attempts.where('problem_id').equals(p.problem_id).toArray())[0];
  assert.equal(a.exam_score_eligible,false);assert.equal(a.evidence_strength,'training');assert.equal(a.time_minutes,12);
  assert.equal(await db.reviews.count(),beforeReviews,'M: no generated minor Review proliferation');
  let evidence=deriveTransferEvidence(await db.attempts.toArray());
  assert.ok(evidence.some(e=>e.successAttemptId===a.id&&e.evidenceStrength==='training'));
  await call('grade',{text:JSON.stringify({study_update:update})});
  assert.equal(await db.attempts.where('problem_id').equals(p.problem_id).count(),1);
  await localGet('/api/bootstrap');await localGet('/api/bootstrap');
  const exported=await exportBackup();await restoreBackup(exported);
  const audit=await localPost('/api/integrity/audit',{});
  console.log(JSON.stringify({sandboxAudit:{blocking:audit.blockingIntegrityIssueCount,planner:audit.plannerPolicyViolationCount,
    generatedIssues:audit.issues.filter(i=>i.category.startsWith('generated_')).length}}));
  assert.equal(audit.issues.filter(i=>i.category.startsWith('generated_')).length,0);
  assert.equal(audit.blockingIntegrityIssueCount,0);
  assert.equal(audit.plannerPolicyViolationCount,0);
  assert.deepEqual((await db.problems.get(p.problem_id)).generated_transfer,p.generated_transfer?{...p.generated_transfer,
    lifecycle_status:'graded',answer_submission:(await db.problems.get(p.problem_id)).generated_transfer.answer_submission}:undefined);
  assert.equal((await call('view')).status,'graded');
  assert.equal((await db.problems.toArray()).filter(p=>p.source_type==='generated').length,1);
  const natural={...fact(a.id+1,today(),'exam_performance',true),problem_id:'PY-2018-Q2',mode:'full',source_type:'past_exam'};
  await db.attempts.put(natural);evidence=deriveTransferEvidence(await db.attempts.toArray());
  assert.ok(evidence.some(e=>e.successAttemptId===a.id&&e.evidenceStrength==='training'));
  assert.ok(evidence.some(e=>e.successAttemptId===natural.id&&e.evidenceStrength==='strong'));
});
