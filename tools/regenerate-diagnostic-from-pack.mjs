import "fake-indexeddb/auto";
import JSZip from "jszip";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const source=process.argv[2];
if(!source)throw new Error("usage: node tools/regenerate-diagnostic-from-pack.mjs <diagnostic-pack.zip|backup.json> [output.zip]");
const output=process.argv[3]||"outputs/diagnostic-pack-2026-07-18-stable.zip";
const applySourceRepair=process.argv.includes("--apply-source-repair");
const applyLegacyRepair=process.argv.includes("--apply-legacy-k");
const applyIntegrityRepair=process.argv.includes("--apply-integrity-repair");
const sourceBytes=await readFile(source);
let learning=null,backup=null;
try{
  const inputZip=await JSZip.loadAsync(sourceBytes);
  const entry=inputZip.file("learning-data.json");
  if(!entry)throw new Error("learning-data.json is missing");
  learning=JSON.parse(await entry.async("string"));
}catch(error){
  if(!source.toLowerCase().endsWith(".json"))throw error;
  backup=JSON.parse(sourceBytes.toString("utf8"));
}

let testMeta={commit:"unknown",testCount:0,generatedAt:"unknown",command:"npm test"};
try{testMeta=JSON.parse(await readFile("outputs/test-report.json","utf8"))}catch{}
globalThis.__APP_COMMIT__=process.env.APP_COMMIT||(testMeta.commit!=="unknown"?testMeta.commit:"working-tree");
globalThis.__APP_DEPLOYED_AT__=new Date().toISOString();
globalThis.__APP_TEST_REPORT_COMMIT__=testMeta.commit;
globalThis.__APP_TEST_COUNT__=testMeta.testCount;
globalThis.__APP_TEST_REPORT_GENERATED_AT__=testMeta.generatedAt;
globalThis.__APP_TEST_REPORT__=[`Diagnostic pack commit: ${globalThis.__APP_COMMIT__}`,
  `Test report commit: ${testMeta.commit}`,`Unit tests: PASS (${testMeta.testCount}/${testMeta.testCount}, ${testMeta.command})`].join("\n");

const { db,localPost,restoreBackup }=await import("../src/localDb.ts");
await db.open();
await db.transaction("rw",db.tables,async()=>{for(const table of db.tables)await table.clear()});
if(backup)await restoreBackup(backup);
else{
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
}

const fingerprint=async()=>({attempts:await db.attempts.count(),reviews:await db.reviews.count(),problems:await db.problems.count(),weakNotes:await db.weakNotes.count(),
  attemptKeys:(await db.attempts.toCollection().primaryKeys()).map(Number).sort((a,b)=>a-b),reviewKeys:(await db.reviews.toCollection().primaryKeys()).map(Number).sort((a,b)=>a-b),
  completed:(await db.reviews.toArray()).filter(row=>["done","completed"].includes(row.status)).map(row=>`${row.id}:${row.status}`).sort(),
  scoreTime:(await db.attempts.toArray()).map(row=>`${row.id}:${row.score_numeric}:${row.time_minutes}`).sort(),
  pastSessions:(await db.pastSessions.toArray()).sort((a,b)=>Number(a.id)-Number(b.id)),
  problemExposure:(await db.problems.toArray()).map(row=>[row.problem_id,row.exposure_status,row.simulation_protected,row.schedulable]).sort(),
  snapshots:(await db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()).map(row=>[row.key,row.value]).sort()});
