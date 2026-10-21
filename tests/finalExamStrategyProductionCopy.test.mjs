import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import "fake-indexeddb/auto";

const {db,localGet,localPost,restoreBackup,exportBackup}=await import("../src/localDb.ts");

test("9/29 production copy keeps 2022 clean exam ahead of old maintenance and has a clean current audit",
  {skip:!process.env.STAT_STUDY_FIXTURE},async()=>{
    const raw=JSON.parse(await readFile(process.env.STAT_STUDY_FIXTURE,"utf8"));
    assert.equal(raw.exported_at,"2026-09-29T04:27:07.083Z");
    await restoreBackup(raw);
    const state=await localGet("/api/bootstrap");
    const audit=await localPost("/api/integrity/audit",{});
    const current=state.today.tasks.filter(row=>!row.checked);
    const planner=state.adaptiveLearning.plannerShadow;
    const forecast=Object.fromEntries([7,14,30].map(days=>{
      const summary=planner[`plan${days}`];
      return [days,{timed:summary.counts.timed,pastExam:summary.counts.pastExam,
        weeklyViolations:summary.weeklyMinimumViolations}];
    }));
    console.log(JSON.stringify({current:current.map(row=>({id:row.problem_id,title:row.title,year:row.past_exam_year,
      category:row.today_category,triage:row.triage,minutes:row.minutes,hardBlocker:row.hard_blocker,
      role:row.past_exam_year_role})),forecast,audit:{blocking:audit.blockingIntegrityIssueCount,
      planner:audit.plannerPolicyViolationCount,active:audit.issues.filter(row=>row.severity==="active")}}));
    assert.equal(audit.blockingIntegrityIssueCount,0);
    assert.equal(audit.plannerPolicyViolationCount,0);
    // The ranked Planner replaced the old exam-first daily-slot policy. Keep
    // clean 2022 ahead of exposed session candidates without forcing it ahead
    // of qualified major repairs or reintroducing a calendar/quota admission.
    const firstSession=current.find(row=>row.stable_session_key&&row.past_exam_year);
    assert.equal(firstSession?.past_exam_year,2022);
    assert.equal(firstSession?.today_category,"exam_practice");
    assert.ok(!current.some(row=>row.past_exam_year===2023&&row.stable_session_key));
    assert.equal(current[0]?.ranking?.rank,1);
    assert.ok(!current.some(row=>row.problem_id==="WB-5-A-21"&&row.triage==="must"));
    // Legacy shadow allocation remains diagnostic; its fixed weekly ratios
    // are not eligibility rules for the current value-ranked candidate pool.
    for(const days of [7,14,30])assert.ok(Array.isArray(forecast[days].weeklyViolations));
    const previousIds=(await db.pastSessions.toArray()).map(row=>row.id);
    const before=await exportBackup();
    await restoreBackup(before);
    const again=await localGet("/api/bootstrap");
    const second=await localPost("/api/integrity/repair",{});
    assert.equal(again.today.tasks.find(row=>!row.checked)?.stable_session_key,current[0]?.stable_session_key);
    assert.deepEqual((await db.pastSessions.toArray()).map(row=>row.id),previousIds);
    assert.ok(Object.values(second.changes).every(value=>typeof value!=="number"||value===0),JSON.stringify(second.changes));
  });
