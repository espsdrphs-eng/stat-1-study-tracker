import type {
  AdaptivePlanDay, AdaptivePlanSummary, AdaptivePlannerShadow, Attempt, ConceptWeaknessInsight,
  ExamReferenceCatalogItem, PastExamRepairCandidate, PastSession, Problem, Review, Task
} from "./types.ts";
import type { StoredExamReferencePack } from "./examReferencePack.ts";
import { canonicalPastExamProblemId } from "./examReferencePack.ts";
import { addCalendarDays,differenceInCalendarDays } from "./reviewSchedulePolicy.ts";
import { daysUntilExam } from "./studyProgress.ts";
import { reviewExecutionState } from "./integrityEngine.ts";
import { simulateThirtyDays } from "./learningSimulation.ts";
import { resolvePersistedAttemptLifecycle } from "./reviewTransition.ts";
import { scheduleActiveReviews, type ScheduledReviewPlacement } from "./reviewScheduling.ts";
import {deriveLearningPolicy,examHorizonPolicy,pastExamYearRole} from "./examOptimizationPolicy.ts";
import {buildPastExamYearCandidates,canonicalizePastExamSessions,derivePastExamSessionState,pastExamSessionKey,
  pastExamSessionPurpose,pastExamTaskTypeFor,selectPastExamYear,explainPastExamYearSelection,pastExamMeasurementPurpose,stablePastExamSessionKey,
  validatePastExamSessionIdentity,validatePastExamTaskIdentity,reconcilePastExamSessionEvidence,
  derivePastExamSessionAdmission,derivePastExamShortCorrection,projectPastExamSessionAdmissions,preferredPastExamMeasurementYear} from "./pastExamPlanning.ts";
import {reviewPlanningDecision} from "./todayLearningPolicy.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";

type SlotTask=AdaptivePlanDay["tasks"][number];
export const GRADUATED_SAME_PROBLEM_COOLDOWN_DAYS=45;
const unique=<T,>(values:T[])=>[...new Set(values)];
const attemptedDateMap=(attempts:Attempt[])=>{
  const map=new Map<string,string>();
  for(const attempt of attempts)if(!map.get(attempt.problem_id)||map.get(attempt.problem_id)!<attempt.date)map.set(attempt.problem_id,attempt.date);
  return map;
};
const isNewWhitebook=(problem:Problem,attempted:Map<string,string>)=>!attempted.has(problem.problem_id);
const modeMinutes=(mode:string)=>mode==="full"?35:mode==="main_calc"?20:mode==="skeleton"?25:5;

function phaseName(daysRemaining:number){return examHorizonPolicy(daysRemaining).phase;}

export function rollingPastExamShare(days:AdaptivePlanDay[]){
  const tasks=days.flatMap(day=>day.tasks).filter(row=>!row.requiresUserSelection),total=tasks.reduce((sum,row)=>sum+row.minutes,0);
  const past=tasks.filter(row=>["past_exam","scan5","timed"].includes(row.kind)&&!!row.referenceProblemId)
    .reduce((sum,row)=>sum+row.minutes,0);
  return total?past/total:0;
}

function chooseWhitebook(args:{
  problems:Problem[];attempts:Attempt[];chapters:number[];used:Map<string,string>;date:string;
  allowNew:boolean;mode:"skeleton"|"full";weaknesses:ConceptWeaknessInsight[];avoidProblemIds?:Set<string>;
  repairOnly?:boolean;
}){
  const attempted=attemptedDateMap(args.attempts);
  const weaknessMap=new Map(args.weaknesses.map(row=>[row.conceptId,row]));
  const evidencePriority=(problem:Problem)=>{
    const rows=(problem.fine_concept_ids||[]).map(id=>weaknessMap.get(id)).filter(Boolean) as ConceptWeaknessInsight[];
    if(!rows.length)return 0;
    return Math.max(...rows.map(row=>{
      const stateWeight=["confirmed","repairing","relapsed"].includes(row.state)?3:
        row.state==="suspected"?2:row.state==="transfer_pending"?1:0;
      return stateWeight*1000+row.priorityScore;
    }));
  };
  const rows=args.problems.filter(problem=>problem.category==="A"&&args.chapters.includes(Number(problem.chapter))&&
    !["review_needed","metadata_review_needed"].includes(String(problem.metadata_status||""))&&
    (args.allowNew||!isNewWhitebook(problem,attempted))&&(!args.repairOnly||evidencePriority(problem)>0))
    .sort((a,b)=>{
      const rank=(value?:string)=>value==="A+"?0:value==="A"?1:2;
      const recentlyA=args.used.get(a.problem_id),recentlyB=args.used.get(b.problem_id);
      const blockedA=recentlyA&&recentlyA>addCalendarDays(args.date,-7)?1:0;
      const blockedB=recentlyB&&recentlyB>addCalendarDays(args.date,-7)?1:0;
      return blockedA-blockedB||evidencePriority(b)-evidencePriority(a)||rank(a.strategy_rank)-rank(b.strategy_rank)||
        String(attempted.get(a.problem_id)||"").localeCompare(String(attempted.get(b.problem_id)||""))||
        a.problem_id.localeCompare(b.problem_id);
    });
  const pool=rows.filter(problem=>!args.avoidProblemIds?.has(problem.problem_id));
  const selected=pool.find(problem=>!args.used.get(problem.problem_id)||args.used.get(problem.problem_id)!<=addCalendarDays(args.date,-7));
  if(selected)args.used.set(selected.problem_id,args.date);
  return selected;
}

function pastRank(exposure:string){
  return exposure==="unseen"?0:exposure==="unknown"?1:exposure==="prompt_scanned"?2:
    exposure==="partially_attempted"?3:exposure==="fully_attempted"?4:exposure==="answer_exposed"?5:6;
}

const stableTie=(value:string)=>[...value].reduce((hash,char)=>Math.imul(hash^char.charCodeAt(0),16777619)>>>0,2166136261);

function choosePastExam(args:{
  catalog:ExamReferenceCatalogItem[];daysRemaining:number;used:Map<string,string>;date:string;attempts:Attempt[];
  weaknesses:ConceptWeaknessInsight[];avoidProblemIds?:Set<string>;pastSessions:PastSession[];
  kind:"past_exam"|"scan5"|"timed";usedSessionYears:Set<number>;
}){
  const recentCutoff=addCalendarDays(args.date,-14),attempted=new Map<string,Attempt>();
  for(const attempt of args.attempts){
    const id=canonicalPastExamProblemId(attempt.problem_id),current=attempted.get(id);
    if(!current||attempt.date>current.date||attempt.date===current.date&&attempt.id>current.id)attempted.set(id,attempt);
  }
  const candidates=buildPastExamYearCandidates({catalog:args.catalog,attempts:args.attempts,pastSessions:args.pastSessions,
    weaknesses:args.weaknesses,today:args.date,daysRemaining:args.daysRemaining});
  const provisionalType=args.kind==="timed"?"timed_three_question_session":args.kind==="scan5"?"clean_scan5":"individual_full";
  const candidatesWithUnusedRows=candidates.filter(candidate=>candidate.eligibleRows.some(row=>
    !args.used.has(row.referenceProblemId)&&!args.avoidProblemIds?.has(row.canonicalProblemId)));
  const year=selectPastExamYear({candidates:candidatesWithUnusedRows,taskType:provisionalType,
    excludedYears:args.kind==="past_exam"?undefined:args.usedSessionYears});
  if(!year)return undefined;
  const rows=year.eligibleRows.filter(row=>!args.avoidProblemIds?.has(row.canonicalProblemId))
    .sort((a,b)=>{
      const attemptA=attempted.get(a.canonicalProblemId),attemptB=attempted.get(b.canonicalProblemId);
      const doneA=attemptA?1:0,doneB=attemptB?1:0;
      const recentA=attemptA&&attemptA.date>=recentCutoff?1:0,recentB=attemptB&&attemptB.date>=recentCutoff?1:0;
      return doneA-doneB||recentA-recentB||pastRank(a.exposure)-pastRank(b.exposure)||
        stableTie(`${args.date}|${a.canonicalProblemId}`)-stableTie(`${args.date}|${b.canonicalProblemId}`);
    });
  // A simulation must not invent a second purpose after merely placing the
  // first task. Reuse requires a persisted Attempt/exposure event in a later run.
  const selected=rows.find(row=>!args.used.has(row.referenceProblemId));
  if(!selected)return undefined;
  args.used.set(selected.referenceProblemId,args.date);
  const planningTaskType=pastExamTaskTypeFor({kind:args.kind,year,daysRemaining:args.daysRemaining});
  if(args.kind!=="past_exam")args.usedSessionYears.add(year.year);
  const prior=candidates.filter(row=>row.year<year.year&&row.exposedCount>0).sort((a,b)=>b.year-a.year)[0];
  const selectedYearReason=explainPastExamYearSelection(year,prior);
  const unseenIndividualProblemIds=candidates.filter(row=>row.year<year.year).flatMap(row=>row.eligibleRows
    .filter(item=>["unseen","unknown"].includes(item.exposure)).map(item=>item.canonicalProblemId));
  return {...selected,yearRole:year.yearRole,planningTaskType,sessionProblemIds:year.eligibleRows.sort((a,b)=>a.questionNumber-b.questionNumber)
    .map(row=>row.canonicalProblemId),cleanSelectionEvidence:year.cleanScanEligible,selectedYearReason,unseenIndividualProblemIds};
}

