import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';
import {buildInitialGradingContract} from '../src/gradingContract.ts';
import {resolvePersistedAttemptLifecycle} from '../src/reviewTransition.ts';
import {addCalendarDays} from '../src/reviewSchedulePolicy.ts';
import {scheduleActiveReviews} from '../src/reviewScheduling.ts';
const {db,localGet,localPost,exportBackup,restoreBackup}=await import('../src/localDb.ts');

test('isolated selfcheck closed loop: failure, postponed repair, retrieval failure, repair, graduation and reload',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-09T05:00:00Z')});
 await localGet('/api/bootstrap');await db.attempts.clear();await db.reviews.clear();await db.weakNotes.clear();await db.pastSessions.clear();
 for(const m of await db.meta.toArray())if(m.key.startsWith('today-plan-snapshot')||m.key.startsWith('task-postpone:'))await db.meta.delete(m.key);
 await db.meta.put({key:'daily_study_minutes',value:'120'});
 const pid='PY-2017-Q2',p=await db.problems.get(pid),c=buildInitialGradingContract({problem:p,mode:'full',createdAt:new Date().toISOString()});
 const failed=c.gradedParts.find(p=>p.masteryLevel===2)?.id||c.gradedParts[0].id;
 await localPost('/api/attempts',{submission_id:'isolated-closedloop-initial',problem_id:pid,problem_id_confirmed:true,date:'2026-10-09',mode:c.mode,
  actual_minutes:35,score_numeric:50,score_label:'C',error_type:'W',primary_error_type:'W',error_types:['W'],error_point:'主要計算未完',next_action:'対象の計算を補修',
  contract_id:c.contractId,contract_version:c.contractVersion,contract_hash:c.contractHash,learning_purpose:c.learningPurpose,learning_stage:c.learningStage,
  review_scope:c.reviewScope,assessment_timing:'independent_performance',graded_part_ids:c.gradedParts.map(p=>p.id),
  graded_findings:c.gradedParts.map(p=>({graded_part_id:p.id,error_type:p.id===failed?'W':'none',resolved:p.id!==failed,evidence:'isolated calculation'})),
  target_issue_resolved:false,minimum_pass_condition_met:false,review_outcome:'failed',actual_reference_level:0,grading_confidence:.99});
 const trace=[];let date='2026-10-09';
 const advance=d=>{date=d;t.mock.timers.setTime(Date.parse(d+'T05:00:00Z'));};
 const current=async()=>{await localGet('/api/bootstrap');return (await db.reviews.where('problem_id').equals(pid).toArray()).filter(r=>['pending','overdue'].includes(r.status));};
 let rr=await current();assert.equal(rr.length,1);assert.equal(rr[0].learning_purpose,'error_repair');
 advance(rr[0].due_date);await localPost(`/api/reviews/${rr[0].id}/postpone`,{days:2,postpone_reason:'isolated budget'});
 rr=await current();const deferred=rr[0],s=await localGet('/api/bootstrap');
 const placements=s.adaptiveLearning.plannerShadow.plan14.reviewSchedule.placements.filter(p=>p.reviewId===deferred.id);
 assert.ok(placements.every(p=>p.date>=deferred.due_date),JSON.stringify(placements));
 assert.ok(!s.today.tasks.some(t=>t.id===deferred.id&&!t.checked&&t.triage==='must'));
 trace.push({date,event:'postpone',review:deferred.id,to:deferred.due_date,placements});advance(deferred.due_date);
 for(const result of ['success','failed','success','success']){
  rr=await current();assert.equal(rr.length,1);const r=rr[0];if(r.due_date>date)advance(r.due_date);
  const before=JSON.stringify(await db.meta.get(`today-plan-snapshot:${date}`));
  await localPost(`/api/reviews/${r.id}/complete`,{result,actual_reference_level:0,hint_used:false,time_minutes:10});
  const newest=(await db.attempts.where('problem_id').equals(pid).toArray()).sort((a,b)=>b.id-a.id)[0];
  const lifecycle=resolvePersistedAttemptLifecycle(newest),after=await current();
  trace.push({date,event:result,purpose:r.learning_purpose,mark:newest.mark,graduated:lifecycle.graduated,next:after.map(r=>({id:r.id,purpose:r.learning_purpose,due:r.due_date}))});
  if(result==='failed'){assert.equal(lifecycle.graduated,false);assert.equal(after[0].learning_purpose,'error_repair');}
  if(result==='success'&&r.learning_purpose==='error_repair'){assert.equal(lifecycle.graduated,false);assert.equal(after[0].learning_purpose,'retrieval_check');}
  if(result==='success'&&r.learning_purpose==='retrieval_check'){assert.equal(lifecycle.graduated,true);assert.equal(after.length,0);}
  if(before!==undefined)assert.equal(JSON.stringify(await db.meta.get(`today-plan-snapshot:${date}`)),before,'morning snapshot retained');
 }
 for(let n=1;n<=3;n++){advance(addCalendarDays(date,1));const state=await localGet('/api/bootstrap');assert.equal((await current()).length,0);
  assert.ok(!state.today.tasks.some(t=>t.problem_id===pid&&!t.checked&&!t.past_exam_year));trace.push({date,event:'post-graduation',reissued:false});}
 const state=await localGet('/api/bootstrap');const fingerprint=s=>s.today.tasks.filter(t=>!t.checked).map(t=>[t.id,t.problem_id,t.mode,t.minutes]);
 const backup=await exportBackup();await restoreBackup(backup);assert.deepEqual(fingerprint(await localGet('/api/bootstrap')),fingerprint(state));
 await writeFile('outputs/selfcheck-closed-loop.json',JSON.stringify(trace,null,2));db.close();
});
