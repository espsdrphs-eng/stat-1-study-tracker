import type {Attempt,GradedPartContract,MasteryLevelState,ProblemMasteryState,Review} from "./types.ts";
import {resolvePersistedAttemptLifecycle} from "./reviewTransition.ts";

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
  return {level,title:LEVEL_TITLES[level],status,label:STATUS_LABELS[status],activeTargetCount,retainedTargetCount};
}

export function deriveProblemMasteryState(args:{problemId:string;attempts:Attempt[];reviews:Review[]}):ProblemMasteryState{
  const attempts=args.attempts.filter(row=>row.problem_id===args.problemId&&!row.exclude_from_planning&&!row.duplicate_of_attempt_id);
  const transferAttempts=args.attempts.filter(row=>row.source_problem_id===args.problemId&&row.transfer_evidence&&
    !row.exclude_from_planning&&!row.duplicate_of_attempt_id);
  const reviews=args.reviews.filter(row=>row.problem_id===args.problemId);
  const current=reviews.filter(active).filter(row=>["error_repair","retrieval_check"].includes(String(row.grading_contract?.learningPurpose||row.learning_purpose||"")));
  const repairing=[0,0,0,0],waiting=[0,0,0,0],retained=[0,0,0,0];
  for(const review of current){
    const purpose=review.grading_contract?.learningPurpose||review.learning_purpose;
    for(const part of review.grading_contract?.gradedParts||[]){
      const level=masteryLevelForPart(part,review);
      (purpose==="retrieval_check"?waiting:repairing)[level]++;
    }
  }
  for(const attempt of attempts){
    if(attempt.mode==="scan5"||attempt.exam_score_eligible===false&&attempt.mode==="scan5")continue;
    const lifecycle=resolvePersistedAttemptLifecycle(attempt);
    const targetRetention=lifecycle.graduated||(attempt.learning_purpose==="retrieval_check"&&attempt.assessment_timing==="delayed_retrieval"&&
      Number(attempt.actual_reference_level||0)===0&&!attempt.hint_used);
    if(targetRetention){
      const parts=attempt.grading_contract?.gradedParts||[];
      for(const finding of attempt.graded_findings||[]){
        if(!finding.resolved||finding.error_type!=="none")continue;
        const part=parts.find(row=>row.id===finding.graded_part_id);
        if(part)retained[masteryLevelForPart(part)]++;
      }
    }
  }
  for(const attempt of transferAttempts)if(resolvePersistedAttemptLifecycle(attempt).reviewOutcome==="success")retained[3]++;
  const levels=[1,2,3].map(value=>{
    const level=value as 1|2|3;
    if(repairing[level])return state(level,"repairing",repairing[level],retained[level]);
    if(waiting[level])return state(level,"retention_pending",waiting[level],retained[level]);
    if(retained[level])return state(level,"retained",0,retained[level]);
    return state(level,"unconfirmed");
  }) as [MasteryLevelState,MasteryLevelState,MasteryLevelState];
  if(levels[0].status==="repairing"){
    if(levels[1].status!=="unconfirmed")levels[1]=state(2,"needs_recheck",repairing[2],retained[2]);
    if(levels[2].status!=="unconfirmed")levels[2]=state(3,"needs_recheck",repairing[3],retained[3]);
  }
  const activeLevel=levels.find(row=>row.status==="repairing"||row.status==="retention_pending");
  const evidenced=levels.filter(row=>row.status!=="unconfirmed"&&row.status!=="needs_recheck");
  const currentLevel=(activeLevel?.level||evidenced.at(-1)?.level||1) as 1|2|3;
  return {problemId:args.problemId,currentLevel,currentTitle:LEVEL_TITLES[currentLevel],levels,
    activeTargetCount:current.reduce((sum,row)=>sum+(row.grading_contract?.gradedParts.length||0),0),
    normalReviewComplete:current.length===0};
}

export function deriveMasteryByProblem(args:{problemIds:string[];attempts:Attempt[];reviews:Review[]}){
  return Object.fromEntries(args.problemIds.map(problemId=>[problemId,deriveProblemMasteryState({problemId,attempts:args.attempts,reviews:args.reviews})]));
}
