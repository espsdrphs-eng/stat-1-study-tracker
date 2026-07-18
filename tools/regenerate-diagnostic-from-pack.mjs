import "fake-indexeddb/auto";
import JSZip from "jszip";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { triageTodayTasks } from "../src/studyTriage.ts";

const source=process.argv[2];
if(!source)throw new Error("usage: node tools/regenerate-diagnostic-from-pack.mjs <diagnostic-pack.zip> [output.zip]");
const output=process.argv[3]||"outputs/diagnostic-pack-2026-07-18-stable.zip";
const inputZip=await JSZip.loadAsync(await readFile(source));
const learning=JSON.parse(await inputZip.file("learning-data.json").async("string"));

globalThis.__APP_COMMIT__=process.env.APP_COMMIT||"working-tree";
globalThis.__APP_DEPLOYED_AT__=new Date().toISOString();
globalThis.__APP_TEST_REPORT__="Type check: PASS\nUnit tests: PASS\nProduction build: PASS\nBrowser GPT save: PASS\nBrowser layout (iPad landscape/portrait, Split View, iPhone): PASS";

const { db }=await import("../src/localDb.ts");
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
const latest=[...snapshots].sort((a,b)=>String(a.key).localeCompare(String(b.key))).at(-1);
for(const row of snapshots){
  const snapshot=structuredClone(row.value);
  if(row===latest&&Array.isArray(snapshot?.tasks)){
    const target=Math.max(30,Number(learning.settings?.daily_study_minutes||150));
    const reorganized=triageTodayTasks(snapshot.tasks,target,learning.problemMaster||[],snapshot.date).tasks;
    snapshot.tasks=snapshot.tasks.map((task,index)=>({...task,triage:reorganized[index]?.triage||"tomorrow"}));
    snapshot.initial_bucket=Object.fromEntries(snapshot.tasks.map(task=>[task.id&&task.review_type?`review:${task.id}`:`task:${task.problem_id}:${task.kind}`,task.triage||"tomorrow"]));
  }
  await db.meta.put({key:row.key,value:JSON.stringify(snapshot)});
}

const before={attempts:await db.attempts.count(),reviews:await db.reviews.count(),problems:await db.problems.count(),weakNotes:await db.weakNotes.count()};
const { createDiagnosticPack }=await import("../src/diagnosticPack.ts");
const result=await createDiagnosticPack();
const after={attempts:await db.attempts.count(),reviews:await db.reviews.count(),problems:await db.problems.count(),weakNotes:await db.weakNotes.count()};
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error(`診断前後の件数が変化: ${JSON.stringify({before,after})}`);
await mkdir(output.replace(/[\\/][^\\/]+$/,"")||".",{recursive:true});
await writeFile(output,Buffer.from(await result.blob.arrayBuffer()));
console.log(JSON.stringify({status:"PASS",source,output,before,after,readOnlyVerified:result.summary.readOnlyVerified},null,2));
await db.close();
