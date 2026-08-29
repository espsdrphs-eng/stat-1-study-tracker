import type {
  AdaptivePlanDay, AdaptivePlanSummary, AdaptivePlannerShadow, Attempt, ConceptWeaknessInsight,
  ExamReferenceCatalogItem, PastSession, Problem, Review, Task
} from "./types.ts";
import type { StoredExamReferencePack } from "./examReferencePack.ts";
import { canonicalPastExamProblemId } from "./examReferencePack.ts";
import { addCalendarDays } from "./reviewSchedulePolicy.ts";
import { daysUntilExam } from "./studyProgress.ts";
import { reviewExecutionState } from "./integrityEngine.ts";
import { simulateThirtyDays } from "./learningSimulation.ts";
import { resolvePersistedAttemptLifecycle } from "./reviewTransition.ts";
import { scheduleActiveReviews, type ScheduledReviewPlacement } from "./reviewScheduling.ts";
import {examHorizonPolicy} from "./examOptimizationPolicy.ts";
import {buildPastExamYearCandidates,pastExamTaskTypeFor,selectPastExamYear} from "./pastExamPlanning.ts";
import {reviewPlanningDecision} from "./todayLearningPolicy.ts";

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

function phasePolicy(record:StoredExamReferencePack|undefined|null,daysRemaining:number){
  const phases=record?.data.plannerPolicy.phases||[];
  return phases.find(row=>daysRemaining>=Number(row.days_remaining_min)&&daysRemaining<=Number(row.days_remaining_max))||{};
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
  const year=selectPastExamYear({candidates,taskType:provisionalType,
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
  return {...selected,planningTaskType,sessionProblemIds:year.eligibleRows.sort((a,b)=>a.questionNumber-b.questionNumber)
    .map(row=>row.canonicalProblemId),cleanSelectionEvidence:year.cleanScanEligible};
}

function task(args:Omit<SlotTask,"taskKey">):SlotTask{
  return {...args,taskKey:[args.date,args.slot,args.kind,args.problemId||args.referenceProblemId||args.conceptId||args.label].join("|")};
}

function planSummary(days:AdaptivePlanDay[],reviewSchedule?:ReturnType<typeof scheduleActiveReviews>):AdaptivePlanSummary{
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
  return {days:days.length,plan:days,totalMinutes:days.reduce((sum,day)=>sum+day.totalMinutes,0),counts,
    weeklyMinimumViolations:[],dailyCapacityViolations:0,
    reviewSchedule:{repairBudgetMinutes:reviewSchedule?.repairBudgetMinutes||0,
      placements:(reviewSchedule?.placements||[]).map(row=>({reviewId:row.review.id,problemId:row.review.problem_id,
        date:row.date,latestDate:row.latestDate,status:row.status})),
      capacityConflicts:reviewSchedule?.capacityConflicts||[]}};
}

function validateMinimums(summary:AdaptivePlanSummary,daysRemaining:number,targetMinutes:number){
  const violations:string[]=[];
  for(let start=0;start<summary.plan.length;start+=7){
    const weekRows=summary.plan.slice(start,Math.min(start+7,summary.plan.length));
    if(weekRows.length<7)continue;
    const week=planSummary(weekRows),weekDaysRemaining=Math.max(0,daysRemaining-start);
    const horizon=examHorizonPolicy(weekDaysRemaining),share=rollingPastExamShare(weekRows);
    if(weekDaysRemaining>=91){
      if(!week.counts.chapter5)violations.push(`${start/7+1}週目: 第5章なし`);
      if(!week.counts.chapter7)violations.push(`${start/7+1}週目: 第7章なし`);
      if(!week.counts.scan5)violations.push(`${start/7+1}週目: scan5なし`);
      if(!week.counts.full&&!week.counts.timed)violations.push(`${start/7+1}週目: full/timedなし`);
    }else if(weekDaysRemaining>=81){
      if(!week.counts.scan5)violations.push(`${start/7+1}週目: scan5なし`);
      if(!week.counts.pastExam)violations.push(`${start/7+1}週目: 過去問なし`);
      if(share<horizon.pastExamShareMin||share>horizon.pastExamShareMax)
        violations.push(`${start/7+1}週目: 過去問比率${Math.round(share*100)}%（目標30〜40%）`);
    }else if(weekDaysRemaining>=31){
      if(!week.counts.timed)violations.push(`${start/7+1}週目: 90分演習なし`);
      if(share<horizon.pastExamShareMin||share>horizon.pastExamShareMax)
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
  weaknesses:ConceptWeaknessInsight[];
}){
  const result:AdaptivePlanDay[]=[],usedProblems=new Map<string,string>(),usedPast=new Map<string,string>(),usedSessionYears=new Set<number>();
  const usedDeferredReviewIds=new Set<number>();
  const allActiveReviews=args.reviews.filter(review=>reviewExecutionState(review,args.startDate)==="actionable")
    .sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id-b.id);
  const reviewDecisions=new Map(allActiveReviews.map(review=>[review.id,reviewPlanningDecision({
    review,attempts:args.attempts,problems:args.problems,weaknesses:args.weaknesses
  })]));
  const activeReviews=allActiveReviews.filter(review=>reviewDecisions.get(review.id)?.scheduleAsRequired);
  const deferredReviews=allActiveReviews.filter(review=>!reviewDecisions.get(review.id)?.scheduleAsRequired);
  const reviewSchedule=scheduleActiveReviews({reviews:activeReviews,startDate:args.startDate,days:args.days,
    dailyCapacity:args.targetMinutes});
  const reviewsByDate=new Map<string,ScheduledReviewPlacement[]>();
  for(const placement of reviewSchedule.placements)
    reviewsByDate.set(placement.date,[...(reviewsByDate.get(placement.date)||[]),placement]);
  const horizonEnd=addCalendarDays(args.startDate,Math.max(0,args.days-1));
  const activeReviewProblemIds=new Set(allActiveReviews.filter(review=>String(review.earliest_date||review.due_date)<=horizonEnd)
    .map(review=>review.problem_id));
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
  const makePast=(date:string,kind:"past_exam"|"scan5"|"timed",minutes:number,reason:string)=>{
    const selected=choosePastExam({catalog:args.catalog,daysRemaining:args.daysRemaining,used:usedPast,date,
      attempts:args.attempts,weaknesses:args.weaknesses,avoidProblemIds:activeReviewProblemIds,
      pastSessions:args.pastSessions,kind,usedSessionYears});
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
    const sessionLabel=selected.planningTaskType==="timed_three_question_session"?`${selected.year}年 5問scan→3問選択→3問timed`:
      selected.planningTaskType==="simulation"?`${selected.year}年 本番simulation（5問scan・3問90分）`:
      kind==="scan5"?`${selected.year}年 ${selected.cleanSelectionEvidence?"clean":"practice"} scan5・3問選択`:`${selected.year}年問${selected.questionNumber}`;
    return task({date,slot:"score_building",kind,label:sessionLabel,
      referenceProblemId:selected.referenceProblemId,problemId:selected.canonicalProblemId,minutes,
      reason:`${reason}・${purposeLabel}`,purpose,purposeLabel,basis,exposure:selected.exposure,
      previousEventDate:latest?.date,simulationProtected:selected.simulationProtected,requiresUserSelection:false,
      pastExamTaskType:selected.planningTaskType,pastExamYear:selected.year,
      sessionProblemIds:selected.sessionProblemIds,cleanSelectionEvidence:selected.cleanSelectionEvidence,
      todayCategory:"exam_practice",whyToday:"初見・選題・時間内完遂・別問題への転移を測るため"});
  };
  let materialConfirmationPlanned=false;
  for(let offset=0;offset<args.days;offset++){
    const date=addCalendarDays(args.startDate,offset),weekday=offset%7;
    if(offset>0&&offset%7===0)weekActual={chapter5:0,chapter7:0,chapter8:0,scan5:0,fullOrTimed:0,pastExam:0};
    // 最低枠は7日単位で評価するため、境界をまたぐ週は週初めのphaseで一貫させる。
    // 日次強制ではなく7〜14日配分を正本とし、次週から新phaseへ切り替える。
    const phase=phaseName(Math.max(0,args.daysRemaining-Math.floor(offset/7)*7));
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
      if(weekday===0)score=makePast(date,"timed",90,"5問scan・3問選択・3問答案を一つの本番型sessionで実施");
      else if([2,4].includes(weekday))score=makePast(date,"past_exam",35,"未見・過去問で得点形成とtransferを測定");
      else if(weekday===6)score=makePast(date,"scan5",10,"clean selection evidenceを確保");
      else score=makeWhitebook(date,[2,4,5,6,7,8],"skeleton","過去問で確認された高価値targetだけを局所補修","score_building",true);
    }else{
      score=makePast(date,weekday===0||weekday===4?"timed":weekday===2?"scan5":"past_exam",
        weekday===0||weekday===4?90:weekday===2?10:35,"本番形式・3題選択・確認済み弱点を主軸に固定");
    }
    const tasks:SlotTask[]=(reviewsByDate.get(date)||[]).map(placement=>task({date,slot:"repair",kind:"review",
      label:`${placement.review.problem_id} 局所補修`,problemId:placement.review.problem_id,reviewId:placement.review.id,
      mode:placement.review.grading_contract?.mode||placement.review.effective_mode||placement.review.inferred_mode||"check",
      minutes:placement.minutes,reason:placement.status==="overdue_recovery"?"期限超過Reviewを最優先で回収":"復習ウィンドウ内に配置",
      requiresUserSelection:false,todayCategory:"repair",whyToday:reviewDecisions.get(placement.review.id)?.reason,
      reviewPlanningTier:reviewDecisions.get(placement.review.id)?.tier,
      reviewEarliestDate:placement.earliestDate,reviewPreferredDate:placement.preferredDate,
      reviewLatestDate:placement.latestDate,reviewScheduleStatus:placement.status}));
    if(score?.kind==="exposure_confirmation"){
      if(!materialConfirmationPlanned)tasks.push(score);
      materialConfirmationPlanned=true;
      score=makeWhitebook(date,[2,4,5,6,7,8],"skeleton","露出確認待ちの間も得点形成を止めない");
    }
    if(score&&tasks.reduce((sum,row)=>sum+row.minutes,0)+score.minutes<=args.targetMinutes)tasks.push(score);
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
  return {days:result,reviewSchedule};
}

function weeklyActual(args:{startDate:string;attempts:Attempt[];pastSessions:PastSession[];problems:Problem[]}){
  const start=addCalendarDays(args.startDate,-6),problemMap=new Map(args.problems.map(problem=>[problem.problem_id,problem]));
  const attempts=args.attempts.filter(attempt=>attempt.date>=start&&attempt.date<=args.startDate);
  const sessions=args.pastSessions.filter(session=>String(session.date)>=start&&String(session.date)<=args.startDate);
  return {
    chapter5:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===5).length,
    chapter7:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===7).length,
    chapter8:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===8).length,
    scan5:sessions.filter(session=>["scan_only","scan_plus_one","selected_three_timed"].includes(String(session.session_kind))).length,
    fullOrTimed:attempts.filter(attempt=>attempt.mode==="full"||attempt.exam_score_eligible).length+
      sessions.filter(session=>session.session_kind==="selected_three_timed").length,
    pastExam:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.category==="past_exam").length+
      sessions.filter(session=>["scan_only","scan_plus_one","selected_three_timed"].includes(String(session.session_kind))).length
  };
}

