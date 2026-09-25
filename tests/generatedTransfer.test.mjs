import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTransferEvidence,rootProgress} from '../src/skillEvidence.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {examScoreEligibility} from '../src/scoreEligibility.ts';
import {readFile} from 'node:fs/promises';
import {deriveTransferTrainingCandidates,acceptGenerationDraft,acceptGenerationValidation,registerGeneratedProblem,
  blindGeneratedView,validateGeneratedContent,GENERATION_CHECKS} from '../src/generatedTransfer.ts';
import {calculateExamReadinessMetrics} from '../src/examReadiness.ts';
import {buildPastExamRepairCandidates} from '../src/conceptWeakness.ts';
import {generatedAttemptFields} from '../src/transferTrainingApi.ts';

const pack=JSON.parse(await readFile(new URL('../src/data/examReferencePackV1.json',import.meta.url),'utf8'));

const fact=(id,problem_id,success=false,extra={})=>({id,problem_id,date:`2026-09-${10+id}`,mode:'full',time_minutes:12,
  score_numeric:success?95:40,actual_reference_level:0,grading_confidence:.95,
  grading_contract:{gradedParts:[{id:'major_calculation',rootSkillIds:['finite_population_correction']}]},
  graded_findings:[{graded_part_id:'major_calculation',error_type:success?'none':'W',resolved:success}],...extra});

test('generated full answers are never exam-score eligible',()=>{
  assert.equal(examScoreEligibility(fact(2,'generated',true),{source_type:'generated',category:'generated'}).eligible,false);
});
test('intentional transfer training and natural exam transfer have different strength',()=>{
  const source=fact(1,'PY-2023-Q5');
  const generated=fact(2,'GEN-example',true,{source_type:'generated',learning_purpose:'transfer_check',
    transfer_lineage:{rootSkillId:'finite_population_correction',sourceProblemId:source.problem_id},
    target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'derived covariance without a hint'}});
  const natural=fact(3,'PY-2022-Q2',true,{source_type:'past_exam',learning_purpose:'exam_performance'});
  const rows=deriveTransferEvidence([source,generated,natural]);
  assert.equal(rows.find(r=>r.successAttemptId===2)?.evidenceStrength,'training');
  assert.equal(rows.find(r=>r.successAttemptId===3)?.evidenceStrength,'strong');
});
test('a high total score cannot replace explicit generated target-skill success',()=>{
  const rows=deriveTransferEvidence([fact(1,'PY-2023-Q5'),fact(2,'GEN-example',true,{
    source_type:'generated',target_skill_assessment:{self_selected:false,major_calculation_success:true,no_major_error:true,evidence:'formula supplied'}})]);
  assert.equal(rows.length,0);
});

export {fact};

const source=fact(10,'PY-2023-Q5',false,{date:'2026-09-20'});
const repair=fact(11,source.problem_id,true,{date:'2026-09-21',learning_purpose:'error_repair'});
const retrieval=fact(12,source.problem_id,true,{date:'2026-09-24',learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval'});
const candidates=(attempts,problems=[])=>deriveTransferTrainingCandidates({record:pack,attempts,problems});
const eligible=candidates([source,repair,retrieval])[0];
const newRecord=()=>({key:eligible.key,lineage:eligible.lineage,createdAt:'2026-09-24',status:'requested',rounds:[]});
export const draft={problem_text:'異なる測定値 a_1,...,a_M を持つ M 台の装置から、無作為に r 台を一度ずつ選ぶ。選んだ値の和を T とする。母集団の平均と分散を定義し、T の期待値と分散を導き、r=M の場合と整合することを示せ。',
  reference_solution:'μ=M^{-1}Σa_j, σ²=M^{-1}Σ(a_j−μ)²。抽出位置の値を X_i と置くと E X_i=μ、Var X_i=σ²。異なる位置で E X_iX_j=((Σa)^2−Σa²)/(M(M−1))、従って Cov(X_i,X_j)=−σ²/(M−1)。E T=rμ、Var T=rσ²+r(r−1)(−σ²/(M−1))=r(M−r)σ²/(M−1)。r=M なら分散は0。M>1,1≤r≤M とする。',
  grading_rubric:'母集団分散の定義、異なる位置の積の期待値、独立ではないことを反映した和の分散を評価。target選択と主要計算を独立採点し、記号の軽微誤りはtargetのmajor failureにしない。',
  difficulty:'統計検定1級',estimated_minutes:12,surface_features:['測定装置','a_jとT'],generator_pass_id:'sandbox-generation-1'};
export const validation=(record,pass=true)=>({draft_hash:record.rounds.at(-1).hash,validator_pass_id:'sandbox-independent-check',
  checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass,evidence:`sandbox fixtureの${k}検証。実モデルの検証を代替するものではない。` }]))});

