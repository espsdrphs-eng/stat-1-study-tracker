import yaml from "js-yaml";
import type {
  DiagnosticUncertainty,ObservedOutOfScopeFinding,ProblemContextPack,
  WholeAnswerAttachment,WholeAnswerRegion,WholeAnswerScan,
} from "./types.ts";

export const WHOLE_ANSWER_DIAGNOSTIC_VERSION="STAT1-WHOLE-ANSWER-v2";
type Coverage=WholeAnswerScan["reference_coverage"];
const COVERAGE:Coverage[]=["full","partial","insufficient"];
const CONFIDENCE:WholeAnswerScan["confidence"][]=["high","medium","low"];
const REGION_STATUS:WholeAnswerRegion["status"][]=["checked_correct","checked_error","uncertain","not_checkable"];
const ATTACHMENT_KIND:WholeAnswerAttachment["kind"][]=["problem_statement","official_reference_answer","supplemental_reference","current_answer","unrelated_or_unknown"];

const coverage=(value:unknown,fallback:Coverage="insufficient")=>COVERAGE.includes(String(value) as Coverage)?String(value) as Coverage:fallback;
const confidence=(value:unknown,fallback:WholeAnswerScan["confidence"]="low")=>CONFIDENCE.includes(String(value) as WholeAnswerScan["confidence"])?String(value) as WholeAnswerScan["confidence"]:fallback;
const bool=(value:unknown)=>value===true||String(value).toLowerCase()==="true";
const list=(value:unknown)=>Array.isArray(value)?value:[];
const strings=(value:unknown)=>list(value).map(String).filter(Boolean);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

export const UNCONFIRMED_WHOLE_ANSWER_SCAN:WholeAnswerScan={
  performed:false,reference_coverage:"insufficient",app_reference_coverage:"insufficient",
  effective_reference_coverage:"insufficient",written_answer_coverage:"insufficient",confidence:"low",
  reason:"答案全体を照合できる問題文・参照解答または答案ページが不足しています。",attachments:[],regions:[],
};

export function suppliedReferenceCoverage(context?:ProblemContextPack):Coverage{
  if(context?.problemStatement&&context.officialAnswerText)return "full";
  if(context?.problemStatement||context?.officialAnswerText||context?.answerExcerpt)return "partial";
  return "insufficient";
}

function normalizeAttachments(value:unknown):WholeAnswerAttachment[]{
  return list(value).map((item,index)=>{
    const raw=record(item);const kind=ATTACHMENT_KIND.includes(String(raw.kind) as WholeAnswerAttachment["kind"])
      ?String(raw.kind) as WholeAnswerAttachment["kind"]:"unrelated_or_unknown";
    return {attachment_id:String(raw.attachment_id||`attachment-${index+1}`),kind,
      description:String(raw.description||kind),coverage:coverage(raw.coverage),
      ...(Number.isFinite(Number(raw.page_count))?{page_count:Number(raw.page_count)}:{})};
  });
}

function attachmentReferenceCoverage(rows:WholeAnswerAttachment[]):Coverage{
  const problem=rows.some(row=>row.kind==="problem_statement"&&row.coverage==="full");
  const official=rows.some(row=>row.kind==="official_reference_answer"&&row.coverage==="full");
  if(problem&&official)return "full";
  if(rows.some(row=>["problem_statement","official_reference_answer","supplemental_reference"].includes(row.kind)&&row.coverage!=="insufficient"))return "partial";
  return "insufficient";
}

function strongest(...values:Coverage[]):Coverage{
  return values.includes("full")?"full":values.includes("partial")?"partial":"insufficient";
}

function normalizeRegions(value:unknown):WholeAnswerRegion[]{
  return list(value).map((item,index)=>{
    const raw=record(item);const readable=raw.readable===true||String(raw.readable)==="true"?true:
      raw.readable==="partial"?"partial":false;
    const status=REGION_STATUS.includes(String(raw.status) as WholeAnswerRegion["status"])
      ?String(raw.status) as WholeAnswerRegion["status"]:"not_checkable";
    return {region_id:String(raw.region_id||`region-${index+1}`),description:String(raw.description||`解答領域${index+1}`),
      answer_present:bool(raw.answer_present),readable,reference_available:bool(raw.reference_available),status,
      finding_ids:strings(raw.finding_ids)};
  });
}

