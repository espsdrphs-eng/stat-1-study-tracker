import {useEffect,useState} from 'react';
import type {Bootstrap,PastSession} from './types';
import {pastExamIndividualResults,pastSessionResult,sessionSelectedIds,pastSessionSelectionComparison} from './pastExamGrading';
import {post} from './api';
import {derivePastExamProblemStart} from './pastExamPlanning';
type Props={data:Bootstrap;eligibleYears:number[];defaultYear?:number;focusSession?:{id:number};onImport:()=>void;onRepair:(problemId:string)=>void;onSaved:()=>void};
export function PastExamResults({data,eligibleYears,defaultYear,focusSession,onImport,onRepair,onSaved}:Props){
 const years=[...new Set(data.adaptiveLearning.pastExamCatalog.map(p=>p.year))].sort((a,b)=>b-a);
 const [year,setYear]=useState(defaultYear||eligibleYears[0]||years[0]),[chosen,setChosen]=useState([1,2,3]),[active,setActive]=useState<number|null>(null),[prompt,setPrompt]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[total,setTotal]=useState('');
 const [comparisonOpen,setComparisonOpen]=useState(false),[postProblem,setPostProblem]=useState('');
 const sessions=data.pastSessions.filter(s=>s.year===year&&!s.superseded_by_session_id&&s.session_kind==='selected_three_timed').sort((a,b)=>b.id-a.id);
 useEffect(()=>{const s=data.pastSessions.find(s=>s.id===focusSession?.id);if(s){setYear(s.year);setActive(s.id);setPrompt('');document.querySelector('.past-year-workspace')?.scrollIntoView({behavior:'smooth'})}},[focusSession]);
 const s=sessions.find(s=>s.id===active)||sessions[0],result=s?pastSessionResult(s,data.attempts):null;
 const comparison=s?pastSessionSelectionComparison(s,data.attempts):null;
 useEffect(()=>{setPostProblem('');setPrompt('');setComparisonOpen(false)},[s?.id,year]);
 const individual=pastExamIndividualResults(year,data.attempts);
 const unseen=data.adaptiveLearning.pastExamCatalog.find(p=>p.year===year&&p.simulationProtected&&!data.attempts.some(a=>a.problem_id===p.canonicalProblemId&&a.score_numeric!=null&&!a.exclude_from_metrics));
 const protection=unseen?derivePastExamProblemStart({problemId:unseen.canonicalProblemId,catalog:data.adaptiveLearning.pastExamCatalog,attempts:data.attempts,tasks:data.today.tasks,pastSessions:data.pastSessions,today:data.dashboard.today,daysRemaining:data.dashboard.pace.daysRemaining}):undefined;
 const canFinish=!!s&&(eligibleYears.includes(s.year)||!!s.prompt_scanned_at||!!s.attempt_started_at||!!s.attempt_completed_at);
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');setMessage('');try{await fn();onSaved()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 const copy=async(s:PastSession,pid:string,kind='prompt')=>action(async()=>{const r=await post<{prompt:string}>(`/api/past-sessions/${s.id}/grading`,{action:kind,problemId:pid});setPrompt(r.prompt);setPostProblem('');try{await navigator.clipboard.writeText(r.prompt);setMessage('コピーしました。ChatGPTへ問題資料と答案画像を直接添付してください。')}catch{setMessage('プロンプト内容を開き、全選択してコピーしてください。')}});
 const repair=s?data.today.tasks.find(t=>t.ranking?.eligible&&!t.checked&&!t.stable_session_key&&sessionSelectedIds(s).includes(t.problem_id)&&t.learning_purpose==='error_repair'):undefined;
 return <section className="past-year-workspace" aria-label="年度別の演習と成績">
  <header><h2>年度別の演習・成績</h2><p>紙・Goodnotesで解答し、ChatGPTの採点を取り込みます。</p></header>
  <div className="past-year-toolbar"><label>年度<select aria-label="演習年度" value={year} onChange={e=>{setYear(Number(e.target.value));setActive(null);setPrompt('');setError('');setMessage('')}}>{years.map(y=><option key={y} value={y}>{y}年</option>)}</select></label>
   {!!sessions.length&&<label>表示する演習<select aria-label="表示する演習" value={s?.id||''} onChange={e=>{setActive(Number(e.target.value));setPrompt('')}}>{sessions.map((s,i)=><option key={s.id} value={s.id}>{s.date}・{i===sessions.length-1?'初回':'再挑戦'}（#{s.id}）</option>)}</select></label>}
  </div>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <article className="panel past-year-dashboard" data-year={year}>
   <header><h3>{year}年 過去問演習</h3><span className="past-grade-status">{result?.status||'本番形式は未測定'}</span></header>
   <p>{individual.studiedCount}/5問 学習済み・解答履歴{individual.attemptCount}件。本番形式と個別学習は別に表示します。</p>
   <div className={`past-grade-summary ${s?'with-selection':''}`}><div><span>選択3問・本番100点換算</span><strong>{result?.examScore==null?(s?'未採点':'未測定'):`${Math.round(result.examScore*10)/10}点`}</strong><small>{!s?'個別の得点から本番点を推定しません':result&&result.gradedCount<3?`${result.gradedCount}/3問 採点済み`:'選択3問の得点率の平均'}</small></div><div><span>90分以内の完答</span><strong>{result?.timed?(result.timed.within?'確認済み':'未達'):'未判定'}</strong><small>scanを含む本番形式</small></div>{s&&<div><span>選択判断</span><strong>{comparison?.status}</strong><small>後日答案と本番は別条件</small></div>}</div>
   {!s&&<><h4>個別学習の初回記録</h4><div className="past-question-bars">{individual.questions.map(q=><div className="past-question-bar" key={q.problemId}><b>{q.label}</b><div><div className="past-score-track" role="progressbar" aria-label={`${q.label}の得点率`} aria-valuemin={0} aria-valuemax={100} {...(q.initial?.score==null?{'aria-valuetext':'未採点'}:{'aria-valuenow':q.initial.score})}><i style={{width:q.initial?.score==null?'0%':`${q.initial.score}%`}}/></div><small>{q.initial?`初回記録・${q.initial.attempt.date}`:q.history.length?'履歴あり・初回未特定':'未着手'}</small></div><strong>{q.initial?.score==null?'未採点':`${Math.round(q.initial.score)}%`}</strong></div>)}</div></>}
   {s&&comparison&&<section className="past-selection-comparison" aria-label="5問の採点と選択判断"><h4>問1〜問5の成績</h4><button className="ghost" aria-expanded={comparisonOpen} onClick={()=>setComparisonOpen(!comparisonOpen)}>選択判断を検証する</button>{comparisonOpen&&<p>{comparison.reason} 予想の記録時点は旧履歴では未確認です。未記録の値は補完しません。</p>}
    <div className="past-selection-table-scroll"><table aria-label="5問の比較"><thead><tr><th>問題</th><th>本番選択</th>{comparisonOpen&&<><th>予想得点</th><th>予想時間</th></>}<th>実際の得点率</th><th>解答時点</th>{comparisonOpen&&<th>予想との差・次回への確認</th>}<th>次の操作</th></tr></thead><tbody>{comparison.rows.map(q=><tr key={q.problemId} data-session-problem={q.problemId}><th>{q.label}</th><td>{q.selected?'選択':'未選択'}</td>{comparisonOpen&&<><td>{q.predictedScore==null?'未記録':`${q.predictedScore}%`}</td><td>{q.predictedMinutes==null?'未記録':`${q.predictedMinutes}分`}</td></>}<td><strong>{q.score==null?'未採点':`${Math.round(q.score*10)/10}%`}</strong></td><td>{q.answerTiming}</td>{comparisonOpen&&<td>{q.scoreDifference==null?'差は未測定':`${q.scoreDifference>0?'+':''}${q.scoreDifference}pt`}{q.answerTiming!=='本番中'&&'（条件差あり）'}<small>{q.comment}</small>{q.selectionReason&&<details><summary>選択理由の記録</summary>{q.selectionReason}</details>}</td>}<td>{q.attempt?<span>{q.selected?'本番採点済み':'後日・診断採点済み'}</span>:q.selected?<button className="primary" disabled={busy||!s.answer_finished_at&&!s.attempt_completed_at} onClick={()=>copy(s,q.problemId)}>{q.label}：本番採点プロンプトをコピー</button>:<button className="ghost" disabled={busy||!s.answer_finished_at&&!s.attempt_completed_at} onClick={()=>setPostProblem(q.problemId)}>{q.label}：後日解答・採点へ</button>}</td></tr>)}</tbody></table></div>
    {postProblem&&<section className="past-post-answer" aria-label="未選択問題の後日答案"><h4>{s.questions?.find(q=>q.problemId===postProblem)?.questionLabel}：選択判断の検証</h4><p>手元の原問題を開き、紙・Goodnotesで解答してください。本番後の独立した学習記録です。本番の選択3問・得点・時間は変えません。</p><button className="primary" disabled={busy} onClick={()=>copy(s,postProblem,'post-answer')}>答案完成・後日採点プロンプトをコピー</button><button className="ghost" onClick={()=>setPostProblem('')}>閉じる</button></section>}
   </section>}
   {!!individual.attemptCount&&<details className="past-individual-history"><summary>問題別の初回・補修・再挑戦履歴</summary><p>個別の得点率を本番100点へ合算しません。後の補修は初回得点を上書きしません。</p>{individual.questions.map(q=><details key={q.problemId}><summary>{q.label}・初回 {q.initial?.score==null?'未特定':`${Math.round(q.initial.score)}%`}・最新 {q.latest?.score==null?'未採点':`${Math.round(q.latest.score)}%`}・{q.history.length}記録</summary>{q.history.map(({attempt:a,score})=><p key={a.id}>{a.date} ／ {a.task_origin==='first_attempt'?'初回':a.learning_purpose==='error_repair'?'補修':a.learning_purpose==='retrieval_check'?'保持確認':a.learning_purpose==='transfer_check'?'転移':'演習・再挑戦'} ／ {score==null?'未採点':`${Math.round(score)}%`}（Attempt {a.id}）</p>)}</details>)}</details>}
   {s&&result&&<>
    {!!result.loss&&<details className="past-loss-card"><summary>最大の失点要因</summary><p>{result.loss}</p></details>}
    <div className="past-next-action"><strong>次の操作</strong>
     {result.status==='進行中'||result.status==='未実施'?<><p>選択問題を紙・Goodnotesで解答し、終了後に採点へ進みます。</p>
      <p>選択3問の答案を用意してください。未完の箇所はそのまま採点へ渡します。終了しただけでは完答・採点済みにはなりません。</p>
      <label>全体の正味時間（分・任意）<input type="number" min="0.1" step="any" value={total} onChange={e=>setTotal(e.target.value)} placeholder="未入力は不明"/></label>
      {!canFinish&&<p>この未開始の演習は保護・前提条件の確認が必要です。予定の保存だけでは開始資格になりません。</p>}
      <button className="primary" disabled={busy||!canFinish} onClick={()=>action(()=>post(`/api/past-sessions/${s.id}/grading`,{action:'finish',answeredProblemIds:sessionSelectedIds(s),totalMinutes:total}))}>演習を終了・ChatGPT採点へ</button></>:
     <><p>{result.status==='採点済み'?'採点結果は保存済みです。補修は本番成績と分けて記録します。':'選択答案を1問ずつ採点してください。途中で離れても、この演習から再取得できます。'}</p>
      <p>上の比較表から、本番答案と未選択問題の後日答案を区別して採点できます。</p>
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
   {!eligibleYears.includes(year)&&protection?.reasons.length? <ul>{protection.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>:null}
   <button className="primary" disabled={busy||chosen.length!==3||!eligibleYears.includes(year)} onClick={()=>action(async()=>{const r=await post<{sessionId:number}>('/api/past-sessions/start',{year,selectedQuestionNumbers:chosen});setActive(r.sessionId);setPrompt('');setTotal('')})}>3問を選んで演習開始</button>
  </details>
 </section>;
}
