import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import * as abilities from '../src/abilityTraining.ts';import * as coach from '../src/coachDiagnosis.ts';import * as generation from '../src/generatedTransfer.ts';
const a={id:4,problem_id:'PY-2000-Q1',date:'2026-10-17',mode:'full',grading_confidence:99,actual_reference_level:0,error_point:'FIXTURE: 必要な条件を結論まで保持できなかった',graded_findings:[{graded_part_id:'major_calculation',resolved:false,error_type:'W',evidence:'FIXTURE: 必要な条件を結論まで保持できなかった',materiality:'major'}]};
const data=()=>({coach:{current:null,history:[]},attempts:[structuredClone(a)],problems:[{problem_id:a.problem_id}],today:{tasks:[]},masteryByProblem:{}});
const response=()=>{const r=coach.coachCompactContract(4,{version:'ctx',dataVersion:'facts'});Object.assign(r.coach_update,{reviewed_at:'2026-10-18T12:00:00+09:00',level:{value:2.5,readiness:'再測定待ち',confidence:'medium',refs:['metric:timed']},bottleneck:{text:'答案を閉じる力',refs:['metric:timed']},actions:[],unknowns:[]});return r;};
test('no profile or aggregate-only diagnosis still offers a provisional evidence-bound training, without inventing mastery',()=>{
 assert.equal(typeof abilities.deriveTrainingProfiles,'function');const d=data(),before=JSON.stringify(d),p=abilities.deriveTrainingProfiles(d)[0];assert.equal(p.trainable,true);assert.equal(p.origin,'grading_evidence');assert.equal(p.state,'uncertain');assert.deepEqual(p.sources,[{attemptId:4,partIds:['major_calculation']}]);assert.ok(abilities.validAbilityLineage(abilities.buildAbilityLineage(p,d,1)));assert.equal(JSON.stringify(d),before);
 d.coach.current={reviewedAt:'2026-10-18',evidenceCutoffAttemptId:4,primaryBottleneck:{title:'時間内完走',evidenceIds:['metric:timed'],evidenceProblemIds:[]},abilityProfiles:[]};assert.equal(abilities.deriveTrainingProfiles(d)[0].trainable,true);
 d.attempts.push({...a,id:5,graded_findings:[{...a.graded_findings[0],resolved:true,error_type:'none'}]});assert.equal(abilities.deriveTrainingProfiles(d)[0].trainable,false,'latest success must not resurrect old failure');
 const legacy=data();legacy.attempts=[{...a,graded_findings:[],error_type:'W',error_types:['W']}];assert.equal(abilities.deriveTrainingProfiles(legacy)[0].trainable,true,'a real old grading note is usable as an unconfirmed hypothesis, without inventing part IDs');assert.deepEqual(abilities.deriveTrainingProfiles(legacy)[0].sources[0].partIds,[]);
 const scan=data();scan.attempts[0].mode='scan5';assert.equal(abilities.deriveTrainingProfiles(scan)[0].trainable,false,'scan/timing observations alone are not mathematical answer evidence');
});
test('generation entry remains visible without profile and never routes through mandatory diagnosis',async()=>{
 const f=await readFile('src/WeaknessFocus.tsx','utf8');assert.match(f,/deriveTrainingProfiles/);assert.doesNotMatch(f,/>訓練の準備をする</);assert.match(f,/訓練問題を作成/);
});
test('failed quality validation is not reported as a saved problem and its input remains retryable',async()=>{
 const panel=await readFile('src/TransferTrainingPanel.tsx','utf8');assert.match(panel,/action==="validate"&&response\.problem/);assert.match(panel,/response\.status==='requested'.*response\.pendingReason/);assert.doesNotMatch(panel,/\['draft','validate','grade'\]\.includes\(action\)/);
});
test('malformed syntax reports location and field without filling absent values; schema errors report exact expected type',()=>{
 const raw=JSON.stringify(response(),null,2),bad=raw.replace('"improvements": []','"improvements": ');assert.throws(()=>coach.parseCoachUpdate(bad),e=>e.stage==='parse'&&/improvements/.test(e.path)&&/行|列/.test(e.reason));
 const escaped=raw.replace('"refs": [','"refs": \\[');assert.throws(()=>coach.parseCoachUpdate(escaped),e=>e.stage==='parse'&&/refs/.test(e.path));
 const r=response();r.coach_update.improvements='';assert.throws(()=>coach.parseCoachUpdate(JSON.stringify(r)),e=>e.stage==='schema'&&e.path==='coach_update.improvements'&&/array|配列/.test(e.reason));
 assert.equal(coach.parseCoachUpdate('説明\n```json\n'+raw+'\n```\n以上').level.value,2.5);
});
test('the prompt and validator expose and enforce the same formal coach JSON Schema',()=>{
 assert.equal(typeof coach.coachCompactJsonSchema,'object');const r=response();assert.doesNotThrow(()=>coach.validateCoachCompactWire(r.coach_update));
 const prompt=coach.buildCoachReviewPrompt({attempts:[a],reviews:[],problems:[{problem_id:a.problem_id}],concepts:[],today:'2026-10-18',planner:{daysRemaining:28},assessment:{level:2.5,label:'再測定待ち',confidence:'medium'},dashboard:{readiness:{evidence:{}}}});
 assert.match(prompt,/JSON Schema/);assert.doesNotMatch(prompt,/"attempt_id":"FACT/,'a string-valued integer example must not contradict the shared schema');
 for(const [key,value] of [['improvements',null],['ability_profiles',{}]]){const bad=structuredClone(r.coach_update);bad[key]=value;assert.throws(()=>coach.validateCoachCompactWire(bad),e=>e.path===`coach_update.${key}`);}
});
test('next generation responds to actual result, not copies or overall score, and uses the shared generation contract',()=>{
 assert.equal(typeof abilities.abilityTrainingPlan,'function');const d=data(),p=abilities.deriveTrainingProfiles(d)[0],lineage=abilities.buildAbilityLineage(p,d,1);assert.equal(abilities.abilityTrainingPlan(d,p).state,'uncertain');
 const result={...a,id:5,problem_id:'GEN-FIXTURE',transfer_lineage:lineage,target_skill_assessment:{self_selected:false,major_calculation_success:false,no_major_error:false,outcome:'failure',evidence:'FIXTURE: 条件の保持に失敗'}};d.attempts.push(result);assert.equal(abilities.abilityTrainingPlan(d,p).state,'needs_practice');assert.match(abilities.abilityTrainingPlan(d,p).next,/別.*設定|異なる設定/);
 const record={key:lineage.key,lineage,createdAt:'2026-10-18T00:00:00Z',status:'requested',rounds:[]};assert.equal(typeof generation.generationDraftContract,'function');const contract=generation.generationDraftContract(record);assert.match(generation.generationPrompt(record,[]),/標準JSON/);assert.equal(contract.difficulty,'統計検定1級');
});
test('without a current diagnosis, saved training uses the newest profile snapshot, not lexicographic problem order',()=>{
 const d=data(),p=abilities.deriveTrainingProfiles(d)[0],l=abilities.buildAbilityLineage(p,d,1);
 const newer={...l.abilityProfile,name:'FIXTURE 最新の能力仮説',revision:'new-revision',reviewedAt:'2026-10-18T00:00:00Z'};
 d.problems.push({problem_id:'GEN-Z-OLD',generated_transfer:{created_at:'2026-10-17T00:00:00Z',lineage:l}},{problem_id:'GEN-A-NEW',generated_transfer:{created_at:'2026-10-18T00:00:00Z',lineage:{...l,abilityProfile:newer}}});
 assert.equal(abilities.deriveTrainingProfiles(d)[0].name,newer.name);assert.equal(abilities.deriveTrainingProfiles(d)[0].revision,newer.revision);
});
test('a different weakness is a new evidence-bound hypothesis, never a relabelled success of the original ability',()=>{
 const d=data(),p=abilities.deriveTrainingProfiles(d)[0],lineage=abilities.buildAbilityLineage(p,d,1);
 const graded={...a,id:5,problem_id:'GEN-PREVIOUS',transfer_lineage:lineage,target_skill_assessment:{self_selected:true,major_calculation_success:true,no_major_error:true,outcome:'success',evidence:'FIXTURE: 元の条件保持は自力成功',next_focus:{name:'最終条件を明記する力',goal:'別の設定で最終条件まで答案に明記する',part_ids:['answer_conclusion'],evidence:'FIXTURE: 結論の条件を書き落としたという実答案の根拠'}},graded_findings:[{graded_part_id:'answer_conclusion',resolved:false,error_type:'W',evidence:'FIXTURE: 結論の条件を書き落とした'}]};d.attempts.push(graded);
 d.problems.push({problem_id:graded.problem_id,generated_transfer:{problem_text:'FIXTURE: アプリに保存済みの元の生成問題全文'}});
 const next=abilities.deriveTrainingProfiles(d)[0];assert.notEqual(next.id,p.id);assert.equal(next.name,graded.target_skill_assessment.next_focus.name);assert.equal(next.state,'uncertain');assert.deepEqual(next.sources,[{attemptId:5,partIds:['answer_conclusion']}]);assert.equal(abilities.abilityTrainingOutcome(graded),'success');
 assert.equal(abilities.buildAbilityLineage(next,d,1).abilityProfile.sources[0].problemText,d.problems.at(-1).generated_transfer.problem_text,'available generated-source conditions must reach the next generator');
});
