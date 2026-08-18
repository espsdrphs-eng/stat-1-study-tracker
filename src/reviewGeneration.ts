import type {Attempt,ProblemAlias,Review,StudyUpdate} from "./types.ts";
import {resolveCanonicalProblemId} from "./examReadiness.ts";
import {contractDifferences} from "./gradingContract.ts";
import {canonicalAttemptId,logicalReviewKey,reviewExecutionMessage,reviewExecutionState} from "./reviewCurrentState.ts";

const stableParts=(review:Review)=>[...(review.grading_contract?.gradedParts||[])]
  .map(part=>part.stableTargetKey||part.stable_target_key||part.id).sort();
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const sourceId=(review:Review)=>Number(review.source_attempt_id||review.generated_from_attempt_id||0);

function hasNewGradingEvidence(args:{oldReview:Review;sourceAttempt:Attempt|undefined;attempts:Attempt[];aliases:ProblemAlias[]}){
  const cutoff=Date.parse(String(args.oldReview.contract_locked_at||args.oldReview.grading_contract?.createdAt||args.oldReview.generated_at||""));
  const problemId=resolveCanonicalProblemId(args.oldReview.problem_id,args.aliases);
  return args.attempts.some(attempt=>{
    if(attempt.id===args.sourceAttempt?.id||attempt.duplicate_of_attempt_id||attempt.exclude_from_planning)return false;
    if(resolveCanonicalProblemId(attempt.problem_id,args.aliases)!==problemId)return false;
    const saved=Date.parse(String(attempt.saved_at||""));
    if(Number.isFinite(cutoff)&&Number.isFinite(saved))return saved>cutoff;
    return attempt.id>Number(args.sourceAttempt?.id||0)&&attempt.date>=String(args.oldReview.grading_contract?.createdAt||"").slice(0,10);
  });
}

function updateMatchesOldContract(update:StudyUpdate,review:Review){
  const contract=review.grading_contract;
  if(!contract)return false;
  return contractDifferences(contract,{
    contractId:String(update.contract_id||""),contractVersion:String(update.contract_version||""),
    contractHash:String(update.contract_hash||""),problemId:String(update.problem_id||""),
    learningPurpose:update.learning_purpose,mode:update.mode as "check"|"skeleton"|"main_calc"|"full"|"scan5",
    reviewScope:update.review_scope,targetKind:update.target_kind,gradedParts:update.graded_part_ids||update.graded_parts||[],
  }).length===0;
}

function semanticallyEquivalent(args:{oldReview:Review;currentReview:Review;attempts:Attempt[];aliases:ProblemAlias[]}){
  const oldContract=args.oldReview.grading_contract,currentContract=args.currentReview.grading_contract;
  if(!oldContract||!currentContract)return false;
  const attemptsById=new Map(args.attempts.map(row=>[row.id,row]));
  const oldSource=attemptsById.get(sourceId(args.oldReview)),currentSource=attemptsById.get(sourceId(args.currentReview));
  const oldLogical=args.oldReview.logical_review_key||logicalReviewKey({review:args.oldReview,aliases:args.aliases,sourceAttempt:oldSource});
  const currentLogical=args.currentReview.logical_review_key||logicalReviewKey({review:args.currentReview,aliases:args.aliases,sourceAttempt:currentSource});
  return resolveCanonicalProblemId(args.oldReview.problem_id,args.aliases)===resolveCanonicalProblemId(args.currentReview.problem_id,args.aliases)&&
    oldLogical===currentLogical&&oldContract.contractHash===currentContract.contractHash&&
    canonicalAttemptId(oldSource)===canonicalAttemptId(currentSource)&&same(stableParts(args.oldReview),stableParts(args.currentReview))&&
    oldContract.learningPurpose===currentContract.learningPurpose&&oldContract.reviewScope===currentContract.reviewScope&&
    oldContract.allowedReferenceLevel===currentContract.allowedReferenceLevel&&
    !hasNewGradingEvidence({oldReview:args.oldReview,sourceAttempt:oldSource,attempts:args.attempts,aliases:args.aliases});
}

export type SemanticReviewGenerationResult={
  kind:"current"|"rebound"|"mismatch"|"unavailable";
  update:StudyUpdate;oldReview?:Review;currentReview?:Review;message?:string;
};

export function resolveSemanticReviewGeneration(args:{
  update:StudyUpdate;reviews:Review[];attempts:Attempt[];aliases?:ProblemAlias[];today:string;
}):SemanticReviewGenerationResult{
  const aliases=args.aliases||[],oldId=Number(args.update.generated_from_review_id||0);
  if(!oldId)return {kind:"current",update:args.update};
  const oldReview=args.reviews.find(row=>row.id===oldId);
  if(!oldReview)return {kind:"unavailable",update:args.update,message:"元の復習課題が見つかりません"};
  const oldState=reviewExecutionState(oldReview,args.today);
  if(oldState==="actionable")return {kind:"current",update:args.update,oldReview,currentReview:oldReview};
  const hasSignedContract=!!args.update.contract_id&&!!args.update.contract_hash&&!!args.update.contract_version&&
    Array.isArray(args.update.graded_part_ids||args.update.graded_parts);
  if(!hasSignedContract)return {kind:"unavailable",update:args.update,oldReview,message:reviewExecutionMessage(oldState,oldReview)};
  if(!updateMatchesOldContract(args.update,oldReview))return {kind:"mismatch",update:args.update,oldReview,
    message:"元Reviewの採点契約とGPT回答が一致しません"};
  const candidates=args.reviews.filter(review=>reviewExecutionState(review,args.today)==="actionable"&&review.id!==oldReview.id&&
    semanticallyEquivalent({oldReview,currentReview:review,attempts:args.attempts,aliases}));
  const currentReview=[...candidates].sort((a,b)=>b.id-a.id)[0];
  if(!currentReview)return {kind:"mismatch",update:args.update,oldReview,
    message:"復習内容が更新されています。現在ReviewのGPT採点プロンプトを再生成してください"};
  const contract=currentReview.grading_contract!;
  return {kind:"rebound",oldReview,currentReview,message:`元Review #${oldReview.id}は置換されています。同一採点契約の現在Review #${currentReview.id}へ適用します`,
    update:{...args.update,generated_from_review_id:currentReview.id,source_review_id:currentReview.id,
      contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
      learning_purpose:contract.learningPurpose,learning_stage:contract.learningStage,mode:contract.mode,
      review_scope:contract.reviewScope,target_kind:contract.targetKind,graded_part_ids:contract.gradedParts.map(part=>part.id),
      allowed_reference_level:contract.allowedReferenceLevel,semantic_rebind_from_review_id:oldReview.id,
      semantic_rebind_message:`Review #${oldReview.id} → #${currentReview.id}`}};
}
