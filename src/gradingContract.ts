import type {
  AnswerIndexEntry, Attempt, FullSkeletonBlueprint, GradingContractSnapshot, LearningPurpose,
  Problem, ProblemAlias, ProblemContextPack, ProblemRelation, Review, Task,
} from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { classifyKPolicyValidity, planningErrorsForSource } from "./legacyKPolicy.ts";
import type { LearningPrescription } from "./learningPolicyResolver.ts";
import { gradedPartContracts, gradedPartIds, gradedPartLabels, sameGradedPartIds } from "./gradedParts.ts";
import { withCurrentFindingPayload } from "./currentTargetPayload.ts";

export const GRADING_CONTRACT_VERSION="STAT1-CONTRACT-v2";

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

export function repairTargets(review:Partial<Review&Task>,attempt?:Attempt){
  if(!attempt)return unique([review.targeted_parts||[]]);
  const successEvidence=new Set(unique([attempt.required_work_shown||[],attempt.resolution_evidence]));
  const structured=attempt.graded_findings||[];
  const explicit=unique([review.targeted_parts||[]]).filter(value=>value!==String(attempt.next_action||"").trim());
  const sourceParts=new Map((attempt.grading_contract?.gradedParts||[])
    .flatMap(part=>typeof part!=="string"&&part?.id?[[part.id,part] as const]:[]));
  // Structured findings are the target source of truth. Legacy prose must not
  // add another target beside a finding that already represents the same work.
  const candidates=structured.length
    ?structured.filter(row=>!row.resolved&&row.error_type!=="none").map(row=>
      String(row.evidence||sourceParts.get(row.graded_part_id)?.currentLabel||sourceParts.get(row.graded_part_id)?.label||row.graded_part_id))
    :!sourceErrors(attempt).length?[]
      // Explicit historical contracts remain authoritative after success
      // evidence and next_action are removed. With no such contract, one
      // unstructured Attempt has one synthetic target: error_point.
      :explicit.length?explicit:unique([attempt.error_point]).slice(0,1);
  // 成功証拠は背景として保持しても、次回の修正・採点対象には再利用しない。
  const withoutSuccess=candidates.filter(value=>!successEvidence.has(value));
  return classifyKPolicyValidity(attempt)==="invalid_legacy_k"
    ?withoutSuccess.filter(value=>!/骨格|設計図|条件・道具|小問別ゴール|ここから先は計算|方針|今見る量|ゴール|計算開始の境界/.test(value))
    :withoutSuccess;
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
  if(!contract.gradedParts.length)errors.push("採点対象IDがありません");
  if(new Set(contract.gradedParts.map(part=>part.id)).size!==contract.gradedParts.length)errors.push("採点対象IDが重複しています");
  if(contract.gradedParts.some(part=>!part.id||!part.label||!part.completionCriterionId||!part.allowedErrorTypes.length))
    errors.push("採点対象IDの定義が不完全です");
  return errors;
}

export function initialGradingContractMode(mode?:string):GradingContractSnapshot["mode"]{
  if(mode==="exam_90min"||mode==="timed_single"||mode==="past_exam")return "full";
  if(["check","skeleton","main_calc","full"].includes(String(mode)))return mode as GradingContractSnapshot["mode"];
  return "full";
}

