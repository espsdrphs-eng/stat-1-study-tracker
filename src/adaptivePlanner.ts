import type {
  AdaptivePlanDay, AdaptivePlanSummary, AdaptivePlannerShadow, Attempt, ConceptWeaknessInsight,
  ExamReferenceCatalogItem, PastSession, Problem, Review, Task
} from "./types.ts";
import type { StoredExamReferencePack } from "./examReferencePack.ts";
import { addCalendarDays } from "./reviewSchedulePolicy.ts";
import { daysUntilExam } from "./studyProgress.ts";
import { reviewExecutionState } from "./integrityEngine.ts";
import { simulateThirtyDays } from "./learningSimulation.ts";

type SlotTask=AdaptivePlanDay["tasks"][number];
const unique=<T,>(values:T[])=>[...new Set(values)];
const attemptedDateMap=(attempts:Attempt[])=>{
  const map=new Map<string,string>();
  for(const attempt of attempts)if(!map.get(attempt.problem_id)||map.get(attempt.problem_id)!<attempt.date)map.set(attempt.problem_id,attempt.date);
  return map;
};
const isNewWhitebook=(problem:Problem,attempted:Map<string,string>)=>!attempted.has(problem.problem_id);
const modeMinutes=(mode:string)=>mode==="full"?35:mode==="main_calc"?20:mode==="skeleton"?15:5;

function phaseName(daysRemaining:number){
  if(daysRemaining>=91)return "foundation_to_A";
  if(daysRemaining>=61)return "A_and_past_parallel";
  if(daysRemaining>=31)return "past_exam_main";
  return "final_stabilization";
}

function phasePolicy(record:StoredExamReferencePack|undefined|null,daysRemaining:number){
  const phases=record?.data.plannerPolicy.phases||[];
  return phases.find(row=>daysRemaining>=Number(row.days_remaining_min)&&daysRemaining<=Number(row.days_remaining_max))||{};
}

function chooseWhitebook(args:{
  problems:Problem[];attempts:Attempt[];chapters:number[];used:Map<string,string>;date:string;
  allowNew:boolean;mode:"skeleton"|"full";
}){
  const attempted=attemptedDateMap(args.attempts);
  const rows=args.problems.filter(problem=>problem.category==="A"&&args.chapters.includes(Number(problem.chapter))&&
    !["review_needed","metadata_review_needed"].includes(String(problem.metadata_status||""))&&
    (args.allowNew||!isNewWhitebook(problem,attempted)))
    .sort((a,b)=>{
      const rank=(value?:string)=>value==="A+"?0:value==="A"?1:2;
      const recentlyA=args.used.get(a.problem_id),recentlyB=args.used.get(b.problem_id);
      const blockedA=recentlyA&&recentlyA>addCalendarDays(args.date,-7)?1:0;
      const blockedB=recentlyB&&recentlyB>addCalendarDays(args.date,-7)?1:0;
      return blockedA-blockedB||rank(a.strategy_rank)-rank(b.strategy_rank)||
        String(attempted.get(a.problem_id)||"").localeCompare(String(attempted.get(b.problem_id)||""))||
        a.problem_id.localeCompare(b.problem_id);
    });
  const selected=rows.find(problem=>!args.used.get(problem.problem_id)||args.used.get(problem.problem_id)!>addCalendarDays(args.date,-7))||rows[0];
  if(selected)args.used.set(selected.problem_id,args.date);
  return selected;
}

function pastRank(exposure:string){
  return exposure==="prompt_scanned"?0:exposure==="partially_attempted"?1:exposure==="fully_attempted"?2:
    exposure==="answer_exposed"?3:exposure==="simulated"?4:exposure==="unseen"?5:9;
}

function choosePastExam(args:{
  catalog:ExamReferenceCatalogItem[];daysRemaining:number;used:Map<string,string>;date:string;
}){
  const rows=args.catalog.filter(row=>row.schedulable&&row.availability==="verified_problem"&&
    row.exposure!=="unknown"&&!(args.daysRemaining>=61&&row.simulationProtected&&["unseen","unknown"].includes(row.exposure)))
    .sort((a,b)=>pastRank(a.exposure)-pastRank(b.exposure)||a.year-b.year||a.questionNumber-b.questionNumber);
  const selected=rows.find(row=>!args.used.get(row.referenceProblemId)||args.used.get(row.referenceProblemId)!>addCalendarDays(args.date,-14));
  if(selected)args.used.set(selected.referenceProblemId,args.date);
  return selected;
}

