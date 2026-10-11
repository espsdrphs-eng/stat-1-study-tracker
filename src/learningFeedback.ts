import type {Bootstrap,Task,Review,Attempt,GradingContractSnapshot,StudyUpdate} from "./types.ts";
import {deriveTransferEvidence,transferTrainingOutcome} from "./skillEvidence.ts";
import {attemptPlanningEligible} from "./legacyKPolicy.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";

/** Display projection only. Eligibility, ranking and capability remain canonical. */
export type SubmittedAnswer={problemId:string;text:string;referenceLevel:number};
export function appendSubmittedAnswer(prompt:string,text?:string,referenceLevel=0){
  return text?.trim()?`${prompt}\n\n【今回の確定答案】\n${text}\n【今回の参照記録】参照段階 ${referenceLevel}。この記録を下げず採点してください。`:prompt;
}
export function attachSubmittedAnswer(update:StudyUpdate&{memo?:string},submission?:SubmittedAnswer):StudyUpdate&{memo?:string}{
  if(update.problem_id!==submission?.problemId||!submission.text.trim())return update;
  return {...update,memo:[update.memo,`今回の確定答案:\n${submission.text}`].filter(Boolean).join("\n\n"),
    actual_reference_level:Math.max(Number(update.actual_reference_level??update.reference_level??0),submission.referenceLevel) as StudyUpdate["actual_reference_level"]};
}
export function completionCriterionText(contract?:GradingContractSnapshot){
  return contract?.completionCriteria?.map(c=>c.displayText).filter(Boolean).join(" / ")||
    "対象範囲を参照なしで最後の結論まで再現し、対象major errorがないことを採点で確認";
}
export function preAnswerReason(item:Partial<Task&Review>){
  const purpose=item.grading_contract?.learningPurpose||item.learning_purpose;
  if(item.transfer_training_key||purpose==="transfer_check")return "別問題で自力の再現性を確認します。";
  if(item.past_exam_task_type)return "本番形式で選題・時間内の答案形成を測定します。";
  if(purpose==="retrieval_check")return "参照なしで保持を確認します。";
  if(purpose==="error_repair"||item.repair_lineage)return "未完成の解答範囲に再挑戦します。";
  return "現在の答案形成を確認します。";
}
export function deriveCurrentLearningDiagnosis(data:Bootstrap){
  const assessment=data.dashboard.kpis?.assessment;
  const facts=data.attempts.filter(attemptPlanningEligible);
  const tasks=data.today.tasks.filter(t=>!t.checked&&t.ranking?.eligible);
  const deficits:Array<{problemId:string;ability:string;sourceAttemptId:number;date:string;evidence:string;task:Task;successCriterion:string}>=[];
  const used=new Set<string>();
  for(const task of tasks){
    const purpose=task.grading_contract?.learningPurpose||task.learning_purpose;
    if(purpose!=="error_repair"||used.has(task.problem_id)||
      data.masteryByProblem[task.problem_id]?.normalReviewComplete&&!task.repair_lineage?.transferFailureEvidenceId)continue;
    const sourceId=task.repair_lineage?.sourceAttemptId||task.source_attempt_id||task.grading_contract?.sourceAttemptId;
    const source=facts.find(a=>a.id===sourceId);
    if(!source)continue;
    const ids=task.repair_lineage?.sourceFindingIds||task.targeted_parts||task.grading_contract?.gradedParts.map(p=>p.id)||[];
    const failures=(source.graded_findings||[]).filter(f=>!f.resolved&&f.error_type!=="none"&&(!ids.length||ids.includes(f.graded_part_id)));
    const root=deriveFailureEpisode(source).rootWeaknesses.find(r=>r.requiredRepair&&r.sourceFindingIds.some(id=>failures.some(f=>f.graded_part_id===id)));
    const finding=failures.find(f=>root?.sourceFindingIds.includes(f.graded_part_id))||failures[0];
    if(!finding&&!source.error_point)continue;
    used.add(task.problem_id);
    const transferFailure=facts.find(a=>a.id===task.repair_lineage?.transferFailureEvidenceId);
    const evidence=[root?.description||finding?.evidence||source.error_point,
      transferFailure?`直近の別問題 ${transferFailure.problem_id}・${transferFailure.date}・Attempt #${transferFailure.id}で対象技能を再現できなかった。${transferFailure.target_skill_assessment?.evidence||""}`:""]
      .filter(Boolean).join("\n");
    deficits.push({problemId:task.problem_id,ability:evidence,sourceAttemptId:source.id,date:source.date,evidence,task,
      successCriterion:completionCriterionText(task.grading_contract)});
  }
  const transfers=deriveTransferEvidence(facts);
  const training=transfers.filter(e=>e.evidenceStrength==="training"),strong=transfers.filter(e=>e.evidenceStrength==="strong");
  const lastTraining=new Map<string,Attempt>();
  for(const a of [...facts].sort((a,b)=>a.id-b.id))if(a.transfer_lineage)lastTraining.set(a.transfer_lineage.key,a);
  const failed=[...lastTraining.values()].filter(a=>transferTrainingOutcome(a)==="training transfer failure");
  const strengths:string[]=[];
  if(assessment?.selectionAccuracy?.denominator&&Number(assessment.selectionAccuracy.value)>=80)strengths.push(`選題は${assessment.selectionAccuracy.numerator}/${assessment.selectionAccuracy.denominator}で成功`);
  const retained=Object.values(data.masteryByProblem).filter(m=>m.normalReviewComplete).length;
  if(retained)strengths.push(`${retained}問題で通常復習が終了（別問題への転移とは区別）`);
  if(strong.length)strengths.push(`本番文脈の別問題で${strong.length}件の自然な転移成功を確認`);
  const pending=data.today.canonicalStudyPlan.ranked?.waiting.filter(w=>w.task.kind==="転移待機")||[];
  return {assessment,stage:assessment?.label||"判定材料不足",strengths,deficits:deficits.slice(0,3),
    retentionPending:tasks.filter(t=>(t.grading_contract?.learningPurpose||t.learning_purpose)==="retrieval_check").length,
    transfer:{trainingSuccess:training.length,strongSuccess:strong.length,failed:failed.length,strongStatus:assessment?.transfer?.statusCounts,
      eligible:tasks.filter(t=>t.learning_purpose==="transfer_check").length,
      pendingProblems:[...new Set(pending.map(w=>w.task.problem_id))],pendingReasons:[...new Set(pending.map(w=>w.task.transfer_training_key?w.reason:w.reevaluateWhen))]},
    latestAttemptId:Math.max(0,...facts.map(a=>a.id))};
}
