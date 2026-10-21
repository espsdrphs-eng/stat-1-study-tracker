import {useMemo} from 'react';import type {Bootstrap} from './types';
import {deriveTrainingProfiles,abilityStateLabels,abilityTrainingHistory,abilityTrainingPlan} from './abilityTraining';
export function WeaknessFocus({data,onCreate,onTransfer,onReview,onProblems,onDiagnose,busy}:{data:Bootstrap;
 onCreate:(id:string)=>void;onTransfer:(key:string)=>void;onReview:()=>void;onProblems:()=>void;onDiagnose:()=>void;busy:boolean}){
 const profiles=useMemo(()=>deriveTrainingProfiles(data),[data]);
 const labels={success:'自力で成功（訓練）',failure:'未達',uncertain:'判定保留',assisted:'援助あり'};
 return <section className="weakness-focus ability-training" aria-label="能力プロフィールと弱点トレーニング">
  <header><h2>能力トレーニング</h2><p>GPTの見立てを、異なる設定の問題で確認します。個別問題の復習とは別の証拠です。</p></header>
  <div className="button-row"><button className="ghost" onClick={onDiagnose}>プロフィールを更新（任意）</button><button className="ghost" onClick={onReview}>個別問題の復習予定</button><button className="ghost" onClick={onProblems}>問題一覧</button></div>
  {data.coach.current&&<p className="muted">GPT診断 {data.coach.current.reviewedAt.slice(0,10)}{data.coach.stale?' ／ 新しい採点あり・再診断待ち（直近の訓練結果は下に表示）':''}</p>}
  {data.coach.current?.primaryBottleneck.title&&profiles[0]?.origin==='grading_evidence'&&<section aria-label="現在の最大ボトルネック"><strong>現在の最大ボトルネック（GPT所見）</strong><p>{data.coach.current.primaryBottleneck.title.match(/^.*?[。！？]|^.+$/)?.[0]}</p><small>下の採点箇所との能力対応はまだ暫定です。</small></section>}
  {profiles.slice(0,3).map((p,i)=>{const history=abilityTrainingHistory(data,p.id),plan=abilityTrainingPlan(data,p),active=data.problems.find(q=>q.generated_transfer?.lineage.abilityProfile?.id===p.id&&q.generated_transfer.lifecycle_status!=='graded');
   return <article className="ability-profile-card" key={p.id} data-ability-id={p.id}>
    <header><span>{i===0?(p.origin==='grading_evidence'?'採点根拠からの暫定訓練':'現在の最大ボトルネック'):'重点課題'}</span><span className="ability-state">{`訓練状態：${abilityStateLabels[plan.state]}`}</span></header>
    <h3>{p.name}</h3>{p.goal!==p.name&&<p><strong>確認すること：</strong>{p.goal}</p>}<p><strong>次の検証：</strong>{plan.next}</p>
    {p.sources[0]&&(()=>{const s=p.sources[0],a=data.attempts.find(a=>a.id===s.attemptId),q=data.problems.find(q=>q.problem_id===a?.problem_id),e=a?.graded_findings?.find(f=>s.partIds.includes(f.graded_part_id))?.evidence||a?.error_point;return <section aria-label="最新の診断根拠"><small>{q?.display_label||a?.problem_id}・答案 #{s.attemptId}・{a?.date}</small>{e&&<p>{e.match(/^.*?[。！？]|^.+$/)?.[0]}</p>}</section>})()}
    {p.origin==='legacy_diagnosis'&&<small>既存の総合診断を参照しています。能力別の改善状態はまだ未判定です。</small>}
    <div className="button-row"><button className="primary" disabled={busy||!p.trainable} onClick={()=>onCreate(p.id)}>{active?'訓練を再開':'訓練問題を作成'}</button></div>
    {p.reason&&<p role="status">{p.reason}</p>}
    <p className="muted">生成問題は能力トレーニングです。過去問の正式得点・自然な本番転移とは別に記録します。</p>
    <details className="training-result-details"><summary>直近の訓練結果・改善履歴 {history.length}件</summary>{history.length?<ul className="ability-results">{history.slice(0,5).map(h=><li key={h.attemptId}><strong>{labels[h.outcome]}</strong><span>{h.date}・{h.problemId}</span><p>{h.evidence}</p><button className="text-btn" onClick={()=>onTransfer(data.attempts.find(a=>a.id===h.attemptId)!.transfer_lineage!.key)}>結果を確認</button></li>)}</ul>:<p>まだ訓練していません。問題の作成・コピーだけでは成功になりません。</p>}</details>
    <details><summary>プロフィールの根拠・過去の変化</summary><p>技能体系への対応は未確定の場合があります。以下はGPT診断に結び付いた答案で、全てを同じ失敗と自動認定していません。</p>
     {p.sources.map(s=>{const a=data.attempts.find(a=>a.id===s.attemptId);return <div key={s.attemptId}><strong>{a?.problem_id||'根拠答案が見つかりません'}・答案 #{s.attemptId}・{a?.date}</strong><p>{s.partIds.length?s.partIds.join(' / '):'採点箇所未登録'}</p><p>{s.partIds.length?a?.graded_findings?.filter(f=>s.partIds.includes(f.graded_part_id)).map(f=>`${f.resolved?'成功記録':'未解消記録'}：${f.evidence}`).join(' ／ '):a?.error_point}</p></div>})}
     {data.coach.history.filter(d=>d.abilityProfiles?.some(a=>a.id===p.id)).slice(-5).reverse().map(d=><p key={d.reviewedAt}>{d.reviewedAt.slice(0,10)}：{abilityStateLabels[d.abilityProfiles!.find(a=>a.id===p.id)!.state]}（GPT診断）</p>)}
    </details>
   </article>})}
  {data.attempts.some(a=>a.transfer_lineage?.abilityProfile&&!profiles.some(p=>p.id===a.transfer_lineage!.abilityProfile!.id))&&<details><summary>別の能力の訓練履歴</summary>{[...new Set(data.attempts.flatMap(a=>a.transfer_lineage?.abilityProfile&&!profiles.some(p=>p.id===a.transfer_lineage!.abilityProfile!.id)?[a.transfer_lineage.abilityProfile.id]:[]))].map(id=><div key={id}><h4>{data.attempts.find(a=>a.transfer_lineage?.abilityProfile?.id===id)?.transfer_lineage?.abilityProfile?.name}</h4>{abilityTrainingHistory(data,id).map(h=><p key={h.attemptId}>{h.date}：{labels[h.outcome]}<button className="text-btn" onClick={()=>onTransfer(data.attempts.find(a=>a.id===h.attemptId)!.transfer_lineage!.key)}>結果を確認</button></p>)}</div>)}</details>}
 </section>;
}
