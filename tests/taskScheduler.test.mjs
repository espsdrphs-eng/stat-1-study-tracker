import test from "node:test";
import assert from "node:assert/strict";
import { chooseDateWithinWindow, pendingDuplicate, quotaCandidatesWithinCapacity, taskDeduplicationKey, weeklySoftQuota } from "../src/taskScheduler.ts";

test("automatic transition task has an idempotent deduplication key",()=>{
  const key=taskDeduplicationKey({problemId:"WB-6-A-20",learningPurpose:"error_repair",assessmentTiming:"delayed_retrieval",sourceAttemptId:175,policyVersion:"v1"});
  assert.equal(pendingDuplicate([{problem_id:"WB-6-A-20",title:"",kind:"",reason:"",mode:"",minutes:5,load:1,status:"pending",deduplication_key:key}],key)?.problem_id,"WB-6-A-20");
});

test("capacity moves a task inside its scheduling window",()=>{
  const result=chooseDateWithinWindow({window:{earliestDate:"2026-07-19",preferredDate:"2026-07-20",latestDate:"2026-07-22"},minutes:20,dailyCapacity:30,scheduledMinutes:{"2026-07-20":30,"2026-07-19":25,"2026-07-21":5}});
  assert.equal(result,"2026-07-21");
});

test("weekly quotas are soft and a past exam satisfies timed and scan evidence without duplicate tasks",()=>{
  const status=weeklySoftQuota({attempts:[],pastSessions:[{date:"2026-07-18",session_type:"past_exam",selected_questions:"1,2,3"}],weekStart:"2026-07-13"});
  assert.equal(status.deficits.timedFull,false);
  assert.equal(status.deficits.scan5,false);
  const candidates=quotaCandidatesWithinCapacity({status,remainingMinutes:10});
  assert.deepEqual(candidates.map(row=>row.kind),[]);
});
