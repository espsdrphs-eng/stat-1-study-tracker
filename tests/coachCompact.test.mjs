import test from 'node:test';import assert from 'node:assert/strict';
import * as coach from '../src/coachDiagnosis.ts';import * as overview from '../src/learningOverview.ts';
import {currentTaskIdentity} from '../src/examOptimizationPolicy.ts';
const metric=(value,count,ids=[])=>({value,numerator:1,denominator:count,evidenceCount:count,lastUpdated:'2026-10-01',eligibleEvidenceIds:ids});
const attempt=(id,purpose='error_repair',resolved=false)=>({id,problem_id:`PY-2018-Q${id===1||id===2?3:5}`,date:`2026-10-${String(Math.min(id,15)).padStart(2,'0')}`,policy_validity:'valid',learning_purpose:purpose,mark:resolved?'○':'△',score_numeric:resolved?100:45,actual_reference_level:0,grading_confidence:99,graded_findings:[{graded_part_id:'answer_conclusion',error_type:resolved?'none':'W',resolved,evidence:resolved?'対象小問の結論まで自力で完遂':'対象小問で最後の結論が未完'}]});
export const input=()=>({today:'2026-10-16',history:[],attempts:[attempt(1),attempt(2,'error_repair',true),...Array.from({length:25},(_,i)=>attempt(i+3))],reviews:[],problems:[{problem_id:'PY-2018-Q3',source_type:'past_exam'},{problem_id:'PY-2018-Q5',source_type:'past_exam'}],concepts:[],tasks:[{id:555,review_type:'main_calc_retry',problem_id:'PY-2018-Q3',learning_purpose:'error_repair',source_attempt_id:1,minutes:12,targeted_parts:['answer_conclusion'],ranking:{eligible:true,rank:1}}],planner:{phase:'final_stabilization',daysRemaining:30},assessment:{level:2.5,label:'実戦得点化の補強',confidence:'medium'},dashboard:{readiness:{sampleSizes:{pastExams:15,timed:5,scans:5},evidence:{selectedThree:{...metric(52,5,['session:7']),sessions:[{sessionId:7,year:2022,score:42,attemptIds:[1]}]},timed:metric(20,5,['session:7']),selection:metric(100,5,['session:7']),transfer:{...metric(0,1,['attempt:1']),statusCounts:{total:8,attempted:1,successful:0,failed:1,uncertain:0,unattempted:7}},trainingTransfer:metric(null,0)}}}});
export const reply=context=>({coach_update:{schema_version:'stat1-coach-v2',review_context_version:context.version,data_version:context.dataVersion||coach.coachFactsVersion(coach.buildCoachReviewFacts(input())),evidence_cutoff_attempt_id:27,reviewed_at:'2026-10-16T09:00:00+09:00',level:{value:2.5,readiness:'本番再測定が必要',confidence:'medium',refs:['metric:selectedThree','metric:timed']},bottleneck:{text:'時間内完走の再現性と答案完結力',refs:['metric:timed']},improvements:[],actions:[{task_id:null,text:'必要な局所補修後に90分benchmarkで再測定',success:'scanを含む90分で3問を完遂',refs:['metric:timed']}],unknowns:[{text:'自然な別問題での転移の証拠が不足',needed:'参照なしの別過去問で対象技能を使用',refs:['metric:transfer']}]}});
test('compact facts preserve old measurement and priority-source/latest-result pairs instead of last-N only',()=>{
 assert.equal(typeof coach.buildCoachReviewFacts,'function');const a=input(),before=JSON.stringify(a),facts=coach.buildCoachReviewFacts(a);
 assert.equal(facts.metrics.timed.value,20);assert.equal(facts.metrics.transfer.status.unattempted,7);
 assert.ok(facts.evidence.some(e=>e.id==='attempt:1'));assert.ok(facts.evidence.some(e=>e.id==='attempt:2'));
 assert.equal(facts.evidence.find(e=>e.id==='attempt:2').findings[0].result,'success');assert.equal(JSON.stringify(a),before);
 assert.ok(JSON.stringify(facts).length<12000);assert.ok(facts.priorities.length<=3);
});
test('new prompt requests compact v2, no all-history echo and bounded decision references',()=>{
 const prompt=coach.buildCoachReviewPrompt(input());assert.match(prompt,/stat1-coach-v2/);assert.doesNotMatch(prompt,/"evidence_ids"/);
 assert.doesNotMatch(prompt,/RECENT_REPRESENTATIVE_ATTEMPTS|CURRENT_EXAM_ASSESSMENT|READINESS:/);assert.match(prompt,/局所補修.*本番/);
 assert.ok(prompt.length<16000);const raw=JSON.parse(prompt.slice(prompt.lastIndexOf('\n{\n  "coach_update"')+1));assert.equal(raw.coach_update.schema_version,'stat1-coach-v2');
});
test('v2 parses short decisions, preserves per-decision references and does not invent pass probability',()=>{
 const a=input(),raw=reply(coach.coachReviewContext(a)),d=coach.parseCoachUpdate(JSON.stringify(raw));
 assert.equal(d.level.value,2.5);assert.deepEqual(d.primaryBottleneck.evidenceIds,['metric:timed']);assert.equal(d.optionalPassProbability,null);
 assert.equal(d.nextActions[0].successCondition,raw.coach_update.actions[0].success);assert.equal(d.unknowns.length,1);
 const context={...coach.coachReviewContext(a),dataVersion:d.reviewDataVersion,referenceIds:['metric:selectedThree','metric:timed','metric:transfer'],taskIds:[]};
 assert.doesNotThrow(()=>coach.validateCoachReviewContext(d,context,true));
 assert.throws(()=>coach.validateCoachReviewContext({...d,reviewContextVersion:'wrong'},context,true),/データが更新/);
 assert.throws(()=>coach.validateCoachReviewContext({...d,reviewEvidenceIds:['attempt:999999']},context,true),/証拠/);
 assert.throws(()=>coach.validateCoachReviewContext({...d,reviewEvidenceIds:['attempt:1']},context,true),/証拠/,'known but undisclosed references are not accepted');
 assert.throws(()=>coach.validateCoachReviewContext({...d,nextActions:[{...d.nextActions[0],taskIdentity:'review:99999'}]},context,true),/課題ID/);
 const hidden=structuredClone(a);hidden.attempts[10].score_numeric=12;
 assert.notEqual(coach.coachReviewContext(hidden).version,context.version,'unquoted history still participates in full-context freshness');
});
test('v2 rejects oversized prose, invented/empty decision evidence, bad dates and malformed levels',()=>{
 const a=input(),r=reply(coach.coachReviewContext(a));
 for(const mutate of [u=>u.level.value=2.7,u=>u.level.value=null,u=>u.reviewed_at='yesterday',u=>u.bottleneck.text='長'.repeat(500),u=>u.level.refs=[],u=>u.improvements=Array.from({length:4},()=>({text:'改善',refs:['attempt:1']}))]){const v=structuredClone(r);mutate(v.coach_update);assert.throws(()=>coach.parseCoachUpdate(JSON.stringify(v)));}
});
test('v1 full echo remains accepted only for the matching full context',()=>{
 const context=coach.coachReviewContext(input()),r=coach.coachPromptContract(27,context),u=r.coach_update;
 Object.assign(u,{reviewed_at:'2026-10-16T08:00:00+09:00',level:{value:2.5,label:'補強段階',pass_outlook:'再測定が必要',confidence:'medium',rationale:'旧形式の説明は履歴として保全'},primary_bottleneck:{title:'時間内完走',explanation:'未再測定',effect_on_exam:'3問を得点化',evidence_problem_ids:[]},next_actions:[],strengths:[],improvements:[],unknowns:[]});
 const d=coach.parseCoachUpdate(JSON.stringify(r));assert.doesNotThrow(()=>coach.validateCoachReviewContext(d,context,true));
 assert.throws(()=>coach.validateCoachReviewContext({...d,reviewEvidenceIds:context.evidenceIds.slice(1)},context,true),/証拠ID/);
});
test('dashboard uses fresh GPT advice without changing measured bars or canonical Today priority',()=>{
 assert.equal(typeof overview.coachDashboardAdvice,'function');const a=input(),d=coach.parseCoachUpdate(JSON.stringify(reply(coach.coachReviewContext(a))));
 const data={coach:{current:d,stale:false,reviewContext:{version:d.reviewContextVersion}},today:{tasks:a.tasks}};
 const v=overview.coachDashboardAdvice(data);assert.equal(v.bottleneck,d.primaryBottleneck.title);assert.equal(v.action,d.nextActions[0].title);
 assert.equal(overview.coachDashboardAdvice({...data,coach:{...data.coach,stale:true}}),null);assert.equal(a.tasks[0].ranking.rank,1);
});

