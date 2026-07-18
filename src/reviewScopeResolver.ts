import type { Attempt, Review, Task } from "./types.ts";
import { classifyKPolicyValidity, type KPolicySource } from "./legacyKPolicy.ts";

export type EffectiveReviewScope="targeted_patch"|"full_skeleton"|"main_calc_target"|"check_only"|"full_answer";
export type EffectiveReviewMode="check"|"skeleton"|"main_calc"|"full"|"scan5";
export type EffectiveSheetType="check_sheet"|"skeleton_sheet"|"main_calc_sheet"|"full_answer_sheet"|"scan5_sheet";
export type AllowedReviewError="K"|"W"|"N"|"C";

export type ReviewScopeResolution={
  effectiveReviewScope:EffectiveReviewScope;
  targetedParts:string[];
  completionConditions:string[];
  effectiveMode:EffectiveReviewMode;
  sheetType:EffectiveSheetType;
  allowedErrorTypes:AllowedReviewError[];
  requiresKEvidence:boolean;
  source:"explicit_scope"|"targeted_parts"|"completion_conditions"|"mode_rule";
};

type ScopeItem=Partial<Review&Task>&{
  review_scope?:string;
  effective_review_scope?:string;
  targeted_parts?:string[];
  scope_completion_conditions?:string[];
};

const scopes:EffectiveReviewScope[]=["targeted_patch","full_skeleton","main_calc_target","check_only","full_answer"];
const modes:EffectiveReviewMode[]=["check","skeleton","main_calc","full","scan5"];

export function sheetTypeForMode(mode:EffectiveReviewMode):EffectiveSheetType{
  if(mode==="check")return "check_sheet";
  if(mode==="skeleton")return "skeleton_sheet";
  if(mode==="main_calc")return "main_calc_sheet";
  if(mode==="full")return "full_answer_sheet";
  return "scan5_sheet";
}

function cleanParts(values:unknown[]){
  return [...new Set(values.flatMap(value=>Array.isArray(value)?value:[value]).map(value=>String(value||"").trim())
    .filter(value=>value&&value!=="大きな問題なし"&&value!=="なし"))].slice(0,8);
}

export function targetPartsFromAttempt(attempt?:Attempt,item?:ScopeItem){
  return cleanParts([
    item?.targeted_parts||[],
    attempt?.unresolved_carryover||[],
    attempt?.required_work_shown||[],
    attempt?.error_point,
    attempt?.next_action,
  ]);
}

function scopeFromMode(mode:EffectiveReviewMode,item:ScopeItem):EffectiveReviewScope{
  if(item.requires_full_answer||mode==="full")return "full_answer";
  if(mode==="main_calc")return "main_calc_target";
  if(mode==="check")return "check_only";
  return "full_skeleton";
}

function scopeFromConditions(conditions:string[]):EffectiveReviewScope|null{
  const text=conditions.join(" ");
  if(/フル答案|結論まで|答案全体/.test(text))return "full_answer";
  if(/指定|該当|不足|修正箇所|対象部分/.test(text))return "targeted_patch";
  if(/計算|積分|和|式変形/.test(text))return "main_calc_target";
  if(/型・初手|注意点|軽く確認/.test(text))return "check_only";
  if(/骨格|方針|出発式/.test(text))return "full_skeleton";
  return null;
}

function defaultConditions(scope:EffectiveReviewScope,parts:string[]){
  if(scope==="targeted_patch")return parts.length
    ?parts.slice(0,3).map(part=>`指定箇所「${part}」を、参照を隠して自力で再現した`)
    :["前回指定された箇所だけを、参照を隠して自力で再現した"];
  if(scope==="main_calc_target")return ["指定された計算の開始式を書いた","指定計算を途中式付きで完了した","範囲・添字・符号を確認した"];
  if(scope==="check_only")return ["型・初手・今見る量を確認した","指定された注意点を1つ確認した"];
  if(scope==="full_answer")return ["制限時間内に答案を書いた","条件・計算・結論の対応を確認した"];
  return ["方針・出発式・今見る量を書いた","条件・道具・解答の流れを書いた","最後に示すことを具体式なしで書いた"];
}

function allowedErrors(scope:EffectiveReviewScope,parts:string[]){
  const kTarget=/型|方針|入口|出発式|主役|統計量|道具|定理|大きな流れ/.test(parts.join(" "));
  if(scope==="full_answer"||scope==="full_skeleton")return ["K","W","N","C"] as AllowedReviewError[];
  if(scope==="main_calc_target")return ["W","N","C"] as AllowedReviewError[];
  if(scope==="check_only")return ["N","C"] as AllowedReviewError[];
  return (kTarget?["K","W","N","C"]:["W","N","C"]) as AllowedReviewError[];
}

export function resolveReviewScope({item,targetAttempt}:{item:ScopeItem;targetAttempt?:Attempt}):ReviewScopeResolution{
  const modeRaw=item.mode_override||item.effective_mode||item.mode||"check";
  const effectiveMode=(modes.includes(modeRaw as EffectiveReviewMode)?modeRaw:"check") as EffectiveReviewMode;
  const explicit=String(item.effective_review_scope||item.review_scope||"") as EffectiveReviewScope;
  const targetedParts=targetPartsFromAttempt(targetAttempt,item);
  const storedConditions=cleanParts([item.scope_completion_conditions||[]]);
  let effectiveReviewScope:EffectiveReviewScope,source:ReviewScopeResolution["source"];
  if(scopes.includes(explicit)){effectiveReviewScope=explicit;source="explicit_scope"}
  else if(targetedParts.length){effectiveReviewScope=effectiveMode==="main_calc"?"main_calc_target":"targeted_patch";source="targeted_parts"}
  else {
    const fromConditions=scopeFromConditions(storedConditions);
    if(fromConditions){effectiveReviewScope=fromConditions;source="completion_conditions"}
    else {effectiveReviewScope=scopeFromMode(effectiveMode,item);source="mode_rule"}
  }
  const completionConditions=storedConditions.length&&source!=="targeted_parts"?storedConditions:defaultConditions(effectiveReviewScope,targetedParts);
  const allowedErrorTypes=allowedErrors(effectiveReviewScope,targetedParts);
  return {effectiveReviewScope,targetedParts,completionConditions,effectiveMode,sheetType:sheetTypeForMode(effectiveMode),
    allowedErrorTypes,requiresKEvidence:allowedErrorTypes.includes("K"),source};
}

export function validKEvidence(value:unknown){
  const rows=Array.isArray(value)?value.map(String):String(value||"").split(/\n+/);
  return rows.some(row=>row.trim().length>=6&&!/^(なし|不明|空欄)$/.test(row.trim()));
}

export function effectiveErrorsForAutomation(errors:string[],rubricVersion:string|undefined,kEvidence:unknown,context?:KPolicySource){
  const normalized=[...new Set(errors.filter(error=>["K","W","N","C"].includes(error)))];
  if(!normalized.includes("K"))return normalized;
  if(context){
    const validity=classifyKPolicyValidity({...context,error_types:normalized,rubric_version:rubricVersion,k_evidence:Array.isArray(kEvidence)?kEvidence.map(String):[]});
    if(validity==="invalid_legacy_k")return normalized.filter(error=>error!=="K");
    return normalized;
  }
  if(["STAT1-REVIEW-v9","STAT1-GRADE-v5"].includes(String(rubricVersion||""))&&!validKEvidence(kEvidence))return normalized.filter(error=>error!=="K");
  return normalized;
}
