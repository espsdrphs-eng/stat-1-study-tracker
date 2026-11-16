import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup} from '../src/localDb.ts';
import {sourceRecordsEqual} from '../src/sourceBackup.ts';
import {GENERATION_CHECKS} from '../src/generatedTransfer.ts';
import {projectCapabilityMap,readCapabilityRecords} from '../src/capabilityEvidence.ts';
import {theoryAddDays} from '../src/capabilityTheory.ts';
import {calculateExamReadinessMetrics} from '../src/examReadiness.ts';
import {dailyFixture} from './dailyLearningFixture.mjs';

const morning=()=>localGet('/api/daily-learning/snapshot');
const preview=text=>localPost('/api/daily-learning/preview',{text});
const save=(text,p)=>localPost('/api/daily-learning/save',{text,confirmationToken:p.confirmationToken,confirmed:true});

test('morning → 4 original problems and 6 separate answers → next snapshot, replay and restore',async()=>{
 await localGet('/api/bootstrap');
 const before=await exportBackup(),m=await morning();
 assert.equal(new Set(m.snapshot.abilities.map(a=>a.ability_id)).size,75);
 assert.ok(m.snapshot.candidates.length<=3);assert.equal(m.snapshot.learning_goal,'long_term_theory');
 assert.ok(sourceRecordsEqual(before,await exportBackup()),'morning is read-only');
 const session=dailyFixture(m.snapshot),text=JSON.stringify(session),p=await preview(text);
 assert.equal(p.problems.length,4);assert.equal(p.answers.length,6);
 assert.ok(sourceRecordsEqual(before,await exportBackup()),'preview rolls back all writes');
 const result=await save(text,p),after=await exportBackup();
 assert.deepEqual(result.answers,p.answers);
 const rows=Object.fromEntries(result.answers.map(a=>[a.ref,after.attempts.find(r=>r.id===a.attempt_id)]));
 assert.deepEqual(Object.values(rows).map(a=>a.score_numeric),[18,91,55,100,5,80]);
 assert.equal(rows.rC.daily_answer.baseline_attempt_id,rows.aC.id);
 assert.equal(result.coaching_without_answer[0].baseline_attempt_id,rows.aA.id);
 assert.equal(rows.rC.reference_closed_reproduction,false);
 assert.equal(rows.aD.graded_findings.find(x=>x.graded_part_id==='q3').error_type,'none');
 assert.equal(rows.aB.daily_answer.parts[1].quote,session.answers[1].parts[1].quote);
 assert.equal(rows.aB.graded_findings.find(x=>x.graded_part_id==='q3').error_type,'C');
 assert.ok(Object.values(rows).every(a=>a.exam_score_eligible===false));
 assert.notEqual(result.evaluations.find(e=>e.ability_id==='testing.errors-power').after,'immediate_confirmed');
 assert.equal(result.evaluations.find(e=>e.ability_id==='testing.errors-power').status,'held');
 assert.equal(result.evaluations.find(e=>e.ability_id==='cross.quantity-identity').after,'unrepaired');
 assert.deepEqual(after.reviews,before.reviews);assert.deepEqual(after.weakNotes,before.weakNotes);
 assert.deepEqual(after.attempts.filter(a=>before.attempts.some(o=>o.id===a.id)),before.attempts);
 const next=await morning();assert.notEqual(next.snapshot.context_version,m.snapshot.context_version);
 assert.equal(Object.values(next.snapshot.counts).reduce((s,n)=>s+n,0),75);
 assert.equal(next.snapshot.recent_daily_sessions.at(-1).session_id,session.session_id);
 assert.equal(next.snapshot.recent_daily_sessions.at(-1).coaching_without_answer.length,1);
 assert.equal(next.snapshot.abilities.find(a=>a.ability_id==='asymptotics.clt').effective_state,'unconfirmed');
 assert.equal((await preview(JSON.stringify(session,null,2))).duplicate,true);assert.equal((await save(text,p)).duplicate,true);
 const sameId=structuredClone(session);sameId.answers[3].score.points=99;
 await assert.rejects(()=>preview(JSON.stringify(sameId)),/別の内容で保存済み/);
 const reissued=structuredClone(session);reissued.session_id='reissued-duplicate';reissued.morning_context_version=next.snapshot.context_version;
 for(const row of reissued.problems)row.familiarity='seen';
 await assert.rejects(()=>preview(JSON.stringify(reissued)),/二重に数えません/);
 assert.ok(sourceRecordsEqual(after,await exportBackup()));
 await restoreBackup(after,{mode:'original',sourceHash:after.source_manifest.data_hash});
 db.close();await db.open();assert.ok(sourceRecordsEqual(after,await exportBackup()));
 const restored=await morning();assert.deepEqual(restored.snapshot.abilities,next.snapshot.abilities);
});

