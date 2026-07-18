import type { Attempt, Problem, ProblemAlias, WeakNote } from "./types.ts";
import { resolveCanonicalProblemId } from "./examReadiness.ts";

export type TrendRow={label:string;score:number;count:number;openCount:number};
export type ErrorTrend={error:string;count:number;score:number};
export type WeekTrend={label:string;score:number;count:number};
export type WeakTrend={
  themes:TrendRow[];errors:ErrorTrend[];chapters:TrendRow[];weeks:WeekTrend[];
  attemptCount:number;totalAttemptCount:number;noErrorCount:number;topTheme:string;kRate:number;
};

const weights:Record<string,number>={K:5,N:3,W:2,C:1};
const unique=<T,>(values:T[])=>[...new Set(values)];
const errorsFor=(attempt:Attempt)=>unique((attempt.error_types?.length?attempt.error_types:[attempt.primary_error_type||attempt.error_type]).filter(error=>error in weights));
const monday=(date:string)=>{
  const value=new Date(`${date}T12:00:00`);
  const day=(value.getDay()+6)%7;
  value.setDate(value.getDate()-day);
  return new Intl.DateTimeFormat("sv-SE").format(value);
};

export function consolidateWeakNotes(notes:WeakNote[],attempts:Attempt[],aliases:ProblemAlias[]=[]){
  const latestAttempt=new Map<string,Attempt>();
  [...attempts].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id).forEach(attempt=>latestAttempt.set(resolveCanonicalProblemId(attempt.problem_id,aliases),attempt));
  const grouped=new Map<string,WeakNote>();
  for(const note of notes){
    if(note.error_type==="none")continue;
    const id=resolveCanonicalProblemId(note.problem_id,aliases),key=`${id}|${note.error_type}|${String(note.correction_rule||"").trim()}`;
    const current=grouped.get(key);
    if(!current||`${current.date}:${current.id}`<`${note.date}:${note.id}`)grouped.set(key,{...note,problem_id:id});
  }
  return [...grouped.values()].map(note=>{
    const latest=latestAttempt.get(note.problem_id);
    const resolvedCandidate=!!latest&&latest.date>note.date&&!(latest.error_types||[latest.error_type]).some(error=>error===note.error_type);
    return {...note,is_resolved:note.is_resolved||resolvedCandidate?1:0};
  }).sort((a,b)=>a.is_resolved-b.is_resolved||b.date.localeCompare(a.date)||b.id-a.id);
}

export function analyzeWeakTrends(
  problems:Problem[],attempts:Attempt[],weakNotes:WeakNote[],fromDate="",aliases:ProblemAlias[]=[]
):WeakTrend{
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const filteredAttempts=attempts.filter(attempt=>!fromDate||attempt.date>=fromDate);
  const filteredNotes=consolidateWeakNotes(weakNotes,attempts,aliases).filter(note=>!fromDate||note.date>=fromDate);
  const notesByAttempt=new Map<string,WeakNote[]>();
  for(const note of filteredNotes){
    const key=`${note.problem_id}|${note.date}`;
    notesByAttempt.set(key,[...(notesByAttempt.get(key)||[]),note]);
  }
  const themeMap=new Map<string,TrendRow>();
  const errorMap=new Map<string,ErrorTrend>(["K","N","W","C"].map(error=>[error,{error,count:0,score:0}]));
  const chapterMap=new Map<string,TrendRow>();
  const weekMap=new Map<string,WeekTrend>();
  let classified=0,kCount=0;
  for(const attempt of filteredAttempts){
    const errors=errorsFor(attempt);
    if(!errors.length) continue;
    classified++;
    if(errors.includes("K")) kCount++;
    const score=errors.reduce((sum,error)=>sum+weights[error],0);
    errors.forEach(error=>{
      const row=errorMap.get(error)!;row.count++;row.score+=weights[error];
    });
    const notes=notesByAttempt.get(`${attempt.problem_id}|${attempt.date}`)||[];
    const themes=unique(notes.map(note=>note.theme).filter(Boolean));
    if(!themes.length) themes.push(pmap.get(attempt.problem_id)?.theme||"テーマ未設定");
    for(const theme of themes){
      const row=themeMap.get(theme)||{label:theme,score:0,count:0,openCount:0};
      row.score+=score;row.count++;
      row.openCount+=notes.filter(note=>note.theme===theme&&!note.is_resolved).length;
      themeMap.set(theme,row);
    }
    const chapter=pmap.get(attempt.problem_id)?.chapter;
    const chapterLabel=chapter==null?"過去問":`第${chapter}章`;
    const chapterRow=chapterMap.get(chapterLabel)||{label:chapterLabel,score:0,count:0,openCount:0};
    chapterRow.score+=score;chapterRow.count++;chapterMap.set(chapterLabel,chapterRow);
    const week=monday(attempt.date);
    const weekRow=weekMap.get(week)||{label:week,score:0,count:0};
    weekRow.score+=score;weekRow.count++;weekMap.set(week,weekRow);
  }
  const sortRows=(rows:TrendRow[])=>rows.sort((a,b)=>b.score-a.score||b.count-a.count);
  const themes=sortRows([...themeMap.values()]);
  return {
    themes,errors:[...errorMap.values()],chapters:sortRows([...chapterMap.values()]),
    weeks:[...weekMap.values()].sort((a,b)=>a.label.localeCompare(b.label)).slice(-8),
    attemptCount:classified,totalAttemptCount:filteredAttempts.length,noErrorCount:filteredAttempts.length-classified,
    topTheme:themes[0]?.label||"まだ判定できません",
    kRate:classified?Math.round(kCount/classified*100):0
  };
}

