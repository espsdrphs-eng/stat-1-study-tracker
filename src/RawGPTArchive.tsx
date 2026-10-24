import {useEffect,useRef,useState} from 'react';
import type {Problem} from './types';
import type {GPTExchange} from './gptExchange';
import {api,post} from './api';
type Run=(a:()=>Promise<unknown>,message:string)=>Promise<boolean>;

export function RawGPTArchive({problems,run,busy,text:externalText,onTextChange,compact=false,defaultKind,sourceAttempt}:{problems:Problem[];run:Run;busy:boolean;text?:string;onTextChange?:(text:string)=>void;compact?:boolean;defaultKind?:GPTExchange['kind'];sourceAttempt?:{id:number;problem_id:string}}){
 const draftKey='stat1:gpt-raw-draft:v1'+(sourceAttempt?`:attempt:${sourceAttempt.id}`:'');
 const read=()=>{try{return JSON.parse(sessionStorage.getItem(draftKey)||'null')}catch{return null}};
 const [localText,setLocalText]=useState<string>(()=>read()?.text||''),[problemId,setProblemId]=useState<string>(()=>sourceAttempt?.problem_id||read()?.problemId||''),[note,setNote]=useState<string>(()=>read()?.note||'');
 const [kind,setKind]=useState<GPTExchange['kind']>(defaultKind||(compact?'grading':'consultation')),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [rows,setRows]=useState<GPTExchange[]>([]),[query,setQuery]=useState(''),[limit,setLimit]=useState(20);
 const saving=useRef(false),text=externalText??localText;
 const load=()=>api<GPTExchange[]>('/api/gpt-exchanges').then(setRows).catch(e=>setError(String(e)));
 useEffect(()=>{void load()},[]);
 useEffect(()=>{setConfirmed(false);setMessage('')},[externalText]);
 useEffect(()=>{if(externalText!==undefined)return;try{sessionStorage.setItem(draftKey,JSON.stringify({text,problemId,note}))}catch{setError('一時保存できません。入力は画面に保持しています。閉じる前にコピーしてください。')}},[text,problemId,note,externalText]);
 const save=async()=>{
  if(saving.current)return;saving.current=true;setError('');
  try{let receipt:{record:GPTExchange;duplicate:boolean}|undefined;
   const ok=await run(async()=>{try{receipt=await post('/api/gpt-exchanges',{rawText:text,problemId:problemId||null,note,kind,confirmedByUser:confirmed,...(sourceAttempt?{sourceAttemptId:sourceAttempt.id}:{})});return receipt}catch(e){setError(e instanceof Error?e.message:String(e));throw e}},'GPT回答原文を保管しました（採点・学習状態は未変更）');
   if(ok&&receipt){setMessage(receipt.duplicate?'同じ原文と確認内容は保管済みです。重複追加していません。':'原文を保管しました。得点・習得・予定は変更していません。');setConfirmed(false);await load();}
  }finally{saving.current=false;}
 };
 return <section className="gpt-raw-archive" aria-label="GPT回答の原文保管">
  {!compact&&<><h3>返答を戻す</h3><p>説明や相談は文章のまま保管できます。採点は「採点結果」で内容を確認して保存します。</p><label>GPTの回答原文<textarea aria-label="GPTの回答原文" rows={7} value={text} onChange={e=>{if(onTextChange)onTextChange(e.target.value);else setLocalText(e.target.value);setConfirmed(false);setMessage('')}} autoComplete="off"/></label></>}
  <div className="gpt-confirm-fields"><label>用途<select aria-label="原文の用途" value={kind} onChange={e=>{setKind(e.target.value as GPTExchange['kind']);setConfirmed(false)}}><option value="consultation">学習相談・解説</option><option value="grading">採点の控え（未反映）</option><option value="planning">次回確認の相談</option><option value="assessment">総合評価の控え（未反映）</option></select></label>
   <label>{sourceAttempt?`元答案 #${sourceAttempt.id} の関連問題`:'関連する問題（任意）'}<select aria-label="原文の関連問題" disabled={!!sourceAttempt} value={problemId} onChange={e=>{setProblemId(e.target.value);setConfirmed(false)}}><option value="">問題を限定しない</option>{problems.map(p=><option key={p.problem_id} value={p.problem_id}>{p.display_label||p.title||p.problem_id}</option>)}</select></label>
   <label className="wide">確認メモ（任意）<input aria-label="原文の確認メモ" value={note} onChange={e=>{setNote(e.target.value);setConfirmed(false)}} placeholder="不足・訂正があれば記録。原文は変更しません"/></label></div>
  <label className="check-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>原文・対象を確認しました。採点や習得状態には反映しません。</label>
  <button className="primary" disabled={!text.trim()||!confirmed||busy} onClick={()=>void save()}>原文を保管する</button>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  <details className="raw-archive-history"><summary>保管した回答 {rows.length}件</summary><input aria-label="保管原文を検索" value={query} onChange={e=>{setQuery(e.target.value);setLimit(20)}} placeholder="問題・文章を検索"/>{rows.filter(r=>`${r.problemId||''} ${r.sourceAttemptId||''} ${r.note} ${r.rawText}`.includes(query)).slice(0,limit).map(r=><details key={r.id}><summary>{r.createdAt.slice(0,10)} ／ {r.problemId||'学習全体'}{r.sourceAttemptId?` ／ 元答案 #${r.sourceAttemptId}`:''} ／ {r.kind==='grading'?'採点の原文':r.kind==='planning'?'予定の相談':r.kind==='assessment'?'総合評価':'相談・解説'}</summary>{r.note&&<p>確認メモ：{r.note}</p>}<pre>{r.rawText}</pre></details>)}{rows.filter(r=>`${r.problemId||''} ${r.sourceAttemptId||''} ${r.note} ${r.rawText}`.includes(query)).length>limit&&<button className="ghost" onClick={()=>setLimit(n=>n+20)}>保管原文をさらに表示</button>}</details>
 </section>;
}

