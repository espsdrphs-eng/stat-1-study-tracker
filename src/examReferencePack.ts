import JSZip from "jszip";
import type {
  Attempt, ExamReferenceCatalogItem, ExamReferencePackStatus, PastExamExposure,
  PastSession, Problem, ProblemAlias
} from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { deriveExposure } from "./pastExamWorkflow.ts";

export const EXAM_REFERENCE_PACK_NAME="stat1_exam_reference_pack_v1";
export const EXAM_REFERENCE_PACK_META_KEY="exam-reference-pack:active";
export const EXAM_REFERENCE_EXPOSURE_META_KEY="exam-reference-pack:exposure-overrides";
export const EXAM_REFERENCE_PLANNER_MODE_META_KEY="adaptive-planner:mode";

export type PackManifest={
  pack_name:string;created_at:string;
  files:Array<{path:string;bytes:number;sha256:string}>;
  counts:{past_exam_records:number;core_schedulable:number;metadata_only:number;concepts:number;whitebook_links:number};
};
export type PastExamReference={
  problem_id:string;year:number;question_number:number;subject:string;
  availability:"verified_problem"|"metadata_only";schedulable:boolean;gradable:boolean;
  title:string;summary:string;fine_concept_ids:string[];coarse_topics:string[];
  difficulty_by_source:Record<string,string|number|null>;selection_note:string|null;
  exposure_default:PastExamExposure;simulation_protection_default:boolean;
  source_references:Array<{source_id:string;role:string}>;classification_confidence:string;
  whitebook_candidate_ids:string[];whitebook_candidate_ids_unresolved:string[];notes:string[];
};
export type ConceptReference={
  concept_id:string;display_name:string;whitebook_chapter_number:number;
  whitebook_chapter_title:string;past_exam_problem_ids:string[];
  status:string;id_stability:string;source_confidence:string;
};
export type WhitebookExamLinkReference={
  past_exam_problem_id:string;whitebook_problem_id:string;
  relation_type:string;priority_rank:number;reason:string;confidence:string;
  requires_user_confirmation_before_task_creation:boolean;
  requires_live_problem_master_reconciliation:boolean;
  resolved_whitebook_problem_id?:string;
  reconciliation_status?:"exact"|"alias"|"unresolved";
};
export type PlannerPolicyReference={
  metadata:{schema_version:string;created_at:string;purpose:string;exam_date:string;timezone:string;default_daily_minutes:number};
  daily_slots:Array<Record<string,unknown>>;phases:Array<Record<string,unknown>>;
  weakness_evidence:Record<string,unknown>;past_exam_loop:string[];exposure_states:string[];
  exposure_rules:string[];snapshot_rule:string;non_goals:string[];
};
export type LegacyConflictReport={
  do_not_use_as_canonical:string[];reason:string;
  examples:Array<{old_id:string;old_summary:string;corrected_summary:string}>;required_action:string;
};
export type ExamReferencePackData={
  manifest:PackManifest;
  pastExamMetadata:Record<string,unknown>;pastExamProblems:PastExamReference[];
  conceptMetadata:Record<string,unknown>;concepts:ConceptReference[];
  linkMetadata:Record<string,unknown>;whitebookLinks:WhitebookExamLinkReference[];
  plannerPolicy:PlannerPolicyReference;legacyConflictReport:LegacyConflictReport;
  sourceManifest:string;validationReport:string;readme:string;
};
export type ReferencePackValidation={
  valid:boolean;packHash:string;errors:string[];warnings:string[];verifiedFiles:string[];
  schemaVersions:string[];
};
export type ReferencePackReconciliation={
  existingPastExam:number;safePastExamAdditions:number;safePastExamEnrichments:number;
  pastExamConflicts:number;resolvedWhitebookLinks:number;aliasResolvedWhitebookLinks:number;
  unresolvedWhitebookLinks:number;unresolvedWhitebookIds:string[];
  knownLegacyConflicts:number;orphanPastAttempts:number;orphanPastSessions:number;
  pastExamRows:Array<{referenceProblemId:string;canonicalProblemId:string;status:"existing"|"safe_add"|"safe_enrich"|"conflict"|"metadata_only";reason:string}>;
  whitebookRows:Array<{pastExamProblemId:string;rawWhitebookProblemId:string;canonicalWhitebookProblemId:string|null;status:"exact"|"alias"|"unresolved"}>;
};
export type StoredExamReferencePack={
  packHash:string;importedAt:string;shadowStartedAt:string;plannerMode:"legacy"|"shadow";
  validation:ReferencePackValidation;reconciliation:ReferencePackReconciliation;data:ExamReferencePackData;
};

