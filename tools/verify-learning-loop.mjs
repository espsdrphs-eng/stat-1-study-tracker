// Read-only source fixture; all reconciliation runs in isolated IndexedDB.
import "fake-indexeddb/auto";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import assert from "node:assert/strict";
const source=process.argv[2];
if(!source)throw new Error("usage: node tools/verify-learning-loop.mjs <backup.json> [--verify]");
const backup=JSON.parse(await readFile(source,"utf8"));
const RealDate=Date;
const fixtureDay=process.env.ACCEPTANCE_DATE||[backup.exported_at.slice(0,10),...backup.attempts.map(a=>a.date)].sort().at(-1);
globalThis.Date=class extends RealDate{
  constructor(...args){super(...(args.length?args:[`${fixtureDay}T12:00:00+09:00`]));}
  static now(){return new RealDate(`${fixtureDay}T12:00:00+09:00`).getTime();}
};
const {db,restoreBackup,localGet,localPost,exportBackup}=await import("../src/localDb.ts");
await restoreBackup(backup);
const repair=await localPost("/api/integrity/repair",{});
await localPost("/api/today/recalculate",{});
const firstSnapshot=(await db.meta.get(`today-plan-snapshot:${fixtureDay}`)).value;
const secondReplan=await localPost("/api/today/recalculate",{});
assert.equal(secondReplan.changes,0,JSON.stringify(secondReplan));
assert.equal((await db.meta.get(`today-plan-snapshot:${fixtureDay}`)).value,firstSnapshot);
const state=await localGet("/api/bootstrap");
const fullAudit=await localPost("/api/integrity/audit",{});
const sessions=state.pastSessions.map(s=>({id:s.id,year:s.year,state:s.session_state,kind:s.session_kind,
  selected:s.selected_timed_attempt_ids,scores:s.questions.filter(q=>q.completed).map(q=>q.actualScore),
  solve:s.selected_solve_minutes,elapsed:s.session_elapsed_minutes,selection:s.selection_success_count}));
const exportData=await exportBackup();
const exportedAudit=JSON.parse(exportData.meta.find(m=>m.key==="integrity_audit_summary")?.value||"null");
const report={source,sessions,readiness:state.dashboard.readiness,kpis:state.dashboard.kpis,
  coach:{stale:state.coach.stale,newAttemptCount:state.coach.newAttemptCount,needsTextRefresh:state.coach.needsTextRefresh,source:state.coach.source},
  repairs:state.adaptiveLearning.pastExamRepairCandidates,plan:state.today.canonicalStudyPlan,
  audit:state.masterStatus.integrity_summary,exportedAuditDate:exportedAudit?.generatedAt,
  issues:fullAudit.issues.filter(i=>i.severity!=="history"),changes:repair.changes};
report.forecasts=[7,14,30].map(days=>{
  const plan=state.adaptiveLearning.plannerShadow[`plan${days}`];
  return {days,weeks:Array.from({length:Math.ceil(days/7)},(_,i)=>{
    const tasks=plan.plan.slice(i*7,i*7+7).flatMap(d=>d.tasks).filter(t=>!t.requiresUserSelection);
    const total=tasks.reduce((sum,t)=>sum+t.minutes,0),exam=tasks.filter(t=>t.todayCategory==="exam_practice")
      .reduce((sum,t)=>sum+t.minutes,0);
    return {week:i+1,minutes:total,examMinutes:exam,share:total?exam/total:null,
      timedSessions:tasks.filter(t=>t.minutes===90&&t.sessionProblemIds?.length===5).length};
  })};
});
await mkdir("outputs",{recursive:true});
await writeFile("outputs/learning-loop-acceptance.json",JSON.stringify(report,null,2));
console.log(JSON.stringify({sessions,readiness:report.readiness,issues:report.issues,exportedAuditDate:report.exportedAuditDate,
  coach:report.coach,repairKinds:report.repairs.map(r=>({source:r.sourceAttemptId,root:r.conceptId,kind:r.repairKind,required:r.required})),
  primary:report.plan.primaryAction?.title},null,2));