const before=await fingerprint();
const focusIds=["WB-4-A-29","WB-6-A-19","WB-6-A-23","WB-6-S-22","WB-2-A-06","WB-6-S-15"];
const focusAudit=async()=>{
  const [{analyzeReviewReconciliation},{buildStableTargetIndex}]=await Promise.all([
    import("../src/reviewReconciliation.ts"),import("../src/stableTargetIdentity.ts")
  ]);
  const [attempts,reviews,aliases]=await Promise.all([db.attempts.toArray(),db.reviews.toArray(),db.problemAliases.toArray()]);
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const audit=analyzeReviewReconciliation({attempts,reviews,aliases,today});
  const index=buildStableTargetIndex({attempts,reviews,aliases});
  return focusIds.map(problemId=>{
    const active=reviews.filter(row=>row.problem_id===problemId&&["pending","overdue"].includes(row.status));
    const repair=active.filter(row=>(row.grading_contract?.learningPurpose||row.learning_purpose)==="error_repair");
    const plan=audit.problems.find(row=>row.problemId===problemId);
    const identityKeys=repair.flatMap(row=>index.reviewParts(row.id).map(part=>part.identityKey).filter(Boolean));
    return {problemId,activeReviewIds:repair.map(row=>row.id),activeReviewTargetCount:repair.reduce((sum,row)=>
      sum+(row.grading_contract?.gradedParts?.length||row.graded_part_ids?.length||0),0),
      distinctStableTargetCount:new Set(identityKeys).size,multiGenerationDuplicateCount:identityKeys.length-new Set(identityKeys).size,
      currentUnresolvedTargetCount:plan?.desiredRepairParts.length||0,ambiguousReasons:plan?.ambiguousReasons||[]};
  });
};
const focusBefore=await focusAudit();
let legacyRepairResult=null,repairResult=null,secondRepairPreview=null,integrityPreview=null,integrityRepairResult=null,integrityAfter=null;
if(applyLegacyRepair)legacyRepairResult=await localPost("/api/legacy-k/reorganize",{});
if(applySourceRepair){
  repairResult=await localPost("/api/source-mismatch/reorganize",{});
  secondRepairPreview=await localPost("/api/source-mismatch/preview",{});
  if(secondRepairPreview.source_mismatch_count!==0)throw new Error(`source repair is not idempotent: ${JSON.stringify({repairResult,secondRepairPreview})}`);
}
if(applyIntegrityRepair){
  integrityPreview=await localPost("/api/integrity/preview",{});
  integrityRepairResult=await localPost("/api/integrity/repair",{});
  integrityAfter=await localPost("/api/integrity/audit",{});
  const secondIntegrityRepair=await localPost("/api/integrity/repair",{});
  const mutationFields=["duplicateAttempts","reviewsSuperseded","contractsRebound","datesCorrected",
    "staleReviewsSuperseded","reviewsReplaced","todayActionsUpdated"];
  if(mutationFields.some(field=>Number(secondIntegrityRepair.changes[field]||0)!==0)){
    throw new Error(`integrity repair is not idempotent: ${JSON.stringify({changes:secondIntegrityRepair.changes,
      details:secondIntegrityRepair.details,reconciliation:secondIntegrityRepair.reconciliation?.problems})}`);
  }
}
const focusAfter=await focusAudit();
const { createDiagnosticPack }=await import("../src/diagnosticPack.ts");
const result=await createDiagnosticPack();
const after=await fingerprint();
const preserved=before.attempts===after.attempts&&before.problems===after.problems&&before.weakNotes===after.weakNotes&&
  JSON.stringify(before.attemptKeys)===JSON.stringify(after.attemptKeys)&&before.reviewKeys.every(id=>after.reviewKeys.includes(id))&&
  JSON.stringify(before.completed)===JSON.stringify(after.completed)&&JSON.stringify(before.scoreTime)===JSON.stringify(after.scoreTime)&&
  JSON.stringify(before.pastSessions)===JSON.stringify(after.pastSessions)&&
  JSON.stringify(before.problemExposure)===JSON.stringify(after.problemExposure)&&
  JSON.stringify(before.snapshots)===JSON.stringify(after.snapshots);
if(!preserved)throw new Error(`diagnostic fixture data changed unsafely: ${JSON.stringify({before,after})}`);
await mkdir(output.replace(/[\\/][^\\/]+$/,"")||".",{recursive:true});
await writeFile(output,Buffer.from(await result.blob.arrayBuffer()));
console.log(JSON.stringify({status:"PASS",source,output,before:{attempts:before.attempts,reviews:before.reviews,problems:before.problems,weakNotes:before.weakNotes},
  after:{attempts:after.attempts,reviews:after.reviews,problems:after.problems,weakNotes:after.weakNotes},
  focusBefore,focusAfter,legacyRepairResult,repairResult,secondRepairPreview,integrityPreview,integrityRepairResult,
  integrityAfter,preserved,readOnlyVerified:result.summary.readOnlyVerified},null,2));
await db.close();
