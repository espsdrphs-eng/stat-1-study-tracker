import type {Attempt,GradedPartContract,MasteryLevelState,ProblemMasteryState,Review} from "./types.ts";
import {resolvePersistedAttemptLifecycle} from "./reviewTransition.ts";
import {attemptPlanningEligible,findingPlanningEligible} from "./legacyKPolicy.ts";
import {currentTransferEvidence,independentReferenceFree,gradedRepairEvidence} from './skillEvidence.ts';
import {buildStableTargetIndex} from './stableTargetIdentity.ts';

const LEVEL_TITLES={1:"骨格保持",2:"主要計算完遂",3:"転移"} as const;
const STATUS_LABELS={
  unconfirmed:"未確認",repairing:"修復中",retention_pending:"保持確認待ち",
  retained:"◎ 保持済み",needs_recheck:"要再確認",
} as const;
const LEVEL1_IDS=new Set(["problem_type","first_step","focal_quantity","critical_condition"]);
const active=(review:Review)=>["pending","overdue"].includes(review.status)&&!review.exclude_from_planning;

export function masteryLevelForPart(part:GradedPartContract,review?:Review):1|2|3{
  if(part.masteryLevel)return part.masteryLevel;
  if(LEVEL1_IDS.has(part.id))return 1;
  const purpose=review?.grading_contract?.learningPurpose||review?.learning_purpose;
  if(purpose==="transfer_check")return 3;
  if(part.currentErrorType==="K")return 1;
  const mode=review?.grading_contract?.mode||review?.effective_mode;
  return mode==="check"||mode==="skeleton"?1:2;
}

function state(level:1|2|3,status:MasteryLevelState["status"],activeTargetCount=0,retainedTargetCount=0):MasteryLevelState{
  return {level,title:LEVEL_TITLES[level],status,label:level===3&&status==='retained'?'別問題の確認あり':STATUS_LABELS[status],activeTargetCount,retainedTargetCount};
}