function task(args:Omit<SlotTask,"taskKey">):SlotTask{
  return {...args,taskKey:args.stableSessionKey||[args.date,args.slot,args.kind,args.problemId||args.referenceProblemId||args.conceptId||args.label].join("|")};
}

function planSummary(days:AdaptivePlanDay[],reviewSchedule?:ReturnType<typeof scheduleActiveReviews>,
  sessionDecisions:AdaptivePlanSummary["sessionDecisions"]=[]):AdaptivePlanSummary{
  const tasks=days.flatMap(day=>day.tasks),counts={scoreBuilding:0,repair:0,maintenance:0,scan5:0,full:0,timed:0,pastExam:0,chapter5:0,chapter7:0,chapter8:0};
  for(const row of tasks){
    if(row.slot==="score_building")counts.scoreBuilding++;
    if(row.slot==="repair")counts.repair++;
    if(row.slot==="maintenance_selection")counts.maintenance++;
    if(row.kind==="scan5")counts.scan5++;
    if(row.kind==="full")counts.full++;
    if(row.kind==="timed")counts.timed++;
    if(["past_exam","scan5","timed"].includes(row.kind)&&!!row.referenceProblemId)counts.pastExam++;
    if(row.reason.includes("第5章"))counts.chapter5++;
    if(row.reason.includes("第7章"))counts.chapter7++;
    if(row.reason.includes("第8章"))counts.chapter8++;
  }
  return {days:days.length,plan:days,totalMinutes:days.reduce((sum,day)=>sum+day.totalMinutes,0),counts,sessionDecisions,
    weeklyMinimumViolations:[],dailyCapacityViolations:0,
    reviewSchedule:{repairBudgetMinutes:reviewSchedule?.repairBudgetMinutes||0,
      placements:(reviewSchedule?.placements||[]).map(row=>({reviewId:row.review.id,problemId:row.review.problem_id,
        date:row.date,latestDate:row.latestDate,status:row.status})),
      capacityConflicts:reviewSchedule?.capacityConflicts||[],decisions:reviewSchedule&&"decisions" in reviewSchedule?
        reviewSchedule.decisions as AdaptivePlanSummary["reviewSchedule"]["decisions"]:[]}};
}

function validateMinimums(summary:AdaptivePlanSummary,daysRemaining:number,targetMinutes:number){
  const violations:string[]=[];
  for(let start=0;start<summary.plan.length;start+=7){
    const weekRows=summary.plan.slice(start,Math.min(start+7,summary.plan.length));
    if(weekRows.length<7)continue;
    const week=planSummary(weekRows),weekDaysRemaining=Math.max(0,daysRemaining-start);
    const horizon=deriveLearningPolicy(weekDaysRemaining),share=rollingPastExamShare(weekRows);
    if(weekDaysRemaining>=91){
      if(!week.counts.chapter5)violations.push(`${start/7+1}週目: 第5章なし`);
      if(!week.counts.chapter7)violations.push(`${start/7+1}週目: 第7章なし`);
      if(!week.counts.scan5)violations.push(`${start/7+1}週目: scan5なし`);
      if(!week.counts.full&&!week.counts.timed)violations.push(`${start/7+1}週目: full/timedなし`);
    }else if(weekDaysRemaining>=81){
      if(!week.counts.scan5)violations.push(`${start/7+1}週目: scan5なし`);
      if(!week.counts.pastExam)violations.push(`${start/7+1}週目: 過去問なし`);
      if(share<horizon.pastExamShareMin)
        violations.push(`${start/7+1}週目: 過去問比率${Math.round(share*100)}%（目標30〜40%）`);
    }else if(weekDaysRemaining>=31){
      // A forecast placement is not execution. Do not demand another full
      // rehearsal while the protected benchmark already planned in an earlier
      // week still awaits its result; replan after the real outcome.
      const pendingBenchmark=summary.plan.slice(0,start).flatMap(day=>day.tasks).some(t=>
        t.pastExamYearRole==="current_benchmark_simulation"&&t.kind==="timed");
      if(!week.counts.timed&&!pendingBenchmark)violations.push(`${start/7+1}週目: 90分演習なし`);
      if(share<horizon.pastExamShareMin)
        violations.push(`${start/7+1}週目: 過去問・本番型比率${Math.round(share*100)}%（目標${Math.round(horizon.pastExamShareMin*100)}〜${Math.round(horizon.pastExamShareMax*100)}%）`);
    }else if(share<horizon.pastExamShareMin){
      violations.push(`${start/7+1}週目: 本番形式比率${Math.round(share*100)}%（目標60%以上）`);
    }
  }
  summary.weeklyMinimumViolations=violations;
  summary.dailyCapacityViolations=summary.plan.filter(day=>day.totalMinutes>targetMinutes).length;
  return summary;
}

