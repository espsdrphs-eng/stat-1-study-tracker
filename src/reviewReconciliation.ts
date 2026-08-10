import type {
  Attempt, GradedFinding, GradedPartContract, GradingErrorType, ProblemAlias, Review, TodayPlanSnapshot,
} from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";

const ACTIVE_STATUSES=new Set(["pending","overdue"]);
const STANDARD_PURPOSES=new Set(["error_repair","retrieval_check"]);

export type LearningEvidenceEvent={
  problemId:string;part:GradedPartContract;attemptId:number;attemptDate:string;
  errorType:GradingErrorType;resolved:boolean;evidence:string;
};

export type ProblemReconciliation={
  problemId:string;
  activeRepairReviewIds:number[];
  activeDelayedReviewIds:number[];
  desiredRepairParts:GradedPartContract[];
  desiredRepairFindings:GradedFinding[];
  desiredSourceAttemptId?:number;
  reviewsToSupersede:Array<{reviewId:number;reason:string;category:
    "stale_repair"|"partially_stale_repair"|"duplicate_active_review"|"contradictory_review"|
    "wrong_source_review"|"orphan_review"|"graduated_but_pending"|"stale_delayed_check"}>;
  replacementRequired:boolean;
  retentionCheckRequired:boolean;
  retentionSourceAttemptId?:number;
  graduated:boolean;
  ambiguousReasons:string[];
};

export type ReconciliationAudit={
  generatedAt:string;
  problems:ProblemReconciliation[];
  staleRepairs:number;
  partiallyStaleRepairs:number;
  duplicateActiveReviews:number;
  contradictoryReviews:number;
  wrongSourceReviews:number;
  orphanReviews:number;
  graduatedButPending:number;
  staleDelayedChecks:number;
  staleTodayActions:number;
  replacementsRequired:number;
  ambiguousProblems:number;
};

function reviewPurpose(review:Review){
  return String(review.grading_contract?.learningPurpose||review.learning_purpose||"");
}

function activeReview(review:Review){
  return ACTIVE_STATUSES.has(review.status)&&review.policy_validity!=="invalid_legacy_k"&&
    review.exclude_from_planning!==true&&!review.review_needed_reason;
}

function validAttempt(attempt:Attempt){
  return !attempt.duplicate_of_attempt_id&&!attempt.exclude_from_metrics&&
    !["scan","scan5","scan_only"].includes(String(attempt.mode||attempt.evaluation_scope||""));
}

function attemptOrder(left:Attempt,right:Attempt){
  return left.id-right.id||left.date.localeCompare(right.date);
}

function attemptAfter(attempt:Attempt,source:Attempt|undefined){
  return !source||attempt.id>source.id;
}

function attemptAtOrAfter(attempt:Attempt,source:Attempt|undefined){
  return !source||attempt.id>=source.id;
}

function comprehensivelyGrades(attempt:Attempt,partId:string){
  const contract=attempt.grading_contract;
  if(contract?.explicitlyOutOfScopePartIds?.includes(partId))return false;
  if((attempt.graded_findings||[]).some(row=>row.graded_part_id===partId)||
    (attempt.graded_part_ids||[]).includes(partId))return true;
  const scope=String(contract?.reviewScope||attempt.review_scope||attempt.evaluation_scope||"");
  const mode=String(contract?.mode||attempt.mode||"");
  // A modern full-answer Attempt is evidence about the complete answer even
  // when a newly discovered issue received a different stable part id. Narrow
  // patches/checks never get this treatment, so omitted targets remain open.
  return (attempt.graded_findings||[]).length>0&&
    (scope==="full_answer"||["full","timed","timed_single","past_exam"].includes(mode));
}

function errorsFor(attempt:Attempt){
  return [...new Set((attempt.effective_error_types?.length?attempt.effective_error_types:
    attempt.error_types?.length?attempt.error_types:[attempt.error_type]).filter(value=>["K","W","N","C"].includes(String(value))))] as GradingErrorType[];
}

function kIsUsable(attempt:Attempt){
  return attempt.k_evidence_valid===true||!!attempt.k_evidence?.some(value=>String(value).trim());
}

function partsFromContract(review:Review):GradedPartContract[]{
  const raw=review.grading_contract?.gradedParts||[];
  return raw.flatMap((part,index)=>{
    if(typeof part!=="string")return part?.id?[part]:[];
    const id=review.graded_part_ids?.[index];
    return id?[{id,label:part,cueLabel:part,allowedErrorTypes:["K","W","N","C","none"],
      completionCriterionId:`legacy_${id}`} as GradedPartContract]:[];
  });
}

