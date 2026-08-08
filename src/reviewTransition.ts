import type { AssessmentTiming, LearningPurpose } from "./types.ts";
import type { LearningPrescription } from "./learningPolicyResolver.ts";

type ObjectiveRetentionEvidence={
  assessmentTiming?:string;result?:string;actualReferenceLevel?:number;hintUsed?:boolean;
  targetIssueResolved?:boolean;minimumPassConditionMet?:boolean;errorTypes?:string[];
  unresolvedCarryover?:string[];gradedPartIds?:string[];
  gradedFindings?:Array<{graded_part_id:string;error_type:string;resolved:boolean}>;
};

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
  const partIds=[...new Set((input.gradedPartIds||[]).filter(Boolean))];
  const findings=input.gradedFindings||[];
  if(!partIds.length||findings.length!==partIds.length)return false;
  const byPart=new Map(findings.map(finding=>[finding.graded_part_id,finding]));
  return partIds.every(id=>{
    const finding=byPart.get(id);
    return !!finding&&finding.resolved===true&&finding.error_type==="none";
  });
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
  if(prescription.learningPurpose==="error_repair"){
    return {retentionSuccess:true,stable:false,nextPurpose:"integration_check",nextTiming:"delayed_retrieval",userSelectionRequired:false,reason:"遅延再生で補修できたため全体統合へ進む"};
  }
  if(prescription.learningPurpose==="integration_check"){
    return {retentionSuccess:true,stable:false,nextPurpose:input.verifiedTransferTargetAvailable?"transfer_check":undefined,nextTiming:input.verifiedTransferTargetAvailable?"delayed_retrieval":undefined,userSelectionRequired:!input.verifiedTransferTargetAvailable,reason:input.verifiedTransferTargetAvailable?"統合成功後は別問題で転移を確認する":"verifiedな転移先をユーザーが選ぶ必要がある"};
  }
  const stable=!!input.crossProblemEvidence&&(prescription.learningPurpose==="transfer_check"||prescription.learningPurpose==="exam_performance");
  return {retentionSuccess:true,stable,nextPurpose:stable?undefined:"transfer_check",nextTiming:stable?undefined:"delayed_retrieval",userSelectionRequired:false,reason:stable?"別問題または本番形式で成功した":"同一問題だけの成功では問題型をstableにしない"};
}
