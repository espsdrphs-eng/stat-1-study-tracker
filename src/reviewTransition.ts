import type { AssessmentTiming, LearningPurpose } from "./types.ts";
import type { LearningPrescription } from "./learningPolicyResolver.ts";

export type ReviewTransitionInput={
  prescription:LearningPrescription;
  result:"success"|"partial"|"failed";
  referenceClosedReproduction:boolean;
  crossProblemEvidence?:boolean;
  verifiedTransferTargetAvailable?:boolean;
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
  if(prescription.learningPurpose==="error_repair"){
    return {retentionSuccess:true,stable:false,nextPurpose:"integration_check",nextTiming:"delayed_retrieval",userSelectionRequired:false,reason:"遅延再生で補修できたため全体統合へ進む"};
  }
  if(prescription.learningPurpose==="integration_check"){
    return {retentionSuccess:true,stable:false,nextPurpose:input.verifiedTransferTargetAvailable?"transfer_check":undefined,nextTiming:input.verifiedTransferTargetAvailable?"delayed_retrieval":undefined,userSelectionRequired:!input.verifiedTransferTargetAvailable,reason:input.verifiedTransferTargetAvailable?"統合成功後は別問題で転移を確認する":"verifiedな転移先をユーザーが選ぶ必要がある"};
  }
  const stable=!!input.crossProblemEvidence&&(prescription.learningPurpose==="transfer_check"||prescription.learningPurpose==="exam_performance");
  return {retentionSuccess:true,stable,nextPurpose:stable?undefined:"transfer_check",nextTiming:stable?undefined:"delayed_retrieval",userSelectionRequired:false,reason:stable?"別問題または本番形式で成功した":"同一問題だけの成功では問題型をstableにしない"};
}
