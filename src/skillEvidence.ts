import type {Attempt,GradedFinding,GradedPartContract,Problem,RootWeakness,Task} from "./types.ts";
import {groundedFindingSkills} from "./groundedSkills.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";
import type {StoredExamReferencePack} from "./examReferencePack.ts";
import {canonicalPastExamProblemId} from "./examReferencePack.ts";
import {findingPlanningEligible,attemptPlanningEligible} from "./legacyKPolicy.ts";
import type {StableTargetIndex} from "./stableTargetIdentity.ts";

const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
type EvidenceMemo={findings:WeakMap<Attempt,WeakMap<GradedFinding,string[]>>;
  successes:WeakMap<Attempt,string[]>;transfers:WeakMap<Attempt[],TransferEvidence[]>};
let activeMemo:EvidenceMemo|undefined;
/** Ephemeral, synchronous derivation scope. Never retained across saves or awaits. */
export function withSkillEvidenceMemo<T>(derive:()=>T):T{
  if(activeMemo)return derive();
  activeMemo={findings:new WeakMap(),successes:new WeakMap(),transfers:new WeakMap()};
  try{return derive();}finally{activeMemo=undefined;}
}
export function partSkillIds(part?:GradedPartContract){
  return unique([...(part?.fineConceptIds||[]),...(part?.solutionOperationIds||[]),...(part?.rootSkillIds||[]),
    // A stable target slot is identity, not a mathematical operation.
    ...(part?.rootCauseKey&&!part.rootCauseKey.startsWith("target:")?[part.rootCauseKey]:[])]);
}
export function problemSkillIds(problem?:Problem){
  return unique([...(problem?.fine_concept_ids||[]),...(problem?.solution_operation_ids||[]),...(problem?.root_skill_ids||[])]);
}
/** Shared derived scope; raw contracts and historical findings remain unchanged. */
export function findingSkillIds(attempt:Attempt,finding:GradedFinding){
  const cached=activeMemo?.findings.get(attempt)?.get(finding);if(cached)return cached;
  const result=unique([...partSkillIds(attempt.grading_contract?.gradedParts.find(p=>p.id===finding.graded_part_id)),
    ...groundedFindingSkills(attempt,finding).filter(t=>t.confidence==="high").map(t=>t.skillId)]);
  if(activeMemo){let rows=activeMemo.findings.get(attempt);if(!rows){rows=new WeakMap();activeMemo.findings.set(attempt,rows);}rows.set(finding,result);}
  return result;
}
export function referenceSkills(record:StoredExamReferencePack|null|undefined,problemId:string,problems:Problem[]=[]){
  const canonical=canonicalPastExamProblemId(problemId);
  return unique([...problemSkillIds(problems.find(p=>p.problem_id===canonical)),
    ...(record?.data.pastExamProblems.find(p=>canonicalPastExamProblemId(p)===canonical)?.fine_concept_ids||[])]);
}
function unassistedAnswer(attempt:Attempt){
  return !attempt.exclude_from_metrics&&!attempt.duplicate_of_attempt_id&&
    Number(attempt.actual_reference_level??attempt.reference_level??NaN)===0&&!attempt.hint_used&&
    !["scan","scan5","scan_only"].includes(attempt.mode);
}
export function independentReferenceFree(attempt:Attempt){
  return unassistedAnswer(attempt)&&attempt.assessment_timing!=="same_session_correction";
}
/** Completing a local correction is repair, never an independent retention or
 * transfer sample. Its later retrieval must still be delayed and unassisted. */
export function gradedRepairEvidence(attempt:Attempt){
  const reference=Number(attempt.actual_reference_level??attempt.reference_level??NaN);
  const allowed=Number(attempt.grading_contract?.allowedReferenceLevel??0);
  return attempt.learning_purpose==='error_repair'&&!attempt.exclude_from_metrics&&!attempt.duplicate_of_attempt_id&&
    Number.isInteger(reference)&&reference>=0&&reference<=5&&allowed>=0&&allowed<=5&&reference<=allowed&&(!attempt.hint_used||reference>0)&&
    !['scan','scan5','scan_only'].includes(attempt.mode);
}
export function confidentGrading(attempt:Attempt){
  const confidence=Number(attempt.grading_confidence??0);
  const normalized=confidence>1?confidence/100:confidence;
  return Number.isFinite(normalized)&&normalized>=.8&&normalized<=1;
}
/** Read-only explanation of an assessed part, never a new mastery state.
 * A high total score, missing reference data or contradictory finding is not
 * independent success. Identity still comes from the existing grounded path. */
