import type { Attempt, Problem, ProblemAlias, Review, Task } from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { resolveLearningPolicy, type LearningPrescription } from "./learningPolicyResolver.ts";
import { metadataQuality, safeGenericGuidance, type MetadataQuality } from "./metadataQuality.ts";
import { resolveReviewScope, sheetTypeForMode, type EffectiveReviewScope } from "./reviewScopeResolver.ts";
import {
  completionChecklist,
  correctionTheme,
  oneLineHint,
  referenceEntryPoint,
  reviewAim,
  safeReviewActions,
} from "./reviewExperience.ts";

export type ReviewMode="check"|"skeleton"|"main_calc"|"full"|"scan5";
export type SheetType="check_sheet"|"skeleton_sheet"|"main_calc_sheet"|"full_answer_sheet"|"scan5_sheet";
export type ResolverErrorType="K"|"W"|"N"|"C"|"none";

export type DerivedProvenance={
  problemId:string;
  attemptId?:number;
  evaluationId?:number;
  relationId?:string;
  masterVersion:string;
  generatedAt:string;
};

export type DerivedField<T>={value:T;provenance:DerivedProvenance};

export type ConsistencyWarning={
  code:string;
  message:string;
  repairable:boolean;
  blocksSpecificGuidance?:boolean;
  suggestedValue?:string;
};

export type ResolvedReviewCard={
  taskId:string;
  problemId:string;
  canonicalProblemId:string;
  displayLabel:string;
  theme:string;
  canonicalProblemType:string;
  taskOrigin:"first_attempt"|"review_attempt"|"linked_s_check"|"related_drill"|"past_exam_followup";
  errorTypes:ResolverErrorType[];
  primaryErrorType:ResolverErrorType;
  inferredMode:ReviewMode;
  modeOverride?:ReviewMode;
  effectiveMode:ReviewMode;
  effectiveReviewScope:EffectiveReviewScope;
  targetedParts:string[];
  allowedErrorTypes:ResolverErrorType[];
  requiresKEvidence:boolean;
  metadataQuality:MetadataQuality;
  reviewMethodLabel:string;
  sheetType:SheetType;
  sheetLabel:string;
  estimatedMinutes:number;
  reviewGoal:DerivedField<string>;
  correctionTheme:DerivedField<string>;
  entryHint:DerivedField<string>;
  oneLineHint:DerivedField<string>;
  todayActions:DerivedField<string[]>;
  completionConditions:DerivedField<string[]>;
  dueDate:string;
  reviewAfterDays:number|null;
  daysUntilDue:number|null;
  targetAttempt?:Attempt;
  sourceAttempt?:Attempt;
  sourceProblem?:{problemId:string;displayLabel:string;sourceIssue:string};
  consistencyWarnings:ConsistencyWarning[];
  reviewNeeded:boolean;
  prescription:LearningPrescription;
};

type ReviewCardInput=Partial<Review&Task> & {
  mode_override?:string;
  modeOverride?:string;
  effective_mode?:string;
  sheet_type?:string;
  sheet_name?:string;
  metadata_status?:string;
  derived_from_problem_id?:string;
  derived_from_attempt_id?:number;
  derived_from_master_version?:string;
  derived_fields?:Record<string,DerivedField<unknown>>;
};

const modeLabels:Record<ReviewMode,string>={
  check:"軽い想起チェック",
  skeleton:"骨格確認",
  main_calc:"主要計算の補修",
  full:"フル答案",
  scan5:"5問スキャン・選題",
};

const sheetLabels:Record<SheetType,string>={
  check_sheet:"チェックシート",
  skeleton_sheet:"骨格答案シート",
  main_calc_sheet:"主要計算シート",
  full_answer_sheet:"フル答案シート",
  scan5_sheet:"5問スキャン・選題シート",
};

function isReviewMode(value:unknown):value is ReviewMode{
  return ["check","skeleton","main_calc","full","scan5"].includes(String(value));
}

export function getSheetType(mode:ReviewMode):SheetType{
  return sheetTypeForMode(mode);
}

function normalizeErrors(attempt?:Attempt):ResolverErrorType[]{
  const raw=attempt?.error_types?.length?attempt.error_types:[attempt?.primary_error_type||attempt?.error_type||"none"];
  const values=[...new Set(raw.map(String).filter(value=>["K","N","W","C"].includes(value)))] as ResolverErrorType[];
  return values.length?values:["none"];
}

export function inferReviewMode(errors:ResolverErrorType[],item?:ReviewCardInput):ReviewMode{
  if(item?.requires_full_answer||item?.review_type==="exam_90min"||item?.mode==="exam_90min") return "full";
  if(item?.review_type==="scan5"||item?.mode==="scan"||item?.mode==="scan5") return "scan5";
  if(errors.includes("K")||errors.includes("N")) return "skeleton";
  if(errors.includes("W")) return "main_calc";
  return "check";
}

