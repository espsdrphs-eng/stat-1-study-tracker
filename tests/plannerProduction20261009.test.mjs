import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';

// Optional, lossless production COPY, never the user's live IndexedDB.
const path=process.env.PLANNER_PRODUCTION_COPY || 'outputs/planner-20261009/production-copy.json';
let data;
try { data=JSON.parse(await readFile(path,'utf8')); } catch(error) {
  if(error.code!=='ENOENT')throw error;
}
test('10/9 production copy: repair truth, protected session and reload/roundtrip',
  {skip:!data&&'lossless production copy unavailable'},async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-09T05:00:00Z')});
  const {db,localGet,localPost,restoreBackup,exportBackup}=await import('../src/localDb.ts');
  await localGet('/api/bootstrap');
  await restoreBackup(structuredClone(data));
  // Also exercise the upgrade path with the actual saved morning snapshot.
  const original=data.meta.find(r=>r.key==='today-plan-snapshot:2026-10-09');
  if(original)await db.meta.put(original);
  const state=await localGet('/api/bootstrap');
  const audit=await localPost('/api/integrity/audit',{});
  const summary={today:state.today.tasks.map(t=>({problem:t.problem_id,id:t.id,triage:t.triage,
    minutes:t.minutes,key:t.stable_session_key,source:t.repair_lineage?.sourceAttemptId,checked:t.checked})),
    audit:{blocking:audit.blockingIntegrityIssueCount,planner:audit.plannerPolicyViolationCount,
      active:audit.issues.filter(i=>i.severity==='active').map(i=>({category:i.category,detail:i.detail}))},
    waiting:state.adaptiveLearning.plannerShadow.plan14.reviewSchedule.decisions.filter(d=>[455,456,523,522,511,500,501].includes(d.reviewId)),
    plan:state.adaptiveLearning.plannerShadow.plan14.plan.map(d=>({date:d.date,total:d.totalMinutes,
      tasks:d.tasks.map(t=>({id:t.reviewId,problem:t.problemId,source:t.repairLineage?.sourceAttemptId,
        root:t.repairLineage?.rootWeaknessId,year:t.pastExamYear,key:t.stableSessionKey,minutes:t.minutes}))}))};
  await mkdir('outputs/planner-20261009',{recursive:true});
  await writeFile('outputs/planner-20261009/runtime.json',JSON.stringify(summary,null,2));
  console.log('production-copy current',JSON.stringify(summary));
  assert.ok(!state.today.tasks.some(t=>!t.checked&&t.problem_id==='PY-2016-Q4'&&!t.past_exam_year),
    'old source Attempt214 must not recreate same-problem repair after scoped success');
  assert.equal(audit.counts.protected_past_exam_scheduled_without_release,0);
  assert.equal(audit.counts.duplicate_past_exam_session,0);
  assert.equal(audit.counts.current_planner_eligibility_mismatch,0);
  assert.equal(audit.counts.formal_plan_current_projection_mismatch,0);
  const fingerprint=s=>s.today.tasks.filter(t=>!t.checked).map(t=>[t.id,t.problem_id,t.stable_session_key,t.triage,t.minutes]);
  assert.deepEqual(fingerprint(await localGet('/api/bootstrap')),fingerprint(state));
  const exported=await exportBackup();await restoreBackup(exported);
  assert.deepEqual(fingerprint(await localGet('/api/bootstrap')),fingerprint(state));
  db.close();
});
