export type ProgressPhase="foundation"|"integration"|"past_practice"|"final";
export type ProgressCheck={label:string;detail:string;status:"ok"|"warning"|"pending"};
export type ProgressMetrics={
  a14:number;sCore14:number;aPlus14:number;criticalSStable:number;criticalSTotal:number;
  past14:number;pastFull14:number;pastSkeleton14:number;scan14:number;exam14:number;kRepeat:number;
  skeletonCount:number;skeletonRate:number;studyDays14:number;actualMinutes14:number;
  delayed3:number;dailyTargetMinutes:number;
};

export const EXAM_PHASES=[
  {from:100,to:999,title:"S再固定＋A+着手",allocation:"S 35%・A+ 40%・過去問 25%",summary:"第6章→第4章→第2章。SS/Sの型を再固定し、第6章S21・S22を白紙から答案化できる状態にします。"},
  {from:60,to:99,title:"A+補強期",allocation:"S 35%・A+ 40%・過去問 25%",summary:"第5章→第7章→第3章。順序統計、exact・MP検定、対数正規・パレートを補強します。"},
  {from:25,to:59,title:"過去問主軸期",allocation:"S 20%・A+補修 30%・過去問 50%",summary:"2024→2025→2022→2023の順。各年3問をフル答案、2問を骨格で回します。"},
  {from:0,to:24,title:"弱点補修＋本番シミュレーション",allocation:"S 20%・A+補修 30%・過去問 50%",summary:"新規範囲を広げず、章別A+へ戻って補修します。本番90分シミュレーションを最低3回行います。"}
] as const;

export function daysUntilExam(today:string,examDate:string,fallback=140){
  if(!examDate) return fallback;
  const start=new Date(`${today}T12:00:00`).getTime(),end=new Date(`${examDate}T12:00:00`).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)) return fallback;
  return Math.max(0,Math.ceil((end-start)/86400000));
}

export function phaseForDays(days:number):ProgressPhase{
  if(days>99) return "foundation";
  if(days>59) return "integration";
  if(days>24) return "past_practice";
  return "final";
}