test('structural errors, a stale snapshot and a late write error leave the complete archive unchanged',async()=>{
 const m=(await morning()).snapshot,day=theoryAddDays(m.study_date,-1),base=await exportBackup();
 const w=dailyFixture(m,day);w.session_id='failure-rollback';
 for(const p of w.problems)p.statement+=' 【別フィクスチャ】';
 const stray=structuredClone(w);stray.evaluations[0].evidence[0].part_ids=['imaginary'];
 await assert.rejects(()=>preview(JSON.stringify(stray)),/存在しません/);
 const missing=structuredClone(w);missing.answers[3].baseline=999999;
 await assert.rejects(()=>preview(JSON.stringify(missing)),/有効な元答案 999999/);
 const falseDiagnosis=structuredClone(w);falseDiagnosis.answers[4].first_error_part_id='q3';
 await assert.rejects(()=>preview(JSON.stringify(falseDiagnosis)),/観察された/);
 const wrongScope=structuredClone(w);wrongScope.answers[3].baseline='aB';
 await assert.rejects(()=>preview(JSON.stringify(wrongScope)),/同じ日に同じ問題/);
 const known=structuredClone(w);known.problems[0].existing_problem_id=base.problems[0].problem_id;
 await assert.rejects(()=>preview(JSON.stringify(known)),/上書きできません/);
 const sameLogical=structuredClone(w);sameLogical.problems[0].statement=base.problems.find(p=>p.original_exercise).original_exercise.statement;
 await assert.rejects(()=>preview(JSON.stringify(sameLogical)),/衝突|違う問題文または採点項目/);
 await assert.rejects(()=>preview('{未完'),/標準JSON/);
 assert.ok(sourceRecordsEqual(base,await exportBackup()));
 const text=JSON.stringify(w),p=await preview(text);
 const quota=key=>{if(key==='daily-learning:v1:'+w.session_id)throw new DOMException('simulated late failure','QuotaExceededError')};
 db.meta.hook('creating',quota);
 try{await assert.rejects(()=>save(text,p),/simulated late failure|QuotaExceededError/);}finally{db.meta.hook('creating').unsubscribe(quota);}
 assert.ok(sourceRecordsEqual(base,await exportBackup()),'failure after capability and raw record writes aborted the entire transaction');
 assert.deepEqual((await preview(text)).answers,p.answers,'auto-increment keys are not consumed by failed attempts');
 await localPost('/api/problems/original',{title:'別タブの更新',statement:'別タブで追加した問題',parts:['記述']});
 const changed=await exportBackup();
 await assert.rejects(()=>save(text,p),/朝の参照時点から記録が変わっています/);
 assert.ok(sourceRecordsEqual(changed,await exportBackup()));
 const draft=await localGet('/api/daily-learning/snapshot?draft='+day);
 assert.equal(draft.snapshot.previous_day.status,'local_draft_not_confirmed');
});

test('an unverified same-day reproduction neither promotes the capability nor cancels the saved failure',async()=>{
 const m=(await morning()).snapshot,before=await exportBackup(),original=before.attempts.find(a=>a.daily_answer?.ref==='aA');
 const w=dailyFixture(m),day=m.study_date;w.session_id='not-closed-reproduction';w.coaching_without_answer=[];w.created_at=new Date().toISOString();
 w.problems=[{ref:'pA',existing_problem_id:original.problem_id,purpose:'local_repair',familiarity:'seen',shown:['statement'],quality:null,target_ability_ids:['estimation.bias-risk'],selection_reason:null}];
 const originalGrade=w.answers[0];w.answers=[{...originalGrade,ref:'unclear',kind:'immediate_reproduction',baseline:original.id,reference:{...originalGrade.reference,closed_reproduction:false},
  parts:[{part_id:'q1',status:'correct',quote:'MSE(T) = Var(T) + Bias(T)²（模擬）',finding:'式は正しいが別の自力答案か確認が取れない。',error_type:'none'}],first_error_part_id:null}];
 w.evaluations=[{ability_id:'estimation.bias-risk',state:'immediate_confirmed',certainty:'confirmed',judgement:'採点結果と申告を区別する。',cause_hypothesis:null,
  evidence:[{answer_ref:'unclear',part_ids:['q1'],outcome:'success',aspect:'derivation',observation:'式は正答。参照を閉じたことは未確認。'}],next_check:null}];
 const text=JSON.stringify(w),p=await preview(text),row=p.evaluations.find(e=>e.ability_id==='estimation.bias-risk');
 assert.equal(row.status,'held');assert.equal(row.before,'unrepaired');assert.equal(row.after,'unrepaired');
 assert.equal(row.observations[0].status,'unconfirmed');assert.equal(w.learning_date,day);assert.ok(sourceRecordsEqual(before,await exportBackup()));
});

