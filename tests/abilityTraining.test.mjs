import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {deriveAbilityProfiles,abilityTrainingOutcome,buildAbilityLineage,validAbilityLineage,validateAbilitySources} from '../src/abilityTraining.ts';
import {parseCoachUpdate,validateCoachReviewContext} from '../src/coachDiagnosis.ts';
import {successfulSkillIds} from '../src/skillEvidence.ts';
import {buildCoachReviewFacts} from '../src/coachReviewFacts.ts';
const source={id:10,problem_id:'PY-2018-Q5',date:'2026-10-01',error_point:'支持の条件を最後の密度まで保持できない',graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'支持の条件を密度に反映できない'}]};
const profile={id:'conditions',name:'条件を数式に反映する力',state:'needs_practice',goal:'条件を最後の結論まで保持する',next:'異なる状況で条件の書き落としを検証',sources:[{attemptId:10,partIds:['major_calculation']}]};
const diagnosis={reviewedAt:'2026-10-18T08:00:00+09:00',evidenceCutoffAttemptId:10,level:{value:2.5},primaryBottleneck:{title:profile.name,evidenceProblemIds:[source.problem_id]},nextActions:[],abilityProfiles:[profile]};
export const fixture=()=>structuredClone({coach:{current:diagnosis,stale:false,history:[diagnosis]},attempts:[source],problems:[{problem_id:source.problem_id}]});
test('ability entry is a GPT profile supported by exact shared Attempts, not a list of Review tasks',()=>{
 const data=fixture(),before=JSON.stringify(data),rows=deriveAbilityProfiles(data);assert.equal(rows.length,1);assert.equal(rows[0].name,profile.name);assert.equal(rows[0].sources[0].attemptId,10);assert.equal(rows[0].trainable,true);assert.equal(JSON.stringify(data),before);
 data.coach.current={...diagnosis,abilityProfiles:[{...profile,sources:[{attemptId:999,partIds:['major_calculation']}]}]};assert.equal(deriveAbilityProfiles(data)[0].trainable,false);
});
test('legacy GPT bottleneck is preserved as a diagnosis, never guessed from old weakNote flags',()=>{
 const data=fixture();delete data.coach.current.abilityProfiles;const rows=deriveAbilityProfiles(data);assert.equal(rows[0].name,profile.name);assert.equal(rows[0].origin,'legacy_diagnosis');assert.equal(rows[0].sources[0].attemptId,10);
 data.coach.current={...diagnosis,abilityProfiles:undefined,primaryBottleneck:{title:'時間内完走',evidenceProblemIds:[]}};assert.equal(deriveAbilityProfiles(data)[0].trainable,false);assert.notEqual(deriveAbilityProfiles(data)[0].id,rows[0].id,'different legacy bottlenecks must not silently share training history');
 data.coach.current={...diagnosis,abilityProfiles:undefined,primaryBottleneck:{title:profile.name,evidenceProblemIds:[],evidenceIds:['attempt:10']}};data.attempts.push({...source,id:11});
 const facts=buildCoachReviewFacts({history:[data.coach.current],attempts:data.attempts,reviews:[],problems:data.problems,concepts:[],today:'2026-10-18',planner:{daysRemaining:28},dashboard:{readiness:{evidence:{}}}});
 assert.ok(facts.profile_context.some(e=>e.id==='attempt:10'),'v2 explicit bottleneck reference remains available for profile re-evaluation, not only problem-ID references');
});
test('ability training uses an explicit profile relationship, never claims canonical skill mapping or natural transfer',()=>{
 const d=fixture(),p=deriveAbilityProfiles(d)[0],l=buildAbilityLineage(p,d,1);assert.ok(validAbilityLineage(l));assert.equal(l.matchConfidence,'profile');assert.equal(l.abilityProfile.id,profile.id);assert.equal(l.repairAttemptId,0);assert.equal(l.retrievalAttemptId,0);
 const a={id:11,date:'2026-10-18',problem_id:'GEN-X',source_type:'generated',learning_purpose:'transfer_check',mode:'full',actual_reference_level:0,grading_confidence:99,transfer_lineage:l,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,evidence:'条件を最後まで使った'}};
 assert.equal(abilityTrainingOutcome(a),'success');assert.deepEqual(successfulSkillIds(a),[]);
 const facts=buildCoachReviewFacts({attempts:[a],reviews:[],problems:[],concepts:[],today:'2026-10-18',planner:{daysRemaining:28},dashboard:{readiness:{evidence:{}}}});
 assert.equal(facts.ability_training.success,1);assert.equal(facts.training.uncertain,0,'capability training success is not a failed/unknown canonical transfer');
 const two=buildCoachReviewFacts({attempts:[a,{...a,id:12,problem_id:'GEN-Y',transfer_lineage:{...l,key:l.key+':2'}}],reviews:[],problems:[],concepts:[],today:'2026-10-18',planner:{daysRemaining:28},dashboard:{readiness:{evidence:{}}}});
 assert.ok(two.evidence.some(e=>e.id==='attempt:11')&&two.evidence.some(e=>e.id==='attempt:12'),'different-question successes must both reach GPT, even if its last profile did not cite the first one');
 assert.equal(abilityTrainingOutcome({...a,hint_used:true}),'assisted');assert.equal(abilityTrainingOutcome({...a,target_skill_assessment:{...a.target_skill_assessment,outcome:'uncertain'}}),'uncertain');assert.equal(abilityTrainingOutcome({...a,target_skill_assessment:{...a.target_skill_assessment,no_major_error:false}}),'failure');
 assert.equal(validAbilityLineage({...l,sourceAttemptId:999}),false);
});
test('profile is an optional backward-compatible coach field with exact source-part validation',()=>{
 const u={schema_version:'stat1-coach-v2',review_context_version:'ctx',data_version:'data',evidence_cutoff_attempt_id:10,reviewed_at:diagnosis.reviewedAt,level:{value:2.5,readiness:'補強段階',confidence:'medium',refs:['attempt:10']},bottleneck:{text:profile.name,refs:['attempt:10']},improvements:[],actions:[],unknowns:[],ability_profiles:[{id:profile.id,name:profile.name,state:profile.state,goal:profile.goal,next:profile.next,sources:[{attempt_id:10,part_ids:['major_calculation']}]}]};
 const d=parseCoachUpdate(JSON.stringify({coach_update:u}));assert.deepEqual(d.abilityProfiles,[profile]);
 const ctx={version:'ctx',dataVersion:'data',referenceIds:['attempt:10'],evidenceIds:['attempt:10'],taskIds:[],abilitySources:[{attemptId:10,partIds:['major_calculation']}]};assert.doesNotThrow(()=>validateCoachReviewContext(d,ctx,true));
 assert.throws(()=>validateCoachReviewContext({...d,abilityProfiles:[{...profile,sources:[{attemptId:10,partIds:['not-in-answer']}]}]},ctx,true),/能力.*根拠|採点項目/);
 assert.throws(()=>validateCoachReviewContext({...d,abilityProfiles:[{...profile,state:'confirmed'}]},ctx,true),/異なる.*証拠/,'GPT prose cannot mark a capability confirmed with only an old failed answer');
 delete u.ability_profiles;assert.doesNotThrow(()=>parseCoachUpdate(JSON.stringify({coach_update:u})));
});
test('four-area weakness entrance keeps capability training distinct from individual repair and never restores skeleton inputs',async()=>{
 // The approved four-area navigation changes the label, not the evidence model.
 const app=await readFile('src/App.tsx','utf8'),focus=await readFile('src/WeaknessFocus.tsx','utf8');assert.doesNotMatch(app,/<RepairCheckPanel/);assert.match(app,/weak:"弱点"/);assert.match(app,/<CurrentIssueCards/);assert.match(focus,/<h2>能力トレーニング/);assert.doesNotMatch(focus,/priorityRepairTasks\(/);assert.match(focus,/訓練問題を作成/);
});
test('confirmed training needs different unaided successes; a new failure or an assisted repeat cannot certify ability',()=>{
 const p={...profile,state:'confirmed',sources:[...profile.sources,{attemptId:11,partIds:['major_calculation']}]},d={abilityProfiles:[p]};
 const sources=p.sources,proofs=[{attemptId:10,problemId:'GEN-A',abilityId:p.id,outcome:'success'},{attemptId:11,problemId:'GEN-B',abilityId:p.id,outcome:'success'}];
 assert.doesNotThrow(()=>validateAbilitySources(d,sources,proofs));
 assert.throws(()=>validateAbilitySources(d,sources,[proofs[0],{...proofs[1],problemId:'GEN-A'}]),/異なる.*証拠/);
 assert.throws(()=>validateAbilitySources(d,sources,[proofs[0],{...proofs[1],outcome:'assisted'}]),/異なる.*証拠/);
 assert.throws(()=>validateAbilitySources(d,sources,[...proofs,{attemptId:12,problemId:'GEN-C',abilityId:p.id,outcome:'failure'}]),/異なる.*証拠/);
});
