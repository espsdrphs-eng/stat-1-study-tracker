import type {Bootstrap} from './types.ts';
import {problemDisplayLabel} from './importParser.ts';
import {deriveTaskAnswerScope,taskAnswerScopeText} from './taskAnswerScope.ts';
import {studyEvidenceKind} from './studyWorkspace.ts';

/** A read-only handoff of one durable grade, not a new diagnosis or execution. */
export function postGradingContext(data:Pick<Bootstrap,'attempts'|'problems'|'reviews'|'taskAnswerScopeOverrides'>,id:number){
 const attempt=data.attempts.find(a=>a.id===id),problem=data.problems.find(p=>p.problem_id===attempt?.problem_id);
 if(!attempt||!problem)return {available:false as const,reason:'保存した答案または対象問題が見つかりません。答案履歴から選び直してください。'};
 if(attempt.invalidated_at||attempt.superseded_by_attempt_id)return {available:false as const,reason:'無効化・差し替え済みの過去答案です。現在有効な答案から補修してください。'};
 const review=data.reviews.find(r=>r.id===(attempt.generated_from_review_id||attempt.source_review_id));
 const scopeTask=review||{problem_id:attempt.problem_id,learning_purpose:attempt.learning_purpose||
  (attempt.is_review_attempt||attempt.task_origin==='review_attempt'?'error_repair' as const:undefined),
  source_attempt_id:attempt.id,graded_part_ids:attempt.graded_part_ids,targeted_parts:attempt.targeted_parts,mode:attempt.mode};
 const scope=taskAnswerScopeText(deriveTaskAnswerScope({problem,task:scopeTask,attempts:data.attempts,overrides:data.taskAnswerScopeOverrides}));
 const current=data.attempts.filter(a=>a.problem_id===attempt.problem_id&&!a.invalidated_at&&!a.superseded_by_attempt_id).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
 const findings=(attempt.graded_findings||[]).filter(f=>f.validity!=='invalid_legacy_k'&&f.planning_eligible!==false&&(!attempt.graded_part_ids?.length||attempt.graded_part_ids.includes(f.graded_part_id)));
 const contract=review?.grading_contract;
 const followup=data.reviews.filter(r=>r.status!=='done'&&r.status!=='superseded'&&(r.source_attempt_id===id||r.generated_from_attempt_id===id));
 const kind=attempt.source_type==='generated'||attempt.transfer_lineage?'生成訓練':attempt.task_origin==='first_attempt'?'初回採点':studyEvidenceKind(attempt);
 const facts={source_attempt_id:id,problem_id:problem.problem_id,problem:problemDisplayLabel(problem),date:attempt.date,kind,
  learning_purpose:attempt.learning_purpose||'未記録',mode:attempt.mode,scope,
  score_numeric:attempt.score_numeric??null,score_max:attempt.score_max??null,mark:attempt.mark,
  contract_id:attempt.contract_id||contract?.contractId||null,source_review_id:review?.id||null,
  actual_reference_level:attempt.actual_reference_level??attempt.reference_level??null,
  summary:attempt.result_summary||'採点要約未登録',recorded_issue:attempt.error_point||'未登録',
  graded_findings:findings.map(f=>({part:f.graded_part_id,label:contract?.gradedParts.find(p=>p.id===f.graded_part_id)?.label||f.graded_part_id,error_type:f.error_type,resolved:f.resolved,evidence:f.evidence})),
  uncertain_points:attempt.uncertain_points||[],next_action:attempt.next_action||'未登録',
  newer_attempt:current?.id!==id?{id:current.id,date:current.date,summary:current.result_summary,findings:current.graded_findings}:null,
  scheduled_checks:followup.map(r=>({review_id:r.id,purpose:r.learning_purpose,earliest_date:r.earliest_date,due_date:r.due_date})),
  problem_text:problem.generated_transfer?.problem_text||'原問題本文はアプリ未登録です。必要なら私が原本を提示します。'};
 const prompt='統計検定1級の保存済み採点から、同じ学習内で解説・局所補修を手伝ってください。以下は確定した採点の記録です。元得点・採点契約・正式本番得点を上書き／再採点しないでください。\n'+
  '答案画像は必要なら私が別途添付します。まだ添付されていない画像や未登録の原問題を見たと仮定しないでください。根拠にない停止原因や能力不足を断定せず、どこで止まったか一問ずつ確認してください。新しい答案がある場合は、古い失敗が現在も未解消とは決めつけず、両方の根拠を確認してください。\n'+
  '採点対象内の未解消・判定保留の数学的操作を1つずつ取り上げ、理解の確認→必要な知識の確認→最初の一手→計算・結論の順に対話してください。対象外の小問を未回答として減点しないでください。解説・参照後の成功は援助ありの局所補修です。説明を理解しただけで自力成功・保持・転移成功にしないでください。\n'+
  '補修の説明と結果は通常の文章で返して構いません。未確認事項と、次に別日・参照なしで再現すべき操作を区別してください。この返答は原文として保管し、得点や習得判定には直接反映しません。新しい補修答案の正式採点はアプリの別課題から新しい採点契約を取得して行います。転移は別問題の検証が必要です。\n'+JSON.stringify(facts,null,2);
 return {available:true as const,attempt,problem,kind,scope,prompt,newerAttemptId:current?.id!==id?current?.id:undefined};
}
