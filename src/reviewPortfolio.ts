import type { Attempt, ProblemAlias, Review, ReviewPortfolioSummary } from "./types.ts";
import { logicalReviewKey, reviewExecutionState } from "./integrityEngine.ts";
import { addCalendarDays } from "./reviewSchedulePolicy.ts";

function tokyoDate(value?:string){
  if(!value)return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const parsed=new Date(value);
  if(Number.isNaN(parsed.getTime()))return "";
  return new Intl.DateTimeFormat("sv-SE",{
    timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(parsed);
}

export function summarizeReviewPortfolio(args:{
  reviews:Review[];attempts:Attempt[];aliases?:ProblemAlias[];today:string;
}):ReviewPortfolioSummary{
  const aliases=args.aliases||[],attemptById=new Map(args.attempts.map(row=>[row.id,row]));
  const actionable=args.reviews.filter(review=>reviewExecutionState(review,args.today)==="actionable");
  const next7End=addCalendarDays(args.today,7),recentStart=addCalendarDays(args.today,-6);
  const completed=args.reviews.filter(review=>{
    const date=tokyoDate(review.completed_at);
    return reviewExecutionState(review,args.today)==="completed"&&date>=recentStart&&date<=args.today;
  });
  const generated=args.reviews.filter(review=>{
    const date=tokyoDate(review.generated_at);
    return date>=recentStart&&date<=args.today;
  });
  const attemptsFromCompleted=new Set(args.attempts
    .filter(attempt=>completed.some(review=>review.id===attempt.generated_from_review_id))
    .map(attempt=>attempt.id));
  const completedWithSuccessor=new Set(args.reviews
    .filter(review=>attemptsFromCompleted.has(review.generated_from_attempt_id))
    .map(review=>review.generated_from_attempt_id)).size;
  const logicalCounts=new Map<string,number>();
  for(const review of actionable){
    const key=logicalReviewKey({review,aliases,sourceAttempt:attemptById.get(review.source_attempt_id||review.generated_from_attempt_id)});
    logicalCounts.set(key,(logicalCounts.get(key)||0)+1);
  }
  return {
    actionable:actionable.length,
    overdue:actionable.filter(review=>review.due_date<args.today).length,
    dueToday:actionable.filter(review=>review.due_date===args.today).length,
    next7Days:actionable.filter(review=>review.due_date>args.today&&review.due_date<=next7End).length,
    later:actionable.filter(review=>review.due_date>next7End).length,
    inactivePending:args.reviews.filter(review=>
      ["pending","overdue","review_needed","id_review_needed"].includes(review.status)&&
      reviewExecutionState(review,args.today)!=="actionable").length,
    completedLast7Days:completed.length,
    generatedLast7Days:generated.length,
    completedWithSuccessorLast7Days:completedWithSuccessor,
    netChangeLast7Days:generated.length-completed.length,
    activeDuplicateLogicalKeys:[...logicalCounts.values()].filter(count=>count>1).length
  };
}
