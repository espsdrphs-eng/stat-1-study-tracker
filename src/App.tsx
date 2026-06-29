import { useEffect, useState } from "react";
import {
  AlertTriangle, Archive, BookOpen, CalendarCheck, Check, ChevronRight, ClipboardPaste,
  Clock3, Database, Download, Gauge, LayoutDashboard, ListChecks, Menu, NotebookPen,
  Play, Plus, RefreshCw, Search, Settings, Target, X
} from "lucide-react";
import yaml from "js-yaml";
import { api, post } from "./api";
import { csvFor, exportBackup, restoreBackup } from "./localDb";
import AdvancedImportView from "./AdvancedImportView";
import { problemDisplayLabel } from "./importParser";
import { createAttemptReviewPlan } from "./reviewRules";
import type { Attempt, Bootstrap, Problem, Review, StudyUpdate, Task } from "./types";

type Page = "dashboard"|"today"|"problems"|"attempt"|"import"|"reviews"|"weak"|"past"|"settings";
const pageTitles:Record<Page,string> = {
  dashboard:"ダッシュボード",today:"今日やること",problems:"問題一覧",attempt:"手入力（予備）",
  import:"GPT回答取り込み",reviews:"復習予定",weak:"弱点ノート",past:"過去問分析",settings:"設定"
};
const nav = [
  ["dashboard",LayoutDashboard],["today",ListChecks],["problems",BookOpen],["attempt",NotebookPen],
  ["import",ClipboardPaste],["reviews",CalendarCheck],["weak",AlertTriangle],["past",Target],["settings",Settings]
] as const;
const modes:Record<string,string>={skeleton:"骨格",main_calc:"主要計算",full:"フル答案",scan:"スキャン",exam_90min:"90分演習"};
const reviewNames:Record<string,string>={skeleton_retry:"骨格再現",main_calc_retry:"主要計算",full_retry:"フル再演習",careless_check:"チェックリスト確認",s_check:"S確認",past_exam_link:"過去問連動",past_exam_selection:"選題確認",past_exam_retry:"過去問補修"};
const todayString = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const blankUpdate = ():StudyUpdate => ({problem_id:"",date:todayString(),mode:"full",mark:"△",score_label:"B",error_type:"none",error_point:"",next_action:""});

