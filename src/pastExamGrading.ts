import type {Attempt,GradingContractSnapshot,PastSession,Problem} from './types.ts';
import {buildInitialGradingContract} from './gradingContract.ts';
import {buildFirstAttemptGradingPrompt} from './gradingPrompt.ts';
import {imageGradingPrompt} from './learningFeedback.ts';
import {resolvePastExamProblemId} from './examReferencePack.ts';
export const sessionSelectedIds=(s:PastSession)=>(s.final_selected_problem_ids?.length?s.final_selected_problem_ids:s.initial_selected_problem_ids||[]).map(id=>resolvePastExamProblemId(s.year,id));
export function buildPastSessionContract(s:PastSession,p:Problem):GradingContractSnapshot{
 if(!s.answer_finished_at&&!s.attempt_completed_at)throw new Error('演習を終了してから採点へ進んでください。');
 const selected=sessionSelectedIds(s),answered=s.answered_problem_ids||selected;
 if(!selected.includes(p.problem_id)||!answered.includes(p.problem_id))throw new Error('今回のsessionで解答した採点対象ではありません。');
 const c=buildInitialGradingContract({problem:p,mode:'full',createdAt:String(s.answer_finished_at||s.attempt_completed_at)});
 return {...c,contractId:`past-session:${s.id}:${p.problem_id}:${c.contractHash}`};
}
export function buildPastSessionGradingPrompt(s:PastSession,p:Problem,c:GradingContractSnapshot){
 const q=s.questions?.find(q=>resolvePastExamProblemId(s.year,q.problemId||q.questionLabel)===p.problem_id);
 const reference=s.answer_exposure?4:q?.referenceUsed?5:q?.hintUsed?3:0;
 let prompt=buildFirstAttemptGradingPrompt({problemId:p.problem_id,displayLabel:p.display_label||p.title,mode:'full',gradingContract:c});
 // Keep the existing structured grading schema, but bind this execution rather than an initial/repair task.
 prompt=prompt.replace('  date: "auto_today"',`  date: "${s.date}"\n  parent_past_session_id: ${s.id}\n  past_exam_session_instance_id: "${s.session_instance_id||''}"\n  session_role: "selected_timed"`).replace('  task_origin: "review_attempt"','  task_origin: "first_attempt"').replace('  assessment_timing: "same_session_correction"','  assessment_timing: "independent_performance"');
 return imageGradingPrompt(prompt,reference,q?.actualMinutes??null)+`\n\n【本番形式の今回の採点】\n${s.year}年・${s.session_kind}・Session ${s.id}。選択問題：${sessionSelectedIds(s).join('、')}。scanを含めて90分。記録した全体時間：${s.actual_total_minutes||'不明'}分。\n今回の採点は ${p.problem_id} の実際に添付された答案だけです。各問題を100点満点の得点率として採点し、選択3問の平均をアプリが本番100点へ換算します。1問を約33点満点に再換算しないでください。非選択問題を未回答として減点しません。画像は利用者がChatGPTへ直接添付します。未添付・判読不能・参照不足は推測せず判定保留にしてください。`;
}
export function pastSessionResult(s:PastSession,attempts:Attempt[]){
 const selected=sessionSelectedIds(s),linked=new Set([...(s.linked_attempt_ids||[]),...(s.selected_timed_attempt_ids||[]),...(s.counterfactual_calibration_attempt_ids||[])]);
 const usable=attempts.filter(a=>!a.invalidated_at&&!a.superseded_by_attempt_id&&!a.duplicate_of_attempt_id&&!a.exclude_from_metrics&&a.score_numeric!=null&&a.learning_purpose!=='error_repair'&&a.learning_purpose!=='retrieval_check'&&(a.parent_past_session_id===s.id||linked.has(a.id)));
 const questions=(s.questions||[]).map(q=>{const problemId=resolvePastExamProblemId(s.year,q.problemId||q.questionLabel),a=usable.filter(a=>a.problem_id===problemId).sort((a,b)=>a.id-b.id)[0];
  const score=a?Number(a.score_numeric)/Number(a.score_max||100)*100:q.actualScoreSource==='manual_override'?q.actualScore:q.sourceAttemptId&&usable.some(a=>a.id===q.sourceAttemptId)?q.actualScore:null;
  return {problemId,label:q.questionLabel,selected:selected.includes(problemId),role:selected.includes(problemId)?'選択答案':'非選択・診断',score:score??null,attempt:a};});
 const chosen=questions.filter(q=>q.selected),graded=chosen.filter(q=>q.score!=null),finished=!!s.answer_finished_at||!!s.attempt_completed_at;
 const total=s.session_elapsed_minutes??(s.actual_total_minutes&&s.actual_total_minutes>0?s.actual_total_minutes:null);
 return {questions,selected,gradedCount:graded.length,status:chosen.length===3&&graded.length===3?'採点済み':finished||graded.length?'採点待ち':s.prompt_scanned_at?'進行中':'未実施',examScore:chosen.length===3&&graded.length===3?graded.reduce((n,q)=>n+Number(q.score),0)/3:null,
  timed:chosen.length===3&&graded.length===3&&total!=null?{within:total<=90&&chosen.every(q=>q.attempt?.conclusion_reached!==false&&!q.attempt?.incomplete_reason),total}:null,
  loss:[...chosen].sort((a,b)=>Number(a.score??100)-Number(b.score??100)).map(q=>q.attempt).find(a=>a?.error_point&&a.error_type!=='none')?.error_point||null};
}