export function buildQuizPrompt(
  selectedThemes:string[],problems:Problem[],attempts:Attempt[],weakNotes:WeakNote[],questionCount:number,aliases:ProblemAlias[]=[]
){
  const selected=new Set(selectedThemes);
  const problemMap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const visibleNotes=consolidateWeakNotes(weakNotes,attempts,aliases).filter(note=>!note.is_resolved).slice(0,5);
  const relatedProblems=unique([
    ...attempts.filter(attempt=>selected.has(problemMap.get(attempt.problem_id)?.theme||"")).map(attempt=>attempt.problem_id),
    ...visibleNotes.filter(note=>selected.has(note.theme)).map(note=>note.problem_id)
  ]).slice(0,12);
  const mistakes=visibleNotes.filter(note=>selected.has(note.theme)).slice(0,5);
  const evidence=mistakes.length
    ?mistakes.map(note=>`- ${note.theme}（${note.error_type} / ${note.problem_id}）：${note.mistake}。修正ルール：${note.correction_rule||"未設定"}`).join("\n")
    :"- 弱点ノートの具体例はまだありません。テーマと問題IDから診断してください。";
  return `統計検定1級・統計数理の弱点復習クイズをしてください。

対象テーマ：
${selectedThemes.map(theme=>`- ${theme}`).join("\n")}

関連問題ID：
${relatedProblems.length?relatedProblems.map(id=>`- ${id}`).join("\n"):"- 未設定"}

これまでのミス傾向：
${evidence}

進め方：
1. 全${questionCount}問を、必ず1問ずつ出してください。
2. 型、出発式、主役の統計量、条件、定理、計算上の注意を中心に、短答または穴埋め形式で確認してください。
3. 私が答えるまで正解を表示しないでください。
4. 回答後に「正誤・不足点・覚える1行」を簡潔に返してから次へ進んでください。
5. K相当の崩れがあれば関連Sレベルへ戻り、W/N/Cなら該当部分だけを追加で1問出してください。
6. 最後に、残った弱点、改善した点、次に戻る問題IDを一覧にしてください。
7. 最後の一覧の後に、このアプリへ貼り戻せるYAMLを必ず付けてください。関連問題ごとに study_updates の配列を作り、problem_id、date、mode、mark、score_label、error_types、primary_error_type、error_point、next_action、review_after_days、themes、grading_confidence、rubric_version、uncertain_points、weak_notes を含めてください。next_action には日付や復習間隔を書かず、何をするかだけを書いてください。復習間隔は review_after_days にのみ入れてください。rubric_version は "STAT1-QUIZ-v1" としてください。正確に判定できない項目は uncertain_points に入れ、推測で埋めないでください。

問題文そのものを知らない場合は、問題内容を推測せず、上記テーマの一般的な統計検定1級レベルの確認問題を作ってください。`;
}