function task(args:Omit<SlotTask,"taskKey">):SlotTask{
  return {...args,taskKey:[args.date,args.slot,args.kind,args.problemId||args.referenceProblemId||args.conceptId||args.label].join("|")};
}

function planSummary(days:AdaptivePlanDay[]):AdaptivePlanSummary{
  const tasks=days.flatMap(day=>day.tasks),counts={scoreBuilding:0,repair:0,maintenance:0,scan5:0,full:0,timed:0,pastExam:0,chapter5:0,chapter7:0,chapter8:0};
  for(const row of tasks){
    if(row.slot==="score_building")counts.scoreBuilding++;
    if(row.slot==="repair")counts.repair++;
    if(row.slot==="maintenance_selection")counts.maintenance++;
    if(row.kind==="scan5")counts.scan5++;
    if(row.kind==="full")counts.full++;
    if(row.kind==="timed")counts.timed++;
    if(row.kind==="past_exam"||row.kind==="scan5"||row.kind==="timed"&&!!row.referenceProblemId)counts.pastExam++;
    if(row.reason.includes("第5章"))counts.chapter5++;
    if(row.reason.includes("第7章"))counts.chapter7++;
    if(row.reason.includes("第8章"))counts.chapter8++;
  }
  return {days:days.length,plan:days,totalMinutes:days.reduce((sum,day)=>sum+day.totalMinutes,0),counts,
    weeklyMinimumViolations:[],dailyCapacityViolations:0};
}

function validateMinimums(summary:AdaptivePlanSummary,daysRemaining:number,targetMinutes:number){
  const violations:string[]=[];
  for(let start=0;start<summary.plan.length;start+=7){
    const weekRows=summary.plan.slice(start,Math.min(start+7,summary.plan.length));
    if(weekRows.length<7)continue;
    const week=planSummary(weekRows),weekDaysRemaining=Math.max(0,daysRemaining-start);
    if(weekDaysRemaining>=91){
      if(!week.counts.chapter5)violations.push(`${start/7+1}週目: 第5章なし`);
      if(!week.counts.chapter7)violations.push(`${start/7+1}週目: 第7章なし`);
      if(!week.counts.scan5)violations.push(`${start/7+1}週目: scan5なし`);
      if(!week.counts.full&&!week.counts.timed)violations.push(`${start/7+1}週目: full/timedなし`);
    }else if(weekDaysRemaining>=61){
      if(!week.counts.scan5)violations.push(`${start/7+1}週目: scan5なし`);
      if(!week.counts.pastExam)violations.push(`${start/7+1}週目: 過去問なし`);
    }else if(weekDaysRemaining>=31){
      if(!week.counts.timed)violations.push(`${start/7+1}週目: 90分演習なし`);
      const minutes=week.plan.flatMap(day=>day.tasks).reduce((sum,row)=>sum+row.minutes,0);
      const pastMinutes=week.plan.flatMap(day=>day.tasks).filter(row=>["past_exam","scan5","timed"].includes(row.kind)).reduce((sum,row)=>sum+row.minutes,0);
      if(minutes&&pastMinutes/minutes<.5)violations.push(`${start/7+1}週目: 過去問・90分比率50%未満`);
    }
  }
  summary.weeklyMinimumViolations=violations;
  summary.dailyCapacityViolations=summary.plan.filter(day=>day.totalMinutes>targetMinutes).length;
  return summary;
}

