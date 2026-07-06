import type { Attempt, Problem, Review, WeakNote, WeaknessInsight } from "./types.ts";

const errorWeight:Record<string,number>={K:5,N:3,W:2,C:1};
const repairRules:[string,string[],string[]][]=[
  ["AIC・自由度",["WB-6-A-05"],[]],
  ["回帰",["WB-6-A-19","WB-6-A-20"],["WB-6-S-21","WB-6-S-22"]],
  ["Fisher情報量",["WB-6-A-26"],[]],
  ["非正則推定",["WB-6-A-10","WB-6-A-29"],[]],
  ["順序統計量",["WB-5-A-18","WB-5-A-21","WB-5-A-26"],["WB-5-S-13","WB-5-S-17"]],
  ["最小値・最大値",["WB-5-A-18","WB-5-A-26"],["WB-5-S-17"]],
  ["ポアソン条件付き",["WB-4-A-34"],[]],
  ["変数変換",["WB-2-A-24","WB-4-A-26"],["WB-4-S-07"]],
  ["パレート",["WB-3-A-11","WB-3-A-12"],[]],
  ["exact検定",["WB-7-A-04"],["WB-7-S-09"]],
  ["LRT",["WB-7-A-08"],["WB-7-S-10"]],
  ["回帰検定",["WB-7-A-22"],[]],
  ["信頼区間",["WB-8-A-13","WB-8-A-14"],[]]
];

const unique=(values:string[])=>[...new Set(values.filter(Boolean))];
const confidenceFor=(count:number):WeaknessInsight["confidence"]=>count>=15?"分析可能":count>=5?"暫定":"参考";
const errorsFor=(attempt:Attempt)=>unique((attempt.error_types?.length?attempt.error_types:[attempt.primary_error_type||attempt.error_type]).filter(x=>x in errorWeight));

function recommendedProblems(theme:string,problemIds:string[],problems:Problem[]){
  const matchedRules=repairRules.filter(([trigger])=>theme.includes(trigger)||trigger.includes(theme));
  const involved=problems.filter(problem=>problemIds.includes(problem.problem_id));
  const linkedA=involved.flatMap(problem=>String(problem.linked_a_problems||"").split(/[;,、\s]+/));
  const linkedS=involved.flatMap(problem=>[
    ...(problem.related_s_problem_ids||[]),
    ...String(problem.linked_s_problems||"").split(/[;,、\s]+/)
  ]);
  const similar=problems.filter(problem=>problem.theme&&(theme.includes(problem.theme)||problem.theme.includes(theme)));
  return {
    a:unique([...matchedRules.flatMap(([,a])=>a),...linkedA,...similar.filter(p=>p.category==="A").map(p=>p.problem_id)]).slice(0,3),
    s:unique([...matchedRules.flatMap(([,,s])=>s),...linkedS,...similar.filter(p=>p.category==="S").map(p=>p.problem_id)]).slice(0,3)
  };
}

function actionFor(error:string,hasS:boolean){
  if(error==="K") return {action:`${hasS?"関連Sを10分骨格で確認してから、":"出発式と主役統計量を確認して、"}A問題を骨格再現する`,mode:"skeleton",minutes:25,load:.9};
  if(error==="N") return {action:"GPT採点の修正ルールを確認し、途中式を省略せず骨格を再現する",mode:"skeleton",minutes:15,load:.5};
  if(error==="W") return {action:"同じ型のA問題を主要計算だけ再演習する",mode:"main_calc",minutes:20,load:.8};
  return {action:"条件・符号・係数のチェックリストを使って軽く解き直す",mode:"scan",minutes:10,load:.3};
}

export function analyzeWeaknesses(
  problems:Problem[],attempts:Attempt[],reviews:Review[],weakNotes:WeakNote[],today:string
):{confidence:WeaknessInsight["confidence"];attemptCount:number;insights:WeaknessInsight[]}{
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const overdueProblems=new Set(reviews.filter(review=>review.status!=="done"&&review.due_date<today).map(review=>review.problem_id));
  const groups=new Map<string,Attempt[]>();
  for(const attempt of attempts){
    const problem=pmap.get(attempt.problem_id);
    const noteTheme=weakNotes.find(note=>note.problem_id===attempt.problem_id&&note.date===attempt.date&&!note.is_resolved)?.theme;
    const theme=(noteTheme||problem?.theme||"テーマ未設定").trim();
    groups.set(theme,[...(groups.get(theme)||[]),attempt]);
  }
  const confidence=confidenceFor(attempts.length);
  const insights:WeaknessInsight[]=[];
  for(const [theme,rows] of groups){
    const failed=rows.filter(row=>errorsFor(row).length>0||["△","×"].includes(row.mark));
    if(!failed.length) continue;
    const counts:Record<string,number>={K:0,W:0,N:0,C:0};
    let weightedErrors=0;
    for(const row of rows){
      const errors=errorsFor(row);
      const ageDays=Math.max(0,Math.floor((new Date(`${today}T12:00:00`).getTime()-new Date(`${row.date}T12:00:00`).getTime())/86400000));
      const recency=Math.pow(.5,ageDays/45);
      const gradingConfidence=row.grading_confidence==null ? .85 : Math.max(.3,Math.min(1,row.grading_confidence));
      errors.forEach(error=>{counts[error]++;weightedErrors+=errorWeight[error]*recency*gradingConfidence});
      if(row.score_numeric!=null&&row.score_numeric<70) weightedErrors+=.5*recency*gradingConfidence;
    }
    const recurrence=Math.max(0,failed.length-1);
    let score=rows.length?weightedErrors/(5*rows.length)*100:0;
    score+=Math.min(15,Math.max(0,failed.length/rows.length-.5)*30);
    if(rows.some(row=>overdueProblems.has(row.problem_id))) score+=5;
    const latest=[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
    if(["◎","○"].includes(latest.mark)&&errorsFor(latest).length===0) score*=.7;
    score=Math.max(0,Math.min(100,score));
    const dominantError=Object.entries(counts).sort((a,b)=>errorWeight[b[0]]*b[1]-errorWeight[a[0]]*a[1])[0]?.[0]||"C";
    const problemIds=unique(rows.map(row=>row.problem_id));
    const recommended=recommendedProblems(theme,problemIds,problems);
    const plan=actionFor(dominantError,recommended.s.length>0);
    const unresolved=weakNotes.filter(note=>!note.is_resolved&&note.theme===theme).length;
    const evidence=[
      `${rows.length}回中 ${failed.length}回で要対策（失敗率 ${Math.round(failed.length/rows.length*100)}%）`,
      `${dominantError}が${counts[dominantError]}回${recurrence?`、同テーマ再発 ${recurrence}回`:""}`,
      "古いミスほど影響を小さくして算出",
      ...(overdueProblems.size&&rows.some(row=>overdueProblems.has(row.problem_id))?["関連する復習に期限切れあり"]:[]),
      ...(unresolved?[`未解決の弱点ノート ${unresolved}件`]:[])
    ];
    insights.push({
      theme,score:Math.round(score),level:score>=60?"重点":score>=30?"注意":"観察",confidence:confidenceFor(rows.length),
      sampleCount:rows.length,latestDate:latest.date,dominantError,recurrence,errorCounts:counts,evidence,
      recommendedA:recommended.a,recommendedS:recommended.s,...plan
    });
  }
  return {confidence,attemptCount:attempts.length,insights:insights.sort((a,b)=>b.score-a.score||b.latestDate.localeCompare(a.latestDate)).slice(0,3)};
}
