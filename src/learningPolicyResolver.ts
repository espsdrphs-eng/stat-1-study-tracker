import type {
  AssessmentTiming, Attempt, LearningPurpose, LearningStage, Problem, Review, TargetKind, Task,
} from "./types.ts";
import { classifyKPolicyValidity, mathematicalPatchTargets, planningErrorsForSource, type KPolicyValidity } from "./legacyKPolicy.ts";

export const LEARNING_POLICY_VERSION="STAT1-LEARNING-v1";

export type PolicyReviewScope="targeted_patch"|"main_calc_target"|"full_skeleton"|"check_only"|"full_answer"|"scan5";
export type PolicyMode="check"|"skeleton"|"main_calc"|"full"|"scan5"|"exam_90min";
export type PolicySheetType="check_sheet"|"skeleton_sheet"|"main_calc_sheet"|"full_answer_sheet"|"scan5_sheet";

export interface LearningPrescription {
  problemId:string;
  learningPurpose:LearningPurpose;
  learningStage:LearningStage;
  assessmentTiming:AssessmentTiming;
  reviewScope:PolicyReviewScope;
  targetKind?:TargetKind;
  targetedParts:string[];
  mode:PolicyMode;
  sheetType:PolicySheetType;
  allowedReferenceLevel:number;
  estimatedMinutes:number;
  completionConditions:string[];
  requiredEvidence:string[];
  allowedErrorTypes:Array<"K"|"W"|"N"|"C">;
  effectiveErrorTypes:Array<"K"|"W"|"N"|"C">;
  kPolicyValidity:KPolicyValidity;
  requiresKEvidence:boolean;
  successTransition?:string;
  failureTransition?:string;
  schedulingReason:string;
  policyVersion:string;
}

type PolicySource={
  [key:string]:unknown; error_types?:string[];primary_error_type?:string;error_type?:string;
  learning_purpose?:LearningPurpose;learning_stage?:LearningStage;assessment_timing?:AssessmentTiming;
  mode?:string;generated_from_review_id?:number;generated_from_attempt_id?:number;
  targeted_parts?:string[];unresolved_carryover?:string[];required_work_shown?:string[];
  error_point?:string;next_action?:string;rubric_version?:string;k_evidence?:string[];
  effective_review_scope?:string;review_scope?:string;completion_conditions?:string[];
};
export type LearningPolicyInput={
  problemId:string;
  problem?:Problem;
  source?:PolicySource;
  learningPurpose?:LearningPurpose;
  learningStage?:LearningStage;
  assessmentTiming?:AssessmentTiming;
  targetedParts?:string[];
};

const clean=(values:unknown[])=>[...new Set(values.flatMap(value=>Array.isArray(value)?value:[value])
  .map(value=>String(value||"").trim()).filter(Boolean))].slice(0,8);

function rawErrors(source?:PolicySource){
  const raw=source?.error_types?.length?source.error_types:[source?.primary_error_type||source?.error_type||"none"];
  return [...new Set(raw.map(String).filter(error=>["K","W","N","C"].includes(error)))] as Array<"K"|"W"|"N"|"C">;
}

function inferPurpose(source:PolicySource|undefined,errors:string[]):LearningPurpose{
  if(source?.learning_purpose)return source.learning_purpose;
  if(["exam_90min","past_exam","timed_single"].includes(String(source?.mode||"")))return "exam_performance";
  if(errors.length)return "error_repair";
  return "integration_check";
}

function inferTiming(source:PolicySource|undefined,purpose:LearningPurpose):AssessmentTiming{
  if(source?.assessment_timing)return source.assessment_timing;
  if(purpose==="exam_performance")return "independent_performance";
  if(source?.generated_from_review_id||source?.generated_from_attempt_id)return "delayed_retrieval";
  return "delayed_retrieval";
}

function sheet(mode:PolicyMode):PolicySheetType{
  if(mode==="check")return "check_sheet";
  if(mode==="skeleton")return "skeleton_sheet";
  if(mode==="main_calc")return "main_calc_sheet";
  if(mode==="scan5")return "scan5_sheet";
  return "full_answer_sheet";
}

function parts(input:LearningPolicyInput){
  const source=input.source;
  return clean([input.targetedParts||[],source?.targeted_parts||[],source?.unresolved_carryover||[],
    source?.required_work_shown||[],source?.error_point,source?.next_action]);
}

function explicitScope(source?:PolicySource):PolicyReviewScope|undefined{
  const value=String(source?.effective_review_scope||source?.review_scope||"");
  return ["targeted_patch","main_calc_target","full_skeleton","check_only","full_answer","scan5"].includes(value)
    ?value as PolicyReviewScope:undefined;
}