export function findingEvidenceStatus(attempt:Attempt,finding:GradedFinding){
  const skillIds=findingSkillIds(attempt,finding);
  const assisted=!!attempt.hint_used||Number(attempt.actual_reference_level??attempt.reference_level)>0;
  const referenceKnown=Number.isInteger(attempt.actual_reference_level??attempt.reference_level);
  const good=finding.resolved&&finding.error_type==='none';
  const bad=!finding.resolved&&finding.error_type!=='none';
  const outcome=!attemptPlanningEligible(attempt)||attempt.exclude_from_planning||!findingPlanningEligible(attempt,finding)?'excluded':
    !confidentGrading(attempt)||!finding.evidence?.trim()||!referenceKnown||!good&&!bad?'uncertain':
    good?assisted?'assisted_success':'success':'failure';
  const labels={excluded:'採点対象外',uncertain:'判定保留・証拠不足',assisted_success:'援助ありの成功（独立成功ではない）',success:'対象内の自力成功',failure:assisted?'援助あり・未解消':'対象内の未解消'};
  return {outcome,label:labels[outcome],skillIds:[...skillIds],assisted,attemptId:attempt.id,date:attempt.date,
    partId:finding.graded_part_id,evidence:finding.evidence||''};
}
export function successfulSkillIds(attempt:Attempt){
  const cached=activeMemo?.successes.get(attempt);if(cached)return cached;
  const result=calculateSuccessfulSkillIds(attempt);activeMemo?.successes.set(attempt,result);return result;
}
function inScopeFindings(attempt:Attempt){
  const excluded=new Set(attempt.grading_contract?.explicitlyOutOfScopePartIds||[]);
  return (attempt.graded_findings||[]).filter(f=>!excluded.has(f.graded_part_id)&&findingPlanningEligible(attempt,f));
}
/** Unmapped major failures are uncertainty, not proof of another skill or a
 * reason to promote a first-step success to whole-operation success. */
function unclassifiedMajorFindings(attempt:Attempt){
  const inScope=new Set(inScopeFindings(attempt).map(f=>f.graded_part_id));
  return unique(deriveFailureEpisode(attempt).rootWeaknesses.filter(root=>root.requiredRepair&&!root.skillIds.length)
    .flatMap(root=>root.sourceFindingIds).filter(id=>inScope.has(id)));
}
const partIdentity=(attempt:Attempt,id:string)=>{
  const part=attempt.grading_contract?.gradedParts.find(p=>p.id===id);
  return part?.stableTargetKey||part?.stable_target_key||id;
};
/** A named operation and the assessed target must both match. Opaque part IDs,
 * a common chapter, a total score or a higher mastery number are not a match. */
function transferTargetProof(source:Attempt,destination:Attempt,skillId:string,requiredIds:string[]){
  if(!requiredIds.length||source.problem_id===destination.problem_id||!successfulSkillIds(destination).includes(skillId))return null;
  const lineage=destination.transfer_lineage;
  if(lineage&&lineage.matchConfidence==='high'&&lineage.sourceProblemId===source.problem_id&&
    (!lineage.sourceAttemptId||lineage.sourceAttemptId===source.id)&&lineage.rootSkillId===skillId&&
    requiredIds.every(id=>lineage.sourceFindingIds?.includes(id)))
    return {sourceFindingIds:requiredIds,successFindingIds:['transfer_target_assessment']};
  const successful=inScopeFindings(destination).filter(f=>f.resolved&&f.error_type==='none'&&findingSkillIds(destination,f).includes(skillId));
  const matched=requiredIds.map(id=>successful.find(f=>f.graded_part_id===id));
  if(matched.some(f=>!f))return null;
  return {sourceFindingIds:requiredIds,successFindingIds:unique(matched.map(f=>f!.graded_part_id))};
}
/** Projection-only lineage check. Never rewrites the source Attempt/contract. */
export function transferCoversFindings(evidence:TransferEvidence,source:Attempt,findingIds:string[]){
  if(evidence.sourceProblemId!==source.problem_id||!findingIds.length)return false;
  return findingIds.every(id=>evidence.sourceFindingIds?.includes(id)||
    evidence.sourceTargetKeys?.includes(partIdentity(source,id)));
}
export type TransferAssessmentWarning={sourceAttemptId:number;destinationAttemptId:number;sourceProblemId:string;
  destinationProblemId:string;skillId:string;requiredFindingIds:string[];unclassifiedFindingIds:string[];reason:string};
