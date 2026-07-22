import type {
  AnswerIndexEntry, Attempt, FullSkeletonBlueprint, GradingContractSnapshot, LearningPurpose,
  Problem, ProblemAlias, ProblemContextPack, ProblemRelation, Review, Task,
} from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { classifyKPolicyValidity, planningErrorsForSource } from "./legacyKPolicy.ts";
import type { LearningPrescription } from "./learningPolicyResolver.ts";

export const GRADING_CONTRACT_VERSION="STAT1-CONTRACT-v1";

const unique=(values:unknown[])=>[...new Set(values.flatMap(value=>Array.isArray(value)?value:[value])
  .map(value=>String(value||"").trim()).filter(Boolean))];

function stable(value:unknown):string{
  if(value==null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,row])=>`${JSON.stringify(key)}:${stable(row)}`).join(",")}}`;
}

function hashText(value:string){
  let hash=2166136261;
  for(let index=0;index<value.length;index++){
    hash^=value.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(16).padStart(8,"0");
}

export function computeContractHash(contract:Omit<GradingContractSnapshot,"contractHash"|"contractId"|"createdAt">){
  return `gc-${hashText(stable(contract))}`;
}

const sourceErrors=(attempt?:Attempt)=>attempt?planningErrorsForSource(attempt):[];
const sourceSucceeded=(attempt?:Attempt)=>!!attempt&&(
  sourceErrors(attempt).length===0||attempt.error_types?.length===1&&attempt.error_types[0]==="none"||
  attempt.target_issue_resolved===true||attempt.minimum_pass_condition_met===true||
  (attempt as Attempt&{review_outcome?:string}).review_outcome==="success"
);

function verifiedBlueprint(problem?:Problem):FullSkeletonBlueprint|undefined{
  const blueprint=problem?.full_skeleton_blueprint;
  return blueprint&&["official_verified","user_verified","successful_attempt_verified"].includes(blueprint.verificationStatus)
    ?blueprint:undefined;
}

function legacyPurpose(review:Partial<Review&Task>,attempt?:Attempt):LearningPurpose{
  if(String(review.review_type||"")==="light_check")return "retrieval_check";
  if(sourceErrors(attempt).length===0&&review.learning_purpose==="error_repair")return "retrieval_check";
  if(review.learning_purpose)return review.learning_purpose;
  if(["full","exam_90min","scan5"].includes(String(review.effective_mode||review.mode||"")))return "exam_performance";
  if(sourceErrors(attempt).length)return "error_repair";
  return "retrieval_check";
}

function repairTargets(review:Partial<Review&Task>,attempt?:Attempt){
  if(!attempt)return unique([review.targeted_parts||[]]);
  const successEvidence=new Set(unique([attempt.required_work_shown||[],attempt.resolution_evidence]));
  const candidates=!sourceErrors(attempt).length
    ?unique([review.targeted_parts||[]])
    :unique([review.targeted_parts||[],attempt.unresolved_carryover||[],attempt.error_point,attempt.next_action]).slice(0,8);
  // 成功証拠は背景として保持しても、次回の修正・採点対象には再利用しない。
  return candidates.filter(value=>!successEvidence.has(value));
}

export type ContractBuildResult={contract:GradingContractSnapshot;validationErrors:string[];needsReview:boolean};

export function validateGradingContract(contract:GradingContractSnapshot){
  const errors:string[]=[];
  const broad=contract.completionConditions.join(" ");
  if(contract.learningPurpose==="retrieval_check"){
    if(contract.mode!=="check")errors.push("retrieval_check + skeleton/full は使用できません");
    if(contract.reviewScope!=="check_only")errors.push("retrieval_check + full_skeleton は使用できません");
    if(contract.sheetType!=="check_sheet")errors.push("retrieval_check + skeleton_sheet は使用できません");
    if(contract.estimatedMinutes>=10)errors.push("retrieval_check は3〜5分です");
    if(/全て|全体骨格|全計算|最終結論.*完全/.test(broad))errors.push("retrieval_check に問題全体の完了条件は設定できません");
  }
  if(contract.learningPurpose==="integration_check"){
    if(contract.reviewScope==="check_only")errors.push("integration_check + check_only は使用できません");
    if(contract.sheetType==="check_sheet")errors.push("integration_check + check_sheet は使用できません");
    if(contract.estimatedMinutes<=5)errors.push("integration_check を3〜5分では実施できません");
  }
  if(contract.learningPurpose==="error_repair"&&contract.reviewScope==="full_skeleton")
    errors.push("error_repair + full_skeleton は使用できません");
  if(contract.mode==="check"&&contract.sheetType!=="check_sheet")errors.push("check と使用シートが一致しません");
  if(contract.mode==="skeleton"&&contract.sheetType!=="skeleton_sheet")errors.push("skeleton と使用シートが一致しません");
  if(contract.reviewScope==="targeted_patch"&&contract.gradedParts.some(part=>!contract.targetedParts.includes(part)))
    errors.push("targeted_patch の採点対象が指定範囲を超えています");
  return errors;
}

export function buildGradingContractSnapshot(args:{
  review:Partial<Review&Task>;problem?:Problem;sourceAttempt?:Attempt;createdAt?:string;
}):ContractBuildResult{
  if(args.review.grading_contract){
    const errors=validateGradingContract(args.review.grading_contract);
    return {contract:args.review.grading_contract,validationErrors:errors,needsReview:errors.length>0};
  }
  const {review,problem,sourceAttempt}=args;
  let learningPurpose=legacyPurpose(review,sourceAttempt);
  let learningStage:GradingContractSnapshot["learningStage"]=learningPurpose==="retrieval_check"?"maintenance":
    learningPurpose==="error_repair"?"repair":learningPurpose==="integration_check"?"integration":
      learningPurpose==="transfer_check"?"transfer":"performance";
  let mode:GradingContractSnapshot["mode"]="check",reviewScope:GradingContractSnapshot["reviewScope"]="check_only";
  let sheetType:GradingContractSnapshot["sheetType"]="check_sheet",estimatedMinutes=5,allowedReferenceLevel=Number(review.allowed_reference_level??0);
  let targetKind:GradingContractSnapshot["targetKind"],targetedParts:string[]=[],gradedParts:string[]=[];
  let explicitlyOutOfScopeParts:string[]=[],completionConditions:string[]=[],requiredEvidence:string[]=[];
  const errors=sourceErrors(sourceAttempt),blueprint=verifiedBlueprint(problem);

  if(learningPurpose==="retrieval_check"){
    mode="check";reviewScope="check_only";sheetType="check_sheet";
    estimatedMinutes=Math.max(3,Math.min(5,Number(review.duration_minutes||review.estimated_minutes||review.minutes||5)));
    targetedParts=[];
    gradedParts=["問題の型","最初の一手","主役となる量","重要条件または注意点"];
    explicitlyOutOfScopeParts=["問題全体の骨格","全ての計算過程","最終結論の完全再現"];
    completionConditions=["型、最初の一手、主役となる量、重要条件または注意点を短く想起できた"];
    requiredEvidence=["上記4項目を参照なし、または許可された最小参照内で短く示す"];
  }else if(learningPurpose==="integration_check"){
    mode="skeleton";reviewScope="full_skeleton";sheetType="skeleton_sheet";estimatedMinutes=12;allowedReferenceLevel=0;
    if(blueprint){
      targetedParts=[...blueprint.requiredParts];gradedParts=[...blueprint.requiredParts];
      explicitlyOutOfScopeParts=[...blueprint.optionalParts];
      completionConditions=[...blueprint.requiredSections.map(section=>`${section}を白紙から再現できた`),...blueprint.finalGoals.map(goal=>`${goal}へ接続できた`)];
      requiredEvidence=[...blueprint.requiredParts];
    }else{
      // 全体構造が未検証なら、もっともらしい骨格を局所履歴から捏造しない。
      targetedParts=[];gradedParts=[];completionConditions=[];requiredEvidence=[];
    }
  }else if(learningPurpose==="transfer_check"){
    mode="skeleton";reviewScope="full_skeleton";sheetType="skeleton_sheet";estimatedMinutes=15;allowedReferenceLevel=0;
    targetedParts=unique([review.targeted_parts||[]]);gradedParts=[...targetedParts];completionConditions=review.scope_completion_conditions||[];
    requiredEvidence=[...gradedParts];
  }else if(learningPurpose==="exam_performance"){
    mode=String(review.mode)==="scan5"?"scan5":"full";reviewScope=mode==="scan5"?"scan5":"full_answer";
    sheetType=mode==="scan5"?"scan5_sheet":"full_answer_sheet";estimatedMinutes=Number(review.estimated_minutes||review.minutes||35);
    targetedParts=[];gradedParts=["今回提出した答案全体"];completionConditions=["制限時間内に指定範囲の結論まで到達した"];
    requiredEvidence=["提出答案"];
  }else{
    targetedParts=repairTargets(review,sourceAttempt);
    if(!errors.length){
      learningPurpose="retrieval_check";learningStage="maintenance";mode="check";reviewScope="check_only";sheetType="check_sheet";
      estimatedMinutes=5;targetedParts=[];gradedParts=["問題の型","最初の一手","主役となる量","重要条件または注意点"];
      explicitlyOutOfScopeParts=["問題全体の骨格","全ての計算過程","最終結論の完全再現"];
      completionConditions=["型、最初の一手、主役となる量、重要条件または注意点を短く想起できた"];
      requiredEvidence=[...gradedParts];
    }else if(errors.includes("W")){
      mode="main_calc";reviewScope="main_calc_target";sheetType="main_calc_sheet";estimatedMinutes=12;targetKind="mathematical_patch";
      gradedParts=[...targetedParts];completionConditions=[`${targetedParts.join("・")}を開始式から再現できた`];requiredEvidence=[...gradedParts];
    }else if(errors.length===1&&errors[0]==="C"){
      mode="check";reviewScope="check_only";sheetType="check_sheet";
      estimatedMinutes=Math.max(3,Math.min(9,Number(review.estimated_minutes||review.duration_minutes||review.minutes||5)));
      targetKind="mathematical_patch";
      gradedParts=[...targetedParts];completionConditions=[`${targetedParts.join("・")}を確認できた`];requiredEvidence=[...gradedParts];
    }else{
      mode="skeleton";reviewScope="targeted_patch";sheetType="skeleton_sheet";estimatedMinutes=10;
      targetKind=errors.includes("K")?"skeleton_expression_patch":"mathematical_patch";
      gradedParts=[...targetedParts];completionConditions=[`${targetedParts.join("・")}だけを白紙から再現できた`];requiredEvidence=[...gradedParts];
      explicitlyOutOfScopeParts=["targetedPartsに含まれない骨格欄と計算"];
    }
  }

  const allowedErrorTypes=learningPurpose==="retrieval_check"?["W","C"]:
    reviewScope==="main_calc_target"?["W","C"]:reviewScope==="check_only"?["C"]:["K","W","N","C"];
  const requiresKEvidence=allowedErrorTypes.includes("K");
  const payload={
    contractVersion:GRADING_CONTRACT_VERSION,problemId:String(review.problem_id||problem?.problem_id||""),
    sourceAttemptId:Number(review.source_attempt_id||review.generated_from_attempt_id||sourceAttempt?.id||0)||undefined,
    sourceReviewId:Number(review.id||0)||undefined,learningPurpose,learningStage,mode,reviewScope,targetKind,
    targetedParts,gradedParts,explicitlyOutOfScopeParts,completionConditions,requiredEvidence,allowedErrorTypes,requiresKEvidence,
    allowedReferenceLevel,estimatedMinutes,sheetType,
  } satisfies Omit<GradingContractSnapshot,"contractHash"|"contractId"|"createdAt">;
  const contractHash=computeContractHash(payload),createdAt=args.createdAt||review.generated_at||review.derived_generated_at||new Date().toISOString();
  const contract:GradingContractSnapshot={...payload,contractId:`review:${payload.sourceReviewId||"new"}:${contractHash.slice(3)}`,contractHash,createdAt};
  const validationErrors=validateGradingContract(contract);
  if(learningPurpose==="integration_check"&&!blueprint)validationErrors.push("検証済みfullSkeletonBlueprintがないためfull_skeletonを自動確定できません");
  return {contract,validationErrors,needsReview:validationErrors.length>0};
}

export function taskFieldsFromContract(contract:GradingContractSnapshot){
  return {grading_contract:contract,contract_id:contract.contractId,contract_version:contract.contractVersion,
    contract_hash:contract.contractHash,learning_purpose:contract.learningPurpose,learning_stage:contract.learningStage,
    mode:contract.mode,effective_mode:contract.mode,review_scope:contract.reviewScope,effective_review_scope:contract.reviewScope,
    target_kind:contract.targetKind,targeted_parts:contract.targetedParts,graded_parts:contract.gradedParts,
    explicitly_out_of_scope_parts:contract.explicitlyOutOfScopeParts,scope_completion_conditions:contract.completionConditions,
    required_evidence:contract.requiredEvidence,allowed_reference_level:contract.allowedReferenceLevel,
    estimated_minutes:contract.estimatedMinutes,minutes:contract.estimatedMinutes,sheet_type:contract.sheetType};
}

export function prescriptionFromContract(contract:GradingContractSnapshot,effectiveErrors:string[]=[]):LearningPrescription{
  const errors=effectiveErrors.filter(value=>["K","W","N","C"].includes(value)) as Array<"K"|"W"|"N"|"C">;
  return {problemId:contract.problemId,learningPurpose:contract.learningPurpose,learningStage:contract.learningStage,
    assessmentTiming:"delayed_retrieval",reviewScope:contract.reviewScope,targetKind:contract.targetKind,
    targetedParts:[...contract.targetedParts],mode:contract.mode,sheetType:contract.sheetType,
    allowedReferenceLevel:contract.allowedReferenceLevel,estimatedMinutes:contract.estimatedMinutes,
    completionConditions:[...contract.completionConditions],requiredEvidence:[...contract.requiredEvidence],
    allowedErrorTypes:contract.allowedErrorTypes as Array<"K"|"W"|"N"|"C">,effectiveErrorTypes:errors,
    kPolicyValidity:"valid",requiresKEvidence:contract.requiresKEvidence,successTransition:contract.learningPurpose==="retrieval_check"?"integration_check":undefined,
    failureTransition:"error_repair",schedulingReason:`固定採点契約 ${contract.contractId}`,policyVersion:contract.contractVersion};
}

export function buildProblemContextPack(args:{
  problemId:string;problems:Problem[];aliases:ProblemAlias[];answers?:AnswerIndexEntry[];attempts?:Attempt[];
  reviews?:Review[];relations?:ProblemRelation[];currentSourceAttemptId?:number;
}):ProblemContextPack{
  const canonicalProblemId=resolveCanonicalProblemId(args.problemId,args.aliases),problem=args.problems.find(row=>row.problem_id===canonicalProblemId);
  if(!problem)throw new Error(`problem_masterに対象問題がありません: ${canonicalProblemId}`);
  const answer=args.answers?.find(row=>row.problem_id===canonicalProblemId);
  const attempts=(args.attempts||[]).filter(row=>resolveCanonicalProblemId(row.problem_id,args.aliases)===canonicalProblemId);
  const reviews=(args.reviews||[]).filter(row=>resolveCanonicalProblemId(row.problem_id,args.aliases)===canonicalProblemId);
  const statement=String((problem as Problem&{question_excerpt?:string}).question_excerpt||"");
  const official=String(problem.official_answer||"");
  const completeness=statement&&official?"complete":statement||official||answer?.answer_excerpt?"partial":"metadata_only";
  return {problemId:args.problemId,canonicalProblemId,displayLabel:problem.display_label||problem.title,title:problem.title,
    theme:problem.theme,canonicalProblemType:problem.canonical_problem_type||"",canonicalKeywords:problem.canonical_keywords||[],problemMaster:problem,
    answerIndex:answer,problemStatement:statement||undefined,officialAnswerText:official||undefined,answerExcerpt:answer?.answer_excerpt,
    answerPages:answer?{documentKey:answer.document_key,pageStart:answer.page_start??undefined,pageEnd:answer.page_end??undefined}:undefined,
    contextCompleteness:completeness,currentSourceAttempt:attempts.find(row=>row.id===args.currentSourceAttemptId),
    previousAttempts:attempts.map(row=>({attemptId:row.id,date:row.date,mode:row.mode,scoreNumeric:row.score_numeric??null,errorTypes:row.error_types||[row.error_type]})),
    previousReviews:reviews.map(row=>({reviewId:row.id,status:row.status,reviewType:row.review_type,dueDate:row.due_date})),
    verifiedRelations:(args.relations||[]).filter(row=>row.status!=="candidate"&&row.status!=="rejected"&&
      (row.sourceProblemId===canonicalProblemId||row.targetProblemId===canonicalProblemId))};
}

export function contractDifferences(expected:GradingContractSnapshot,input:Partial<GradingContractSnapshot>){
  const fields:Array<keyof GradingContractSnapshot>=["contractHash","problemId","learningPurpose","mode","reviewScope","targetKind","gradedParts"];
  return fields.flatMap(field=>stable(expected[field])===stable(input[field])?[]:[{field,expected:expected[field],actual:input[field]}]);
}

export function contractShortId(contract:GradingContractSnapshot){return contract.contractId.slice(-8)}

export function auditLegacyReviewContracts(args:{reviews:Review[];attempts:Attempt[];aliases:ProblemAlias[]}){
  const attemptMap=new Map(args.attempts.map(row=>[row.id,row]));
  const active=(row:Review)=>["pending","overdue","review_needed","id_review_needed"].includes(row.status);
  const pendingModeMismatch=args.reviews.filter(row=>active(row)&&!!row.inferred_mode&&!!row.effective_mode&&row.inferred_mode!==row.effective_mode);
  const lightCheckMismatch=args.reviews.filter(row=>active(row)&&row.review_type==="light_check"&&
    (row.effective_mode!=="check"||row.sheet_type!=="check_sheet"||Number(row.estimated_minutes||row.duration_minutes||0)>5));
  const invalidLegacyPending=args.reviews.filter(row=>active(row)&&row.policy_validity==="invalid_legacy_k"&&
    (row.exclude_from_planning!==true||row.status!=="superseded"));
  const rawSourceTargetDifference=args.reviews.filter(row=>{
    const source=attemptMap.get(row.source_attempt_id||row.generated_from_attempt_id);
    return !!source&&resolveCanonicalProblemId(source.problem_id,args.aliases)!==resolveCanonicalProblemId(row.problem_id,args.aliases);
  });
  const activeSourceMismatch=rawSourceTargetDifference.filter(row=>active(row));
  const generatedDerivedMismatch=args.reviews.filter(row=>!!row.generated_from_attempt_id&&!!row.derived_from_attempt_id&&
    row.generated_from_attempt_id!==row.derived_from_attempt_id);
  const successEvidenceUsedAsTarget=args.reviews.filter(row=>{
    const source=attemptMap.get(row.source_attempt_id||row.generated_from_attempt_id);
    if(!source||!sourceSucceeded(source))return false;
    const successes=unique([source.required_work_shown||[],source.resolution_evidence]);
    return successes.some(value=>(row.targeted_parts||[]).includes(value));
  });
  return {
    pending_mode_mismatch:pendingModeMismatch.length,light_check_mismatch:lightCheckMismatch.length,
    invalid_legacy_pending:invalidLegacyPending.length,source_target_mismatch:activeSourceMismatch.length,
    raw_source_target_difference:rawSourceTargetDifference.length,active_source_mismatch:activeSourceMismatch.length,
    generated_derived_attempt_mismatch:generatedDerivedMismatch.length,success_evidence_used_as_target:successEvidenceUsedAsTarget.length,
    ids:{pending_mode_mismatch:pendingModeMismatch.map(row=>row.id),light_check_mismatch:lightCheckMismatch.map(row=>row.id),
      invalid_legacy_pending:invalidLegacyPending.map(row=>row.id),source_target_mismatch:activeSourceMismatch.map(row=>row.id),
      raw_source_target_difference:rawSourceTargetDifference.map(row=>row.id),active_source_mismatch:activeSourceMismatch.map(row=>row.id),
      generated_derived_attempt_mismatch:generatedDerivedMismatch.map(row=>row.id)}
  };
}
