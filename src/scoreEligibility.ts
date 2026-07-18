import type { Attempt, Problem } from "./types.ts";

export function taskScoreForAttempt(attempt:Partial<Attempt>){
  return ["check","skeleton","main_calc"].includes(String(attempt.mode||""))||attempt.evaluation_scope==="conditional_full"
    ?(typeof attempt.score_numeric==="number"?attempt.score_numeric:null):null;
}

export function examScoreEligibility(attempt:Partial<Attempt>,problem?:Problem){
  const mode=String(attempt.mode||"");
  const eligibleMode=["full","timed_single","past_exam","exam_90min"].includes(mode)||problem?.category==="past_exam";
  const reference=Number(attempt.actual_reference_level??attempt.reference_level??0);
  const limit=Number(attempt.time_limit_minutes||(mode==="exam_90min"?90:mode==="full"?35:problem?.category==="past_exam"?30:0));
  const actual=Number(attempt.time_minutes||0);
  const eligible=eligibleMode&&attempt.evaluation_scope!=="conditional_full"&&attempt.assessment_timing!=="same_session_correction"&&reference===0&&limit>0&&actual>0&&attempt.conclusion_reached!==false&&!attempt.incomplete_reason;
  return {eligible,timeLimitMinutes:limit,examScore:eligible&&typeof attempt.score_numeric==="number"?attempt.score_numeric:null};
}
