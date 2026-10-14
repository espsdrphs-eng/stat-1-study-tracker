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