function partCatalog(attempts:Attempt[],reviews:Review[]){
  const rows=new Map<string,GradedPartContract>();
  for(const review of reviews)for(const part of partsFromContract(review))rows.set(part.id,part);
  for(const attempt of attempts){
    for(const part of attempt.grading_contract?.gradedParts||[])
      if(typeof part!=="string"&&part?.id)rows.set(part.id,part);
    const ids=attempt.graded_part_ids||[];
    ids.forEach((id,index)=>{
      if(rows.has(id))return;
      const label=attempt.graded_parts?.[index]||id;
      rows.set(id,{id,label,cueLabel:label,allowedErrorTypes:["K","W","N","C","none"],
        completionCriterionId:`preserve_${id}`});
    });
  }
  return rows;
}

function evidenceEvents(attempt:Attempt,catalog:Map<string,GradedPartContract>):LearningEvidenceEvent[]{
  if(!validAttempt(attempt))return [];
  const explicit=attempt.graded_findings||[];
  if(explicit.length)return explicit.flatMap(finding=>{
    if(!finding.graded_part_id||finding.error_type==="K"&&!kIsUsable(attempt))return [];
    const part=catalog.get(finding.graded_part_id)||{
      id:finding.graded_part_id,label:finding.graded_part_id,cueLabel:finding.graded_part_id,
      allowedErrorTypes:[finding.error_type,"none"],completionCriterionId:`preserve_${finding.graded_part_id}`,
    } satisfies GradedPartContract;
    return [{problemId:attempt.problem_id,part,attemptId:attempt.id,attemptDate:attempt.date,
      errorType:finding.error_type,resolved:finding.resolved&&finding.error_type==="none",evidence:finding.evidence||""}];
  });
  const ids=attempt.graded_part_ids||[];
  if(!ids.length)return [];
  const errors=errorsFor(attempt);
  const success=(attempt.minimum_pass_condition_met===true||attempt.target_issue_resolved===true)&&errors.length===0;
  if(success)return ids.flatMap(id=>{
    const part=catalog.get(id);return part?[{problemId:attempt.problem_id,part,attemptId:attempt.id,
      attemptDate:attempt.date,errorType:"none" as const,resolved:true,evidence:attempt.resolution_evidence||""}]:[];
  });
  if(ids.length===1&&errors.length===1){
    if(errors[0]==="K"&&!kIsUsable(attempt))return [];
    const part=catalog.get(ids[0]);return part?[{problemId:attempt.problem_id,part,attemptId:attempt.id,
      attemptDate:attempt.date,errorType:errors[0],resolved:false,evidence:attempt.error_point||""}]:[];
  }
  return [];
}

function objectiveGraduation(attempt:Attempt){
  const findings=attempt.graded_findings||[];
  const noErrors=errorsFor(attempt).length===0;
  return attempt.mark==="◎"||(
    attempt.learning_purpose==="retrieval_check"&&attempt.assessment_timing==="delayed_retrieval"&&
    Number(attempt.actual_reference_level??attempt.reference_level??0)===0&&!attempt.hint_used&&
    attempt.minimum_pass_condition_met===true&&attempt.target_issue_resolved===true&&noErrors&&
    findings.length>0&&findings.every(row=>row.resolved&&row.error_type==="none")
  );
}

function sameIds(left:Iterable<string>,right:Iterable<string>){
  return JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
}

function uniqueSupersedes(rows:ProblemReconciliation["reviewsToSupersede"]){
  const seen=new Set<number>();
  return rows.filter(row=>!seen.has(row.reviewId)&&(seen.add(row.reviewId),true));
}

