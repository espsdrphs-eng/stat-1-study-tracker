import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {parseCoachUpdate,validateCoachReviewContext,buildCoachReviewPrompt,buildCoachReviewFacts,coachCompactContract} from '../src/coachDiagnosis.ts';
import {deriveAbilityProfiles,buildAbilityLineage} from '../src/abilityTraining.ts';
import * as planning from '../src/pastExamPlanning.ts';
const source={id:1,problem_id:'PY-2000-Q1',date:'2026-10-17',mode:'full',learning_purpose:'exam_performance',grading_confidence:99,actual_reference_level:0,graded_findings:[{graded_part_id:'major_calculation',resolved:false,error_type:'W',materiality:'major',evidence:'FIXTURE: 必要条件を最終式まで保持できなかった'}]};
const context={version:'ctx',dataVersion:'facts',referenceIds:['metric:timed','session:8','attempt:1'],evidenceIds:['attempt:1'],taskIds:[],abilitySources:[{attemptId:1,partIds:['major_calculation']}]};
const wire=()=>{const r=coachCompactContract(1,{version:'ctx',dataVersion:'facts'});Object.assign(r.coach_update,{reviewed_at:'2026-10-18T17:00:00+09:00',level:{value:2.5,readiness:'再測定待ち',confidence:'medium',refs:['metric:timed']},bottleneck:{text:'必要条件と中間量を保持して答案を閉じる遂行力',refs:['metric:timed']},improvements:[],actions:[],unknowns:[]});return r;};
const data=d=>({coach:{current:d},attempts:[source],problems:[{problem_id:source.problem_id}]});
test('accepted aggregate-only diagnosis stays valid but identifies the missing training profile, not generic missing answers',()=>{
 const r=wire(),d=parseCoachUpdate(JSON.stringify(r));assert.doesNotThrow(()=>validateCoachReviewContext(d,context,true));const before=JSON.stringify(d),p=deriveAbilityProfiles(data(d))[0];
 assert.equal(p.trainable,false);assert.equal(p.sources.length,0);assert.match(p.reason,/能力別プロフィール/);assert.throws(()=>buildAbilityLineage(p,data(d),1));assert.equal(JSON.stringify(d),before);
});
test('the actual reassessment prompt defines source keys and includes benchmark-linked candidate answers without asserting a skill',()=>{
 const args={attempts:[source],reviews:[],problems:[{problem_id:source.problem_id}],concepts:[],today:'2026-10-18',planner:{daysRemaining:28},assessment:{level:2.5,label:'再測定待ち',confidence:'medium'},dashboard:{readiness:{evidence:{selectedThree:{sessions:[{sessionId:8,year:2000,score:33.3,attemptIds:[1]}]}}}}};
 const facts=buildCoachReviewFacts(args),prompt=buildCoachReviewPrompt(args);assert.match(prompt,/attempt_id/);assert.match(prompt,/part_ids/);assert.match(prompt,/時間配分.*数学|数学.*時間配分/);
 assert.ok(facts.sessions[0].attempt_ids.includes(1));assert.ok(facts.evidence.some(e=>e.id==='attempt:1'&&e.role.includes('benchmark_candidate')));assert.equal(facts.ability_training.success,0);
});
test('readiness explains invalid evidence precisely without bypassing source or cutoff checks',()=>{
 const r=wire();r.coach_update.ability_profiles=[{id:'hold-conditions',name:'条件を保持する力',state:'needs_practice',goal:'条件を最終式まで保持する',next:'異なる設定で確認',sources:[{attempt_id:1,part_ids:['major_calculation']}]}];
 const d=parseCoachUpdate(JSON.stringify(r));assert.doesNotThrow(()=>validateCoachReviewContext(d,context,true));assert.equal(deriveAbilityProfiles(data(d))[0].trainable,true);
 for(const [change,pattern]of[[s=>s.attemptId=999,/#999/],[s=>s.partIds=['missing-part'],/missing-part/]]){const bad=structuredClone(d);change(bad.abilityProfiles[0].sources[0]);const p=deriveAbilityProfiles(data(bad))[0];assert.equal(p.trainable,false);assert.match(p.reason,pattern);}
 const future={...d,evidenceCutoffAttemptId:0};assert.match(deriveAbilityProfiles(data(future))[0].reason,/評価対象.*後|cutoff/);
 const legacy={...d,abilityProfiles:undefined,primaryBottleneck:{...d.primaryBottleneck,evidenceIds:['attempt:999']}};assert.match(deriveAbilityProfiles(data(legacy))[0].reason,/#999/,'legacy dangling references must not be silently discarded');
 const old={...source,graded_findings:[],error_point:'FIXTURE: 条件の取り落としを記録した旧採点'},note={...d,abilityProfiles:[{...d.abilityProfiles[0],sources:[{attemptId:1,partIds:[]}]}]};
 assert.equal(deriveAbilityProfiles({...data(note),attempts:[old]})[0].trainable,true);assert.equal(deriveAbilityProfiles({...data(note),attempts:[{...old,error_point:''}]})[0].trainable,false);
});
test('training entry uses current evidence without mandatory profile preparation; preview distinguishes diagnosis from training evidence',async()=>{
 const focus=await readFile('src/WeaknessFocus.tsx','utf8'),controls=await readFile('src/LearningDashboard.tsx','utf8');
 assert.doesNotMatch(focus,/>訓練の準備をする</);assert.match(focus,/disabled=\{busy\|\|!p.trainable\}/);assert.match(controls,/採点根拠/);assert.match(controls,/deriveTrainingProfiles/);
});
test('manual list start is separate from Planner protection and requires an explicit acknowledgement',()=>{
 assert.equal(typeof planning.canStartProtectedProblemIndividually,'function');const f=planning.canStartProtectedProblemIndividually;
 for(const year of [2024,2025]){assert.equal(f({year,entryPoint:'problem_list',acknowledged:true}),true);assert.equal(f({year,entryPoint:'today',acknowledged:true}),false);assert.equal(f({year,entryPoint:'problem_list',acknowledged:false}),false);}
 assert.equal(f({year:2026,entryPoint:'problem_list',acknowledged:true}),false);
 const catalog=[{canonicalProblemId:'PY-2024-Q1',year:2024,simulationProtected:true,availability:'verified_problem',schedulable:true,gradable:true,fineConceptIds:[]}];
 assert.equal(planning.derivePastExamProblemStart({problemId:'PY-2024-Q1',catalog,attempts:[],tasks:[],pastSessions:[],today:'2026-10-18',daysRemaining:28}).blocked,true,'Planner/default start policy is not globally released');
});
