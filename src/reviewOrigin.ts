import type { Attempt, Problem, ProblemAlias, ProblemRelation, Review, ReviewOrigin } from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";
import { resolveLearningPolicy } from "./learningPolicyResolver.ts";
import { classifyKPolicyValidity, planningErrorsForSource } from "./legacyKPolicy.ts";
import { taskDraftFromPrescription } from "./taskScheduler.ts";

export const REVIEW_ORIGIN_POLICY_VERSION="STAT1-ORIGIN-v2";

export type ReviewOriginResolution={
  origin:ReviewOrigin;valid:boolean;reason:string;sourceAttempt?:Attempt;relation?:ProblemRelation;
  sourceProblemId:string;targetProblemId:string;needsMigration?:boolean;historical?:boolean;
};

const canonical=(id:string,aliases:ProblemAlias[])=>resolveCanonicalProblemId(String(id||""),aliases);
const list=(value:unknown)=>Array.isArray(value)?value.map(String).filter(Boolean):String(value||"").split(/[;,、\s]+/).map(row=>row.trim()).filter(Boolean);
const completed=(status:string)=>["done","completed"].includes(String(status));
const incomplete=(status:string)=>!["done","completed","cancelled","superseded"].includes(String(status));

function storedVerifiedRelation(relations:ProblemRelation[],source:string,target:string,aliases:ProblemAlias[]){
  return relations.find(relation=>
    ["confirmed","verified"].includes(String(relation.status))&&
    ["prerequisite","remediation","extension"].includes(relation.relationType)&&
    canonical(relation.sourceProblemId,aliases)===source&&canonical(relation.targetProblemId,aliases)===target);
}

/** problem_master の明示関連だけを verified_master relation として導出する。DBやmasterへ書き戻さない。 */
export function masterVerifiedRelation(args:{
  problems:Problem[];sourceProblemId:string;targetProblemId:string;aliases:ProblemAlias[];sourceAttempt?:Attempt;
}):ProblemRelation|undefined{
  const {problems,aliases,sourceAttempt}=args;
  const source=canonical(args.sourceProblemId,aliases),target=canonical(args.targetProblemId,aliases);
  if(!source||!target||source===target)return undefined;
  const sourceProblem=problems.find(row=>canonical(row.problem_id,aliases)===source);
  const targetProblem=problems.find(row=>canonical(row.problem_id,aliases)===target);
  if(!sourceProblem||!targetProblem)return undefined;
  const links=[...(sourceProblem.related_s_problem_ids||[]),...list(sourceProblem.linked_s_problems)].map(id=>canonical(id,aliases));
  if(!links.includes(target))return undefined;
  const version=sourceProblem.master_version||targetProblem.master_version||"unversioned";
  const now="1970-01-01T00:00:00.000Z";
  return {relationId:`master:${version}:${source}:${target}:remediation`,sourceProblemId:source,targetProblemId:target,
    relationType:"remediation",sourceIssue:String(sourceAttempt?.error_point||"problem_masterで確認済みの関連補修"),
    targetFocus:targetProblem.theme&&targetProblem.theme!=="要確認"?targetProblem.theme:"problem_masterで確認済みの関連箇所",
    reason:"problem_masterの明示的な関連指定",relationSource:"problem_master",status:"confirmed",createdAt:now,updatedAt:now};
}

function verifiedRelation(args:{relations:ProblemRelation[];problems:Problem[];source:string;target:string;aliases:ProblemAlias[];sourceAttempt?:Attempt}){
  return storedVerifiedRelation(args.relations,args.source,args.target,args.aliases)||masterVerifiedRelation({
    problems:args.problems,sourceProblemId:args.source,targetProblemId:args.target,aliases:args.aliases,sourceAttempt:args.sourceAttempt
  });
}