function modeForScope(scope:PolicyReviewScope,source?:PolicySource):PolicyMode{
  if(scope==="targeted_patch")return String(source?.mode)==="main_calc"?"main_calc":"skeleton";
  if(scope==="main_calc_target")return "main_calc";
  if(scope==="full_skeleton")return "skeleton";
  if(scope==="check_only")return "check";
  if(scope==="scan5")return "scan5";
  return String(source?.mode)==="exam_90min"?"exam_90min":"full";
}

export function resolveLearningPolicy(input:LearningPolicyInput):LearningPrescription{
  const source=input.source;
  const raw=rawErrors(source);
  const kPolicyValidity=classifyKPolicyValidity({...source,error_types:raw});
  let effective=planningErrorsForSource({...source,error_types:raw}) as Array<"K"|"W"|"N"|"C">;
  const purpose=input.learningPurpose||inferPurpose(source,effective);
  const timing=input.assessmentTiming||inferTiming(source,purpose);
  const initialParts=parts(input);
  const mathematicalTargets=mathematicalPatchTargets(source||{},input.targetedParts||[]);
  const mathematicalRepair=purpose==="error_repair"&&kPolicyValidity==="invalid_legacy_k"&&mathematicalTargets.length>0;
  if(mathematicalRepair){
    if(effective.includes("W"))effective=effective.filter(error=>error!=="N");
    else if(effective.includes("C"))effective=["C"];
  }
  const targetedParts=mathematicalRepair?mathematicalTargets:initialParts;
  const primary=effective.includes("K")?"K":effective.includes("N")?"N":effective.includes("W")?"W":effective.includes("C")?"C":"none";
  let stage:LearningStage=input.learningStage||source?.learning_stage||(
    purpose==="error_repair"?"repair":purpose==="integration_check"?"integration":purpose==="transfer_check"?"transfer":"performance"
  );
  let reviewScope:PolicyReviewScope="check_only",mode:PolicyMode="check",estimatedMinutes=5,targetKind:TargetKind|undefined;
  let allowedReferenceLevel=0;
  if(purpose==="exam_performance"){
    mode=String(source?.mode)==="scan5"||String(source?.mode)==="scan"?"scan5":String(source?.mode)==="exam_90min"?"exam_90min":"full";
    reviewScope=mode==="scan5"?"scan5":"full_answer";estimatedMinutes=mode==="exam_90min"?90:mode==="scan5"?10:35;stage="performance";
  }else if(purpose==="transfer_check"){
    reviewScope="full_skeleton";mode="skeleton";estimatedMinutes=15;stage="transfer";
  }else if(purpose==="integration_check"){
    reviewScope="full_skeleton";mode="skeleton";estimatedMinutes=12;stage="integration";
  }else if(primary==="W"||mathematicalRepair){
    reviewScope=primary==="W"?"main_calc_target":"targeted_patch";mode=primary==="W"?"main_calc":"check";estimatedMinutes=timing==="same_session_correction"?5:primary==="C"?7:12;
    targetKind="mathematical_patch";allowedReferenceLevel=timing==="same_session_correction"?2:0;
  }else if(primary==="C"){
    reviewScope="check_only";mode="check";estimatedMinutes=5;targetKind="mathematical_patch";
    allowedReferenceLevel=timing==="same_session_correction"?2:0;
  }else{
    reviewScope="targeted_patch";mode="skeleton";estimatedMinutes=timing==="same_session_correction"?5:primary==="K"?20:15;
    targetKind="skeleton_expression_patch";allowedReferenceLevel=timing==="same_session_correction"?2:primary==="N"?2:0;
  }
  const requestedScope=explicitScope(source);
  if(requestedScope){
    reviewScope=requestedScope;
    mode=modeForScope(requestedScope,source);
    estimatedMinutes=requestedScope==="targeted_patch"?10:requestedScope==="main_calc_target"?12:
      requestedScope==="full_skeleton"?15:requestedScope==="check_only"?5:requestedScope==="scan5"?10:35;
  }
  if(mathematicalRepair&&purpose==="error_repair"){
    reviewScope=primary==="W"?"main_calc_target":"targeted_patch";
    mode=primary==="W"?"main_calc":"check";
    targetKind="mathematical_patch";
    estimatedMinutes=timing==="same_session_correction"?5:primary==="C"?7:12;
  }
  if(timing==="same_session_correction"){
    estimatedMinutes=Math.min(5,estimatedMinutes);
    if(reviewScope==="full_skeleton"||reviewScope==="full_answer")reviewScope="targeted_patch";
    if(mode==="full"||mode==="exam_90min")mode=primary==="W"?"main_calc":primary==="C"?"check":"skeleton";
  }
  const targets=targetedParts.length?targetedParts:["前回指定された箇所"];
  const completionConditions=reviewScope==="targeted_patch"||reviewScope==="main_calc_target"
    ?[`${targets.join("／")}だけを参照を閉じて再現できた`]
    :reviewScope==="full_skeleton"?["方針・出発式・主役の量・条件・流れを参照なしで再現できた"]
    :reviewScope==="check_only"?["型・出発式・注意点を参照なしで確認できた"]
    :reviewScope==="scan5"?["選ぶ3問と捨てる2問の理由を説明できた"]
    :["時間内に結論まで到達した"];
  const requiredEvidence=reviewScope==="targeted_patch"||reviewScope==="main_calc_target"
    ?targets.map(target=>`${target}を今回答案で示す`)
    :completionConditions;
  const allowedErrorTypes:Array<"K"|"W"|"N"|"C">=reviewScope==="targeted_patch"
    ?(targetKind==="mathematical_patch"?(primary==="C"?["C"]:primary==="W"?["W","N","C"]:["N","C"]):primary==="K"?["K","N","C"]:["N","C"])
    :reviewScope==="main_calc_target"?(["W","N","C"] as Array<"K"|"W"|"N"|"C">)
    :(["K","W","N","C"] as Array<"K"|"W"|"N"|"C">);
  return {
    problemId:input.problemId,learningPurpose:purpose,learningStage:stage,assessmentTiming:timing,
    reviewScope,targetKind,targetedParts:targets,mode,sheetType:sheet(mode),allowedReferenceLevel,
    estimatedMinutes,completionConditions,requiredEvidence,allowedErrorTypes,effectiveErrorTypes:effective,kPolicyValidity,
    requiresKEvidence:allowedErrorTypes.includes("K"),
    successTransition:timing==="same_session_correction"?"delayed_retrieval":purpose==="error_repair"?"integration_check":purpose==="integration_check"?"transfer_check":purpose==="transfer_check"?"exam_performance":"stable",
    failureTransition:"error_repair",
    schedulingReason:timing==="same_session_correction"?"答案直後に対象箇所だけを修正する":"時間を空けて参照なしの保持を確認する",
    policyVersion:LEARNING_POLICY_VERSION,
  };
}