test('confirmed direct reproduction, externally checked blind transfer, retention and later recurrence keep each separate event',async()=>{
 const m=(await morning()).snapshot,ability='estimation.likelihood-build',day=theoryAddDays(m.study_date,-36),later=theoryAddDays(m.study_date,-4),last=theoryAddDays(m.study_date,-2);
 const seed=(snapshot,date,id)=>({schema_version:'stat1-daily-learning-v1',session_id:id,learning_date:date,morning_context_version:snapshot.context_version,catalog_version:snapshot.catalog_version,
  created_at:`${date}T20:00:00+09:00`,learning_goal:'long_term_theory',source_status:'observed',departure_reason:null});
 const problem=(statement,purpose='diagnostic')=>({ref:'p',title:statement,statement,parts:[{id:'q1',label:'与えられたモデルの確率を観測値で評価する'}],purpose,
  familiarity:'unseen',shown:['statement'],target_ability_ids:[ability],selection_reason:'検証用の能力確認。',quality:null});
 const grade=(ref,kind,baseline,answered_at,right,more={})=>({ref,problem_ref:'p',kind,baseline,answered_at,source:'handwriting',reference:{level:0,hint_used:false,method_cued:false,closed_reproduction:kind==='immediate_reproduction'},
  grading_confidence:95,score:{points:right?20:8,max:20},parts:[{part_id:'q1',status:right?'correct':'incorrect',quote:right?'L(θ)=∏ f_θ(xᵢ)':'L(θ)=∏ θᵢ',error_type:right?'none':'N',finding:'実際の操作の模擬所見'}],
  first_error_part_id:right?null:'q1',affected_part_ids:[],independent_error_part_ids:[],...more});
 const proof=(answer_ref,outcome,aspect='derivation',more={})=>({answer_ref,part_ids:['q1'],outcome,aspect,observation:'模擬答案で同じ操作を採点した。',...more});
 const evaluate=(state,evidence,next_check=null)=>({ability_id:ability,state,certainty:'confirmed',judgement:'模擬判定',cause_hypothesis:null,evidence,next_check});
 const first={...seed(m,day,'time-baseline'),problems:[problem('模擬・独立標本の尤度')],answers:[grade('first','diagnostic',null,`${day}T18:00:00+09:00`,false),grade('closed','immediate_reproduction','first',`${day}T18:30:00+09:00`,true)],
  evaluations:[evaluate('immediate_confirmed',[proof('first','failure'),proof('closed','success','derivation',{comparison:{against:'first',result:'improved',reason:'同じ採点箇所を別答案で、自力で正しく実行。'}})])]};
 const text1=JSON.stringify(first),p1=await preview(text1),r1=await save(text1,p1),oldId=r1.answers[1].attempt_id;
 assert.equal(r1.evaluations[0].after,'immediate_confirmed');assert.equal(r1.evaluations[0].observations[1].comparison.accepted,true);
 const context=(await morning()).snapshot,p=problem('模擬・区間記録の尤度と仮定の確認','delayed_transfer');
 p.presented_at=`${later}T09:30:00+09:00`;p.quality={generator_pass_id:'generator-test',validator_pass_id:'other-pass-test',checked_at:`${later}T09:00:00+09:00`,
  checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:true,evidence:'別の検証者による合成の照合。'}]))};
 const structure_difference='点の密度ではなく区間確率を母数の関数に組み立てる。';
 const w={...seed(context,later,'time-transfer'),problems:[p],answers:[grade('new','delayed_transfer',oldId,`${later}T18:00:00+09:00`,true)],evaluations:[evaluate('delayed_transfer_confirmed',[
  proof('new','success','transfer',{structure_difference}),proof('new','success','retention',{structure_difference})],{basis:'new',kind:'delayed_transfer',due_date:null,task:'90日の保持を確かめる',success_condition:'異構造で尤度を自力構成できる',aspect:'retention',interval_days:90})]};
 const text=JSON.stringify(w),held=await preview(text);
 assert.equal(held.can_confirm_noncued,true);assert.equal(held.evaluations[0].status,'held');assert.equal(held.evaluations[0].after,'immediate_confirmed');
 assert.ok(held.evaluations[0].observations.every(o=>o.status==='unconfirmed'));
 const seen=structuredClone(w);seen.problems[0].shown.push('quality');
 const exposure=await localPost('/api/daily-learning/preview',{text:JSON.stringify(seen),confirmNoncued:true});assert.equal(exposure.can_confirm_noncued,false);assert.equal(exposure.evaluations[0].status,'held');
 const same=structuredClone(w);same.problems[0].existing_problem_id=r1.problems[0].problem_id;for(const k of ['title','parts','statement'])delete same.problems[0][k];
 same.problems[0].familiarity='seen';const retest=await localPost('/api/daily-learning/preview',{text:JSON.stringify(same),confirmNoncued:true});
 assert.notEqual(retest.evaluations[0].after,'delayed_transfer_confirmed');
 let baseline=await exportBackup();
 await assert.rejects(()=>localPost('/api/daily-learning/save',{text,confirmed:true,confirmationToken:held.confirmationToken,confirmNoncued:true}),/保存候補が変わりました/);
 assert.ok(sourceRecordsEqual(baseline,await exportBackup()));
 const verified=await localPost('/api/daily-learning/preview',{text,confirmNoncued:true});
 const r2=await localPost('/api/daily-learning/save',{text,confirmed:true,confirmationToken:verified.confirmationToken,confirmNoncued:true});
 assert.equal(r2.evaluations[0].after,'delayed_transfer_confirmed');assert.ok(r2.evaluations[0].observations.every(o=>o.status==='success'));
 assert.equal(r2.evaluations[0].next_check.interval_days,90);
 const day2=(await morning()).snapshot,transferred=day2.abilities.find(a=>a.ability_id===ability);
 assert.equal(transferred.last_delayed_transfer_on,later);assert.equal(transferred.growth.retention_minimum_days,30);
 const w3={...seed(day2,last,'time-recurrence'),problems:[problem('模擬・異なる模型で再発')],answers:[grade('later_failure','diagnostic',null,`${last}T18:00:00+09:00`,false)],evaluations:[evaluate('unrepaired',[
  proof('later_failure','failure','derivation',{comparison:{against:oldId,result:'recurrence',reason:'同じ操作の取り違えが別設定で再発。'}})])]};
 const t3=JSON.stringify(w3),r3=await save(t3,await preview(t3));assert.equal(r3.evaluations[0].after,'unrepaired');assert.equal(r3.evaluations[0].observations[0].comparison.accepted,true);
 baseline=await exportBackup();const a=projectCapabilityMap(baseline,readCapabilityRecords(baseline.meta).records).abilities.find(a=>a.id===ability);
 assert.ok(a.directEvidence.some(x=>x.attempt.id===oldId&&x.outcomes.includes('success')));
 assert.ok(a.directEvidence.some(x=>x.attempt.id===r2.answers[0].attempt_id&&x.outcomes.includes('success')));assert.equal(a.theory.milestone,30);
 assert.equal((await morning()).snapshot.abilities.find(a=>a.ability_id===ability).growth.independently_graded_comparisons[0].compared.result,'recurrence');
});

