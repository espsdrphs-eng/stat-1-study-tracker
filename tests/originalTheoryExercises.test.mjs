import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localPost,localGet,exportBackup,previewBackupRestore,restoreBackup} from '../src/localDb.ts';
import {buildInitialGradingContract,buildProblemContextPack} from '../src/gradingContract.ts';
import {parseStructuredStudyText,todayString} from '../src/importParser.ts';
import {projectCapabilityMap} from '../src/capabilityEvidence.ts';
import {sourceRecordsEqual} from '../src/sourceBackup.ts';

const exercise={title:'検証用・理論の自作問題',statement:'X は P(X=0)=P(X=2)=1/2 を満たす。(1) E[X] を求めよ。(2) Var(X) を求めよ。(3) 定数を足した場合の分散を説明せよ。',parts:['小問1の結果','小問2の結果','小問3の理由']};
const add=body=>localPost('/api/problems/original',body);
const bootstrap=()=>localGet('/api/bootstrap');

test('a plain original exercise registers once with an immutable statement and distinct grading items',async()=>{
 await bootstrap();
 const {problem}=await add(exercise);const again=await add(exercise);
 assert.match(problem.problem_id,/^ORIG-/);assert.equal(problem.source_type,'original');assert.equal(again.problem.problem_id,problem.problem_id);assert.equal(again.replayed,true);
 await assert.rejects(()=>add({...exercise,parts:['小問1の結果']}),/採点項目/);
 const contract=buildInitialGradingContract({problem,mode:'full'});
 assert.deepEqual(contract.gradedParts.map(p=>p.id),['q1','q2','q3']);
 assert.equal(buildProblemContextPack({problemId:problem.problem_id,problems:[problem],aliases:[]}).problemStatement,exercise.statement);
 assert.notEqual(contract.learningPurpose,'exam_performance');
});

const grade=(problem,c,raw={})=>({problem_id:problem.problem_id,problem_id_confirmed:true,date:todayString(),mode:c.mode,
 contract_id:c.contractId,contract_version:c.contractVersion,contract_hash:c.contractHash,
 learning_purpose:c.learningPurpose,review_scope:c.reviewScope,target_kind:c.targetKind,generated_from_review_id:c.sourceReviewId,
 source_attempt_id:c.sourceAttemptId,graded_part_ids:c.gradedParts.map(p=>p.id),grading_confidence:99,score_numeric:55,time_minutes:8,...raw});
const parse=async (problem,fields)=>{const text=JSON.stringify({study_update:fields});return {text,updates:parseStructuredStudyText(text,[problem]).updates}};
const save=({text,updates})=>localPost('/api/import',{rawText:text,updates});

