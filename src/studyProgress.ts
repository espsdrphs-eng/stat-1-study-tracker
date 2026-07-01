export type ProgressPhase="foundation"|"integration"|"past_practice"|"answer_training"|"final";
export type ProgressCheck={label:string;detail:string;status:"ok"|"warning"|"pending"};
export type ProgressMetrics={
  a14:number;past14:number;scan14:number;exam14:number;kRepeat:number;
  skeletonCount:number;skeletonRate:number;studyDays14:number;actualMinutes14:number;
  delayed3:number;dailyTargetMinutes:number;
};

export const EXAM_PHASES=[
  {from:121,to:999,title:"基礎・A問題定着期",summary:"A問題とK/N復旧が主役。過去問は未着手でも問題なく、月1回の5問スキャンは任意です。"},
  {from:91,to:120,title:"A問題統合・過去問導入期",summary:"A問題を進めながら、2週間に1問だけ過去問の骨格を確認します。"},
  {from:61,to:90,title:"過去問骨格期",summary:"2週間に過去問2問以上。5問スキャンを週1回入れ、落とした型をA/Sへ戻します。"},
  {from:31,to:60,title:"答案化・時間配分期",summary:"90分演習を2週間に1回以上行い、完走数と時間配分を測ります。"},
  {from:0,to:30,title:"本番シミュレーション期",summary:"90分演習を週1回以上。新規範囲を広げず、K問題と選題ミスを優先補修します。"}
] as const;

export function daysUntilExam(today:string,examDate:string,fallback=140){
  if(!examDate) return fallback;
  const start=new Date(`${today}T12:00:00`).getTime(),end=new Date(`${examDate}T12:00:00`).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)) return fallback;
  return Math.max(0,Math.ceil((end-start)/86400000));
}

export function phaseForDays(days:number):ProgressPhase{
  if(days>120) return "foundation";
  if(days>90) return "integration";
  if(days>60) return "past_practice";
  if(days>30) return "answer_training";
  return "final";
}

export function buildProgressPlan(days:number,metrics:ProgressMetrics){
  const phase=phaseForDays(days);
  const phaseDefinition=EXAM_PHASES.find(item=>days>=item.from&&days<=item.to)??EXAM_PHASES.at(-1)!;
  const skeletonStatus=metrics.skeletonCount===0?"pending":metrics.skeletonRate>=80?"ok":"warning";
  const expectedMinutes=metrics.dailyTargetMinutes*14;
  const timeStatus=metrics.actualMinutes14===0?"pending":metrics.actualMinutes14>=expectedMinutes*.9&&metrics.studyDays14>=12?"ok":"warning";
  const common:ProgressCheck[]=[
    {label:"A問題進捗",detail:`2週間 ${metrics.a14}題／目安10〜14題`,status:metrics.a14>=10&&metrics.a14<=16?"ok":"warning"},
    {label:"復習遅延",detail:metrics.delayed3===0?"3日超の遅延なし":`${metrics.delayed3}件が3日超過`,status:metrics.delayed3===0?"ok":"warning"},
    {label:"K再発",detail:`同一問題での再発 ${metrics.kRepeat}題／目安2題以内`,status:metrics.kRepeat<=2?"ok":"warning"},
    {label:"骨格再現率",detail:metrics.skeletonCount?`${metrics.skeletonRate}%／目安80%以上`:"骨格モードの採点待ち",status:skeletonStatus},
    {label:"学習時間の記録",detail:metrics.actualMinutes14?`2週間 ${metrics.actualMinutes14}分・${metrics.studyDays14}日／目安${expectedMinutes}分`:"採点YAMLのtime_minutes蓄積待ち",status:timeStatus}
  ];
  const pastCheck:ProgressCheck=phase==="foundation"
    ?{label:"過去問",detail:"この段階では必須にしない（月1回の5問スキャンは任意）",status:"ok"}
    :phase==="integration"
      ?{label:"過去問導入",detail:`2週間 ${metrics.past14}問／目安1問`,status:metrics.past14>=1?"ok":"warning"}
      :phase==="past_practice"
        ?{label:"過去問骨格",detail:`2週間 ${metrics.past14}問・スキャン${metrics.scan14}回`,status:metrics.past14>=2&&metrics.scan14>=1?"ok":"warning"}
        :phase==="answer_training"
          ?{label:"90分答案",detail:`2週間 ${metrics.exam14}回／目安1回以上`,status:metrics.exam14>=1?"ok":"warning"}
          :{label:"本番シミュレーション",detail:`2週間 ${metrics.exam14}回／目安2回以上`,status:metrics.exam14>=2?"ok":"warning"};
  const checks=[...common,pastCheck];
  const evaluated=checks.filter(item=>item.status!=="pending");
  const rate=evaluated.length?evaluated.filter(item=>item.status==="ok").length/evaluated.length:0;
  const label=rate>=.8?"合格ペース":rate>=.55?"注意":"危険";
  const nextPhase=phase==="foundation"?"残り120日から過去問を2週間に1問導入":
    phase==="integration"?"残り90日から過去問骨格を2週間に2問":
    phase==="past_practice"?"残り60日から90分答案を開始":
    phase==="answer_training"?"残り30日から週1回の本番シミュレーション":
    "本番まで新規範囲を広げず、失点型を補修";
  const suggestion=label==="危険"
    ?"新規A問題を減らし、期限切れ復習とK/Nの復旧を先に処理してください。"
    :label==="注意"?"未達項目を1つだけ今週の重点にしてください。":"現在の配分を維持してください。";
  return {phase,phaseLabel:phaseDefinition.title,summary:phaseDefinition.summary,nextPhase,checks,label,suggestion,daysRemaining:days};
}