function planDays(args:{
  startDate:string;days:number;daysRemaining:number;targetMinutes:number;record?:StoredExamReferencePack|null;
  catalog:ExamReferenceCatalogItem[];problems:Problem[];attempts:Attempt[];reviews:Review[];
  weaknesses:ConceptWeaknessInsight[];
}){
  const result:AdaptivePlanDay[]=[],usedProblems=new Map<string,string>(),usedPast=new Map<string,string>();
  const activeReviews=args.reviews.filter(review=>reviewExecutionState(review,args.startDate)==="actionable")
    .sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id-b.id);
  const usedReviews=new Set<number>();
  const allowNew=args.daysRemaining>30;
  const recentEligibleSuccesses=args.attempts.filter(attempt=>attempt.date>=addCalendarDays(args.startDate,-14)&&
    attempt.exam_score_eligible&&Number(attempt.score_numeric||0)>=70).length;
  const acceleratePast=recentEligibleSuccesses>=2;
  const makeWhitebook=(date:string,chapters:number[],mode:"skeleton"|"full",reason:string,
    slot:SlotTask["slot"]="score_building")=>{
    const problem=chooseWhitebook({problems:args.problems,attempts:args.attempts,chapters,used:usedProblems,date,allowNew,mode});
    return problem?task({date,slot,kind:mode==="full"?"full":"whitebook",
      label:problem.display_label||problem.title,problemId:problem.problem_id,
      minutes:modeMinutes(mode),reason,requiresUserSelection:false}):null;
  };
  const makePast=(date:string,kind:"past_exam"|"scan5"|"timed",minutes:number,reason:string)=>{
    const selected=choosePastExam({catalog:args.catalog,daysRemaining:args.daysRemaining,used:usedPast,date});
    return task({date,slot:"score_building",kind,label:selected?`${selected.year}年問${selected.questionNumber}`:"過去問素材を選択",
      referenceProblemId:selected?.referenceProblemId,problemId:selected?.canonicalProblemId,minutes,reason,
      requiresUserSelection:!selected});
  };
  for(let offset=0;offset<args.days;offset++){
    const date=addCalendarDays(args.startDate,offset),weekday=offset%7;
    // 最低枠は7日単位で評価するため、境界をまたぐ週は週初めのphaseで一貫させる。
    // 日次強制ではなく7〜14日配分を正本とし、次週から新phaseへ切り替える。
    const phase=phaseName(Math.max(0,args.daysRemaining-Math.floor(offset/7)*7));
    let score:SlotTask|null=null,phaseMaintenance:SlotTask|null=null;
    if(phase==="foundation_to_A"){
      if(weekday===5)score=makePast(date,"scan5",50,"scan_plus_oneを週1回確保");
      else if(weekday===6)score=makeWhitebook(date,[2,4,6],"full","得点形成のfull/timedを週1回確保");
      else if(acceleratePast&&weekday===4)score=makePast(date,"past_exam",35,"参照なし本番得点が安定したため過去問を前倒し");
      else score=makeWhitebook(date,[2,4,6],"skeleton","第2・4・6章の得点形成");
      if(weekday===1)phaseMaintenance=makeWhitebook(date,[5],"skeleton","第5章を週1回維持","maintenance_selection");
      if(weekday===3)phaseMaintenance=makeWhitebook(date,[7],"skeleton","第7章を週1回維持","maintenance_selection");
    }else if(phase==="A_and_past_parallel"){
      if(weekday===0)score=makePast(date,"scan5",50,"過去問scan_plus_one");
      else if(weekday===3)score=makePast(date,"past_exam",35,"過去問答案で得点較正");
      else score=makeWhitebook(date,[2,4,6],"full","A問題と過去問を並行");
      if(weekday===1)phaseMaintenance=makeWhitebook(date,[5,7],"skeleton","第5・7章を20〜25%維持","maintenance_selection");
      if(weekday===4)phaseMaintenance=makeWhitebook(date,[8],"skeleton","第8章を20〜25%維持","maintenance_selection");
    }else if(phase==="past_exam_main"){
      if(weekday===0)score=makePast(date,"timed",90,"週1回の3問90分演習");
      else if([2,4,6].includes(weekday))score=makePast(date,weekday===4?"scan5":"past_exam",weekday===4?45:35,"過去問主軸");
      else score=makeWhitebook(date,[2,4,5,6,7,8],"full","過去問で判明した型の答案化");
    }else{
      if(weekday===6)score=makeWhitebook(date,[2,4,5,6,7,8],"full","確認済み弱点の得点安定化");
      else score=makePast(date,weekday===0?"timed":weekday===3?"scan5":"past_exam",weekday===0?90:weekday===3?45:35,"本番形式と選題判断を固定");
    }
    const tasks:SlotTask[]=[];if(score&&score.minutes<=args.targetMinutes)tasks.push(score);
    const review=activeReviews.find(row=>!usedReviews.has(row.id)&&row.due_date<=date);
    if(review&&tasks.reduce((sum,row)=>sum+row.minutes,0)+Number(review.grading_contract?.estimatedMinutes||review.estimated_minutes||5)<=args.targetMinutes){
      const minutes=Number(review.grading_contract?.estimatedMinutes||review.estimated_minutes||5);
      tasks.push(task({date,slot:"repair",kind:"review",label:`${review.problem_id} 局所補修`,problemId:review.problem_id,
        minutes,reason:"期限到来Reviewから最大1件",requiresUserSelection:false}));
      usedReviews.add(review.id);
    }
    if(phaseMaintenance&&tasks.reduce((sum,row)=>sum+row.minutes,0)+phaseMaintenance.minutes<=args.targetMinutes)
      tasks.push(phaseMaintenance);
    const maintenanceConcept=args.weaknesses.find(row=>["transfer_pending","resolved"].includes(row.state)&&
      !tasks.some(item=>item.conceptId===row.conceptId));
    if(!phaseMaintenance&&maintenanceConcept&&tasks.reduce((sum,row)=>sum+row.minutes,0)+10<=args.targetMinutes&&score?.kind!=="scan5"){
      tasks.push(task({date,slot:"maintenance_selection",kind:"review",label:`${maintenanceConcept.displayName} 短時間確認`,
        conceptId:maintenanceConcept.conceptId,minutes:10,reason:"転移・保持の確認",requiresUserSelection:true}));
    }
    result.push({date,tasks,totalMinutes:tasks.reduce((sum,row)=>sum+row.minutes,0)});
  }
  return result;
}

