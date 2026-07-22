import JSZip from "jszip";
import type { Table } from "dexie";
import { db } from "./localDb.ts";
import { APP_BUILD_VERSION, APP_SCHEMA_VERSION, DB_NAME, DB_VERSION } from "./dbSchema.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { buildReviewGradingPrompt } from "./gradingPrompt.ts";
import { metadataQuality } from "./metadataQuality.ts";
import { getSheetType, resolveReviewCard, type ResolvedReviewCard } from "./reviewCardResolver.ts";
import { LEARNING_POLICY_VERSION, resolveLearningPolicy } from "./learningPolicyResolver.ts";
import { simulateThirtyDays } from "./learningSimulation.ts";
import { analyzeLegacyKReorganization } from "./legacyKRepair.ts";
import { classifyKPolicyValidity } from "./legacyKPolicy.ts";
import { analyzeSourceMismatchRepair, resolveReviewOrigin } from "./reviewOrigin.ts";
import { deriveExposure, scanMetrics, sessionStudyMinutes, simulateScanPlan, validatePastExamSession } from "./pastExamWorkflow.ts";
import type { Attempt, Problem, ProblemAlias, ProblemRelation, Review, TodayPlanSnapshot } from "./types.ts";

type JsonRecord=Record<string,unknown>;
type FingerprintEntry={count:number;primaryKeyDigest:string};
type DatabaseFingerprint={tables:Record<string,FingerprintEntry>;todayPlanSnapshots:Record<string,string>};

const EXCLUDED_KEYS=new Set([
  "blob","fileBlob","pdfBlob","image","imageBlob","answerImage","answer_image",
  "memo","source_text","raw_gpt_text","rawGptText"
]);
const SETTINGS_KEYS=new Set([
  "exam_date","daily_study_minutes","problem_master_version","problem_master_updated_at",
  "problem_aliases_version","problem_aliases_updated_at","stable_release","last_migration",
  "last_migration_result","last_migration_at","review_rebuild_summary","legacy_k_reorganization_summary","source_mismatch_reorganization_summary"
]);

function sanitize(value:unknown):unknown{
  if(value instanceof Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value)) return "[binary excluded]";
  if(Array.isArray(value)) return value.map(sanitize);
  if(value&&typeof value==="object") return Object.fromEntries(Object.entries(value as JsonRecord)
    .filter(([key])=>!EXCLUDED_KEYS.has(key))
    .map(([key,item])=>[key,sanitize(item)]));
  return value;
}

