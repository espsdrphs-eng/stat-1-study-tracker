import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,BookOpen,CheckCircle2,Clock3,Layers3,Sparkles,Target} from 'lucide-react';
import type {Bootstrap} from './types';
import {api,post} from './api';
import {RawGPTArchive} from './RawGPTArchive';
import {CAPABILITY_SYLLABUS,capabilityCatalog,capabilityDomains,capabilityStates,capabilityKinds,capabilityScope,capabilitySearchText,type CapabilityState} from './capabilityCatalog';
import {projectCapabilityMap,capabilityDate,isInitialAllCapabilityContext,type CapabilityRecord, type buildCapabilityContext} from './capabilityEvidence';
import './capabilityWorkspace.css';
type View=ReturnType<typeof projectCapabilityMap>;
type Ability=View['abilities'][number];
type Run=(action:()=>Promise<unknown>,message:string)=>Promise<boolean>;
export type CapabilityFocus={domain?:string;ability?:string};
const stateKeys=Object.keys(capabilityStates) as CapabilityState[];
const shortDate=(s?:string)=>s?capabilityDate(s):'未記録';
const colors:Record<CapabilityState,string>={unconfirmed:'#c5cedd',unrepaired:'#d8607d',immediate_confirmed:'#d99a32',delayed_transfer_confirmed:'#8a6bd1',exam_confirmed:'#239b80'};
const stateMark:Record<CapabilityState,string>={unconfirmed:'?',unrepaired:'!',immediate_confirmed:'↻',delayed_transfer_confirmed:'↗',exam_confirmed:'✓'};
function StateTag({state,pending=false}:{state:CapabilityState;pending?:boolean}){return <span className={`cap-state ${state}`}><span aria-hidden="true">{stateMark[state]}</span>{pending?'未確定・要確認':capabilityStates[state]}</span>}
function Distribution({counts,total}:{counts:View['counts'];total:number}){
 let offset=0;
 return <div className="cap-distribution"><svg viewBox="0 0 120 120" role="img" aria-label={`能力の状態分布。母集団${total}操作、${stateKeys.map(k=>`${capabilityStates[k]}${counts[k]}件`).join('、')}`}><circle cx="60" cy="60" r="43" fill="none" stroke="#eff2f7" strokeWidth="12"/>{stateKeys.filter(k=>counts[k]>0).map(k=>{const value=100*counts[k]/total,o=offset;offset+=value;return <circle key={k} cx="60" cy="60" r="43" pathLength="100" fill="none" stroke={colors[k]} strokeWidth="12" strokeDasharray={`${value} ${100-value}`} strokeDashoffset={-o} transform="rotate(-90 60 60)"/>})}<text x="60" y="58" textAnchor="middle" className="cap-ring-value">{total-counts.unconfirmed}<tspan className="cap-ring-unit"> / {total}</tspan></text><text x="60" y="75" textAnchor="middle" className="cap-ring-caption">根拠を確認</text></svg><div className="cap-legend">{stateKeys.map(k=><div key={k}><span style={{background:colors[k]}} aria-hidden="true"/><span>{capabilityStates[k]}</span><b>{counts[k]}</b></div>)}</div></div>;
}
export function CapabilityDashboard({data,onMap,onGPT,onHistory,onSchedule,onOldSchedule,onFormal}:{data:Bootstrap;onMap:(focus?:CapabilityFocus)=>void;onGPT:()=>void;onHistory:()=>void;onSchedule:()=>void;onOldSchedule:()=>void;onFormal:()=>void}){
 const map=useMemo(()=>projectCapabilityMap(data,data.capabilityRecords||[]),[data]);
 const last=[...(data.capabilityRecords||[])].sort((a,b)=>Date.parse(b.wire.evaluated_at)-Date.parse(a.wire.evaluated_at))[0];
 const previousDiagnosis=data.coach.current;
 const newAnswers=last?.sourceCutoffAttemptId===undefined?0:data.attempts.filter(a=>a.id>last.sourceCutoffAttemptId!&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id).length;
 const priority=map.priorities,proposals=map.checks.slice(0,3);
 const changes=map.abilities.filter(a=>a.current).sort((a,b)=>Date.parse(b.current!.record.wire.evaluated_at)-Date.parse(a.current!.record.wire.evaluated_at)).slice(0,4);
 return <div className="cap-workspace capability-dashboard" aria-label="数学的能力の現在地">
  <section className="cap-hero"><div className="cap-hero-copy"><span className="cap-eyebrow"><Layers3 size={16}/> STATISTICAL MATHEMATICS</span><h2>できることを、<br/>証拠で見渡す。</h2><p>問題数ではなく、数学的な操作の確認状況。<br/>GPTが指導し、ここに学習の証拠を残します。</p><div className="button-row"><button className="primary" onClick={onGPT}><Sparkles size={17}/> GPTと学習・評価を続ける</button><button className="ghost" onClick={()=>onMap()}>能力を探す <ArrowUpRight size={16}/></button></div><small>{last?`能力評価を保存：${shortDate(last.wire.evaluated_at)}`:'能力マップへの評価はまだありません。旧履歴から推測で習得認定しません。'}</small></div><Distribution counts={map.counts} total={map.total}/></section>
  {newAnswers>0&&<section className="cap-warning"><strong>前回の能力評価後に、新しい採点が{newAnswers}件あります。</strong><p>能力への影響はまだGPT評価に反映していません。得点だけで状態を変更しません。</p><button className="text-btn" onClick={onGPT}>新しい証拠をGPTへ渡す →</button></section>}
  <section className="cap-kpis home-kpis" aria-label="能力の確認状況"><button onClick={()=>onMap()}><span>能力マップ</span><strong>{map.total}<small>操作</small></strong><small>公式範囲を操作へ分解</small></button><button className="rose" onClick={()=>onMap()}><span>未修復</span><strong>{map.counts.unrepaired}<small>操作</small></strong><small>GPT評価・根拠あり</small></button><button className="amber" onClick={()=>onMap()}><span>直後再現を確認</span><strong>{map.counts.immediate_confirmed}<small>操作</small></strong><small>遅延転移とは別段階</small></button><button className="purple" onClick={()=>onMap()}><span>遅延転移 / 実戦</span><strong>{map.counts.delayed_transfer_confirmed}<i>/</i>{map.counts.exam_confirmed}</strong><small>各段階の確認数</small></button></section>
  <div className="cap-two-column"><section className="cap-panel"><div className="cap-section-heading"><h3><Target size={18}/> 現在の重点課題</h3><button onClick={()=>onMap()} className="text-btn">根拠を見る →</button></div>{priority.length?priority.slice(0,3).map(a=><button className="cap-priority-row" key={a.id} onClick={()=>onMap({ability:a.id})}><StateTag state={a.state}/><strong>{a.name}</strong><span>{a.current?.item.first_error||a.current?.item.judgement}</span>{a.recurrence&&<small>再発の評価あり</small>}</button>):<p className="cap-empty">未修復と確定した操作はまだありません。<br/>「全部できる」という意味ではなく、未確認領域が残っています。</p>}{!last&&previousDiagnosis&&<details className="cap-prior"><summary>保存済みの総合診断（能力への対応は未確定）</summary><p>{previousDiagnosis.primaryBottleneck.title}</p><small>{shortDate(previousDiagnosis.reviewedAt)}のGPT所見。新しい能力評価・原答案との照合が必要です。</small></details>}</section>
   <section className="cap-panel"><div className="cap-section-heading"><h3><Clock3 size={18}/> 次に確認すること</h3><button className="text-btn" onClick={onSchedule}>予定へ →</button></div>{proposals.length?proposals.map(({ability:a,check})=><button className="cap-proposal" key={a.id} onClick={()=>onMap({ability:a.id})}><small>{check.due_date||'日付は未定'} · GPTの提案</small><strong>{check.task}</strong><span>{capabilityKinds[check.kind]} ／ {a.name}</span></button>):<><p className="cap-empty">GPTと確認する操作・時期を決め、<br/>評価結果と一緒に保存します。</p><button className="ghost" onClick={onGPT}>学習記録をGPTへ渡す</button><button className="text-btn" onClick={onOldSchedule}>以前の復習予定も確認する →</button></>}<small>予定提案は既存Reviewを上書きしません。日次ノルマ・時間上限はありません。</small></section></div>
  <section aria-label="統計数理の能力マップ"><div className="cap-section-heading"><div><span className="cap-eyebrow">KNOWLEDGE MAP</span><h2>統計数理の全体像</h2></div><small>{map.counts.unconfirmed} / {map.total} 操作は未確認</small></div><p className="cap-section-note">分野をタップして操作と根拠へ。色は習得率ではなく、保存されたGPT評価の段階です。</p><div className="cap-domain-grid">{map.domains.map(d=><article className="cap-domain" key={d.id} style={{'--domain-color':d.color} as React.CSSProperties}><button className="cap-domain-head" onClick={()=>onMap({domain:d.id})}><span className="cap-domain-icon" aria-hidden="true">{d.icon}</span><span><strong>{d.name}</strong><small>{d.total-d.counts.unconfirmed} / {d.total} 操作に確認済みの根拠</small></span><ArrowUpRight size={17}/></button><div className="cap-domain-track" role="img" aria-label={`${d.name}：${stateKeys.map(k=>`${capabilityStates[k]} ${d.counts[k]} / ${d.total}`).join('、')}`}>{stateKeys.filter(k=>d.counts[k]>0).map(k=><span key={k} style={{width:`${100*d.counts[k]/d.total}%`,background:colors[k]}}/>)}</div><div className="cap-heatmap" aria-label={`${d.name}の操作`}>{d.abilities.map(a=><button key={a.id} className={a.state} title={`${a.name}：${capabilityStates[a.state]}`} aria-label={`${a.name}：${capabilityStates[a.state]}`} onClick={()=>onMap({ability:a.id})}>{stateMark[a.state]}</button>)}</div><small>{d.counts.unconfirmed===d.total?'まだ評価がありません':`未修復 ${d.counts.unrepaired} ／ 直後 ${d.counts.immediate_confirmed} ／ 遅延 ${d.counts.delayed_transfer_confirmed} ／ 実戦 ${d.counts.exam_confirmed}`}</small></article>)}</div><small className="cap-method-note">母集団：このマップの{map.total}操作。公式の能力配点・合格率ではありません。全体の理解率には換算しません。<a href={CAPABILITY_SYLLABUS.url} target="_blank" rel="noreferrer">公式範囲表</a>（統計数理部分）を基にしたアプリ独自の操作分解です。</small></section>
  <section className="cap-panel"><div className="cap-section-heading"><h3><CheckCircle2 size={18}/> 最近の評価・変化</h3><button className="text-btn" onClick={onHistory}>答案履歴へ →</button></div>{changes.length?<div className="cap-change-grid">{changes.map(a=><button key={a.id} onClick={()=>onMap({ability:a.id})}><time>{shortDate(a.current!.record.wire.evaluated_at)}</time><strong>{a.name}</strong><StateTag state={a.state} pending={a.warnings.length>0}/><span>{a.recurrence?'再発の評価':a.improved?'以前の評価から改善':a.history.length>1?'評価を更新':'能力として初めて記録'}</span></button>)}</div>:<p className="cap-empty">まだ能力ごとの評価を記録していません。過去の{data.attempts.length}件の答案は問題・答案履歴に保存されています。</p>}<small>直後・遅延転移・実戦は別の証拠です。採点範囲の異なる点数を平均して成長率にしません。</small></section>
  {!!data.capabilityRecordIssues?.length&&<section className="cap-warning" role="alert">{data.capabilityRecordIssues.map(s=><p key={s}>{s}</p>)}</section>}
  <button className="cap-formal-link" onClick={onFormal}><BookOpen size={19}/><span><strong>過去問の本番形式・保存済み測定</strong><small>能力評価・生成問題とは別に保持。AI採点の推定得点で、検定の公式得点ではありません。</small></span><ArrowUpRight size={18}/></button>
 </div>;
}