export function normalizeDiagnosticUncertainties(value:unknown):DiagnosticUncertainty[]{
  const seen=new Set<string>();
  return list(value).map((item,index)=>{
    const raw=record(item);const reason=["handwriting","missing_reference","ambiguous_formula","other"].includes(String(raw.reason))
      ?String(raw.reason) as DiagnosticUncertainty["reason"]:"other";
    return {region_id:String(raw.region_id||`uncertain-region-${index+1}`),description:String(raw.description||"判定できない答案領域"),reason,
      potential_materiality:raw.potential_materiality==="major"?"major":"minor",
      confidence:raw.confidence==="medium"?"medium":"low",candidate_interpretations:strings(raw.candidate_interpretations),
      user_action_required:bool(raw.user_action_required)} satisfies DiagnosticUncertainty;
  }).filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true;});
}

export function normalizeWholeAnswerScan(value:unknown,context?:ProblemContextPack):WholeAnswerScan{
  if(!value||typeof value!=="object")return {...UNCONFIRMED_WHOLE_ANSWER_SCAN,app_reference_coverage:suppliedReferenceCoverage(context)};
  const raw=record(value);const attachments=normalizeAttachments(raw.attachments||raw.attachment_inventory);
  const app=coverage(raw.app_reference_coverage,suppliedReferenceCoverage(context));
  const legacy=coverage(raw.reference_coverage);
  const effective=strongest(app,attachmentReferenceCoverage(attachments),coverage(raw.effective_reference_coverage,legacy));
  const written=coverage(raw.written_answer_coverage,attachments.some(row=>row.kind==="current_answer"&&row.coverage==="full")?"full":
    attachments.some(row=>row.kind==="current_answer"&&row.coverage==="partial")?"partial":
      raw.written_answer_coverage==null&&raw.reference_coverage==="full"?"full":"insufficient");
  const requestedPerformed=bool(raw.performed);const performed=requestedPerformed&&effective!=="insufficient"&&written!=="insufficient";
  return {performed,reference_coverage:effective,app_reference_coverage:app,effective_reference_coverage:effective,
    written_answer_coverage:written,confidence:confidence(raw.confidence),
    reason:String(raw.reason||(!performed?UNCONFIRMED_WHOLE_ANSWER_SCAN.reason:"照合可能な答案領域をすべて監査しました。")),
    attachments,regions:normalizeRegions(raw.regions)};
}

export type WholeAnswerDiagnosticIssue={category:
  "written_answer_region_unaccounted"|"readable_region_not_evaluated"|"material_uncertainty_not_surfaced"|
  "whole_scan_empty_with_material_uncertainty"|"same_root_duplicate_target";detail:string};

export function wholeAnswerDiagnosticIssues(scan:WholeAnswerScan|undefined,findings:ObservedOutOfScopeFinding[]=[],uncertainties:DiagnosticUncertainty[]=[]):WholeAnswerDiagnosticIssue[]{
  if(!scan)return [];
  const issues:WholeAnswerDiagnosticIssue[]=[];
  if(scan.written_answer_coverage!=="insufficient"&&scan.regions.length===0)issues.push({category:"written_answer_region_unaccounted",detail:"答案ページはあるのに解答領域inventoryがありません。"});
  for(const region of scan.regions){
    if(region.answer_present&&region.readable===true&&region.status==="not_checkable")issues.push({category:"readable_region_not_evaluated",detail:`${region.region_id} は判読可能ですが評価されていません。`});
    if(region.status==="uncertain"&&!uncertainties.some(row=>row.region_id===region.region_id))issues.push({category:"material_uncertainty_not_surfaced",detail:`${region.region_id} の不確実性が構造化されていません。`});
  }
  if(!findings.length&&uncertainties.some(row=>row.potential_materiality==="major")&&!uncertainties.some(row=>row.user_action_required))issues.push({category:"whole_scan_empty_with_material_uncertainty",detail:"重大になり得る判定不能箇所が利用者へ提示されていません。"});
  const roots=new Map<string,number>();for(const row of findings){if(row.root_cause_key)roots.set(row.root_cause_key,(roots.get(row.root_cause_key)||0)+1);}
  for(const [root,count] of roots)if(count>1&&new Set(findings.filter(row=>row.root_cause_key===root).map(row=>row.stable_target_key).filter(Boolean)).size>1)issues.push({category:"same_root_duplicate_target",detail:`root ${root} が複数stable targetへ昇格しています。`});
  return issues;
}