function stableStringify(value:unknown){
  const normalize=(item:unknown):unknown=>{
    if(Array.isArray(item)) return item.map(normalize);
    if(item&&typeof item==="object") return Object.fromEntries(Object.entries(item as JsonRecord)
      .sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,normalize(row)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

async function digest(value:string){
  if(globalThis.crypto?.subtle){
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  }
  let hash=2166136261;
  for(const char of value) hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return `fnv1a-${(hash>>>0).toString(16).padStart(8,"0")}`;
}

async function tableFingerprint(table:Table):Promise<FingerprintEntry>{
  const keys=(await table.toCollection().primaryKeys()).map(key=>stableStringify(key)).sort();
  return {count:keys.length,primaryKeyDigest:await digest(keys.join("\n"))};
}

async function databaseFingerprint():Promise<DatabaseFingerprint>{
  const tables:Record<string,FingerprintEntry>={};
  for(const table of [...db.tables].sort((a,b)=>a.name.localeCompare(b.name))) tables[table.name]=await tableFingerprint(table);
  const snapshots=await db.meta.where("key").startsWith("today-plan-snapshot:").toArray();
  const todayPlanSnapshots:Record<string,string>={};
  for(const row of snapshots) todayPlanSnapshots[row.key]=await digest(row.value);
  return {tables,todayPlanSnapshots};
}

function expectedProblemMeta(problemId:string){
  const white=problemId.match(/^WB-(\d+)-([AS])-(\d+)$/);
  if(white) return {type:white[2],chapter:Number(white[1]),problemNumber:Number(white[3]),displayLabel:`第${Number(white[1])}章${white[2]}問${Number(white[3])}`};
  const past=problemId.match(/^PY-(\d{4})-Q(\d+)$/);
  return past?{type:"past_exam",chapter:null,problemNumber:Number(past[2]),displayLabel:`${past[1]}年問${Number(past[2])}`}:null;
}

function errorsFor(attempt?:Attempt){
  const raw=attempt?.error_types?.length?attempt.error_types:[attempt?.primary_error_type||attempt?.error_type||"none"];
  const errors=[...new Set(raw.map(String).filter(Boolean))];
  return errors.length?errors:["none"];
}

function buildPromptAudit(review:Review,card:ResolvedReviewCard){
  // Production cards always carry the stored contract/prescription. The fallback only supports
  // legacy diagnostic fixtures and never mutates or persists a task.
  const prescription=card.prescription||resolveLearningPolicy({problemId:card.canonicalProblemId,source:{
    mode:card.effectiveMode,review_scope:card.effectiveReviewScope,targeted_parts:card.targetedParts,
    error_types:card.errorTypes,assessment_timing:review.assessment_timing||"delayed_retrieval",
    learning_purpose:review.learning_purpose||"error_repair"}});
  const screenConditions=card.completionConditions.value;
  const scope=card.effectiveReviewScope;
  const prompt=buildReviewGradingPrompt({
    reviewId:review.id,problemId:card.canonicalProblemId,title:card.displayLabel,theme:card.theme,
    date:new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(new Date()),mode:card.effectiveMode,
    previousDate:card.targetAttempt?.date,previousScore:card.targetAttempt?.score_text||card.targetAttempt?.score_label,
    previousErrors:card.errorTypes,previousErrorPoint:card.targetAttempt?.error_point,
    previousNextAction:card.targetAttempt?.next_action,previousImprovementGuidance:card.targetAttempt?.improvement_guidance,
    previousRequiredDerivation:card.targetAttempt?.required_derivation,reviewMethod:review.review_method||card.reviewMethodLabel,
    reviewInstruction:review.review_instruction,reviewSteps:review.review_steps,requiresFullAnswer:card.effectiveMode==="full",
    linkedSProblemIds:review.linked_s_problem_ids,timeMinutes:card.estimatedMinutes,allowedReferenceLevel:review.allowed_reference_level,
    actualReferenceLevel:review.actual_reference_level,referenceClosedReproduction:review.reference_closed_reproduction,
    reviewScope:scope,targetedParts:card.targetedParts,completionConditions:screenConditions,
    allowedErrorTypes:card.allowedErrorTypes,requiresKEvidence:card.requiresKEvidence,
    learningPurpose:prescription.learningPurpose,learningStage:prescription.learningStage,
    assessmentTiming:prescription.assessmentTiming,targetKind:prescription.targetKind,
    gradingContract:card.gradingContract,problemContext:card.problemContext,
  });
  const warnings:Array<{code:string;message:string}>=[];
  const consistencyWarnings=card.consistencyWarnings.map(item=>({code:item.code,message:item.message}));
  if(scope==="targeted_patch"&&/骨格全体（方針|骨格8項目すべて/.test(prompt)) warnings.push({
    code:"targeted_patch_requires_full_skeleton",message:"画面は局所補修ですが、生成プロンプトは骨格8項目すべてを採点対象にしています。"
  });
  if(!screenConditions.every(condition=>prompt.includes(condition))) warnings.push({
    code:"prompt_scope_wider_than_screen",message:"画面の完了条件より、プロンプトの採点項目が広い可能性があります。"
  });
  if(scope==="targeted_patch"&&!card.allowedErrorTypes.includes("K")&&!prompt.includes("指定範囲外の空欄や未記入を誤りの根拠にしない")) warnings.push({
    code:"out_of_scope_blank_can_be_k",message:"指定範囲外の骨格項目の空欄をK判定に利用できる文面です。"
  });
  const expectedSheet=getSheetType(card.effectiveMode);
  if(review.sheet_type&&review.sheet_type!==expectedSheet)consistencyWarnings.push({code:"mode_sheet_mismatch",message:`保存済み${review.sheet_type}は表示時に${expectedSheet}へ解決されます。`});
  return {
    taskId:String(review.id),problemId:review.problem_id,canonicalProblemId:card.canonicalProblemId,
    sourceAttemptId:review.generated_from_attempt_id||null,reviewScope:scope,targetedParts:card.targetedParts,
    screenCompletionConditions:screenConditions,generatedPrompt:prompt,
    generatedPromptGradingScope:scope,promptRequiredGradingItems:screenConditions,
    kJudgmentConditions:prompt.split("\n").filter(line=>/K：|K\/W\/N\/C|K判定/.test(line)),
    effectiveMode:card.effectiveMode,sheetType:card.sheetType,mismatchWarnings:warnings,
    learningPrescription:prescription,policyVersion:prescription.policyVersion,
    assessmentTiming:prescription.assessmentTiming,learningPurpose:prescription.learningPurpose,
    consistencyWarnings,storedSheetType:review.sheet_type||null,expectedSheetType:expectedSheet,
    contractId:card.gradingContract?.contractId||null,contractHash:card.gradingContract?.contractHash||null,
    gradedParts:card.gradingContract?.gradedParts||card.targetedParts,
    explicitlyOutOfScopeParts:card.gradingContract?.explicitlyOutOfScopeParts||[],
  };
}

function relationRows(problems:Problem[],aliases:ProblemAlias[]){
  const rows:Array<JsonRecord>=[];
  for(const problem of problems){
    const source=resolveCanonicalProblemId(problem.problem_id,aliases);
    const groups:Array<[string[],"prerequisite"|"remediation"|"extension"]>=[
      [[...(problem.related_s_problem_ids||[]),...String(problem.linked_s_problems||"").split(/[;,、\s]+/)],"remediation"],
      [[...(problem.related_a_problem_ids||[]),...String(problem.linked_a_problems||"").split(/[;,、\s]+/)],"extension"],
      [[...(problem.related_past_exam_ids||[]),...(problem.linked_past_exam_ids||[]),...String(problem.linked_past_exams||"").split(/[;,、\s]+/)],"extension"],
    ];
    for(const [rawItems,relationType] of groups){
      for(const targetRaw of [...new Set(rawItems.filter(Boolean))]){
        const target=resolveCanonicalProblemId(targetRaw,aliases);
        rows.push({relationId:`master:${source}:${target}:${relationType}`,sourceProblemId:source,targetProblemId:target,
          relationType,targetFocus:"要確認",reason:"problem_masterの既存指定だけでは補修根拠が不足",relationSource:"problem_master",status:"candidate"});
      }
    }
  }
  return rows;
}

function buildConsistencyReport(problems:Problem[],attempts:Attempt[],reviews:Review[],aliases:ProblemAlias[],relations:JsonRecord[],cards:Map<number,ResolvedReviewCard>,promptAudits:ReturnType<typeof buildPromptAudit>[]){
  const issues:Array<JsonRecord>=[],problemChecks:Array<JsonRecord>=[],reviewChecks:Array<JsonRecord>=[];
  const problemMap=new Map(problems.map(problem=>[resolveCanonicalProblemId(problem.problem_id,aliases),problem]));
  const attemptsByCanonical=new Map<string,Attempt[]>();
  for(const attempt of attempts){
    const id=resolveCanonicalProblemId(attempt.problem_id,aliases),list=attemptsByCanonical.get(id)||[];list.push(attempt);attemptsByCanonical.set(id,list);
  }
  for(const problem of problems){
    const expected=expectedProblemMeta(problem.problem_id),rowIssues:string[]=[];
    if(expected){
      if(problem.display_label!==expected.displayLabel) rowIssues.push("display_label_mismatch");
      if(problem.category!==expected.type) rowIssues.push("type_mismatch");
      if(problem.chapter!==expected.chapter) rowIssues.push("chapter_mismatch");
      if(Number(problem.problem_number)!==expected.problemNumber) rowIssues.push("problem_number_mismatch");
    }
    if(!problem.theme||!problem.canonical_problem_type) rowIssues.push("metadata_missing");
    if(problem.theme===problem.canonical_problem_type) rowIssues.push("theme_and_problem_type_identical_review_recommended");
    const quality=metadataQuality(problem);
    if(quality==="generic")rowIssues.push("metadata_generic_safe_guidance_only");
    const row={problemId:problem.problem_id,displayLabel:problem.display_label,type:problem.category,chapter:problem.chapter,
      problemNumber:problem.problem_number,theme:problem.theme,canonicalProblemType:problem.canonical_problem_type,
      canonicalKeywords:problem.canonical_keywords||[],metadataQuality:quality,issues:rowIssues};
    problemChecks.push(row);rowIssues.forEach(code=>issues.push({scope:"problem",problemId:problem.problem_id,code}));
  }
  for(const review of reviews){
    const card=cards.get(review.id)!;const promptAudit=promptAudits.find(item=>item.taskId===String(review.id))!;
    const ownAttempts=attemptsByCanonical.get(card.canonicalProblemId)||[],rowIssues=[...card.consistencyWarnings.map(item=>item.code),...promptAudit.mismatchWarnings.map(item=>item.code)];
    const sourceAttempt=attempts.find(item=>item.id===review.generated_from_attempt_id);
    const sourceCanonical=sourceAttempt?resolveCanonicalProblemId(sourceAttempt.problem_id,aliases):"";
    const master=problemMap.get(card.canonicalProblemId);
    if(review.task_origin==="review_attempt"&&!ownAttempts.length) rowIssues.push("review_attempt_without_attempt");
    if(review.task_origin==="first_attempt"&&ownAttempts.length) rowIssues.push("first_attempt_with_attempt");
    if(!review.derived_fields||!review.derived_from_problem_id) rowIssues.push("derived_provenance_missing");
    if(review.derived_stale) rowIssues.push("stale_derived_text");
    if(review.derived_from_problem_id&&resolveCanonicalProblemId(review.derived_from_problem_id,aliases)!==card.canonicalProblemId) rowIssues.push("derived_problem_id_mismatch");
    if(review.derived_from_attempt_id&&card.targetAttempt&&review.derived_from_attempt_id!==card.targetAttempt.id) rowIssues.push("derived_attempt_id_mismatch");
    if(review.derived_from_master_version&&master?.master_version&&review.derived_from_master_version!==master.master_version) rowIssues.push("derived_master_version_mismatch");
    if(sourceCanonical&&sourceCanonical!==card.canonicalProblemId&&review.derived_from_attempt_id===sourceAttempt?.id) rowIssues.push("source_content_mixed_into_target");
    if(!promptAudit.targetedParts.length&&promptAudit.reviewScope==="targeted_patch") rowIssues.push("targeted_parts_missing");
    const targetParts=promptAudit.targetedParts;
    const row={taskId:review.id,rawProblemId:review.problem_id,canonicalProblemId:card.canonicalProblemId,
      masterFound:problemMap.has(card.canonicalProblemId),displayLabel:card.displayLabel,theme:card.theme,
      taskOrigin:card.taskOrigin,targetAttemptIds:ownAttempts.map(item=>item.id),sourceAttemptId:review.generated_from_attempt_id||null,
      sourceProblemId:review.source_problem_id||null,reviewScope:promptAudit.reviewScope,targetedParts:targetParts,
      mode:card.effectiveMode,sheetType:card.sheetType,storedSheetType:review.sheet_type||review.sheet_name||null,
      completionConditions:card.completionConditions.value,gradingScope:promptAudit.generatedPromptGradingScope,
      reviewAfterDays:review.interval_days??null,dueDate:review.due_date,derivedStale:!!review.derived_stale,
      provenance:review.derived_fields?sanitize(review.derived_fields):null,issues:[...new Set(rowIssues)]};
    reviewChecks.push(row);[...new Set(rowIssues)].forEach(code=>issues.push({scope:"review",taskId:review.id,problemId:card.canonicalProblemId,code}));
  }
  const seen=new Set<string>();const relationChecks=relations.map(relation=>{
    const source=String(relation.sourceProblemId),target=String(relation.targetProblemId),key=`${source}|${target}|${relation.relationType}`;
    const rowIssues:string[]=[];
    if(source===target) rowIssues.push("self_reference");
    if(seen.has(key)) rowIssues.push("duplicate_relation");seen.add(key);
    if(!problemMap.has(source)||!problemMap.has(target)) rowIssues.push("relation_problem_missing");
    rowIssues.forEach(code=>issues.push({scope:"relation",relationId:relation.relationId,code}));
    return {...relation,issues:rowIssues};
  });
  return {generatedAt:new Date().toISOString(),summary:{problems:problems.length,reviews:reviews.length,relations:relations.length,issues:issues.length},problemChecks,reviewChecks,relationChecks,issues};
}

function logicalEvaluation(attempt:Attempt){
  return {evaluationId:`attempt:${attempt.id}`,attemptId:attempt.id,problemId:attempt.problem_id,scoreNumeric:attempt.score_numeric,
    mark:attempt.mark,errorTypes:attempt.error_types||[attempt.error_type],primaryErrorType:attempt.primary_error_type||attempt.error_type,
    resultSummary:attempt.result_summary,errorPoint:attempt.error_point,nextAction:attempt.next_action,weakNotes:[],gradingConfidence:attempt.grading_confidence,
    evaluationScope:attempt.evaluation_scope,gradedParts:attempt.graded_parts,assumedCorrectParts:attempt.assumed_correct_parts,
    rawGptText:attempt.memo,createdAt:attempt.date};
}

function logicalReviewPlan(review:Review){
  return {reviewPlanId:String(review.id),problemId:review.problem_id,sourceAttemptId:review.generated_from_attempt_id,
    nextDueDate:review.due_date,nextMode:review.effective_mode||review.review_type,nextScope:review.review_instruction||"",
    reason:review.review_reason||review.reason,status:review.status,createdAt:review.derived_generated_at||null};
}

function parseSnapshot(row:{key:string;value:string}){try{return JSON.parse(row.value) as TodayPlanSnapshot}catch{return {parseError:true,rawValue:row.value}}}

function buildPlannerAudit(snapshotRows:Array<{key:string;value:string}>,reviews:Review[],attempts:Attempt[],targetMinutes:number){
  const snapshots=snapshotRows.map(row=>({key:row.key,snapshot:parseSnapshot(row)}));
  const latest=snapshots.sort((a,b)=>a.key.localeCompare(b.key)).at(-1);
  const snapshot=latest?.snapshot as TodayPlanSnapshot|undefined;
  const tasks=Array.isArray(snapshot?.tasks)?snapshot.tasks:[];
  const completed=tasks.filter(task=>task.checked||task.status==="done"||task.status==="completed");
  const remaining=tasks.filter(task=>!completed.includes(task)&&task.triage!=="tomorrow");
  const candidates=tasks.filter(task=>task.triage==="tomorrow"&&!task.postponed_to);
  const postponed=tasks.filter(task=>!!task.postponed_to);
  const must=remaining.filter(task=>task.triage==="must"),optional=remaining.filter(task=>task.triage==="if_time");
  const mustMinutes=must.reduce((sum,task)=>sum+Number(task.minutes||0),0),optionalMinutes=optional.reduce((sum,task)=>sum+Number(task.minutes||0),0);
  return {generatedAt:new Date().toISOString(),latestSnapshotKey:latest?.key||null,startOfDayPlan:snapshot?{
    date:snapshot.date,taskIds:snapshot.task_ids,startOfDayPlannedMinutes:snapshot.start_of_day_planned_minutes,
    initialBucket:snapshot.initial_bucket,initialEstimatedMinutes:snapshot.initial_estimated_minutes}:null,
    currentPlan:tasks,completed,remaining,postponeCandidates:candidates,actuallyPostponed:postponed,
    calculations:{completedMinutes:completed.reduce((sum,task)=>sum+Number(task.minutes||0),0),
      remainingMinutes:remaining.reduce((sum,task)=>sum+Number(task.minutes||0),0),
      postponeCandidateMinutes:candidates.reduce((sum,task)=>sum+Number(task.minutes||0),0),
      postponedMinutes:postponed.reduce((sum,task)=>sum+Number(task.minutes||0),0),
      sources:{startOfDay:"meta today-plan-snapshot:* / start_of_day_planned_minutes",current:"snapshot.tasks",
        completion:"snapshot task checked/status",actualTime:"attempts.time_minutes (別表 learning-data.json)"}},
    automaticRecalculationHistory:{available:false,events:[],note:"専用の自動再計算履歴テーブルはありません。snapshotのcreated_atと保存値のみを出力しています。"},
    executionLimits:{targetMinutes,mustCount:must.length,optionalCount:optional.length,mustMinutes,activeMinutes:mustMinutes+optionalMinutes,
      activeLinkedSCount:[...must,...optional].filter(task=>task.task_origin==="linked_s_check").length,
      compliant:must.length<=3&&optional.length<=2&&mustMinutes<=Math.floor(targetMinutes*.9)&&mustMinutes+optionalMinutes<=targetMinutes&&[...must,...optional].filter(task=>task.task_origin==="linked_s_check").length<=1},
    allSnapshots:snapshots,attemptCount:attempts.length,reviewCount:reviews.length};
}

function wb620Trace(reviews:Review[],attempts:Attempt[],cards:Map<number,ResolvedReviewCard>,promptAudits:ReturnType<typeof buildPromptAudit>[],problems:Problem[],aliases:ProblemAlias[]){
  const review175=reviews.find(review=>review.id===175);
  const generatedAttempts=attempts.filter(attempt=>attempt.generated_from_review_id===175);
  const subsequent=reviews.filter(review=>generatedAttempts.some(attempt=>attempt.id===review.generated_from_attempt_id));
  const related=[review175,...subsequent].filter((item):item is Review=>!!item);
  const master=problems.find(problem=>resolveCanonicalProblemId(problem.problem_id,aliases)==="WB-6-A-20");
  return {requestedReviewId:175,reviewFound:!!review175,problemMaster:master||null,
    generatedAttemptIds:generatedAttempts.map(item=>item.id),subsequentReviewIds:subsequent.map(item=>item.id),
    paths:related.map(review=>{
      const card=cards.get(review.id)!,audit=promptAudits.find(item=>item.taskId===String(review.id))!,source=attempts.find(item=>item.id===review.generated_from_attempt_id);
      return {reviewId:review.id,rawProblemId:review.problem_id,canonicalProblemId:card.canonicalProblemId,
        problemMaster:master||null,sourceAttempt:source||null,sourceEvaluation:source?logicalEvaluation(source):null,
        previousErrorTypes:errorsFor(source),kPolicyValidity:source?classifyKPolicyValidity(source):null,
        reviewScope:audit.reviewScope,targetedParts:audit.targetedParts,
        minimumPassConditions:audit.generatedPrompt.match(/【今回の最低クリア条件】\n([\s\S]*?)\n\nstudy_update:/)?.[1]?.split("\n").filter(Boolean)||[],
        screenCompletionConditions:audit.screenCompletionConditions,generatedGradingPrompt:audit.generatedPrompt,
        promptRequiredGradingItems:audit.promptRequiredGradingItems,kJudgmentConditions:audit.kJudgmentConditions,
        mode:audit.effectiveMode,sheetType:audit.sheetType,dueDate:review.due_date,mismatchWarnings:audit.mismatchWarnings};
    }),
    targetedPatchVsFullSkeleton:promptAudits.filter(item=>item.problemId==="WB-6-A-20"||item.canonicalProblemId==="WB-6-A-20")
      .filter(item=>item.mismatchWarnings.some(warning=>warning.code==="targeted_patch_requires_full_skeleton"))};
}

function schemaDescription(counts:Record<string,number>,migrationRows:Array<{key:string;value:string}>){
  return {databaseName:DB_NAME,databaseVersion:db.verno,requiredDatabaseVersion:DB_VERSION,
    appSchemaVersion:APP_SCHEMA_VERSION,tables:db.tables.map(table=>({name:table.name,
      primaryKey:{name:table.schema.primKey.name,keyPath:table.schema.primKey.keyPath,auto:table.schema.primKey.auto,compound:table.schema.primKey.compound},
      indexes:table.schema.indexes.map(index=>({name:index.name,keyPath:index.keyPath,unique:index.unique,multi:index.multi,compound:index.compound})),
      count:counts[table.name]||0})),migrationHistory:migrationRows};
}

export type DiagnosticPackResult={blob:Blob;fileName:string;summary:{files:string[];readOnlyVerified:boolean;problemCount:number;reviewCount:number;issueCount:number}};

export async function createDiagnosticPack():Promise<DiagnosticPackResult>{
  if(!db.isOpen()) throw new Error("データベースが開かれていません。画面を再読み込みしてからもう一度お試しください。");
  const before=await databaseFingerprint();
  const [problems,aliases,attempts,reviews,weakNotes,pastSessions,metaRows,importLogs,correctionLogs]=await Promise.all([
    db.problems.toArray(),db.problemAliases.toArray(),db.attempts.toArray(),db.reviews.toArray(),db.weakNotes.toArray(),
    db.pastSessions.toArray(),db.meta.toArray(),db.importLogs.toArray(),db.correctionLogs.toArray()
  ]);
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(new Date());
  const examDate=metaRows.find(row=>row.key==="exam_date")?.value||"";
  let storedRelations:ProblemRelation[]=[];try{storedRelations=JSON.parse(metaRows.find(row=>row.key==="problem-relations")?.value||"[]")}catch{/* 診断は読み取り専用 */}
  const cards=new Map<number,ResolvedReviewCard>();
  for(const review of reviews){const origin=resolveReviewOrigin({review,attempts,aliases,relations:storedRelations,problems});
    cards.set(review.id,resolveReviewCard({item:{...review,origin_verified:origin.valid},problems,attempts,aliases,today,examDate,now:new Date().toISOString()}));}
  const promptAudits=reviews.map(review=>buildPromptAudit(review,cards.get(review.id)!));
  const relations=[...relationRows(problems,aliases),...storedRelations];
  const baseConsistency=buildConsistencyReport(problems,attempts,reviews,aliases,relations,cards,promptAudits);
  const legacyK=analyzeLegacyKReorganization({attempts,reviews,problems});
  const sourceRepair=analyzeSourceMismatchRepair({attempts,reviews,problems,aliases,relations:storedRelations});
  const pastExamAudit=pastSessions.map(session=>({id:session.id,year:session.year,sessionKind:session.session_kind||session.session_type,
    exposure:deriveExposure(session),validation:validatePastExamSession(session),metrics:scanMetrics(session),
    countedStudyMinutes:sessionStudyMinutes(session,attempts),linkedAttemptIds:session.linked_attempt_ids||[]}));
  const consistency={...baseConsistency,legacyKPolicy:{invalid_legacy_k_count:legacyK.invalidLegacyKCount,
    needs_review_count:legacyK.needsReviewCount,superseded_task_count:legacyK.supersededTaskCount,
    resolved_task_count:legacyK.resolvedTaskCount,classifications:legacyK.classifications,taskActions:legacyK.taskActions},
    sourceOriginPolicy:{source_mismatch_count:sourceRepair.mismatchCount,verified_relation_count:sourceRepair.verifiedRelationCount,
      superseded_count:sourceRepair.supersededCount,regenerated_count:sourceRepair.regeneratedCount,
      needs_review_count:sourceRepair.needsReviewCount,unchanged_completed_count:sourceRepair.unchangedCompletedCount,
      active_source_mismatch:sourceRepair.activeSourceMismatchCount,
      pending_verified_link_needs_migration:sourceRepair.pendingVerifiedLinkNeedsMigrationCount,
      invalid_legacy_cards_to_supersede:sourceRepair.invalidLegacyCardsToSupersedeCount,
      historical_completed_linked_reviews:sourceRepair.historicalCompletedLinkedReviewsCount,
      unresolved_needs_review:sourceRepair.unresolvedNeedsReviewCount,actions:sourceRepair.actions},
    pastExamAudit};
  const snapshotRows=metaRows.filter(row=>row.key.startsWith("today-plan-snapshot:"));
  const settings=Object.fromEntries(metaRows.filter(row=>SETTINGS_KEYS.has(row.key)).map(row=>[row.key,row.value]));
  const learningData={_modelMapping:{evaluations:"attemptsの評価フィールドから作った論理ビュー",reviewTasks:"reviews物理テーブル",
      reviewPlans:"reviewsの予定フィールドから作った論理ビュー",problemRelations:"problem_masterの既存関連指定から作った読み取り専用ビュー"},
    problemMaster:problems,aliases,attempts,evaluations:attempts.map(logicalEvaluation),reviewTasks:reviews,
    reviewPlans:reviews.map(logicalReviewPlan),todayPlanSnapshot:snapshotRows.map(row=>({key:row.key,value:parseSnapshot(row)})),
    problemRelations:relations,weakNotes,pastSessions,settings};
  const counts=Object.fromEntries(Object.entries(before.tables).map(([name,row])=>[name,row.count]));
  const migrationRows=metaRows.filter(row=>/migration/i.test(row.key));
  const deployAt=typeof __APP_DEPLOYED_AT__!=="undefined"?__APP_DEPLOYED_AT__:"unknown";
  const commit=typeof __APP_COMMIT__!=="undefined"?__APP_COMMIT__:"unknown";
  const testReport=typeof __APP_TEST_REPORT__!=="undefined"?__APP_TEST_REPORT__:"ビルド時検証情報なし";
  const appInfo={commit,buildVersion:APP_BUILD_VERSION,databaseVersion:db.verno,requiredDatabaseVersion:DB_VERSION,
    learningPolicyVersion:LEARNING_POLICY_VERSION,
    schemaVersion:APP_SCHEMA_VERSION,problemMasterVersion:metaRows.find(row=>row.key==="problem_master_version")?.value||"unversioned",
    deployedAt:deployAt,exportedAt:new Date().toISOString(),privacy:{pdfIncluded:false,imageIncluded:false,binaryIncluded:false,
      freeFormMemoIncluded:false,rawGptTextIncluded:false},
    physicalModel:{attempts:"答案とGPT評価",reviews:"復習タスクと復習計画",problemRelations:"独立storeなし"}};
  const plannerAudit={...buildPlannerAudit(snapshotRows,reviews,attempts,Math.max(30,Number(settings.daily_study_minutes||150))),
    scanSoftQuotaSimulation:[119,90,60,30].map(daysRemaining=>({daysRemaining,...simulateScanPlan({startDate:today,daysRemaining,days:30})})),
    thirtyDaySimulation:simulateThirtyDays({startDate:today,targetMinutes:Math.max(30,Number(settings.daily_study_minutes||150)),
      problems,tasks:reviews.filter(review=>review.status!=="done").map(review=>{
        const card=cards.get(review.id)!;return {id:review.id,problem_id:card.canonicalProblemId,title:card.displayLabel,
          kind:review.review_type,reason:review.reason||"",mode:card.effectiveMode,minutes:card.estimatedMinutes,load:1,
          due_date:review.due_date,deduplication_key:review.deduplication_key,review_scope:card.effectiveReviewScope,
          task_origin:card.taskOrigin,error_type:card.primaryErrorType} as import("./types.ts").Task;
      }),pastSessions})};
  const pendingAudits=promptAudits.filter((_,index)=>["pending","overdue","deferred"].includes(reviews[index]?.status));
  const countWarning=(code:string)=>pendingAudits.filter(item=>item.mismatchWarnings.some(warning=>warning.code===code)).length;
  const promptAuditFile={generatedAt:new Date().toISOString(),summary:{tasks:promptAudits.length,pendingTasks:pendingAudits.length,
    mismatches:pendingAudits.filter(item=>item.mismatchWarnings.length).length,
    targeted_patch_requires_full_skeleton:countWarning("targeted_patch_requires_full_skeleton"),
    out_of_scope_blank_can_be_k:countWarning("out_of_scope_blank_can_be_k"),
    screen_prompt_completion_mismatch:countWarning("prompt_scope_wider_than_screen")},
    tasks:promptAudits,wb_6_a_20_review_175:wb620Trace(reviews,attempts,cards,promptAudits,problems,aliases)};
  const after=await databaseFingerprint();
  const readOnlyVerified=stableStringify(before)===stableStringify(after);
  if(!readOnlyVerified) throw new Error("診断中にデータ状態の変化を検出したため、ZIPの作成を中止しました。既存データは書き換えていません。");
  const verification={verified:true,method:"全Dexie tableの件数・主キーダイジェストとtodayPlanSnapshotダイジェストを生成前後で比較",
    before,after};
  const zip=new JSZip();
  const addJson=(name:string,value:unknown)=>zip.file(name,JSON.stringify(sanitize(value),null,2));
  addJson("app-info.json",{...appInfo,readOnlyVerification:verification});
  addJson("db-schema.json",schemaDescription(counts,migrationRows));
  addJson("learning-data.json",learningData);
  addJson("consistency-report.json",consistency);
  addJson("prompt-audit.json",promptAuditFile);
  addJson("planner-audit.json",plannerAudit);
  zip.file("test-report.txt",`${testReport}\n\nDiagnostic export verification: PASS\n- table counts and primary-key digests unchanged\n- todayPlanSnapshot digests unchanged\n- no write transaction executed\n- PDF/image/binary records excluded\nExported at: ${appInfo.exportedAt}\n`);
  const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});
  return {blob,fileName:`diagnostic-pack-${today}.zip`,summary:{files:Object.keys(zip.files),readOnlyVerified,problemCount:problems.length,reviewCount:reviews.length,issueCount:consistency.issues.length}};
}

export const diagnosticAuditInternals={buildPromptAudit,stableStringify};