export function buildProgressPlan(days:number,metrics:ProgressMetrics){
  const phase=phaseForDays(days);
  const phaseDefinition=EXAM_PHASES.find(item=>days>=item.from&&days<=item.to)??EXAM_PHASES.at(-1)!;
  const skeletonStatus=metrics.skeletonCount===0?"pending":metrics.skeletonRate>=80?"ok":"warning";
  const expectedMinutes=metrics.dailyTargetMinutes*14;
  const timeStatus=metrics.actualMinutes14===0?"pending":metrics.actualMinutes14>=expectedMinutes*.9&&metrics.studyDays14>=12?"ok":"warning";
  const common:ProgressCheck[]=[
    {label:"復習遅延",detail:metrics.delayed3===0?"3日超の遅延なし":`${metrics.delayed3}件が3日超過`,status:metrics.delayed3===0?"ok":"warning"},
    {label:"K再発",detail:`同一問題での再発 ${metrics.kRepeat}題／目安2題以内`,status:metrics.kRepeat<=2?"ok":"warning"},
    {label:"学習時間の記録",detail:metrics.actualMinutes14?`2週間 ${metrics.actualMinutes14}分・${metrics.studyDays14}日／目安${expectedMinutes}分`:"採点YAMLのtime_minutes蓄積待ち",status:timeStatus}
  ];
  const phaseChecks:ProgressCheck[]=phase==="foundation"?[
    {label:"SS/S再固定",detail:`2週間 ${metrics.sCore14}題／目安8題以上`,status:metrics.sCore14===0?"pending":metrics.sCore14>=8?"ok":"warning"},
    {label:"A+着手",detail:`2週間 ${metrics.aPlus14}題／目安5題以上`,status:metrics.aPlus14===0?"pending":metrics.aPlus14>=5?"ok":"warning"},
    {label:"第6章S21・S22",detail:metrics.criticalSTotal?`${metrics.criticalSStable}/${metrics.criticalSTotal}題が○以上`:"採点記録待ち",
      status:metrics.criticalSTotal===0?"pending":metrics.criticalSStable===2?"ok":"warning"},
    {label:"過去問の軽い接続",detail:metrics.past14?`2週間 ${metrics.past14}問（現段階では必須にしない）`:"残り59日までは未実施でも減点せず、必須にしない",
      status:metrics.past14?"ok":"pending"}
  ]:phase==="integration"?[
    {label:"S維持",detail:`2週間 ${metrics.sCore14}題／目安5題以上`,status:metrics.sCore14===0?"pending":metrics.sCore14>=5?"ok":"warning"},
    {label:"A+補強",detail:`2週間 ${metrics.aPlus14}題／目安8題以上`,status:metrics.aPlus14===0?"pending":metrics.aPlus14>=8?"ok":"warning"},
    {label:"骨格再現率",detail:metrics.skeletonCount?`${metrics.skeletonRate}%／目安80%以上`:"骨格モードの採点待ち",status:skeletonStatus}
  ]:phase==="past_practice"?[
    {label:"過去問主軸",detail:`2週間 ${metrics.past14}問／目安5問以上`,status:metrics.past14>=5?"ok":"warning"},
    {label:"答案配分",detail:`フル${metrics.pastFull14}問・骨格${metrics.pastSkeleton14}問／目安3＋2`,status:metrics.pastFull14>=3&&metrics.pastSkeleton14>=2?"ok":"warning"},
    {label:"A+/Sへの戻り",detail:`A+補修${metrics.aPlus14}題・S確認${metrics.sCore14}題`,status:metrics.aPlus14>=2&&metrics.sCore14>=2?"ok":"warning"}
  ]:[
    {label:"本番シミュレーション",detail:`2週間 ${metrics.exam14}回／目安2回以上`,status:metrics.exam14>=2?"ok":"warning"},
    {label:"新規より弱点補修",detail:`A+補修${metrics.aPlus14}題・S確認${metrics.sCore14}題`,status:metrics.aPlus14>=2&&metrics.sCore14>=2?"ok":"warning"},
    {label:"骨格再現率",detail:metrics.skeletonCount?`${metrics.skeletonRate}%／目安80%以上`:"骨格モードの採点待ち",status:skeletonStatus}
  ];
  const checks=[...phaseChecks,...common];
  const evaluated=checks.filter(item=>item.status!=="pending");
  const warningCount=evaluated.filter(item=>item.status==="warning").length;
  const insufficientEvidence=metrics.studyDays14<3&&(metrics.sCore14+metrics.aPlus14+metrics.past14)<3;
  const label=insufficientEvidence?"判定保留":metrics.delayed3>=2||metrics.kRepeat>2||warningCount>=3?"危険":warningCount>=1?"注意":"合格ペース";
  const nextPhase=phase==="foundation"?"残り99日から第5章→第7章→第3章A+へ":
    phase==="integration"?"残り59日から2024→2025→2022→2023の過去問主軸へ":
    phase==="past_practice"?"残り24日から新規を止め、弱点補修と本番シミュへ":
    "本番まで新規範囲を広げず、最低3回の90分演習";
  const suggestion=label==="判定保留"?"採点記録が3日分ほど集まると、現在フェーズに対する進み方を判定できます。"
    :label==="危険"
    ?"新規A問題を減らし、期限切れ復習とK/Nの復旧を先に処理してください。"
    :label==="注意"?"未達項目を1つだけ今週の重点にしてください。":"現在の配分を維持してください。";
  const dangerCriteria=[
    "3日超の復習遅延が2件以上",
    "同一問題でKが再発した問題が3題以上",
    "現在フェーズの判定可能項目で未達が3項目以上"
  ];
  return {phase,phaseLabel:phaseDefinition.title,summary:phaseDefinition.summary,allocation:phaseDefinition.allocation,nextPhase,checks,label,suggestion,dangerCriteria,daysRemaining:days};
}
