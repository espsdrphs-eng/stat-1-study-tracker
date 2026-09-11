import type {Attempt,GradedPartContract,Problem,RootWeakness} from "./types.ts";
import type {StoredExamReferencePack} from "./examReferencePack.ts";
import {canonicalPastExamProblemId} from "./examReferencePack.ts";
import {findingPlanningEligible} from "./legacyKPolicy.ts";
import type {StableTargetIndex} from "./stableTargetIdentity.ts";

const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
export function partSkillIds(part?:GradedPartContract){
  return unique([...(part?.fineConceptIds||[]),...(part?.solutionOperationIds||[]),...(part?.rootSkillIds||[]),
    // A stable target slot is identity, not a mathematical operation.
    ...(part?.rootCauseKey&&!part.rootCauseKey.startsWith("target:")?[part.rootCauseKey]:[])]);
}
export function problemSkillIds(problem?:Problem){
  return unique([...(problem?.fine_concept_ids||[]),...(problem?.solution_operation_ids||[]),...(problem?.root_skill_ids||[])]);
}
export function referenceSkills(record:StoredExamReferencePack|null|undefined,problemId:string,problems:Problem[]=[]){
  const canonical=canonicalPastExamProblemId(problemId);
  return unique([...problemSkillIds(problems.find(p=>p.problem_id===canonical)),
    ...(record?.data.pastExamProblems.find(p=>canonicalPastExamProblemId(p)===canonical)?.fine_concept_ids||[])]);
}
export function independentReferenceFree(attempt:Attempt){
  return !attempt.exclude_from_metrics&&!attempt.duplicate_of_attempt_id&&
    Number(attempt.actual_reference_level??attempt.reference_level??NaN)===0&&!attempt.hint_used&&
    attempt.assessment_timing!=="same_session_correction"&&!["scan","scan5","scan_only"].includes(attempt.mode);
}
export function confidentGrading(attempt:Attempt){
  const confidence=Number(attempt.grading_confidence??0);
  const normalized=confidence>1?confidence/100:confidence;
  return Number.isFinite(normalized)&&normalized>=.8&&normalized<=1;
}
export function successfulSkillIds(attempt:Attempt){
  if(!independentReferenceFree(attempt)||!confidentGrading(attempt))return [];
  const parts=attempt.grading_contract?.gradedParts||[];
  const findings=(attempt.graded_findings||[]).filter(f=>findingPlanningEligible(attempt,f));
  const failed=new Set(findings.filter(f=>!f.resolved&&f.error_type!=="none")
    .flatMap(f=>partSkillIds(parts.find(p=>p.id===f.graded_part_id))));
  return unique(findings.filter(f=>f.resolved&&f.error_type==="none").flatMap(f=>
    partSkillIds(parts.find(p=>p.id===f.graded_part_id)))).filter(id=>!failed.has(id));
}
/** Explicit success is scoped to the assessed root. Feedback/prose never counts. */
export function rootProgress(source:Attempt,root:RootWeakness,attempts:Attempt[],index?:StableTargetIndex){
  const sourceParts=(source.grading_contract?.gradedParts||[]).filter(p=>root.sourceFindingIds.includes(p.id));
  const identity=(a:Attempt,p:GradedPartContract)=>index?.attemptPart(a.id,p.id)?.identityKey||p.stableTargetKey||p.stable_target_key||p.id;
  const keys=new Set(sourceParts.map(p=>identity(source,p)));
  const later=attempts.filter(a=>a.id>source.id&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id).sort((a,b)=>a.id-b.id);
  let repairSuccess:Attempt|undefined;
  let latestFailure=source;
  for(const a of later.filter(a=>a.problem_id===source.problem_id)){
    const parts=a.grading_contract?.gradedParts||[];
    const relevant=(a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)&&parts.some(p=>p.id===f.graded_part_id&&
      (keys.has(identity(a,p))||partSkillIds(p).some(id=>root.skillIds.includes(id)))));
    if(relevant.some(f=>!f.resolved&&f.error_type!=="none")){latestFailure=a;repairSuccess=undefined;}
    else if(relevant.length&&relevant.every(f=>f.resolved&&f.error_type==="none")&&independentReferenceFree(a))repairSuccess=a;
  }
  const transfer=later.find(a=>a.id>latestFailure.id&&a.problem_id!==source.problem_id&&root.skillIds.length>0&&
    root.skillIds.every(id=>successfulSkillIds(a).includes(id)));
  return {repairSuccess,transfer,latestFailure};
}

export type TransferEvidence={id:string;sourceAttemptId:number;sourceProblemId:string;successAttemptId:number;
  successProblemId:string;skillId:string;date:string};
export function deriveTransferEvidence(attempts:Attempt[]):TransferEvidence[]{
  const rows:TransferEvidence[]=[],latestFailures=new Map<string,Attempt>();
  for(const a of [...attempts].sort((a,b)=>a.id-b.id)){
    if(a.exclude_from_metrics||a.duplicate_of_attempt_id)continue;
    for(const skillId of successfulSkillIds(a)){
      const failure=latestFailures.get(skillId);
      if(failure&&failure.problem_id!==a.problem_id)rows.push({id:`transfer:${failure.id}:${a.id}:${skillId}`,
        sourceAttemptId:failure.id,sourceProblemId:failure.problem_id,successAttemptId:a.id,successProblemId:a.problem_id,skillId,date:a.date});
    }
    for(const f of (a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)&&!f.resolved&&f.error_type!=="none"))
      for(const id of partSkillIds(a.grading_contract?.gradedParts.find(p=>p.id===f.graded_part_id)))latestFailures.set(id,a);
  }
  return rows;
}