export function problemTypeStable(args:{problemTypeKey:string;attempts:Attempt[]}){
  const eligible=args.attempts.filter(attempt=>attempt.problem_type_key===args.problemTypeKey&&attempt.exam_score_eligible&&
    (attempt.learning_purpose==="transfer_check"||attempt.learning_purpose==="exam_performance")&&Number(attempt.score_numeric||0)>=60);
  return new Set(eligible.map(attempt=>attempt.problem_id)).size>=2;
}

export type RecurrenceIntervention="compare_problem_types"|"justify_method_choice"|"unseen_first_step"|
  "calculation_step_isolation"|"worked_step_comparison"|"minimal_written_reproduction"|"preflight_check";

export function recurrenceInterventions(errorType:string,recurrenceCount:number):RecurrenceIntervention[]{
  if(recurrenceCount<2)return [];
  if(errorType==="K")return ["compare_problem_types","justify_method_choice","unseen_first_step"];
  if(errorType==="W")return ["calculation_step_isolation","worked_step_comparison"];
  if(errorType==="N")return ["minimal_written_reproduction"];
  if(errorType==="C")return ["preflight_check"];
  return [];
}

export function selectVerifiedTransferTarget(args:{sourceProblemId:string;problems:Problem[];relations:Array<{
  sourceProblemId:string;targetProblemId:string;status:string;targetFocus?:string;relationSource?:string;
}>}){
  const confirmed=args.relations.find(relation=>relation.sourceProblemId===args.sourceProblemId&&relation.targetProblemId!==args.sourceProblemId&&
    relation.status==="confirmed"&&String(relation.targetFocus||"").trim());
  if(confirmed)return {problemId:confirmed.targetProblemId,selection:"confirmed_relation" as const};
  const source=args.problems.find(problem=>problem.problem_id===args.sourceProblemId);
  if(!source||source.metadata_status!=="ok"||!source.canonical_problem_type)return null;
  const verified=args.problems.find(problem=>problem.problem_id!==source.problem_id&&problem.metadata_status==="ok"&&
    problem.canonical_problem_type===source.canonical_problem_type);
  return verified?{problemId:verified.problem_id,selection:"verified_problem_type" as const}:null;
}
