import type {CoachDiagnosisState,ConceptWeaknessInsight,DashboardKpiProjection,DashboardKpiValue,Task} from "./types.ts";

type Readiness={
  unseenScoreRate:number|null;timedCompletionRate:number|null;selectionSuccessRate:number|null;pastExamScoreRate:number|null;
  sampleSizes:{unseen:number;timed:number;scans:number;selectionPending?:number;pastExams:number;kReviews:number;wReviews:number};
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

function passJudgementMeaning(value:string){
  if(value.includes("判定材料不足"))return "本番形式の実測が足りない状態です。";
  if(value.includes("安定合格圏"))return "複数年度・複数sessionで、余裕を持って必要点を再現できています。";
  if(value==="合格圏")return "複数の本番形式で必要点を再現できています。";
  if(value.includes("境界圏")||value.includes("ボーダー域"))return "合格点へ届く可能性はありますが、再現がまだ不安定です。";
  if(value.includes("境界手前")||value.includes("ボーダー手前"))return "知識・既習能力はありますが、本番での再現性が不足しています。";
  return "本番形式の得点・完遂・選題証拠から現在位置を判断します。";
}

export function deriveDashboardKpis(input:DashboardKpiInput):DashboardKpiProjection{
  const r=input.readiness,directEvidence=localExamEvidence(r),transferEvidence=input.concepts.reduce((sum,row)=>sum+row.transferSuccesses,0);
  const total=directEvidence+transferEvidence,freshCoach=input.coach.source==="gpt"&&!input.coach.stale;
  const timedMeasured=measured(r.sampleSizes.timed),pastMeasured=measured(r.sampleSizes.pastExams);
  const unseenMeasured=measured(r.sampleSizes.unseen),selectionMeasured=measured(r.sampleSizes.scans);
  const readinessDetail=`過去問得点 ${pct(r.pastExamScoreRate)}・時間内完走 ${pct(r.timedCompletionRate)}${r.sampleSizes.timed<3&&r.sampleSizes.timed?"（標本少）":""}・選題精度 ${pct(r.selectionSuccessRate)}・転移成功 ${transferEvidence}件`;
  const missingEvidence:string[]=[];
  if(r.sampleSizes.pastExams<3)missingEvidence.push(`過去問答案 ${r.sampleSizes.pastExams}/3件`);
  if(r.sampleSizes.timed<2)missingEvidence.push(`3問timed session ${r.sampleSizes.timed}/2件`);
  if(!r.sampleSizes.scans)missingEvidence.push(Number(r.sampleSizes.selectionPending||0)>0?"選択した3問の採点":"clean scan5と選択3問の実得点");
  if(transferEvidence<2)missingEvidence.push(`別問題transfer ${transferEvidence}/2件`);
  const nextEvidenceAction=!r.sampleSizes.scans&&Number(r.sampleSizes.selectionPending||0)>0?"scan5で選んだ3問を採点する":
    !r.sampleSizes.scans?"完全未見年度でscan5＋3問答案を実施する":r.sampleSizes.timed<2?
      "5問scanから3問を選び90分で答案化する":r.sampleSizes.pastExams<3?
        "未実施の過去問を答案化して採点する":"別問題で同じ能力のtransferを確認する";
  const examReadiness:DashboardKpiValue={value:directEvidence<3?"本番証拠を蓄積中":pastMeasured&&Number(r.pastExamScoreRate)>=70?"合格答案を形成中":"本番証拠を蓄積中",
    detail:readinessDetail,source:transferEvidence?"exam_and_transfer_evidence":"exam_evidence",evidenceCount:total,freshness:directEvidence<3?"measuring":"current",
    confidence:directEvidence>=6?"high":directEvidence>=3?"medium":"low",updatedAt:input.updatedAt,
    missingEvidence:missingEvidence.slice(0,3),nextEvidenceAction};

  let passZoneValue="判定材料不足",passSource="insufficient_evidence",passConfidence:"low"|"medium"|"high"="low",passCount=total;
  if(freshCoach&&input.coach.display.level.confidence!=="low"){
    passZoneValue=input.coach.display.level.passOutlook||"判定材料不足";passSource="fresh_coach";
    passConfidence=input.coach.display.level.confidence;passCount=Math.max(1,total);
  }else if(pastMeasured&&timedMeasured){
    const score=Number(r.pastExamScoreRate),timed=Number(r.timedCompletionRate);
    passZoneValue=score>=75&&timed>=70?"合格圏":score>=60&&timed>=55?"境界圏":"合格圏まで距離あり";
    passSource="exam_evidence";passConfidence="medium";
  }
  const selectionEvidence=Number(r.sampleSizes.selectionPending||0)>0&&!r.sampleSizes.scans
    ?"選題精度 未評価（選択3問の採点待ち）"
    :`選題精度 ${pct(r.selectionSuccessRate)}${r.sampleSizes.scans?`（${r.sampleSizes.scans}件）`:""}`;
  const passEvidenceReasons=[
    `過去問得点 ${pct(r.pastExamScoreRate)}${r.sampleSizes.pastExams?`（${r.sampleSizes.pastExams}件）`:""}`,
    `時間内完遂 ${pct(r.timedCompletionRate)}${r.sampleSizes.timed?`（${r.sampleSizes.timed}件）`:""}`,
    selectionEvidence,
  ];
  const passActions:string[]=[];
  if(Number(r.sampleSizes.selectionPending||0)>0&&!r.sampleSizes.scans)passActions.push("scan5で選択した3問を答案化し、実際の得点まで確認する");
  else if(!r.sampleSizes.scans)passActions.push("完全未見年度でscan5を行い、選択した3問を採点する");
  if(r.sampleSizes.timed<2)passActions.push("完全未見年度でscan5＋3問timedを2回まで積み上げる");
  if(r.sampleSizes.pastExams<3)passActions.push("未実施の過去問を時間内に答案化して採点する");
  if(transferEvidence<2)passActions.push("別問題・過去問で同じ能力のtransferを確認する");
  if(!passActions.length)passActions.push("別年度の本番形式でも必要点を再現する");
  const passZone={value:passZoneValue,detail:freshCoach?`GPT診断・信頼度 ${input.coach.display.level.confidence}`:"本番形式の実測を優先",
    source:passSource,evidenceCount:passCount,freshness:(freshCoach?"current":input.coach.source==="gpt"?"stale":"measuring") as "current"|"stale"|"measuring",
    confidence:passConfidence,updatedAt:input.updatedAt,
    missingEvidence:passZoneValue==="判定材料不足"?missingEvidence.slice(0,3):[],
    nextEvidenceAction:passActions[0],evidenceReasons:passEvidenceReasons.slice(0,3),
    nextEvidenceActions:passActions.slice(0,2),meaning:passJudgementMeaning(passZoneValue)};

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