function planDays(args:{
  startDate:string;days:number;daysRemaining:number;targetMinutes:number;record?:StoredExamReferencePack|null;
  catalog:ExamReferenceCatalogItem[];problems:Problem[];attempts:Attempt[];reviews:Review[];pastSessions:PastSession[];
  weaknesses:ConceptWeaknessInsight[];currentTasks:Task[];repairCandidates?:PastExamRepairCandidate[];
}){
  const result:AdaptivePlanDay[]=[],usedProblems=new Map<string,string>(),usedPast=new Map<string,string>(),usedSessionYears=new Set<number>();
  const canonicalPastSessions=projectPastExamSessionAdmissions({catalog:args.catalog,today:args.startDate,daysRemaining:args.daysRemaining,attempts:args.attempts,
    pastSessions:canonicalizePastExamSessions(args.pastSessions).current
      .map(session=>reconcilePastExamSessionEvidence(session,args.attempts,session.session_alias_ids))});
  const pinnedPastSession=canonicalPastSessions.find(session=>
    !["completed","deferred","cancelled","invalidated"].includes(derivePastExamSessionState(session))&&
    ["clean_scan5","practice_scan5","timed_three_question_session","simulation"].includes(pastExamSessionPurpose(session)));
  const preferredMeasurementYear=preferredPastExamMeasurementYear({catalog:args.catalog,pastSessions:canonicalPastSessions,
    attempts:args.attempts,today:args.startDate,daysRemaining:args.daysRemaining});
  const sessionDecisions:NonNullable<AdaptivePlanSummary["sessionDecisions"]>=[];
  for(const current of args.currentTasks.filter(row=>row.stable_session_key&&row.past_exam_year&&!row.checked)){
    const session=canonicalPastSessions.find(row=>pastExamSessionKey(row)===current.stable_session_key);
    const decision=derivePastExamSessionAdmission({year:current.past_exam_year!,catalog:args.catalog,
      pastSessions:canonicalPastSessions,attempts:args.attempts,today:args.startDate,session,clean:current.clean_selection_evidence,preferredMeasurementYear});
    sessionDecisions.push({...decision,sessionKey:current.stable_session_key!,year:current.past_exam_year!,
      date:args.startDate,reevaluateOn:addCalendarDays(args.startDate,1)});
  }
  // The final shadow can be re-derived from the admitted Today tasks. Keep
  // read-time policy deferrals visible after the old snapshot task is replaced.
  for(const session of canonicalPastSessions.filter(row=>row.planning_defer_reason)){
    const sessionKey=pastExamSessionKey(session);
    if(sessionDecisions.some(row=>row.sessionKey===sessionKey))continue;
    const decision=derivePastExamSessionAdmission({year:session.year,catalog:args.catalog,
      pastSessions:canonicalPastSessions,attempts:args.attempts,today:args.startDate,session,preferredMeasurementYear});
    sessionDecisions.push({...decision,sessionKey,year:session.year,date:args.startDate,
      reevaluateOn:addCalendarDays(args.startDate,1)});
  }
  const usedDeferredReviewIds=new Set<number>();
  const allActiveReviews=args.reviews.filter(review=>reviewExecutionState(review,args.startDate)==="actionable")
    .sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id-b.id);
  const reviewSource=(review:Review)=>args.attempts.find(attempt=>attempt.id===Number(
    review.grading_contract?.sourceAttemptId||review.source_attempt_id||review.generated_from_attempt_id||0));
  const changedIntervention=(review:Review)=>{
    const source=reviewSource(review);
    if(!source||review.triage_override==="must"||
      !["full","main_calc"].includes(String(review.grading_contract?.mode||review.effective_mode||"")))return false;
    const roots=new Set(deriveFailureEpisode(source).rootWeaknesses.map(root=>root.rootWeaknessId));
    return !!args.repairCandidates?.some(candidate=>candidate.required&&candidate.interventionChanged&&
      candidate.sourceProblemId===review.problem_id&&!!candidate.rootWeaknessId&&roots.has(candidate.rootWeaknessId));
  };
  const reviewDecisions=new Map(allActiveReviews.map(review=>[review.id,changedIntervention(review)?{
    tier:"deferred_maintenance" as const,scheduleAsRequired:false,
    reason:"同じrootの再失敗後は同形式Reviewを重ねず、再診断・別問題へ介入を変更"}:
    reviewPlanningDecision({review,attempts:args.attempts,problems:args.problems,weaknesses:args.weaknesses,
      pastExamIsPrimary:deriveLearningPolicy(args.daysRemaining).pastExamIsPrimary,
      repairCandidates:args.repairCandidates,pastSessions:canonicalPastSessions})]));
  const activeReviews=allActiveReviews.filter(review=>reviewDecisions.get(review.id)?.scheduleAsRequired);
  const deferredReviews=allActiveReviews.filter(review=>!reviewDecisions.get(review.id)?.scheduleAsRequired);
  const horizonEnd=addCalendarDays(args.startDate,Math.max(0,args.days-1));
  const selectedAttemptIds=new Set(canonicalPastSessions.flatMap(session=>session.selected_timed_attempt_ids||[]));
  const calibrationAttemptIds=new Set(canonicalPastSessions.flatMap(session=>session.counterfactual_calibration_attempt_ids||[]));
  const selectedProblemIds=new Set(canonicalPastSessions.flatMap(session=>
    session.final_selected_problem_ids||[]));
  const sourceForReview=reviewSource;
  const reviewSourceRank=(review:Review)=>{
    const source=sourceForReview(review);if(!source)return 6;
    if(source.session_role==="selected_timed"||selectedAttemptIds.has(source.id)||selectedProblemIds.has(source.problem_id))return 0;
    if(source.session_role==="individual_transfer"||source.transfer_evidence)return 1;
    if(calibrationAttemptIds.has(source.id)||source.session_role==="counterfactual_calibration")return 3;
    if(source.parent_past_session_id||source.problem_id.startsWith("PY-"))return 2;
    return 5;
  };
  const activeYear=pinnedPastSession?.year||selectPastExamYear({candidates:buildPastExamYearCandidates({
    catalog:args.catalog,attempts:args.attempts,pastSessions:canonicalPastSessions,
    weaknesses:args.weaknesses,today:args.startDate,daysRemaining:args.daysRemaining}),
    taskType:"timed_three_question_session"})?.year;
  const sessionSkills=new Set(args.catalog.filter(row=>row.year===activeYear).flatMap(row=>row.fineConceptIds));
  const isHardBlockerReview=(review:Review)=>{
    const source=sourceForReview(review),episode=source?deriveFailureEpisode(source):undefined;
    return reviewSourceRank(review)===0&&!!source&&source.date>=addCalendarDays(args.startDate,-14)&&
      !!episode?.rootWeaknesses.some(root=>root.requiredRepair&&root.materiality==="major"&&
        root.errorTypes.includes("W")&&root.skillIds.some(id=>sessionSkills.has(id)));
  };
  const compareReviews=(left:Review,right:Review)=>Number(isHardBlockerReview(right))-Number(isHardBlockerReview(left))||
    reviewSourceRank(left)-reviewSourceRank(right)||
    String(left.latest_date||left.due_date).localeCompare(String(right.latest_date||right.due_date))||
    left.id-right.id;
  const blockerCapacity=activeReviews.filter(isHardBlockerReview).sort(compareReviews).slice(0,2)
    .reduce((sum,review)=>sum+Math.max(1,Number(review.grading_contract?.estimatedMinutes||review.estimated_minutes||5)),0);
  const reviewSchedule=scheduleActiveReviews({reviews:activeReviews,startDate:args.startDate,days:args.days,
    dailyCapacity:args.targetMinutes,repairBudgetMinutes:Math.max(Math.round(args.targetMinutes*.3),blockerCapacity),compareReviews});
  const reviewsByDate=new Map<string,ScheduledReviewPlacement[]>();
  for(const placement of reviewSchedule.placements)
    reviewsByDate.set(placement.date,[...(reviewsByDate.get(placement.date)||[]),placement]);
  const decisions:NonNullable<AdaptivePlanSummary["reviewSchedule"]["decisions"]>=deferredReviews.map(review=>({
    reviewId:review.id,problemId:review.problem_id,date:args.startDate,waitingDays:Math.max(0,differenceInCalendarDays(args.startDate,review.latest_date||review.due_date)??0),
    reason:reviewDecisions.get(review.id)!.reason,admitted:false,reevaluateOn:addCalendarDays(args.startDate,1)}));
  const changedProblemIds=new Set((args.repairCandidates||[]).filter(row=>row.required&&row.interventionChanged)
    .map(row=>row.sourceProblemId));
  const activeReviewProblemIds=new Set(activeReviews.filter(review=>String(review.earliest_date||review.due_date)<=horizonEnd)
    .map(review=>review.problem_id).concat([...changedProblemIds]));
  const allowNew=examHorizonPolicy(args.daysRemaining).allowNewWhitebook;
  const recentEligibleSuccesses=args.attempts.filter(attempt=>attempt.date>=addCalendarDays(args.startDate,-14)&&
    attempt.exam_score_eligible&&Number(attempt.score_numeric||0)>=70).length;
  const acceleratePast=recentEligibleSuccesses>=2;
  const recentGraduatedProblems=new Set(args.attempts.filter(attempt=>
    attempt.date>=addCalendarDays(args.startDate,-GRADUATED_SAME_PROBLEM_COOLDOWN_DAYS)&&
    resolvePersistedAttemptLifecycle(attempt).graduated
  ).map(attempt=>attempt.problem_id));
  const actualAtStart=weeklyActual({startDate:args.startDate,attempts:args.attempts,
    pastSessions:args.pastSessions,problems:args.problems});
  let weekActual={...actualAtStart};
  const makeWhitebook=(date:string,chapters:number[],mode:"skeleton"|"full",reason:string,
    slot:SlotTask["slot"]="score_building",repairOnly=false)=>{
    const avoided=new Set([...recentGraduatedProblems,...activeReviewProblemIds]);
    const problem=chooseWhitebook({problems:args.problems,attempts:args.attempts,chapters,used:usedProblems,date,allowNew,mode,
      weaknesses:args.weaknesses,avoidProblemIds:avoided,repairOnly});
    const concept=problem?(problem.fine_concept_ids||[]).map(id=>args.weaknesses.find(row=>row.conceptId===id))
      .filter(Boolean).sort((a,b)=>Number(b?.priorityScore||0)-Number(a?.priorityScore||0))[0]:undefined;
    const evidenceReason=concept?.state==="suspected"?`・${concept.displayName}の要診断`:
      concept?.state==="transfer_pending"?`・${concept.displayName}を別問題で転移確認`:
      concept&&["confirmed","repairing","relapsed"].includes(concept.state)?`・${concept.displayName}の強い証拠を優先`:"";
    const purpose=concept?.state==="suspected"?"concept_diagnosis":
      concept?.state==="transfer_pending"?"transfer_check":undefined;
    const repairCategory=repairOnly||!!concept&&["confirmed","repairing","relapsed"].includes(concept.state);
    return problem?task({date,slot,kind:mode==="full"?"full":"whitebook",
      label:problem.display_label||problem.title,problemId:problem.problem_id,
      minutes:modeMinutes(mode),reason:`${reason}${evidenceReason}`,
      purpose,purposeLabel:purpose==="concept_diagnosis"?"弱点診断":purpose==="transfer_check"?"別問題で転移確認":undefined,
      conceptId:concept?.conceptId,mode,requiresUserSelection:false,
      todayCategory:repairCategory?"repair":"exam_practice",
      whyToday:purpose==="transfer_check"?"別問題で同じ能力を自力で使えるか測るため":repairCategory?
        "過去問・答案証拠で確認された弱点だけを補修するため":
        "初見の得点形成と時間内の答案化を測るため"}):null;
  };
  const usedRepairRoots=new Set<string>();
  const makeTargetedRepair=(date:string,trainingOnly=false,maxMinutes=Infinity,maxRepairMinutes=maxMinutes)=>{
    const candidateMinutes=(row:PastExamRepairCandidate)=>row.transferTraining?12:row.repairKind==="transfer"?35:
      row.repairKind==="whitebook"?modeMinutes("skeleton"):7;
    const candidate=[...(args.repairCandidates||[])].sort((a,b)=>{
      const rank=(c:PastExamRepairCandidate)=>selectedAttemptIds.has(c.sourceAttemptId)||selectedProblemIds.has(c.sourceProblemId)?0:2;
      return rank(a)-rank(b)||String(args.attempts.find(x=>x.id===a.sourceAttemptId)?.date||"").localeCompare(
        String(args.attempts.find(x=>x.id===b.sourceAttemptId)?.date||""))||a.sourceAttemptId-b.sourceAttemptId;
    }).find(row=>row.required&&candidateMinutes(row)<=
      (row.repairKind==="transfer"&&!row.transferTraining?maxMinutes:Math.min(maxMinutes,maxRepairMinutes))&&
      (!trainingOnly||!!row.transferTraining)&&!usedRepairRoots.has(row.rootWeaknessId||row.conceptId)&&(
      !!row.transferTraining||
      row.repairKind==="transfer"&&row.transferProblemIds.some(id=>!usedProblems.has(id))||
      row.repairKind==="concept_mini"||row.repairKind==="same_problem"||row.repairKind==="rediagnosis"||
      row.repairKind==="whitebook"&&row.matchConfidence==="high"&&row.whitebookProblemIds.some(id=>!usedProblems.has(id))));
    if(!candidate)return args.repairCandidates?null:makeWhitebook(date,[2,4,5,6,7,8],"skeleton",
      "過去問で確認された高価値targetだけを局所補修","score_building",true);
    usedRepairRoots.add(candidate.rootWeaknessId||candidate.conceptId);
    if(candidate.transferTraining){
      const training=candidate.transferTraining;
      const problemId=training.generatedProblemId||training.existingProblemId||candidate.sourceProblemId;
      usedProblems.set(problemId,date);
      return task({date,slot:"score_building",kind:"full",label:"転移確認",problemId,minutes:12,mode:"full",
        transferTrainingKey:training.key,reason:"遅延確認後の別問題1問で確認。本番の転移証拠とは区別します。",
        purpose:"transfer_check",purposeLabel:"転移確認（training）",requiresUserSelection:false,
        todayCategory:"repair",actionClass:"targeted_repair",whyToday:"補修後に別問題1問で確認し、本番演習へ戻るため"});
    }
    if(candidate.repairKind==="transfer"){
      const transferProblemId=candidate.transferProblemIds.find(id=>!usedProblems.has(id));
      const transferProblem=args.problems.find(row=>row.problem_id===transferProblemId);
      if(!transferProblem||!transferProblemId)return null;
      usedProblems.set(transferProblemId,date);
      return task({date,slot:"score_building",kind:"past_exam",label:transferProblem.display_label||transferProblem.title,
        problemId:transferProblemId,referenceProblemId:transferProblemId,conceptId:candidate.conceptId,minutes:35,mode:"full",
        reason:candidate.reason,purpose:"transfer_check",
        purposeLabel:"別問題で転移確認",requiresUserSelection:false,todayCategory:"exam_practice",actionClass:"exam_practice",
        whyToday:"同じ問題の反復ではなく、別問題で同じ能力を参照なし再現できるか測るため",
        repairLineage:{sourceAttemptId:candidate.sourceAttemptId,sourceProblemId:candidate.sourceProblemId,
          sourceFindingId:candidate.sourceFindingId,sourceFindingIds:candidate.sourceFindingIds,rootConceptId:candidate.conceptId,
          materiality:candidate.materiality,recurrence:candidate.recurrence,examImpact:candidate.examImpact,
          repairProblemId:transferProblemId,rootWeaknessId:candidate.rootWeaknessId,
          weaknessSkillIds:candidate.weaknessSkillIds,matchedSkillIds:candidate.weaknessSkillIds,
          matchConfidence:"high",matchReason:candidate.reason,repairSuccessEvidenceId:candidate.repairSuccessEvidenceId}});
    }
    if(candidate.repairKind!=="whitebook"){
      const sourceProblem=args.problems.find(row=>row.problem_id===candidate.sourceProblemId);
      if(!sourceProblem)return null;
      return task({date,slot:"score_building",kind:"whitebook",label:`${candidate.sourceProblemId} ${candidate.interventionChanged?"初手から分解して再診断":"該当部分の局所補修"}`,
        problemId:candidate.sourceProblemId,conceptId:candidate.conceptId,minutes:7,mode:"skeleton",
        reason:candidate.interventionChanged?candidate.reason:`${candidate.sourceProblemId}の失点原因「${candidate.conceptLabel}」にexact Whitebook一致がないため`,
        requiresUserSelection:false,todayCategory:"repair",actionClass:"targeted_repair",
        whyToday:`${candidate.sourceProblemId}のmajor root weaknessだけを5〜10分で訂正するため`,
        repairLineage:{sourceAttemptId:candidate.sourceAttemptId,sourceProblemId:candidate.sourceProblemId,
          intervention:candidate.interventionChanged?"rediagnosis":undefined,observedFailure:candidate.observedFailure||candidate.conceptLabel,
          sourceFindingIds:candidate.sourceFindingIds,
          sourceFindingId:candidate.sourceFindingId,rootConceptId:candidate.conceptId,materiality:candidate.materiality,
          recurrence:candidate.recurrence,examImpact:candidate.examImpact,repairProblemId:candidate.sourceProblemId,
          matchReason:candidate.matchReason,sourcePastExamProblemId:candidate.sourceProblemId,
          rootWeaknessId:candidate.rootWeaknessId,weaknessSkillIds:candidate.weaknessSkillIds,
          matchedSkillIds:candidate.matchedSkillIds,matchScore:candidate.matchScore,matchConfidence:candidate.matchConfidence}});
    }
    const repairProblemId=candidate.whitebookProblemIds.find(id=>!usedProblems.has(id));
    const problem=args.problems.find(row=>row.problem_id===repairProblemId);
    if(!problem||!repairProblemId)return null;
    usedProblems.set(repairProblemId,date);
    return task({date,slot:"score_building",kind:"whitebook",label:problem.display_label||problem.title,
      problemId:repairProblemId,conceptId:candidate.conceptId,minutes:modeMinutes("skeleton"),mode:"skeleton",
      reason:`${candidate.sourceProblemId}で${candidate.conceptLabel}のmajor失点が確認されたため`,
      requiresUserSelection:false,todayCategory:"repair",actionClass:"targeted_repair",
      whyToday:`${candidate.sourceProblemId}の失点原因「${candidate.conceptLabel}」だけを補修するため`,
      repairLineage:{sourceAttemptId:candidate.sourceAttemptId,sourceProblemId:candidate.sourceProblemId,
        sourceFindingIds:candidate.sourceFindingIds,
        sourceFindingId:candidate.sourceFindingId,rootConceptId:candidate.conceptId,materiality:candidate.materiality,
        recurrence:candidate.recurrence,examImpact:candidate.examImpact,repairProblemId,matchReason:candidate.matchReason,
        sourcePastExamProblemId:candidate.sourceProblemId,rootWeaknessId:candidate.rootWeaknessId,
        weaknessSkillIds:candidate.weaknessSkillIds,matchedSkillIds:candidate.matchedSkillIds,
        matchScore:candidate.matchScore,matchConfidence:candidate.matchConfidence}});
  };
  const makePast=(date:string,kind:"past_exam"|"scan5"|"timed",minutes:number,reason:string):SlotTask=>{
    const dayOffset=Math.round((Date.parse(`${date}T12:00:00Z`)-Date.parse(`${args.startDate}T12:00:00Z`))/86400000);
    const dayRemaining=Math.max(0,args.daysRemaining-dayOffset);
    const requestedType=kind==="timed"?"timed_three_question_session":kind==="scan5"?"clean_scan5":"individual_full";
    const stickyTaskCandidate=date===args.startDate?args.currentTasks.find(current=>!current.checked&&current.past_exam_year&&
      current.past_exam_session_state!=="completed"&&current.past_exam_session_state!=="deferred"&&
      (current.past_exam_task_type===requestedType||kind==="scan5"&&current.past_exam_task_type==="practice_scan5")):undefined;
    const stickyAdmission=stickyTaskCandidate?derivePastExamSessionAdmission({year:stickyTaskCandidate.past_exam_year!,
      catalog:args.catalog,pastSessions:canonicalPastSessions,attempts:args.attempts,today:date,clean:stickyTaskCandidate.clean_selection_evidence,
      preferredMeasurementYear:preferredPastExamMeasurementYear({catalog:args.catalog,pastSessions:canonicalPastSessions,
        attempts:args.attempts,today:date,daysRemaining:dayRemaining}),
      session:canonicalPastSessions.find(row=>pastExamSessionKey(row)===stickyTaskCandidate.stable_session_key)}):undefined;
    const stickyTask=stickyTaskCandidate&&validatePastExamTaskIdentity(stickyTaskCandidate).valid&&stickyAdmission?.required?stickyTaskCandidate:undefined;
    const persistedCandidate=date===args.startDate?pinnedPastSession:undefined;
    const persisted=persistedCandidate&&validatePastExamSessionIdentity(persistedCandidate).valid?persistedCandidate:undefined;
    const stickyYear=persisted?.year||stickyTask?.past_exam_year;
    const eligibleYears=buildPastExamYearCandidates({catalog:args.catalog,attempts:args.attempts,
      pastSessions:args.pastSessions,weaknesses:args.weaknesses,today:date,daysRemaining:dayRemaining});
    const stickyRows=stickyYear?args.catalog.filter(row=>row.year===stickyYear&&row.schedulable&&row.gradable&&
      (!!persisted||eligibleYears.some(candidate=>candidate.year===stickyYear))):[];
    const stickyAnchor=stickyRows.find(row=>row.canonicalProblemId===stickyTask?.problem_id)||stickyRows[0];
    const stickyPurpose=persisted?pastExamSessionPurpose(persisted):stickyTask?.past_exam_task_type;
    const selected=stickyAnchor?{...stickyAnchor,yearRole:eligibleYears.find(candidate=>candidate.year===stickyYear)?.yearRole,
      planningTaskType:stickyPurpose!,
      sessionProblemIds:stickyTask?.session_problem_ids?.length?stickyTask.session_problem_ids:stickyRows.sort((a,b)=>a.questionNumber-b.questionNumber)
        .map(row=>row.canonicalProblemId),cleanSelectionEvidence:persisted?
          persisted.exposure_snapshot_at_start?.classification==="clean":!!stickyTask?.clean_selection_evidence,
      selectedYearReason:persisted?.selected_year_reason||stickyTask?.selected_year_reason,
      unseenIndividualProblemIds:stickyTask?.unseen_individual_problem_ids}:choosePastExam({catalog:args.catalog,daysRemaining:dayRemaining,used:usedPast,date,
      attempts:args.attempts,weaknesses:args.weaknesses,avoidProblemIds:activeReviewProblemIds,
      pastSessions:args.pastSessions,kind,usedSessionYears});
    if(!selected&&kind!=="past_exam"){
      const correction=derivePastExamShortCorrection({pastSessions:canonicalPastSessions,attempts:args.attempts,today:date});
      const rows=correction?args.catalog.filter(r=>r.year===correction.year&&r.schedulable&&r.gradable)
        .sort((a,b)=>a.questionNumber-b.questionNumber):[];
      if(correction&&rows.length===5&&!result.some(day=>day.tasks.some(t=>t.stableSessionKey===correction.stableSessionKey))){
        return task({date,slot:"score_building",kind:"scan5",label:`${correction.year}年 practice scan・時間配分較正`,
          referenceProblemId:rows[0].referenceProblemId,problemId:rows[0].canonicalProblemId,minutes:10,
          purpose:"selection_scan",purposeLabel:"時間配分・得点予測の較正",reason:correction.reason,whyToday:correction.reason,
          basis:`source session: ${correction.sourceSessionKey}`,exposure:rows[0].exposure,requiresUserSelection:false,
          pastExamTaskType:"practice_scan5",pastExamYear:correction.year,pastExamYearRole:pastExamYearRole(correction.year),
          sessionProblemIds:rows.map(r=>r.canonicalProblemId),cleanSelectionEvidence:false,
          stableSessionKey:correction.stableSessionKey,pastExamSessionState:"planned",
          sessionWorkflow:"5問practice scan → scan込み90分の時間配分・得点予測を補正",
          selectedYearReason:correction.reason,todayCategory:"exam_practice"});
      }
      // A declined full format does not mean the registered exam material is
      // missing. Continue with an existing local intervention/individual task,
      // rather than resurrecting the old full or requesting material registration.
      return makeTargetedRepair(date)||makePast(date,"past_exam",35,
        "full再演習は未承認のため、必要な局所補修・別問題を使い、次のbenchmarkで本番形式を再測定");
    }
    if(!selected)return task({date,slot:"maintenance_selection",kind:"exposure_confirmation",label:"過去問素材の露出状態を確認",
      minutes:0,reason:"具体的に利用できる過去問がないため、設定画面で素材登録状態を確認してください。",
      purpose:"material_selection_confirmation",purposeLabel:"素材選択確認",
      basis:"利用可能な具体問題がないため、露出状態を変更せずユーザー確認を求めます。",exposure:"unknown",
      requiresUserSelection:true});
    const latest=[...args.attempts].filter(attempt=>
      canonicalPastExamProblemId(attempt.problem_id)===canonicalPastExamProblemId(selected.canonicalProblemId))
      .sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
    const purpose=kind==="scan5"?"selection_scan":kind==="timed"?"timed_reconfirmation":
      selected.exposure==="unseen"?"initial_diagnosis":
      selected.exposure==="prompt_scanned"&&!latest?"first_answer":"delayed_reattempt";
    const purposeLabel=purpose==="selection_scan"?"5問scan・3問選択":purpose==="timed_reconfirmation"?"時間制限再確認":
      purpose==="initial_diagnosis"?"初回診断":purpose==="first_answer"?"初回答案":"補修後の遅延再挑戦";
    const basis=`露出状態：${selected.exposure}${latest?`／前回Attempt：${latest.date}`:"／対象問題のAttemptなし"}`;
    const scanSession=["clean_scan5","practice_scan5"].includes(selected.planningTaskType);
    const sessionLabel=selected.planningTaskType==="timed_three_question_session"?`${selected.year}年 本番型session`:
      selected.planningTaskType==="simulation"?`${selected.year}年 本番simulation（5問scan・3問90分）`:
      scanSession?`${selected.year}年 ${selected.cleanSelectionEvidence?"clean":"practice"} scan5・3問選択`:`${selected.year}年問${selected.questionNumber}`;
    const sessionWorkflow=selected.planningTaskType==="timed_three_question_session"||selected.planningTaskType==="simulation"?
      "5問scan → 3問選択 → 3問答案 → 採点":scanSession?"5問scan → 3問選択":"1問答案 → 採点";
    const stableSessionKey=persisted?pastExamSessionKey(persisted):stickyTask?.stable_session_key||stablePastExamSessionKey({year:selected.year,
      purpose:selected.planningTaskType,ordinal:1});
    const selectedYearReason=explainPastExamYearSelection({year:selected.year,yearRole:selected.yearRole!,
      cleanScanEligible:selected.cleanSelectionEvidence,eligibleRows:stickyRows.length?stickyRows:
        args.catalog.filter(row=>row.year===selected.year&&row.schedulable&&row.gradable),
      exposedCount:selected.cleanSelectionEvidence?0:args.catalog.filter(row=>row.year===selected.year&&row.schedulable&&row.gradable&&
        !["unseen","unknown"].includes(row.exposure)).length});
    const correction=derivePastExamShortCorrection({pastSessions:canonicalPastSessions,attempts:args.attempts,today:date});
    const correctionReason=correction?.stableSessionKey===stableSessionKey?correction.reason:undefined;
    const fullReason=["timed_three_question_session","simulation"].includes(selected.planningTaskType)?
      derivePastExamSessionAdmission({year:selected.year,catalog:args.catalog,pastSessions:canonicalPastSessions,
        attempts:args.attempts,today:date,session:persisted,clean:selected.cleanSelectionEvidence}).reason:undefined;
    return task({date,slot:"score_building",kind:scanSession?"scan5":kind,label:sessionLabel,
      referenceProblemId:selected.referenceProblemId,problemId:selected.canonicalProblemId,
      minutes:scanSession&&(kind!=="scan5"||correctionReason)?10:minutes,
      reason:`${reason}・${purposeLabel}`,purpose,purposeLabel,basis,exposure:selected.exposure,
      previousEventDate:latest?.date,simulationProtected:selected.simulationProtected,requiresUserSelection:false,
      pastExamTaskType:selected.planningTaskType,pastExamYear:selected.year,
      pastExamYearRole:selected.yearRole,
      sessionProblemIds:selected.sessionProblemIds,cleanSelectionEvidence:selected.cleanSelectionEvidence,
      stableSessionKey,pastExamSessionState:persisted?derivePastExamSessionState(persisted):stickyTask?.past_exam_session_state||"planned",sessionWorkflow,
      selectedYearReason,
      unseenIndividualProblemIds:stickyTask?.unseen_individual_problem_ids||selected.unseenIndividualProblemIds,
      todayCategory:"exam_practice",whyToday:correctionReason||fullReason|| (stickyAdmission?.required&&stickyTask?stickyAdmission.reason:
        pastExamMeasurementPurpose(selected.cleanSelectionEvidence,selected.yearRole))});
  };
  let materialConfirmationPlanned=false;
  const includedReviewIds=new Set<number>();
  const admittedPlacements:ScheduledReviewPlacement[]=[];
  let carriedPlacements:ScheduledReviewPlacement[]=[];
  for(let offset=0;offset<args.days;offset++){
    const date=addCalendarDays(args.startDate,offset),weekday=offset%7;
    if(offset>0&&offset%7===0)weekActual={chapter5:0,chapter7:0,chapter8:0,scan5:0,fullOrTimed:0,pastExam:0};
    const phase=phaseName(Math.max(0,args.daysRemaining-offset));
    let score:SlotTask|null=null,phaseMaintenance:SlotTask|null=null;
    if(phase==="foundation_to_A"){
      if(weekActual.scan5<1&&!materialConfirmationPlanned)score=makePast(date,"scan5",50,"直近7日のscan5実績不足を優先補完");
      else if(weekActual.fullOrTimed<1)score=makeWhitebook(date,[2,4,6],"full","直近7日のfull/timed実績不足を優先補完");
      else if(acceleratePast&&weekday===4)score=makePast(date,"past_exam",35,"参照なし本番得点が安定したため過去問を前倒し");
      else score=makeWhitebook(date,[2,4,6],"skeleton","第2・4・6章の得点形成");
      if(weekActual.chapter5<1)phaseMaintenance=makeWhitebook(date,[5],"skeleton","直近7日の第5章実績不足を優先補完","maintenance_selection");
      else if(weekActual.chapter7<1)phaseMaintenance=makeWhitebook(date,[7],"skeleton","直近7日の第7章実績不足を優先補完","maintenance_selection");
    }else if(phase==="A_and_past_parallel"){
      if(weekActual.scan5<1&&!materialConfirmationPlanned)score=makePast(date,"scan5",10,"過去問導入期のrolling 7日枠を優先補完");
      else if([2,4,6].includes(weekday))score=makePast(date,"past_exam",35,"過去問30〜40%枠で得点較正");
      else score=makeWhitebook(date,[2,4,6],"full","重要白本と過去問を並行");
      if(weekActual.chapter5<1)phaseMaintenance=makeWhitebook(date,[5],"skeleton","直近7日の第5章実績不足を優先補完","maintenance_selection");
      else if(weekActual.chapter7<1)phaseMaintenance=makeWhitebook(date,[7],"skeleton","直近7日の第7章実績不足を優先補完","maintenance_selection");
      else if(weekActual.chapter8<1)phaseMaintenance=makeWhitebook(date,[8],"skeleton","第8章を20〜25%維持","maintenance_selection");
    }else if(phase==="past_exam_main"){
      const benchmark=preferredPastExamMeasurementYear({catalog:args.catalog,pastSessions:canonicalPastSessions,
        attempts:args.attempts,today:date,daysRemaining:Math.max(0,args.daysRemaining-offset)});
      const releasedBenchmark=benchmark!=null&&pastExamYearRole(benchmark)==="current_benchmark_simulation"&&
        !usedSessionYears.has(benchmark);
      if(weekday===0||releasedBenchmark)score=makePast(date,"timed",90,"5問scan・3問選択・3問答案を一つの本番型sessionで実施");
      else if([2,4].includes(weekday))score=makePast(date,"past_exam",35,"未見・過去問で得点形成とtransferを測定");
      else if(weekday===6)score=makePast(date,"past_exam",35,"別の未見問題でtransferを測定");
      else score=makeTargetedRepair(date)||makePast(date,"past_exam",35,"必要な補修がなければ、別問題の本番答案で再測定する");
    }else{
      score=makePast(date,weekday===0||weekday===4?"timed":weekday===2?"scan5":"past_exam",
        weekday===0||weekday===4?90:weekday===2?10:35,"本番形式・3題選択・確認済み弱点を主軸に固定");
    }
    let dayPlacements=[...carriedPlacements,...(reviewsByDate.get(date)||[])].filter(p=>!includedReviewIds.has(p.review.id))
      .sort((left,right)=>compareReviews(left.review,right.review));
    carriedPlacements=[];
    const timedSession=score&&["timed_three_question_session","simulation"].includes(String(score.pastExamTaskType||""));
    if(dayPlacements.length){
      const blockerMinutes=dayPlacements.filter(p=>isHardBlockerReview(p.review)).reduce((sum,p)=>sum+p.minutes,0);
      // Reserve actual prerequisite repair before fitting a long measurement.
      // A 90-minute session is deferred when it and its blocker cannot fit;
      // the blocker is not silently dropped because the session consumed the budget.
      const repairBudget=Math.min(timedSession?30:reviewSchedule.repairBudgetMinutes,
        Math.max(Math.min(blockerMinutes,args.targetMinutes),args.targetMinutes-(score?.minutes||0)));
      const selectedPlacements:ScheduledReviewPlacement[]=[];
      let repairMinutes=0;const selectedRoots=new Set<string>();
      for(const placement of dayPlacements){
        const source=sourceForReview(placement.review);
        const root=source?deriveFailureEpisode(source).rootWeaknesses[0]?.rootWeaknessId:undefined;
        const rootKey=root||placement.review.problem_id;
        const placementBudget=isHardBlockerReview(placement.review)?args.targetMinutes:repairBudget;
        const reason=selectedRoots.has(rootKey)?"duplicate_root":timedSession&&selectedPlacements.length>=2?"root_cap":
          repairMinutes+placement.minutes>placementBudget?"budget":"";
        if(reason){
          carriedPlacements.push(placement);
          decisions.push({reviewId:placement.review.id,problemId:placement.review.problem_id,date,
            waitingDays:Math.max(0,differenceInCalendarDays(date,placement.latestDate)??0),reason,admitted:false,
            reevaluateOn:addCalendarDays(date,1)});
          continue;
        }
        selectedRoots.add(rootKey);
        if(root)usedRepairRoots.add(root);
        selectedPlacements.push(placement);repairMinutes+=placement.minutes;
      }
      dayPlacements=selectedPlacements;
    }
    const tasks:SlotTask[]=dayPlacements.map(placement=>{
      includedReviewIds.add(placement.review.id);
      admittedPlacements.push({...placement,date,status:date>placement.latestDate?"overdue_recovery":"within_window"});
      decisions.push({reviewId:placement.review.id,problemId:placement.review.problem_id,date,
        waitingDays:Math.max(0,differenceInCalendarDays(date,placement.latestDate)??0),reason:"admitted",admitted:true});
      const sourceId=Number(placement.review.grading_contract?.sourceAttemptId||placement.review.source_attempt_id||
        placement.review.generated_from_attempt_id||0);
      const source=args.attempts.find(attempt=>attempt.id===sourceId);
      const part=placement.review.grading_contract?.gradedParts[0];
      const concept=(args.problems.find(problem=>problem.problem_id===placement.review.problem_id)?.fine_concept_ids||[])[0]||"review-target";
      const errors=new Set([...(source?.error_types||[]),source?.primary_error_type||source?.error_type||""].filter(Boolean));
      const episode=source?deriveFailureEpisode(source):undefined;
      const root=episode?.rootWeaknesses.find(row=>row.sourceFindingIds.includes(part?.id||""))||episode?.rootWeaknesses[0];
      const directExamLoss=!!source&&(source.session_role==="selected_timed"||selectedAttemptIds.has(source.id)||selectedProblemIds.has(source.problem_id));
      const diagnosticOnly=!!source&&(source.session_role==="counterfactual_calibration"||calibrationAttemptIds.has(source.id));
      const hardBlocker=isHardBlockerReview(placement.review);
      const major=root?.materiality==="major"||reviewDecisions.get(placement.review.id)?.tier==="high_value_repair"||
        [...errors].some(error=>["K","W"].includes(error))||source?.review_outcome==="failed";
      const repairLineage=source?{sourceAttemptId:source.id,sourceProblemId:source.problem_id,
        sourceFindingId:root?.sourceFindingIds[0]||part?.stableTargetKey||part?.stable_target_key||part?.id||`attempt:${source.id}`,
        rootConceptId:concept,materiality:major?"major" as const:"minor" as const,recurrence:0,
        examImpact:major?"high" as const:"low" as const,repairProblemId:placement.review.problem_id,
        matchReason:part?"source Attemptのcurrent stable targetを同一問題で局所補修":"source Attemptのroot weaknessを同一問題で局所補修",
        sourcePastExamProblemId:source.parent_past_session_id?source.problem_id:undefined,
        rootWeaknessId:root?.rootWeaknessId,weaknessSkillIds:root?.skillIds,matchedSkillIds:root?.skillIds,
        matchScore:100,matchConfidence:"high" as const}:undefined;
      return task({date,slot:"repair",kind:"review",
        label:`${placement.review.problem_id} 局所補修`,problemId:placement.review.problem_id,reviewId:placement.review.id,
        mode:placement.review.grading_contract?.mode||placement.review.effective_mode||placement.review.inferred_mode||"check",
        minutes:placement.minutes,reason:hardBlocker?"この本番sessionに必要な直近major計算弱点を局所補修":
          placement.status==="overdue_recovery"?"期限超過Reviewを本番演習の空き枠で確認":"復習ウィンドウ内に配置",
        requiresUserSelection:false,todayCategory:"repair",whyToday:reviewDecisions.get(placement.review.id)?.reason,
        reviewPlanningTier:reviewDecisions.get(placement.review.id)?.tier,repairLineage,
        hardBlocker,directExamLoss,diagnosticOnly,
        reviewEarliestDate:placement.earliestDate,reviewPreferredDate:placement.preferredDate,
        reviewLatestDate:placement.latestDate,reviewScheduleStatus:placement.status});
    });
    if(score?.kind==="exposure_confirmation"){
      if(!materialConfirmationPlanned)tasks.push(score);
      materialConfirmationPlanned=true;
      score=deriveLearningPolicy(Math.max(0,args.daysRemaining-offset)).pastExamIsPrimary?null:
        makeWhitebook(date,[2,4,5,6,7,8],"skeleton","利用可能な過去問がない導入期の得点形成");
    }
    const overPreSessionRepairCap=timedSession&&tasks.filter(t=>t.slot==="repair")
      .reduce((sum,t)=>sum+t.minutes,0)>30;
    if(score&&!overPreSessionRepairCap&&tasks.reduce((sum,row)=>sum+row.minutes,0)+score.minutes<=args.targetMinutes)tasks.push(score);
    else if(score?.stableSessionKey&&score.pastExamYear&&date===args.startDate){
      const deferred={sessionKey:score.stableSessionKey,year:score.pastExamYear,date,required:false,
        disposition:"deferred" as const,evidenceIds:tasks.filter(t=>t.hardBlocker).map(t=>`review:${t.reviewId}`),
        reason:overPreSessionRepairCap?"真の重大blockerを先に補修するため、本番前補修の30分上限を超えるsessionは延期。年度は完了扱いにせず次回再評価":
          "本日の必要補修と本番sessionが日次予算に収まらないため延期。年度は完了扱いにせず次回再評価",
        reevaluateOn:addCalendarDays(date,1)};
      const index=sessionDecisions.findIndex(row=>row.sessionKey===score.stableSessionKey);
      if(index>=0)sessionDecisions[index]=deferred;else sessionDecisions.push(deferred);
    }
    // A single eligible training fits inside the existing repair budget; never
    // evict an exam session or create drafts just to fill a quota.
    const repairTasks=tasks.filter(t=>t.todayCategory==="repair");
    if(deriveLearningPolicy(Math.max(0,args.daysRemaining-offset)).pastExamIsPrimary&&args.repairCandidates?.length&&
      repairTasks.length<2&&repairTasks.reduce((sum,t)=>sum+t.minutes,0)+7<=30&&
      tasks.reduce((sum,t)=>sum+t.minutes,0)+7<=args.targetMinutes){
      const remaining=args.targetMinutes-tasks.reduce((sum,t)=>sum+t.minutes,0);
      const repairRemaining=30-repairTasks.reduce((sum,t)=>sum+t.minutes,0);
      const intervention=makeTargetedRepair(date,false,remaining,repairRemaining);
      if(intervention)tasks.push(intervention);
    }
    const coreFloor=Math.min(90,Math.max(60,Math.round(args.targetMinutes*.4)));
    if(phase==="foundation_to_A"&&score&&score.kind!=="scan5"&&
      tasks.reduce((sum,row)=>sum+row.minutes,0)<coreFloor){
      const secondScore=makeWhitebook(date,[2,4,6,5,7,8],"full",
        score.kind==="past_exam"?"過去問と並行する高価値白本補修":"利用可能時間を別問題の得点形成・転移へ配分");
      if(secondScore&&tasks.reduce((sum,row)=>sum+row.minutes,0)+secondScore.minutes<=Math.min(args.targetMinutes,90))
        tasks.push(secondScore);
    }
    if(phaseMaintenance&&tasks.reduce((sum,row)=>sum+row.minutes,0)+phaseMaintenance.minutes<=Math.min(args.targetMinutes,90))
      tasks.push(phaseMaintenance);
    const maintenanceConcept=args.weaknesses.find(row=>["transfer_pending","resolved"].includes(row.state)&&
      !tasks.some(item=>item.conceptId===row.conceptId));
    if(!phaseMaintenance&&maintenanceConcept&&tasks.reduce((sum,row)=>sum+row.minutes,0)+10<=args.targetMinutes&&score?.kind!=="scan5"){
      tasks.push(task({date,slot:"maintenance_selection",kind:"review",label:`${maintenanceConcept.displayName} 短時間確認`,
        conceptId:maintenanceConcept.conceptId,minutes:10,reason:"転移・保持の確認",requiresUserSelection:true}));
    }
    const optionalMaintenance=deferredReviews.find(review=>!usedDeferredReviewIds.has(review.id)&&
      String(review.earliest_date||review.due_date)<=date);
    if(optionalMaintenance){
      const decision=reviewDecisions.get(optionalMaintenance.id)!;
      usedDeferredReviewIds.add(optionalMaintenance.id);
      tasks.push(task({date,slot:"maintenance_selection",kind:"review",label:`${optionalMaintenance.problem_id} 任意の維持確認`,
        problemId:optionalMaintenance.problem_id,reviewId:optionalMaintenance.id,
        mode:optionalMaintenance.grading_contract?.mode||optionalMaintenance.effective_mode||optionalMaintenance.inferred_mode||"check",
        minutes:Number(optionalMaintenance.grading_contract?.estimatedMinutes||optionalMaintenance.estimated_minutes||5),
        reason:decision.reason,requiresUserSelection:true,todayCategory:"repair",whyToday:decision.reason,
        actionClass:"maintenance",reviewPlanningTier:decision.tier}));
    }
    for(const row of tasks){
      const plannedProblem=row.problemId?args.problems.find(problem=>problem.problem_id===row.problemId):undefined;
      if(plannedProblem?.chapter===5)weekActual.chapter5++;
      if(plannedProblem?.chapter===7)weekActual.chapter7++;
      if(plannedProblem?.chapter===8)weekActual.chapter8++;
      if(row.kind==="scan5")weekActual.scan5++;
      if(row.kind==="full"||row.kind==="timed")weekActual.fullOrTimed++;
      if(["past_exam","scan5","timed"].includes(row.kind)&&row.referenceProblemId)weekActual.pastExam++;
    }
    result.push({date,tasks,totalMinutes:tasks.filter(row=>!row.requiresUserSelection).reduce((sum,row)=>sum+row.minutes,0)});
  }
  // The weekday template is a starting allocation, not the phase target.
  // Restore the exam share with a concrete, unused problem on a lighter day;
  // keep today's confirmed session and the existing required repairs intact.
  for(let start=0;start+7<=result.length;start+=7){
    const policy=deriveLearningPolicy(Math.max(0,args.daysRemaining-start));
    if(!policy.pastExamIsPrimary)continue;
    const week=result.slice(start,start+7),tried=new Set<string>();
    while(rollingPastExamShare(week)+1e-9<policy.pastExamShareMin){
      const day=[...week].filter(row=>row.date!==args.startDate&&!tried.has(row.date)&&
        !row.tasks.some(item=>["past_exam","scan5","timed"].includes(item.kind)&&!!item.referenceProblemId)&&
        row.totalMinutes+35<=args.targetMinutes)
        .sort((a,b)=>a.totalMinutes-b.totalMinutes||a.date.localeCompare(b.date))[0];
      if(!day)break;
      tried.add(day.date);
      const exam=makePast(day.date,"past_exam",35,"週の本番演習比率を現在phaseの目標へ戻す");
      if(!exam?.referenceProblemId)continue;
      day.tasks.push(exam);day.totalMinutes+=exam.minutes;
    }
  }
  const retainedPlacements=admittedPlacements;
  const scheduledMinutes=Object.fromEntries(retainedPlacements.reduce((rows,row)=>{
    rows.set(row.date,Number(rows.get(row.date)||0)+row.minutes);return rows;
  },new Map<string,number>()));
  return {days:result,sessionDecisions,reviewSchedule:{...reviewSchedule,placements:retainedPlacements,scheduledMinutes,decisions}};
}