function parseDate(value:string){
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])):NaN;
}

export function addCalendarDays(value:string,days:number){
  const timestamp=parseDate(value);
  if(!Number.isFinite(timestamp)) return "";
  const date=new Date(timestamp+days*86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
}

export function differenceInCalendarDays(later:string,earlier:string){
  const a=parseDate(later),b=parseDate(earlier);
  return Number.isFinite(a)&&Number.isFinite(b)?Math.round((a-b)/86400000):null;
}

function latestAttemptFor(canonicalId:string,attempts:Attempt[],aliases:ProblemAlias[]){
  return attempts
    .filter(attempt=>resolveCanonicalProblemId(attempt.problem_id,aliases)===canonicalId)
    .sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
}

function taskOriginFor(item:ReviewCardInput,problem:Problem|undefined,hasOwnAttempt:boolean,warnings:ConsistencyWarning[]){
  let origin=item.task_origin||((item.id||item.review_type)?"review_attempt":"first_attempt");
  if(origin==="linked_s_check"&&problem?.category!=="S"){
    warnings.push({code:"linked_s_target_is_not_s",message:"A問題を関連S確認として扱っていたため、関連補修として解決しました。",repairable:true});
    origin="related_drill";
  }
  if(origin==="linked_s_check"&&!item.source_problem_id){
    warnings.push({code:"linked_s_source_missing",message:"関連確認の元問題がありません。",repairable:false,blocksSpecificGuidance:true});
  }
  if(origin==="review_attempt"&&!hasOwnAttempt){
    warnings.push({code:"review_without_attempt",message:"対象問題自身の履歴がないため、初回として解決しました。",repairable:true});
    origin="first_attempt";
  }else if(origin==="first_attempt"&&hasOwnAttempt){
    warnings.push({code:"first_with_attempt",message:"対象問題自身の履歴があるため、復習として解決しました。",repairable:true});
    origin="review_attempt";
  }
  return origin;
}

function storedSheetMismatch(item:ReviewCardInput,effective:ReviewMode){
  const stored=String(item.sheet_type||item.sheet_name||"");
  if(!stored) return false;
  const expected=getSheetType(effective);
  const aliases:Record<SheetType,string[]>={
    check_sheet:["check_sheet","チェックシート"],skeleton_sheet:["skeleton_sheet","骨格答案シート","骨格シート"],
    main_calc_sheet:["main_calc_sheet","主要計算シート"],full_answer_sheet:["full_answer_sheet","フル答案シート"],
    scan5_sheet:["scan5_sheet","5問スキャン・選題シート","5問スキャンシート"],
  };
  return !aliases[expected].some(value=>stored.includes(value));
}

function provenance(problem:Problem,attempt:Attempt|undefined,now:string):DerivedProvenance{
  return {problemId:problem.problem_id,attemptId:attempt?.id,masterVersion:problem.master_version||"unversioned",generatedAt:now};
}

export function resolveReviewCard({
  item,problems,attempts,aliases,today,examDate="",now=new Date().toISOString(),
}:{item:ReviewCardInput;problems:Problem[];attempts:Attempt[];aliases:ProblemAlias[];today:string;examDate?:string;now?:string}):ResolvedReviewCard{
  const warnings:ConsistencyWarning[]=[];
  const canonicalId=resolveCanonicalProblemId(String(item.problem_id||""),aliases);
  const problem=problems.find(entry=>resolveCanonicalProblemId(entry.problem_id,aliases)===canonicalId);
  const sourceAttemptId=Number(item.source_attempt_id||item.generated_from_attempt_id||0);
  const sourceAttempt=sourceAttemptId?attempts.find(attempt=>attempt.id===sourceAttemptId):undefined;
  const latestOwn=latestAttemptFor(canonicalId,attempts,aliases);
  const generatedIsOwn=sourceAttempt&&resolveCanonicalProblemId(sourceAttempt.problem_id,aliases)===canonicalId?sourceAttempt:undefined;
  const targetAttempt=generatedIsOwn||latestOwn;
  if(!problem) warnings.push({code:"problem_missing",message:"problem_masterに対象問題がありません。",repairable:false,blocksSpecificGuidance:true});
  const sourceMismatch=sourceAttempt&&resolveCanonicalProblemId(sourceAttempt.problem_id,aliases)!==canonicalId;
  const verifiedLinked=item.origin==="verified_linked_problem"&&!!item.relation_id&&item.origin_verified===true;
  const inactiveReview=["done","completed","cancelled","superseded","ignored"].includes(String(item.status||""));
  // 完了済みの旧 linked S と superseded 済みカードは履歴であり、現在対応が必要な
  // source mismatch ではない。出所修復は ReviewOriginResolver の active 判定に限定する。
  if(sourceMismatch&&!verifiedLinked&&!inactiveReview){
    warnings.push({code:"attempt_problem_mismatch",message:"復習元Attemptの問題IDが対象問題と一致しません。",repairable:false,blocksSpecificGuidance:true});
  }
  const metadataStatus=(problem as (Problem&{metadata_status?:string})|undefined)?.metadata_status;
  if(problem&&(!problem.theme||problem.theme==="要確認"||metadataStatus==="review_needed"||metadataStatus==="metadata_review_needed")){
    warnings.push({code:"metadata_review_needed",message:"問題マスターの内容確認が必要です。",repairable:false,blocksSpecificGuidance:true});
  }
  const origin=taskOriginFor(item,problem,!!targetAttempt,warnings);
  // source問題の採点内容をtarget問題の前回ミス・採点範囲へ混ぜない。
  const errorSource=targetAttempt;
  const errors=normalizeErrors(errorSource);
  const plannedMode=item.mode==="scan"?"scan5":item.mode;
  const inferred=origin==="first_attempt"&&isReviewMode(plannedMode)?plannedMode:inferReviewMode(errors,item);
  const overrideRaw=item.mode_override||item.modeOverride;
  const override=isReviewMode(overrideRaw)?overrideRaw:undefined;
  const prescription=resolveLearningPolicy({
    problemId:canonicalId,problem,
    source:{...targetAttempt,...item,mode_override:override} as Partial<Attempt&Review&Task>,
    learningPurpose:item.learning_purpose,
    learningStage:item.learning_stage,
    assessmentTiming:item.assessment_timing,
    targetedParts:item.targeted_parts,
  });
  const planningErrors=(prescription.effectiveErrorTypes.length?prescription.effectiveErrorTypes:["none"]) as ResolverErrorType[];
  const effective=(override||(prescription.mode==="exam_90min"?"full":prescription.mode)) as ReviewMode;
  const scope={
    effectiveMode:effective,
    effectiveReviewScope:prescription.reviewScope as EffectiveReviewScope,
    targetedParts:prescription.targetedParts,
    completionConditions:prescription.completionConditions,
    allowedErrorTypes:[...prescription.allowedErrorTypes] as ResolverErrorType[],
    requiresKEvidence:prescription.requiresKEvidence,
  };
  if(storedSheetMismatch(item,effective)) warnings.push({code:"mode_sheet_mismatch",message:`復習形式を${modeLabels[effective]}、使用シートを${sheetLabels[getSheetType(effective)]}へ統一しました。`,repairable:true});
  if(item.mode&&isReviewMode(item.mode)&&item.mode!==effective&&!override){
    warnings.push({code:"stored_mode_stale",message:`保存済みモードではなく、K/W/N/Cから${modeLabels[effective]}を再判定しました。`,repairable:true});
  }
  const interval=Number.isFinite(Number(item.interval_days))?Number(item.interval_days):null;
  const dueDate=String(item.due_date||"");
  const attemptDate=sourceAttempt?.date||targetAttempt?.date||"";
  const normalDue=interval!=null&&attemptDate?addCalendarDays(attemptDate,interval):"";
  const examBoundary=examDate?addCalendarDays(examDate,-2):"";
  const expectedDue=normalDue&&examDate>attemptDate&&normalDue>=examBoundary
    ?(addCalendarDays(examDate,-3)>attemptDate?addCalendarDays(examDate,-3):addCalendarDays(attemptDate,1))
    :normalDue;
  const wasPostponed=!!(item.postponed_at||item.postpone_count||item.postponed_count);
  if(expectedDue&&dueDate&&expectedDue!==dueDate&&!wasPostponed){
    warnings.push({code:"due_date_interval_mismatch",message:`復習日${dueDate}は${attemptDate}から${interval}日後と一致しません。${expectedDue}へ補正できます。`,repairable:true,suggestedValue:expectedDue});
  }
  const sourceProblemId=item.source_problem_id||((origin==="linked_s_check"||origin==="related_drill")?sourceAttempt?.problem_id:undefined);
  const sourceCanonical=sourceProblemId?resolveCanonicalProblemId(sourceProblemId,aliases):"";
  if(sourceCanonical&&sourceCanonical===canonicalId) warnings.push({code:"source_target_self_reference",message:"元問題と対象問題が同一です。",repairable:true,blocksSpecificGuidance:true});
  const sourceProblem=sourceCanonical?problems.find(entry=>resolveCanonicalProblemId(entry.problem_id,aliases)===sourceCanonical):undefined;
  const blocked=warnings.some(warning=>warning.blocksSpecificGuidance);
  const master=problem||({id:0,problem_id:canonicalId,source_type:"whitebook",category:"A",chapter:null,problem_number:0,
    display_label:canonicalId,title:canonicalId,theme:"要確認",priority:"repair",role:"training",recommended_mode:"check",
    linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"review_needed",
    canonical_problem_type:"要確認",canonical_keywords:[],master_version:"unversioned"} satisfies Problem);
  const generatedItem={
    ...item,
    problem_id:canonicalId,
    title:master.display_label||master.title||canonicalId,
    theme:master.theme,
    canonical_problem_type:master.canonical_problem_type||"要確認",
    canonical_keywords:master.canonical_keywords||[],
    mode:effective,
    review_method:modeLabels[effective],
    review_instruction:"",
    review_steps:[],
    review_goal_public:undefined,
    requires_full_answer:effective==="full",
    error_type:planningErrors[0],
    previous_errors:planningErrors,
    previous_date:targetAttempt?.date,
    previous_error_point:targetAttempt?.error_point||"",
    previous_next_action:targetAttempt?.next_action||"",
    previous_improvement_guidance:targetAttempt?.improvement_guidance||"",
    previous_required_derivation:targetAttempt?.required_derivation||"",
  };
  const pv=provenance(master,targetAttempt,now);
  const fallback="問題情報または前回記録の確認が必要です";
  const make=<T,>(value:T):DerivedField<T>=>({value,provenance:pv});
  const specific=(factory:()=>string)=>blocked?fallback:factory();
  const quality=metadataQuality(problem);
  const generic=safeGenericGuidance(problem,targetAttempt);
  const actions=blocked?[fallback]:quality==="generic"
    ?scope.targetedParts.slice(0,3).map(part=>`指定箇所「${part}」を確認する`).concat(scope.targetedParts.length?[]:["前回指定された箇所を確認する"])
    :safeReviewActions(generatedItem);
  const completion=blocked?[fallback]:scope.completionConditions;
  const sourceIssue=sourceAttempt?.error_point||item.source_error_summary||"元問題の弱点を確認";
  return {
    taskId:String(item.id??`${canonicalId}:${item.review_type||item.kind||"task"}`),problemId:String(item.problem_id||""),canonicalProblemId:canonicalId,
    displayLabel:master.display_label||master.title||canonicalId,theme:master.theme||"要確認",canonicalProblemType:master.canonical_problem_type||"要確認",
    taskOrigin:origin,errorTypes:planningErrors,primaryErrorType:planningErrors[0],inferredMode:inferred,modeOverride:override,effectiveMode:effective,
    effectiveReviewScope:scope.effectiveReviewScope,targetedParts:scope.targetedParts,
    allowedErrorTypes:scope.allowedErrorTypes,requiresKEvidence:scope.requiresKEvidence,metadataQuality:quality,
    reviewMethodLabel:modeLabels[effective],sheetType:getSheetType(effective),sheetLabel:sheetLabels[getSheetType(effective)],
    estimatedMinutes:Number(item.estimated_minutes||item.minutes||item.duration_minutes||5),
    reviewGoal:make(specific(()=>quality==="generic"?"前回指定された箇所を確認する":reviewAim(generatedItem))),
    correctionTheme:make(specific(()=>quality==="generic"?generic.correctionTheme:correctionTheme(generatedItem))),
    entryHint:make(specific(()=>quality==="generic"?generic.entryHint:referenceEntryPoint(generatedItem))),
    oneLineHint:make(specific(()=>quality==="generic"?generic.oneLineHint:oneLineHint(generatedItem))),
    todayActions:make(actions),completionConditions:make(completion),dueDate,reviewAfterDays:interval,daysUntilDue:dueDate?differenceInCalendarDays(dueDate,today):null,
    targetAttempt,sourceAttempt,
    sourceProblem:sourceProblem?{problemId:sourceCanonical,displayLabel:sourceProblem.display_label||sourceProblem.title||sourceCanonical,sourceIssue}:undefined,
    consistencyWarnings:warnings,reviewNeeded:blocked,prescription:{...prescription,mode:effective,sheetType:getSheetType(effective)},
  };
}

export function correctedDueDate(card:ResolvedReviewCard){
  const warning=card.consistencyWarnings.find(item=>item.code==="due_date_interval_mismatch");
  return warning?.suggestedValue||card.dueDate;
}

export const reviewModeLabel=(mode:ReviewMode)=>modeLabels[mode];
export const reviewSheetLabel=(sheet:SheetType)=>sheetLabels[sheet];
