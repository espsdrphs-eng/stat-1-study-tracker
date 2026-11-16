import {useEffect,useRef,useState} from 'react';
import {ClipboardPaste,Copy} from 'lucide-react';
import {api,post} from './api';
import {capabilityById,capabilityStates} from './capabilityCatalog';
import {dailyComparisonLabels,dailyKindLabels,dailyPartLabels,type DailyAssessmentDiff,type DailyPreview,type DailyReceipt,type StoredDailyAnswer} from './dailyLearningContract';
import type {buildDailyLearningSnapshot} from './dailyLearningSnapshot';
import {theoryAspects} from './capabilityTheory';

const draftKey='stat1:daily-learning-import:v1';
const getDraft=()=>{try{return sessionStorage.getItem(draftKey)||''}catch{return ''}};
const dateOfDraft=()=>{
 try{return (getDraft().match(/"learning_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1]||'')}catch{return ''}
};
const errorMessage=(e:unknown)=>e instanceof Error?e.message:String(e);

export function DailyMorningCopy(){
 const [pending,setPending]=useState(false),[fallback,setFallback]=useState(''),[feedback,setFeedback]=useState(''),[warning,setWarning]=useState(''),active=useRef(false);
 const copy=async(detailed=false)=>{
  if(active.current)return;active.current=true;setPending(true);setFeedback('');setWarning('');setFallback('');
  const draft=dateOfDraft(),q=new URLSearchParams();if(draft)q.set('draft',draft);if(detailed)q.set('detail','1');
  const query=q.toString(),path='/api/daily-learning/snapshot'+(query?'?'+query:'');
  const request=api<Awaited<ReturnType<typeof buildDailyLearningSnapshot>>>(path).then(x=>{setWarning(x.snapshot.previous_day.warning||'');return x.prompt});
  try{
   // On WebKit the clipboard call must start inside the tap, before waiting
   // for IndexedDB. Provide a direct-tap fallback if permissions are denied.
   if(typeof ClipboardItem!=='undefined'&&navigator.clipboard?.write)await navigator.clipboard.write([new ClipboardItem({'text/plain':request.then(v=>new Blob([v],{type:'text/plain'}))})]);
   else await navigator.clipboard.writeText(await request);
   setFeedback(detailed?'全75能力の詳しい情報をコピーしました。':'学習情報の短い版をコピーしました。ChatGPTに貼り付けてください。');
  }catch{try{setFallback(await request);setFeedback('自動コピーが許可されなかったため、下にコピー用の文面を用意しました。');}catch(e){setFeedback(errorMessage(e));}}
  finally{active.current=false;setPending(false);}
 };
 return <div className="daily-morning-copy"><button className="primary" onClick={()=>void copy()} disabled={pending}><Copy size={16}/>今日の学習情報をGPTへコピー</button>
  <details><summary>詳しい根拠が必要なとき</summary><button className="ghost" onClick={()=>void copy(true)} disabled={pending}>全75能力の詳しい情報をコピー</button></details>
  {(feedback||warning||pending)&&<div className="daily-action-message" aria-live="polite">{pending?'最新の答案と能力を照合しています…':feedback}{warning&&<small>{warning}</small>}</div>}
  {fallback&&<div className="daily-fallback"><label>コピー用の学習情報<textarea rows={4} readOnly value={fallback} onFocus={e=>e.currentTarget.select()}/></label>
   <button className="ghost" onClick={async()=>{try{await navigator.clipboard.writeText(fallback);setFeedback('学習情報をコピーしました。')}catch{setFeedback('上の欄をすべて選択してコピーしてください。')}}}>用意した学習情報をコピー</button></div>}
 </div>;
}

type Run=(a:()=>Promise<unknown>,label:string)=>Promise<boolean>;
type ImportResult=DailyReceipt|DailyPreview;
const stageLabel={adopted:'照合済み',held:'評価保留',evidence_only:'証拠のみ・段階の昇格なし',revalidated:'既存評価を再照合'} as const;
const outcomeLabels={success:'成功',failure:'未達',partial:'部分成功',uncertain:'判定不能'} as const;
const appLabels={success:'成功を確認',failure:'未達（部分成功を含む）',unconfirmed:'未確認'} as const;

function DailyEvidenceRows({entry,onEvidence}:{entry:DailyAssessmentDiff;onEvidence?:(id:number)=>void}){
 const frequency=entry.recurrence_comparison;
 return <><ul className="daily-observation-list">{entry.observations.map((o,i)=><li key={`${o.attempt_id}:${o.aspect}:${i}`}>
   <strong>{theoryAspects[o.aspect]}：{outcomeLabels[o.outcome]} → {appLabels[o.status]}</strong>
   <small>{dailyKindLabels[o.kind as keyof typeof dailyKindLabels]} ／ {o.part_ids.join(' / ')} ／ {onEvidence?<button className="text-btn" onClick={()=>onEvidence(o.attempt_id)}>答案 #{o.attempt_id}</button>:`答案 #${o.attempt_id}`}</small>
   {o.comparison&&<p>{o.comparison.accepted?dailyComparisonLabels[o.comparison.result]:'比較未確認'}（基準 #{o.comparison.against_attempt_id}）：{o.comparison.reason}</p>}
   <small>{o.reason}</small>
 </li>)}</ul>{frequency&&<p>{frequency.before_failures===null?'再発頻度は未確認':`比較した各${frequency.before.length}答案内の未達：${frequency.before_failures} → ${frequency.after_failures}件`} ／ {frequency.reason}</p>}</>;
}

function DailyDiff({value,saved,onEvidence}:{value:ImportResult;saved:boolean;onEvidence?:(id:number)=>void}){
 return <section className="cap-preview daily-diff" aria-label={saved?'日次学習の保存結果':'一括取り込みの差分'}>
  <h3>{saved?'日次学習の保存結果':'保存前の差分'}</h3>
  <p>{value.learning_date} ／ 問題 <b>{value.problems.length}</b> 件（新規 {value.problems.filter(p=>p.status==='new').length}） ／ 別答案 <b>{value.answers.length}</b> 件 ／ 評価保留 <b>{value.evaluations.filter(e=>e.status==='held').length}</b> 件</p>
  {value.source_status==='limited'&&<p className="cap-warning">確認できた引用だけを採点根拠にします。見ていない原答案の内容は補いません。</p>}
  {value.departure_reason&&<p><b>朝の候補と異なる選択：</b>{value.departure_reason}</p>}
  <ul className="cap-import-summary">{(Object.keys(capabilityStates) as (keyof typeof capabilityStates)[]).map(k=><li key={k}>{capabilityStates[k]} {value.before_counts[k]} → {value.after_counts[k]}</li>)}</ul>
  <details open={!saved}><summary>問題・答案IDと得点（{value.answers.length}答案）</summary>
   <div className="daily-id-list">{value.problems.map(p=><article key={p.ref}><h4>{p.title}</h4><small>{p.ref} → {p.problem_id}（{p.status==='new'?'新規':'既存の問題'}）</small>
    <ul>{value.answers.filter(a=>a.problem_id===p.problem_id).map(a=><li key={a.ref}>{dailyKindLabels[a.kind]} · {a.ref} → {saved&&onEvidence?<button className="text-btn" onClick={()=>onEvidence(a.attempt_id)}>答案 #{a.attempt_id}</button>:`答案 #${a.attempt_id}`}
     {a.baseline_attempt_id&&`（基準 #${a.baseline_attempt_id}）`} · {a.score?`${a.score.points}/${a.score.max}点`:'得点未記録'}</li>)}</ul></article>)}</div>
  </details>
  {!!value.coaching_without_answer.length&&<details><summary>指導のみ（新しい答案なし） {value.coaching_without_answer.length}件</summary><ul>{value.coaching_without_answer.map(c=><li key={`${c.baseline_attempt_id}:${c.ability_id}`}>{c.target} ／ 基準 #{c.baseline_attempt_id}：{c.guidance}{c.unconfirmed&&`（未確認：${c.unconfirmed}）`}</li>)}</ul></details>}
  {value.evaluations.length>0&&<details open={!saved}><summary>能力の据置・変更・保留（{value.evaluations.length}操作）</summary>
   {value.evaluations.map(e=><article className="cap-history" key={e.ability_id}><strong>{capabilityById.get(e.ability_id)?.name||e.ability_id} ／ {stageLabel[e.status]}</strong>
    <small>{capabilityStates[e.before]} → {capabilityStates[e.after]}{e.proposed&&`（GPT案：${capabilityStates[e.proposed]}）`}</small><p>{e.reason}</p>
    {e.next_check&&<small>次回：{e.next_check.due_date||'日時未定'} · {e.next_check.task} ／ {e.next_check.success_condition}</small>}
    {!!e.observations.length&&<details><summary>照合した根拠・比較</summary><DailyEvidenceRows entry={e} onEvidence={saved?onEvidence:undefined}/></details>}
   </article>)}
  </details>}
 </section>;
}

export function DailyLearningWorkspace({busy,run,onEvidence}:{busy:boolean;run:Run;onEvidence?:(id:number)=>void}){
 const [text,setText]=useState(getDraft),[working,setWorking]=useState(false),[preview,setPreview]=useState<DailyPreview|null>(null),[receipt,setReceipt]=useState<ImportResult|null>(null),
  [error,setError]=useState(''),[message,setMessage]=useState(''),[draftError,setDraftError]=useState(false),[noncued,setNoncued]=useState(false);
 const active=useRef(false);
 useEffect(()=>{let alive=true;void api<DailyReceipt|null>('/api/daily-learning/latest').then(r=>{if(alive&&r)setReceipt(prev=>prev??r)}).catch(()=>undefined);return()=>{alive=false}},[]);
 useEffect(()=>{try{if(text)sessionStorage.setItem(draftKey,text);else sessionStorage.removeItem(draftKey);setDraftError(false)}catch{setDraftError(!!text)}},[text]);
 const parse=async(value=noncued)=>{
  if(active.current||!text.trim())return;active.current=true;setWorking(true);setError('');setMessage('');setPreview(null);
  try{const p=await post<DailyPreview>('/api/daily-learning/preview',{text,confirmNoncued:value});
   if(p.duplicate){setReceipt(p);setMessage('同じセッションは保存済みです。答案や能力評価を重複登録しません。');}
   else setPreview(p);
  }catch(e){setError(errorMessage(e));}finally{active.current=false;setWorking(false);}
 };
 const save=async()=>{
  if(!preview||active.current)return;active.current=true;setWorking(true);setError('');setMessage('');
  try{
   let r:DailyPreview|undefined;const ok=await run(async()=>{
    try{return (r=await post<DailyPreview>('/api/daily-learning/save',{text,confirmationToken:preview.confirmationToken,confirmed:true,confirmNoncued:noncued}))}catch(e){setError(errorMessage(e));throw e;}
   },'今日の学習結果を一括保存しました');
   if(r){setReceipt(r);setPreview(null);setNoncued(false);setText('');setMessage(r.duplicate?'同じセッションは保存済みです。':ok?'問題・答案・能力の証拠とGPT原文を保存しました。翌朝のコピーに反映されます。':'保存済みです。表示を更新できなければ再読み込みしてください。');}
  }finally{active.current=false;setWorking(false);}
 };
 return <div className="cap-workspace daily-workspace"><section className="cap-panel"><span className="cap-eyebrow">朝 · 75能力の現在地</span><h2>今日の学習を始める</h2><p>最新の根拠と優先候補をChatGPTへ。学習と答案の提示はChatGPT側だけで進められます。</p><DailyMorningCopy/></section>
  <section className="cap-panel" aria-label="日次学習の一括取り込み"><span className="cap-eyebrow">夜 · 1つのJSONで記録</span><h2>今日の学習結果を一括取り込み</h2><p>ChatGPTに「今日の学習結果をアプリへ」と伝え、返ってきたJSONを1回貼り付けます。手書き画像の再登録は不要です。</p>
   <label className="daily-input-label">今日の学習結果JSON<textarea aria-label="今日の学習結果JSON" rows={7} value={text} disabled={busy||working} autoComplete="off" spellCheck={false} onChange={e=>{setText(e.target.value);setPreview(null);setError('');setNoncued(false);setMessage('')}}/></label>
   <button className="ghost" disabled={!text.trim()||busy||working} onClick={()=>void parse()}><ClipboardPaste size={16}/>差分をプレビュー</button>
   {working&&<span role="status"> 照合中…</span>}
   {draftError&&<p role="alert">原文をタブに一時保存できません。閉じる前にコピーしておいてください。</p>}
   {error&&<div className="cap-warning daily-error" role="alert"><strong>保存していません。入力原文は残っています。</strong><p>{error}</p><small>形式に問題がある場合は、ChatGPTに採点を変えず標準JSONを再出力させてください。</small></div>}
   {preview&&<><DailyDiff value={preview} saved={false}/>{preview.can_confirm_noncued&&<label className="check-line daily-proof"><input type="checkbox" checked={noncued} disabled={busy||working} onChange={e=>{const v=e.target.checked;setNoncued(v);void parse(v)}}/>
    別の品質確認が出題前に済み、答案を提出するまで対象・方法・解答・品質内容は見ていません。不明な場合は選択不要です。</label>}
    <button className="primary" disabled={busy||working||!!error} onClick={()=>void save()}>確認して一括保存</button></>}
   {message&&<p role="status">{message}</p>}
   {receipt&&!preview&&<details open={!!message}><summary>最後に確認した保存結果（{receipt.learning_date}）</summary><DailyDiff value={receipt} saved onEvidence={onEvidence}/></details>}
  </section></div>;
}

export function DailyAbilityHistory({id,onEvidence}:{id:string;onEvidence:(id:number)=>void}){
 type Row=DailyAssessmentDiff&{session_id:string;learning_date:string};
 const [state,setState]=useState<{id:string;rows:Row[];error?:string}>(),request=useRef(0);
 return <details onToggle={e=>{if(!e.currentTarget.open)return;const sequence=++request.current;
  void api<Row[]>('/api/daily-learning/ability?id='+encodeURIComponent(id)).then(rows=>{if(request.current===sequence)setState({id,rows});}).catch(err=>{if(request.current===sequence)setState({id,rows:[],error:errorMessage(err)});});}}>
  <summary>日次の根拠・改善・再発と保留</summary>{state?.id!==id?<p>照合中…</p>:state.error?<p role="alert">{state.error}</p>:state.rows.length===0?<p>この操作の日次記録はまだありません。</p>:state.rows.map(e=><article className="cap-history daily-ability" key={e.session_id}><time>{e.learning_date}</time><strong>{stageLabel[e.status]}{e.proposed&&` ／ GPT案：${capabilityStates[e.proposed]}`}</strong>
   <small>保存時 {capabilityStates[e.before]} → {capabilityStates[e.after]}</small><p>{e.reason}</p><DailyEvidenceRows entry={e} onEvidence={onEvidence}/></article>)}
 </details>;
}

export function DailyAnswerEvidence({answer:d}:{answer:StoredDailyAnswer}){
 const label=d.reference.level===null||d.reference.hint_used===null?'参照・ヒント条件未確認':d.reference.level===0&&!d.reference.hint_used?'参照・ヒントなし':'参照またはヒントあり';
 return <section className="daily-answer-facts" aria-label="日次答案の採点証拠"><strong>{dailyKindLabels[d.kind]} ／ {label}</strong>
  {d.baseline_attempt_id&&<p>基準答案 #{d.baseline_attempt_id}</p>}{d.source_status==='limited'&&<p>原答案の確認には限界があります。実際に読み取った引用だけを保存しています。</p>}
  <ul>{d.parts.map(f=><li key={f.part_id}><b>{f.part_id} · {dailyPartLabels[f.status]}{f.error_type!=='none'&&` (${f.error_type})`}</b>{f.quote&&<blockquote>{f.quote}</blockquote>}<p>{f.finding}</p></li>)}</ul>
  {d.first_error_part_id&&<p>最初の誤り：{d.first_error_part_id}{d.affected_part_ids.length>0&&` ／ 波及先：${d.affected_part_ids.join(' / ')}`}{d.independent_error_part_ids.length>0&&` ／ 独立した誤り：${d.independent_error_part_ids.join(' / ')}`}</p>}
  {d.repair&&<p>局所補修：{d.repair.target} — {d.repair.guidance}{d.repair.unconfirmed&&` ／ なお未確認：${d.repair.unconfirmed}`}</p>}
 </section>;
}