export function CapabilityExplorer({data,focus={},onGPT,onEvidence,onTrain,busy=false}:{data:Bootstrap;focus?:CapabilityFocus;onGPT:(id?:string)=>void;onEvidence:(id:number)=>void;onTrain?:(id:string)=>void;busy?:boolean}){
 const map=useMemo(()=>projectCapabilityMap(data,data.capabilityRecords||[]),[data]);
 const [query,setQuery]=useState(''),[domain,setDomain]=useState(focus.domain||'all'),[state,setState]=useState('all'),[selected,setSelected]=useState(focus.ability||'');
 useEffect(()=>{setDomain(focus.domain||'all');setSelected(focus.ability||'');setQuery('');setState('all')},[focus.domain,focus.ability]);
 const ability=map.abilities.find(a=>a.id===selected),shown=map.abilities.filter(a=>(domain==='all'||a.domainId===domain)&&(state==='all'||a.state===state)&&capabilitySearchText(a).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const open=(id:string)=>{setSelected(id);window.scrollTo({top:0,behavior:'smooth'})};
 return <div className="cap-workspace"><div className="cap-section-heading"><div><span className="cap-eyebrow">CAPABILITIES · {map.total} OPERATIONS</span><h2>知識・能力マップ</h2></div><button className="primary" onClick={()=>onGPT(ability?.id)}>GPTと確認する</button></div>
  {ability?<AbilityDetail ability={ability} data={data} onClose={()=>setSelected('')} onGPT={()=>onGPT(ability.id)} onEvidence={onEvidence} onRelated={open} onTrain={busy?undefined:onTrain}/>:<p className="cap-section-note">教材を解いた数ではなく、確認できた数学的操作を探せます。旧プロフィール・弱点メモの名前だけで自動分類していません。</p>}
  <div className="cap-filters"><label>能力を検索<input aria-label="能力を検索" placeholder="支持範囲・尤度・添字…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>分野<select aria-label="能力の分野" value={domain} onChange={e=>setDomain(e.target.value)}><option value="all">すべての分野</option>{map.domains.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>確認状態<select aria-label="能力の確認状態" value={state} onChange={e=>setState(e.target.value)}><option value="all">すべての状態</option>{stateKeys.map(k=><option key={k} value={k}>{capabilityStates[k]}</option>)}</select></label></div>
  <div className="cap-ability-grid">{shown.map(a=><button className="cap-ability-card" key={a.id} data-capability-id={a.id} onClick={()=>open(a.id)}><span className="cap-domain-caption">{map.domains.find(d=>d.id===a.domainId)!.name}</span><strong>{a.name}</strong><StateTag state={a.state} pending={a.warnings.length>0}/><span>{a.current?.item.first_error||a.criterion}</span><small>{a.current?`GPT評価 ${shortDate(a.current.record.wire.evaluated_at)} ／ 根拠 ${a.problemIds.length}問題`:'まだ評価がありません。理解不足とは判定しません。'}</small></button>)}</div>{!shown.length&&<p className="cap-empty">この条件に一致する能力はありません。</p>}
 </div>;
}
function AbilityDetail({ability:a,data,onClose,onGPT,onEvidence,onRelated,onTrain}:{ability:Ability;data:Bootstrap;onClose:()=>void;onGPT:()=>void;onEvidence:(id:number)=>void;onRelated:(id:string)=>void;onTrain?:(id:string)=>void}){
 const e=a.current?.item;
 return <section className="cap-panel cap-detail" aria-label="能力の詳細"><div className="cap-section-heading"><StateTag state={a.state} pending={a.warnings.length>0}/><button className="ghost" onClick={onClose}>一覧へ戻る</button></div><h2>{a.name}</h2><p>{a.criterion}</p>{e?<><div className="cap-judgement"><strong>GPTの評価 · {shortDate(a.current!.record.wire.evaluated_at)}</strong><p>{e.judgement}</p>{e.first_error&&<p><b>最初の誤り：</b>{e.first_error}</p>}{e.cause_hypothesis&&<details><summary>原因の仮説（事実とは区別）</summary><p>{e.cause_hypothesis}</p></details>}</div>{a.warnings.length>0&&<div className="cap-warning" role="status"><strong>提案された段階は「{capabilityStates[e.state]}」。次の理由で未確定として保持しています。</strong><ul>{a.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
   <div className="cap-stage-path" aria-label="段階は別々に確認">{stateKeys.map(k=><div key={k} className={k===a.state?'current':''}><b>{stateMark[k]}</b><span>{capabilityStates[k]}</span></div>)}</div><small>後の段階を確認しても、未測定の前段階の実施記録を作りません。</small>
   <h3>根拠となる答案</h3>{e.evidence.map((s,i)=>{const original=data.attempts.find(r=>r.id===s.attempt_id);return <div className="cap-source" key={`${s.attempt_id}:${i}`}><div><strong>{original?.problem_id||'参照先がありません'} · 答案 #{s.attempt_id}</strong><small>{original?.date||'日付未記録'} ／ {capabilityKinds[s.kind]} ／ {s.outcome==='success'?'成功':s.outcome==='failure'?'未達':s.outcome==='partial'?'部分成功':'判定保留'}</small><p>{s.observation}</p><small>採点範囲：{s.part_ids.join(' / ')||'旧記録・範囲未確認'} ／ 参照：{original?.hint_used?'ヒントあり':(original?.actual_reference_level??original?.reference_level)===0?'参照レベル0':'あり・未記録'}</small></div><button className="ghost" onClick={()=>onEvidence(s.attempt_id)}>答案・採点を見る</button></div>})}
   {e.next_check&&<div className="cap-next-detail"><span className="cap-eyebrow">GPTの次回確認 · {e.next_check.due_date||'日時未定'}</span><h3>{e.next_check.task}</h3><p>成功条件：{e.next_check.success_condition}</p><small>{capabilityKinds[e.next_check.kind]}。既存Reviewは変更していません。</small></div>}
  </>:<p className="cap-empty">この能力は未確認です。過去答案と対応付けたGPT評価を保存すると、根拠・最初の誤り・次回確認がここに並びます。</p>}
  <details><summary>含まれる知識・公式範囲の対応</summary>{capabilityScope(a).map(s=><p key={s.id}><strong>{s.name}</strong>：{s.keywords}</p>)}<small>この分類のすべてを一度に習得認定するものではありません。評価は根拠に明記された操作・範囲だけに限定します。</small></details>
  {!!a.newerLinkedAnswers.length&&<p className="cap-warning">新しい関連答案 {a.newerLinkedAnswers.map(id=>`#${id}`).join(' / ')} があります。能力評価は自動で上げ下げせず、GPTの再評価を待っています。</p>}
  <div className="button-row"><button className="primary" onClick={onGPT}>この能力をGPTで確認・更新</button>{onTrain&&e?.next_check?.kind==='delayed_transfer'&&<button className="ghost" disabled={a.warnings.length>0} onClick={()=>onTrain(a.id)}>この能力を指定して練習</button>}</div>
  {!!a.relatedIds.length&&<div className="cap-related"><span>関連する操作</span>{a.relatedIds.map(id=><button key={id} className="text-btn" onClick={()=>onRelated(id)}>{capabilityCatalog.find(c=>c.id===id)!.name} →</button>)}</div>}
  {!!a.history.length&&<details><summary>GPT評価の履歴 {a.history.length}件（原記録は保持）</summary>{a.history.map(h=><div className="cap-history" key={h.record.id}><time>{shortDate(h.record.wire.evaluated_at)}</time><StateTag state={h.item.effectiveState} pending={!!h.item.warnings.length}/><p>{h.item.judgement}</p><small>根拠答案：{h.item.evidence.map(s=>`#${s.attempt_id}`).join(' / ')||'なし'}</small></div>)}</details>}
 </section>;
}

export function CapabilityChecks({data,onAbility,onGPT}:{data:Bootstrap;onAbility:(id:string)=>void;onGPT:()=>void}){
 const map=useMemo(()=>projectCapabilityMap(data,data.capabilityRecords||[]),[data]);
 return <section className="cap-panel cap-workspace" aria-label="GPTが提案した次回確認"><div className="cap-section-heading"><div><span className="cap-eyebrow">NEXT EVIDENCE</span><h2>次の再現・転移確認</h2></div><button className="primary" onClick={onGPT}>GPTと予定を確認</button></div>{map.checks.length?map.checks.map(({ability:a,check})=><article className="cap-schedule-row" key={a.id}><time>{check.due_date||'日時未定'}{check.due_date&&check.due_date<data.dashboard.today&&<b>期日を過ぎた提案</b>}</time><div><strong>{check.task}</strong><p>{a.name} ／ {capabilityKinds[check.kind]}</p><small>成功条件：{check.success_condition}</small></div><button className="ghost" onClick={()=>onAbility(a.id)}>根拠・実施方法</button></article>):<p className="cap-empty">能力に紐付いたGPTの次回提案は未登録です。既存の復習・転移記録は引き続き下で確認できます。</p>}<small>GPTの提案を日付順に表示。実施しただけ・期日到来だけでは完了しません。新しいGPT評価で現在の提案が更新され、前の提案は評価履歴に残ります。</small></section>;
}

/** Bidirectional links reuse the same saved evidence; no keyword/title based
 * classification of old materials and no second grading record. */
export function CapabilityAssociations({data,problemId,onAbility}:{data:Bootstrap;problemId:string;onAbility?:(id:string)=>void}){
 const links=useMemo(()=>{
  const map=projectCapabilityMap(data,data.capabilityRecords||[]),ids=new Set(data.attempts.filter(a=>a.problem_id===problemId).map(a=>a.id));
  const planned=data.problems.find(p=>p.problem_id===problemId)?.generated_transfer?.lineage.capabilityEvaluation?.abilityId;
  return map.abilities.filter(a=>a.id===planned||a.history.some(h=>h.item.evidence.some(s=>ids.has(s.attempt_id))));
 },[data,problemId]);
 const content=data.problems.find(p=>p.problem_id===problemId)?.generated_transfer;
 if(content?.lineage.noncuedRequestId&&!content.answer_submission)return <section className="cap-associations"><p>非誘導型の確認です。対象能力・由来は自力答案の固定後に表示します。</p></section>;
 return <section className="cap-associations"><h3>この教材と関連する能力</h3>{links.length?links.map(a=><div key={a.id}><strong>{a.name}</strong><StateTag state={a.state} pending={a.warnings.length>0}/>{onAbility&&<button className="text-btn" onClick={()=>onAbility(a.id)}>能力の根拠と履歴 →</button>}</div>):<p>能力との対応は未分類です。問題名や得点だけで自動分類しません。</p>}<small>関連付けは検証対象またはGPT評価の証拠です。この教材全体の習得を意味しません。</small></section>;
}

function CapabilityPreviewEntries({record}:{record:CapabilityRecord}){
 const render=(e:CapabilityRecord['items'][number])=><div className="cap-preview-entry" key={e.ability_id}><strong>{capabilityCatalog.find(c=>c.id===e.ability_id)!.name}</strong><StateTag state={e.effectiveState} pending={e.warnings.length>0}/><p>{e.judgement}</p>{!!e.warnings.length&&<ul>{e.warnings.map(w=><li key={w}>{w}</li>)}</ul>}<small>根拠答案：{e.evidence.map(s=>`#${s.attempt_id}`).join(' / ')||'なし'} ／ 次回：{e.next_check?.due_date||'未定'}</small></div>;
 if(!isInitialAllCapabilityContext(record.wire.context_version))return <>{record.items.map(render)}</>;
 return <><p>全{capabilityDomains.length}分野・{capabilityCatalog.length}操作のうち、今回の評価は{record.items.length}件です。含まれない能力は変更しません。</p>{capabilityDomains.map(d=>{
  const items=record.items.filter(e=>capabilityCatalog.find(c=>c.id===e.ability_id)?.domainId===d.id);
  return items.length>0&&<details key={d.id} className="cap-preview-domain"><summary>{d.name}：{items.length}件（未確認・保留 {items.filter(e=>e.effectiveState==='unconfirmed').length}件）</summary>{items.map(render)}</details>;
 })}</>;
}

export function CapabilityExchange({data,run,busy,focusId}:{data:Bootstrap;run:Run;busy:boolean;focusId?:string}){
 const draftKey='stat1:capability-import-draft:v1';
 const [text,setText]=useState(()=>{try{return sessionStorage.getItem(draftKey)||''}catch{return ''}}),[preview,setPreview]=useState<{record:CapabilityRecord;duplicate:boolean}|null>(null),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[prompt,setPrompt]=useState(''),[working,setWorking]=useState(false);
 const [mode,setMode]=useState<'daily'|'all'|'initial'>('daily'),[domain,setDomain]=useState(capabilityCatalog.find(c=>c.id===focusId)?.domainId||capabilityDomains[0].id as string),[batch,setBatch]=useState(0);
 const initial=mode!=='daily',all=mode==='all';
 const [historyFile,setHistoryFile]=useState<Awaited<ReturnType<typeof buildCapabilityContext>>['historyAttachment']>();
 const domainRows=capabilityCatalog.filter(c=>c.domainId===domain),batches=Math.ceil(domainRows.length/12),dates=data.attempts.map(a=>a.date).sort();
 const active=useRef(false),version=useRef(0);
 useEffect(()=>{try{sessionStorage.setItem(draftKey,text)}catch{setError('入力の一時保存ができません。閉じる前に原文をコピーしてください。')}},[text]);
 useEffect(()=>{version.current++;setPreview(null);setConfirmed(false);setHistoryFile(undefined)},[data]);
 const contextPath=()=>'/api/capabilities/context?'+new URLSearchParams(initial?{initial:'1',domain:all?'all':domain,batch:all?'0':String(batch)}:focusId?{ability:focusId}:{});
 const downloadHistory=async()=>{if(active.current)return;active.current=true;setWorking(true);setError('');try{const c=await api<Awaited<ReturnType<typeof buildCapabilityContext>>>(contextPath()),file=c.historyAttachment;if(!file)throw Error('初回評価を選択してください。');setHistoryFile(file);const url=URL.createObjectURL(new Blob([file.text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('評価用の履歴JSONを用意しました。同じChatGPT会話へ添付してください。復元用バックアップではありません。')}catch(e){setError(e instanceof Error?e.message:String(e))}finally{active.current=false;setWorking(false)}};
 const copy=async()=>{
  if(active.current)return;active.current=true;setWorking(true);setError('');setMessage('');
  const request=api<Awaited<ReturnType<typeof buildCapabilityContext>>>(contextPath()).then(c=>{setHistoryFile(c.historyAttachment);return c});
  try{
   // Safari must receive the clipboard request within the original tap. The
   // asynchronously prepared text is delivered as a ClipboardItem promise.
   if(typeof ClipboardItem!=='undefined'&&navigator.clipboard?.write){
    const blob=request.then(c=>{setPrompt(c.prompt);return new Blob([c.prompt],{type:'text/plain'})});
    await navigator.clipboard.write([new ClipboardItem({'text/plain':blob})]);
   }else{const c=await request;setPrompt(c.prompt);await navigator.clipboard.writeText(c.prompt)}
   setMessage('学習の依頼をコピーしました。ChatGPT「勉強する」へ貼り付けてください。');
  }catch{try{const c=await request;setPrompt(c.prompt);setMessage('依頼を用意しました。下の欄を全選択してコピーしてください。')}catch(e){setError(e instanceof Error?e.message:String(e))}}
  finally{active.current=false;setWorking(false)}
 };
 const parse=async()=>{if(active.current)return;active.current=true;setWorking(true);setError('');setMessage('');const current=++version.current;
  try{const p=await post<{record:CapabilityRecord;duplicate:boolean}>('/api/capabilities/preview',{text});if(current===version.current){setPreview(p);setConfirmed(false)}}catch(e){setError(e instanceof Error?e.message:String(e))}finally{active.current=false;setWorking(false)}};
 const save=async()=>{if(active.current||!preview||!confirmed)return;active.current=true;setWorking(true);setError('');let receipt:{record:CapabilityRecord;duplicate:boolean}|undefined;
  try{const ok=await run(async()=>{try{receipt=await post('/api/capabilities/save',{text,confirmed:true});return receipt}catch(e){setError(e instanceof Error?e.message:String(e));throw e}},'GPTの能力評価を保存しました。答案・得点・既存Reviewは未変更です。');
   if(receipt){setPreview(null);setConfirmed(false);setMessage(receipt.duplicate?'同じ能力評価は保存済みです。重複追加しません。':ok?'能力評価とGPT回答原文を保存しました。ホームの能力マップに反映します。':'能力評価は保存済みです。表示更新に失敗したため再読み込みしてください。再保存しても重複しません。')}
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{active.current=false;setWorking(false)}
 };
 return <div className="cap-workspace cap-exchange"><section className="cap-panel"><span className="cap-eyebrow">1 · GPTが指導、アプリが記録</span><h2>学習を続け、能力評価を残す</h2><p>学習記録と能力マップを「勉強する」へ。出題・採点・最初の誤りの補修・次回確認をGPTと相談します。答案画像は自分でChatGPTに添付します。</p>
  <div className="cap-review-selection"><label>GPTへ渡す範囲<select aria-label="GPTへ渡す範囲" disabled={working||busy} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setPrompt('')}}><option value="daily">日常の学習・更新</option><option value="all">初回・全分野評価（1回で取り込み）</option><option value="initial">初回・分野別評価（全期間の証拠）</option></select></label>
   {mode==='initial'&&<><label>初回評価の分野<select aria-label="初回評価の分野" value={domain} disabled={working||busy} onChange={e=>{setDomain(e.target.value);setBatch(0);setPrompt('')}}>{capabilityDomains.map(d=><option key={d.id} value={d.id}>{d.name}（{capabilityCatalog.filter(c=>c.domainId===d.id).length}操作）</option>)}</select></label>{batches>1&&<label>評価する区分<select aria-label="初回評価の区分" value={batch} onChange={e=>{setBatch(Number(e.target.value));setPrompt('')}}>{Array.from({length:batches},(_,i)=><option key={i} value={i}>{i+1}/{batches}（{domainRows.slice(i*12,(i+1)*12).length}操作）</option>)}</select></label>}</>}
  </div><small>端末にある答案：{data.attempts.length}件 ／ 記録日：{dates[0]||'未登録'}〜{dates.at(-1)||'未登録'}。未取り込みの別日データは含みません。</small>
  {initial&&<><p>最初に履歴JSONを保存し、ChatGPTの同じ会話へ添付してください。{all?`全${capabilityDomains.length}分野・${capabilityCatalog.length}操作を一度に確認し、根拠のある能力だけを1つの評価JSONで保存します。未確認は埋めません。`:'分野ごとの依頼は短くコピーできます。1回最大12能力。成功・失敗を対話で照合し、保存後に次の分野へ進みます。'}</p><button className="ghost" disabled={working||busy} onClick={()=>void downloadHistory()}>初回履歴JSONを保存</button>{historyFile&&<small>{historyFile.name} ／ 有効答案{historyFile.answerCount}件。ファイル名が同じなら再添付は不要です。メモ数は失敗回数ではありません。</small>}</>}
  <button className="primary" disabled={working||busy} onClick={()=>void copy()}><Sparkles size={17}/>{working?'準備中…':all?'全分野の依頼をコピー':initial?'初回評価の依頼をコピー':'能力の学習情報をコピー'}</button>{focusId&&!initial&&<p>対象：{capabilityCatalog.find(c=>c.id===focusId)?.name||focusId}</p>}{prompt&&<details className="cap-copy-details"><summary>コピー用の依頼を表示</summary><textarea aria-label="能力評価のコピー用依頼" readOnly rows={6} value={prompt} onFocus={e=>e.currentTarget.select()}/><button className="ghost" onClick={()=>navigator.clipboard.writeText(prompt).then(()=>setMessage('依頼をコピーしました。')).catch(()=>setMessage('入力欄を全選択してコピーしてください。'))}>用意した依頼をコピー</button></details>}</section>
  <section className="cap-panel"><span className="cap-eyebrow">2 · 評価を確認して保存</span><h3>GPTの能力評価を戻す</h3><p>説明・補修は普通の文章で構いません。能力状態を反映するときだけ、依頼に含まれた形式のJSONを返してもらいます。問題の得点登録は「採点結果」です。</p><label>能力評価JSON<textarea aria-label="能力評価JSON" rows={7} value={text} disabled={working||busy} onChange={e=>{version.current++;setText(e.target.value);setPreview(null);setConfirmed(false);setError('');setMessage('')}} autoComplete="off"/></label><button className="ghost" disabled={!text.trim()||working||busy} onClick={()=>void parse()}>能力評価をプレビュー</button>
   {preview&&<section className="cap-preview" aria-label="能力評価の保存前確認"><h3>{preview.duplicate?'同じ評価は保存済みです':'反映する能力を確認'}</h3><CapabilityPreviewEntries record={preview.record}/><label className="check-line"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>能力・根拠・未確定事項を確認しました</label><button className="primary" disabled={!confirmed||working||busy} onClick={()=>void save()}>確認した能力評価を保存</button></section>}
   {error&&<div className="cap-warning" role="alert"><strong>入力は消していません。</strong><p>{error}</p><p>現在の依頼とこのエラーをChatGPTへ渡してJSONを再出力するか、下から原文だけ保管できます。欠けた値やIDをアプリが推測で埋めることはありません。</p></div>}
   {message&&<p role="status">{message}</p>}
   <details><summary>説明文・読み取れない返答を原文のまま保管</summary><RawGPTArchive problems={data.problems} run={run} busy={busy||working} text={text} onTextChange={v=>{setText(v);setPreview(null);setConfirmed(false)}} compact defaultKind="assessment"/></details>
  </section>
 </div>;
}