if(process.argv.includes("--verify")){
  assert.equal(report.audit.blockingIntegrityIssueCount,0);
  assert.equal(report.audit.plannerPolicyViolationCount,0);
  assert.equal(report.audit.stale,false);
  assert.equal(exportedAudit.sourceStateVersion,report.audit.sourceStateVersion);
  assert.ok(exportedAudit.generatedAt.slice(0,10)>=backup.exported_at.slice(0,10));
  const selected=report.readiness.evidence.selectedThree;
  const actual=sessions.find(s=>s.year===2019);
  assert.deepEqual(actual.scores,[58,78,55]);
  assert.equal(actual.state,"completed");
  assert.ok(Math.abs(selected.sessions.find(s=>s.year===2019).score-191/3)<1e-8);
  const afterCutoff=backup.attempts.filter(a=>a.id>Number(state.coach.current?.evidenceCutoffAttemptId||0)&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id);
  if(afterCutoff.length)assert.equal(state.coach.stale,true);
  if(fixtureDay==="2026-09-16"){
    const latest=sessions.find(s=>s.year===2021);
    assert.deepEqual(latest.scores,[50,55,52]);assert.equal(latest.solve,105);assert.equal(latest.elapsed,115);
    assert.equal(latest.selection,3);assert.equal(latest.state,"completed");
    assert.equal(selected.evidenceCount,3);assert.equal(selected.numerator,486);assert.equal(selected.denominator,9);
    assert.equal(report.readiness.evidence.selection.denominator,3);
    assert.equal(report.readiness.evidence.timed.numerator,1);assert.equal(report.readiness.evidence.timed.denominator,3);
    assert.equal(state.coach.needsTextRefresh,true);assert.equal(state.coach.source,"local_provisional");
    assert.equal(state.coach.display.level.value,state.dashboard.kpis.examReadiness.level);
    for(const key of ["selectedThree","selection","timed","transfer","unseen","repeatedMajor"]){
      assert.ok(Array.isArray(report.readiness.evidence[key].eligibleEvidenceIds),key);
      assert.ok("missingEvidenceReason" in report.readiness.evidence[key],key);
    }
  }
  assert.equal(state.today.currentTask?.problem_id,state.today.canonicalStudyPlan.primaryAction?.problem_id);
  const requiredWhitebook=report.repairs.filter(r=>r.required&&r.repairKind==="whitebook");
  for(const r of requiredWhitebook){
    assert.equal(r.matchConfidence,"high");
    for(const key of ["sourceAttemptId","sourceProblemId","rootWeaknessId","matchReason"])assert.ok(r[key],key);
    assert.ok(r.sourceFindingIds.length&&r.matchedSkillIds.length&&r.whitebookProblemIds.length);
  }
  for(const year of [2018,2019]){
    assert.equal(sessions.filter(s=>s.year===year).length,1);
    assert.equal(sessions.find(s=>s.year===year).state,"completed");
    assert.equal(report.plan.examPractice.some(t=>t.past_exam_year===year&&t.minutes===90),false);
  }
  for(const original of backup.attempts){
    const after=exportData.attempts.find(a=>a.id===original.id);assert.ok(after,"raw Attempt retained");
    for(const key of ["score_numeric","date","time_minutes","problem_id","graded_findings"])
      assert.deepEqual(after[key],original[key],`Attempt ${original.id} ${key} preserved`);
  }
  for(const original of backup.reviews)assert.ok(exportData.reviews.some(r=>r.id===original.id),"Review history retained");
  const second=await localPost("/api/integrity/repair",{});
  assert.ok(Object.values(second.changes).every(n=>!n),JSON.stringify(second.changes));
  const before=state.today.canonicalStudyPlan.sourceStateVersion;
  await restoreBackup(exportData);
  const roundtrip=await localGet("/api/bootstrap");
  assert.equal(roundtrip.today.canonicalStudyPlan.sourceStateVersion,before);
  assert.deepEqual(roundtrip.dashboard.readiness,state.dashboard.readiness);
  const roundtripAudit=await localPost("/api/integrity/audit",{});
  assert.equal(roundtripAudit.blockingIntegrityIssueCount,0);assert.equal(roundtripAudit.plannerPolicyViolationCount,0);
  console.log(JSON.stringify({blocking:report.audit.blockingIntegrityIssueCount,planner:report.audit.plannerPolicyViolationCount,
    advisories:report.audit.learningAdvisoryCount,forecasts:report.forecasts}));
  console.log("latest-data, audit, idempotency, export/restore: PASS");
}
db.close();