export function transferAssessmentWarning(source:Attempt,destination:Attempt,skillId:string):TransferAssessmentWarning{
  const required=inScopeFindings(source).filter(f=>!f.resolved&&f.error_type!=='none'&&findingSkillIds(source,f).includes(skillId));
  const unclassified=unclassifiedMajorFindings(destination);
  return {sourceAttemptId:source.id,destinationAttemptId:destination.id,sourceProblemId:source.problem_id,
    destinationProblemId:destination.problem_id,skillId,requiredFindingIds:required.map(f=>f.graded_part_id),unclassifiedFindingIds:unclassified,
    reason:unclassified.length?'初手などの成功はありますが、能力対応が未確定の重大な未解消箇所もあります。対象全体の転移成功は確認できません。':
      !independentReferenceFree(destination)||!confidentGrading(destination)?'参照状況または採点根拠が不足し、独立した転移か判断できません。':
      '元の失敗対象まで成功した証拠が揃っていません。初手だけの成功を主要計算・結論の成功には広げません。'};
}
/** Do not label an ungraded/uncertain answer as a transfer failure. */
export function transferTrainingOutcome(attempt:Attempt,confirmedSuccess=false){
  if(Number(attempt.actual_reference_level??attempt.reference_level)>0||attempt.hint_used)
    return "参照ありの転移訓練（独立成功ではありません）";
  const target=attempt.target_skill_assessment;
  if(!independentReferenceFree(attempt)||!confidentGrading(attempt)||!target?.evidence.trim())
    return "転移未確認（採点の根拠・確信度が不足）";
  if(!target.self_selected||!target.major_calculation_success||!target.no_major_error)return "training transfer failure";
  return confirmedSuccess?"training transfer success":"転移未確認（対象技能の対応が未確定）";
}
export function transferEvidenceStatus(attempt:Attempt,confirmedSuccess=false){
  const target=attempt.target_skill_assessment,lineage=attempt.transfer_lineage;
  const assisted=!!attempt.hint_used||Number(attempt.actual_reference_level??attempt.reference_level)>0;
  const valid=!!lineage&&lineage.sourceProblemId!==attempt.problem_id&&confidentGrading(attempt)&&!!target?.evidence.trim();
  const passed=!!target&&target.self_selected&&target.major_calculation_success&&target.no_major_error;
  const outcome=!valid?'uncertain':assisted?passed?'assisted_success':'failure':!independentReferenceFree(attempt)?'uncertain':!passed?'failure':confirmedSuccess?'success':'uncertain';
  const labels={uncertain:'別問題の判定保留',assisted_success:'援助ありの訓練成功（独立成功ではない）',failure:assisted?'援助ありの訓練・未解消':'別問題で対象技能を再現できなかった',success:'別問題で対象技能を確認'};
  return {outcome,label:labels[outcome],skillIds:lineage?[lineage.rootSkillId]:[],assisted,attemptId:attempt.id,date:attempt.date,
    partId:'転移対象技能',evidence:target?.evidence||''};
}
function calculateSuccessfulSkillIds(attempt:Attempt){
  // A GPT capability profile is not a verified mapping to the skill taxonomy.
  if(attempt.transfer_lineage?.abilityProfile)return [];
  if(!independentReferenceFree(attempt)||!confidentGrading(attempt))return [];
  if(attempt.source_type==="generated"||attempt.transfer_lineage){
    const target=attempt.target_skill_assessment;
    if(!target?.self_selected||!target.major_calculation_success||!target.no_major_error||!target.evidence.trim())return [];
    const lineage=attempt.transfer_lineage;
    if(lineage&&deriveFailureEpisode(attempt).rootWeaknesses.some(r=>r.requiredRepair&&r.skillIds.includes(lineage.rootSkillId)))return [];
    if(lineage?.matchConfidence==="high"&&lineage.sourceProblemId!==attempt.problem_id&&lineage.sourceFindingIds?.length)
      return [lineage.rootSkillId];
  }
  const findings=inScopeFindings(attempt);
  const failed=new Set(findings.filter(f=>!f.resolved&&f.error_type!=="none")
    .flatMap(f=>findingSkillIds(attempt,f)));
  if(unclassifiedMajorFindings(attempt).length)return [];
  return unique(findings.filter(f=>f.resolved&&f.error_type==="none").flatMap(f=>
    findingSkillIds(attempt,f))).filter(id=>!failed.has(id));
}
/** Shared exact target lineage, including targets persisted by legacy Reviews. */
export function rootTargetKeys(source:Attempt,root:RootWeakness,attempts:Attempt[],index?:StableTargetIndex){
  const sourceParts=(source.grading_contract?.gradedParts||[]).filter(p=>root.sourceFindingIds.includes(p.id));
  const identity=(a:Attempt,p:GradedPartContract)=>index?.attemptPart(a.id,p.id)?.identityKey||p.stableTargetKey||p.stable_target_key||p.id;
  const keys=new Set(sourceParts.map(p=>identity(source,p)));
  // Historical unstructured failures acquired an explicit target when a
  // Review was issued. The dynamic part ID encodes its source Attempt, not
  // a guessed skill or similar error text. Reuse that persisted lineage.
  if(!sourceParts.length&&root.sourceFindingIds.some(id=>id.startsWith(`attempt:${source.id}:legacy:`))){
    const prefix=`part:${source.problem_id}:${source.id}:`;
    for(const a of attempts.filter(a=>a.problem_id===source.problem_id))
      for(const p of a.grading_contract?.gradedParts||[])
        if(typeof p?.id==='string'&&p.id.startsWith(prefix)&&/^\d+$/.test(p.id.slice(prefix.length)))keys.add(identity(a,p));
  }
  return keys;
}
/** Explicit success is scoped to the assessed root. Feedback/prose never counts. */
export function rootProgress(source:Attempt,root:RootWeakness,attempts:Attempt[],index?:StableTargetIndex){
  const keys=rootTargetKeys(source,root,attempts,index);
  const identity=(a:Attempt,p:GradedPartContract)=>index?.attemptPart(a.id,p.id)?.identityKey||p.stableTargetKey||p.stable_target_key||p.id;
  const later=attempts.filter(a=>a.id>source.id&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id).sort((a,b)=>a.id-b.id);
  let repairSuccess:Attempt|undefined;
  let latestFailure=source;
  for(const a of later.filter(a=>a.problem_id===source.problem_id)){
    const parts=a.grading_contract?.gradedParts||[];
    const relevant=inScopeFindings(a).filter(f=>parts.some(p=>p.id===f.graded_part_id&&keys.has(identity(a,p))));
    const covered=new Set(relevant.map(f=>identity(a,parts.find(p=>p.id===f.graded_part_id)!)));
    const completeCoverage=keys.size>0&&[...keys].every(key=>covered.has(key));
    if(relevant.some(f=>!f.resolved&&f.error_type!=="none")){latestFailure=a;repairSuccess=undefined;}
    else if(a.learning_purpose!=="retrieval_check"&&completeCoverage&&relevant.length&&
      relevant.every(f=>f.resolved&&f.error_type==="none")&&(independentReferenceFree(a)||gradedRepairEvidence(a))&&confidentGrading(a))repairSuccess=a;
  }
  // A scaffold on another problem is still repair, not the independent test
  // after repair. Require explicit source lineage before it can unlock transfer.
  for(const a of later.filter(a=>a.id>latestFailure.id&&a.problem_id!==source.problem_id&&
    a.source_problem_id===source.problem_id&&a.learning_purpose==="error_repair")){
    if(root.skillIds.length&&root.skillIds.every(id=>!!transferTargetProof(source,a,id,root.sourceFindingIds))&&
      (!repairSuccess||a.id>repairSuccess.id))repairSuccess=a;
  }
  const transferFailure=later.filter(a=>a.id>(repairSuccess?.id||latestFailure.id)&&a.problem_id!==source.problem_id&&
    a.transfer_lineage?.sourceProblemId===source.problem_id&&root.skillIds.includes(a.transfer_lineage.rootSkillId)&&
    independentReferenceFree(a)&&confidentGrading(a)&&a.target_skill_assessment&&
    (!a.target_skill_assessment.self_selected||!a.target_skill_assessment.major_calculation_success||!a.target_skill_assessment.no_major_error)).at(-1);
  if(transferFailure)repairSuccess=undefined;
  const transferCandidates=root.skillIds.length?later.filter(a=>a.id>(transferFailure?.id||latestFailure.id)&&
    a.problem_id!==source.problem_id&&a.learning_purpose!=='error_repair'&&root.skillIds.every(id=>successfulSkillIds(a).includes(id))):[];
  const transferRows=transferCandidates.length?deriveTransferEvidence(attempts):[];
  const transfer=transferCandidates.find(a=>
    root.skillIds.every(id=>transferRows.some(e=>e.successAttemptId===a.id&&e.skillId===id&&transferCoversFindings(e,source,root.sourceFindingIds))));
  return {repairSuccess,transfer,latestFailure,transferFailure};
}

