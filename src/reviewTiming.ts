import type { StudyUpdate } from "./types.ts";

const ERROR_ORDER=["K","N","W","C"] as const;
const ERROR_DAYS:Record<string,number>={K:1,N:2,W:3,C:7,none:14};
const TIMING_SOURCE="(?:[0-9０-９]+\\s*日後|次回復習日|次回復習|数日後|明日|来週|後で)";
const TIMING_PATTERN=new RegExp(TIMING_SOURCE,"g");
const TIMING_WITH_PARTICLE=new RegExp(`${TIMING_SOURCE}(?:\\s*(?:に|の|は|で|を|、|,|:|：))*\\s*`,"g");

export function reviewDaysForErrors(errors:string[]|undefined){
  const normalized=[...new Set((errors||[]).map(String).filter(error=>ERROR_ORDER.includes(error as typeof ERROR_ORDER[number])))]
    .sort((a,b)=>ERROR_ORDER.indexOf(a as typeof ERROR_ORDER[number])-ERROR_ORDER.indexOf(b as typeof ERROR_ORDER[number]));
  return ERROR_DAYS[normalized[0]||"none"];
}

export function findTimingExpressions(text:string|undefined){
  return [...new Set(String(text||"").match(TIMING_PATTERN)||[])];
}

export function removeTimingExpressions(text:string|undefined){
  return String(text||"")
    .replace(TIMING_WITH_PARTICLE,"")
    .replace(/^[\s、,。：:]+/,"")
    .replace(/\s{2,}/g," ")
    .replace(/([。！？])\1+/g,"$1")
    .trim();
}

type TimingField={field:string;text:string};

export function timingFields(update:StudyUpdate):TimingField[]{
  return [
    {field:"next_action",text:update.next_action||""},
    {field:"result_summary",text:update.result_summary||""},
    ...(update.weak_notes||[]).flatMap((note,index)=>[
      {field:`weak_notes[${index}].mistake`,text:note.mistake||""},
      {field:`weak_notes[${index}].correction_rule`,text:note.correction_rule||""}
    ]),
    ...(update.s_check_suggestions||[]).map((suggestion,index)=>({
      field:`s_check_suggestions[${index}].reason`,text:suggestion.reason||""
    }))
  ];
}

export function timingWarnings(update:StudyUpdate){
  return timingFields(update).flatMap(({field,text})=>
    findTimingExpressions(text).map(expression=>`${field}: ${expression}`)
  );
}

export function sanitizeStudyUpdateTiming(update:StudyUpdate):StudyUpdate{
  const detected=[...new Set([...(update.date_expression_warnings||[]),...timingWarnings(update)])];
  return {
    ...update,
    review_after_days:reviewDaysForErrors(update.error_types?.length?update.error_types:[update.primary_error_type||update.error_type]),
    next_action:removeTimingExpressions(update.next_action),
    result_summary:removeTimingExpressions(update.result_summary),
    weak_notes:update.weak_notes?.map(note=>({
      ...note,
      mistake:removeTimingExpressions(note.mistake),
      correction_rule:removeTimingExpressions(note.correction_rule)
    })),
    weak_note:update.weak_note?{
      ...update.weak_note,
      mistake:removeTimingExpressions(update.weak_note.mistake),
      correction_rule:removeTimingExpressions(update.weak_note.correction_rule)
    }:undefined,
    s_check_suggestions:update.s_check_suggestions?.map(suggestion=>({
      ...suggestion,reason:removeTimingExpressions(suggestion.reason)
    })),
    date_expression_warnings:detected,
    date_expressions_removed:detected.length>0
  };
}

export const timingWarningMessage=
  "文章内に日付表現が含まれています。復習日は K/W/N/C から自動計算されるため、文章から日付表現を削除してください。";