export function analyzeReviewReconciliation(args:{
  attempts:Attempt[];reviews:Review[];aliases?:ProblemAlias[];today:string;todayPlanSnapshots?:TodayPlanSnapshot[];
}):ReconciliationAudit{
  const aliases=args.aliases||[],catalog=partCatalog(args.attempts,args.reviews);
  const canonical=(value:string)=>resolveCanonicalProblemId(value,aliases);
  const attempts=args.attempts.filter(validAttempt).map(row=>({...row,problem_id:canonical(row.problem_id)})).sort(attemptOrder);
  const reviews=args.reviews.map(row=>({...row,problem_id:canonical(row.problem_id)}));
  const problemIds=new Set([...attempts.map(row=>row.problem_id),...reviews.map(row=>row.problem_id)]);
  const problems:ProblemReconciliation[]=[];

  for(const problemId of problemIds){
    const problemAttempts=attempts.filter(row=>row.problem_id===problemId);
    const problemReviews=reviews.filter(row=>row.problem_id===problemId);
    const active=problemReviews.filter(activeReview);
    const repairs=active.filter(row=>reviewPurpose(row)==="error_repair");
    const delayed=active.filter(row=>reviewPurpose(row)==="retrieval_check");
    const attemptMap=new Map(problemAttempts.map(row=>[row.id,row]));
    const events=problemAttempts.flatMap(attempt=>evidenceEvents(attempt,catalog));
    const lastEvent=new Map<string,LearningEvidenceEvent>();
    for(const event of events)lastEvent.set(event.part.id,event);
    const desired=new Map<string,LearningEvidenceEvent>();
    for(const event of lastEvent.values())if(!event.resolved)desired.set(event.part.id,event);
    const ambiguous:string[]=[];
    for(const repair of repairs){
      const source=attemptMap.get(Number(repair.source_attempt_id||repair.generated_from_attempt_id||0));
      const parts=partsFromContract(repair);
      if(!source)continue;
      if(!parts.length)ambiguous.push(`Review ${repair.id}: 安定したgraded part IDがない`);
      for(const part of parts){
        const later=events.filter(event=>event.part.id===part.id&&attemptAfter(attemptMap.get(event.attemptId)!,source)).at(-1);
        const laterComprehensive=problemAttempts.filter(attempt=>attemptAfter(attempt,source)&&
          comprehensivelyGrades(attempt,part.id)).at(-1);
        if(!later&&laterComprehensive)desired.delete(part.id);
        if(!later&&!laterComprehensive&&!lastEvent.has(part.id))desired.set(part.id,{problemId,part,attemptId:source.id,
          attemptDate:source.date,errorType:(errorsFor(source)[0]||"N"),resolved:false,evidence:source.error_point||""});
      }
    }
    const desiredRows=[...desired.values()].sort((a,b)=>a.part.id.localeCompare(b.part.id));
    const desiredIds=desiredRows.map(row=>row.part.id);
    const desiredSource=desiredRows.map(row=>attemptMap.get(row.attemptId)).filter((row):row is Attempt=>!!row).sort(attemptOrder).at(-1);
    const latestGraduation=[...problemAttempts].filter(objectiveGraduation).sort(attemptOrder).at(-1);
    const latestAttempt=problemAttempts.at(-1);
    const latestAttemptHasUnresolved=!!latestAttempt&&events.some(event=>event.attemptId===latestAttempt.id&&!event.resolved);
    const latestUnresolved=desiredRows.map(row=>attemptMap.get(row.attemptId)).filter((row):row is Attempt=>!!row).sort(attemptOrder).at(-1);
    const graduated=!!latestGraduation&&(!latestUnresolved||attemptOrder(latestGraduation,latestUnresolved)>0);
    const latestSuccessfulRepair=[...problemAttempts].filter(attempt=>{
      const rows=evidenceEvents(attempt,catalog);
      return attempt.minimum_pass_condition_met===true&&attempt.target_issue_resolved===true&&errorsFor(attempt).length===0&&
        rows.length>0&&rows.every(row=>row.resolved)&&!objectiveGraduation(attempt);
    }).sort(attemptOrder).at(-1);
    const supersedes:ProblemReconciliation["reviewsToSupersede"]=[];

    for(const review of active){
      const source=attemptMap.get(Number(review.source_attempt_id||review.generated_from_attempt_id||0));
      if(!source){supersedes.push({reviewId:review.id,category:"orphan_review",reason:"参照元Attemptが存在しない"});continue;}
      if(canonical(source.problem_id)!==problemId&&!['verified_linked_problem','transfer_schedule'].includes(String(review.origin||""))){
        supersedes.push({reviewId:review.id,category:"wrong_source_review",reason:`source Attempt ${source.id}の問題IDが対象と異なる`});
        continue;
      }
      const purpose=reviewPurpose(review);
      if(!STANDARD_PURPOSES.has(purpose))continue;
      if(graduated&&latestGraduation&&attemptAtOrAfter(latestGraduation,source)){
        supersedes.push({reviewId:review.id,category:"graduated_but_pending",reason:`Attempt ${latestGraduation.id}で保持確認を通過済み`});
        continue;
      }
      if(purpose==="retrieval_check"){
        const laterUnresolved=desiredRows.find(row=>attemptAtOrAfter(attemptMap.get(row.attemptId)!,source));
        if(laterUnresolved)supersedes.push({reviewId:review.id,category:"stale_delayed_check",
          reason:`Attempt ${laterUnresolved.attemptId}で状態が変化したため保持確認を終了`});
      }
    }

    const viableRepairs=repairs.filter(row=>!supersedes.some(item=>item.reviewId===row.id));
    if(desiredIds.length===0){
      for(const review of viableRepairs)supersedes.push({reviewId:review.id,category:"contradictory_review",
        reason:"現在未解決の採点対象がない"});
    }else{
      const exact=viableRepairs.filter(review=>sameIds(partsFromContract(review).map(part=>part.id),desiredIds));
      const preferred=[...exact].sort((a,b)=>Number(b.source_attempt_id||b.generated_from_attempt_id)-Number(a.source_attempt_id||a.generated_from_attempt_id)||b.id-a.id)[0];
      for(const review of viableRepairs){
        if(review.id===preferred?.id)continue;
        const ids=partsFromContract(review).map(part=>part.id);
        const overlap=ids.filter(id=>desired.has(id));
        supersedes.push({reviewId:review.id,
          category:viableRepairs.length>1&&sameIds(ids,desiredIds)?"duplicate_active_review":overlap.length&&overlap.length<ids.length?"partially_stale_repair":"stale_repair",
          reason:`現在の未解決targetは ${desiredIds.join(", ")}`});
      }
      if(preferred&&desiredSource&&Number(preferred.source_attempt_id||preferred.generated_from_attempt_id)!==desiredSource.id){
        supersedes.push({reviewId:preferred.id,category:"wrong_source_review",
          reason:`最新の未解決証拠はAttempt ${desiredSource.id}`});
      }
    }
    const normalized=uniqueSupersedes(supersedes);
    const remainingRepairs=repairs.filter(row=>!normalized.some(item=>item.reviewId===row.id));
    const replacementRequired=!ambiguous.length&&!graduated&&desiredIds.length>0&&(repairs.length>0||latestAttemptHasUnresolved)&&
      !(remainingRepairs.length===1&&sameIds(partsFromContract(remainingRepairs[0]).map(part=>part.id),desiredIds)&&
        Number(remainingRepairs[0].source_attempt_id||remainingRepairs[0].generated_from_attempt_id)===desiredSource?.id);
    const oldestRepairSource=repairs.map(row=>attemptMap.get(Number(row.source_attempt_id||row.generated_from_attempt_id||0)))
      .filter((row):row is Attempt=>!!row).sort(attemptOrder)[0];
    const retentionCheckRequired=!ambiguous.length&&!graduated&&desiredIds.length===0&&repairs.length>0&&delayed.length===0&&
      !!latestSuccessfulRepair&&(!oldestRepairSource||attemptAfter(latestSuccessfulRepair,oldestRepairSource));
    if(active.length||desiredIds.length||ambiguous.length)problems.push({problemId,
      activeRepairReviewIds:repairs.map(row=>row.id),activeDelayedReviewIds:delayed.map(row=>row.id),
      desiredRepairParts:desiredRows.map(row=>row.part),desiredRepairFindings:desiredRows.map(row=>({
        graded_part_id:row.part.id,error_type:row.errorType,evidence:row.evidence,resolved:false,
      })),desiredSourceAttemptId:desiredSource?.id,reviewsToSupersede:normalized,replacementRequired,graduated,
      retentionCheckRequired,retentionSourceAttemptId:retentionCheckRequired?latestSuccessfulRepair?.id:undefined,
      ambiguousReasons:[...new Set(ambiguous)]});
  }

  const allSupersedes=problems.flatMap(row=>row.reviewsToSupersede);
  const activeByProblem=new Map<string,Review[]>();
  for(const review of reviews.filter(activeReview))activeByProblem.set(review.problem_id,[...(activeByProblem.get(review.problem_id)||[]),review]);
  let staleTodayActions=0;
  // Saved plans are immutable history. Only the currently executable day's
  // snapshot can contain an obsolete action; older snapshots intentionally keep
  // the wording and contract that were shown on that day.
  for(const snapshot of (args.todayPlanSnapshots||[]).filter(row=>row.date===args.today))for(const task of snapshot.tasks){
    if(!task.id||!task.review_type)continue;
    const review=reviews.find(row=>row.id===task.id);
    const problemId=canonical(task.problem_id);
    const stale=!review||!activeReview(review)||allSupersedes.some(row=>row.reviewId===review.id);
    const current=activeByProblem.get(problemId)||[];
    if(stale&&current.length)staleTodayActions++;
  }
  const count=(category:ProblemReconciliation["reviewsToSupersede"][number]["category"])=>
    allSupersedes.filter(row=>row.category===category).length;
  return {generatedAt:new Date().toISOString(),problems,
    staleRepairs:count("stale_repair"),partiallyStaleRepairs:count("partially_stale_repair"),
    duplicateActiveReviews:count("duplicate_active_review"),contradictoryReviews:count("contradictory_review"),
    wrongSourceReviews:count("wrong_source_review"),orphanReviews:count("orphan_review"),
    graduatedButPending:count("graduated_but_pending"),staleDelayedChecks:count("stale_delayed_check"),staleTodayActions,
    replacementsRequired:problems.filter(row=>row.replacementRequired||row.retentionCheckRequired).length,
    ambiguousProblems:problems.filter(row=>row.ambiguousReasons.length).length};
}

export function reconciliationForProblem(audit:ReconciliationAudit,problemId:string,aliases:ProblemAlias[]=[]){
  const canonical=resolveCanonicalProblemId(problemId,aliases);
  return audit.problems.find(row=>row.problemId===canonical);
}