function weeklyActual(args:{startDate:string;attempts:Attempt[];pastSessions:PastSession[];problems:Problem[]}){
  const start=addCalendarDays(args.startDate,-6),problemMap=new Map(args.problems.map(problem=>[problem.problem_id,problem]));
  const attempts=args.attempts.filter(attempt=>attempt.date>=start&&attempt.date<=args.startDate);
  // A planned/carry-over row is not execution evidence. Keep actual scan and
  // answer completion separate, even when both belong to the same session.
  const sessions=args.pastSessions.filter(session=>String(session.date)>=start&&String(session.date)<=args.startDate);
  const scanned=sessions.filter(session=>session.prompt_scanned_at||Number(session.scan_minutes||0)>0);
  const completed=sessions.filter(session=>session.simulation_completed_at||session.attempt_completed_at);
  return {
    chapter5:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===5).length,
    chapter7:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===7).length,
    chapter8:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===8).length,
    scan5:scanned.filter(session=>["scan_only","scan_plus_one","selected_three_timed"].includes(String(session.session_kind))).length,
    fullOrTimed:attempts.filter(attempt=>attempt.mode==="full"||attempt.exam_score_eligible).length+
      completed.filter(session=>session.session_kind==="selected_three_timed").length,
    pastExam:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.category==="past_exam").length+
      sessions.filter(session=>(scanned.includes(session)||completed.includes(session))&&
        ["scan_only","scan_plus_one","selected_three_timed"].includes(String(session.session_kind))).length
  };
}