test('original diagnosis, a linked same-day repair, and a GPT evaluation survive replay and all-table restoration',async()=>{
 const {problem}=await add(exercise),c=buildInitialGradingContract({problem});
 const findings=[{graded_part_id:'q1',error_type:'none',resolved:true,evidence:'FIXTURE: 期待値は1と答えた。'},
  {graded_part_id:'q2',error_type:'N',resolved:false,evidence:'FIXTURE: 分散の定義と2次モーメントを取り違え、平均の二乗を引かなかった。'},
  {graded_part_id:'q3',error_type:'none',resolved:false,evidence:'FIXTURE: 白紙で未着手。'}];
 const answers=await parse(problem,grade(problem,c,{graded_findings:findings}));
 await assert.rejects(()=>parse(problem,grade(problem,c,{date:'auto_today',graded_findings:findings})),/実際の解答日/);
 await assert.rejects(()=>parse(problem,grade(problem,c,{date:'2026-02-30',graded_findings:findings})),/実際の解答日/);
 await assert.rejects(()=>parse(problem,grade(problem,c,{graded_findings:findings.slice(0,2)})).then(save),/欠落/);
 assert.equal(await db.attempts.where('problem_id').equals(problem.problem_id).count(),0);
 const first=(await save(answers)).savedAttemptIds[0];assert.ok(first>0);
 assert.equal((await save(answers)).savedAttemptIds[0],first);
 const firstBefore=await db.attempts.get(first);
 assert.equal(firstBefore.score_numeric,55);assert.equal(firstBefore.exam_score_eligible,false);
 assert.equal(firstBefore.reference_conditions_known,false);assert.equal(firstBefore.actual_reference_level,undefined);
 const relevantReviews=await db.reviews.where('problem_id').equals(problem.problem_id).toArray(),work=relevantReviews.find(r=>r.status==='pending');
 assert.ok(work,`Expected an executable repair, found ${relevantReviews.map(r=>r.status)}`);
 assert.equal(work.grading_contract.sourceAttemptId,first);assert.deepEqual(work.graded_part_ids,['q2']);
 const old=await localGet('/api/capabilities/context');
 const fixed=await parse(problem,grade(problem,work.grading_contract,{score_numeric:100,assessment_timing:'same_session_correction',
  reference_closed_reproduction:true,target_issue_resolved:true,minimum_pass_condition_met:true,
  graded_findings:[{graded_part_id:'q2',error_type:'none',resolved:true,concept_focus:'assumption',evidence:'FIXTURE: 平均の二乗を引く意味は正しく説明した。参照条件の申告なし。'}]}));
 const repair=(await save(fixed)).savedAttemptIds[0];assert.ok(repair>first);
 assert.equal((await save(fixed)).savedAttemptIds[0],repair);
 assert.deepEqual(await db.attempts.get(first),firstBefore);
 const fixedRow=await db.attempts.get(repair);
 assert.deepEqual([fixedRow.score_numeric,fixedRow.assessment_timing,fixedRow.learning_purpose,fixedRow.reference_conditions_known,fixedRow.reference_closed_reproduction,fixedRow.exam_score_eligible],
  [100,'same_session_correction','error_repair',false,false,false]);
 assert.equal(fixedRow.grading_contract.sourceAttemptId,first);assert.equal(fixedRow.source_review_id,work.id);
 assert.equal((await db.reviews.get(work.id)).assessment_timing,'same_session_correction');
 assert.equal((await db.reviews.get(work.id)).due_date,work.due_date);
 const ctx=await localGet('/api/capabilities/context');assert.notEqual(ctx.version,old.version);
 assert.ok(ctx.eligibleAttemptIds.includes(first)&&ctx.eligibleAttemptIds.includes(repair));
 const revision={schema_version:'stat1-capability-v1',catalog_version:ctx.catalogVersion,context_version:ctx.version,evaluated_at:new Date().toISOString(),evaluations:[
  {ability_id:'distributions.expectation-variance',state:'unrepaired',certainty:'confirmed',judgement:'FIXTURE: 分散の計算失敗は確認。補修の自力条件は不明。',first_error:null,next_check:null,evidence:[
   {attempt_id:first,part_ids:['q2'],aspect:'derivation',outcome:'failure',kind:'diagnostic',baseline_attempt_id:null,observation:'FIXTURE: 2次モーメントと分散を混同した。'},
   {attempt_id:repair,part_ids:['q2'],aspect:'concept',concept_focus:'assumption',outcome:'success',kind:'local_repair',baseline_attempt_id:first,observation:'FIXTURE: 説明は書かれていたが、参照は不明。'},
   {attempt_id:first,part_ids:['q3'],aspect:'derivation',outcome:'failure',kind:'diagnostic',baseline_attempt_id:null,observation:'FIXTURE: 未着手を誤って未達と申告した。'},
  ]}]};
 const before=await exportBackup(),text=JSON.stringify(revision),p=await localPost('/api/capabilities/preview',{text});
 assert.equal(p.entries[0].afterState,'unrepaired');assert.equal(p.entries[0].theory.concept.status,'unconfirmed');
 assert.match(p.entries[0].theory.concept.reason,/参照/);assert.match(p.entries[0].theory.derivation.reason,/未着手/);
 await localPost('/api/capabilities/save',{text,confirmed:true,confirmationToken:p.confirmationToken});
 assert.equal((await localPost('/api/capabilities/save',{text,confirmed:true})).duplicate,true);
 const saved=await exportBackup();assert.deepEqual(saved.reviews,before.reviews);assert.deepEqual(saved.attempts,before.attempts);
 const snapshot=await previewBackupRestore(saved);await restoreBackup(saved,{mode:'original',sourceHash:snapshot.manifest.data_hash});
 db.close();await db.open();const latest=await exportBackup();assert.ok(sourceRecordsEqual(saved,latest));
 const meta=await localGet('/api/capabilities/records');const b=projectCapabilityMap(latest,meta.records).abilities.find(a=>a.id===revision.evaluations[0].ability_id);
 assert.equal(b.state,'unrepaired');assert.equal(b.theory.aspects.concept.status,'unconfirmed');assert.equal(b.theory.aspects.retention.status,'unconfirmed');
 const next=latest.reviews.find(r=>r.problem_id===problem.problem_id&&r.status==='pending');
 assert.ok(next&&next.id!==work.id,'unknown reference conditions must not retire the original repair target');
 assert.deepEqual(next.graded_part_ids,['q2']);
 const repeated=await parse(problem,grade(problem,next.grading_contract,{score_numeric:98,reference_conditions_known:true,actual_reference_level:0,hint_used:false,
  reference_closed_reproduction:true,target_issue_resolved:true,minimum_pass_condition_met:true,
  graded_findings:[{graded_part_id:'q2',error_type:'none',resolved:true,evidence:'FIXTURE: 今度は何も見ず、分散を最初から計算した。'}]}));
 const otherRepair=(await save(repeated)).savedAttemptIds[0];assert.ok(otherRepair>repair);
 assert.deepEqual(await db.attempts.get(first),firstBefore);assert.deepEqual(await db.attempts.get(repair),fixedRow);
 assert.equal((await db.attempts.get(otherRepair)).exam_score_eligible,false);
});