function weeklyActual(args:{startDate:string;attempts:Attempt[];pastSessions:PastSession[];problems:Problem[]}){
  const start=addCalendarDays(args.startDate,-6),problemMap=new Map(args.problems.map(problem=>[problem.problem_id,problem]));
  const attempts=args.attempts.filter(attempt=>attempt.date>=start&&attempt.date<=args.startDate);
  const sessions=args.pastSessions.filter(session=>String(session.date)>=start&&String(session.date)<=args.startDate);
  return {
    chapter5:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===5).length,
    chapter7:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===7).length,
    chapter8:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.chapter===8).length,
    scan5:sessions.filter(session=>!!session.session_kind).length,
    fullOrTimed:attempts.filter(attempt=>attempt.mode==="full"||attempt.exam_score_eligible).length+
      sessions.filter(session=>session.session_kind==="selected_three_timed").length,
    pastExam:attempts.filter(attempt=>problemMap.get(attempt.problem_id)?.category==="past_exam").length+
      sessions.filter(session=>!!session.session_kind).length
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
    comparisonReasons:["正規化済み参照パックを取り込むとshadow比較を開始できます。"],
    activationEligible:false,activationBlockers:["参照パック未登録"],weeklyTarget:{},weeklyActual:{}};
  const plan14=validateMinimums(planSummary(planDays({...args,startDate:args.today,days:14,daysRemaining})),daysRemaining,args.targetMinutes);
  const plan30=validateMinimums(planSummary(planDays({...args,startDate:args.today,days:30,daysRemaining})),daysRemaining,args.targetMinutes);
  const legacy=simulateThirtyDays({startDate:args.today,tasks:args.currentTasks,problems:args.problems,targetMinutes:args.targetMinutes,
    pastSessions:args.pastSessions as unknown as Array<Record<string,unknown>>});
  const policy=phasePolicy(args.record,daysRemaining),weekly=weeklyActual({startDate:args.today,attempts:args.attempts,pastSessions:args.pastSessions,problems:args.problems});
  const shadowDays=Math.max(0,Math.floor((Date.parse(`${args.today}T12:00:00`)-Date.parse(args.record.shadowStartedAt))/86400000));
  const blockers=[
    ...(!args.record.validation.valid?["参照パック検証エラー"]:[]),
    ...(args.record.reconciliation.pastExamConflicts?["過去問master差分の確認待ち"]:[]),
    ...(shadowDays<14?[`shadow観察 ${shadowDays}/14日`]:[]),
    ...(plan14.weeklyMinimumViolations.length||plan14.dailyCapacityViolations?["14日シミュレーションに未達あり"]:[])
  ];
  return {available:true,mode:"shadow",generatedAt,phase,daysRemaining,targetMinutes:args.targetMinutes,plan14,plan30,
    legacy30:{scan5:legacy.purposeCounts.scan5,full:legacy.purposeCounts.fullSkeleton,
      timed:legacy.purposeCounts.timedFull,totalTasks:args.currentTasks.length},
    comparisonReasons:[
      legacy.purposeCounts.scan5===0&&plan30.counts.scan5>0?"現行30日では0件のscan5を週最低枠で補完":"scan5実績を比較",
      legacy.purposeCounts.timedFull===0&&plan30.counts.timed>0?"現行30日では0件のtimedを日付フェーズで補完":"timed実績を比較",
      "期限到来Reviewをrepair枠最大1件に制限し、得点形成枠を保持",
      "unknown exposureは特定年度を未見扱いせず、素材選択確認として提示"
    ],activationEligible:blockers.length===0,activationBlockers:blockers,
    weeklyTarget:{phase,
      minimums:JSON.stringify((policy as Record<string,unknown>).minimums_per_7_days||{}),
      targetMix:JSON.stringify((policy as Record<string,unknown>).target_mix||{})},
    weeklyActual:weekly};
}
