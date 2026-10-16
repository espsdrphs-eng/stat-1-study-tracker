import {useEffect,useState} from 'react';
import type {Bootstrap,PastSession} from './types';
import {pastSessionResult,sessionSelectedIds} from './pastExamGrading';
import {post} from './api';
type Props={data:Bootstrap;eligibleYears:number[];defaultYear?:number;focusSession?:{id:number};onImport:()=>void;onRepair:(problemId:string)=>void;onSaved:()=>void};
export function PastExamResults({data,eligibleYears,defaultYear,focusSession,onImport,onRepair,onSaved}:Props){
 const years=[...new Set(data.adaptiveLearning.pastExamCatalog.map(p=>p.year))].sort((a,b)=>b-a);
 const [year,setYear]=useState(defaultYear||eligibleYears[0]||years[0]),[chosen,setChosen]=useState([1,2,3]),[active,setActive]=useState<number|null>(null),[prompt,setPrompt]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[total,setTotal]=useState('');
 const sessions=data.pastSessions.filter(s=>s.year===year&&!s.superseded_by_session_id&&s.session_kind==='selected_three_timed').sort((a,b)=>b.id-a.id);
 useEffect(()=>{const s=data.pastSessions.find(s=>s.id===focusSession?.id);if(s){setYear(s.year);setActive(s.id);setPrompt('');document.querySelector('.past-year-workspace')?.scrollIntoView({behavior:'smooth'})}},[focusSession]);
 const s=sessions.find(s=>s.id===active)||sessions[0],result=s?pastSessionResult(s,data.attempts):null;
 const canFinish=!!s&&(eligibleYears.includes(s.year)||!!s.prompt_scanned_at||!!s.attempt_started_at||!!s.attempt_completed_at);
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');setMessage('');try{await fn();onSaved()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 const copy=async(s:PastSession,pid:string)=>action(async()=>{const r=await post<{prompt:string}>(`/api/past-sessions/${s.id}/grading`,{action:'prompt',problemId:pid});setPrompt(r.prompt);try{await navigator.clipboard.writeText(r.prompt);setMessage('コピーしました。ChatGPTへ問題資料と答案画像を直接添付してください。')}catch{setMessage('下のプロンプトを全選択してコピーしてください。')}});
 const repair=s?data.today.tasks.find(t=>t.ranking?.eligible&&!t.checked&&!t.stable_session_key&&sessionSelectedIds(s).includes(t.problem_id)&&t.learning_purpose==='error_repair'):undefined;
 return <section className="past-year-workspace" aria-label="年度別の演習と成績">
  <header><h2>年度別の演習・成績</h2><p>紙・Goodnotesで解答し、ChatGPTの採点を取り込みます。</p></header>
  <div className="past-year-toolbar"><label>年度<select aria-label="演習年度" value={year} onChange={e=>{setYear(Number(e.target.value));setActive(null);setPrompt('');setError('');setMessage('')}}>{years.map(y=><option key={y} value={y}>{y}年</option>)}</select></label>
   {!!sessions.length&&<label>表示する演習<select aria-label="表示する演習" value={s?.id||''} onChange={e=>{setActive(Number(e.target.value));setPrompt('')}}>{sessions.map((s,i)=><option key={s.id} value={s.id}>{s.date}・{i===sessions.length-1?'初回':'再挑戦'}（#{s.id}）</option>)}</select></label>}
  </div>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <article className="panel past-year-dashboard" data-year={year}>
   <header><h3>{year}年 過去問演習</h3><span className="past-grade-status">{result?.status||'未実施'}</span></header>
   <div className="past-grade-summary"><div><span>選択3問・本番100点換算</span><strong>{result?.examScore==null?'未採点':`${Math.round(result.examScore*10)/10}点`}</strong><small>{result&&result.gradedCount<3?`${result.gradedCount}/3問 採点済み`:'選択3問の得点率の平均'}</small></div><div><span>90分以内の完答</span><strong>{result?.timed?(result.timed.within?'確認済み':'未達'):'未判定'}</strong><small>scanを含む本番形式</small></div></div>
   <h4>問1〜問5の成績</h4><div className="past-question-bars">{(result?.questions||[1,2,3,4,5].map(q=>({problemId:`PY-${year}-Q${q}`,label:`問${q}`,role:'未実施',score:null,selected:false}))).map(q=><div className="past-question-bar" key={q.problemId}><b>{q.label}</b><div><div className="past-score-track" role="progressbar" aria-label={`${q.label}の得点率`} aria-valuemin={0} aria-valuemax={100} {...(q.score==null?{'aria-valuetext':'未採点'}:{'aria-valuenow':q.score})}><i style={{width:q.score==null?'0%':`${q.score}%`}}/></div><small>{q.role}</small></div><strong>{q.score==null?'未採点':`${Math.round(q.score)}%`}</strong></div>)}</div>
   {s&&result&&<>
    {!!result.loss&&<details className="past-loss-card"><summary>最大の失点要因</summary><p>{result.loss}</p></details>}
    <div className="past-next-action"><strong>次の操作</strong>
     {result.status==='進行中'||result.status==='未実施'?<><p>選択問題を紙・Goodnotesで解答し、終了後に採点へ進みます。</p>
      <p>選択3問の答案を用意してください。未完の箇所はそのまま採点へ渡します。終了しただけでは完答・採点済みにはなりません。</p>
      <label>全体の正味時間（分・任意）<input type="number" min="0.1" step="any" value={total} onChange={e=>setTotal(e.target.value)} placeholder="未入力は不明"/></label>
      {!canFinish&&<p>この未開始の演習は保護・前提条件の確認が必要です。予定の保存だけでは開始資格になりません。</p>}
      <button className="primary" disabled={busy||!canFinish} onClick={()=>action(()=>post(`/api/past-sessions/${s.id}/grading`,{action:'finish',answeredProblemIds:sessionSelectedIds(s),totalMinutes:total}))}>演習を終了・ChatGPT採点へ</button></>:
     <><p>{result.status==='採点済み'?'採点結果は保存済みです。補修は本番成績と分けて記録します。':'選択答案を1問ずつ採点してください。途中で離れても、この演習から再取得できます。'}</p>
      <div className="past-grading-actions">{sessionSelectedIds(s).filter(pid=>!s.answered_problem_ids||s.answered_problem_ids.includes(pid)).map(pid=><button key={pid} className="primary" disabled={busy} onClick={()=>copy(s,pid)}>{s.questions?.find(q=>q.problemId===pid)?.questionLabel||pid}：採点プロンプトをコピー</button>)}</div>
      <button className="ghost" onClick={onImport}>採点結果JSON / YAMLを登録</button>
      {repair&&<button className="ghost" onClick={()=>onRepair(repair.problem_id)}>次の補修：{data.problems.find(p=>p.problem_id===repair.problem_id)?.display_label||repair.problem_id}</button>}
      {!repair&&result.loss&&<button className="ghost" onClick={()=>onRepair(s.questions?.find(q=>q.sourceAttemptId)?.problemId||'')}>失点箇所の補修候補・待機条件を見る</button>}
     </>}
    </div>
    <details><summary>演習の記録・非選択問題の区別</summary><p>{s.date}・演習 #{s.id}・選択：{sessionSelectedIds(s).join('、')}</p><p>問ごとの数値は100点満点の得点率です。非選択問題の診断と後日の補修は、選択3問の本番得点を上書きしません。</p></details>
   </>}
  </article>
  {prompt&&<section className="panel" aria-label="演習の採点プロンプト"><h3>ChatGPTで採点</h3><p>問題資料と紙・Goodnotesの答案画像をChatGPTに添付し、返された採点JSON / YAMLを登録してください。</p><textarea aria-label="演習の採点プロンプト" readOnly rows={6} value={prompt} onFocus={e=>e.currentTarget.select()}/><button className="primary" onClick={onImport}>採点結果を登録する</button><button className="ghost" onClick={()=>setPrompt('')}>閉じる</button></section>}
  <details className="panel past-new-session" open={!s}><summary>{s?'新しい演習・再挑戦を開始':'演習を開始'}</summary>
   <p>本番形式90分（scanを含む）。手元の原問題を開き、5問から3問を選びます。</p>
   <div className="past-answered">{[1,2,3,4,5].map(q=><label key={q}><input type="checkbox" checked={chosen.includes(q)} onChange={e=>setChosen(e.target.checked?[...chosen,q]:chosen.filter(v=>v!==q))}/>問{q}</label>)}</div>
   {!eligibleYears.includes(year)&&<p>この年度は現在の保護・前提条件により新規開始できません。Todayの待機条件を確認してください。保存済み演習の採点は再開できます。</p>}
   <button className="primary" disabled={busy||chosen.length!==3||!eligibleYears.includes(year)} onClick={()=>action(async()=>{const r=await post<{sessionId:number}>('/api/past-sessions/start',{year,selectedQuestionNumbers:chosen});setActive(r.sessionId);setPrompt('');setTotal('')})}>3問を選んで演習開始</button>
  </details>
 </section>;
}
