import type {CoachDiagnosisState,ConceptWeaknessInsight,DashboardKpiProjection,DashboardKpiValue,Task} from "./types.ts";

type Readiness={
  unseenScoreRate:number|null;timedCompletionRate:number|null;selectionSuccessRate:number|null;pastExamScoreRate:number|null;
  sampleSizes:{unseen:number;timed:number;scans:number;pastExams:number;kReviews:number;wReviews:number};
};
type CoachInput=Pick<CoachDiagnosisState,"source"|"stale"|"newAttemptCount"|"lastReviewedAt">&{
  display:{level:{value:number;passOutlook:string;confidence:"low"|"medium"|"high"};primaryBottleneck:{title:string}};
};
export type DashboardKpiInput={
  today:string;updatedAt:string;coach:CoachInput;readiness:Readiness;concepts:ConceptWeaknessInsight[];
  currentTask?:Task;daysRemaining:number;phaseLabel:string;pastExamShare:number|null;
  pastExamShareTarget:string;pendingReviews:number;
};

const measured=(count:number)=>count>=3;
const pct=(value:number|null)=>value==null?"未計測":`${Math.round(value)}%`;
const localExamEvidence=(readiness:Readiness)=>readiness.sampleSizes.unseen+readiness.sampleSizes.timed+
  readiness.sampleSizes.scans+readiness.sampleSizes.pastExams;

export function deriveDashboardKpis(input:DashboardKpiInput):DashboardKpiProjection{
  const r=input.readiness,total=localExamEvidence(r),freshCoach=input.coach.source==="gpt"&&!input.coach.stale;
  const timedMeasured=measured(r.sampleSizes.timed),pastMeasured=measured(r.sampleSizes.pastExams);
  const unseenMeasured=measured(r.sampleSizes.unseen),selectionMeasured=measured(r.sampleSizes.scans);
  const readinessDetail=`時間内完走 ${pct(r.timedCompletionRate)}${r.sampleSizes.timed<3&&r.sampleSizes.timed?"（標本少）":""}・過去問得点 ${pct(r.pastExamScoreRate)}`;
  const examReadiness:DashboardKpiValue={value:total<3?"測定中":pastMeasured&&Number(r.pastExamScoreRate)>=70?"合格答案を形成中":"本番証拠を蓄積中",
    detail:readinessDetail,source:"exam_evidence",evidenceCount:total,freshness:total<3?"measuring":"current",
    confidence:total>=6?"high":total>=3?"medium":"low",updatedAt:input.updatedAt};

  let passZoneValue="判定材料不足",passSource="insufficient_evidence",passConfidence:"low"|"medium"|"high"="low",passCount=total;
  if(freshCoach&&input.coach.display.level.confidence!=="low"){
    passZoneValue=input.coach.display.level.passOutlook||"判定材料不足";passSource="fresh_coach";
    passConfidence=input.coach.display.level.confidence;passCount=Math.max(1,total);
  }else if(pastMeasured&&timedMeasured){
    const score=Number(r.pastExamScoreRate),timed=Number(r.timedCompletionRate);
    passZoneValue=score>=75&&timed>=70?"合格圏":score>=60&&timed>=55?"境界圏":"合格圏まで距離あり";
    passSource="exam_evidence";passConfidence="medium";
  }
  const passZone={value:passZoneValue,detail:freshCoach?`GPT診断・信頼度 ${input.coach.display.level.confidence}`:"本番形式の実測を優先",
    source:passSource,evidenceCount:passCount,freshness:(freshCoach?"current":input.coach.source==="gpt"?"stale":"measuring") as "current"|"stale"|"measuring",
    confidence:passConfidence,updatedAt:input.updatedAt};

  let bottleneckValue="本番形式の測定中",bottleneckDetail="過去問・timed・scan5の証拠を増やす",bottleneckSource="insufficient_evidence";
  let bottleneckCount=total,bottleneckConfidence:"low"|"medium"|"high"="low";
  if(timedMeasured&&Number(r.timedCompletionRate)<60){
    bottleneckValue="時間内完走の再現性";bottleneckDetail=`時間内完走 ${pct(r.timedCompletionRate)}（${r.sampleSizes.timed}件）`;
    bottleneckSource="timed_evidence";bottleneckCount=r.sampleSizes.timed;bottleneckConfidence="high";
  }else if(selectionMeasured&&Number(r.selectionSuccessRate)<60){
    bottleneckValue="5問から3問を選ぶ判断";bottleneckDetail=`選題成功 ${pct(r.selectionSuccessRate)}（${r.sampleSizes.scans}件）`;
    bottleneckSource="selection_evidence";bottleneckCount=r.sampleSizes.scans;bottleneckConfidence="high";
  }else if(pastMeasured&&Number(r.pastExamScoreRate)<60){
    bottleneckValue="過去問での得点形成";bottleneckDetail=`過去問得点 ${pct(r.pastExamScoreRate)}（${r.sampleSizes.pastExams}件）`;
    bottleneckSource="past_exam_evidence";bottleneckCount=r.sampleSizes.pastExams;bottleneckConfidence="high";
  }else if(unseenMeasured&&Number(r.unseenScoreRate)<60){
    bottleneckValue="未見問題での得点形成";bottleneckDetail=`未見得点 ${pct(r.unseenScoreRate)}（${r.sampleSizes.unseen}件）`;
    bottleneckSource="unseen_evidence";bottleneckCount=r.sampleSizes.unseen;bottleneckConfidence="high";
  }else if(freshCoach&&input.coach.display.level.confidence!=="low"){
    bottleneckValue=input.coach.display.primaryBottleneck.title||bottleneckValue;bottleneckDetail="最新のGPTコーチ診断";
    bottleneckSource="fresh_coach";bottleneckCount=Math.max(1,total);bottleneckConfidence=input.coach.display.level.confidence;
  }else{
    const recurring=[...input.concepts].filter(row=>row.distinctProblemCount>=2&&row.independentFailures>=2)
      .sort((a,b)=>b.priorityScore-a.priorityScore)[0];
    if(recurring){bottleneckValue=recurring.displayName;bottleneckDetail=recurring.nextRecommendedAction;
      bottleneckSource="concept_evidence";bottleneckCount=recurring.independentFailures;bottleneckConfidence=recurring.evidenceConfidence;}
  }
  const bottleneck:DashboardKpiValue={value:bottleneckValue,detail:bottleneckDetail,source:bottleneckSource,evidenceCount:bottleneckCount,
    freshness:"current",confidence:bottleneckConfidence,updatedAt:input.updatedAt};
  const task=input.currentTask;
  const nextAction={value:task?`${task.problem_id}｜${task.title}`:"本日の確定課題は完了",detail:task?`${task.reason}・${task.minutes}分`:"次の計画を確認してください",
    source:"current_today",evidenceCount:task?1:0,freshness:"current" as const,confidence:"high" as const,updatedAt:input.updatedAt,
    ...(task?{problemId:task.problem_id,minutes:task.minutes}:{})};
  return {examReadiness,passZone,bottleneck,nextAction,support:{daysRemaining:input.daysRemaining,phaseLabel:input.phaseLabel,
    pastExamShare:input.pastExamShare,pastExamShareTarget:input.pastExamShareTarget,pendingReviews:input.pendingReviews}};
}