test('grading cannot downgrade reported reference usage; source lineage enables maintenance substitution',()=>{
  const fields=generatedAttemptFields({generated_transfer:{lineage:eligible.lineage,answer_submission:{referenceLevel:0,minutes:12}}},
    {actual_reference_level:3,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'target success'}});
  assert.equal(fields.actual_reference_level,3);
  assert.equal(fields.source_problem_id,source.problem_id);
});

test('target failure after retrieval returns the original root to diagnosis, not another generated problem',()=>{
  const failure=fact(13,'GEN-failed',false,{date:'2026-09-25',source_type:'generated',transfer_lineage:eligible.lineage,
    target_skill_assessment:{self_selected:true,major_calculation_success:false,no_major_error:false,evidence:'二次積が導けず停止'}});
  const progress=rootProgress(source,deriveFailureEpisode(source).rootWeaknesses[0],[source,repair,retrieval,failure]);
  assert.equal(progress.repairSuccess,undefined);
  assert.equal(progress.transferFailure?.id,13);
});

test('sandbox solution independently agrees with exact enumeration of all fixed-size assignments',()=>{
  for(const z of [[-3,-1,1,3],[-4,-2,0,2,4]])for(let r=1;r<z.length;r++){
    const m=z.length,values=[];
    for(let mask=0;mask<2**m;mask++)if(mask.toString(2).replaceAll('0','').length===r){
      const sum=z.reduce((s,x,j)=>s+((mask>>j)&1?x:0),0);values.push(m*sum/(r*(m-r)));
    }
    const mean=values.reduce((s,x)=>s+x,0)/values.length,variance=values.reduce((s,x)=>s+(x-mean)**2,0)/values.length;
    assert.ok(Math.abs(mean)<1e-10);
    assert.ok(Math.abs(variance-m*m*(z.reduce((s,x)=>s+x*x,0)/m)/(r*(m-r)*(m-1)))<1e-10);
  }
});