export function buildAdaptivePlannerShadow(args:{
  record?:StoredExamReferencePack|null;catalog:ExamReferenceCatalogItem[];weaknesses:ConceptWeaknessInsight[];
  problems:Problem[];attempts:Attempt[];reviews:Review[];pastSessions:PastSession[];
  currentTasks:Task[];today:string;examDate:string;targetMinutes:number;
  repairCandidates?:PastExamRepairCandidate[];
}):AdaptivePlannerShadow{
  const daysRemaining=daysUntilExam(args.today,args.examDate),phase=phaseName(daysRemaining),generatedAt=new Date().toISOString();
  const empty=validateMinimums(planSummary([]),daysRemaining,args.targetMinutes);
  if(!args.record)return {available:false,mode:"unavailable",generatedAt,phase,daysRemaining,targetMinutes:args.targetMinutes,
    plan7:empty,plan14:empty,plan30:empty,legacy30:{scan5:0,full:0,timed:0,totalTasks:0},
    comparisonReasons:["正規化済み参照パックを取り込むと計画を生成できます。"],
    activationEligible:false,activationBlockers:["参照パック未登録"],weeklyTarget:{},weeklyActual:{},phaseDiagnostics:[]};
  const planned7=planDays({...args,startDate:args.today,days:7,daysRemaining});
  const planned14=planDays({...args,startDate:args.today,days:14,daysRemaining});
  const planned30=planDays({...args,startDate:args.today,days:30,daysRemaining});
  const plan7=validateMinimums(planSummary(planned7.days,planned7.reviewSchedule,planned7.sessionDecisions),daysRemaining,args.targetMinutes);
  const plan14=validateMinimums(planSummary(planned14.days,planned14.reviewSchedule,planned14.sessionDecisions),daysRemaining,args.targetMinutes);
  const plan30=validateMinimums(planSummary(planned30.days,planned30.reviewSchedule,planned30.sessionDecisions),daysRemaining,args.targetMinutes);
  const legacy=simulateThirtyDays({startDate:args.today,tasks:args.currentTasks,problems:args.problems,targetMinutes:args.targetMinutes,
    pastSessions:args.pastSessions as unknown as Array<Record<string,unknown>>});
  const policy=deriveLearningPolicy(daysRemaining),weekly=weeklyActual({startDate:args.today,attempts:args.attempts,pastSessions:args.pastSessions,problems:args.problems});
  const blockers=[
    ...(!args.record.validation.valid?["参照パック検証エラー"]:[]),
    ...(args.record.reconciliation.pastExamConflicts?["過去問master差分の確認待ち"]:[]),
    ...(plan14.weeklyMinimumViolations.length||plan14.dailyCapacityViolations?["14日シミュレーションに未達あり"]:[]),
    ...(plan14.reviewSchedule.capacityConflicts.length?[`Review capacity conflict ${plan14.reviewSchedule.capacityConflicts.length}件`]:[])
  ];
  const phaseDiagnostics=([
    ["D90",90],["D60",60],["D30",30]
  ] as const).map(([checkpoint,remaining])=>{
    const diagnosticStart=addCalendarDays(args.examDate,-remaining);
    // Pure simulation: candidate selection never persists or rewrites exposure.
    const planned=planDays({...args,catalog:args.catalog,startDate:diagnosticStart,days:14,daysRemaining:remaining});
    const summary=validateMinimums(planSummary(planned.days,planned.reviewSchedule),remaining,args.targetMinutes);
    const all=summary.plan.flatMap(day=>day.tasks);
    const total=all.reduce((sum,row)=>sum+row.minutes,0);
    const past=all.filter(row=>["past_exam","scan5","timed"].includes(row.kind)&&!!row.referenceProblemId)
      .reduce((sum,row)=>sum+row.minutes,0);
    return {checkpoint,phase:phaseName(remaining),daysRemaining:remaining,scan5:summary.counts.scan5,
      full:summary.counts.full,timed:summary.counts.timed,pastExam:summary.counts.pastExam,
      pastExamShare:total?Math.round(past/total*100):0,weeklyMinimumViolations:summary.weeklyMinimumViolations,
      assumption:"verified・schedulable・gradable素材を履歴と保護状態から非破壊で選択"};
  });
  return {available:true,mode:"active",generatedAt,phase,daysRemaining,targetMinutes:args.targetMinutes,plan7,plan14,plan30,
    legacy30:{scan5:legacy.purposeCounts.scan5,full:legacy.purposeCounts.fullSkeleton,
      timed:legacy.purposeCounts.timedFull,totalTasks:args.currentTasks.length},
    comparisonReasons:[
      legacy.purposeCounts.scan5===0&&plan30.counts.scan5>0?"現行30日では0件のscan5を週最低枠で補完":"scan5実績を比較",
      legacy.purposeCounts.timedFull===0&&plan30.counts.timed>0?"現行30日では0件のtimedを日付フェーズで補完":"timed実績を比較",
      "Reviewは日付窓と分単位repair budgetで配置し、期限超過とlatest超過リスクを優先",
      "露出metadata未設定かつ実施履歴なしのverified素材は、保存値を変えずunseen候補として選択"
    ],activationEligible:blockers.length===0,activationBlockers:blockers,
    weeklyTarget:{phase,
      minimums:JSON.stringify({timedSession:policy.pastExamIsPrimary?1:0}),
      targetMix:JSON.stringify({exam_practice:[policy.examPracticeTargetRange.min,policy.examPracticeTargetRange.max],
        maintenance:policy.maintenancePolicy})},
    weeklyActual:weekly,phaseDiagnostics};
}