export type TransferEvidence={id:string;sourceAttemptId:number;sourceProblemId:string;successAttemptId:number;
  successProblemId:string;skillId:string;date:string;evidenceStrength:"training"|"strong";
  sourceFindingIds?:string[];sourceTargetKeys?:string[];successFindingIds?:string[];
  lineage?:Attempt["transfer_lineage"]};
/** Same raw-evidence check for the audit and all current-state displays. */
export function verifiedTransferRediagnosis(task:Task,attempts:Attempt[]){
  const lineage=task.repair_lineage;
  if(lineage?.intervention!=='rediagnosis'||!lineage.transferFailureEvidenceId)return false;
  const facts=attempts.filter(attemptPlanningEligible),source=facts.find(a=>a.id===lineage.sourceAttemptId);
  if(!source)return false;
  const root=deriveFailureEpisode(source).rootWeaknesses.find(r=>r.rootWeaknessId===lineage.rootWeaknessId);
  if(!root)return false;
  const progress=rootProgress(source,root,facts);
  return progress.transferFailure?.id===lineage.transferFailureEvidenceId&&!progress.repairSuccess&&!progress.transfer;
}
export function transferEvidenceStrength(a:Attempt):"training"|"strong"{
  if(a.session_role==='counterfactual_calibration')return 'training';
  // A previously studied exam year can measure improvement, but not blind
  // transfer in a new exam context.
  if(/^PY-2025-Q\d+$/.test(a.problem_id))return "training";
  const past=a.source_type==="past_exam"||(!a.source_type&&/^PY-\d{4}-Q\d+$/.test(a.problem_id));
  return past&&!a.target_skill_prompted&&!a.is_review_attempt&&
    !["error_repair","retrieval_check","transfer_check"].includes(String(a.learning_purpose))&&
    ["full","timed","timed_single","exam_90min","past_exam"].includes(a.mode)&&a.evidence_strength!=="training"?"strong":"training";
}
export function deriveTransferEvidence(attempts:Attempt[]):TransferEvidence[]{
  return withSkillEvidenceMemo(()=>{
    const cached=activeMemo!.transfers.get(attempts);if(cached)return cached;
    const result=calculateTransferEvidence(attempts);activeMemo!.transfers.set(attempts,result);return result;
  });
}
function calculateTransferEvidence(attempts:Attempt[]):TransferEvidence[]{
  // A skill can be unresolved on several independent source problems. Keeping
  // only one global failure loses the other roots when a later problem fails.
  const rows:TransferEvidence[]=[],latestFailures=new Map<string,Map<string,Map<string,{source:Attempt;findingId:string}>>>();
  for(const a of [...attempts].sort((a,b)=>a.id-b.id)){
    if(a.exclude_from_metrics||a.duplicate_of_attempt_id)continue;
    for(const skillId of a.learning_purpose==="error_repair"?[]:successfulSkillIds(a)){
      for(const [sourceProblemId,targets] of latestFailures.get(skillId)||[]){
        if(sourceProblemId===a.problem_id)continue;
        const lineage=a.transfer_lineage;
        // A pre-issued training contract evaluates its explicit source scope,
        // not every older sibling on that problem. Keep implicit/natural
        // evidence conservative; a scoped result never clears other findings.
        const scoped=lineage?.matchConfidence==='high'&&lineage.sourceProblemId===sourceProblemId&&lineage.rootSkillId===skillId;
        const requirements=[...targets.values()].filter(r=>!scoped||
          (!lineage.sourceAttemptId||lineage.sourceAttemptId===r.source.id)&&lineage.sourceFindingIds?.includes(r.findingId));
        if(!requirements.length)continue;
        const proofs=requirements.map(r=>transferTargetProof(r.source,a,skillId,[r.findingId]));
        if(proofs.some(p=>!p))continue;
        const bySource=new Map<number,{source:Attempt;sourceFindingIds:string[];successFindingIds:string[]}>();
        requirements.forEach((r,i)=>{const row=bySource.get(r.source.id)||{source:r.source,sourceFindingIds:[],successFindingIds:[]};
          row.sourceFindingIds.push(r.findingId);row.successFindingIds.push(...proofs[i]!.successFindingIds);bySource.set(r.source.id,row);});
        for(const {source,sourceFindingIds,successFindingIds} of bySource.values())rows.push({id:`transfer:${source.id}:${a.id}:${skillId}`,
          sourceAttemptId:source.id,sourceProblemId,successAttemptId:a.id,successProblemId:a.problem_id,skillId,date:a.date,
          sourceFindingIds:unique(sourceFindingIds),sourceTargetKeys:unique(sourceFindingIds.map(id=>partIdentity(source,id))),
          successFindingIds:unique(successFindingIds),evidenceStrength:transferEvidenceStrength(a),lineage:a.transfer_lineage});
      }
    }
    for(const f of (a.source_type==="generated"?[]:inScopeFindings(a)).filter(f=>!f.resolved&&f.error_type!=="none"))
      for(const id of findingSkillIds(a,f)){
        const sources=latestFailures.get(id)||new Map<string,Map<string,{source:Attempt;findingId:string}>>();
        const targets=sources.get(a.problem_id)||new Map<string,{source:Attempt;findingId:string}>();
        targets.set(partIdentity(a,f.graded_part_id),{source:a,findingId:f.graded_part_id});
        sources.set(a.problem_id,targets);latestFailures.set(id,sources);
      }
  }
  return rows;
}

