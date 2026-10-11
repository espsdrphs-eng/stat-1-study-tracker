import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import 'fake-indexeddb/auto';
const file=process.env.RANKED_FULL_COPY||'outputs/planner-20261009/production-copy.json';
let bytes;try{bytes=await readFile(file)}catch(e){if(e.code!=='ENOENT')throw e}
const sha=b=>createHash('sha256').update(b).digest('hex');
test('older lossless production COPY: full ranked pool, current audit, idempotency and roundtrip',
 {skip:!bytes&&'lossless copy unavailable'},async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-11T05:00:00Z')});
  const data=JSON.parse(bytes),{db,localGet,localPost,restoreBackup,exportBackup,readCurrentStudyState}=await import('../src/localDb.ts');
  await localGet('/api/bootstrap');await restoreBackup(structuredClone(data));
  const first=await localGet('/api/bootstrap');
  const fingerprint=s=>s.today.tasks.filter(t=>t.ranking&&!t.checked).map(t=>[t.problem_id,t.id,t.stable_session_key,t.transfer_training_key,t.minutes,t.ranking]);
  const rawFacts=async()=>JSON.stringify({attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),sessions:await db.pastSessions.toArray()});
  const factsBefore=await rawFacts();
  const second=await localGet('/api/bootstrap');assert.deepEqual(fingerprint(second),fingerprint(first));
  assert.equal(await rawFacts(),factsBefore,'read-time ranking does not rewrite historical learning facts');
  const readOnly=await readCurrentStudyState();assert.deepEqual(fingerprint(readOnly),fingerprint(first));
  const old=first.adaptiveLearning.plannerShadow.plan14.plan.find(d=>d.date==='2026-10-11')?.tasks||[];
  const ids=['PY-2022-Q2','PY-2022-Q4','PY-2018-Q3','PY-2018-Q5','PY-2023-Q3','PY-2021-Q1','PY-2021-Q3','WB-6-A-19','PY-2016-Q4'];
  const comparisons=ids.map(id=>{
   const active=first.today.tasks.find(t=>t.problem_id===id&&t.ranking&&!t.checked&&!t.stable_session_key);
   const wait=first.today.canonicalStudyPlan.ranked.waiting.find(w=>w.task.problem_id===id);
   return {problem:id,oldRank:old.findIndex(t=>t.problemId===id)+1||null,newRank:active?.ranking.rank||null,
    eligibility:active?'eligible':wait?'waiting':'no current target',reason:active?.why_today||wait?.reason||'no current executable target'};
  });
  const audit=await localPost('/api/integrity/audit',{});
  assert.equal(audit.blockingIntegrityIssueCount,0,JSON.stringify(audit.issues.filter(i=>i.severity==='active')));
  assert.equal(audit.plannerPolicyViolationCount,0);assert.equal(audit.stale,false);
  assert.ok(!first.today.tasks.some(t=>t.ranking&&!t.checked&&t.problem_id==='PY-2016-Q4'&&!t.stable_session_key));
  assert.ok(!first.today.tasks.some(t=>t.ranking&&!t.checked&&t.problem_id==='WB-6-A-19'));
  const queue=fingerprint(first);await db.meta.put({key:'daily_study_minutes',value:'30'});
  assert.deepEqual(fingerprint(await localGet('/api/bootstrap')),queue,'old daily budget cannot hide candidates');
  const exported=await exportBackup();await restoreBackup(exported);
  assert.deepEqual(fingerprint(await localGet('/api/bootstrap')),queue);
  assert.equal(sha(await readFile(file)),sha(bytes),'source export must remain untouched');
  await mkdir('outputs/redesign-20261011',{recursive:true});
  await writeFile('outputs/redesign-20261011/ranked-validation.json',JSON.stringify({
   source:file,sourceSha256:sha(bytes),date:'2026-10-11',latest1011FullExport:'NOT RUN: latest production export unavailable',
   comparisons,top:first.today.tasks.filter(t=>t.ranking&&!t.checked).slice(0,15).map(t=>({id:t.id,problem:t.problem_id,key:t.stable_session_key,rank:t.ranking.rank,minutes:t.minutes,reason:t.why_today})),
   pool:queue.length,waiting:first.today.canonicalStudyPlan.ranked.waiting.length,
   audit:{blocking:audit.blockingIntegrityIssueCount,planner:audit.plannerPolicyViolationCount,stale:audit.stale},
   idempotency:'PASS',roundtrip:'PASS',historyUnchanged:'PASS',budgetIndependence:'PASS'},null,2));
  console.log(JSON.stringify({copy:file,pool:queue.length,comparisons,audit:{blocking:audit.blockingIntegrityIssueCount,planner:audit.plannerPolicyViolationCount}}));
  db.close();
 });
