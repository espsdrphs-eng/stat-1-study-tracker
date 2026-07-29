import "fake-indexeddb/auto";
import fs from "node:fs/promises";
import {parseExamReferencePack} from "../src/examReferencePack.ts";

const [packPath,backupPath,diagnosticOut]=process.argv.slice(2);
if(!packPath||!backupPath){
  console.error("usage: node tools/audit-reference-pack-persistence.mjs <pack.zip> <backup.json>");
  process.exit(2);
}
const {db,exportBackup,localGet,localPost,restoreBackup}=await import("../src/localDb.ts");
const backup=JSON.parse(await fs.readFile(backupPath,"utf8"));
await localGet("/api/bootstrap");
await restoreBackup(backup);
const before=await exportBackup();
const parsed=await parseExamReferencePack(await fs.readFile(packPath));
const body={data:parsed.data,packHash:parsed.validation.packHash,validation:parsed.validation};
const first=await localPost("/api/exam-reference-pack/import",body);
const afterFirst=await exportBackup();
const second=await localPost("/api/exam-reference-pack/import",body);
const afterSecond=await exportBackup();
const ids=(rows=[])=>rows.map(row=>row.id).sort((a,b)=>Number(a)-Number(b));
const snapshot=(rows=[])=>Object.fromEntries(rows.filter(row=>row.key.startsWith("today-plan-snapshot:"))
  .map(row=>[row.key,row.value]));
const result={
  firstImportUnchanged:first.unchanged,secondImportUnchanged:second.unchanged,
  referenceStatus:(await localGet("/api/bootstrap")).adaptiveLearning.referencePack,
  before:{problems:before.problems.length,attempts:before.attempts.length,reviews:before.reviews.length,
    weakNotes:before.weakNotes.length,pastSessions:before.pastSessions.length},
  afterFirst:{problems:afterFirst.problems.length,attempts:afterFirst.attempts.length,reviews:afterFirst.reviews.length,
    weakNotes:afterFirst.weakNotes.length,pastSessions:afterFirst.pastSessions.length},
  afterSecondProblems:afterSecond.problems.length,
  preservation:{
    attemptKeys:JSON.stringify(ids(before.attempts))===JSON.stringify(ids(afterFirst.attempts)),
    reviewKeys:JSON.stringify(ids(before.reviews))===JSON.stringify(ids(afterFirst.reviews)),
    weakNoteKeys:JSON.stringify(ids(before.weakNotes))===JSON.stringify(ids(afterFirst.weakNotes)),
    pastSessionKeys:JSON.stringify(ids(before.pastSessions))===JSON.stringify(ids(afterFirst.pastSessions)),
    todayPlanSnapshots:JSON.stringify(snapshot(before.meta))===JSON.stringify(snapshot(afterFirst.meta))
  },
  databaseVersion:db.verno
};
if(diagnosticOut){
  const {createDiagnosticPack}=await import("../src/diagnosticPack.ts");
  const diagnostic=await createDiagnosticPack();
  await fs.writeFile(diagnosticOut,Buffer.from(await diagnostic.blob.arrayBuffer()));
  result.diagnosticPack={path:diagnosticOut,readOnlyVerified:diagnostic.summary.readOnlyVerified,
    files:diagnostic.summary.files};
}
console.log(JSON.stringify(result,null,2));
await db.close();
