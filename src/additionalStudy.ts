import type { AdaptivePlannerShadow, AdditionalStudyCandidate, Task } from "./types.ts";

const purposePriority=(task:AdaptivePlannerShadow["plan14"]["plan"][number]["tasks"][number])=>{
  if(task.slot==="score_building"&&task.date)return task.kind==="whitebook"||task.kind==="full"?1:2;
  if(task.kind==="scan5"||task.kind==="past_exam"||task.kind==="timed")return 2;
  if(task.slot==="maintenance_selection")return 3;
  return 5;
};

function shadowTaskToTodayTask(item:AdaptivePlannerShadow["plan14"]["plan"][number]["tasks"][number]):Task|null{
  // Past-exam protection is enforced by the formal planner's final selector.
  // Rechecking it here would incorrectly keep protected material blocked after D60.
  if(!item.problemId||item.requiresUserSelection||item.kind==="exposure_confirmation"||item.kind==="review")return null;
  const mode=item.kind==="scan5"?"scan":item.kind==="timed"?"exam_90min":
    item.kind==="full"||item.kind==="past_exam"?"full":"skeleton";
  return {
    problem_id:item.problemId,title:item.label,kind:item.kind==="scan5"?"5問スキャン":
      item.kind==="timed"?"90分演習":item.kind==="past_exam"?"過去問":"追加学習",
    reason:item.reason,mode,minutes:item.minutes,load:0,triage:"if_time",
    plan_origin:"adaptive_additional",additional_candidate_key:item.taskKey,
    purpose_label:item.purposeLabel||(
      item.slot==="score_building"?"得点形成":item.slot==="maintenance_selection"?"重要概念の維持":"追加学習"
    )
  };
}

/**
 * TodayPlanSnapshot is not mutated here. These are opt-in suggestions that fit
 * into the unused daily capacity; persistence happens only after an explicit action.
 */
export function buildAdditionalStudyCandidates(args:{
  today:string;targetMinutes:number;completedMinutes:number;activeRemainingMinutes:number;
  currentTasks:Task[];shadow:AdaptivePlannerShadow;urgentReviewBlocked?:boolean;
}):{capacity:number;candidates:AdditionalStudyCandidate[]}{
  const capacity=Math.max(0,args.targetMinutes-args.completedMinutes-args.activeRemainingMinutes);
  if(!capacity||!args.shadow.available||args.urgentReviewBlocked)return {capacity,candidates:[]};
  const occupied=new Set(args.currentTasks.map(task=>task.problem_id));
  const sourceRows=args.shadow.plan14.plan.flatMap(day=>day.tasks)
    .filter(item=>item.date>=args.today)
    .sort((a,b)=>purposePriority(a)-purposePriority(b)||a.date.localeCompare(b.date)||a.taskKey.localeCompare(b.taskKey));
  const candidates:AdditionalStudyCandidate[]=[];
  let allocated=0;
  for(const item of sourceRows){
    const task=shadowTaskToTodayTask(item);
    if(!task||occupied.has(task.problem_id)||allocated+task.minutes>capacity)continue;
    const priority=purposePriority(item);
    candidates.push({candidateKey:item.taskKey,source:"adaptive",priority,
      purposeLabel:task.purpose_label||"追加学習",reason:item.reason,minutes:task.minutes,task});
    occupied.add(task.problem_id);allocated+=task.minutes;
    if(candidates.length>=3)break;
  }
  if(candidates.length<3){
    for(const task of args.currentTasks.filter(row=>row.triage==="tomorrow"&&!row.checked)){
      const key=task.additional_candidate_key||`postponed:${task.id||task.problem_id}:${task.kind}`;
      if(candidates.some(row=>row.task.problem_id===task.problem_id)||allocated+task.minutes>capacity)continue;
      const hydrated:Task={...task,triage:"if_time",plan_origin:"adaptive_additional",
        additional_candidate_key:key,purpose_label:task.purpose_label||"有効な復習・先送り候補"};
      candidates.push({candidateKey:key,source:task.review_type?"review":"postponed",priority:4,
        purposeLabel:hydrated.purpose_label||"追加学習",reason:task.reason,minutes:task.minutes,task:hydrated});
      allocated+=task.minutes;
      if(candidates.length>=3)break;
    }
  }
  return {capacity,candidates};
}
