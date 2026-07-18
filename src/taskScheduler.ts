import type { AssessmentTiming, LearningPurpose, Review, Task } from "./types.ts";
import type { LearningPrescription } from "./learningPolicyResolver.ts";

export type ScheduleWindow={earliestDate:string;preferredDate:string;latestDate:string};

export function addCalendarDays(date:string,days:number){
  const parsed=new Date(`${date}T12:00:00Z`);parsed.setUTCDate(parsed.getUTCDate()+days);
  return parsed.toISOString().slice(0,10);
}

const intervals:Record<string,{preferred:number;early:number;late:number}>={
  K:{preferred:1,early:1,late:2},N:{preferred:2,early:1,late:3},W:{preferred:3,early:2,late:5},C:{preferred:7,early:5,late:10},none:{preferred:14,early:10,late:21},
};

export function scheduleWindow(args:{sourceDate:string;errors:string[];assessmentTiming:AssessmentTiming;purpose:LearningPurpose}):ScheduleWindow{
  if(args.assessmentTiming==="same_session_correction")return {earliestDate:args.sourceDate,preferredDate:args.sourceDate,latestDate:args.sourceDate};
  const key=args.errors.includes("K")?"K":args.errors.includes("N")?"N":args.errors.includes("W")?"W":args.errors.includes("C")?"C":"none";
  const rule=args.purpose==="integration_check"?{preferred:10,early:7,late:14}:intervals[key];
  return {earliestDate:addCalendarDays(args.sourceDate,rule.early),preferredDate:addCalendarDays(args.sourceDate,rule.preferred),latestDate:addCalendarDays(args.sourceDate,rule.late)};
}

export function chooseDateWithinWindow(args:{window:ScheduleWindow;minutes:number;dailyCapacity:number;scheduledMinutes:Record<string,number>}){
  const dates:string[]=[];for(let date=args.window.earliestDate;date<=args.window.latestDate;date=addCalendarDays(date,1))dates.push(date);
  const ranked=dates.sort((a,b)=>Math.abs(Date.parse(a)-Date.parse(args.window.preferredDate))-Math.abs(Date.parse(b)-Date.parse(args.window.preferredDate))||a.localeCompare(b));
  return ranked.find(date=>Number(args.scheduledMinutes[date]||0)+args.minutes<=args.dailyCapacity)||args.window.latestDate;
}

export function taskDeduplicationKey(args:{problemId:string;learningPurpose:LearningPurpose;sourceAttemptId:number;policyVersion:string;assessmentTiming:AssessmentTiming}){
  return [args.problemId,args.learningPurpose,args.assessmentTiming,args.sourceAttemptId,args.policyVersion].join("|");
}

export function pendingDuplicate<T extends Partial<Review&Task>>(tasks:T[],key:string){
  return tasks.find(task=>task.deduplication_key===key&&!['done','completed','cancelled'].includes(String(task.status||'')));
}

export function taskDraftFromPrescription(args:{prescription:LearningPrescription;sourceAttemptId:number;sourceDate:string;errors:string[];scheduledMinutes?:Record<string,number>;dailyCapacity?:number}){
  const {prescription}=args;
  const window=scheduleWindow({sourceDate:args.sourceDate,errors:args.errors,assessmentTiming:prescription.assessmentTiming,purpose:prescription.learningPurpose});
  const preferred=chooseDateWithinWindow({window,minutes:prescription.estimatedMinutes,dailyCapacity:args.dailyCapacity||150,scheduledMinutes:args.scheduledMinutes||{}});
  const deduplicationKey=taskDeduplicationKey({problemId:prescription.problemId,learningPurpose:prescription.learningPurpose,
    sourceAttemptId:args.sourceAttemptId,policyVersion:prescription.policyVersion,assessmentTiming:prescription.assessmentTiming});
  return {window,dueDate:preferred,deduplicationKey};
}

export type WeeklyQuotaStatus={fullSkeleton:number;timedFull:number;scan5:number;deficits:{fullSkeleton:boolean;timedFull:boolean;scan5:boolean}};
export function weeklySoftQuota(args:{attempts:Array<Record<string,unknown>>;pastSessions:Array<Record<string,unknown>>;weekStart:string}):WeeklyQuotaStatus{
  const inWeek=(date:unknown)=>String(date||"")>=args.weekStart;
  const fullSkeleton=args.attempts.filter(row=>inWeek(row.date)&&row.review_scope==="full_skeleton").length;
  const timedAttempt=args.attempts.filter(row=>inWeek(row.date)&&row.exam_score_eligible===true).length;
  let timedFull=timedAttempt,scan5=0;
  for(const session of args.pastSessions.filter(row=>inWeek(row.date))){
    if(["timed_single","past_exam","exam_90min"].includes(String(session.session_type)))timedFull++;
    if(["scan5","scan_5_questions"].includes(String(session.session_type))||
      (String(session.session_type)==="past_exam"&&!!(session.initialSelectedProblemIds||session.selected_questions)))scan5++;
  }
  return {fullSkeleton,timedFull,scan5,deficits:{fullSkeleton:fullSkeleton<1,timedFull:timedFull<1,scan5:scan5<1}};
}

export function quotaCandidatesWithinCapacity(args:{status:WeeklyQuotaStatus;remainingMinutes:number}){
  const candidates:Array<{kind:"full_skeleton"|"timed_full"|"scan5";minutes:number}>=[];
  const add=(kind:"full_skeleton"|"timed_full"|"scan5",minutes:number)=>{if(candidates.reduce((sum,row)=>sum+row.minutes,0)+minutes<=args.remainingMinutes)candidates.push({kind,minutes})};
  if(args.status.deficits.timedFull)add("timed_full",35);
  if(args.status.deficits.fullSkeleton)add("full_skeleton",15);
  if(args.status.deficits.scan5)add("scan5",10);
  return candidates;
}
