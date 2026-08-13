import test from "node:test";
import assert from "node:assert/strict";
import {postponedDueDate,scheduleActiveReviews} from "../src/reviewScheduling.ts";

test("復習を今日の最後・翌日・指定日へ送れる",()=>{
  assert.equal(postponedDueDate("2026-07-04",{days:0}),"2026-07-04");
  assert.equal(postponedDueDate("2026-07-04",{days:1}),"2026-07-05");
  assert.equal(postponedDueDate("2026-07-04",{days:7}),"2026-07-11");
  assert.equal(postponedDueDate("2026-07-04",{due_date:"2026-07-20"}),"2026-07-20");
});

test("過去日は今日へ、日数は30日を上限にする",()=>{
  assert.equal(postponedDueDate("2026-07-04",{due_date:"2026-07-01"}),"2026-07-04");
  assert.equal(postponedDueDate("2026-07-04",{days:90}),"2026-08-03");
});

const review=(id,dates,minutes=12)=>({id,problem_id:`WB-7-A-${String(id).padStart(2,"0")}`,
  due_date:dates.preferred,earliest_date:dates.earliest,preferred_date:dates.preferred,latest_date:dates.latest,
  status:"pending",review_type:"main_calc_retry",interval_days:2,generated_from_attempt_id:id,
  grading_contract:{estimatedMinutes:minutes}});

test("review scheduler is minute-capacity based, window-safe, and idempotent",()=>{
  const rows=[1,2,3].map(id=>review(id,{earliest:"2026-08-14",preferred:"2026-08-14",latest:"2026-08-16"}));
  const first=scheduleActiveReviews({reviews:rows,startDate:"2026-08-14",days:3,dailyCapacity:150});
  const second=scheduleActiveReviews({reviews:rows,startDate:"2026-08-14",days:3,dailyCapacity:150});
  assert.deepEqual(second,first);
  assert.equal(first.placements.filter(row=>row.date==="2026-08-14").length,3);
  assert.equal(first.placements.every(row=>row.date<=row.latestDate),true);
  assert.deepEqual(first.capacityConflicts,[]);
});

test("impossible window capacity is an explicit conflict and never a silent late placement",()=>{
  const rows=[1,2].map(id=>review(id,{earliest:"2026-08-14",preferred:"2026-08-14",latest:"2026-08-14"},30));
  const result=scheduleActiveReviews({reviews:rows,startDate:"2026-08-14",days:1,dailyCapacity:150,repairBudgetMinutes:45});
  assert.equal(result.placements.length,1);
  assert.equal(result.capacityConflicts.length,1);
  assert.equal(result.placements.some(row=>row.date>row.latestDate),false);
});