/** Immutable, Review-free contract for a problem's first formally graded answer. */
export function buildInitialGradingContract(args:{problem:Problem;mode?:string;createdAt?:string}){
  const mode=initialGradingContractMode(args.mode||args.problem.recommended_mode);
  const part=(id:string,label:string,cueLabel:string,criterion:string,allowedErrorTypes:Array<"K"|"W"|"N"|"C"|"none">,
    masteryLevel:1|2)=>({id,label,cueLabel,completionCriterionId:criterion,allowedErrorTypes,
      stableTargetKey:`target:${args.problem.problem_id}:slot:${id}`,masteryLevel});
  const level1=[
    part("problem_type","問題の型","型","identify_problem_type",["K","N","C","none"],1),
    part("first_step","最初の一手","初手","choose_first_step",["K","W","N","C","none"],1),
    part("focal_quantity","主役となる量","主役の量","identify_focal_quantity",["K","N","C","none"],1),
    part("critical_condition","重要条件または注意点","重要条件","track_critical_condition",["K","W","N","C","none"],1),
  ];
  const level2=[
    part("major_calculation","主要計算の完遂","主要計算","complete_major_calculation",["K","W","N","C","none"],2),
    part("answer_conclusion","結論への到達","結論","reach_requested_conclusion",["W","N","C","none"],2),
  ];
  const gradedParts=mode==="check"||mode==="skeleton"?level1:mode==="main_calc"?[...level2]:[...level1,...level2];
  const reviewScope:GradingContractSnapshot["reviewScope"]=mode==="check"?"check_only":mode==="skeleton"?"full_skeleton":
    mode==="main_calc"?"main_calc_target":"full_answer";
  const sheetType:GradingContractSnapshot["sheetType"]=mode==="check"?"check_sheet":mode==="skeleton"?"skeleton_sheet":
    mode==="main_calc"?"main_calc_sheet":"full_answer_sheet";
  const isPastExam=args.problem.category==="past_exam"||args.problem.source_type==="past_exam";
  const learningPurpose:LearningPurpose=isPastExam||mode==="full"||mode==="check"?"exam_performance":"integration_check";
  const completionCriteria=gradedParts.map(row=>({id:row.completionCriterionId,displayText:`${row.label}を今回の答案で確認できた`}));
  const explicitlyOutOfScopeParts=mode==="check"||mode==="skeleton"?["主要計算の完遂","最終結論"]:mode==="main_calc"?
    ["採点対象として指定していない問題全体の説明"]:[];
  const payload={
    contractVersion:GRADING_CONTRACT_VERSION,problemId:args.problem.problem_id,
    learningPurpose,learningStage:isPastExam||mode==="full"?"performance" as const:"acquisition" as const,
    mode,reviewScope,targetedParts:gradedParts.map(row=>row.label),gradedParts,
    explicitlyOutOfScopePartIds:explicitlyOutOfScopeParts.map(value=>`out_${hashText(value)}`),explicitlyOutOfScopeParts,
    completionCriteria,hiddenAnswerKey:[],completionConditions:completionCriteria.map(row=>row.displayText),
    requiredEvidence:gradedParts.map(row=>row.label),allowedErrorTypes:["K","W","N","C"],requiresKEvidence:true,
    allowedReferenceLevel:0,estimatedMinutes:mode==="check"?5:mode==="skeleton"?15:mode==="main_calc"?25:35,sheetType,
  } satisfies Omit<GradingContractSnapshot,"contractHash"|"contractId"|"createdAt">;
  const contractHash=computeContractHash(payload);
  const contract:GradingContractSnapshot={...payload,
    contractId:`initial:${args.problem.problem_id}:${mode}:${contractHash.slice(3)}`,
    contractHash,createdAt:args.createdAt||new Date().toISOString()};
  const errors=validateGradingContract(contract);
  if(errors.length)throw new Error(`初回採点契約を生成できません: ${errors.join(" / ")}`);
  return contract;
}

