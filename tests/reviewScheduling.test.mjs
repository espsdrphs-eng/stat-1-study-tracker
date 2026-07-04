import test from "node:test";
import assert from "node:assert/strict";
import { postponedDueDate } from "../src/reviewScheduling.ts";

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