export function buildAdaptivePlannerShadow(args:{
  record?:StoredExamReferencePack|null;catalog:ExamReferenceCatalogItem[];weaknesses:ConceptWeaknessInsight[];
  problems:Problem[];attempts:Attempt[];reviews:Review[];pastSessions:PastSession[];
  currentTasks:Task[];today:string;examDate:string;targetMinutes:number;
}):AdaptivePlannerShadow{
  const daysRemaining=daysUntilExam(args.today,args.examDate),phase=phaseName(daysRemaining),generatedAt=new Date().toISOString();
  const empty=validateMinimums(planSummary([]),daysRemaining,args.targetMinutes);
  if(!args.record)return {available:false,mode:"unavailable",generatedAt,phase,daysRemaining,targetMinutes:args.targetMinutes,
    plan14:empty,plan30:empty,legacy30:{scan5:0,full:0,timed:0,totalTasks:0},
    comparisonReasons:["正規化済み参照パックを取り込むと計画を生成できます。"],
    activationEligible:false,activationBlockers:["参照パック未登録"],weeklyTarget:{},weeklyActual:{},phaseDiagnostics:[]};
  const planned14=planDays({...args,startDate:args.today,days:14,daysRemaining});
  const planned30=planDays({...args,startDate:args.today,days:30,daysRemaining});
  const plan14=validateMinimums(planSummary(planned14.days,planned14.reviewSchedule),daysRemaining,args.targetMinutes);
  const plan30=validateMinimums(planSummary(planned30.days,planned30.reviewSchedule),daysRemaining,args.targetMinutes);
  const legacy=simulateThirtyDays({startDate:args.today,tasks:args.currentTasks,problems:args.problems,targetMinutes:args.targetMinutes,
    pastSessions:args.pastSessions as unknown as Array<Record<string,unknown>>});
  const policy=phasePolicy(args.record,daysRemaining),weekly=weeklyActual({startDate:args.today,attempts:args.attempts,pastSessions:args.pastSessions,problems:args.problems});
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
  return {available:true,mode:"active",generatedAt,phase,daysRemaining,targetMinutes:args.targetMinutes,plan14,plan30,
    legacy30:{scan5:legacy.purposeCounts.scan5,full:legacy.purposeCounts.fullSkeleton,
      timed:legacy.purposeCounts.timedFull,totalTasks:args.currentTasks.length},
    comparisonReasons:[
      legacy.purposeCounts.scan5===0&&plan30.counts.scan5>0?"現行30日では0件のscan5を週最低枠で補完":"scan5実績を比較",
      legacy.purposeCounts.timedFull===0&&plan30.counts.timed>0?"現行30日では0件のtimedを日付フェーズで補完":"timed実績を比較",
      "Reviewは日付窓と分単位repair budgetで配置し、期限超過とlatest超過リスクを優先",
      "露出metadata未設定かつ実施履歴なしのverified素材は、保存値を変えずunseen候補として選択"
    ],activationEligible:blockers.length===0,activationBlockers:blockers,
    weeklyTarget:{phase,
      minimums:JSON.stringify((policy as Record<string,unknown>).minimums_per_7_days||{}),
      targetMix:JSON.stringify((policy as Record<string,unknown>).target_mix||{})},
    weeklyActual:weekly,phaseDiagnostics};
}