export function deriveProblemMasteryState(args:{problemId:string;attempts:Attempt[];reviews:Review[];transferEvidence?:ReturnType<typeof currentTransferEvidence>}):ProblemMasteryState{
  const attempts=args.attempts.filter(row=>row.problem_id===args.problemId&&attemptPlanningEligible(row));
  const reviews=args.reviews.filter(row=>row.problem_id===args.problemId);
  const current=reviews.filter(active).filter(row=>["error_repair","retrieval_check"].includes(String(row.grading_contract?.learningPurpose||row.learning_purpose||"")));
  const level1Collapse=current.some(review=>(review.grading_contract?.gradedParts||[]).some(part=>
    masteryLevelForPart(part,review)===1&&part.currentErrorType==="K"));
  const repairing=[0,0,0,0],waiting=[0,0,0,0],retained=[0,0,0,0];
  for(const review of current){
    const purpose=review.grading_contract?.learningPurpose||review.learning_purpose;
    for(const part of review.grading_contract?.gradedParts||[]){
      const level=masteryLevelForPart(part,review);
      (purpose==="retrieval_check"?waiting:repairing)[level]++;
    }
  }
  const targets=buildStableTargetIndex({attempts,reviews});
  const activeKeys=new Set(current.flatMap(review=>(review.grading_contract?.gradedParts||[]).map(part=>
    targets.reviewPart(review.id,part.id)?.identityKey||`review:${review.id}:${part.id}`)));
  const unresolved=new Map<string,1|2|3>(),awaitingRetention=new Map<string,1|2|3>();
  const retainedKeys=new Map<string,1|2|3>();
  for(const attempt of [...attempts].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id)){
    if(attempt.mode==="scan5"||attempt.exam_score_eligible===false&&attempt.mode==="scan5")continue;
    const lifecycle=resolvePersistedAttemptLifecycle(attempt);
    const reference=attempt.actual_reference_level??attempt.reference_level;
    const referenceFree=Number.isInteger(reference)&&reference===0&&!attempt.hint_used;
    const targetRetention=referenceFree&&((attempt.learning_purpose==="retrieval_check"&&attempt.assessment_timing==="delayed_retrieval")||
      (!attempt.learning_purpose&&!attempt.assessment_timing&&lifecycle.graduated));
    const parts=attempt.grading_contract?.gradedParts||[];
    for(const finding of attempt.graded_findings||[]){
      if(!findingPlanningEligible(attempt,finding)||attempt.grading_contract?.explicitlyOutOfScopePartIds?.includes(finding.graded_part_id))continue;
      const part=parts.find(row=>row.id===finding.graded_part_id);if(!part)continue;
      const target=targets.attemptPart(attempt.id,part.id);
      const key=target?.identityKey||`attempt:${attempt.id}:${part.id}`,level=masteryLevelForPart(part);
      if(!finding.resolved&&finding.error_type!=="none"){
        unresolved.set(key,level);awaitingRetention.delete(key);retainedKeys.delete(key);
      }else if(finding.resolved&&finding.error_type==="none"){
        if(targetRetention&&target?.identityKey){retainedKeys.set(key,level);unresolved.delete(key);awaitingRetention.delete(key);}
        else if((independentReferenceFree(attempt)||gradedRepairEvidence(attempt))&&unresolved.has(key)){
          unresolved.delete(key);awaitingRetention.set(key,level);
        }
      }
    }
  }
  for(const level of retainedKeys.values())retained[level]++;
  // Review materialization is not itself evidence of success. Missing legacy
  // follow-up Reviews must not hide a failed sibling or a later retention failure.
  for(const [key,level]of unresolved)if(!activeKeys.has(key))repairing[level]++;
  for(const [key,level]of awaitingRetention)if(!activeKeys.has(key))waiting[level]++;
  const verified=new Set((args.transferEvidence||currentTransferEvidence(args.attempts.filter(attemptPlanningEligible)))
    .filter(e=>e.sourceProblemId===args.problemId).map(e=>e.successAttemptId));
  retained[3]=verified.size;
  const levels=[1,2,3].map(value=>{
    const level=value as 1|2|3;
    if(repairing[level])return state(level,"repairing",repairing[level],retained[level]);
    if(waiting[level])return state(level,level===1&&level1Collapse?"needs_recheck":"retention_pending",waiting[level],retained[level]);
    if(retained[level])return state(level,"retained",0,retained[level]);
    return state(level,"unconfirmed");
  }) as [MasteryLevelState,MasteryLevelState,MasteryLevelState];
  if(levels[0].status==="repairing"||levels[0].status==="needs_recheck"){
    if(levels[1].status!=="unconfirmed")levels[1]=state(2,"needs_recheck",repairing[2],retained[2]);
    if(levels[2].status!=="unconfirmed")levels[2]=state(3,"needs_recheck",repairing[3],retained[3]);
  }
  const activeLevel=levels.find(row=>row.status==="repairing"||row.status==="retention_pending"||row.status==="needs_recheck");
  const evidenced=levels.filter(row=>row.status!=="unconfirmed"&&row.status!=="needs_recheck");
  const currentLevel=(activeLevel?.level||evidenced.at(-1)?.level||1) as 1|2|3;
  return {problemId:args.problemId,currentLevel,currentTitle:LEVEL_TITLES[currentLevel],levels,
    activeTargetCount:repairing.slice(1).reduce((sum,count)=>sum+count,0)+waiting.slice(1).reduce((sum,count)=>sum+count,0),
    normalReviewComplete:current.length===0&&unresolved.size===0&&awaitingRetention.size===0};
}

export function deriveMasteryByProblem(args:{problemIds:string[];attempts:Attempt[];reviews:Review[]}){
  const transferEvidence=currentTransferEvidence(args.attempts.filter(attemptPlanningEligible));
  return Object.fromEntries(args.problemIds.map(problemId=>[problemId,deriveProblemMasteryState({problemId,attempts:args.attempts,reviews:args.reviews,transferEvidence})]));
}
