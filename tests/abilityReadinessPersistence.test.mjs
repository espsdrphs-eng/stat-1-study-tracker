import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup} from '../src/localDb.ts';
import {deriveAbilityProfiles} from '../src/abilityTraining.ts';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
const date=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
test('accepted summary-only evaluation → explicit profile completion → generation, without rewriting grades or exam facts',async()=>{
 await localGet('/api/bootstrap');const problem=await db.problems.get('PY-2018-Q5');
 const source={id:99000,problem_id:problem.problem_id,date:date(),mode:'full',learning_purpose:'exam_performance',score_numeric:40,mark:'△',error_type:'W',error_types:['W'],grading_confidence:99,actual_reference_level:0,grading_contract:buildInitialGradingContract({problem,mode:'full'}),graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,materiality:'major',evidence:'FIXTURE: 必要条件を最後まで保持できなかった'}]};await db.attempts.add(source);
 const original=await exportBackup(),b=await localGet('/api/bootstrap'),metrics=b.dashboard.readiness.evidence;
 const reply=state=>{const raw=JSON.parse(state.coach.prompt.slice(state.coach.prompt.lastIndexOf('\n{\n  "coach_update"')+1)),u=raw.coach_update;Object.assign(u,{reviewed_at:`${date()}T10:00:00+09:00`,level:{value:2.5,readiness:'再測定待ち',confidence:'medium',refs:['metric:timed']},bottleneck:{text:'条件を保持して結論まで完成させる力',refs:['metric:timed']},improvements:[],actions:[],unknowns:[],ability_profiles:[]});return raw;};
 let raw=reply(b);await localPost('/api/coach/preview',{text:JSON.stringify(raw),require_current_evidence:true});await localPost('/api/coach/save',{text:JSON.stringify(raw),require_current_evidence:true});
 const blocked=await localGet('/api/bootstrap'),legacy=deriveAbilityProfiles(blocked)[0];assert.equal(legacy.trainable,false);assert.match(legacy.reason,/能力別プロフィール/);await assert.rejects(()=>localPost('/api/transfer-training',{action:'begin-ability',profileId:legacy.id}));
 assert.ok(blocked.coach.reviewContext.abilitySources.some(s=>s.attemptId===source.id),'a real representative first answer remains offered even when the diagnosis cited only metrics');
 raw=reply(blocked);raw.coach_update.reviewed_at=`${date()}T11:00:00+09:00`;raw.coach_update.ability_profiles=[{id:legacy.id,name:'条件を最後まで保持する力',state:'needs_practice',goal:'条件を途中で落とさず結論を完成させる',next:'異なる設定で条件を保持する',sources:[{attempt_id:source.id,part_ids:['major_calculation']}]}];
 const bad=structuredClone(raw);bad.coach_update.ability_profiles[0].sources[0].part_ids=['invented'];await assert.rejects(()=>localPost('/api/coach/preview',{text:JSON.stringify(bad),require_current_evidence:true}),/根拠答案・採点項目/);
 await localPost('/api/coach/save',{text:JSON.stringify(raw),require_current_evidence:true});assert.equal((await localPost('/api/coach/save',{text:JSON.stringify(raw),require_current_evidence:true})).duplicate,true);
 const ready=await localGet('/api/bootstrap');assert.equal(ready.coach.stale,false);assert.equal(deriveAbilityProfiles(ready)[0].trainable,true);const started=await localPost('/api/transfer-training',{action:'begin-ability',profileId:legacy.id});const prompt=(await localPost('/api/transfer-training',{key:started.key,action:'start-generated'})).prompt;assert.match(prompt,/条件を最後まで/);assert.match(prompt,/99000/);
 const saved=await exportBackup();for(const k of ['attempts','reviews','weakNotes','pastSessions'])assert.deepEqual(saved[k],original[k]);assert.deepEqual(ready.dashboard.readiness.evidence,metrics);
 await restoreBackup(saved);assert.equal((await localPost('/api/transfer-training',{key:started.key,action:'view'})).status,'requested');assert.equal(deriveAbilityProfiles(await localGet('/api/bootstrap'))[0].trainable,true);
});
test('only explicit problem-list acknowledgement starts a protected individual problem; remaining holdout and formal scores are preserved',async()=>{
 const before=await localGet('/api/bootstrap'),old=await exportBackup(),pid='PY-2024-Q1';
 await assert.rejects(()=>localPost('/api/learning-work',{problemId:pid,stage:'preparing',mode:'full'}),/保護/);
 await assert.rejects(()=>localPost('/api/learning-work',{problemId:pid,stage:'preparing',mode:'full',entryPoint:'problem_list'}),/保護/);
 await assert.rejects(()=>localPost('/api/learning-work',{problemId:pid,stage:'preparing',mode:'full',entryPoint:'today',confirmIndividualStart:true}),/保護/);
 const exposureBefore=await db.meta.get('exam-reference-pack:exposure-overrides');
 const fail=(key,obj)=>{if(obj.key===`learning-work:${pid}`)throw new Error('FIXTURE storage failure');};db.meta.hook('creating',fail);
 try{await assert.rejects(()=>localPost('/api/learning-work',{problemId:pid,stage:'preparing',mode:'full',entryPoint:'problem_list',confirmIndividualStart:true}),/FIXTURE storage failure/);}finally{db.meta.hook('creating').unsubscribe(fail);}
 assert.equal(await db.meta.get(`learning-work:${pid}`),undefined);assert.deepEqual(await db.meta.get('exam-reference-pack:exposure-overrides'),exposureBefore,'failed work save must roll back exposure too');
 await localPost('/api/learning-work',{problemId:pid,stage:'preparing',mode:'full',entryPoint:'problem_list',confirmIndividualStart:true});
 let b=await localGet('/api/bootstrap'),w=b.learningWorkByProblem[pid];assert.ok(w.individualStartAcknowledgedAt);assert.equal(w.referenceLevel,0);assert.equal(w.stage,'preparing');assert.equal(b.adaptiveLearning.pastExamCatalog.find(p=>p.canonicalProblemId===pid).exposure,'prompt_scanned');
 assert.equal(b.adaptiveLearning.pastExamCatalog.find(p=>p.canonicalProblemId==='PY-2024-Q2').simulationProtected,true);assert.equal(b.adaptiveLearning.pastExamCatalog.find(p=>p.canonicalProblemId==='PY-2024-Q2').exposure,before.adaptiveLearning.pastExamCatalog.find(p=>p.canonicalProblemId==='PY-2024-Q2').exposure);
 await assert.rejects(()=>localPost('/api/learning-work',{problemId:'PY-2024-Q2',stage:'preparing',mode:'full'}),/保護/);
 await localPost('/api/learning-work',{problemId:pid,stage:'awaiting_grading',mode:'full',entryPoint:'problem_list'});const saved=await exportBackup();assert.deepEqual(saved.attempts,old.attempts);assert.deepEqual(saved.pastSessions,old.pastSessions);assert.deepEqual(b.dashboard.readiness.evidence,before.dashboard.readiness.evidence);
 await restoreBackup(saved);b=await localGet('/api/bootstrap');assert.equal(b.learningWorkByProblem[pid].stage,'awaiting_grading');assert.equal(b.learningWorkByProblem[pid].individualStartAcknowledgedAt,w.individualStartAcknowledgedAt);assert.equal(b.learningWorkByProblem[pid].referenceLevel,0);
 const p=b.problems.find(p=>p.problem_id===pid),c=buildInitialGradingContract({problem:p,mode:'full'});
 await localPost('/api/attempts',{problem_id:pid,problem_id_confirmed:true,date:date(),mode:'full',score_numeric:80,error_type:'none',error_types:['none'],actual_reference_level:0,grading_confidence:99,time_minutes:null,learning_purpose:c.learningPurpose,learning_stage:c.learningStage,review_scope:c.reviewScope,contract_id:c.contractId,contract_hash:c.contractHash,contract_version:c.contractVersion,graded_part_ids:c.gradedParts.map(p=>p.id),graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:'none',resolved:true,evidence:'FIXTURE: 個別解答の採点対象を確認'}))});
 const graded=await localGet('/api/bootstrap');assert.equal(graded.adaptiveLearning.pastExamCatalog.find(p=>p.canonicalProblemId===pid).exposure,'fully_attempted','explicitly scanned metadata must advance after a real full answer, never remain stale');assert.deepEqual(graded.pastSessions,b.pastSessions);assert.deepEqual(graded.dashboard.readiness.evidence.selectedThree,b.dashboard.readiness.evidence.selectedThree);
});