test('A/B: major root alone or repair alone cannot request generation',()=>{
  assert.deepEqual(candidates([source]),[]);assert.deepEqual(candidates([source,repair]),[]);
  assert.deepEqual(candidates([source,repair,{...retrieval,date:repair.date}]),[]);
});
test('canonical taxonomy is mandatory; an invented skill stays pending',()=>{
  const changed=[source,repair,retrieval].map(a=>({...a,grading_contract:{gradedParts:[{id:'major_calculation',rootSkillIds:['invented_skill']}]}}));
  assert.deepEqual(candidates(changed),[]);
});
test('C: explicit high-confidence existing problem wins; chapter similarity does not',()=>{
  const wb={problem_id:'WB-fixture',source_type:'whitebook',classification_confidence:'high',root_skill_ids:['finite_population_correction']};
  assert.equal(candidates([source,repair,retrieval],[wb])[0].existingProblemId,wb.problem_id);
  assert.equal(candidates([source,repair,retrieval],[{...wb,root_skill_ids:[],theme:'finite population'}])[0].kind,'generated');
  assert.equal(candidates([source,repair,retrieval],[{...wb,classification_confidence:'low'}])[0].kind,'generated');
});
test('E/F: two-pass validation precedes stable blind registration; content cannot mutate on restore',async()=>{
  let r=await acceptGenerationDraft(newRecord(),JSON.stringify(draft));
  assert.throws(()=>registerGeneratedProblem(r,'GEN-fixture','2026-09-24'));
  assert.throws(()=>acceptGenerationValidation(r,JSON.stringify({...validation(r),validator_pass_id:draft.generator_pass_id})));
  r=acceptGenerationValidation(r,JSON.stringify(validation(r)));
  const p=registerGeneratedProblem(r,'GEN-fixture','2026-09-24');await validateGeneratedContent(p);
  const blind=JSON.stringify(blindGeneratedView(p));
  assert.ok(!blind.includes('root_skill'));assert.ok(!blind.includes('reference_solution'));assert.ok(!blind.includes(source.problem_id));
  await assert.rejects(()=>validateGeneratedContent({...p,generated_transfer:{...p.generated_transfer,problem_text:'changed'}}));
  await assert.rejects(()=>acceptGenerationDraft({...r,status:'registered'},JSON.stringify(draft)));
});
test('validation retries are bounded at two, without registration on failure',async()=>{
  let r=await acceptGenerationDraft(newRecord(),JSON.stringify(draft));
  r=acceptGenerationValidation(r,JSON.stringify(validation(r,false)));assert.equal(r.status,'requested');
  r=await acceptGenerationDraft(r,JSON.stringify({...draft,generator_pass_id:'second'}));
  r=acceptGenerationValidation(r,JSON.stringify(validation(r,false)));assert.equal(r.status,'pending');
  await assert.rejects(()=>acceptGenerationDraft(r,JSON.stringify(draft)));
});
test('G/H/I/J/K/L: target-specific training, no reference, exam KPI isolation and later strong evidence',()=>{
  const before=[source,repair,retrieval];
  const trained=fact(13,'GEN-fixture',true,{date:'2026-09-25',source_type:'generated',evidence_strength:'training',learning_purpose:'transfer_check',
    transfer_lineage:eligible.lineage,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'答案で異なる抽出位置の積を計算'}});
  assert.equal(deriveTransferEvidence([...before,trained]).filter(r=>r.evidenceStrength==='training').length,1);
  assert.equal(deriveTransferEvidence([...before,{...trained,actual_reference_level:3}]).length,0);
  assert.equal(deriveTransferEvidence([...before,{...trained,target_skill_assessment:{...trained.target_skill_assessment,major_calculation_success:false}}]).length,0);
  const metrics=attempts=>calculateExamReadinessMetrics({attempts,problems:[],pastSessions:[],aliases:[],today:'2026-09-26'});
  const m1=metrics(before),m2=metrics([...before,trained]);
  for(const key of ['selectedThree','timed','transfer','unseen'])assert.deepEqual(m2.evidence[key],m1.evidence[key],key);
  const later=fact(14,'PY-2018-Q2',true,{date:'2026-09-26',learning_purpose:'exam_performance'});
  const rows=deriveTransferEvidence([...before,trained,later]);
  assert.equal(rows.filter(r=>r.evidenceStrength==='training').length,1);assert.equal(rows.filter(r=>r.evidenceStrength==='strong').length,1);
  assert.equal(candidates([...before,trained,later]).length,0);
});
test('N/O/P: registered content and lineage survive roundtrip without generating another problem',async()=>{
  let r=await acceptGenerationDraft(newRecord(),JSON.stringify(draft));r=acceptGenerationValidation(r,JSON.stringify(validation(r)));
  const p=registerGeneratedProblem(r,'GEN-stable','2026-09-24');
  const restored=JSON.parse(JSON.stringify(p));await validateGeneratedContent(restored);
  const a=candidates([source,repair,retrieval],[p]),b=candidates([source,repair,retrieval],[restored]);
  assert.deepEqual(a,b);assert.equal(b[0].generatedProblemId,'GEN-stable');
  assert.equal(candidates([source,repair,retrieval,fact(13,p.problem_id,false)],[p]).length,0);
});
