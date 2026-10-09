import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import 'fake-indexeddb/auto';
import {reviewPlanningDecision} from '../src/todayLearningPolicy.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {resolvePersistedAttemptLifecycle} from '../src/reviewTransition.ts';

const path='outputs/planner-20261009/production-copy.json';
let bytes;
try{bytes=await readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
test('final production COPY: seven warnings, Q2 deferral and all graduated problems',
 {skip:!bytes&&'lossless copy unavailable'},async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-09T05:00:00Z')});
 const originalHash=createHash('sha256').update(bytes).digest('hex');
 const data=JSON.parse(bytes),{db,localGet,localPost,restoreBackup}=await import('../src/localDb.ts');
 await localGet('/api/bootstrap');await restoreBackup(structuredClone(data));
 const state=await localGet('/api/bootstrap'),audit=await localPost('/api/integrity/audit',{});
 const attempts=await db.attempts.toArray(),reviews=await db.reviews.toArray(),sessions=await db.pastSessions.toArray();
 const candidates=state.adaptiveLearning.pastExamRepairCandidates,shadow=state.adaptiveLearning.plannerShadow;
 const review=reviews.find(r=>r.id===522);assert.ok(review);
 const source=attempts.find(a=>a.id===Number(review.grading_contract?.sourceAttemptId||review.source_attempt_id));
 const decision=reviewPlanningDecision({review,attempts,problems:data.problems,
  weaknesses:state.adaptiveLearning.conceptWeaknesses,pastExamIsPrimary:true,repairCandidates:candidates,pastSessions:sessions});
 const q2Candidates=candidates.filter(c=>c.sourceProblemId==='PY-2023-Q2');
 assert.equal(decision.scheduleAsRequired,false);
 assert.ok(!shadow.plan14.reviewSchedule.placements.some(p=>p.reviewId===522));
 assert.ok(!q2Candidates.some(c=>c.required&&['concept_mini','rediagnosis','whitebook'].includes(c.repairKind)));
 const graduated=audit.reconciliation.problems.filter(p=>p.graduated);
 const graduationChecks=graduated.map(p=>{
  const canonical=p.problemId,latest=attempts.filter(a=>a.problem_id===canonical).sort((a,b)=>b.id-a.id)[0];
  const individual=shadow.plan14.plan.flatMap(d=>d.tasks).filter(x=>x.problemId===canonical&&x.pastExamTaskType==='individual_full');
  const repair=candidates.filter(c=>c.sourceProblemId===canonical&&c.required&&['concept_mini','rediagnosis','whitebook'].includes(c.repairKind));
  assert.equal(individual.length,0,canonical+' graduated generic individual repeat');
  assert.equal(repair.length,0,canonical+' graduated stale repair');
  return {problem:canonical,graduationAttempt:p.graduationAttemptId,latestAttempt:latest?.id,
   activeRepair:p.activeRepairReviewIds,activeDelayed:p.activeDelayedReviewIds,individualCount:individual.length,requiredRepairCount:repair.length};
 });
 assert.ok(graduationChecks.some(p=>p.problem==='PY-2017-Q2'));
 const forecastWarnings=audit.issues.filter(i=>i.severity==='active'&&['missing_timed_session','future_exam_practice_share_below_target'].includes(i.category));
 const weekStats=Object.fromEntries(['plan7','plan14','plan30'].map(name=>[name,Array.from({length:Math.floor(shadow[name].plan.length/7)},(_,i)=>{
  const rows=shadow[name].plan.slice(i*7,i*7+7),tasks=rows.flatMap(d=>d.tasks).filter(t=>!t.requiresUserSelection);
  return {week:i+1,dates:rows.map(d=>d.date),minutes:rows.reduce((n,d)=>n+d.totalMinutes,0),
   timed:tasks.filter(x=>x.kind==='timed').map(x=>({year:x.pastExamYear,key:x.stableSessionKey})),
   repairs:tasks.filter(x=>x.repairLineage).reduce((n,x)=>n+x.minutes,0),
   tasks:tasks.map(x=>({problem:x.problemId,kind:x.kind,minutes:x.minutes,slot:x.slot,role:x.pastExamYearRole}))};
 })]));
 const report={exportedAt:data.exported_at,sourceSha256:originalHash,
  audit:{blocking:audit.blockingIntegrityIssueCount,planner:audit.plannerPolicyViolationCount,warnings:forecastWarnings.map(x=>({category:x.category,detail:x.detail}))},
  q2:{review:{id:review.id,status:review.status,purpose:review.learning_purpose,mode:review.effective_mode,due:review.due_date,source:source?.id},
   sourceRoots:source?deriveFailureEpisode(source).rootWeaknesses:[],candidates:q2Candidates,decision,
   scheduleDecisions:shadow.plan14.reviewSchedule.decisions.filter(x=>x.reviewId===522),
   placements:shadow.plan14.reviewSchedule.placements.filter(x=>x.reviewId===522),
   otherTasks:shadow.plan14.plan.flatMap(d=>d.tasks).filter(x=>x.problemId==='PY-2023-Q2'),
   latestAttempts:attempts.filter(a=>a.problem_id==='PY-2023-Q2').map(a=>({id:a.id,date:a.date,purpose:a.learning_purpose,
    mark:a.mark,reference:a.actual_reference_level,graduated:resolvePersistedAttemptLifecycle(a).graduated}))},
  graduationChecks,weekStats};
 await writeFile('outputs/planner-20261009/final-review-report.json',JSON.stringify(report,null,2));
 assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),originalHash);
 console.log(JSON.stringify({blocking:report.audit.blocking,planner:report.audit.planner,graduatedChecked:graduationChecks.length,q2Decision:decision}));
 db.close();
});
