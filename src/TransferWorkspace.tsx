import {useEffect,useState} from 'react';
import type {Bootstrap} from './types';
import type {TransferWorkspaceItem} from './transferWorkspaceIndex';
import {post} from './api';
const labels={generation:'生成結果待ち',quality:'品質確認待ち',answer:'自力解答へ',grading:'採点待ち',result:'結果保存済み',pending:'判定保留'};
export function TransferWorkspace({data,onOpen,onWeak,onSchedule,onSource}:{data:Bootstrap;onOpen:(key:string)=>void;onWeak:()=>void;onSchedule:()=>void;onSource:(id:number)=>void}){
 const [items,setItems]=useState<TransferWorkspaceItem[]>([]),[warnings,setWarnings]=useState<string[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [filter,setFilter]=useState('active');
 const [starting,setStarting]=useState(false);
 const beginBlind=async()=>{if(starting)return;setStarting(true);setError('');try{const r=await post<{key:string}>('/api/transfer-training',{action:'begin-blind'});onOpen(r.key)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setStarting(false)}};
 const load=async()=>{setLoading(true);setError('');try{const result=await post<{items:TransferWorkspaceItem[];warnings:string[]}>('/api/transfer-training',{action:'list'});setItems(result.items);setWarnings(result.warnings)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setLoading(false)}};
 useEffect(()=>{void load()},[data]);
 const shown=items.filter(i=>filter==='all'||filter==='results'?filter==='all'||i.phase==='result':i.phase!=='result');
 const candidates=data.today.tasks.filter(t=>!t.checked&&t.ranking?.eligible&&t.transfer_training_key&&!items.some(i=>i.key===t.transfer_training_key));
 return <div className="transfer-index" aria-label="転移の作成・再開"><section className="transfer-overview panel"><span className="section-kicker">別の設定で、自力で使えるか</span><h2>転移の作成・再開</h2><p>生成 → 独立品質確認 → 紙で解答 → 採点・保存。生成しただけでは成功になりません。</p><div className="button-row"><button className="primary" disabled={starting} onClick={()=>void beginBlind()}>非誘導型の確認を準備</button><button className="ghost" onClick={onWeak}>弱点を指定して練習</button><button className="text-btn" onClick={onSchedule}>遅延確認の予定</button></div><small>非誘導型は複数の保存済みGPT提案からGPTが対象を選び、答案固定まで隠します。指定型の成功・生成問題の結果・過去問の本番得点は混ぜません。</small></section>
  <div className="screen-tabs" aria-label="転移の表示区分">{[['active','途中・保留'],['results','保存した結果'],['all','すべて']].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label} <b>{items.filter(i=>key==='all'||(key==='results'?i.phase==='result':i.phase!=='result')).length}</b></button>)}</div>
  {loading&&<p role="status">転移の記録を確認しています…</p>}{error&&<section role="alert"><p>{error}</p><button onClick={()=>void load()}>一覧を再読込</button></section>}
  {!loading&&!error&&!shown.length&&<section className="panel"><p>この区分の記録はありません。弱点から対象操作を選んで始められます。</p></section>}
  {shown.map(i=><article className="panel transfer-index-card" key={i.key} data-transfer-key={i.key}><div className="section-heading"><span className={`evidence-chip ${i.phase==='result'?'training':'pending'}`}>{labels[i.phase]}・{i.noncued?'非誘導型の確認':i.kind==='existing'?'既存別問題':'弱点指定型の訓練'}</span><time>{i.createdAt.slice(0,10)||'日時未記録'}</time></div><h3>{i.title}</h3>{i.sourceHidden?<p>対象能力・生成理由・元答案は答案固定まで表示しません。</p>:<p>{data.problems.find(p=>p.problem_id===i.sourceProblemId)?.display_label||i.sourceProblemId} ／ 根拠答案 #{i.sourceAttemptId}</p>}
   <ol className="transfer-mini-steps" aria-label="保存された進み具合">{['生成','品質','解答','採点'].map((s,n)=>{const index={generation:0,quality:1,answer:2,grading:3,result:4,pending:1}[i.phase];return <li key={s} className={n<index?'passed':n===index?'current':''}>{n<index?'✓ ':''}{s}</li>})}</ol>
   {i.sourceChanged&&!i.sourceHidden&&<p className="source-change">元答案は保存当時の #{i.sourceAttemptId} です。現在は #{i.latestSourceAttemptId} まで記録があります。対象操作との対応を品質確認で再点検し、根拠は自動で付け替えません。</p>}{i.sourceMissing&&<p role="alert">元答案の有効性を確認できません。原記録は保持しています。再開時に根拠を確認してください。</p>}{i.reason&&<p>{i.sourceHidden?'品質・根拠の再確認が必要です。再開画面で確認してください。':i.reason}</p>}{i.outcome&&<p>対象操作：{i.outcome==='success'?'自力成功（生成課題）':i.outcome==='failure'?'未達':i.outcome==='assisted'?'援助あり':i.outcome==='uncertain'?'判定不能':i.outcome}</p>}
   <div className="button-row"><button className="primary" onClick={()=>onOpen(i.key)}>{i.phase==='result'?'採点結果を見る':i.phase==='quality'?'品質確認を再開':i.phase==='generation'?'生成を再開':i.phase==='grading'?'採点を再開':'問題と次の操作を開く'}</button>{!i.sourceHidden&&<button className="ghost" onClick={()=>onSource(i.sourceAttemptId)}>元答案の根拠・補修</button>}</div></article>)}
  {!!candidates.length&&<section className="panel"><h3>補修・遅延確認後の候補</h3>{candidates.map(t=><div className="history" key={t.transfer_training_key}><span>{t.title}</span><button className="ghost" onClick={()=>onOpen(t.transfer_training_key!)}>別問題の確認へ</button></div>)}</section>}
  {!!warnings.length&&<details className="panel"><summary>保管中の旧記録の確認</summary>{warnings.map(w=><p key={w}>{w}</p>)}</details>}
 </div>;
}
