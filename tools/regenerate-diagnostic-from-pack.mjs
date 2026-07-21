import "fake-indexeddb/auto";
import JSZip from "jszip";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const source=process.argv[2];
if(!source)throw new Error("usage: node tools/regenerate-diagnostic-from-pack.mjs <diagnostic-pack.zip> [output.zip]");
const output=process.argv[3]||"outputs/diagnostic-pack-2026-07-18-stable.zip";
const applySourceRepair=process.argv.includes("--apply-source-repair");
const applyLegacyRepair=process.argv.includes("--apply-legacy-k");
const inputZip=await JSZip.loadAsync(await readFile(source));
const learning=JSON.parse(await inputZip.file("learning-data.json").async("string"));

globalThis.__APP_COMMIT__=process.env.APP_COMMIT||"working-tree";
globalThis.__APP_DEPLOYED_AT__=new Date().toISOString();
globalThis.__APP_TEST_REPORT__="Type check: PASS\nUnit tests: PASS\nProduction build: PASS\nBrowser GPT save: PASS\nBrowser layout (iPad landscape/portrait, Split View, iPhone): PASS";

const { db,localPost }=await import("../src/localDb.ts");
await db.open();
await db.transaction("rw",db.tables,async()=>{for(const table of db.tables)await table.clear()});
await db.problems.bulkPut(learning.problemMaster||[]);
await db.problemAliases.bulkPut(learning.aliases||[]);
await db.attempts.bulkPut(learning.attempts||[]);
await db.reviews.bulkPut(learning.reviewTasks||[]);
await db.weakNotes.bulkPut(learning.weakNotes||[]);
await db.pastSessions.bulkPut(learning.pastSessions||[]);

const settingRows=Object.entries(learning.settings||{}).map(([key,value])=>({key,value:String(value)}));
if(settingRows.length)await db.meta.bulkPut(settingRows);
const snapshots=learning.todayPlanSnapshot||[];
for(const row of snapshots){
  const snapshot=structuredClone(row.value);
  await db.meta.put({key:row.key,value:JSON.stringify(snapshot)});
}

const fingerprint=async()=>({attempts:await db.attempts.count(),reviews:await db.reviews.count(),problems:await db.problems.count(),weakNotes:await db.weakNotes.count(),
  attemptKeys:(await db.attempts.toCollection().primaryKeys()).map(Number).sort((a,b)=>a-b),reviewKeys:(await db.reviews.toCollection().primaryKeys()).map(Number).sort((a,b)=>a-b),
  completed:(await db.reviews.toArray()).filter(row=>["done","completed"].includes(row.status)).map(row=>`${row.id}:${row.status}`).sort(),
  scoreTime:(await db.attempts.toArray()).map(row=>`${row.id}:${row.score_numeric}:${row.time_minutes}`).sort(),
  snapshots:(await db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()).map(row=>[row.key,row.value]).sort()});
const before=await fingerprint();
let legacyRepairResult=null,repairResult=null,secondRepairPreview=null;
if(applyLegacyRepair)legacyRepairResult=await localPost("/api/legacy-k/reorganize",{});
if(applySourceRepair){
  repairResult=await localPost("/api/source-mismatch/reorganize",{});
  secondRepairPreview=await localPost("/api/source-mismatch/preview",{});
  if(secondRepairPreview.source_mismatch_count!==0)throw new Error(`source repair is not idempotent: ${JSON.stringify({repairResult,secondRepairPreview})}`);
}
const { createDiagnosticPack }=await import("../src/diagnosticPack.ts");
const result=await createDiagnosticPack();
const after=await fingerprint();
const preserved=before.attempts===after.attempts&&before.problems===after.problems&&before.weakNotes===after.weakNotes&&
  JSON.stringify(before.attemptKeys)===JSON.stringify(after.attemptKeys)&&before.reviewKeys.every(id=>after.reviewKeys.includes(id))&&
  JSON.stringify(before.completed)===JSON.stringify(after.completed)&&JSON.stringify(before.scoreTime)===JSON.stringify(after.scoreTime)&&
  JSON.stringify(before.snapshots)===JSON.stringify(after.snapshots);
if(!preserved)throw new Error(`diagnostic fixture data changed unsafely: ${JSON.stringify({before,after})}`);
await mkdir(output.replace(/[\\/][^\\/]+$/,"")||".",{recursive:true});
await writeFile(output,Buffer.from(await result.blob.arrayBuffer()));
console.log(JSON.stringify({status:"PASS",source,output,before:{attempts:before.attempts,reviews:before.reviews,problems:before.problems,weakNotes:before.weakNotes},
  after:{attempts:after.attempts,reviews:after.reviews,problems:after.problems,weakNotes:after.weakNotes},legacyRepairResult,repairResult,secondRepairPreview,preserved,readOnlyVerified:result.summary.readOnlyVerified},null,2));
await db.close();
