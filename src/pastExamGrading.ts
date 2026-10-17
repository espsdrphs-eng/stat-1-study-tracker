import type {Attempt,GradingContractSnapshot,PastSession,Problem,StudyUpdate} from './types.ts';
import {buildInitialGradingContract,contractDifferences} from './gradingContract.ts';
import {buildFirstAttemptGradingPrompt} from './gradingPrompt.ts';
import {imageGradingPrompt} from './learningFeedback.ts';
import {resolvePastExamProblemId} from './examReferencePack.ts';
import {sessionSelectedIds} from './pastExamSessionScope.ts';
export {sessionSelectedIds} from './pastExamSessionScope.ts';
/** Individual study history is not a simulated exam. Never aggregate these scores into examScore. */
export function pastExamIndividualResults(year:number,attempts:Attempt[]){
 const questions=[1,2,3,4,5].map(q=>{
  const problemId=`PY-${year}-Q${q}`;
  const history=attempts.filter(a=>a.problem_id===problemId&&!a.invalidated_at&&!a.superseded_by_attempt_id&&!a.duplicate_of_attempt_id&&!a.exclude_from_metrics)
   .sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id).map(a=>({attempt:a,score:a.score_numeric==null?null:Number(a.score_numeric)/Number(a.score_max||100)*100}));
  const initial=history.find(r=>r.attempt.task_origin==='first_attempt')||history.find(r=>!r.attempt.generated_from_review_id&&!['error_repair','retrieval_check','transfer_check'].includes(String(r.attempt.learning_purpose)));
  return {problemId,label:`問${q}`,history,initial,latest:history.at(-1)};
 });
 return {questions,studiedCount:questions.filter(q=>q.history.length).length,attemptCount:questions.reduce((n,q)=>n+q.history.length,0)};
}
export function buildPastSessionContract(s:PastSession,p:Problem,role:'selected_timed'|'counterfactual_calibration'='selected_timed'):GradingContractSnapshot{
 if(!s.answer_finished_at&&!s.attempt_completed_at)throw new Error('演習を終了してから採点へ進んでください。');
 const selected=sessionSelectedIds(s),answered=s.answered_problem_ids||selected;
 if(!s.questions?.some(q=>resolvePastExamProblemId(s.year,q.problemId||q.questionLabel)===p.problem_id)||
   (role==='selected_timed'?(!selected.includes(p.problem_id)||!answered.includes(p.problem_id)):selected.includes(p.problem_id)))throw new Error('今回のsessionで解答した採点対象ではありません。');
 const c=buildInitialGradingContract({problem:p,mode:'full',createdAt:String(s.answer_finished_at||s.attempt_completed_at)});
 return {...c,contractId:`past-session:${s.id}:${p.problem_id}:${role==='counterfactual_calibration'?'calibration:':''}${c.contractHash}`};
}
/** Only a persisted, exactly matched contract may bind a known legacy omission. */
export function bindPastSessionGradingInput(s:PastSession,input:StudyUpdate&Record<string,unknown>){
 const c=s.grading_contracts?.[input.problem_id],selected=sessionSelectedIds(s).includes(input.problem_id),role=selected?'selected_timed':'counterfactual_calibration';
 const oldInitial=c?`initial:${c.problemId}:full:${c.contractHash.slice(3)}`:'';
 if(!c||!s.session_instance_id||Number(input.parent_past_session_id)!==s.id||input.past_exam_session_instance_id!==s.session_instance_id||input.session_role!==role||input.generated_from_review_id||
   !selected&&!s.post_session_answers?.[input.problem_id]||
   input.contract_id&&input.contract_id!==c.contractId&&input.contract_id!==oldInitial||
   contractDifferences(c,{contractId:c.contractId,contractVersion:input.contract_version,contractHash:input.contract_hash,problemId:input.problem_id,learningPurpose:input.learning_purpose,mode:input.mode as GradingContractSnapshot['mode'],reviewScope:input.review_scope,targetKind:input.target_kind,gradedParts:input.graded_part_ids||[]}).length)
  throw new Error('演習・対象問題・採点契約の識別情報が不足または一致しません。年度別演習の対象問題から採点プロンプトを再取得してください。未選択問題は後日答案として開始します。');
 if(input.task_context?.contract_id&&![c.contractId,oldInitial].includes(input.task_context.contract_id))throw new Error('課題コンテキストの契約IDが一致しません。');
 return {...input,contract_id:c.contractId,...(input.task_context?{task_context:{...input.task_context,contract_id:c.contractId}}:{})};
}
export function buildPastSessionGradingPrompt(s:PastSession,p:Problem,c:GradingContractSnapshot){
 const q=s.questions?.find(q=>resolvePastExamProblemId(s.year,q.problemId||q.questionLabel)===p.problem_id);
 const reference=s.answer_exposure?4:q?.referenceUsed?5:q?.hintUsed?3:0;
 const selected=sessionSelectedIds(s).includes(p.problem_id),post=s.post_session_answers?.[p.problem_id];
 let prompt=buildFirstAttemptGradingPrompt({problemId:p.problem_id,displayLabel:p.display_label||p.title,mode:'full',gradingContract:c});
 // Keep the existing structured grading schema, but bind this execution rather than an initial/repair task.
 prompt=prompt.replace('  date: "auto_today"',`  date: "${selected?s.date:post?.date||''}"\n  parent_past_session_id: ${s.id}\n  past_exam_session_instance_id: "${s.session_instance_id||''}"\n  session_role: "${selected?'selected_timed':'counterfactual_calibration'}"`).replace('  task_origin: "review_attempt"','  task_origin: "first_attempt"').replace('  assessment_timing: "same_session_correction"','  assessment_timing: "independent_performance"');
 if(!selected){
  prompt=prompt.replace('私の初回答案','本番後に解答した答案').replace('今回は初回答案です。\n前回ミスや前回復習履歴はありません。\n復習ではなく、初回の到達度診断として採点してください。','今回は本番後の選択判断の検証です。既往履歴の有無や初見性を推測せず、今回の答案だけを採点してください。').replace('  task_origin: "first_attempt"','  task_origin: "past_exam_followup"');
  return imageGradingPrompt(prompt,reference,null)+`\n【選択判断の検証・後日答案】\n${s.year}年 ${p.problem_id}。これはSession ${s.id}で選ばなかった問題を後日に解いた答案です。本番90分の答案ではありません。100点満点の得点率で採点し、選択3問の本番得点・完走・自然転移へ加算しません。予想得点・本番時の選択は書き換えません。答案画像は利用者が直接添付します。未添付や判読不能なら判定保留にしてください。`;
 }
 return imageGradingPrompt(prompt,reference,q?.actualMinutes??null)+`\n\n【本番形式の今回の採点】\n${s.year}年・${s.session_kind}・Session ${s.id}。選択問題：${sessionSelectedIds(s).join('、')}。scanを含めて90分。記録した全体時間：${s.actual_total_minutes||'不明'}分。\n今回の採点は ${p.problem_id} の実際に添付された答案だけです。各問題を100点満点の得点率として採点し、選択3問の平均をアプリが本番100点へ換算します。1問を約33点満点に再換算しないでください。非選択問題を未回答として減点しません。画像は利用者がChatGPTへ直接添付します。未添付・判読不能・参照不足は推測せず判定保留にしてください。`;
}
export function pastSessionResult(s:PastSession,attempts:Attempt[]){
 const selected=sessionSelectedIds(s),linked=new Set([...(s.linked_attempt_ids||[]),...(s.selected_timed_attempt_ids||[]),...(s.counterfactual_calibration_attempt_ids||[])]);
 const usable=attempts.filter(a=>!a.invalidated_at&&!a.superseded_by_attempt_id&&!a.duplicate_of_attempt_id&&!a.exclude_from_metrics&&a.score_numeric!=null&&a.learning_purpose!=='error_repair'&&a.learning_purpose!=='retrieval_check'&&(a.parent_past_session_id===s.id||linked.has(a.id)));
 const questions=(s.questions||[]).map(q=>{const problemId=resolvePastExamProblemId(s.year,q.problemId||q.questionLabel),isSelected=selected.includes(problemId),a=usable.filter(a=>a.problem_id===problemId&&(isSelected?a.session_role!=='counterfactual_calibration':a.session_role!=='selected_timed')).sort((a,b)=>a.id-b.id)[0];
  const score=a?Number(a.score_numeric)/Number(a.score_max||100)*100:q.actualScoreSource==='manual_override'?q.actualScore:q.sourceAttemptId&&usable.some(a=>a.id===q.sourceAttemptId)?q.actualScore:null;
  return {problemId,label:q.questionLabel,selected:isSelected,role:isSelected?'選択答案':a?.session_role==='counterfactual_calibration'?'後日解答・選択検証':'非選択・診断',score:score??null,attempt:a};});
 const chosen=questions.filter(q=>q.selected),graded=chosen.filter(q=>q.score!=null),finished=!!s.answer_finished_at||!!s.attempt_completed_at;
 const total=s.session_elapsed_minutes??(s.actual_total_minutes&&s.actual_total_minutes>0?s.actual_total_minutes:null);
 return {questions,selected,gradedCount:graded.length,status:chosen.length===3&&graded.length===3?'採点済み':finished||graded.length?'採点待ち':s.prompt_scanned_at?'進行中':'未実施',examScore:chosen.length===3&&graded.length===3?graded.reduce((n,q)=>n+Number(q.score),0)/3:null,
  timed:chosen.length===3&&graded.length===3&&total!=null?{within:total<=90&&chosen.every(q=>q.attempt?.conclusion_reached!==false&&!q.attempt?.incomplete_reason),total}:null,
  loss:[...chosen].sort((a,b)=>Number(a.score??100)-Number(b.score??100)).map(q=>q.attempt).find(a=>a?.error_point&&a.error_type!=='none')?.error_point||null};
}
export function pastSessionSelectionComparison(s:PastSession,attempts:Attempt[]){
 const result=pastSessionResult(s,attempts),rows=result.questions.map(q=>{const original=s.questions?.find(r=>resolvePastExamProblemId(s.year,r.problemId||r.questionLabel)===q.problemId);
  const predictedScore=original?.predictedScore??null,predictedMinutes=original?.predictedMinutes??null,answerTiming=q.score==null?'未採点':q.selected?'本番中':q.attempt?.session_role==='counterfactual_calibration'||s.post_session_answers?.[q.problemId]?'後日解答':'時点未確認';
  return {...q,predictedScore,predictedMinutes,selectionReason:original?.selectionReason||'',answerTiming,scoreDifference:predictedScore==null||q.score==null?null:Math.round((q.score-predictedScore)*10)/10,comment:q.score==null?'採点待ち':answerTiming!=='本番中'?'本番と条件が異なるか未確認のため、選択の正誤は判断保留':predictedScore==null?'予想得点は未記録':q.score<predictedScore?'次回は得点見積もりを控えめに補正':'今回の得点を次回の見積もりに活用'};
 });
 return {rows,status:'判断保留',reason:rows.some(r=>r.answerTiming==='後日解答')?'後日答案は本番中と条件が異なるため、高得点でも当日の選択ミスとは断定しません。':'5問を同じ条件で比較できる証拠が不足しています。予想と本番得点の差から見積もりを補正します。'};
}
