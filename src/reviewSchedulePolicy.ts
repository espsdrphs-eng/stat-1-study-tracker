import type { Attempt, ProblemAlias, Review } from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";

export type ScheduleOrigin="policy"|"manual"|"legacy_unknown";

const DATE_PATTERN=/^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year:number){
  return year%4===0&&(year%100!==0||year%400===0);
}

function daysInMonth(year:number,month:number){
  return [31,isLeapYear(year)?29:28,31,30,31,30,31,31,30,31,30,31][month-1]||0;
}

function parseCalendarDate(value:string){
  const match=String(value||"").match(DATE_PATTERN);
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(month<1||month>12||day<1||day>daysInMonth(year,month))return null;
  return {year,month,day};
}

function formatCalendarDate(parts:{year:number;month:number;day:number}){
  return `${String(parts.year).padStart(4,"0")}-${String(parts.month).padStart(2,"0")}-${String(parts.day).padStart(2,"0")}`;
}

/**
 * Adds calendar days without creating Date objects. This intentionally avoids
 * UTC/local-time conversion because review dates are local YYYY-MM-DD values.
 */
export function addCalendarDays(value:string,amount:number){
  const parsed=parseCalendarDate(value);
  if(!parsed||!Number.isInteger(amount))return "";
  let {year,month,day}=parsed;
  const direction=amount<0?-1:1;
  let remaining=Math.abs(amount);
  while(remaining>0){
    day+=direction;
    if(direction>0&&day>daysInMonth(year,month)){
      day=1;month++;
      if(month>12){month=1;year++;}
    }else if(direction<0&&day<1){
      month--;
      if(month<1){month=12;year--;}
      day=daysInMonth(year,month);
    }
    remaining--;
  }
  return formatCalendarDate({year,month,day});
}

function calendarOrdinal(value:string){
  const parsed=parseCalendarDate(value);
  if(!parsed)return null;
  let days=0;
  for(let year=1;year<parsed.year;year++)days+=isLeapYear(year)?366:365;
  for(let month=1;month<parsed.month;month++)days+=daysInMonth(parsed.year,month);
  return days+parsed.day;
}

export function differenceInCalendarDays(later:string,earlier:string){
  const a=calendarOrdinal(later),b=calendarOrdinal(earlier);
  return a==null||b==null?null:a-b;
}

export function scheduleOriginFor(review:Partial<Review>):ScheduleOrigin{
  if(review.schedule_origin==="manual"||review.schedule_origin==="policy"||review.schedule_origin==="legacy_unknown")
    return review.schedule_origin;
  if(review.postponed_at||review.postponed_to||review.last_postponed_at||
    Number(review.postpone_count||review.postponed_count||0)>0)return "manual";
  if(review.policy_version||review.contract_version||review.grading_contract?.contractVersion||
    (Number(review.source_attempt_id||review.generated_from_attempt_id||0)>0&&
      Number.isFinite(Number(review.review_after_days??review.interval_days))))return "policy";
  return "legacy_unknown";
}

export type ResolvedReviewSchedule={
  reviewId:number;
  sourceDate:string;
  reviewAfterDays:number|null;
  storedReviewDate:string;
  expectedReviewDate:string;
  scheduleOrigin:ScheduleOrigin;
  mismatch:boolean;
  manualDatePreserved:boolean;
  needsReview:boolean;
};

export function resolveReviewSchedule(review:Partial<Review>,sourceAttempt?:Attempt):ResolvedReviewSchedule{
  const sourceDate=String(review.source_date||sourceAttempt?.date||"");
  const rawDays=review.review_after_days??review.interval_days;
  const reviewAfterDays=Number.isFinite(Number(rawDays))?Number(rawDays):null;
  const storedReviewDate=String(review.due_date||"");
  const scheduleOrigin=scheduleOriginFor(review);
  const expectedReviewDate=sourceDate&&reviewAfterDays!=null?addCalendarDays(sourceDate,reviewAfterDays):"";
  const comparable=!!expectedReviewDate&&!!storedReviewDate;
  return {
    reviewId:Number(review.id||0),sourceDate,reviewAfterDays,storedReviewDate,expectedReviewDate,scheduleOrigin,
    mismatch:scheduleOrigin==="policy"&&comparable&&expectedReviewDate!==storedReviewDate,
    manualDatePreserved:scheduleOrigin==="manual"&&comparable&&expectedReviewDate!==storedReviewDate,
    needsReview:!sourceDate||reviewAfterDays==null||!storedReviewDate||!expectedReviewDate,
  };
}

