import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';import yaml from 'js-yaml';
import {db,localGet,localPost,exportBackup,restoreBackup} from '../src/localDb.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {GENERATION_CHECKS} from '../src/generatedTransfer.ts';
import {transferGradingContext} from '../src/transferTrainingApi.ts';
import {abilityTrainingHistory,deriveAbilityProfiles} from '../src/abilityTraining.ts';
import {successfulSkillIds,deriveTransferEvidence} from '../src/skillEvidence.ts';
import {contentHash,generationDraftContract} from '../src/generatedTransfer.ts';

test('shared-record capability loop: create → validate → paper → grade → GPT profile update → next generation; preserve formal records',async()=>{
 await localGet('/api/bootstrap');
 const p=await db.problems.get('PY-2018-Q5'),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
 const source={id:99000,problem_id:p.problem_id,date:today,mode:'full',score_numeric:40,mark:'△',error_type:'W',error_types:['W'],grading_confidence:99,actual_reference_level:0,grading_contract:buildInitialGradingContract({problem:p,mode:'full'}),graded_findings:[{graded_part_id:'major_calculation',resolved:false,error_type:'W',evidence:'FIXTURE: 問題条件を最後の式まで保持できなかった',materiality:'major'}]};await db.attempts.add(source);
 const profile={id:'hold-conditions',name:'条件を数式に反映する力',state:'needs_practice',goal:'与えられた条件を最後の結論まで保持する',next:'異なる設定で条件の取り落としを検証',sources:[{attemptId:source.id,partIds:['major_calculation']}]};
 const d={schemaVersion:'stat1-coach-v1',reviewedAt:`${today}T08:00:00+09:00`,evidenceCutoffAttemptId:source.id,level:{value:2.5,label:'補強段階',passOutlook:'再測定が必要',confidence:'medium',rationale:'FIXTURE'},primaryBottleneck:{title:profile.name,explanation:'FIXTURE',evidenceProblemIds:[p.problem_id],effectOnExam:'FIXTURE'},nextActions:[],strengths:[],improvements:[],unknowns:[],abilityProfiles:[profile]};await db.meta.put({key:'coach-diagnosis-history-v1',value:JSON.stringify([d])});
 const old=await exportBackup(),before=await localGet('/api/bootstrap');
 const formal=b=>['selectedThree','timed','selection','transfer'].map(k=>b.dashboard.readiness.evidence[k]);const metrics=formal(before);
 const begin=()=>localPost('/api/transfer-training',{action:'begin-ability',profileId:profile.id});let key=(await begin()).key;
 assert.equal((await begin()).key,key,'double tap reuses the unfinished opportunity');
 await assert.rejects(()=>localPost('/api/transfer-training',{action:'begin-ability',profileId:'invented'}),/プロフィール/);
 const call=(action,extra={})=>localPost('/api/transfer-training',{key,action,...extra});
 const outcomes=['success','failure','uncertain','assisted'];
 for(let round=0;round<outcomes.length;round++){
  const outcome=outcomes[round],prompt=(await call('start-generated')).prompt;assert.match(prompt,/条件を数式/);assert.match(prompt,/数字・記号だけ/);assert.doesNotMatch(prompt,/self_reported_stuck_stage/);
  if(round)assert.match(prompt,/previousResults/);
  const draft={problem_text:`FIXTURE-${round}: 区間(0,1)に値を取る変数Uを考え、P(U≤u)=u²が0≤u≤1で成立するとする。V=1-Uの密度を、密度が正の値となる範囲とともに求めよ。`,reference_solution:'FIXTURE: f_U(u)=2u (0<u<1)。逆変換u=1-vの微分の絶対値は1なので、f_V(v)=2(1-v) (0<v<1)、その他は0。',grading_rubric:'FIXTURE: 条件と変換後の範囲、逆変換、微分、密度の完成を別々に照合する。',difficulty:'統計検定1級',estimated_minutes:12,surface_features:['FIXTURE new situation',`round-${round}`],generator_pass_id:`generator-${round}`};
  const requested=JSON.parse((await db.meta.get(`transfer-generation:${key}`)).value),contractDraft=generationDraftContract(requested);Object.assign(draft,{generation_context:contractDraft.generation_context,self_check:Object.fromEntries(['well_defined','solution_correct','rubric_aligned'].map(k=>[k,{pass:true,evidence:'FIXTURE: 自己確認の入出力。実ChatGPT・数学的品質の実証ではない。'}]))});
  await call('draft',{text:JSON.stringify(draft)});let record=JSON.parse((await db.meta.get(`transfer-generation:${key}`)).value);
  await call('validate',{text:JSON.stringify({draft_hash:record.rounds.at(-1).hash,validator_pass_id:`independent-${round}`,checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:`FIXTURE: ${k} の独立検証を行ったというテスト専用の報告。`}]))})});
  let view=await call('view'),problem=await db.problems.get(view.problem.problem_id);assert.equal(view.status,'ready');assert.ok(!JSON.stringify(view).includes(draft.reference_solution));assert.ok(!JSON.stringify(view).includes(profile.name));
  const historyBefore=await db.attempts.count();await call('submit',{answer_medium:'paper_image',answer_completed:true,minutes:'',referenceLevel:outcome==='assisted'?3:0});assert.equal(await db.attempts.count(),historyBefore);
  const gradePrompt=(await call('grading-prompt')).prompt;assert.match(gradePrompt,/ability_profile_id/);assert.match(gradePrompt,/success \/ failure \/ uncertain/);assert.match(gradePrompt,/答案画像/);
  problem=await db.problems.get(problem.problem_id);const contract=buildInitialGradingContract({problem,mode:'full'}),ok=['success','assisted'].includes(outcome),target={self_selected:ok,major_calculation_success:ok,no_major_error:ok,outcome:outcome==='assisted'?'success':outcome,evidence:`FIXTURE: 対象能力の今回の判定 ${outcome}。総合点とは別に対象操作を照合した。`};
  const update={problem_id:problem.problem_id,problem_id_confirmed:true,date:today,mode:'full',score_numeric:outcome==='failure'?95:80,mark:'○',error_type:'none',error_types:['none'],grading_confidence:99,actual_reference_level:outcome==='assisted'?3:0,learning_purpose:'transfer_check',learning_stage:'transfer',contract_id:contract.contractId,contract_hash:contract.contractHash,contract_version:contract.contractVersion,graded_part_ids:contract.gradedParts.map(p=>p.id),graded_findings:contract.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 当該採点項目の具体的な答案根拠を照合した。'})),target_skill_assessment:target,transfer_task_context:transferGradingContext(problem.generated_transfer.lineage,problem.problem_id)};
  // The actual prompt context also includes source scope; copy it, not guess it.
  const context=gradePrompt.match(/study_update\.transfer_task_context を次のJSONのまま返してください:\n([^\n]+)/);assert.ok(context);update.transfer_task_context=JSON.parse(context[1]);
  const wrong=structuredClone(update);wrong.transfer_task_context.ability_profile_id='wrong';await assert.rejects(()=>call('grade',{text:yaml.dump({study_update:wrong})}),/対応情報/);assert.equal(await db.attempts.count(),historyBefore);
  await call('grade',{text:yaml.dump({study_update:update})});await call('grade',{text:yaml.dump({study_update:update})});
  const attempts=await db.attempts.where('problem_id').equals(problem.problem_id).toArray();assert.equal(attempts.length,1);assert.equal(attempts[0].exam_score_eligible,false);assert.equal(attempts[0].time_minutes,null);assert.deepEqual(successfulSkillIds(attempts[0]),[]);assert.ok(!deriveTransferEvidence(await db.attempts.toArray()).some(e=>e.successAttemptId===attempts[0].id));
  assert.equal(abilityTrainingHistory(await localGet('/api/bootstrap'),profile.id)[0].outcome,outcome);
  assert.deepEqual(formal(await localGet('/api/bootstrap')),metrics);assert.deepEqual(await db.attempts.get(source.id),source);
  if(round===0){
   const current=await localGet('/api/bootstrap'),ctx=current.coach.reviewContext,raw=JSON.parse(current.coach.prompt.slice(current.coach.prompt.lastIndexOf('\n{\n  "coach_update"')+1)),u=raw.coach_update;
   const sourceRef=ctx.abilitySources.find(s=>s.attemptId===source.id);assert.ok(sourceRef);
   Object.assign(u,{reviewed_at:`${today}T10:00:00+09:00`,level:{value:2.5,readiness:'本番再測定待ち',confidence:'medium',refs:['metric:timed']},bottleneck:{text:profile.name,refs:[`attempt:${source.id}`]},actions:[],improvements:[],unknowns:[],ability_profiles:[{id:profile.id,name:profile.name,state:'improving',goal:profile.goal,next:'別の設定で成功を再確認する',sources:[{attempt_id:source.id,part_ids:['major_calculation']},{attempt_id:attempts[0].id,part_ids:['major_calculation']}]}]});
   await localPost('/api/coach/preview',{text:JSON.stringify(raw),require_current_evidence:true});await localPost('/api/coach/save',{text:JSON.stringify(raw),require_current_evidence:true});
   assert.equal((await localPost('/api/coach/save',{text:JSON.stringify(raw),require_current_evidence:true})).duplicate,true);
   const refreshed=await localGet('/api/bootstrap');assert.equal(refreshed.coach.stale,false,'profile update must not stale itself');assert.equal(deriveAbilityProfiles(refreshed)[0].state,'improving');
  }
  const backup=await exportBackup();await restoreBackup(backup);assert.equal((await call('view')).status,'graded');
  if(round+1<outcomes.length){const next=(await begin()).key;assert.notEqual(next,key);key=next;}
 }
 const final=await exportBackup();for(const k of ['attempts','reviews','weakNotes'])for(const a of old[k])assert.deepEqual(final[k].find(b=>b.id===a.id),a);
 assert.deepEqual(final.pastSessions,old.pastSessions);for(const p of old.problems.filter(p=>/^PY-202[45]/.test(p.problem_id)))assert.deepEqual(final.problems.find(q=>q.problem_id===p.problem_id),p);
 assert.equal(abilityTrainingHistory(await localGet('/api/bootstrap'),profile.id).length,4);
 const audit=await localPost('/api/integrity/audit',{});assert.equal(audit.issues.filter(i=>i.category==='generated_transfer_invalid'||i.category==='generated_training_in_exam_kpi').length,0);
});
