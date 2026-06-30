import type { Attempt, Problem, WeakNote } from "./types.ts";

export type TrendRow={label:string;score:number;count:number;openCount:number};
export type ErrorTrend={error:string;count:number;score:number};
export type WeekTrend={label:string;score:number;count:number};
export type WeakTrend={
  themes:TrendRow[];errors:ErrorTrend[];chapters:TrendRow[];weeks:WeekTrend[];
  attemptCount:number;topTheme:string;kRate:number;
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

export function analyzeWeakTrends(
  problems:Problem[],attempts:Attempt[],weakNotes:WeakNote[],fromDate=""
):WeakTrend{
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const filteredAttempts=attempts.filter(attempt=>!fromDate||attempt.date>=fromDate);
  const filteredNotes=weakNotes.filter(note=>!fromDate||note.date>=fromDate);
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
    attemptCount:classified,topTheme:themes[0]?.label||"まだ判定できません",
    kRate:classified?Math.round(kCount/classified*100):0
  };
}

export function buildQuizPrompt(
  selectedThemes:string[],problems:Problem[],attempts:Attempt[],weakNotes:WeakNote[],questionCount:number
){
  const selected=new Set(selectedThemes);
  const problemMap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const relatedProblems=unique([
    ...attempts.filter(attempt=>selected.has(problemMap.get(attempt.problem_id)?.theme||"")).map(attempt=>attempt.problem_id),
    ...weakNotes.filter(note=>selected.has(note.theme)).map(note=>note.problem_id)
  ]).slice(0,12);
  const mistakes=weakNotes.filter(note=>selected.has(note.theme)).slice(0,12);
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
7. 最後の一覧の後に、このアプリへ貼り戻せるYAMLを必ず付けてください。関連問題ごとに study_updates の配列を作り、problem_id、date、mode、mark、score_label、error_types、primary_error_type、error_point、next_action、review_after_days、themes、grading_confidence、rubric_version、uncertain_points、weak_notes を含めてください。rubric_version は "STAT1-QUIZ-v1" としてください。正確に判定できない項目は uncertain_points に入れ、推測で埋めないでください。

問題文そのものを知らない場合は、問題内容を推測せず、上記テーマの一般的な統計検定1級レベルの確認問題を作ってください。`;
}
