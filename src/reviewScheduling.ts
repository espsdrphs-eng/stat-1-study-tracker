import type { AdaptiveReviewScheduleConflict, Review } from "./types.ts";
import { addCalendarDays } from "./reviewSchedulePolicy.ts";

export function postponedDueDate(today:string,input:{due_date?:unknown;days?:unknown}){
  const requested=String(input.due_date||"");
  if(/^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested<today?today:requested;
  const days=Math.min(30,Math.max(0,Number(input.days||0)));
  const date=new Date(`${today}T12:00:00`);
  date.setDate(date.getDate()+days);
  return new Intl.DateTimeFormat("sv-SE").format(date);
}

export type ScheduledReviewPlacement={
  review:Review;date:string;minutes:number;earliestDate:string;preferredDate:string;latestDate:string;
  status:"within_window"|"overdue_recovery";
};

const reviewMinutes=(review:Review)=>Math.max(1,Number(review.grading_contract?.estimatedMinutes||review.estimated_minutes||5));
const reviewWindow=(review:Review)=>({
  earliestDate:String(review.earliest_date||review.preferred_date||review.due_date),
  preferredDate:String(review.preferred_date||review.due_date),
  latestDate:String(review.latest_date||review.preferred_date||review.due_date),
});

/**
 * Assigns active Reviews by explicit calendar windows. Review count is never the
 * capacity unit: minutes are. Existing overdue rows are recovered from `startDate`
 * and are labelled as such instead of silently pretending they met `latestDate`.
 */
export function scheduleActiveReviews(args:{
  reviews:Review[];startDate:string;days:number;dailyCapacity:number;repairBudgetMinutes?:number;
}){
  const horizonEnd=addCalendarDays(args.startDate,Math.max(0,args.days-1));
  const repairBudgetMinutes=Math.min(args.dailyCapacity,Math.max(15,args.repairBudgetMinutes??Math.round(args.dailyCapacity*.3)));
  const scheduledMinutes:Record<string,number>={};
  const placements:ScheduledReviewPlacement[]=[];
  const capacityConflicts:AdaptiveReviewScheduleConflict[]=[];
  const ordered=[...args.reviews].sort((left,right)=>{
    const l=reviewWindow(left),r=reviewWindow(right);
    const overdueL=Number(l.latestDate<args.startDate),overdueR=Number(r.latestDate<args.startDate);
    return overdueR-overdueL||l.latestDate.localeCompare(r.latestDate)||l.preferredDate.localeCompare(r.preferredDate)||left.id-right.id;
  });
  for(const review of ordered){
    const window=reviewWindow(review),minutes=reviewMinutes(review);
    const overdue=window.latestDate<args.startDate;
    const first=overdue?args.startDate:(window.earliestDate<args.startDate?args.startDate:window.earliestDate);
    const last=overdue?horizonEnd:(window.latestDate>horizonEnd?horizonEnd:window.latestDate);
    if(first>last){
      if(window.latestDate<=horizonEnd)capacityConflicts.push({reviewId:review.id,problemId:review.problem_id,...window,minutes,reason:"outside_horizon"});
      continue;
    }
    const dates:string[]=[];
    for(let date=first;date<=last;date=addCalendarDays(date,1))dates.push(date);
    const ranked=overdue?dates:dates.sort((left,right)=>
      Math.abs(Date.parse(left)-Date.parse(window.preferredDate))-Math.abs(Date.parse(right)-Date.parse(window.preferredDate))||left.localeCompare(right));
    const date=ranked.find(candidate=>Number(scheduledMinutes[candidate]||0)+minutes<=repairBudgetMinutes);
    if(!date){
      if(overdue||window.latestDate<=horizonEnd)capacityConflicts.push({reviewId:review.id,problemId:review.problem_id,...window,minutes,reason:"capacity"});
      continue;
    }
    scheduledMinutes[date]=Number(scheduledMinutes[date]||0)+minutes;
    placements.push({review,date,minutes,...window,status:overdue?"overdue_recovery":"within_window"});
  }
  return {repairBudgetMinutes,placements,capacityConflicts,scheduledMinutes};
}
