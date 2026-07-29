import fs from "node:fs/promises";
import {
  buildPastExamCatalog,enrichReconciledLinks,parseExamReferencePack,reconcileExamReferencePack
} from "../src/examReferencePack.ts";
import {analyzeConceptWeaknesses,buildPastExamRepairCandidates} from "../src/conceptWeakness.ts";
import {buildAdaptivePlannerShadow} from "../src/adaptivePlanner.ts";
import {parseProblemMasterPayload} from "../src/masterData.ts";

const [packPath,masterPath,backupPath]=process.argv.slice(2);
if(!packPath||!masterPath||!backupPath){
  console.error("usage: node tools/audit-adaptive-reference-pack.mjs <pack.zip> <problem_master.json> <backup.json>");
  process.exit(2);
}
const [packBytes,masterRaw,backupRaw]=await Promise.all([
  fs.readFile(packPath),fs.readFile(masterPath,"utf8"),fs.readFile(backupPath,"utf8")
]);
const masterRawJson=JSON.parse(masterRaw),master=parseProblemMasterPayload(masterRawJson),backup=JSON.parse(backupRaw);
const parsed=await parseExamReferencePack(packBytes);
const reconciliation=reconcileExamReferencePack({data:parsed.data,problems:master.problems||[],
  aliases:backup.problemAliases||[],attempts:backup.attempts||[],pastSessions:backup.pastSessions||[]});
const data={...parsed.data,whitebookLinks:enrichReconciledLinks(parsed.data,reconciliation)};
const record={packHash:parsed.validation.packHash,importedAt:new Date().toISOString(),
  shadowStartedAt:"2026-07-15T00:00:00.000Z",plannerMode:"shadow",validation:parsed.validation,reconciliation,data};
const catalog=buildPastExamCatalog({record,sessions:backup.pastSessions||[],exposureOverrides:{}});
const weaknesses=analyzeConceptWeaknesses({record,problems:master.problems||[],attempts:backup.attempts||[],
  reviews:backup.reviews||[],weakNotes:backup.weakNotes||[],today:"2026-07-29"});
const meta=new Map((backup.meta||[]).map(row=>[row.key,row.value]));
const snapshot=JSON.parse(meta.get("today-plan-snapshot:2026-07-29")||"{}");
const planner=buildAdaptivePlannerShadow({record,catalog,weaknesses,problems:master.problems||[],
  attempts:backup.attempts||[],reviews:backup.reviews||[],pastSessions:backup.pastSessions||[],
  currentTasks:snapshot.tasks||[],today:"2026-07-29",examDate:meta.get("exam_date")||"2026-11-15",
  targetMinutes:Number(meta.get("daily_study_minutes")||150)});
const output={
  validation:parsed.validation,
  manifestCounts:parsed.data.manifest.counts,
  reconciliation:{...reconciliation,pastExamRows:undefined,whitebookRows:undefined},
  liveCounts:{problems:(master.problems||[]).length,attempts:(backup.attempts||[]).length,
    reviews:(backup.reviews||[]).length,weakNotes:(backup.weakNotes||[]).length,pastSessions:(backup.pastSessions||[]).length},
  exposureCounts:Object.fromEntries([...new Set(catalog.map(row=>row.exposure))].map(state=>[state,catalog.filter(row=>row.exposure===state).length])),
  weaknessCounts:Object.fromEntries([...new Set(weaknesses.map(row=>row.state))].map(state=>[state,weaknesses.filter(row=>row.state===state).length])),
  topConcepts:weaknesses.slice(0,10).map(row=>({id:row.conceptId,state:row.state,
    opportunities:row.independentOpportunities,failures:row.independentFailures,priority:row.priorityScore})),
  repairCandidates:buildPastExamRepairCandidates({record,sessions:backup.pastSessions||[],attempts:backup.attempts||[],conceptWeaknesses:weaknesses}),
  planner:{phase:planner.phase,daysRemaining:planner.daysRemaining,legacy30:planner.legacy30,
    plan14:planner.plan14.counts,plan30:planner.plan30.counts,
    violations14:planner.plan14.weeklyMinimumViolations,violations30:planner.plan30.weeklyMinimumViolations,
    dailyCapacityViolations30:planner.plan30.dailyCapacityViolations,
    activationEligible:planner.activationEligible,activationBlockers:planner.activationBlockers}
};
console.log(JSON.stringify(output,null,2));