const utf8=new TextEncoder();
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
const isGenericPastExam=(problem:Problem)=>
  !String(problem.theme||"").trim()||problem.theme==="過去問・テーマ未登録"||
  problem.metadata_status==="review_needed"||problem.metadata_status==="metadata_review_needed";

async function sha256(bytes:Uint8Array){
  const digest=await crypto.subtle.digest("SHA-256",bytes as BufferSource);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}

export function canonicalPastExamProblemId(value:string|PastExamReference){
  if(typeof value!=="string")return `PY-${value.year}-Q${value.question_number}`;
  const match=String(value).toUpperCase().match(/^(?:PE|PY)-(\d{4})-Q0*(\d+)$/);
  return match?`PY-${match[1]}-Q${Number(match[2])}`:String(value);
}

function assertObject(value:unknown,name:string):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${name}の形式が正しくありません`);
  return value as Record<string,unknown>;
}

export function validateReferencePackData(data:ExamReferencePackData):Omit<ReferencePackValidation,"packHash"|"verifiedFiles">{
  const errors:string[]=[],warnings:string[]=[];
  if(data.manifest.pack_name!==EXAM_REFERENCE_PACK_NAME)errors.push(`pack_nameが不正です: ${data.manifest.pack_name}`);
  const past=data.pastExamProblems,concepts=data.concepts,links=data.whitebookLinks;
  const core=past.filter(row=>row.schedulable&&row.availability==="verified_problem");
  const metadataOnly=past.filter(row=>row.availability==="metadata_only");
  const expected=data.manifest.counts;
  if(past.length!==expected.past_exam_records)errors.push(`過去問件数: manifest ${expected.past_exam_records} / data ${past.length}`);
  if(core.length!==expected.core_schedulable)errors.push(`core件数: manifest ${expected.core_schedulable} / data ${core.length}`);
  if(metadataOnly.length!==expected.metadata_only)errors.push(`metadata only件数: manifest ${expected.metadata_only} / data ${metadataOnly.length}`);
  if(concepts.length!==expected.concepts)errors.push(`concept件数: manifest ${expected.concepts} / data ${concepts.length}`);
  if(links.length!==expected.whitebook_links)errors.push(`白本リンク件数: manifest ${expected.whitebook_links} / data ${links.length}`);
  const duplicatePast=past.map(row=>row.problem_id).filter((id,index,rows)=>rows.indexOf(id)!==index);
  const duplicateConcept=concepts.map(row=>row.concept_id).filter((id,index,rows)=>rows.indexOf(id)!==index);
  if(duplicatePast.length)errors.push(`重複過去問ID: ${unique(duplicatePast).join("、")}`);
  if(duplicateConcept.length)errors.push(`重複concept ID: ${unique(duplicateConcept).join("、")}`);
  if(past.some(row=>row.year===2020))errors.push("2020年に問題レコードがあります");
  if(metadataOnly.some(row=>row.schedulable||row.gradable))errors.push("metadata onlyに出題可能なレコードがあります");
  if(past.filter(row=>[2016,2017,2018].includes(row.year)).some(row=>row.availability!=="metadata_only"))
    errors.push("2016〜2018年にmetadata only以外のレコードがあります");
  if(core.some(row=>![2019,2021,2022,2023,2024,2025].includes(row.year)))
    errors.push("core対象外年度が出題可能です");
  if(past.filter(row=>[2024,2025].includes(row.year)&&row.schedulable).some(row=>!row.simulation_protection_default))
    errors.push("2024・2025年の模試保護がありません");
  const conceptIds=new Set(concepts.map(row=>row.concept_id));
  const unknownConcepts=unique(past.flatMap(row=>row.fine_concept_ids).filter(id=>!conceptIds.has(id)));
  if(unknownConcepts.length)errors.push(`未定義concept参照: ${unknownConcepts.join("、")}`);
  if(core.some(row=>!row.fine_concept_ids.length))errors.push("concept未設定のcore過去問があります");
  if(core.some(row=>!row.summary.trim()))errors.push("summary未設定のcore過去問があります");
  if(data.plannerPolicy.metadata.schema_version!=="stat1-adaptive-planner-policy-v1")
    errors.push(`planner policy schemaが不正です: ${data.plannerPolicy.metadata.schema_version}`);
  if(data.plannerPolicy.metadata.timezone!=="Asia/Tokyo")warnings.push("planner policyのtimezoneがAsia/Tokyoではありません");
  return {valid:errors.length===0,errors,warnings,schemaVersions:[
    String(data.pastExamMetadata.schema_version||""),
    String(data.conceptMetadata.schema_version||""),
    String(data.linkMetadata.schema_version||""),
    data.plannerPolicy.metadata.schema_version
  ]};
}

export async function parseExamReferencePack(input:Blob|ArrayBuffer|Uint8Array):Promise<{data:ExamReferencePackData;validation:ReferencePackValidation}>{
  const bytes=input instanceof Blob?new Uint8Array(await input.arrayBuffer()):input instanceof Uint8Array?input:new Uint8Array(input);
  const packHash=await sha256(bytes),zip=await JSZip.loadAsync(bytes);
  const required=[
    "PACK_MANIFEST.json","README.md","concept_master.json","legacy_conflict_report.json",
    "past_exam_master.json","planner_policy_reference.json","source_manifest.md",
    "validation_report.md","whitebook_exam_links.json"
  ];
  const missing=required.filter(path=>!zip.file(path));
  if(missing.length)throw new Error(`参照パックの必須ファイルがありません: ${missing.join("、")}`);
  const text=async(path:string)=>zip.file(path)!.async("string");
  const manifest=assertObject(JSON.parse(await text("PACK_MANIFEST.json")),"PACK_MANIFEST.json") as unknown as PackManifest;
  const hashErrors:string[]=[],verifiedFiles:string[]=[];
  for(const file of manifest.files){
    const entry=zip.file(file.path);
    if(!entry){hashErrors.push(`${file.path}: ファイルなし`);continue}
    const content=await entry.async("uint8array"),hash=await sha256(content);
    if(content.byteLength!==file.bytes)hashErrors.push(`${file.path}: bytes ${content.byteLength} / ${file.bytes}`);
    if(hash!==file.sha256.toLowerCase())hashErrors.push(`${file.path}: sha256不一致`);
    if(content.byteLength===file.bytes&&hash===file.sha256.toLowerCase())verifiedFiles.push(file.path);
  }
  const past=assertObject(JSON.parse(await text("past_exam_master.json")),"past_exam_master.json");
  const concept=assertObject(JSON.parse(await text("concept_master.json")),"concept_master.json");
  const links=assertObject(JSON.parse(await text("whitebook_exam_links.json")),"whitebook_exam_links.json");
  const data:ExamReferencePackData={
    manifest,
    pastExamMetadata:assertObject(past.metadata,"past_exam_master.metadata"),
    pastExamProblems:Array.isArray(past.problems)?past.problems as PastExamReference[]:[],
    conceptMetadata:assertObject(concept.metadata,"concept_master.metadata"),
    concepts:Array.isArray(concept.concepts)?concept.concepts as ConceptReference[]:[],
    linkMetadata:assertObject(links.metadata,"whitebook_exam_links.metadata"),
    whitebookLinks:Array.isArray(links.links)?links.links as WhitebookExamLinkReference[]:[],
    plannerPolicy:JSON.parse(await text("planner_policy_reference.json")) as PlannerPolicyReference,
    legacyConflictReport:JSON.parse(await text("legacy_conflict_report.json")) as LegacyConflictReport,
    sourceManifest:await text("source_manifest.md"),validationReport:await text("validation_report.md"),
    readme:await text("README.md")
  };
  const structure=validateReferencePackData(data);
  return {data,validation:{...structure,valid:structure.valid&&!hashErrors.length,
    errors:[...hashErrors,...structure.errors],packHash,verifiedFiles}};
}

export function reconcileExamReferencePack(args:{
  data:ExamReferencePackData;problems:Problem[];aliases:ProblemAlias[];
  attempts?:Attempt[];pastSessions?:PastSession[];
}):ReferencePackReconciliation{
  const problemByCanonical=new Map(args.problems.map(problem=>[
    resolveCanonicalProblemId(problem.problem_id,args.aliases),problem
  ]));
  const pastExamRows:ReferencePackReconciliation["pastExamRows"]=[];
  for(const reference of args.data.pastExamProblems){
    const canonicalProblemId=canonicalPastExamProblemId(reference);
    if(reference.availability==="metadata_only"){
      pastExamRows.push({referenceProblemId:reference.problem_id,canonicalProblemId,status:"metadata_only",reason:"実物問題未提供のため出題不可"});
      continue;
    }
    const existing=problemByCanonical.get(canonicalProblemId);
    if(!existing){
      pastExamRows.push({referenceProblemId:reference.problem_id,canonicalProblemId,status:"safe_add",reason:"live masterに同一canonical IDなし"});
    }else if(existing.reference_pack_id===reference.problem_id||existing.theme===reference.title){
      pastExamRows.push({referenceProblemId:reference.problem_id,canonicalProblemId,status:"existing",reason:"同一参照パックまたは同一テーマ"});
    }else if(isGenericPastExam(existing)){
      pastExamRows.push({referenceProblemId:reference.problem_id,canonicalProblemId,status:"safe_enrich",reason:"live masterが汎用メタデータ"});
    }else{
      pastExamRows.push({referenceProblemId:reference.problem_id,canonicalProblemId,status:"conflict",reason:`live「${existing.theme}」/ pack「${reference.title}」`});
    }
  }
  const whitebookRows:ReferencePackReconciliation["whitebookRows"]=[];
  for(const link of args.data.whitebookLinks){
    const exact=args.problems.find(problem=>problem.problem_id===link.whitebook_problem_id);
    const canonical=resolveCanonicalProblemId(link.whitebook_problem_id,args.aliases);
    const matched=exact||problemByCanonical.get(canonical);
    whitebookRows.push({pastExamProblemId:link.past_exam_problem_id,rawWhitebookProblemId:link.whitebook_problem_id,
      canonicalWhitebookProblemId:matched?.problem_id||null,status:exact?"exact":matched?"alias":"unresolved"});
  }
  const referencePastIds=new Set(args.data.pastExamProblems.map(row=>canonicalPastExamProblemId(row)));
  const orphanPastAttempts=(args.attempts||[]).filter(attempt=>
    /^(?:PE|PY)-/.test(attempt.problem_id)&&!referencePastIds.has(canonicalPastExamProblemId(attempt.problem_id))).length;
  const knownYears=new Set(args.data.pastExamProblems.map(row=>row.year));
  const orphanPastSessions=(args.pastSessions||[]).filter(session=>Number(session.year)>0&&!knownYears.has(Number(session.year))).length;
  const unresolvedWhitebookIds=unique(whitebookRows.filter(row=>row.status==="unresolved").map(row=>row.rawWhitebookProblemId));
  return {
    existingPastExam:pastExamRows.filter(row=>row.status==="existing").length,
    safePastExamAdditions:pastExamRows.filter(row=>row.status==="safe_add").length,
    safePastExamEnrichments:pastExamRows.filter(row=>row.status==="safe_enrich").length,
    pastExamConflicts:pastExamRows.filter(row=>row.status==="conflict").length,
    resolvedWhitebookLinks:whitebookRows.filter(row=>row.status==="exact").length,
    aliasResolvedWhitebookLinks:whitebookRows.filter(row=>row.status==="alias").length,
    unresolvedWhitebookLinks:whitebookRows.filter(row=>row.status==="unresolved").length,
    unresolvedWhitebookIds,knownLegacyConflicts:args.data.legacyConflictReport.examples.length,
    orphanPastAttempts,orphanPastSessions,pastExamRows,whitebookRows
  };
}

export function enrichReconciledLinks(data:ExamReferencePackData,reconciliation:ReferencePackReconciliation){
  const rows=new Map(reconciliation.whitebookRows.map(row=>[
    `${row.pastExamProblemId}|${row.rawWhitebookProblemId}`,row
  ]));
  return data.whitebookLinks.map(link=>{
    const row=rows.get(`${link.past_exam_problem_id}|${link.whitebook_problem_id}`);
    return {...link,resolved_whitebook_problem_id:row?.canonicalWhitebookProblemId||undefined,
      reconciliation_status:row?.status||"unresolved"} as WhitebookExamLinkReference;
  });
}

export function buildReferencePackStatus(record?:StoredExamReferencePack|null):ExamReferencePackStatus{
  const emptyCounts={pastExamRecords:0,coreSchedulable:0,metadataOnly:0,concepts:0,whitebookLinks:0};
  const emptyReconciliation={existingPastExam:0,safePastExamAdditions:0,safePastExamEnrichments:0,pastExamConflicts:0,
    resolvedWhitebookLinks:0,aliasResolvedWhitebookLinks:0,unresolvedWhitebookLinks:0,unresolvedWhitebookIds:[],
    knownLegacyConflicts:0,orphanPastAttempts:0,orphanPastSessions:0};
  if(!record)return {installed:false,packName:"",packHash:"",importedAt:"",schemaVersions:[],valid:false,
    errors:[],warnings:[],counts:emptyCounts,reconciliation:emptyReconciliation,plannerMode:"legacy"};
  const counts=record.data.manifest.counts;
  return {installed:true,packName:record.data.manifest.pack_name,packHash:record.packHash,importedAt:record.importedAt,
    schemaVersions:record.validation.schemaVersions,valid:record.validation.valid,errors:record.validation.errors,
    warnings:record.validation.warnings,counts:{pastExamRecords:counts.past_exam_records,coreSchedulable:counts.core_schedulable,
      metadataOnly:counts.metadata_only,concepts:counts.concepts,whitebookLinks:counts.whitebook_links},
    reconciliation:{existingPastExam:record.reconciliation.existingPastExam,
      safePastExamAdditions:record.reconciliation.safePastExamAdditions,
      safePastExamEnrichments:record.reconciliation.safePastExamEnrichments,
      pastExamConflicts:record.reconciliation.pastExamConflicts,
      resolvedWhitebookLinks:record.reconciliation.resolvedWhitebookLinks,
      aliasResolvedWhitebookLinks:record.reconciliation.aliasResolvedWhitebookLinks,
      unresolvedWhitebookLinks:record.reconciliation.unresolvedWhitebookLinks,
      unresolvedWhitebookIds:record.reconciliation.unresolvedWhitebookIds,
      knownLegacyConflicts:record.reconciliation.knownLegacyConflicts,
      orphanPastAttempts:record.reconciliation.orphanPastAttempts,
      orphanPastSessions:record.reconciliation.orphanPastSessions},
    shadowStartedAt:record.shadowStartedAt,plannerMode:record.plannerMode};
}

function questionNumberFromLabel(value:string){
  const match=String(value).match(/(?:問|Q)0*(\d+)/i);
  return match?Number(match[1]):null;
}

export function deriveReferenceProblemExposure(args:{
  reference:PastExamReference;sessions:PastSession[];override?:PastExamExposure;
}):PastExamExposure{
  const relevant=args.sessions.filter(session=>{
    if(Number(session.year)!==args.reference.year)return false;
    const questions=session.questions||[];
    return !questions.length||questions.some(question=>
      canonicalPastExamProblemId(question.problemId||"")===canonicalPastExamProblemId(args.reference)||
      questionNumberFromLabel(question.questionLabel)===args.reference.question_number);
  });
  const rank:Record<PastExamExposure,number>={unknown:0,unseen:1,prompt_scanned:2,partially_attempted:3,
    fully_attempted:4,simulated:5,answer_exposed:6};
  const derived=relevant.map(deriveExposure).sort((a,b)=>rank[b]-rank[a])[0];
  if(derived&&rank[derived]>=rank[args.override||"unknown"])return derived;
  return args.override||args.reference.exposure_default||"unknown";
}

export function buildPastExamCatalog(args:{
  record?:StoredExamReferencePack|null;sessions:PastSession[];exposureOverrides?:Record<string,PastExamExposure>;
}):ExamReferenceCatalogItem[]{
  if(!args.record)return [];
  return args.record.data.pastExamProblems
    .filter(reference=>reference.availability==="verified_problem"&&reference.schedulable)
    .map(reference=>{
    const canonicalProblemId=canonicalPastExamProblemId(reference);
    return {referenceProblemId:reference.problem_id,canonicalProblemId,year:reference.year,
      questionNumber:reference.question_number,title:reference.title,availability:reference.availability,
      schedulable:reference.schedulable,gradable:reference.gradable,fineConceptIds:reference.fine_concept_ids,
      coarseTopics:reference.coarse_topics,
      exposure:deriveReferenceProblemExposure({reference,sessions:args.sessions,override:args.exposureOverrides?.[canonicalProblemId]}),
      simulationProtected:reference.simulation_protection_default,
      classificationConfidence:reference.classification_confidence};
  });
}

const exposureDisplayRank:Record<PastExamExposure,number>={
  prompt_scanned:0,partially_attempted:1,fully_attempted:2,answer_exposed:3,simulated:4,
  unseen:5,unknown:6
};

export function orderCorePastExamYears(args:{
  catalog:ExamReferenceCatalogItem[];
  plannedReferenceProblemIds?:string[];
  daysRemaining:number;
}):number[]{
  const core=args.catalog.filter(row=>row.availability==="verified_problem"&&row.schedulable);
  const byReference=new Map(core.map(row=>[row.referenceProblemId,row]));
  const planned=(args.plannedReferenceProblemIds||[])
    .map(problemId=>byReference.get(problemId)?.year)
    .filter((year):year is number=>Number.isFinite(year));
  const years=[...new Set(core.map(row=>row.year))];
  const yearRank=(year:number)=>{
    const rows=core.filter(row=>row.year===year);
    const protectedUnknown=args.daysRemaining>=61&&rows.some(row=>row.simulationProtected)&&
      rows.every(row=>["unknown","unseen"].includes(row.exposure));
    return {
      protected:protectedUnknown?1:0,
      exposure:Math.min(...rows.map(row=>exposureDisplayRank[row.exposure])),
      year
    };
  };
  const remaining=years.filter(year=>!planned.includes(year)).sort((a,b)=>{
    const left=yearRank(a),right=yearRank(b);
    return left.protected-right.protected||left.exposure-right.exposure||left.year-right.year;
  });
  return [...new Set([...planned,...remaining])];
}

export function referenceProblemToLiveProblem(reference:PastExamReference,packHash:string,existing?:Problem):Problem{
  const problem_id=canonicalPastExamProblemId(reference);
  const keywords=reference.fine_concept_ids;
  return {...existing,id:existing?.id||Number(`${reference.year}${String(reference.question_number).padStart(2,"0")}`),
    problem_id,source_type:"past_exam",category:"past_exam",chapter:null,problem_number:reference.question_number,
    title:reference.title,display_label:`${reference.year}年問${reference.question_number}`,
    theme:reference.title,canonical_title:reference.title,canonical_problem_type:reference.title,
    canonical_keywords:keywords,priority:existing?.priority||"past_exam",role:existing?.role||"score_building",
    recommended_mode:existing?.recommended_mode||"full",linked_past_exams:existing?.linked_past_exams||"",
    linked_s_problems:existing?.linked_s_problems||"",linked_a_problems:existing?.linked_a_problems||"",
    notes:[reference.summary,reference.selection_note||"",...(reference.notes||[])].filter(Boolean).join(" / "),
    completion_status:existing?.completion_status||"active",strategy_rank:existing?.strategy_rank||"A",
    reference_pack_id:reference.problem_id,reference_pack_hash:packHash,reference_status:"verified",
    past_exam_availability:reference.availability,schedulable:reference.schedulable,gradable:reference.gradable,
    fine_concept_ids:reference.fine_concept_ids,coarse_topics:reference.coarse_topics,
    difficulty_by_source:reference.difficulty_by_source,
    simulation_protection_default:reference.simulation_protection_default,
    classification_confidence:reference.classification_confidence};
}

export function referenceFileByteLength(value:string){return utf8.encode(value).byteLength}