export function resolveReviewOrigin(args:{
  review:Review;attempts:Attempt[];aliases:ProblemAlias[];relations:ProblemRelation[];problems?:Problem[];
}):ReviewOriginResolution{
  const {review,attempts,aliases,relations}=args,problems=args.problems||[];
  const sourceAttemptId=Number(review.source_attempt_id||review.generated_from_attempt_id||0);
  const sourceAttempt=attempts.find(row=>row.id===sourceAttemptId);
  const target=canonical(review.target_problem_id||review.problem_id,aliases);
  const source=canonical(review.source_problem_id||sourceAttempt?.problem_id||"",aliases);

  if(completed(review.status)&&review.task_origin==="linked_s_check"&&source&&source!==target){
    return {origin:"historical_completed",valid:true,historical:true,
      reason:"完了済みの旧linked Sは履歴として保持",sourceAttempt,sourceProblemId:source,targetProblemId:target};
  }

  const relation=source&&target&&source!==target?verifiedRelation({relations,problems,source,target,aliases,sourceAttempt}):undefined;
  if(review.generated_from_past_session_id||review.parent_past_session_id){
    return {origin:"past_exam_attempt",valid:!!sourceAttempt&&source===target,
      reason:sourceAttempt&&source===target?"過去問セッション内の同一問題Attempt":"過去問Attemptと対象問題が一致しない",
      sourceAttempt,sourceProblemId:source,targetProblemId:target};
  }
  if(review.learning_purpose==="integration_check"){
    return {origin:"integration_schedule",valid:!sourceAttempt||source===target,
      reason:!sourceAttempt||source===target?"同一問題の後日統合確認":"integrationのsourceとtargetが一致しない",
      sourceAttempt,sourceProblemId:source,targetProblemId:target};
  }
  if(review.learning_purpose==="transfer_check"){
    const valid=source===target||!!relation;
    return {origin:"transfer_schedule",valid,reason:valid?"同一問題またはverified relationによる転移":"転移先を裏付けるverified relationがない",
      sourceAttempt,relation,sourceProblemId:source,targetProblemId:target};
  }
  if(source&&source!==target){
    const needsMigration=!!relation&&(
      review.origin!=="verified_linked_problem"||review.origin_verified!==true||review.relation_id!==relation.relationId||
      review.target_problem_id!==target||review.source_problem_id!==source||review.policy_version!==REVIEW_ORIGIN_POLICY_VERSION
    );
    return {origin:"verified_linked_problem",valid:!!relation,needsMigration,
      reason:relation?"verified relationによる関連補修":"異なる問題を結ぶverified relationがない",
      sourceAttempt,relation,sourceProblemId:source,targetProblemId:target};
  }
  return {origin:"direct_attempt",valid:!!sourceAttempt&&source===target,
    reason:sourceAttempt&&source===target?"sourceとtargetのcanonical IDが一致":"direct attemptのsourceがないか対象と不一致",
    sourceAttempt,sourceProblemId:source,targetProblemId:target};
}

export type SourceRepairAction={
  reviewId:number;action:"keep"|"supersede"|"regenerate"|"needs_review"|"migrate_verified";reason:string;
  patch?:Partial<Review>;replacement?:Omit<Review,"id">;
};
export type SourceRepairPreview={
  mismatchCount:number;verifiedRelationCount:number;supersededCount:number;regeneratedCount:number;
  needsReviewCount:number;unchangedCompletedCount:number;actions:SourceRepairAction[];
  activeSourceMismatchCount:number;pendingVerifiedLinkNeedsMigrationCount:number;
  invalidLegacyCardsToSupersedeCount:number;historicalCompletedLinkedReviewsCount:number;
  unresolvedNeedsReviewCount:number;verifiedRelationMigratedCount:number;
};

function latestOwnAttempt(target:string,attempts:Attempt[],aliases:ProblemAlias[]){
  return attempts.filter(row=>canonical(row.problem_id,aliases)===target)
    .sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
}

function isInvalidLegacySource(review:Review,attempt?:Attempt){
  return review.policy_validity==="invalid_legacy_k"||attempt?.policy_validity==="invalid_legacy_k"||
    (!!attempt&&classifyKPolicyValidity(attempt)==="invalid_legacy_k")||
    (review.superseded_by_policy_version!=null&&review.exclude_from_recurrence_metrics===true&&review.task_origin==="linked_s_check");
}

function currentTriggerErrors(attempt?:Attempt){
  return attempt?planningErrorsForSource(attempt):[];
}

