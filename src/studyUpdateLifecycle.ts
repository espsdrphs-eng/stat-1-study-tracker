import type {Attempt, LearningPurpose, Problem, Review, StudyUpdate} from "./types.ts";
import {prescriptionFromContract} from "./gradingContract.ts";
import {resolveLearningPolicy, type LearningPrescription} from "./learningPolicyResolver.ts";
import {effectiveErrorsForAutomation} from "./reviewScopeResolver.ts";
import {enforceReviewEvidence, normalizedErrors} from "./reviewRules.ts";
import {resolveCanonicalLearningLifecycle, type CanonicalLearningLifecycleDecision} from "./reviewTransition.ts";

export const REVIEW_LIFECYCLE_RUBRICS=new Set([
  "STAT1-REVIEW-v9","STAT1-REVIEW-v8","STAT1-REVIEW-v7","STAT1-REVIEW-v6","STAT1-REVIEW-v5","STAT1-REVIEW-v4",
]);

export type StudyUpdateLifecycleProjection={
  update:StudyUpdate;
  lifecycle:CanonicalLearningLifecycleDecision;
  prescription?:LearningPrescription;
};

/** Map persisted/preview evidence to the same app-owned lifecycle decision. */
export function projectStudyUpdateLifecycle(args:{
  update:StudyUpdate;
  sourceReview?:Review;
  sourceAttempt?:Attempt;
  problem?:Problem;
  defaultLearningPurpose?:LearningPurpose;
}):StudyUpdateLifecycleProjection{
  let update={...args.update};
  if(args.sourceReview&&REVIEW_LIFECYCLE_RUBRICS.has(String(update.rubric_version||""))){
    update=enforceReviewEvidence(update,args.sourceAttempt?normalizedErrors(args.sourceAttempt):[],
      String(update.rubric_version||"STAT1-REVIEW-v9"));
  }
  const rawErrors=(update.error_types?.length?update.error_types:[update.primary_error_type||update.error_type||"none"])
    .map(String).filter(error=>["K","W","N","C"].includes(error));
  const effectiveErrors=effectiveErrorsForAutomation(rawErrors,update.rubric_version,update.k_evidence,update);
  const prescription=args.sourceReview?.grading_contract
    ?{...prescriptionFromContract(args.sourceReview.grading_contract,effectiveErrors),
      assessmentTiming:args.sourceReview.assessment_timing||"delayed_retrieval"}
    :args.sourceReview?resolveLearningPolicy({problemId:update.problem_id,problem:args.problem,source:{...update,...args.sourceReview},
      learningPurpose:args.sourceReview.learning_purpose,learningStage:args.sourceReview.learning_stage,
      assessmentTiming:args.sourceReview.assessment_timing||"delayed_retrieval",targetedParts:args.sourceReview.targeted_parts})
      :undefined;
  // A persisted Review contract is authoritative. GPT timing/purpose fields
  // are evidence metadata and cannot promote a repair execution to retrieval.
  const learningPurpose=prescription?.learningPurpose||update.learning_purpose||args.defaultLearningPurpose||
    (update.generated_from_review_id?"error_repair":"integration_check");
  const assessmentTiming=prescription?.assessmentTiming||args.sourceReview?.assessment_timing||update.assessment_timing||
    (update.generated_from_review_id?"delayed_retrieval":"independent_performance");
  const actualReferenceLevel=Math.min(5,Math.max(0,Number(update.actual_reference_level??update.reference_level??(
    update.external_reference?5:update.official_answer?4:update.saved_gpt_feedback||update.gpt_explanation?3:
      update.previous_mistake?2:update.one_line_hint||update.hint_used?1:0
  ))));
  const allowedReferenceLevel=Math.min(5,Math.max(0,Number(prescription?.allowedReferenceLevel??update.allowed_reference_level??0)));
  const gradedPartIds=update.graded_part_ids||args.sourceReview?.grading_contract?.gradedParts.map(part=>part.id);
  const lifecycle=resolveCanonicalLearningLifecycle({
    prescription,learningPurpose,assessmentTiming,result:String(update.review_outcome||"") as "success"|"partial"|"failed",
    reviewOutcome:update.review_outcome,actualReferenceLevel,allowedReferenceLevel,hintUsed:!!update.hint_used,
    referenceClosedReproduction:!!(update.reference_closed_reproduction??update.after_hint_reproduced),
    targetIssueResolved:update.target_issue_resolved,minimumPassConditionMet:update.minimum_pass_condition_met,
    errorTypes:effectiveErrors.length?effectiveErrors:["none"],unresolvedCarryover:update.unresolved_carryover,
    gradedPartIds,gradedFindings:update.graded_findings,requireGradedEvidence:!!args.sourceReview,
    crossProblemEvidence:false,verifiedTransferTargetAvailable:false,
  });
  const rawMark=String(update.mark||""),corrections=[
    (update.raw_gpt_mark_present??!!rawMark)&&rawMark!==lifecycle.mark?"mark":"",
    update.review_outcome&&update.review_outcome!==lifecycle.reviewOutcome?"review_outcome":"",
    update.learning_purpose&&update.learning_purpose!==learningPurpose?"learning_purpose":"",
    update.assessment_timing&&update.assessment_timing!==assessmentTiming?"assessment_timing":"",
  ].filter(Boolean);
  update={...update,mark:lifecycle.mark,review_outcome:lifecycle.reviewOutcome,learning_purpose:learningPurpose,
    assessment_timing:assessmentTiming,effective_error_types:effectiveErrors.length?effectiveErrors:["none"],
    auto_corrected:!!update.auto_corrected||corrections.length>0,
    correction_fields:[...new Set([...(update.correction_fields||[]),...corrections])],
    correction_reason:corrections.length
      ?`${String(update.correction_reason||"")}${update.correction_reason?" / ":""}markと学習段階を採点契約・答案証拠からアプリ側で決定`
      :update.correction_reason};
  return {update,lifecycle,prescription};
}
