import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";

const [backupPath] = process.argv.slice(2);
if (!backupPath) {
  throw new Error("usage: node tools/audit-builtin-reference-upgrade.mjs <backup.json>");
}

const { db, exportBackup, localGet, restoreBackup } = await import("../src/localDb.ts");
await restoreBackup(JSON.parse(await readFile(backupPath, "utf8")));
const before = await exportBackup();
const first = await localGet("/api/bootstrap");
const afterFirst = await exportBackup();
const second = await localGet("/api/bootstrap");
const afterSecond = await exportBackup();

const ids = rows => rows.map(row => row.id).sort((a, b) => Number(a) - Number(b));
const snapshots = rows => Object.fromEntries(rows.filter(row =>
  row.key.startsWith("today-plan-snapshot:")
).map(row => [row.key, row.value]));
const core = first.problems.filter(problem => problem.category === "past_exam" && problem.schedulable);
const pastYears = Object.fromEntries([...new Set(core.map(problem =>
  Number(problem.problem_id.slice(3, 7))
))].sort().map(year => [year, core.filter(problem =>
  problem.problem_id.startsWith(`PY-${year}-`)
).length]));

const result = {
  before: {
    problems: before.problems.length,
    attempts: before.attempts.length,
    reviews: before.reviews.length,
    pastSessions: before.pastSessions.length
  },
  afterFirst: {
    problems: afterFirst.problems.length,
    attempts: afterFirst.attempts.length,
    reviews: afterFirst.reviews.length,
    pastSessions: afterFirst.pastSessions.length,
    corePastProblems: core.length,
    pastYears
  },
  afterSecondProblems: afterSecond.problems.length,
  catalogYears: [...new Set(first.adaptiveLearning.pastExamCatalog.map(row => row.year))].sort(),
  referencePack: first.adaptiveLearning.referencePack,
  preservation: {
    attemptKeys: JSON.stringify(ids(before.attempts)) === JSON.stringify(ids(afterFirst.attempts)),
    reviewKeys: JSON.stringify(ids(before.reviews)) === JSON.stringify(ids(afterFirst.reviews)),
    pastSessionKeys: JSON.stringify(ids(before.pastSessions)) === JSON.stringify(ids(afterFirst.pastSessions)),
    todayPlanSnapshots: JSON.stringify(snapshots(before.meta)) === JSON.stringify(snapshots(afterFirst.meta)),
    secondRunIdempotent: afterFirst.problems.length === afterSecond.problems.length
  },
  databaseVersion: db.verno
};

console.log(JSON.stringify(result, null, 2));
await db.close();