const activeStatuses=new Set(["pending","overdue"]);
const completedStatuses=new Set(["done","completed"]);

function sourceAttemptFor(review:Review,attempts:Attempt[]){
  const id=Number(review.source_attempt_id||review.generated_from_attempt_id||0);
  return id?attempts.find(attempt=>attempt.id===id):undefined;
}

function contractPartIds(review:Review){
  const values=review.grading_contract?.gradedParts?.map(part=>part.id)||
    review.graded_part_ids||review.graded_parts||[];
  return [...new Set(values.map(String).filter(Boolean))].sort();
}

export function pendingReviewIdentityKey(review:Review,aliases:ProblemAlias[]){
  const canonicalProblemId=resolveCanonicalProblemId(review.problem_id,aliases);
  const purpose=String(review.grading_contract?.learningPurpose||review.learning_purpose||"");
  const mode=String(review.grading_contract?.mode||review.effective_mode||review.inferred_mode||"");
  const scope=String(review.grading_contract?.reviewScope||review.effective_review_scope||review.review_scope||"");
  const partIds=contractPartIds(review);
  if(!canonicalProblemId||!purpose||!mode||!scope||partIds.length===0)return "";
  return [canonicalProblemId,purpose,mode,scope,partIds.join(",")].join("|");
}

export type DuplicateReviewGroup={
  identityKey:string;
  keepReviewId:number;
  supersedeReviewIds:number[];
};

export type ReviewScheduleAudit={
  rows:ResolvedReviewSchedule[];
  duplicateGroups:DuplicateReviewGroup[];
  policyDateCorrections:number;
  manualDatePreserved:number;
  legacyUnknown:number;
  pastDueCorrections:number;
  duplicatesToSupersede:number;
  needsReview:number;
  completedUnchanged:number;
};

export function auditReviewSchedules(args:{
  reviews:Review[];
  attempts:Attempt[];
  aliases:ProblemAlias[];
  today?:string;
}):ReviewScheduleAudit{
  const rows:ResolvedReviewSchedule[]=[];
  let completedUnchanged=0;
  for(const review of args.reviews){
    if(completedStatuses.has(review.status)){completedUnchanged++;continue;}
    if(!activeStatuses.has(review.status))continue;
    rows.push(resolveReviewSchedule(review,sourceAttemptFor(review,args.attempts)));
  }

  const groups=new Map<string,Review[]>();
  for(const review of args.reviews.filter(row=>activeStatuses.has(row.status))){
    const key=pendingReviewIdentityKey(review,args.aliases);
    if(!key)continue;
    groups.set(key,[...(groups.get(key)||[]),review]);
  }
  const duplicateGroups:DuplicateReviewGroup[]=[];
  for(const [identityKey,reviews] of groups){
    if(reviews.length<2)continue;
    const ranked=[...reviews].sort((a,b)=>{
      const attemptA=sourceAttemptFor(a,args.attempts),attemptB=sourceAttemptFor(b,args.attempts);
      const targetA=resolveCanonicalProblemId(a.problem_id,args.aliases);
      const targetB=resolveCanonicalProblemId(b.problem_id,args.aliases);
      const validA=attemptA&&resolveCanonicalProblemId(attemptA.problem_id,args.aliases)===targetA?1:0;
      const validB=attemptB&&resolveCanonicalProblemId(attemptB.problem_id,args.aliases)===targetB?1:0;
      return validB-validA||
        String(attemptB?.date||"").localeCompare(String(attemptA?.date||""))||
        Number(attemptB?.id||0)-Number(attemptA?.id||0)||
        b.id-a.id;
    });
    duplicateGroups.push({
      identityKey,keepReviewId:ranked[0].id,supersedeReviewIds:ranked.slice(1).map(row=>row.id)
    });
  }
  const today=String(args.today||"");
  return {
    rows,duplicateGroups,
    policyDateCorrections:rows.filter(row=>row.mismatch).length,
    manualDatePreserved:rows.filter(row=>row.manualDatePreserved).length,
    legacyUnknown:rows.filter(row=>row.scheduleOrigin==="legacy_unknown").length,
    pastDueCorrections:rows.filter(row=>row.mismatch&&!!today&&row.expectedReviewDate<today).length,
    duplicatesToSupersede:duplicateGroups.reduce((sum,row)=>sum+row.supersedeReviewIds.length,0),
    needsReview:rows.filter(row=>row.needsReview).length,
    completedUnchanged,
  };
}
