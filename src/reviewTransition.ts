import type { AssessmentTiming, LearningPurpose } from "./types.ts";
import type { LearningPrescription } from "./learningPolicyResolver.ts";

type ObjectiveRetentionEvidence={
  assessmentTiming?:string;result?:string;actualReferenceLevel?:number;hintUsed?:boolean;
  targetIssueResolved?:boolean;minimumPassConditionMet?:boolean;errorTypes?:string[];
  unresolvedCarryover?:string[];gradedPartIds?:string[];
  gradedFindings?:Array<{graded_part_id:string;error_type:string;resolved:boolean}>;
};

type LearningEvaluationEvidence=ObjectiveRetentionEvidence&{
  learningPurpose?:LearningPurpose;reviewOutcome?:"success"|"partial"|"failed";
  allowedReferenceLevel?:number;referenceClosedReproduction?:boolean;
  requireGradedEvidence?:boolean;
};

export type LearningEvaluationDecision={
  reviewOutcome:"success"|"partial"|"failed";mark:"×"|"△"|"○"|"◎";
  graduated:boolean;allGradedPartsResolved:boolean;reason:string;
};

function allPartsResolved(input:ObjectiveRetentionEvidence,required:boolean){
  const ids=[...new Set((input.gradedPartIds||[]).filter(Boolean))],findings=input.gradedFindings||[];
  if(!ids.length)return !required&&!(input.errorTypes||[]).some(error=>["K","W","N","C"].includes(String(error)));
  if(findings.length!==ids.length)return false;
  const byPart=new Map(findings.map(finding=>[finding.graded_part_id,finding]));
  return ids.every(id=>{
    const finding=byPart.get(id);
    return !!finding&&finding.resolved===true&&finding.error_type==="none";
  });
}

/**
 * A deterministic graduation decision for one Review execution. It deliberately
 * ignores the historical mark (◎/○), so a valid STAT1-REVIEW-v9 success can end
 * a same-problem Review series without rewriting old marks.
 */
export function isObjectiveDelayedRetrievalSuccess(input:ObjectiveRetentionEvidence){
  if(input.assessmentTiming!=="delayed_retrieval"||input.result!=="success")return false;
  if(Number(input.actualReferenceLevel||0)!==0||input.hintUsed)return false;
  if(input.targetIssueResolved!==true||input.minimumPassConditionMet!==true)return false;
  if((input.errorTypes||[]).some(error=>["K","W","N","C"].includes(String(error))))return false;
  if((input.unresolvedCarryover||[]).some(value=>String(value).trim()))return false;
  return allPartsResolved(input,true);
}

/**
 * Normalize GPT/self-check evidence into the app-owned outcome and learning mark.
 * Score is deliberately absent: mark represents learning state, not points.
 */
export function resolveLearningEvaluation(input:LearningEvaluationEvidence):LearningEvaluationDecision{
  const realErrors=(input.errorTypes||[]).filter(error=>["K","W","N","C"].includes(String(error)));
  const allResolved=allPartsResolved(input,input.requireGradedEvidence!==false);
  const actual=Math.max(0,Number(input.actualReferenceLevel||0));
  const allowed=Math.max(0,Number(input.allowedReferenceLevel||0));
  const referenceValid=actual<=allowed&&(actual===0||input.referenceClosedReproduction===true);
  const explicitPass=input.requireGradedEvidence===false
    ?realErrors.length===0&&input.reviewOutcome!=="failed"&&referenceValid
    :input.targetIssueResolved===true&&input.minimumPassConditionMet===true&&
      realErrors.length===0&&allResolved&&referenceValid;
  const majorUnresolved=realErrors.includes("K")||input.minimumPassConditionMet===false||input.reviewOutcome==="failed";
  const reviewOutcome=explicitPass?"success":majorUnresolved?"failed":"partial";
  const graduated=input.learningPurpose==="retrieval_check"&&isObjectiveDelayedRetrievalSuccess({
    ...input,result:reviewOutcome,errorTypes:realErrors.length?realErrors:["none"]
  });
  const mark=graduated?"◎":reviewOutcome==="success"?"○":reviewOutcome==="partial"?"△":"×";
  return {reviewOutcome,mark,graduated,allGradedPartsResolved:allResolved,
    reason:graduated?"参照なしの遅延保持確認に成功した":reviewOutcome==="success"?"今回の課題には成功したが保持確認は未完了":
      reviewOutcome==="partial"?"採点対象に未解決が残る":"最低クリア条件未達または重大な未解決がある"};
}