test('repair success without a new timed measurement leaves real measurements and partial-scope meaning intact',()=>{
 const a=input(),before=coach.buildCoachReviewFacts(a),changed=structuredClone(a);changed.attempts.push(attempt(100,'error_repair',true));
 changed.masteryByProblem={'PY-2018-Q3':{normalReviewComplete:false,levels:[]}};
 const after=coach.buildCoachReviewFacts(changed);assert.deepEqual(after.metrics,before.metrics);assert.equal(after.automatic.level,2.5);
 assert.ok(after.evidence.some(e=>e.id==='attempt:100'&&e.result==='scoped_success'));assert.equal(after.retention.confirmedProblems,0);
 const old=coach.parseCoachUpdate(JSON.stringify(reply(coach.coachReviewContext(a))));
 assert.throws(()=>coach.validateCoachReviewContext(old,coach.coachReviewContext(changed),true),/データが更新/);
});
test('a new real measurement changes facts and context instead of fixing the level to the old opinion',()=>{
 const a=input(),old=coach.coachReviewContext(a);a.dashboard.readiness.evidence.timed={...metric(40,6,['session:8']),lastUpdated:'2026-10-16'};
 a.assessment={...a.assessment,level:3};const facts=coach.buildCoachReviewFacts(a);
 assert.equal(facts.metrics.timed.value,40);assert.equal(facts.metrics.timed.date,'2026-10-16');assert.equal(facts.automatic.level,3);assert.notEqual(coach.coachReviewContext(a).version,old.version);
});
test('training success, failure, uncertainty, assistance and repeated destinations remain distinct',()=>{
 const a=input(),skill='coefficient_tracking_scale_reciprocal';a.tasks=[];a.attempts=[];
 for(let i=0;i<4;i++){
  const source={...attempt(100+i),problem_id:`PY-fixture-Q${i}`,mode:'main_calc',graded_findings:[{graded_part_id:'major_calculation',resolved:false,error_type:'W',evidence:'逆数へ変換する係数2を落とした'}]};
  const t={...source,id:200+i,problem_id:`GEN-fixture-${i}`,source_type:'generated',learning_purpose:'transfer_check',assessment_timing:'delayed_retrieval',
   transfer_lineage:{key:`training:fixture:${i}`,sourceProblemId:source.problem_id,sourceAttemptId:source.id,rootSkillId:skill,sourceFindingIds:['major_calculation'],matchConfidence:'high'},
   grading_contract:{gradedParts:[{id:'major_calculation',rootSkillIds:[skill]}]},
   graded_findings:[{graded_part_id:'major_calculation',resolved:true,error_type:'none',evidence:'対象の係数を保持して計算を完了'}],
   target_skill_assessment:{self_selected:true,major_calculation_success:i!==1,no_major_error:true,evidence:'別問題の対象操作を確認'}};
  if(i===2)t.grading_confidence=.4;if(i===3){t.hint_used=true;t.actual_reference_level=3;}
  a.attempts.push(source,t);if(i===0)a.attempts.push({...t,id:250});
 }
 const facts=coach.buildCoachReviewFacts(a);assert.deepEqual(facts.training,{success:1,failure:1,uncertain:1,assisted:1});
 assert.equal(facts.metrics.transfer.status.successful,0,'generated success never becomes natural transfer');
});
test('priority mathematical evidence is not silently truncated or lost after three grading slots',()=>{
 const a=input(),f=a.attempts[0].graded_findings[0];f.evidence='結論と条件の区別。'.repeat(100);
 a.attempts[0].graded_findings.push(...Array.from({length:5},(_,i)=>({...f,graded_part_id:`part:${i}`})));
 const facts=coach.buildCoachReviewFacts(a),row=facts.evidence.find(e=>e.id==='attempt:1');assert.equal(row.findings.length,6);assert.equal(row.findings[0].evidence,f.evidence);
});
test('blind benchmark action cannot display a model-supplied solving cue',()=>{
 const a=input(),r=reply(coach.coachReviewContext(a)),task={...a.tasks[0],stable_session_key:'session:fixture',learning_purpose:'exam_simulation'};
 r.coach_update.actions[0].task_id=currentTaskIdentity(task);r.coach_update.actions[0].text='SECRET: 係数を先に計算する';
 const d=coach.parseCoachUpdate(JSON.stringify(r));const advice=overview.coachDashboardAdvice({coach:{current:d,stale:false,reviewContext:{version:d.reviewContextVersion}},today:{tasks:[task]}});
 assert.ok(advice.task);assert.doesNotMatch(advice.action,/SECRET|係数/);
});
test('compact input digest catches changed task scope and ignores evaluation-history-only changes',()=>{
 assert.equal(typeof coach.coachFactsVersion,'function');const a=input(),facts=coach.buildCoachReviewFacts(a),changed=structuredClone(facts);
 changed.priorities[0].scope='主対象：(2)';assert.notEqual(coach.coachFactsVersion(changed),coach.coachFactsVersion(facts));
 const historyOnly={...facts,previous:{at:'2026-10-16',cutoff:27,level:2.5,bottleneck:'再測定'},since_previous:{new_valid_attempts:0,by_purpose:{}}};
 assert.equal(coach.coachFactsVersion(historyOnly),coach.coachFactsVersion(facts),'saving this evaluation must not stale itself');
});