function Badge({children,tone=""}:{children:React.ReactNode;tone?:string}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function ErrorBadge({value}:{value:string}) {
  return <Badge tone={`error-${value.toLowerCase()}`}>{value==="none"?"ミスなし":value}</Badge>;
}
function Metric({label,value,unit="",hint,tone=""}:{label:string;value:string|number;unit?:string;hint?:string;tone?:string}) {
  return <div className={`metric ${tone}`}><div className="metric-label">{label}</div><div className="metric-value">{value}<small>{unit}</small></div>{hint&&<div className="metric-hint">{hint}</div>}</div>
}
function Empty({children}:{children:React.ReactNode}) { return <div className="empty"><Archive size={30}/><p>{children}</p></div> }

export default function App() {
  const [data,setData]=useState<Bootstrap|null>(null);
  const [page,setPage]=useState<Page>("dashboard");
  const [menu,setMenu]=useState(false);
  const [selected,setSelected]=useState<Problem|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const load=async()=>{setError("");try{setData(await api<Bootstrap>("/api/bootstrap"));}catch(e){setError((e as Error).message)}};
  useEffect(()=>{load()},[]);
  const run=async(action:()=>Promise<unknown>,success:string)=>{setBusy(true);setError("");try{await action();setMessage(success);await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  const go=(next:Page)=>{setPage(next);setMenu(false);setSelected(null)};
  if(!data) return <div className="boot"><div className="spinner"/><strong>学習データを準備しています</strong>{error&&<p>{error}</p>}</div>;
  return <div className="app-shell">
    <aside className={`sidebar ${menu?"open":""}`}>
      <div className="brand"><div className="brand-mark">1</div><div><strong>統計一級</strong><span>STUDY TRACKER</span></div><button className="mobile-close" onClick={()=>setMenu(false)}><X/></button></div>
      <div className="today-mini"><span>今日の負荷</span><strong>{data.today.totalLoad.toFixed(1)}</strong><div className="load-track"><i style={{width:`${Math.min(100,data.today.totalLoad/4*100)}%`}}/></div><small>推奨上限 4.0</small></div>
      <nav>{nav.map(([key,Icon])=><button key={key} className={page===key?"active":""} onClick={()=>go(key)}><Icon size={19}/><span>{pageTitles[key]}</span>{key==="reviews"&&data.dashboard.pending>0&&<b>{data.dashboard.pending}</b>}</button>)}</nav>
      <div className="sidebar-foot"><Gauge size={17}/><div><span>2週間ペース</span><strong className={`pace-${data.dashboard.pace.label}`}>{data.dashboard.pace.label}</strong></div></div>
    </aside>
    {menu&&<div className="scrim" onClick={()=>setMenu(false)}/>}
    <main>
      <header><button className="menu-btn" onClick={()=>setMenu(true)}><Menu/></button><div><span className="eyebrow">{data.dashboard.today.replaceAll("-",".")}</span><h1>{selected?selected.problem_id:pageTitles[page]}</h1></div><button className="icon-btn" onClick={load} title="更新"><RefreshCw size={19}/></button></header>
      {(message||error)&&<div className={`toast ${error?"danger":""}`} onClick={()=>{setMessage("");setError("")}}>{error||message}<X size={16}/></div>}
      <div className="content">
        {selected?<ProblemDetail problem={selected} data={data} onBack={()=>setSelected(null)} onImport={()=>{setSelected(null);setPage("import")}}/>:
        page==="dashboard"?<DashboardView data={data} go={go}/>:
        page==="today"?<TodayView data={data} busy={busy} run={run} go={go}/>:
        page==="problems"?<ProblemsView data={data} select={setSelected} run={run} busy={busy}/>:
        page==="attempt"?<AttemptView problems={data.problems} run={run} busy={busy}/>:
        page==="import"?<AdvancedImportView problems={data.problems} run={run} busy={busy}/>:
        page==="reviews"?<ReviewsView data={data} run={run} busy={busy}/>:
        page==="weak"?<WeakView data={data} run={run} busy={busy}/>:
        page==="past"?<PastView data={data} go={go}/>:
        <SettingsView data={data} run={run} busy={busy}/>}
      </div>
    </main>
  </div>
}

function DashboardView({data,go}:{data:Bootstrap;go:(p:Page)=>void}) {
  const d=data.dashboard;
  const pastIds=new Set(data.problems.filter(problem=>problem.category==="past_exam").map(problem=>problem.problem_id));
  const pastAttemptCount=data.attempts.filter(attempt=>pastIds.has(attempt.problem_id)).length;
  const pastReviewCount=data.reviews.filter(review=>review.status!=="done"&&pastIds.has(review.problem_id)).length;
  const paceLabels=["A問題 10〜14題","過去問GPT採点 2件以上","K再発 2題以内","骨格再現率 80%以上","弱点ノート 週1回以上","3日超の遅延なし"];
  const nextTask=data.today.tasks.find(task=>!task.checked);
  return <>
    <section className="hero">
      <div><span className="eyebrow">NEXT ACTION</span><h2>{nextTask?.title||"本日の課題は完了です"}</h2><p>{nextTask?.reason||"記録を振り返り、次のロードマップを確認しましょう。"}</p></div>
      <button className="primary" onClick={()=>go("today")}><Play size={18}/> 今日の課題を見る</button>
    </section>
    {data.today.warning&&<div className="warning"><AlertTriangle/><div><strong>負荷オーバー</strong><p>{data.today.warning}</p></div></div>}
    <section className="section-head"><div><span className="eyebrow">OVERVIEW</span><h2>今週の学習状況</h2></div><span className="muted">直近7日間</span></section>
    <div className="metrics-grid">
      <Metric label="今日の負荷" value={data.today.totalLoad.toFixed(1)} unit="/ 4.0" hint={`${data.today.tasks.filter(task=>!task.checked).length}件の未完了課題`} tone={data.today.totalLoad>4?"red":""}/>
      <Metric label="A問題進捗" value={d.weekA} unit="題" hint="今週の新規・復習"/>
      <Metric label="過去問GPT採点" value={d.weekPast} unit="件" hint="今週の取り込み"/>
      <Metric label="K再発" value={d.kRecurrence} unit="題" hint="直近2週間" tone={d.kRecurrence>2?"red":""}/>
      <Metric label="復習待ち" value={d.pending} unit="件" hint={`うち遅延 ${d.overdue}件`} tone={d.overdue?"amber":""}/>
      <Metric label="S問題安定率" value={d.sStableRate} unit="%" hint={`要確認 ${d.sForgotten}件`}/>
    </div>
    <div className="two-col">
      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">TODAY</span><h3>今日やること</h3></div><button className="text-btn" onClick={()=>go("today")}>すべて見る <ChevronRight size={16}/></button></div>
        <div className="task-list">{data.today.tasks.slice(0,4).map((t,i)=><TaskRow key={`${t.problem_id}-${i}`} task={t}/>)}</div>
        {!data.today.tasks.length&&<Empty>今日が期限の課題はありません</Empty>}
      </section>
      <section className="panel pace-panel">
        <div className="panel-title"><div><span className="eyebrow">14 DAY CHECK</span><h3>合格ペース判定</h3></div><Badge tone={d.pace.label==="合格ペース"?"green":d.pace.label==="注意"?"orange":"red"}>{d.pace.label}</Badge></div>
        <div className="pace-score"><strong>{d.pace.checks.filter(Boolean).length}</strong><span>/ 6 基準を達成</span></div>
        <div className="check-grid">{paceLabels.map((x,i)=><div key={x} className={d.pace.checks[i]?"ok":""}>{d.pace.checks[i]?<Check size={15}/>:<X size={15}/>}<span>{x}</span></div>)}</div>
        {d.pace.suggestion&&<p className="pace-advice">{d.pace.suggestion}</p>}
      </section>
    </div>
    <section className="section-head weakness-heading">
      <div><span className="eyebrow">WEAKNESS ANALYSIS</span><h2>苦手分析と対策</h2></div>
      <div className="analysis-status"><Badge tone={d.analysisConfidence==="分析可能"?"green":d.analysisConfidence==="暫定"?"orange":""}>{d.analysisConfidence}</Badge><span>{d.analysisAttemptCount}件の学習記録から判定</span></div>
    </section>
    {d.weaknessInsights.length?<div className="weakness-grid">{d.weaknessInsights.map((insight,index)=>
      <section className={`panel weakness-card level-${insight.level}`} key={insight.theme}>
        <div className="weakness-card-head">
          <div><span className="weakness-rank">優先 {index+1}</span><h3>{insight.theme}</h3></div>
          <div className="weakness-score"><strong>{insight.score}</strong><span>苦手度</span></div>
        </div>
        <div className="weakness-tags"><Badge tone={insight.level==="重点"?"red":insight.level==="注意"?"orange":""}>{insight.level}</Badge><ErrorBadge value={insight.dominantError}/><span>{insight.sampleCount}回の記録</span></div>
        <ul className="evidence-list">{insight.evidence.map(item=><li key={item}>{item}</li>)}</ul>
        <div className="repair-targets">
          <span>戻る問題</span>
          <div>{insight.recommendedS.map(id=><Badge tone="blue" key={id}>{id}</Badge>)}{insight.recommendedA.map(id=><Badge key={id}>{id}</Badge>)}{!insight.recommendedS.length&&!insight.recommendedA.length&&<small>関連問題を問題マスターに設定してください</small>}</div>
        </div>
        <div className="recommended-action"><Target size={18}/><div><span>推奨する次の行動</span><strong>{insight.action}</strong><small>{modes[insight.mode]||insight.mode}・約{insight.minutes}分・負荷 {insight.load.toFixed(1)}</small></div></div>
        <button className="ghost weakness-start" onClick={()=>go("import")}><ClipboardPaste size={15}/>GPT採点結果を取り込む</button>
      </section>)}</div>:
      <section className="panel analysis-empty"><Target size={28}/><div><strong>分析に必要な記録を蓄積中です</strong><p>学習記録にK/W/N/Cまたは△・×が入ると、苦手テーマと戻る問題を自動提案します。</p></div></section>}
    <div className="three-col">
      <section className="panel mini-stat"><span>過去問GPT採点</span><strong>{pastAttemptCount}件</strong><div className="progress"><i style={{width:`${Math.min(100,pastAttemptCount*10)}%`}}/></div></section>
      <section className="panel mini-stat"><span>過去問の復習待ち</span><strong>{pastReviewCount}件</strong><div className="progress"><i style={{width:`${Math.min(100,pastReviewCount*20)}%`}}/></div></section>
      <section className="panel focus"><span>次の重点テーマ</span><strong>{d.nextTheme}</strong><small>危険章 {d.dangerChapters.map(x=>`第${x.chapter}章`).join("・")||"なし"}</small></section>
    </div>
  </>
}

function TaskRow({task}:{task:Task}) {
  return <div className={`task-row ${task.checked?"task-checked":""}`}><div className={`task-icon ${task.kind==="S確認"?"s":task.error_type==="K"?"k":""}`}>{task.checked?<Check size={15}/>:task.kind.slice(0,1)}</div><div className="task-main"><strong>{task.problem_id}</strong><span>{task.title}</span></div><div className="task-meta"><Badge>{modes[task.mode]||task.mode}</Badge><span><Clock3 size={14}/>{task.minutes}分</span><b>{task.load.toFixed(1)}</b></div></div>
}
function shortReviewActions(item:Partial<Review&Task>){
  const method=item.review_method||"";
  const linked=item.linked_s_problem_ids?.join(" / ");
  if(method.includes("骨格再現＋")) return [linked?`${linked}を5〜10分確認する`:"型・出発式・主役の統計量を書く","同じ問題の骨格だけを何も見ずに書く"];
  if(method.includes("ノート補修")) return ["弱点ノートに修正ルールを1行追加する","途中式を省略せず、同じ問題の骨格を書く"];
  if(method.includes("該当作業")) return ["落とした計算・積分・和の変形だけを書き直す","同じ作業を何も見ずにもう一度行う"];
  if(method.includes("チェックリスト")) return ["再発防止のチェック項目を1つ作る","ミスした箇所だけを見直す"];
  if(method.includes("3分")) return ["型・出発式・主役の統計量だけを確認する"];
  if(method.includes("骨格確認")||method.includes("骨格再構築")) return ["出発式と使う定理を自力で書く","見ずに骨格を再現する"];
  if(method.includes("復旧")) return ["関連S問題で出発式と条件を復旧する","元のA問題の骨格へ戻る"];
  if(method.includes("過去問")) return ["最大失点要因に対応するA/S問題を補修する","時間配分または答案化を1点だけ修正する"];
  return item.review_steps?.slice(0,2)||[item.review_instruction||"問題の必要部分だけを確認する"];
}
function ReviewPlanDetails({item,compact=false}:{item:Partial<Review&Task>;compact?:boolean}) {
  if(!item.review_method&&!item.review_reason) return null;
  const actions=shortReviewActions(item).filter(Boolean).slice(0,2);
  return <div className={`review-plan ${compact?"compact":""}`}>
    <div className="review-plan-summary">
      {item.due_date&&<div><span>復習日</span><strong>{item.due_date}</strong></div>}
      <div><span>復習方法</span><strong>{item.review_method||"—"}</strong></div>
      <div><span>必要時間</span><strong>{item.estimated_minutes||item.minutes||"—"}分</strong></div>
      <div><span>答案</span><strong>{item.requires_full_answer?"フル答案が必要":"骨格・必要部分だけ"}</strong></div>
      <div><span>関連S</span><strong>{item.requires_s_check?`確認する${item.linked_s_problem_ids?.length?`（${item.linked_s_problem_ids.join(" / ")}）`:""}`:"確認不要"}</strong></div>
    </div>
    <div className="next-actions"><span>今回やること</span><ol>{actions.map((action,index)=><li key={`${index}-${action}`}>{action}</li>)}</ol></div>
    <details><summary>理由と詳しい手順を見る</summary><div className="review-explanation"><span>なぜ復習するか</span><p>{item.review_reason}</p><span>復習時に見るポイント</span><p>{item.review_instruction}</p></div>
      {!!item.review_steps?.length&&<ol>{item.review_steps.map((step,index)=><li key={`${index}-${step}`}>{step}</li>)}</ol>}</details>
  </div>;
}
function TodayView({data,busy,run,go}:{data:Bootstrap;busy:boolean;run:(a:()=>Promise<unknown>,s:string)=>void;go:(p:Page)=>void}) {
  return <>
    <div className="page-intro"><div><p>課題を終えたらチェックを付け、GPTの採点結果を取り込んでください。</p><button className="text-btn" onClick={()=>go("import")}><ClipboardPaste size={15}/>GPT採点結果を取り込む</button></div><div className={`load-pill ${data.today.totalLoad>4?"over":""}`}><Gauge/><div><span>合計負荷</span><strong>{data.today.totalLoad.toFixed(1)} / 4.0</strong></div></div></div>
    {data.today.warning&&<div className="warning"><AlertTriangle/><div><strong>詰め込みすぎです</strong><p>{data.today.warning}</p></div></div>}
    <section className="panel">
      <div className="table-wrap"><table><thead><tr><th>種類</th><th>問題</th><th>推奨モード</th><th>目安</th><th>負荷</th><th>理由</th><th/></tr></thead>
      <tbody>{data.today.tasks.map((t,i)=><TodayTaskRows key={`${t.problem_id}-${i}`} task={t} busy={busy} run={run} date={data.dashboard.today}/>)}</tbody></table></div>
      {!data.today.tasks.length&&<Empty>今日の課題は完了しました</Empty>}
    </section>
  </>
}
function TodayTaskRows({task:t,busy,run,date}:{task:Task;busy:boolean;run:(a:()=>Promise<unknown>,s:string)=>void;date:string}) {
  const toggle=()=>t.id&&t.kind!=="新規A"&&t.kind!=="弱点ノート"
    ?run(()=>post(`/api/reviews/${t.id}/done`,{}),"復習を完了にしました")
    :run(()=>post("/api/today-check",{date,problem_id:t.problem_id,kind:t.kind,checked:!t.checked}),t.checked?"チェックを外しました":"取り組み済みにしました");
  return <><tr className={t.checked?"task-checked":""}><td><Badge tone={t.kind==="S確認"?"blue":t.error_type==="K"?"red":""}>{t.kind}</Badge></td><td><strong>{t.problem_id}</strong><small>{t.title}</small></td><td>{modes[t.mode]||t.mode}</td><td>{t.minutes}分</td><td><strong>{t.load.toFixed(1)}</strong></td><td>{t.reason}</td><td><label className="task-check"><input type="checkbox" checked={!!t.checked} disabled={busy} onChange={toggle}/><span>取り組み済み</span></label></td></tr>
    {(t.review_method||t.review_reason)&&<tr className="task-plan-row"><td colSpan={7}><ReviewPlanDetails item={t} compact/></td></tr>}</>;
}

function ProblemsView({data,select,run,busy}:{data:Bootstrap;select:(p:Problem)=>void;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [filter,setFilter]=useState("all"),[query,setQuery]=useState(""),[adding,setAdding]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({problem_id:"",source_type:"whitebook",category:"A",chapter:"",problem_number:"",title:"",theme:"",priority:"semi_core",role:"training",recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:""});
  const shown=data.problems.filter(p=>(filter==="all"||p.category===filter)&&(`${p.problem_id} ${p.title} ${p.theme}`.toLowerCase().includes(query.toLowerCase())));
  return <>
    <div className="toolbar"><div className="segmented">{["all","A","S","past_exam"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x==="all"?"すべて":x==="past_exam"?"過去問":`${x}問題`}</button>)}</div><label className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="問題ID・テーマで検索"/></label><button className="primary" onClick={()=>setAdding(true)}><Plus size={17}/>問題を追加</button></div>
    <section className="panel flush"><div className="table-wrap"><table><thead><tr><th>問題ID</th><th>区分</th><th>問題名</th><th>テーマ</th><th>優先度</th><th>推奨</th><th>状態</th><th/></tr></thead><tbody>
      {shown.map(p=><tr key={p.problem_id} className="clickable" onClick={()=>select(p)}><td><strong>{p.problem_id}</strong></td><td><Badge tone={p.category==="S"?"blue":p.category==="A"?"":"orange"}>{p.category==="past_exam"?"過去問":p.category}</Badge></td><td>{problemDisplayLabel(p)}</td><td>{p.theme||"—"}</td><td>{p.priority}</td><td>{modes[p.recommended_mode]}</td><td><Badge tone={["completed","completion_candidate"].includes(p.completion_status)?"green":p.completion_status==="review_pending"?"orange":""}>{p.completion_status==="completed"?"完了":p.completion_status==="completion_candidate"?"完了候補":p.completion_status==="review_pending"?"復習待ち":"進行中"}</Badge></td><td><ChevronRight size={17}/></td></tr>)}
    </tbody></table></div></section>
    {adding&&<Modal title="問題マスターに追加" close={()=>setAdding(false)}><form onSubmit={e=>{e.preventDefault();run(()=>post("/api/problems",form),"問題を追加しました");setAdding(false)}} className="form-grid">
      <Field label="問題ID"><input required value={form.problem_id} onChange={e=>setForm({...form,problem_id:e.target.value.toUpperCase()})} placeholder="WB-6-A-05"/></Field>
      <Field label="区分"><select value={form.category} onChange={e=>{const c=e.target.value;setForm({...form,category:c,source_type:c==="past_exam"?"past_exam":"whitebook",role:c==="S"?"foundation":c==="A"?"training":"exam"})}}><option>A</option><option>S</option><option value="past_exam">過去問</option></select></Field>
      <Field label="章"><input type="number" value={form.chapter} onChange={e=>setForm({...form,chapter:e.target.value})}/></Field>
      <Field label="問題番号"><input required type="number" value={form.problem_number} onChange={e=>setForm({...form,problem_number:e.target.value})}/></Field>
      <Field label="問題名" wide><input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field>
      <Field label="テーマ" wide><input value={form.theme} onChange={e=>setForm({...form,theme:e.target.value})}/></Field>
      <Field label="優先度"><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="core">core</option><option value="semi_core">semi_core</option><option value="repair">repair</option></select></Field>
      <Field label="推奨モード"><select value={form.recommended_mode} onChange={e=>setForm({...form,recommended_mode:e.target.value})}>{Object.entries(modes).slice(0,4).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></Field>
      <Field label="関連S問題" wide><input value={form.linked_s_problems} onChange={e=>setForm({...form,linked_s_problems:e.target.value})} placeholder="セミコロン区切り"/></Field>
      <div className="form-actions wide"><button type="button" className="ghost" onClick={()=>setAdding(false)}>キャンセル</button><button className="primary" disabled={busy}>登録する</button></div>
    </form></Modal>}
  </>
}

function ProblemDetail({problem,data,onBack,onImport}:{problem:Problem;data:Bootstrap;onBack:()=>void;onImport:()=>void}) {
  const attempts=data.attempts.filter(a=>a.problem_id===problem.problem_id);
  const reviews=data.reviews.filter(a=>a.problem_id===problem.problem_id);
  const latest=attempts[0],nextReview=reviews.filter(r=>r.status!=="done").sort((a,b)=>a.due_date.localeCompare(b.due_date))[0];
  const related=problem.related_s_problem_ids?.length?problem.related_s_problem_ids:String(problem.linked_s_problems||"").split(";").filter(Boolean);
  return <><button className="back" onClick={onBack}>← 問題一覧へ</button><div className="detail-hero"><div><div className="detail-badges"><Badge tone={problem.category==="S"?"blue":""}>{problem.category}</Badge><Badge>{problem.priority}</Badge></div><h2>{problemDisplayLabel(problem)}</h2><p>{problem.problem_id} ・ {problem.theme}</p></div><button className="primary" onClick={onImport}><ClipboardPaste size={17}/>GPT採点結果を取り込む</button></div>
    {latest&&<section className="panel latest-result"><div><span>最新評価</span><strong>{latest.score_text||latest.score_label} {latest.score_numeric!=null?`/ ${latest.score_numeric}点`:""} / {latest.mark}</strong></div><div><span>K/W/N/C</span><strong>{latest.error_types?.join(" + ")||latest.error_type}</strong></div><div><span>次回復習</span><strong>{nextReview?.due_date||"—"}</strong></div><div><span>本番選択</span><strong>{latest.exam_selection_rank||"—"}</strong></div></section>}
    <div className="detail-grid"><section className="panel"><h3>問題情報</h3><dl><dt>役割</dt><dd>{problem.role}</dd><dt>難易度</dt><dd>{problem.difficulty!=null?`難${problem.difficulty}`:"—"}</dd><dt>推奨モード</dt><dd>{modes[problem.recommended_mode]}</dd><dt>関連S問題</dt><dd>{related.join(" / ")||"—"}</dd><dt>関連A問題</dt><dd>{problem.linked_a_problems||"—"}</dd><dt>関連過去問</dt><dd>{problem.linked_past_exams||"—"}</dd><dt>次回課題</dt><dd>{latest?.next_action||"—"}</dd><dt>メモ</dt><dd>{problem.notes||"—"}</dd></dl></section>
    <section className="panel"><h3>復習予定</h3>{nextReview?<><div className="history"><CalendarCheck/><div><strong>{nextReview.due_date}</strong><span>{reviewNames[nextReview.review_type]||nextReview.review_method}・{nextReview.status}</span></div></div><ReviewPlanDetails item={nextReview}/></>:<Empty>復習予定はありません</Empty>}</section></div>
    <section className="panel"><div className="panel-title"><h3>解答履歴</h3><span className="muted">{attempts.length}回</span></div>{attempts.length?<div className="table-wrap"><table><thead><tr><th>日付</th><th>モード</th><th>評価</th><th>K/W/N/C</th><th>ミス</th><th>次の行動</th></tr></thead><tbody>{attempts.map(a=><tr key={a.id}><td>{a.date}</td><td>{modes[a.mode]}</td><td>{a.mark} / {a.score_label}</td><td><ErrorBadge value={a.error_type}/></td><td>{a.error_point||"—"}</td><td>{a.next_action||"—"}</td></tr>)}</tbody></table></div>:<Empty>まだ学習記録がありません</Empty>}</section>
  </>
}

function AttemptView({problems,run,busy}:{problems:Problem[];run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [form,setForm]=useState<StudyUpdate&{time_minutes:string;memo:string}>({...blankUpdate(),time_minutes:"",memo:""});
  const chosen=problems.find(p=>p.problem_id===form.problem_id);
  const related=chosen?.related_s_problem_ids?.length?chosen.related_s_problem_ids:String(chosen?.linked_s_problems||"").split(";").filter(Boolean);
  const previewPlan=createAttemptReviewPlan(form,related);
  const days=previewPlan.interval_days||14;
  const submit=(e:React.FormEvent)=>{e.preventDefault();run(()=>post("/api/attempts",form),`記録を保存しました。${days}日後に復習を設定しました`);setForm({...blankUpdate(),time_minutes:"",memo:""})};
  return <div className="form-layout"><form className="panel record-form" onSubmit={submit}><div className="panel-title"><div><span className="eyebrow">NEW ATTEMPT</span><h3>学習記録を入力</h3></div></div>
    <Field label="問題ID" wide><select required value={form.problem_id} onChange={e=>setForm({...form,problem_id:e.target.value})}><option value="">選択してください</option>{problems.map(p=><option value={p.problem_id} key={p.problem_id}>{problemDisplayLabel(p)}｜{p.problem_id}</option>)}</select></Field>
    <div className="fields-row"><Field label="学習日"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field><Field label="モード"><select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}>{Object.entries(modes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="学習時間（分）"><input type="number" value={form.time_minutes} onChange={e=>setForm({...form,time_minutes:e.target.value})}/></Field></div>
    <div className="choice-block"><label>手応え</label><div className="choice-row">{["◎","○","△","×"].map(x=><button type="button" key={x} className={form.mark===x?"selected":""} onClick={()=>setForm({...form,mark:x})}>{x}</button>)}</div></div>
    <div className="fields-row"><Field label="評価"><select value={form.score_label} onChange={e=>setForm({...form,score_label:e.target.value})}>{["S","A","B","C"].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="エラー分類"><select className={`select-error error-${form.error_type.toLowerCase()}`} value={form.error_type} onChange={e=>setForm({...form,error_type:e.target.value})}><option value="none">なし</option><option value="K">K：骨格</option><option value="W">W：作業</option><option value="N">N：ノート</option><option value="C">C：ケアレス</option></select></Field></div>
    <Field label="落とした点" wide><textarea value={form.error_point} onChange={e=>setForm({...form,error_point:e.target.value})} placeholder="1ミス1行で具体的に"/></Field>
    <Field label="次の行動・修正ルール" wide><textarea value={form.next_action} onChange={e=>setForm({...form,next_action:e.target.value})} placeholder="次回、何をどう直すか"/></Field>
    {["K","N"].includes(form.error_type)&&<Field label="対応S問題" wide><input value={form.linked_s_problem||chosen?.linked_s_problems||""} onChange={e=>setForm({...form,linked_s_problem:e.target.value})} placeholder="例: WB-6-S-04"/></Field>}
    <div className="review-preview wide"><ReviewPlanDetails item={{...previewPlan,minutes:previewPlan.estimated_minutes}} compact/></div>
    <div className="save-bar"><div><CalendarCheck/><span>次回復習<strong>{days}日後</strong>{previewPlan.requires_s_check&&" ＋ 関連S確認"}</span></div><button className="primary" disabled={busy||!form.problem_id}>保存する</button></div>
  </form><aside className="panel guide"><h3>K / W / N / C</h3><div className="guide-item k"><b>K</b><div><strong>骨格が崩れた</strong><span>型・統計量・条件・定理・結論</span><small>翌日 ＋ S確認</small></div></div><div className="guide-item w"><b>W</b><div><strong>作業だけ落ちた</strong><span>計算・展開・積分・整理</span><small>3日後</small></div></div><div className="guide-item n"><b>N</b><div><strong>ノート不足</strong><span>途中省略で再現できない</span><small>2日後</small></div></div><div className="guide-item c"><b>C</b><div><strong>ケアレス</strong><span>符号・係数・条件確認</span><small>7日後</small></div></div></aside></div>
}

function extractYaml(text:string):unknown {
  const marker=text.search(/(?:^|\n)study_updates?:\s*(?:\n|$)/m);
  if(marker>=0) return yaml.load(text.slice(marker).trim(), { schema: yaml.JSON_SCHEMA });
  return null;
}
function fallbackExtract(text:string):StudyUpdate[] {
  const ids=[...text.matchAll(/\b(?:WB-\d+-[AS]-\d{1,2}|PY-\d{4}-Q\d+)\b/gi)].map(m=>m[0].toUpperCase());
  const unique=[...new Set(ids)];
  const err=text.match(/(?:error_type|分類|評価分類)[：:\s"']*([KWNC])\b/i)?.[1]?.toUpperCase() || "none";
  const mark=text.match(/[◎○△×]/)?.[0]||"△";
  const score=text.match(/(?:score_label|評価)[：:\s"']*([SABC])\b/i)?.[1]?.toUpperCase()||"B";
  return unique.map(problem_id=>({...blankUpdate(),problem_id,error_type:err,mark,score_label:score,error_point:"候補抽出：原文を確認してください",next_action:"確認後に入力"}));
}
function normalizeImport(raw:unknown):StudyUpdate[] {
  if(!raw||typeof raw!=="object") return [];
  const obj=raw as Record<string,unknown>;
  const values=Array.isArray(obj.study_updates)?obj.study_updates:obj.study_update?[obj.study_update]:[];
  return values.filter(x=>x&&typeof x==="object").map(x=>{
    const update={...blankUpdate(),...(x as Partial<StudyUpdate>)};
    update.date=String(update.date||todayString());
    return update;
  });
}
function ImportView({problems,run,busy}:{problems:Problem[];run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [text,setText]=useState(""),[updates,setUpdates]=useState<StudyUpdate[]>([]),[fallback,setFallback]=useState(false),[parseError,setParseError]=useState("");
  const parse=()=>{setParseError("");try{const structured=normalizeImport(extractYaml(text));const found=structured.length?structured:fallbackExtract(text);setFallback(!structured.length);setUpdates(found);if(!found.length)setParseError("問題IDを抽出できませんでした。入力内容を確認してください。")}catch(e){setParseError(`YAMLを解析できません: ${(e as Error).message}`)}};
  const updateOne=(i:number,key:keyof StudyUpdate,value:string)=>setUpdates(updates.map((u,n)=>n===i?{...u,[key]:value}:u));
  const reviewDate=(u:StudyUpdate)=>{const d=new Date(`${u.date}T12:00:00`);const days=Number(u.review_after_days??({K:1,W:3,N:2,C:7} as Record<string,number>)[u.error_type]??(u.mark==="◎"?30:u.mark==="○"?14:3));d.setDate(d.getDate()+days);return new Intl.DateTimeFormat("sv-SE").format(d)};
  return <div className="import-layout"><section className="panel"><div className="panel-title"><div><span className="eyebrow">PASTE FROM GPT</span><h3>GPT回答を貼り付け</h3></div><Badge>API不使用</Badge></div><p className="muted">回答末尾の <code>study_update</code> / <code>study_updates</code> YAMLを読み取ります。</p><textarea className="paste-area" value={text} onChange={e=>setText(e.target.value)} placeholder={"GPTの回答全文、またはYAMLブロックを貼り付けてください\n\nstudy_update:\n  problem_id: WB-6-A-05\n  date: 2026-06-28\n  mode: full\n  mark: \"△\"\n  score_label: B\n  error_type: K"}/><button className="primary wide-btn" onClick={parse}><ClipboardPaste size={17}/>内容を解析する</button>{parseError&&<p className="field-error">{parseError}</p>}</section>
    <section className="panel preview"><div className="panel-title"><div><span className="eyebrow">CONFIRM</span><h3>保存前の確認</h3></div>{updates.length>0&&<Badge tone={fallback?"orange":"green"}>{fallback?"候補抽出":"YAML解析済み"}・{updates.length}件</Badge>}</div>
      {!updates.length?<Empty>解析結果がここに表示されます</Empty>:<><p className={`confirm-note ${fallback?"caution":""}`}>{fallback?"YAMLがないため候補を抽出しました。全項目を確認してから保存してください。":"DBへ保存する内容を確認してください。保存するまで更新されません。"}</p>
      <div className="import-cards">{updates.map((u,i)=><div className="import-card" key={i}><div className="import-card-head"><strong>{i+1}. {u.problem_id||"問題ID未設定"}</strong><button onClick={()=>setUpdates(updates.filter((_,n)=>n!==i))}><X size={16}/></button></div>
        <div className="import-fields"><Field label="問題ID"><select value={u.problem_id} onChange={e=>updateOne(i,"problem_id",e.target.value)}><option value="">選択</option>{problems.map(p=><option value={p.problem_id} key={p.problem_id}>{p.problem_id}</option>)}</select></Field><Field label="モード"><select value={u.mode} onChange={e=>updateOne(i,"mode",e.target.value)}>{Object.entries(modes).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></Field><Field label="評価"><input value={`${u.mark} / ${u.score_label}`} readOnly/></Field><Field label="K/W/N/C"><select value={u.error_type} onChange={e=>updateOne(i,"error_type",e.target.value)}><option value="none">なし</option>{["K","W","N","C"].map(x=><option key={x}>{x}</option>)}</select></Field></div>
        <Field label="落とした点" wide><textarea value={u.error_point} onChange={e=>updateOne(i,"error_point",e.target.value)}/></Field><Field label="次の行動" wide><textarea value={u.next_action} onChange={e=>updateOne(i,"next_action",e.target.value)}/></Field>
        <div className="import-effects"><span><CalendarCheck/>次回復習日 <strong>{reviewDate(u)}</strong></span><span><BookOpen/>S確認 <strong>{u.error_type==="K"?(u.linked_s_problem||"関連設定なし"):"追加なし"}</strong></span><span><NotebookPen/>弱点ノート <strong>{u.error_type!=="none"&&u.error_point?"1行追加":"追加なし"}</strong></span></div>
      </div>)}</div><button disabled={busy||updates.some(x=>!x.problem_id)} className="primary wide-btn" onClick={()=>run(()=>post("/api/import",{updates}),`${updates.length}件を一括保存しました`)}><Database size={17}/>{updates.length}件を保存する</button></>}
    </section></div>
}

function ReviewsView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [filter,setFilter]=useState("open"); const pmap=Object.fromEntries(data.problems.map(p=>[p.problem_id,p]));
  const rows=data.reviews.filter(r=>filter==="all"||(filter==="open"?["pending","overdue"].includes(r.status):r.status===filter));
  return <><div className="toolbar"><div className="segmented">{[["open","未完了"],["overdue","期限切れ"],["done","完了"],["all","すべて"]].map(([k,v])=><button key={k} className={filter===k?"active":""} onClick={()=>setFilter(k)}>{v}</button>)}</div></div><div className="review-list">{rows.map(r=><article className="panel review-card" key={r.id}><div className="review-card-head"><div><Badge tone={r.status==="overdue"?"red":r.status==="done"?"green":""}>{r.status==="overdue"?"期限切れ":r.status==="done"?"完了":"予定"}</Badge><h3>{pmap[r.problem_id]?.display_label||pmap[r.problem_id]?.title||r.problem_id}</h3><span>{r.problem_id} ・ 次回復習 {r.due_date}</span></div>{r.status==="done"?<button disabled={busy} className="small ghost" onClick={()=>run(()=>post(`/api/reviews/${r.id}/pending`,{}),"未完了に戻しました")}>未完了に戻す</button>:<button disabled={busy} className="small ghost" onClick={()=>run(()=>post(`/api/reviews/${r.id}/done`,{}),"復習を完了にしました")}><Check size={14}/>完了</button>}</div><ReviewPlanDetails item={r}/></article>)}</div>{!rows.length&&<section className="panel"><Empty>該当する復習予定はありません</Empty></section>}</>
}
function WeakView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [tab,setTab]=useState<"quiz"|"list">("quiz");
  const [revealed,setRevealed]=useState(false);
  const queue=data.weakNotes.filter(note=>!note.is_resolved).sort((a,b)=>(a.last_quizzed_at||"").localeCompare(b.last_quizzed_at||"")||a.id-b.id);
  const note=queue[0];
  const answer=(result:"remembered"|"retry")=>{
    setRevealed(false);
    run(()=>post(`/api/weak-notes/${note.id}/quiz`,{result}),result==="remembered"?"1回できました。2回できると定着扱いになります":"未習得のまま残しました。後でもう一度出題します");
  };
  return <>
    <section className="weak-guide"><div><span className="eyebrow">ACTIVE RECALL</span><h2>ミスを「次は直せるルール」に変える</h2><p>ミス内容を見て修正ルールを思い出し、答えを確認します。「できた」が2回で定着扱いです。間違えたノートはいつでも未解決に戻せます。</p></div><div><strong>{queue.length}</strong><span>未習得</span></div></section>
    <div className="toolbar"><div className="segmented"><button className={tab==="quiz"?"active":""} onClick={()=>{setTab("quiz");setRevealed(false)}}>クイズで復習</button><button className={tab==="list"?"active":""} onClick={()=>setTab("list")}>ノート一覧</button></div></div>
    {tab==="quiz"?note?<section className="panel weak-quiz">
      <div className="weak-quiz-head"><div><ErrorBadge value={note.error_type}/><span>{note.problem_id} ・ {note.theme}</span></div><Badge>{(note.quiz_correct_count||0)} / 2 回できた</Badge></div>
      <div className="quiz-question"><span>問題</span><h3>このミスを次回防ぐためのルールは？</h3><p>{note.mistake}</p><small>声に出すか、紙に1行書いてから答えを表示してください。</small></div>
      {!revealed?<button className="primary quiz-reveal" onClick={()=>setRevealed(true)}><BookOpen size={17}/>答えを見る</button>:
        <div className="quiz-answer"><span>修正ルール</span><strong>{note.correction_rule||"修正ルールが未登録です"}</strong><div><button disabled={busy} className="ghost" onClick={()=>answer("retry")}>まだ不安</button><button disabled={busy} className="primary" onClick={()=>answer("remembered")}><Check size={16}/>できた</button></div></div>}
    </section>:<section className="panel"><Empty>未習得の弱点はありません。間違いが再発したら「ノート一覧」から未解決に戻せます</Empty></section>:
    <section className="panel flush"><div className="table-wrap"><table><thead><tr><th>状態</th><th>分類</th><th>問題・テーマ</th><th>ミス</th><th>次回の修正ルール</th><th>クイズ</th><th/></tr></thead><tbody>{data.weakNotes.map(w=><tr className={w.is_resolved?"resolved-row":""} key={w.id}><td><Badge tone={w.is_resolved?"green":"orange"}>{w.is_resolved?"定着":"未習得"}</Badge></td><td><ErrorBadge value={w.error_type}/></td><td><strong>{w.problem_id}</strong><small>{w.theme}</small></td><td>{w.mistake}</td><td><strong>{w.correction_rule||"—"}</strong></td><td>{w.quiz_correct_count||0}/2<small>不安 {w.quiz_wrong_count||0}回</small></td><td>{w.is_resolved?<button disabled={busy} className="small ghost" onClick={()=>run(()=>post(`/api/weak-notes/${w.id}/unresolve`,{}),"未解決に戻しました")}>未解決に戻す</button>:<button disabled={busy} className="small ghost" onClick={()=>run(()=>post(`/api/weak-notes/${w.id}/resolve`,{}),"定着扱いにしました")}><Check size={14}/>定着扱い</button>}</td></tr>)}</tbody></table></div>{!data.weakNotes.length&&<Empty>弱点ノートはまだありません。GPT採点取り込みから自動追加されます</Empty>}</section>}
  </>;
}

function PastView({data,go}:{data:Bootstrap;go:(p:Page)=>void}) {
  const pastProblems=data.problems.filter(problem=>problem.category==="past_exam");
  const pmap=new Map(pastProblems.map(problem=>[problem.problem_id,problem]));
  const attempts=data.attempts.filter(attempt=>pmap.has(attempt.problem_id));
  const errorAttempts=attempts.filter(attempt=>(attempt.error_types||[attempt.error_type]).some(error=>error!=="none"));
  const pending=data.reviews.filter(review=>review.status!=="done"&&pmap.has(review.problem_id));
  const themes=new Set(errorAttempts.map(attempt=>pmap.get(attempt.problem_id)?.theme).filter(Boolean));
  return <>
    <section className="past-analysis-intro">
      <div><span className="eyebrow">PAST EXAM ANALYSIS</span><h2>過去問はGPT採点結果から分析します</h2><p>選題フォームへの手入力は不要です。GPTの採点結果を貼り付けると、白本とは分けて失点箇所・復習予定・戻るA/S問題を整理します。</p></div>
      <button className="primary" onClick={()=>go("import")}><ClipboardPaste size={17}/>GPT採点結果を取り込む</button>
    </section>
    <div className="past-analysis-metrics">
      <Metric label="取り込み済み" value={attempts.length} unit="件" hint="過去問の採点履歴"/>
      <Metric label="要復習" value={errorAttempts.length} unit="件" hint="K/W/N/Cあり" tone={errorAttempts.length?"amber":""}/>
      <Metric label="復習待ち" value={pending.length} unit="件" hint="過去問の未完了予定"/>
      <Metric label="苦手テーマ" value={themes.size} unit="件" hint="失点したテーマ"/>
    </div>
    <section className="section-head"><div><span className="eyebrow">REPAIR TARGETS</span><h2>過去問で明らかになった要復習箇所</h2></div></section>
    <div className="past-result-list">{errorAttempts.map(attempt=>{
      const problem=pmap.get(attempt.problem_id)!;
      const review=data.reviews.find(item=>item.generated_from_attempt_id===attempt.id&&item.problem_id===attempt.problem_id);
      const insight=data.dashboard.weaknessInsights.find(item=>item.theme.includes(problem.theme)||problem.theme.includes(item.theme));
      const direct=[...String(problem.linked_a_problems||"").split(/[;,、\s]+/),...(problem.related_s_problem_ids||[])].filter(Boolean);
      const targets=[...new Set([...direct,...(insight?.recommendedA||[]),...(insight?.recommendedS||[])])];
      return <article className="panel past-result-card" key={attempt.id}>
        <div className="past-result-head"><div><ErrorBadge value={attempt.primary_error_type||attempt.error_type}/><h3>{problemDisplayLabel(problem)}</h3><span>{attempt.date} ・ {attempt.score_text||attempt.score_label} {attempt.score_numeric!=null?`${attempt.score_numeric}点`:""}</span></div>{review&&<Badge tone={review.status==="overdue"?"red":"orange"}>{review.due_date} 復習</Badge>}</div>
        <div className="past-result-body"><div><span>失点・不安定だった箇所</span><p>{attempt.error_point||attempt.result_summary||"詳細未入力"}</p></div><div><span>次に直すこと</span><p>{attempt.next_action||review?.review_instruction||"GPT採点結果の指示を確認"}</p></div></div>
        <div className="repair-targets"><span>戻るA/S問題</span><div>{targets.map(id=><Badge tone={id.includes("-S-")?"blue":""} key={id}>{id}</Badge>)}{!targets.length&&<small>関連問題はまだ未設定です</small>}</div></div>
        {review&&<ReviewPlanDetails item={review} compact/>}
      </article>;
    })}</div>
    {!errorAttempts.length&&<section className="panel"><Empty>過去問のGPT採点結果を取り込むと、要復習箇所がここに表示されます</Empty></section>}
    <section className="panel past-master"><div className="panel-title"><div><span className="eyebrow">PAST EXAM MASTER</span><h3>登録済み過去問</h3></div><Badge>{pastProblems.length}問</Badge></div>
      {pastProblems.map(problem=><div className="past-master-row" key={problem.problem_id}><div><strong>{problemDisplayLabel(problem)}</strong><span>{problem.problem_id} ・ {problem.theme}</span></div><small>関連A/S：{[problem.linked_a_problems,...(problem.related_s_problem_ids||[])].filter(Boolean).join(" / ")||"未設定"}</small></div>)}
    </section>
  </>;
}

function SettingsView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const saveBlob=(content:string,name:string,type:string)=>{
    const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement("a");
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const downloadJson=async()=>saveBlob(JSON.stringify(await exportBackup(),null,2),`stat-study-${todayString()}.json`,"application/json");
  const downloadCsv=async(table:"attempts"|"problems")=>saveBlob(await csvFor(table),`${table}-${todayString()}.csv`,"text/csv;charset=utf-8");
  const restore=(file:File)=>{
    run(async()=>{const parsed=JSON.parse(await file.text());await restoreBackup(parsed)},"バックアップを復元しました");
  };
  return <><div className="settings-grid"><section className="panel"><div className="setting-icon"><Download/></div><h3>バックアップ・書き出し</h3><p>iPadの「ファイル」に定期的に保存してください。機種変更時にも復元できます。</p><div className="button-row"><button className="primary" onClick={downloadJson}><Download size={16}/>全データ JSON</button><button className="ghost" onClick={()=>downloadCsv("attempts")}>学習履歴 CSV</button><button className="ghost" onClick={()=>downloadCsv("problems")}>問題マスター CSV</button></div>
      <label className={`restore-button ${busy?"disabled":""}`}><Database size={16}/>JSONバックアップを復元<input disabled={busy} type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];if(file)restore(file);e.target.value=""}}/></label>
    </section>
    <section className="panel"><div className="setting-icon"><Database/></div><h3>iPad内に保存</h3><p>記録はSafari／ホーム画面アプリ内のIndexedDBに保存されます。外部APIやクラウドには送信しません。</p><dl><dt>問題</dt><dd>{data.problems.length}件</dd><dt>解答履歴</dt><dd>{data.attempts.length}件</dd><dt>復習予定</dt><dd>{data.reviews.length}件</dd></dl></section></div>
    <section className="panel install-guide"><div className="setting-icon"><Plus/></div><div><h3>iPadへインストール</h3><p>Safariで公開URLを開き、共有ボタン →「ホーム画面に追加」を選びます。初回表示後はオフラインでも起動できます。</p></div><Badge tone="green">オフライン対応</Badge></section>
    <section className="panel"><div className="panel-title"><div><span className="eyebrow">INITIAL ROADMAP</span><h3>A問題ロードマップ</h3></div><Badge>{data.roadmap.length}題</Badge></div><div className="roadmap">{Object.entries(data.roadmap.reduce((acc,r)=>{(acc[r.block_name]??=[]).push(r);return acc},{} as Record<string,typeof data.roadmap>)).map(([block,rows])=><div className="roadmap-block" key={block}><h4>{block}</h4><div>{rows.map(r=><span key={r.id}><b>{r.order_index}</b>{r.problem_id}<small>{modes[r.expected_mode]}・{r.load_score}</small></span>)}</div></div>)}</div></section>
  </>
}

function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}) {return <label className={`field ${wide?"wide":""}`}><span>{label}</span>{children}</label>}
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) {return <div className="modal-backdrop" onMouseDown={close}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button onClick={close}><X/></button></div>{children}</div></div>}
