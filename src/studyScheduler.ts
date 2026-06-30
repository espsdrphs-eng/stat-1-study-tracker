import type { Attempt, Problem } from "./types.ts";

const successful=(attempt:Attempt)=>
  ["◎","○"].includes(attempt.mark)&&!(attempt.error_types||[attempt.error_type]).some(error=>error&&error!=="none");

export function selectMixedPractice(
  problems:Problem[],attempts:Attempt[],excludedIds:Set<string>,today:string
):Problem|null{
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  const aAttempts=attempts.filter(attempt=>pmap.get(attempt.problem_id)?.category==="A");
  if(new Set(aAttempts.map(attempt=>attempt.problem_id)).size<4) return null;
  const latest=new Map<string,Attempt>();
  for(const attempt of [...aAttempts].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id)) latest.set(attempt.problem_id,attempt);
  const cutoff=new Date(`${today}T12:00:00`);cutoff.setDate(cutoff.getDate()-7);
  const cutoffText=new Intl.DateTimeFormat("sv-SE").format(cutoff);
  const candidates=[...latest.values()].filter(attempt=>
    !excludedIds.has(attempt.problem_id)&&attempt.date<=cutoffText&&successful(attempt)
  ).sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  return candidates.length?pmap.get(candidates[0].problem_id)||null:null;
}