export function wholeAnswerDiagnosticFingerprint(value:{scan?:WholeAnswerScan;findings?:ObservedOutOfScopeFinding[];uncertainties?:DiagnosticUncertainty[]}){
  const stable={scan:value.scan||UNCONFIRMED_WHOLE_ANSWER_SCAN,findings:[...(value.findings||[])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
    uncertainties:[...(value.uncertainties||[])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
  let hash=2166136261;for(const char of JSON.stringify(stable)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return `wad-${(hash>>>0).toString(16).padStart(8,"0")}`;
}

export function parseWholeAnswerRediagnosis(text:string,context?:ProblemContextPack){
  const fenced=text.match(/```(?:ya?ml)?\s*([\s\S]*?)```/i)?.[1]||text;
  const doc=record(yaml.load(fenced));const raw=record(doc.whole_answer_diagnostic_update||doc);
  const findings=list(raw.observed_out_of_scope_findings).map((item,index)=>{const row=record(item);const rawLevel=row.mastery_level??row.mastery_area??"other",area=String(rawLevel);
    const numeric=Number(rawLevel),mastery_area=(["skeleton","main_calc","transfer","other"].includes(area)?area:
      numeric===1?"skeleton":numeric===3?"transfer":numeric===2?"main_calc":"other") as ObservedOutOfScopeFinding["mastery_area"];
    const mastery_level=([1,2,3].includes(numeric)?numeric:mastery_area==="skeleton"?1:mastery_area==="transfer"?3:2) as 1|2|3;
    return {mastery_level,mastery_area,finding_id:String(row.finding_id||`finding-${index+1}`),finding:String(row.finding||""),evidence:String(row.evidence||""),correction:String(row.correction||""),
      materiality:row.materiality==="major"?"major":"minor",confidence:["low","medium","high"].includes(String(row.confidence))?String(row.confidence) as ObservedOutOfScopeFinding["confidence"]:"low",
      create_target_candidate:bool(row.create_target_candidate),root_cause_key:String(row.root_cause_key||"")||undefined} satisfies ObservedOutOfScopeFinding;});
  const scan=normalizeWholeAnswerScan(raw.whole_answer_scan,context);const uncertainties=normalizeDiagnosticUncertainties(raw.diagnostic_uncertainties);
  return {attemptId:Number(raw.attempt_id)||undefined,problemId:String(raw.problem_id||""),wholeAnswerScan:scan,findings,uncertainties,
    fingerprint:wholeAnswerDiagnosticFingerprint({scan,findings,uncertainties})};
}

export function wholeAnswerScanSummary(scan:WholeAnswerScan|undefined,findingCount:number,uncertaintyCount=0){
  const current=scan||UNCONFIRMED_WHOLE_ANSWER_SCAN;const checked=current.regions.filter(row=>row.status==="checked_correct"||row.status==="checked_error").length;
  if(!current.performed||current.effective_reference_coverage==="insufficient")return {tone:"warning" as const,title:"答案全体の追加誤りは未確認",detail:current.reason};
  if(uncertaintyCount)return {tone:"warning" as const,title:`答案全体の追加確認・判定不能 ${uncertaintyCount}件`,detail:`確認済み ${checked}領域${findingCount?`・追加major ${findingCount}件`:""}。判定不能箇所を「追加誤りなし」とは扱いません。`};
  if(current.effective_reference_coverage==="partial"||current.written_answer_coverage!=="full")return {tone:"warning" as const,title:`答案全体を一部確認${findingCount?`・追加finding ${findingCount}件`:""}`,detail:`確認済み ${checked}領域。参照または答案coverageが一部のため、追加誤りなしとは確定しません。`};
  return findingCount?{tone:"danger" as const,title:`答案全体の追加確認・major ${findingCount}件`,detail:`答案 ${checked}領域を確認しました。`}:
    {tone:"success" as const,title:"答案全体の追加確認・major errorなし",detail:`完全な参照情報で、答案に書かれた ${checked}領域を確認しました。`};
}