test('existing material is linked without changing the master, formal scores, or legacy schedules',async()=>{
 const m=(await morning()).snapshot,before=await exportBackup(),material=before.problems.find(x=>x.source_type==='past_exam'),day=m.study_date;
 const w=dailyFixture(m);w.session_id='existing-material';w.problems=[{ref:'exam',existing_problem_id:material.problem_id,purpose:'exam',familiarity:'seen',shown:['statement'],quality:null,target_ability_ids:['cross.request-to-math'],selection_reason:null}];
 w.coaching_without_answer=[];
 const first=w.answers[0];w.answers=[{...first,ref:'known',problem_ref:'exam',kind:'exam',parts:[{...first.parts[0],part_id:'major_calculation'}],first_error_part_id:'major_calculation'}];w.evaluations=[];
 const text=JSON.stringify(w),result=await save(text,await preview(text)),saved=await exportBackup();
 assert.equal(result.problems[0].status,'existing');assert.deepEqual(saved.problems,before.problems);assert.deepEqual(saved.reviews,before.reviews);
 const row=saved.attempts.find(a=>a.id===result.answers[0].attempt_id);assert.equal(row.daily_answer.kind,'exam');assert.equal(row.exam_score_eligible,false);
 const previousMetrics=calculateExamReadinessMetrics({...before,aliases:before.problemAliases,today:day}),afterMetrics=calculateExamReadinessMetrics({...saved,aliases:saved.problemAliases,today:day});
 for(const key of ['timedCompletionRate','pastExamScoreRate','unseenScoreRate'])assert.equal(afterMetrics[key],previousMetrics[key]);
 assert.ok((await morning()).snapshot.abilities.find(a=>a.ability_id==='cross.request-to-math').unreviewed_attempt_ids.includes(row.id));
 await localGet('/api/bootstrap');assert.deepEqual((await exportBackup()).reviews,before.reviews);
});