export function buildGradingContractSnapshot(args:{
  review:Partial<Review&Task>;problem?:Problem;sourceAttempt?:Attempt;createdAt?:string;
}):ContractBuildResult{
  if(args.review.grading_contract?.contractVersion===GRADING_CONTRACT_VERSION){
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
  let targetKind:GradingContractSnapshot["targetKind"],targetedParts:string[]=[];
  let explicitlyOutOfScopeParts:string[]=[],completionConditions:string[]=[],requiredEvidence:string[]=[];
  const errors=sourceErrors(sourceAttempt),blueprint=verifiedBlueprint(problem);

  if(learningPurpose==="retrieval_check"){
    mode="check";reviewScope="check_only";sheetType="check_sheet";
    estimatedMinutes=Math.max(3,Math.min(5,Number(review.duration_minutes||review.estimated_minutes||review.minutes||5)));
    targetedParts=[];
    explicitlyOutOfScopeParts=["問題全体の骨格","全ての計算過程","最終結論の完全再現"];
    completionConditions=["型、最初の一手、主役となる量、重要条件または注意点を短く想起できた"];
    requiredEvidence=["上記4項目を参照なし、または許可された最小参照内で短く示す"];
  }else if(learningPurpose==="integration_check"){
    mode="skeleton";reviewScope="full_skeleton";sheetType="skeleton_sheet";estimatedMinutes=12;allowedReferenceLevel=0;
    if(blueprint){
      targetedParts=[...blueprint.requiredParts];
      explicitlyOutOfScopeParts=[...blueprint.optionalParts];
      completionConditions=[...blueprint.requiredSections.map(section=>`${section}を白紙から再現できた`),...blueprint.finalGoals.map(goal=>`${goal}へ接続できた`)];
      requiredEvidence=[...blueprint.requiredParts];
    }else{
      // 全体構造が未検証なら、もっともらしい骨格を局所履歴から捏造しない。
      targetedParts=[];completionConditions=[];requiredEvidence=[];
    }
  }else if(learningPurpose==="transfer_check"){
    mode="skeleton";reviewScope="full_skeleton";sheetType="skeleton_sheet";estimatedMinutes=15;allowedReferenceLevel=0;
    targetedParts=unique([review.targeted_parts||[]]);completionConditions=review.scope_completion_conditions||[];
    requiredEvidence=[...targetedParts];
  }else if(learningPurpose==="exam_performance"){
    mode=String(review.mode)==="scan5"?"scan5":"full";reviewScope=mode==="scan5"?"scan5":"full_answer";
    sheetType=mode==="scan5"?"scan5_sheet":"full_answer_sheet";estimatedMinutes=Number(review.estimated_minutes||review.minutes||35);
    targetedParts=[];completionConditions=["制限時間内に指定範囲の結論まで到達した"];
    requiredEvidence=["提出答案"];
  }else{
    targetedParts=repairTargets(review,sourceAttempt);
    if(!errors.length){
      learningPurpose="retrieval_check";learningStage="maintenance";mode="check";reviewScope="check_only";sheetType="check_sheet";
      estimatedMinutes=5;targetedParts=[];
      explicitlyOutOfScopeParts=["問題全体の骨格","全ての計算過程","最終結論の完全再現"];
      completionConditions=["型、最初の一手、主役となる量、重要条件または注意点を短く想起できた"];
      requiredEvidence=["型","最初の一手","主役の量","重要条件"];
    }else if(errors.includes("W")){
      mode="main_calc";reviewScope="main_calc_target";sheetType="main_calc_sheet";estimatedMinutes=12;targetKind="mathematical_patch";
      completionConditions=[];requiredEvidence=[...targetedParts];
    }else if(errors.length===1&&errors[0]==="C"){
      mode="check";reviewScope="check_only";sheetType="check_sheet";
      estimatedMinutes=sourceAttempt&&classifyKPolicyValidity(sourceAttempt)==="invalid_legacy_k"&&targetedParts.length<=2
        ?5:Math.max(3,Math.min(9,Number(review.estimated_minutes||review.duration_minutes||review.minutes||5)));
      targetKind="mathematical_patch";
      completionConditions=[];requiredEvidence=[...targetedParts];
    }else{
      mode="skeleton";reviewScope="targeted_patch";sheetType="skeleton_sheet";estimatedMinutes=10;
      targetKind=errors.includes("K")?"skeleton_expression_patch":"mathematical_patch";
      completionConditions=[];requiredEvidence=[...targetedParts];
      explicitlyOutOfScopeParts=["targetedPartsに含まれない骨格欄と計算"];
    }
  }

  let gradedParts=gradedPartContracts({texts:targetedParts,problemId:String(review.problem_id||problem?.problem_id||""),
    sourceAttempt,purpose:learningPurpose});
  if(learningPurpose==="error_repair"&&sourceAttempt&&gradedParts.length){
    const unresolved=(sourceAttempt.graded_findings||[]).filter(row=>!row.resolved&&row.error_type!=="none");
    if(unresolved.length){
      const byId=new Map(unresolved.map(row=>[row.graded_part_id,row]));
      gradedParts=gradedParts.map(part=>{
        const finding=byId.get(part.id);
        return finding?withCurrentFindingPayload(part,finding,sourceAttempt):part;
      });
    }else if(sourceAttempt.error_point&&gradedParts.length===1){
      const error=(sourceErrors(sourceAttempt)[0]||"N") as "K"|"W"|"N"|"C";
      gradedParts=[withCurrentFindingPayload(gradedParts[0],{
        graded_part_id:gradedParts[0].id,error_type:error,evidence:sourceAttempt.error_point,resolved:false,
      },sourceAttempt)];
    }
  }
  const completionCriteria=learningPurpose==="retrieval_check"
    ?[{id:"retrieval_short_recall",displayText:"型・初手・主役の量・重要条件を、参照なしで短く想起できた"}]
    :learningPurpose==="integration_check"
      ?[{id:"reconstruct_full_structure",displayText:"問題全体の方針・出発式・主役・条件・流れ・ゴールを、参照なしで再構成できた"}]
      :learningPurpose==="error_repair"
        ?[{id:"reproduce_targeted_points",displayText:`指定された${gradedParts.length}点を、参照なしで、対象・記号・式の向きを整合させて再現できた`}]
        :[{id:"complete_assigned_scope",displayText:"指定された範囲を、参照なしで完了できた"}];
  completionConditions=completionCriteria.map(row=>row.displayText);
  // Legacy summary only. Save-time validation always uses each graded part's own allow-list.
  const allowedErrorTypes=learningPurpose==="retrieval_check"
    ?["W","C"]
    :[...new Set(gradedParts.flatMap(part=>part.allowedErrorTypes).filter(value=>value!=="none"))];
  const requiresKEvidence=allowedErrorTypes.includes("K");
  const explicitlyOutOfScopePartIds=explicitlyOutOfScopeParts.map(value=>`out_${hashText(value)}`);
  const hiddenContent=unique([sourceAttempt?.corrected_answer,sourceAttempt?.required_derivation,
    sourceAttempt?.error_point,sourceAttempt?.next_action]);
  const hiddenAnswerKey=gradedParts.flatMap((part,index)=>hiddenContent[index]?[{gradedPartId:part.id,content:hiddenContent[index]}]:[]);
  const payload={
    contractVersion:GRADING_CONTRACT_VERSION,problemId:String(review.problem_id||problem?.problem_id||""),
    sourceAttemptId:Number(review.source_attempt_id||review.generated_from_attempt_id||sourceAttempt?.id||0)||undefined,
    reviewId:Number(review.id||0)||undefined,sourceReviewId:Number(review.id||0)||undefined,learningPurpose,learningStage,mode,reviewScope,targetKind,
    targetedParts,gradedParts,explicitlyOutOfScopePartIds,explicitlyOutOfScopeParts,completionCriteria,hiddenAnswerKey,
    completionConditions,requiredEvidence,allowedErrorTypes,requiresKEvidence,
    allowedReferenceLevel,estimatedMinutes,sheetType,
  } satisfies Omit<GradingContractSnapshot,"contractHash"|"contractId"|"createdAt">;
  const contractHash=computeContractHash(payload),createdAt=args.createdAt||review.generated_at||review.derived_generated_at||new Date().toISOString();
  const contract:GradingContractSnapshot={
    ...payload,
    contractId:payload.sourceReviewId?`review:${payload.sourceReviewId}:1`:`review:pending:${contractHash.slice(3)}`,
    contractHash,createdAt
  };
  const validationErrors=validateGradingContract(contract);
  if(learningPurpose==="integration_check"&&!blueprint)validationErrors.push("検証済みfullSkeletonBlueprintがないためfull_skeletonを自動確定できません");
  return {contract,validationErrors,needsReview:validationErrors.length>0};
}

export function taskFieldsFromContract(contract:GradingContractSnapshot){
  return {grading_contract:contract,contract_id:contract.contractId,contract_version:contract.contractVersion,
    contract_hash:contract.contractHash,learning_purpose:contract.learningPurpose,learning_stage:contract.learningStage,
    mode:contract.mode,effective_mode:contract.mode,review_scope:contract.reviewScope,effective_review_scope:contract.reviewScope,
    target_kind:contract.targetKind,targeted_parts:contract.targetedParts,graded_parts:gradedPartLabels(contract.gradedParts),
    graded_part_ids:gradedPartIds(contract.gradedParts),
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
    kPolicyValidity:"valid",requiresKEvidence:contract.requiresKEvidence,
    successTransition:contract.learningPurpose==="error_repair"?"retrieval_check":contract.learningPurpose==="retrieval_check"?"stable":undefined,
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

export function contractDifferences(
  expected:GradingContractSnapshot,
  input:Partial<Omit<GradingContractSnapshot,"gradedParts">>&{gradedParts?:GradingContractSnapshot["gradedParts"]|string[]},
){
  const fields:Array<keyof GradingContractSnapshot>=["contractId","contractVersion","contractHash","problemId","learningPurpose","mode","reviewScope","targetKind"];
  const differences=fields.flatMap(field=>stable(expected[field])===stable(input[field])?[]:[{field,expected:expected[field],actual:input[field]}]);
  const suppliedIds=Array.isArray(input.gradedParts)?input.gradedParts.map(part=>typeof part==="string"?part:part.id):[];
  if(!sameGradedPartIds(expected.gradedParts,suppliedIds))
    differences.push({field:"gradedParts",expected:gradedPartIds(expected.gradedParts),actual:[...suppliedIds].sort()});
  return differences;
}

export function contractShortId(contract:GradingContractSnapshot){return contract.contractId.slice(-8)}

export function isActionableReview(
  review:Partial<Review&Task>,
  contract:GradingContractSnapshot|undefined=review.grading_contract,
  today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),
){
  return ["pending","overdue"].includes(String(review.status||"pending"))&&
    review.policy_validity!=="invalid_legacy_k"&&review.exclude_from_planning!==true&&
    !(review.assessment_timing==="same_session_correction"&&String(review.due_date||"")<today)&&
    !!contract&&contract.contractVersion===GRADING_CONTRACT_VERSION&&
    !!contract.contractHash&&contract.gradedParts.length>0&&validateGradingContract(contract).length===0;
}

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
