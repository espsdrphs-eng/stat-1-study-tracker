import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';import yaml from 'js-yaml';
import {db,localGet,localPost,exportBackup,restoreBackup} from '../src/localDb.ts';
import {deriveTrainingProfiles,abilityTrainingPlan} from '../src/abilityTraining.ts';
import * as gen from '../src/generatedTransfer.ts';
const date=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
test('no GPT profile → draft → independent check → paper → grade → next round; invalid import/storage failure never removes entry or original facts',async()=>{
 await localGet('/api/bootstrap');await db.meta.delete('coach-diagnosis-history-v1');
 const source={id:99000,problem_id:'PY-2018-Q5',date:date(),mode:'full',mark:'△',score_numeric:40,grading_confidence:99,actual_reference_level:0,error_point:'FIXTURE: 条件を最終密度まで保持できなかった',graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'FIXTURE: 条件を最終密度まで保持できなかった',materiality:'major'}]};await db.attempts.add(source);
 const b=await localGet('/api/bootstrap'),old=await exportBackup(),p=deriveTrainingProfiles(b)[0];assert.ok(p.trainable);assert.equal(b.coach.current,null);
 const begin=()=>localPost('/api/transfer-training',{action:'begin-ability',profileId:p.id});let key=(await begin()).key;assert.equal((await begin()).key,key);
 const call=(action,extra={})=>localPost('/api/transfer-training',{key,action,...extra});
 const bad='{“coach_update”:{“improvements”: ,“refs”:\\[“metric:timed”\\]}}';await assert.rejects(()=>localPost('/api/coach/save',{text:bad,require_current_evidence:true}),e=>e.stage==='parse'&&/improvements/.test(e.path));assert.equal(await db.meta.get('coach-diagnosis-history-v1'),undefined);assert.ok(deriveTrainingProfiles(await localGet('/api/bootstrap'))[0].trainable);
 for(const [round,outcome]of ['failure','success','uncertain','assisted'].entries()){
  const prompt=(await call('start-generated')).prompt;assert.match(prompt,/標準JSON/);const record=JSON.parse((await db.meta.get(gen.generationMetaKey(key))).value),draft={...gen.generationDraftContract(record),problem_text:`FIXTURE ${round}: 確率変数Uについて、0≤u≤1でP(U≤u)=u²が成り立つ。V=1-Uの確率密度関数を、密度が正となる範囲とともに求めよ。`,reference_solution:'FIXTURE: f_U(u)=2u、逆変換u=1-vの微分の絶対値1を用い、f_V(v)=2(1-v)、0<v<1、その他0。',grading_rubric:'FIXTURE: 与えられた条件、変換後の範囲、主要計算、最終結論を答案の具体的記述から照合する。',generator_pass_id:`generator-${round}`,surface_features:['FIXTURE new setting',`round-${round}`]};
  draft.self_check=Object.fromEntries(['well_defined','solution_correct','rubric_aligned'].map(k=>[k,{pass:true,evidence:'FIXTURE: 自己検算の入出力。数学的品質の実証ではない。'}]));
  const mismatch=structuredClone(draft);mismatch.generation_context.ability_id='wrong';await assert.rejects(()=>call('draft',{text:JSON.stringify(mismatch)}),/識別|対応/);await call('draft',{text:JSON.stringify(draft)});
  let rec=JSON.parse((await db.meta.get(gen.generationMetaKey(key))).value);const quality={draft_hash:rec.rounds.at(-1).hash,validator_pass_id:`independent-${round}`,checks:Object.fromEntries(gen.GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'FIXTURE: 別会話の独立品質検証を仮定した入出力。'}]))};
  const fail=(_key,obj)=>{if(obj.source_type==='generated')throw new Error('FIXTURE storage failure')};db.problems.hook('creating',fail);try{await assert.rejects(()=>call('validate',{text:JSON.stringify(quality)}),/storage failure/)}finally{db.problems.hook('creating').unsubscribe(fail)}assert.equal((await call('view')).status,'validation_pending');
  await call('validate',{text:JSON.stringify(quality)});const view=await call('view');assert.equal(view.problem.problem_id,draft.generation_context.problem_id);assert.ok(!JSON.stringify(view).includes(draft.reference_solution));const problem=await db.problems.get(view.problem.problem_id);await gen.validateGeneratedContent(problem);
  await call('submit',{answer_medium:'paper_image',answer_completed:true,referenceLevel:outcome==='assisted'?3:0,minutes:''});const gp=(await call('grading-prompt')).prompt,ctx=JSON.parse(gp.match(/study_update\.transfer_task_context を次のJSONのまま返してください:\n([^\n]+)/)[1]);
  const raw=[...gp.matchAll(/```yaml\s*([\s\S]*?)```/g)].map(m=>yaml.load(m[1])).find(o=>o?.study_update),u=raw.study_update,success=['success','assisted'].includes(outcome);Object.assign(u,{score_numeric:80,score_max:100,grading_confidence:99,error_types:['none'],primary_error_type:'none',actual_reference_level:outcome==='assisted'?3:0,transfer_task_context:ctx,target_skill_assessment:{self_selected:success,major_calculation_success:success,no_major_error:success,outcome:outcome==='assisted'?'success':outcome,evidence:`FIXTURE: 条件保持の判定 ${outcome}。答案全体の得点からは推測しない。`}});u.graded_findings=u.graded_findings.map(f=>({...f,error_type:'none',resolved:true,evidence:'FIXTURE: 具体的な答案の記述で当該採点項目を確認した。'}));
  if(outcome==='assisted'){
   const last=u.graded_findings.at(-1);Object.assign(last,{resolved:false,error_type:'W',evidence:'FIXTURE: 対象能力とは別に、結論の条件を書き落とした。'});u.error_types=['W'];u.primary_error_type='W';
   u.target_skill_assessment.next_focus={name:'FIXTURE 新しい結論条件の検証',goal:'異なる設定で結論の条件を答案に明示する',part_ids:[last.graded_part_id],evidence:last.evidence};
   const bad=structuredClone(raw);bad.study_update.target_skill_assessment.next_focus.part_ids=['not-in-this-answer'];await assert.rejects(()=>call('grade',{text:yaml.dump(bad)}),/next_focus/);
  }
  await call('grade',{text:yaml.dump(raw)});await call('grade',{text:yaml.dump(raw)});const attempts=await db.attempts.where('problem_id').equals(problem.problem_id).toArray();assert.equal(attempts.length,1);assert.equal(attempts[0].exam_score_eligible,false);assert.equal(attempts[0].time_minutes,null);
  const now=await localGet('/api/bootstrap'),plan=abilityTrainingPlan(now,p);assert.equal(plan.latest.outcome,outcome);
  // A newly observed training weakness should update weakness evidence, not
  // mutate measured exam scores. repeatedMajor is a weakness metric, not a
  // formal-session measurement, so do not freeze its evidence count here.
  for(const k of ['selectedThree','timed','selection','individual','historicalRetest','transfer','unseen','diagnostic'])assert.deepEqual(now.dashboard.readiness.evidence[k],b.dashboard.readiness.evidence[k]);
  if(outcome==='assisted')assert.ok(now.dashboard.readiness.evidence.repeatedMajor.evidenceCount>=b.dashboard.readiness.evidence.repeatedMajor.evidenceCount);
  const saved=await exportBackup();await restoreBackup(saved);assert.equal((await call('view')).status,'graded');for(const k of['attempts','reviews','weakNotes','pastSessions'])for(const oldRow of old[k])assert.deepEqual((await exportBackup())[k].find(x=>x.id===oldRow.id),oldRow);
  const nextProfile=deriveTrainingProfiles(await localGet('/api/bootstrap'))[0],next=(await localPost('/api/transfer-training',{action:'begin-ability',profileId:nextProfile.id})).key;assert.notEqual(next,key);key=next;const nextPrompt=(await call('start-generated')).prompt;
  if(outcome==='assisted'){assert.notEqual(nextProfile.id,p.id);assert.equal(nextProfile.state,'uncertain');assert.match(nextPrompt,/FIXTURE 新しい結論条件の検証/);assert.equal(nextProfile.sources[0].attemptId,attempts[0].id);assert.ok(nextPrompt.includes(draft.problem_text),'new-focus generation must receive the saved source question conditions');}else{assert.ok(nextPrompt.includes(attempts[0].problem_id));assert.ok(nextPrompt.includes(plan.next));}
 }
});
test('an unused generation request is safely superseded after an optional profile update; old context cannot accept a different target',async()=>{
 const b=await localGet('/api/bootstrap'),p=deriveTrainingProfiles(b)[0],begin=()=>localPost('/api/transfer-training',{action:'begin-ability',profileId:p.id}),old=await begin();
 const raw=JSON.parse(b.coach.prompt.slice(b.coach.prompt.lastIndexOf('\n{\n  "coach_update"')+1)),u=raw.coach_update;
 Object.assign(u,{reviewed_at:new Date().toISOString(),level:{value:2.5,readiness:'FIXTURE 再測定待ち',confidence:'medium',refs:['metric:timed']},bottleneck:{text:'FIXTURE 最新の能力仮説',refs:['metric:timed']},actions:[],improvements:[],unknowns:[],ability_profiles:[{id:p.id,name:'FIXTURE 更新した能力名',state:'uncertain',goal:'更新した条件で自力選択を検証する',next:'別設定で更新後の仮説を確認',sources:p.sources.map(s=>({attempt_id:s.attemptId,part_ids:s.partIds}))}]});
 await localPost('/api/coach/save',{text:JSON.stringify(raw),require_current_evidence:true});const fresh=await begin();assert.notEqual(fresh.key,old.key);assert.equal((await localPost('/api/transfer-training',{key:old.key,action:'view'})).status,'pending');
 const prompt=(await localPost('/api/transfer-training',{key:fresh.key,action:'start-generated'})).prompt;assert.match(prompt,/FIXTURE 更新した能力名/);assert.match(prompt,/更新した条件/);const record=JSON.parse((await db.meta.get(gen.generationMetaKey(old.key))).value);await assert.rejects(()=>gen.acceptGenerationDraft(record,'{}'),/保留|再生成不可/);
});