test('recurrence counts only use distinct, equally sized and comparable evidence samples',async()=>{
 const m=(await morning()).snapshot,day=theoryAddDays(m.study_date,-1),w=dailyFixture(m,day),scope='probability.conditional-probability';
 w.session_id='recurrent-samples';w.problems=[];w.answers=[];w.evaluations=[];w.coaching_without_answer=[];w.created_at=`${day}T20:00:00+09:00`;
 for(let i=1;i<=4;i++){
  const right=i>2,ref=`P${i}`;
  w.problems.push({ref,title:`模擬観測 ${i}`,statement:`模擬観測 ${i}・条件付き確率を求める。`,parts:[{id:'q1',label:'条件付き確率'}],purpose:'diagnostic',familiarity:'unseen',shown:['statement'],quality:null,target_ability_ids:[scope],selection_reason:null});
  w.answers.push({ref:`A${i}`,problem_ref:ref,kind:'diagnostic',baseline:null,answered_at:`${day}T1${i}:00:00+09:00`,source:'chat_text',reference:{level:0,hint_used:false,method_cued:false,closed_reproduction:false},score:null,grading_confidence:95,
   parts:[{part_id:'q1',status:right?'correct':'incorrect',quote:right?'P(A|B)=P(A∩B)/P(B)':'P(A|B)=P(B)',finding:'模擬の同じ操作',error_type:right?'none':'N'}],first_error_part_id:right?null:'q1',affected_part_ids:[],independent_error_part_ids:[]});
 }
 // The main fixture's prior assessment may be on today's date. Keep history
 // immutable by using a capability not otherwise graded in this fixture.
 const ability='probability.bayes-rule';for(const p of w.problems)p.target_ability_ids=[ability];
 w.evaluations.push({ability_id:ability,state:'unconfirmed',certainty:'confirmed',judgement:'同条件を照合した模擬サンプル限定。',cause_hypothesis:null,
  evidence:w.answers.map((a,i)=>({answer_ref:a.ref,part_ids:['q1'],outcome:i>1?'success':'failure',aspect:'derivation',observation:'模擬操作の確認。'})),
  next_check:null,recurrence_comparison:{before:['A1','A2'],after:['A3','A4'],aspect:'derivation',reason:'同じ条件付き判断の模擬出題を比較した。'}});
 const incompatible=structuredClone(w);incompatible.answers[2].reference={level:2,hint_used:true,method_cued:true,closed_reproduction:false};
 assert.equal((await preview(JSON.stringify(incompatible))).evaluations[0].recurrence_comparison.before_failures,null);
 const text=JSON.stringify(w),saved=await save(text,await preview(text)),comparison=saved.evaluations[0].recurrence_comparison;
 assert.deepEqual([comparison.before_failures,comparison.after_failures],[2,0]);assert.equal(comparison.before.length,2);assert.equal(comparison.after.length,2);
 assert.equal((await morning()).snapshot.abilities.find(a=>a.ability_id===ability).growth.recurrence_comparison.after_failures,0);
});