/** Historical successes stay immutable; current capability needs evidence newer
 * than a subsequent verified failure for that source/skill. */
export function currentTransferEvidence(attempts:Attempt[]){
  const current=deriveTransferEvidence(attempts).filter(row=>!attempts.some(a=>a.id>row.successAttemptId&&
    !a.exclude_from_metrics&&!a.duplicate_of_attempt_id&&(
      a.problem_id===row.sourceProblemId&&(a.graded_findings||[]).some(f=>findingPlanningEligible(a,f)&&
        !f.resolved&&f.error_type!=='none'&&(findingSkillIds(a,f).includes(row.skillId)||
          row.sourceFindingIds?.includes(f.graded_part_id)||row.sourceTargetKeys?.includes(partIdentity(a,f.graded_part_id))))||
      a.transfer_lineage?.sourceProblemId===row.sourceProblemId&&a.transfer_lineage.rootSkillId===row.skillId&&
        independentReferenceFree(a)&&confidentGrading(a)&&!!a.target_skill_assessment&&
        (!a.target_skill_assessment.self_selected||!a.target_skill_assessment.major_calculation_success||!a.target_skill_assessment.no_major_error)
    )));
  const opportunities=new Map<string,TransferEvidence>();
  for(const row of current){
    const key=JSON.stringify([row.sourceProblemId,row.skillId,row.successProblemId]),old=opportunities.get(key);
    // Regrading/repeating one destination is not a new different problem.
    // Keep the strongest current proof, then the latest equal-strength proof.
    if(!old||old.evidenceStrength==='training'&&row.evidenceStrength==='strong'||
      old.evidenceStrength===row.evidenceStrength&&row.successAttemptId>old.successAttemptId)opportunities.set(key,row);
  }
  return [...opportunities.values()];
}
