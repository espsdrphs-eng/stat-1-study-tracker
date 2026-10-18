import {useState} from 'react';
import './learningOverview.css';
import type {Bootstrap,Task} from './types';
import type {coachPreview} from './coachDiagnosis';
type CoachPreviewResult=ReturnType<typeof coachPreview>;
import {post} from './api';
import {deriveLearningOverview,overviewNextTask,coachDashboardAdvice} from './learningOverview';
import {isCoachImportError} from './coachDiagnosis';
import {abilityStateLabels,deriveAbilityProfiles} from './abilityTraining';
import {deriveTaskAnswerScope,taskAnswerScopeText} from './taskAnswerScope';
const confidenceLabel=(value:string)=>value==='high'?'高':value==='medium'?'中':'低';

export function LearningDashboard({data,onStart,onReview,onEvidence}:{data:Bootstrap;onStart:(task?:Task)=>void;onReview:()=>void;onEvidence:()=>void}){
 const v=deriveLearningOverview(data),advice=coachDashboardAdvice(data),task=advice?.action?advice.task:overviewNextTask(data),problem=data.problems.find(p=>p.problem_id===task?.problem_id);
 const scope=problem&&task&&!task.stable_session_key&&!task.transfer_training_key?taskAnswerScopeText(deriveTaskAnswerScope({problem,task,attempts:data.attempts,overrides:data.taskAnswerScopeOverrides})):null;
 const gpt=data.coach.current&&!data.coach.stale&&data.coach.current.reviewContextVersion===data.coach.reviewContext?.version?data.coach.current:null;
 return <div className="learning-dashboard" aria-label="合格ダッシュボード">
  <header className="exam-countdown"><div><h2>合格ダッシュボード</h2><span>統計検定1級・統計数理</span></div><strong>本番まで {v.daysRemaining}日</strong></header>
  <section className="readiness-hero" aria-label="現在の合格準備状況"><div><span>現在の合格準備状況{advice?'・GPT総合診断':''}</span><h2>{advice?.readiness||v.judgement}</h2><p>{v.level===null?'本番形式の測定を待っています':`自動・暫定 Level ${v.level} / 5`}</p><small>合格確率ではありません。信頼度：{confidenceLabel(v.confidence)}</small>
   {gpt&&<p className="gpt-opinion" role="status">GPT参考評価：Level {gpt.level.value}（信頼度：{confidenceLabel(gpt.level.confidence)}）</p>}
   {!!advice?.changes.length&&<small className="coach-change-summary">前回評価からのGPT所見：{advice.changes[0]}</small>}
   <button className="text-btn" onClick={onEvidence}>評価の根拠・更新条件</button></div>
   <svg className="readiness-ring" viewBox="0 0 120 120" role="img" aria-label="合格準備状況ゲージ"><circle className="ring-track" cx="60" cy="60" r="49"/><circle className="ring-value" cx="60" cy="60" r="49" pathLength="100" strokeDasharray={`${v.level===null?0:v.level/5*100} 100`}/><text x="60" y="59" textAnchor="middle">{v.level??'―'}</text><text className="ring-unit" x="60" y="79" textAnchor="middle">{v.level===null?'未測定':'/ 5・暫定'}</text></svg>
  </section>
  <section className="exam-metric-bars" aria-label="合格に必要な3指標"><h3>合格に必要な能力</h3>{v.metrics.map(m=><div className={`exam-metric ${m.key}`} key={m.key}><div><strong>{m.label}</strong><b>{m.value===null?'未測定':`${Math.round(m.value)}%`}</b></div><div className="metric-track" role="progressbar" aria-label={m.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.value===null?undefined:m.value} aria-valuetext={m.value===null?'未測定':`${Math.round(m.value)}%・${m.detail}`}><span style={{width:`${m.value===null?0:Math.min(100,Math.max(0,m.value))}%`}}/></div><small>{m.detail}</small></div>)}</section>
  <div className="focus-action-grid"><section className="focus-action" aria-label="最大の課題"><span>最大の課題{advice?'・GPT所見':''}</span><h3>{advice?.bottleneck||v.bottleneck}</h3></section>
   <section className="focus-action" aria-label="次に取り組む課題"><span>次に取り組む課題{advice?.action?'・GPT提案':''}</span><h3>{advice?.action||(task?(task.transfer_training_key?'別問題での転移訓練':task.stable_session_key?task.title:problem?.display_label||problem?.title||task.problem_id):'現在の適格候補は完了しています')}</h3>{scope&&<p>{advice?.action&&problem?`${problem.display_label||problem.title||problem.problem_id} ／ `:''}{scope}</p>}{task?.stable_session_key&&advice?.action&&<p>{task.title}</p>}<button className="primary" onClick={()=>onStart(task)}>{task?'この課題を開く':advice?.action?'Todayで実行課題を確認':'Todayの待機条件を見る'}</button></section></div>
  <button className="primary reassess-button" onClick={onReview}>ChatGPTで実力を再評価</button>
 </div>;
}