function replacementFromOwnAttempt(args:{review:Review;own:Attempt;target:string;problem:Problem;pendingKeys:Set<string>}):Omit<Review,"id">|undefined{
  const {review,own,target,problem,pendingKeys}=args;
  const prescription=resolveLearningPolicy({problemId:target,problem,source:{...own,learning_purpose:"error_repair",assessment_timing:"delayed_retrieval"}});
  if(!prescription.effectiveErrorTypes.length)return undefined;
  const draft=taskDraftFromPrescription({prescription,sourceAttemptId:own.id,sourceDate:own.date,errors:prescription.effectiveErrorTypes});
  if(pendingKeys.has(draft.deduplicationKey))return undefined;
  pendingKeys.add(draft.deduplicationKey);
  const generatedAt=new Date().toISOString(),masterVersion=problem.master_version||"unversioned";
  const provenance={problemId:target,attemptId:own.id,masterVersion,generatedAt};
  return {problem_id:target,target_problem_id:target,due_date:draft.dueDate,review_type:prescription.reviewScope,status:"pending",
    generated_from_attempt_id:own.id,source_attempt_id:own.id,derived_from_attempt_id:own.id,derived_from_problem_id:target,
    duration_minutes:prescription.estimatedMinutes,estimated_minutes:prescription.estimatedMinutes,
    reason:prescription.schedulingReason,task_origin:"review_attempt",attempt_exists:true,origin:"direct_attempt",origin_verified:true,
    review_scope:prescription.reviewScope,effective_review_scope:prescription.reviewScope,targeted_parts:prescription.targetedParts,
    scope_completion_conditions:prescription.completionConditions,effective_mode:prescription.mode==="exam_90min"?"full":prescription.mode,
    sheet_type:prescription.sheetType,learning_purpose:prescription.learningPurpose,learning_stage:prescription.learningStage,
    assessment_timing:prescription.assessmentTiming,target_kind:prescription.targetKind,required_evidence:prescription.requiredEvidence,
    policy_version:prescription.policyVersion,deduplication_key:draft.deduplicationKey,earliest_date:draft.window.earliestDate,
    preferred_date:draft.window.preferredDate,latest_date:draft.window.latestDate,generated_at:generatedAt,
    retention_eligible:true,success_transition:prescription.successTransition,failure_transition:prescription.failureTransition,
    derived_from_master_version:masterVersion,derived_generated_at:generatedAt,derived_stale:false,
    derived_fields:{
      reviewGoal:{value:prescription.schedulingReason,provenance},
      correctionTheme:{value:prescription.targetedParts.join("、"),provenance},
      entryHint:{value:String(own.next_action||own.error_point||"前回指定された箇所を確認する"),provenance},
      todayActions:{value:prescription.targetedParts,provenance},
      completionConditions:{value:prescription.completionConditions,provenance}
    }};
}

