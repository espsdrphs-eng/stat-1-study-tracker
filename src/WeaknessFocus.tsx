import {useMemo} from 'react';import type {Bootstrap,Problem,Task} from './types';
import {priorityRepairTasks,weaknessTransferAction} from './learningOverview';import {deriveCurrentLearningDiagnosis,completionCriterionText,learningTargetLabel} from './learningFeedback';
import {deriveTaskAnswerScope,taskAnswerScopeText} from './taskAnswerScope';import {currentTaskIdentity} from './examOptimizationPolicy';
import {findingPlanningEligible} from './legacyKPolicy';
import {repairCheckForTask,repairStageLabel} from './repairCheck';
export function WeaknessFocus({data,onStart,onToday,onTransfer}:{data:Bootstrap;onStart:(problem:Problem,task:Task)=>void;onToday:()=>void;onTransfer:(key:string)=>void}){
 const tasks=useMemo(()=>priorityRepairTasks(data),[data]),diagnosis=useMemo(()=>deriveCurrentLearningDiagnosis(data),[data]);
 const transfers=data.today.tasks.filter(t=>t.ranking?.eligible&&!t.checked&&t.transfer_training_key);
 return <section className="weakness-focus" aria-label="今補修すべき優先3件"><h2>今、補修すべき優先3件</h2><p className="muted">Todayと同じ順位です。未解消の対象だけを確認します。</p>
  {tasks.map(task=>{const p=data.problems.find(p=>p.problem_id===task.problem_id);if(!p)return null;
   const d=diagnosis.deficits.find(d=>d.problemId===p.problem_id),source=data.attempts.find(a=>a.id===(d?.sourceAttemptId||task.source_attempt_id||task.grading_contract?.sourceAttemptId));
   const parts=new Set(task.grading_contract?.gradedParts.map(p=>p.id)||[]),labels=[...new Set((source?.graded_findings||[]).filter(f=>!f.resolved&&f.error_type!=='none'&&findingPlanningEligible(source!,f)&&(!parts.size||parts.has(f.graded_part_id))).map(f=>learningTargetLabel(f.graded_part_id)))];
   const line=labels.length?`${labels.slice(0,3).join('・')}に未解消の点があります`:'未解消の理由を採点の根拠から確認する必要があります';
   const scope=taskAnswerScopeText(deriveTaskAnswerScope({problem:p,task,attempts:data.attempts,overrides:data.taskAnswerScopeOverrides}));
   const transfer=weaknessTransferAction(task,transfers);
   return <article className="priority-weakness-card" key={currentTaskIdentity(task)} data-problem-id={p.problem_id}><header><h3>{p.display_label||p.title||p.problem_id}</h3><span>補修が必要</span></header><strong>{scope}</strong><p className="weakness-one-line">{line}</p><p>次の課題：{task.kind==='局所再診断'?'解き直す前に、つまずいた対象を局所的に確認':'対象小問を紙・Goodnotesで再現'}</p>
    <p>詰まった段階（自己申告）：{repairStageLabel(repairCheckForTask(data.learningWorkByProblem?.[p.problem_id]?.repairCheck,task)||source?.repair_check)}</p><p>完了条件：{completionCriterionText(task.grading_contract)}</p>
    <div className="button-row"><button className="primary" onClick={()=>onStart(p,task)}>補修を始める</button><button className="ghost" disabled={!transfer.key} aria-describedby={transfer.reason?`transfer-wait-${p.problem_id}`:undefined} onClick={()=>transfer.key&&onTransfer(transfer.key)}>転移問題を作成</button></div>
    {transfer.reason&&<small id={`transfer-wait-${p.problem_id}`}>{transfer.reason}</small>}
    <details><summary>成功条件と根拠</summary><p>{d?.evidence||source?.error_point||'診断未登録'}</p><p>成功条件：{completionCriterionText(task.grading_contract)}</p><small>根拠答案 #{source?.id||'未特定'} ／ {source?.date||'日付未登録'}。技能対応が未確定の対象は、他問題と推測統合しません。</small></details>
   </article>})}
  {!tasks.length&&<p>現在、実行可能な補修課題はありません。保持・転移とTodayの待機条件を確認してください。</p>}
  <details className="transfer-ready-list" open><summary>保持後の転移訓練{transfers.length?`（実行可能${transfers.length}件）`:''}</summary>{transfers.length?transfers.map(t=><div key={t.transfer_training_key}><p>{data.problems.find(p=>p.problem_id===t.problem_id)?.display_label||t.problem_id}由来の別問題訓練</p><button className="primary" onClick={()=>onTransfer(t.transfer_training_key!)}>転移問題を作成</button></div>):<p>技能対応・補修・遅延保持の条件が揃った課題から進めます。白本候補は必須ではありません。</p>}</details>
  <button className="text-btn" onClick={onToday}>Todayの全候補・待機条件を見る</button>
 </section>;
}