export type ReviewTransitionInput={
  prescription:LearningPrescription;
  result:"success"|"partial"|"failed";
  referenceClosedReproduction:boolean;
  crossProblemEvidence?:boolean;
  verifiedTransferTargetAvailable?:boolean;
  objectiveRetentionSuccess?:boolean;
};
export type ReviewTransitionResult={
  retentionSuccess:boolean;
  stable:boolean;
  nextPurpose?:LearningPurpose;
  nextTiming?:AssessmentTiming;
  userSelectionRequired:boolean;
  reason:string;
};

export function resolveReviewTransition(input:ReviewTransitionInput):ReviewTransitionResult{
  const {prescription}=input;
  if(input.result!=="success"||!input.referenceClosedReproduction){
    return {retentionSuccess:false,stable:false,nextPurpose:"error_repair",nextTiming:"delayed_retrieval",userSelectionRequired:false,reason:"未達または参照を閉じた再現がないため補修を継続する"};
  }
  if(prescription.assessmentTiming==="same_session_correction"){
    return {retentionSuccess:false,stable:false,nextPurpose:"error_repair",nextTiming:"delayed_retrieval",userSelectionRequired:false,reason:"答案直後の修正成功は長期保持の証拠にしない"};
  }
  if(prescription.learningPurpose==="error_repair"&&input.result==="success"){
    return {retentionSuccess:false,stable:false,nextPurpose:"retrieval_check",nextTiming:"delayed_retrieval",
      userSelectionRequired:false,reason:"局所補修には成功したため、同一問題は一度だけ遅延保持確認へ進む"};
  }
  const objectiveSuccess=input.objectiveRetentionSuccess??true;
  if(!objectiveSuccess){
    return {retentionSuccess:false,stable:false,nextPurpose:prescription.learningPurpose,
      nextTiming:"delayed_retrieval",userSelectionRequired:false,
      reason:"参照なし・全対象解決の客観条件を満たしていないため、同じ目的の遅延確認を継続する"};
  }
  if(prescription.learningPurpose==="retrieval_check"){
    return {retentionSuccess:true,stable:false,nextPurpose:undefined,nextTiming:undefined,
      userSelectionRequired:true,
      reason:"参照なしの遅延想起で全対象を解決したため同一問題のretrieval系列を卒業し、必要なら別問題の転移候補へ進む"};
  }
  if(prescription.learningPurpose==="integration_check"){
    return {retentionSuccess:true,stable:false,nextPurpose:input.verifiedTransferTargetAvailable?"transfer_check":undefined,nextTiming:input.verifiedTransferTargetAvailable?"delayed_retrieval":undefined,userSelectionRequired:!input.verifiedTransferTargetAvailable,reason:input.verifiedTransferTargetAvailable?"統合成功後は別問題で転移を確認する":"verifiedな転移先をユーザーが選ぶ必要がある"};
  }
  const stable=!!input.crossProblemEvidence&&(prescription.learningPurpose==="transfer_check"||prescription.learningPurpose==="exam_performance");
  return {retentionSuccess:true,stable,nextPurpose:stable?undefined:"transfer_check",nextTiming:stable?undefined:"delayed_retrieval",userSelectionRequired:false,reason:stable?"別問題または本番形式で成功した":"同一問題だけの成功では問題型をstableにしない"};
}