export function analyzeSourceMismatchRepair(args:{
  reviews:Review[];attempts:Attempt[];problems:Problem[];aliases:ProblemAlias[];relations:ProblemRelation[];
}):SourceRepairPreview{
  const {reviews,attempts,problems,aliases,relations}=args,actions:SourceRepairAction[]=[];
  let mismatchCount=0,verifiedRelationCount=0,supersededCount=0,regeneratedCount=0,needsReviewCount=0,unchangedCompletedCount=0;
  let activeSourceMismatchCount=0,pendingVerifiedLinkNeedsMigrationCount=0,invalidLegacyCardsToSupersedeCount=0;
  let historicalCompletedLinkedReviewsCount=0,unresolvedNeedsReviewCount=0,verifiedRelationMigratedCount=0;
  const pendingKeys=new Set(reviews.filter(row=>incomplete(row.status)).map(row=>row.deduplication_key).filter(Boolean) as string[]);

  for(const review of reviews){
    const resolution=resolveReviewOrigin({review,attempts,aliases,relations,problems});
    if(resolution.historical){historicalCompletedLinkedReviewsCount++;unchangedCompletedCount++;continue}
    const recoverableVerifiedSuperseded=review.status==="superseded"&&
      resolution.origin==="verified_linked_problem"&&resolution.valid&&!!resolution.relation&&
      review.task_origin==="linked_s_check"&&String(review.superseded_by_policy_version||"").startsWith("STAT1-ORIGIN-")&&
      !isInvalidLegacySource(review,resolution.sourceAttempt)&&currentTriggerErrors(resolution.sourceAttempt).length>0;
    if(!incomplete(review.status)&&!recoverableVerifiedSuperseded){unchangedCompletedCount++;continue}

    if(resolution.origin==="verified_linked_problem"&&resolution.valid){
      verifiedRelationCount++;
      const sourceInvalid=isInvalidLegacySource(review,resolution.sourceAttempt);
      const triggers=currentTriggerErrors(resolution.sourceAttempt);
      if(sourceInvalid||!triggers.length){
        activeSourceMismatchCount++;mismatchCount++;
        if(sourceInvalid)invalidLegacyCardsToSupersedeCount++;
        const patch:Partial<Review>={status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
          superseded_reason:"invalid_legacy_k由来または現行triggerのないcross-targetカード",
          superseded_by_policy_version:REVIEW_ORIGIN_POLICY_VERSION};
        supersededCount++;
        const problem=problems.find(row=>canonical(row.problem_id,aliases)===resolution.targetProblemId);
        const own=latestOwnAttempt(resolution.targetProblemId,attempts,aliases);
        const ownErrors=currentTriggerErrors(own);
        if(problem&&own&&ownErrors.length){
          const replacement=replacementFromOwnAttempt({review,own,target:resolution.targetProblemId,problem,pendingKeys});
          if(replacement){regeneratedCount++;actions.push({reviewId:review.id,action:"regenerate",
            reason:"旧K由来linkedカードを継続せず、対象問題自身のAttemptから独立再生成",patch,replacement});continue}
        }
        if(own&&!ownErrors.length&&classifyKPolicyValidity(own)==="needs_review"){
          needsReviewCount++;unresolvedNeedsReviewCount++;actions.push({reviewId:review.id,action:"needs_review",
            reason:"対象問題自身のK根拠を自動判定できない",patch:{...patch,review_needed_reason:"対象問題自身のK根拠を確認してください"}});continue;
        }
        actions.push({reviewId:review.id,action:"supersede",reason:patch.superseded_reason!,patch});
        continue;
      }
      if(resolution.needsMigration&&resolution.relation){
        activeSourceMismatchCount++;mismatchCount++;pendingVerifiedLinkNeedsMigrationCount++;verifiedRelationMigratedCount++;
        const relation=resolution.relation,deduplicationKey=`${resolution.targetProblemId}|verified_linked_problem|${relation.relationId}|${resolution.sourceAttempt?.id||0}|${REVIEW_ORIGIN_POLICY_VERSION}`;
        const patch:Partial<Review>={status:"pending",origin:"verified_linked_problem",origin_verified:true,relation_id:relation.relationId,
          source_problem_id:resolution.sourceProblemId,target_problem_id:resolution.targetProblemId,
          generated_from_attempt_id:resolution.sourceAttempt?.id||review.generated_from_attempt_id,
          source_attempt_id:resolution.sourceAttempt?.id||review.generated_from_attempt_id,
          policy_version:REVIEW_ORIGIN_POLICY_VERSION,policy_validity:"valid",exclude_from_planning:false,
          exclude_from_recurrence_metrics:false,superseded_reason:undefined,superseded_by_policy_version:undefined,review_needed_reason:undefined,
          review_scope:"targeted_patch",effective_review_scope:"targeted_patch",target_kind:"mathematical_patch",
          targeted_parts:[relation.targetFocus],scope_completion_conditions:[`${relation.targetFocus}を確認する`],
          reason:relation.reason,deduplication_key:deduplicationKey,derived_stale:true,generated_at:new Date().toISOString()};
        actions.push({reviewId:review.id,action:"migrate_verified",reason:"problem_masterの正式な関連指定へ移行",patch});
      }
      continue;
    }

    if(resolution.valid)continue;
    mismatchCount++;activeSourceMismatchCount++;
    const target=resolution.targetProblemId,problem=problems.find(row=>canonical(row.problem_id,aliases)===target);
    const own=latestOwnAttempt(target,attempts,aliases);
    const invalidLegacy=isInvalidLegacySource(review,resolution.sourceAttempt);
    if(invalidLegacy)invalidLegacyCardsToSupersedeCount++;
    const supersedeReason=invalidLegacy
      ?"invalid_legacy_k由来のcross-targetカードで、verified relationまたは現行triggerがない"
      :resolution.reason;
    const supersedePatch:Partial<Review>={status:"superseded",exclude_from_planning:true,
      exclude_from_recurrence_metrics:invalidLegacy||review.exclude_from_recurrence_metrics,
      superseded_reason:supersedeReason,superseded_by_policy_version:REVIEW_ORIGIN_POLICY_VERSION};

    if(!problem||!own){
      supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:supersedeReason,patch:supersedePatch});continue;
    }
    const errors=currentTriggerErrors(own),validity=classifyKPolicyValidity(own);
    if(!errors.length&&validity==="needs_review"){
      needsReviewCount++;unresolvedNeedsReviewCount++;
      actions.push({reviewId:review.id,action:"needs_review",reason:"対象問題自身のK根拠を自動判定できない",
        patch:{...supersedePatch,review_needed_reason:"対象問題自身のK根拠を確認してください"}});continue;
    }
    if(!errors.length){
      supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:"対象問題自身に現行計画へ使える弱点がない",patch:supersedePatch});continue;
    }
    const replacement=replacementFromOwnAttempt({review,own,target,problem,pendingKeys});
    if(!replacement){
      supersededCount++;actions.push({reviewId:review.id,action:"supersede",reason:"対象Attemptからの正常な未完了カードが既にある",patch:supersedePatch});continue;
    }
    supersededCount++;regeneratedCount++;
    actions.push({reviewId:review.id,action:"regenerate",reason:"古いsourceを付け替えず、対象問題自身のAttemptから独立再生成",
      patch:supersedePatch,replacement});
  }
  // 現在対応件数は実際の修復 action 数と常に一致させる。これにより
  // 「verified relation 移行対象 1件 / 現在対応 0件」の矛盾を防ぐ。
  activeSourceMismatchCount=actions.length;
  mismatchCount=actions.length;
  return {mismatchCount,verifiedRelationCount,supersededCount,regeneratedCount,needsReviewCount,unchangedCompletedCount,actions,
    activeSourceMismatchCount,pendingVerifiedLinkNeedsMigrationCount,invalidLegacyCardsToSupersedeCount,
    historicalCompletedLinkedReviewsCount,unresolvedNeedsReviewCount,verifiedRelationMigratedCount};
}
