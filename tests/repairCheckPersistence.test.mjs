import test from 'node:test';import assert from 'node:assert/strict';import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup} from '../src/localDb.ts';
import {repairCheckForTask} from '../src/repairCheck.ts';
import {buildInitialGradingContract,buildGradingContractSnapshot} from '../src/gradingContract.ts';
test('task-bound repair observation survives paper grading, retry, reload derivation and backup without changing exam records',async()=>{
 const b=await localGet('/api/bootstrap'),p=b.problems.find(p=>p.category==='past_exam'&&!/^PY-202[45]/.test(p.problem_id));assert.ok(p);
 const source={id:99000,problem_id:p.problem_id,date:'2026-10-01',mode:'full',mark:'△',score_label:'B',score_numeric:40,error_type:'W',error_types:['W'],grading_confidence:99,grading_contract:buildInitialGradingContract({problem:p,mode:'full'}),graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'FIXTURE: 主要計算を最後まで答案化できない',materiality:'major'}]};await db.attempts.put(source);
 const review={id:99001,problem_id:p.problem_id,generated_from_attempt_id:source.id,source_attempt_id:source.id,due_date:'2026-10-01',earliest_date:'2026-10-01',review_type:'main_calc_retry',status:'pending',learning_purpose:'error_repair',mode:'main_calc'};review.grading_contract=buildGradingContractSnapshot({review,problem:p,sourceAttempt:source}).contract;
 await db.reviews.put(review);const body={problemId:p.problem_id,reviewId:review.id,mode:'main_calc',stage:'preparing',referenceLevel:0,repairCheck:{clue:'条件を読む',knowledge:'定義を思い出す',approach:'立式する',reason:'条件に合うため',stage:'selection'}};
 const before=await db.attempts.toArray();await localPost('/api/learning-work',body);let work=JSON.parse((await db.meta.get(`learning-work:${p.problem_id}`)).value);assert.equal(work.repairCheck.stage,'selection');assert.equal(work.repairCheck.beforeAssistance,true);assert.ok(repairCheckForTask(work.repairCheck,review));
 assert.equal((await db.attempts.count()),before.length,'observation is not a graded success');await localPost('/api/learning-work',{...body,repairCheck:undefined,stage:'awaiting_grading'});assert.deepEqual(JSON.parse((await db.meta.get(`learning-work:${p.problem_id}`)).value).repairCheck,work.repairCheck);
 const backup=await exportBackup();await restoreBackup(backup);assert.deepEqual(JSON.parse((await db.meta.get(`learning-work:${p.problem_id}`)).value).repairCheck,work.repairCheck);
 await assert.rejects(()=>localPost('/api/learning-work',{...body,problemId:'PY-2024-Q1'}));
 const old=(await db.meta.get(`learning-work:${p.problem_id}`)).value;await assert.rejects(()=>localPost('/api/learning-work',{...body,repairCheck:{...body.repairCheck,stage:'guessed'}}));assert.equal((await db.meta.get(`learning-work:${p.problem_id}`)).value,old);
 await db.reviews.put({...review,id:99002});await assert.rejects(()=>localPost('/api/learning-work',{...body,reviewId:99002}),/別の課題/);assert.equal((await db.meta.get(`learning-work:${p.problem_id}`)).value,old);
 for(const a of before)assert.deepEqual(await db.attempts.get(a.id),a);
});