/** Same existing Coach endpoints/history. A preview is never a save. */
export function CoachReviewControls({data,run,busy}:{data:Bootstrap;run:(action:()=>Promise<unknown>,message:string)=>void;busy:boolean}){
 const [text,setText]=useState(''),[preview,setPreview]=useState<CoachPreviewResult|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[copyFallback,setCopyFallback]=useState('');
 const copy=async()=>{try{await navigator.clipboard.writeText(data.coach.prompt);setMessage('コピーしました。ChatGPTへ貼り付け、評価JSONを戻してください。')}catch{setCopyFallback(data.coach.prompt);setMessage('下のプロンプトを選択してコピーしてください。')}};
 const parse=async()=>{setError('');setPreview(null);try{setPreview(await post<CoachPreviewResult>('/api/coach/preview',{text,require_current_evidence:true}))}catch(e){setError(isCoachImportError(e)?`${e.message} ${e.reason}`:e instanceof Error?e.message:String(e))}};
 const save=()=>run(async()=>{try{const result=await post<{duplicate:boolean}>('/api/coach/save',{text,require_current_evidence:true});setPreview(null);setMessage(result.duplicate?'同じ評価は保存済みです。重複追加していません。':'GPT総合診断を反映しました。実測得点・時間・答案は変更しません。');return result}catch(e){setError(e instanceof Error?e.message:String(e));throw e}},'GPT総合診断を確認しました');
 const training=preview?deriveAbilityProfiles({...data,coach:{...data.coach,current:preview.next}}):[];
 return <section className="coach-manual" aria-label="ChatGPTで実力を再評価"><p>現在の答案・本番測定・補修の証拠をコピーします。APIは使いません。</p><button className="primary" onClick={copy}>評価プロンプトをコピー</button>
  {message&&<p role="status">{message}</p>}{copyFallback&&<textarea aria-label="コピー用の評価プロンプト" readOnly value={copyFallback} onFocus={e=>e.currentTarget.select()}/>}
  <label>評価JSONを貼り付け<textarea aria-label="評価JSONを貼り付け" rows={6} value={text} onChange={e=>{setText(e.target.value);setPreview(null);setError('')}} autoComplete="off"/></label>
  <button className="ghost" disabled={!text.trim()||busy} onClick={parse}>評価をプレビュー</button>{error&&<p role="alert">{error}</p>}
  {preview&&<section className="coach-result-preview" aria-label="評価のプレビュー"><h3>GPT参考評価：Level {preview.next.level.value}</h3><p>{preview.next.level.label} ／ 信頼度：{confidenceLabel(preview.next.level.confidence)}</p>{preview.next.level.rationale&&<p>{preview.next.level.rationale}</p>}<p>最大課題：{preview.next.primaryBottleneck.title}</p><p>次の行動：{preview.next.nextActions[0]?.title||'提案なし'}</p>{preview.next.nextActions[0]?.successCondition&&<p>成功条件：{preview.next.nextActions[0].successCondition}</p>}{(preview.next.improvements.length>0||preview.next.unknowns.length>0)&&<details><summary>改善点・未測定の確認</summary>{preview.next.improvements.map((r,i)=><p key={`improvement:${i}`}>改善：{r.title}</p>)}{preview.next.unknowns.map((r,i)=><p key={`unknown:${i}`}>未確認：{r.title} ／ 必要な証拠：{r.evidenceNeeded}</p>)}</details>}<small>自動・暫定Level {data.dashboard.kpis?.assessment?.level??'未測定'}とは別の総合診断です。測定値・答案・転移実績は上書きしません。</small><button className="primary" disabled={busy} onClick={save}>確認して評価を反映</button></section>}
  {preview?.next.abilityProfiles&&<section aria-label="能力プロフィールのプレビュー"><h4>更新する能力プロフィール</h4>{preview.next.abilityProfiles.length?preview.next.abilityProfiles.map(p=><p key={p.id}><strong>{p.name}</strong>：{abilityStateLabels[p.state]}<br/>次の検証：{p.next}</p>):<p>能力はまだ特定できていません。</p>}</section>}
  {preview&&<section aria-label="訓練準備の確認" role="status">{training.some(p=>p.trainable)?<p>根拠付きの訓練プロフィールを利用できます。総合評価と訓練実績は別に保持します。</p>:<><strong>総合評価は保存できますが、訓練準備は未完了です。</strong>{training.map(p=><p key={p.id}>{p.reason}</p>)}<p>この評価の文章を再表示するだけでは問題作成できません。以下から現在の答案を含むプロンプトをコピーし、能力別の根拠を含めてChatGPTへ依頼してください。</p><button className="ghost" onClick={copy}>根拠付きプロフィールを依頼するプロンプトをコピー</button></>}</section>}
  <details><summary>過去の評価・自動評価との違い</summary><p>現在の自動評価：Level {data.dashboard.kpis?.assessment?.level??'未測定'}。GPT評価は助言として別に保持します。新しい採点や測定変更があれば古い評価を現在評価として使いません。</p>{data.coach.history.map((r,i)=><p key={`${r.reviewedAt}:${i}`}>{r.reviewedAt.slice(0,10)}：GPT Level {r.level.value} ／ {r.primaryBottleneck.title}</p>)}</details>
 </section>;
}
