import { useEffect, useState } from "react";
import {
  AlertTriangle, Archive, BarChart3, BookOpen, CalendarCheck, Check, ChevronRight, ClipboardPaste,
  Clock3, Copy, Database, Download, Gauge, LayoutDashboard, ListChecks, Menu, NotebookPen,
  Pencil, Play, Plus, RefreshCw, Search, Settings, Sparkles, Target, Trash2, X
} from "lucide-react";
import yaml from "js-yaml";
import { api, post } from "./api";
import { csvFor, exportBackup, restoreBackup } from "./localDb";
import AdvancedImportView from "./AdvancedImportView";
import { problemDisplayLabel } from "./importParser";
import { createAttemptReviewPlan } from "./reviewRules";
import { analyzeWeakTrends, buildQuizPrompt } from "./weakTrend";
import { buildReviewGradingPrompt } from "./gradingPrompt";
import { EXAM_PHASES } from "./studyProgress";
import { CHAPTER_META } from "./officialMaster";
import type { Attempt, Bootstrap, Problem, Review, StudyUpdate, Task } from "./types";

type Page = "dashboard"|"today"|"problems"|"attempt"|"import"|"reviews"|"weak"|"past"|"sheets"|"settings";
const pageTitles:Record<Page,string> = {
  dashboard:"ダッシュボード",today:"今日やること",problems:"問題一覧",attempt:"手入力（予備）",
  import:"GPT回答取り込み",reviews:"復習予定",weak:"弱点傾向",past:"過去問分析",sheets:"解答シート",settings:"設定"
};
const nav = [
  ["dashboard",LayoutDashboard],["today",ListChecks],["problems",BookOpen],["attempt",NotebookPen],
  ["import",ClipboardPaste],["reviews",CalendarCheck],["weak",AlertTriangle],["past",Target],["sheets",Download],["settings",Settings]
] as const;
const modes:Record<string,string>={skeleton:"骨格",main_calc:"主要計算",full:"フル答案",scan:"スキャン",exam_90min:"90分演習"};
const sheetFiles:Record<string,string>={skeleton:"01-skeleton.pdf",main_calc:"02-main-calculation.pdf",full:"03-full-answer.pdf",scan:"04-five-question-scan.pdf",exam_90min:"05-exam-90min.pdf"};
const sheetHref=(mode:string)=>`./answer-sheets/${sheetFiles[mode]||sheetFiles.skeleton}`;
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
      <div className="today-mini"><span>今日の予定合計</span><strong>{data.today.plannedMinutes}分</strong><div className="load-track"><i style={{width:`${Math.min(100,data.today.capacityPercent)}%`}}/></div><small>目標 {data.today.targetMinutes}分・記録済み {data.today.actualMinutes}分</small></div>
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
        page==="sheets"?<AnswerSheetsView/>:
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
  const nextTask=data.today.tasks.find(task=>!task.checked);
  const gradingPending=data.today.tasks.filter(task=>task.checked).length;
  return <>
    <section className="hero">
      <div><span className="eyebrow">NEXT ACTION</span><h2>{nextTask?.title||(gradingPending?`${gradingPending}件の採点結果を取り込む`:"本日の課題は完了です")}</h2><p>{nextTask?.reason||(gradingPending?"解答済みの問題をGPTで採点し、結果を貼り付けてください。":"記録を振り返り、次のロードマップを確認しましょう。")}</p></div>
      <button className="primary" onClick={()=>go(!nextTask&&gradingPending?"import":"today")}>{!nextTask&&gradingPending?<ClipboardPaste size={18}/>:<Play size={18}/>} {!nextTask&&gradingPending?"GPT採点を取り込む":"今日の課題を見る"}</button>
    </section>
    {data.today.warning&&<div className="warning"><AlertTriangle/><div><strong>予定時間を調整してください</strong><p>{data.today.warning}</p></div></div>}
    <section className="section-head"><div><span className="eyebrow">OVERVIEW</span><h2>今週の学習状況</h2></div><span className="muted">直近7日間</span></section>
    <div className="metrics-grid">
      <Metric label="今日の予定合計" value={data.today.plannedMinutes} unit="分" hint={`目標${data.today.targetMinutes}分・記録済み${data.today.actualMinutes}分`} tone={data.today.plannedMinutes>data.today.targetMinutes+30?"red":""}/>
      <Metric label="A問題進捗" value={d.weekA} unit="題" hint="今週の新規・復習"/>
      <Metric label={d.pace.phase==="foundation"?"過去問（任意）":"過去問GPT採点"} value={d.weekPast} unit="件" hint={d.pace.phase==="foundation"?"基礎期は未実施でも可":"今週の取り込み"}/>
      <Metric label="K再発" value={d.kRecurrence} unit="題" hint="直近2週間" tone={d.kRecurrence>2?"red":""}/>
      <Metric label="復習待ち" value={d.pending} unit="件" hint={`うち遅延 ${d.overdue}件`} tone={d.overdue?"amber":""}/>
      <Metric label="S問題安定率" value={d.sStableRate} unit="%" hint={`要確認 ${d.sForgotten}件`}/>
    </div>
    <section className="progress-phase">
      <div className="days-remaining"><strong>{d.pace.daysRemaining}</strong><span>日</span><small>{d.pace.examDateIsEstimate?"試験日未設定のため概算":"本番まで"}</small></div>
      <div><span className="eyebrow">CURRENT PHASE</span><h2>{d.pace.phaseLabel}</h2><p>{d.pace.summary}</p><strong className="phase-allocation">{d.pace.allocation}</strong><b>次の切替：{d.pace.nextPhase}</b></div>
    </section>
    <div className="two-col">
      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">TODAY</span><h3>今日やること</h3></div><button className="text-btn" onClick={()=>go("today")}>すべて見る <ChevronRight size={16}/></button></div>
        <div className="task-list">{data.today.tasks.slice(0,4).map((t,i)=><TaskRow key={`${t.problem_id}-${i}`} task={t}/>)}</div>
        {!data.today.tasks.length&&<Empty>今日が期限の課題はありません</Empty>}
      </section>
      <section className="panel pace-panel">
        <div className="panel-title"><div><span className="eyebrow">14 DAY CHECK</span><h3>合格ペース判定</h3></div><Badge tone={d.pace.label==="合格ペース"?"green":d.pace.label==="注意"?"orange":d.pace.label==="危険"?"red":""}>{d.pace.label}</Badge></div>
        <div className="pace-score"><strong>{d.pace.items.filter(item=>item.status==="ok").length}</strong><span>/ {d.pace.items.filter(item=>item.status!=="pending").length} 判定可能項目を達成</span></div>
        <div className="check-grid">{d.pace.items.map(item=><div key={item.label} className={item.status==="ok"?"ok":item.status==="pending"?"pending":""}>{item.status==="ok"?<Check size={15}/>:item.status==="pending"?<Clock3 size={15}/>:<X size={15}/>}<span><strong>{item.label}</strong><small>{item.detail}</small></span></div>)}</div>
        {d.pace.suggestion&&<p className="pace-advice">{d.pace.suggestion}</p>}
        <details className="danger-criteria"><summary>「危険」の判定基準</summary><ul>{d.pace.dangerCriteria.map(item=><li key={item}>{item}</li>)}</ul><small>危険は不合格確定ではなく、今週の配分を復習・復旧優先へ切り替えるサインです。</small></details>
      </section>
    </div>
    <section className="panel exam-roadmap"><div className="panel-title"><div><span className="eyebrow">140 DAY ROADMAP</span><h3>本番までの過去問導入計画</h3></div><Badge>{d.pace.phaseLabel}</Badge></div>
      <div>{EXAM_PHASES.map(phase=><article className={d.pace.daysRemaining>=phase.from&&d.pace.daysRemaining<=phase.to?"active":""} key={phase.title}><strong>{phase.to===999?"残り140〜100日":`残り${phase.to}〜${phase.from}日`}</strong><span>{phase.title}</span><small>{phase.allocation}</small><p>{phase.summary}</p></article>)}</div>
    </section>
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
        <div className="recommended-action"><Target size={18}/><div><span>推奨する次の行動</span><strong>{insight.action}</strong><small>{modes[insight.mode]||insight.mode}・約{insight.minutes}分</small></div></div>
        <div className="weakness-actions"><button className="ghost weakness-start" onClick={()=>go("weak")}><Pencil size={15}/>登録内容を編集</button><button className="ghost weakness-start" onClick={()=>go("import")}><ClipboardPaste size={15}/>GPT採点結果を取り込む</button></div>
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
  return <div className={`task-row ${task.checked?"task-checked":""}`}><div className={`task-icon ${task.kind==="S確認"?"s":task.error_type==="K"?"k":""}`}>{task.checked?<Check size={15}/>:task.kind.slice(0,1)}</div><div className="task-main"><strong>{task.problem_id}</strong><span>{task.title}</span></div><div className="task-meta"><Badge>{modes[task.mode]||task.mode}</Badge><span><Clock3 size={14}/>{task.minutes}分</span></div></div>
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
  const [promptCopied,setPromptCopied]=useState(false);
  if(!item.review_method&&!item.review_reason) return null;
  const actions=shortReviewActions(item).filter(Boolean).slice(0,2);
  const reviewPrompt=item.id&&item.problem_id?buildReviewGradingPrompt({
    reviewId:item.id,problemId:item.problem_id,title:item.title,theme:item.theme,date:todayString(),mode:item.mode||"skeleton",
    previousDate:item.previous_date,previousScore:item.previous_score,previousErrors:item.previous_errors,
    previousErrorPoint:item.previous_error_point,previousNextAction:item.previous_next_action,
    reviewMethod:item.review_method,reviewInstruction:item.review_instruction,reviewSteps:item.review_steps,
    requiresFullAnswer:item.requires_full_answer,linkedSProblemIds:item.linked_s_problem_ids
  }):"";
  return <div className={`review-plan ${compact?"compact":""}`}>
    <div className="review-plan-summary">
      {item.due_date&&<div><span>復習日</span><strong>{item.due_date}</strong></div>}
      <div><span>復習方法</span><strong>{item.review_method||"—"}</strong></div>
      <div><span>必要時間</span><strong>{item.estimated_minutes||item.minutes||"—"}分</strong></div>
      <div><span>答案</span><strong>{item.requires_full_answer?"フル答案が必要":"骨格・必要部分だけ"}</strong></div>
      <div><span>関連S</span><strong>{item.requires_s_check?`確認する${item.linked_s_problem_ids?.length?`（${item.linked_s_problem_ids.join(" / ")}）`:""}`:"確認不要"}</strong></div>
    </div>
    {(item.previous_error_point||item.previous_next_action)&&<div className="previous-feedback"><span>前回から引き継ぐ点</span>{item.previous_error_point&&<p><b>反省：</b>{item.previous_error_point}</p>}{item.previous_next_action&&<p><b>課題：</b>{item.previous_next_action}</p>}</div>}
    <div className="next-actions"><span>今回やること</span><ol>{actions.map((action,index)=><li key={`${index}-${action}`}>{action}</li>)}</ol></div>
    {reviewPrompt&&<button className="ghost small review-prompt-copy" onClick={async()=>{await navigator.clipboard.writeText(reviewPrompt);setPromptCopied(true);setTimeout(()=>setPromptCopied(false),1800)}}>{promptCopied?<Check size={14}/>:<Copy size={14}/>} {promptCopied?"復習採点プロンプトをコピーしました":"前回の反省を含むGPT採点プロンプト"}</button>}
    <details><summary>理由と詳しい手順を見る</summary><div className="review-explanation"><span>なぜ復習するか</span><p>{item.review_reason}</p><span>復習時に見るポイント</span><p>{item.review_instruction}</p></div>
      {!!item.review_steps?.length&&<ol>{item.review_steps.map((step,index)=><li key={`${index}-${step}`}>{step}</li>)}</ol>}</details>
  </div>;
}
function ReviewOutcomeModal({item,busy,close,save}:{item:Partial<Review&Task>;busy:boolean;close:()=>void;save:(body:Record<string,unknown>)=>void}) {
  const [result,setResult]=useState<"success"|"partial"|"failed">("success");
  const [hint,setHint]=useState(false);
  const [minutes,setMinutes]=useState(String(item.estimated_minutes||item.minutes||5));
  return <Modal title="復習結果を記録" close={close}><div className="review-outcome">
    <p>実際にどこまで自力で再現できたかを記録します。この結果で次回の復習間隔が変わります。</p>
    <div className="outcome-choices">{[["success","自力で再現できた"],["partial","一部だけできた"],["failed","できなかった"]].map(([key,label])=><button type="button" key={key} className={result===key?`selected ${key}`:""} onClick={()=>setResult(key as typeof result)}>{label}</button>)}</div>
    <label className="outcome-check"><input type="checkbox" checked={hint} onChange={event=>setHint(event.target.checked)}/><span>解説・ノート・ヒントを見た</span></label>
    <Field label="実際にかかった時間（分）"><input type="number" min="0" value={minutes} onChange={event=>setMinutes(event.target.value)}/></Field>
    <div className="outcome-preview"><strong>次回間隔</strong><span>{result==="failed"?"翌日に戻す":result==="partial"?"前回間隔を短縮":hint?"緩やかに延長":"自力成功として大きく延長"}</span></div>
    <div className="form-actions"><button className="ghost" onClick={close}>キャンセル</button><button className="primary" disabled={busy} onClick={()=>save({result,hint_used:hint,time_minutes:Number(minutes||0)})}>結果を保存</button></div>
  </div></Modal>;
}
function TodayView({data,busy,run,go}:{data:Bootstrap;busy:boolean;run:(a:()=>Promise<unknown>,s:string)=>void;go:(p:Page)=>void}) {
  const [reviewTask,setReviewTask]=useState<Task|null>(null);
  const saveReview=(body:Record<string,unknown>)=>{if(!reviewTask?.id)return;const id=reviewTask.id;setReviewTask(null);
    run(()=>post(`/api/reviews/${id}/complete`,body),"復習結果を保存し、次回間隔を再計算しました")};
  return <>
    <div className="page-intro"><div><p>課題を終えたらチェックを付け、GPTの採点結果を取り込んでください。</p><button className="text-btn" onClick={()=>go("import")}><ClipboardPaste size={15}/>GPT採点結果を取り込む</button></div><div className={`load-pill ${data.today.plannedMinutes>data.today.targetMinutes+30?"over":""}`}><Gauge/><div><span>予定合計／目標</span><strong>{data.today.plannedMinutes} / {data.today.targetMinutes}分</strong><small>記録済み {data.today.actualMinutes}分・未完了 {data.today.remainingMinutes}分</small></div></div></div>
    {data.today.warning&&<div className="warning"><AlertTriangle/><div><strong>詰め込みすぎです</strong><p>{data.today.warning}</p></div></div>}
    {!data.today.warning&&<div className="time-guidance"><Clock3 size={16}/><span>{data.today.guidance}</span></div>}
    <section className="panel">
      <div className="table-wrap"><table><thead><tr><th>種類</th><th>問題</th><th>推奨モード</th><th>予定時間</th><th>理由</th><th/></tr></thead>
      <tbody>{data.today.tasks.map((t,i)=><TodayTaskRows key={`${t.problem_id}-${i}`} task={t} busy={busy} run={run} date={data.dashboard.today} onReview={setReviewTask}/>)}</tbody></table></div>
      {!data.today.tasks.length&&<Empty>今日の課題は完了しました</Empty>}
    </section>
    {reviewTask&&<ReviewOutcomeModal item={reviewTask} busy={busy} close={()=>setReviewTask(null)} save={saveReview}/>}
  </>
}
function TodayTaskRows({task:t,busy,run,date,onReview}:{task:Task;busy:boolean;run:(a:()=>Promise<unknown>,s:string)=>void;date:string;onReview:(task:Task)=>void}) {
  const isReview=!!t.id&&!!t.review_type;
  const toggle=()=>isReview
    ?onReview(t)
    :run(()=>post("/api/today-check",{date,problem_id:t.problem_id,kind:t.kind,checked:!t.checked}),t.checked?"チェックを外しました":"解答済み・採点待ちにしました");
  return <><tr className={t.checked?"task-checked":""}><td><Badge tone={t.kind==="S確認"?"blue":t.error_type==="K"?"red":""}>{t.kind}</Badge></td><td><strong>{t.problem_id}</strong><small>{t.title}{t.checked&&<em className="grading-wait">採点待ち</em>}</small></td><td>{modes[t.mode]||t.mode}</td><td>{t.minutes}分</td><td>{t.reason}</td><td><div className="task-actions"><a className="sheet-link" href={sheetHref(t.mode)} target="_blank" rel="noreferrer"><Download size={13}/>シート</a><label className="task-check"><input type="checkbox" checked={!!t.checked} disabled={busy} onChange={toggle}/><span>{isReview?"復習結果を記録":"解答済み"}</span></label></div></td></tr>
    {(t.review_method||t.review_reason)&&<tr className="task-plan-row"><td colSpan={6}><ReviewPlanDetails item={t} compact/></td></tr>}</>;
}

function ProblemChip({problem,latest,rank,select}:{problem:Problem;latest?:Attempt;rank:string;select:(problem:Problem)=>void}){
  const rankClass=rank.replace("+","plus").replace("過去問","past");
  return <button className={`problem-chip rank-${rankClass} ${latest?"attempted":""} ${problem.completion_status==="review_pending"?"review-pending":""}`} onClick={()=>select(problem)}>
    <span>{rank}</span><strong>{problem.category==="past_exam"?`問${problem.problem_number}`:`${problem.category}${problem.problem_number}`}</strong>
    <small>{latest?`${latest.mark} ${latest.error_type!=="none"?latest.error_type:""}`:"未"}</small>
  </button>;
}

function ProblemsView({data,select,run,busy}:{data:Bootstrap;select:(p:Problem)=>void;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [filter,setFilter]=useState("all"),[query,setQuery]=useState(""),[adding,setAdding]=useState(false);
  const [form,setForm]=useState<Record<string,string>>({problem_id:"",source_type:"whitebook",category:"A",chapter:"",problem_number:"",title:"",theme:"",priority:"semi_core",strategy_rank:"A",role:"training",recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:""});
  const rankOf=(problem:Problem)=>problem.strategy_rank||(problem.category==="S"?"S":problem.category==="A"?"A":"過去問");
  const latestMap=new Map<string,Attempt>();
  data.attempts.forEach(attempt=>{if(!latestMap.has(attempt.problem_id))latestMap.set(attempt.problem_id,attempt)});
  const matchesFilter=(problem:Problem)=>filter==="all"||(filter==="past_exam"?problem.category==="past_exam":rankOf(problem)===filter);
  const shown=data.problems.filter(p=>matchesFilter(p)&&(`${p.problem_id} ${p.title} ${p.theme}`.toLowerCase().includes(query.toLowerCase())));
  const whitebook=data.problems.filter(problem=>problem.category==="S"||problem.category==="A");
  const rankCounts=["SS","S","A+","A"].map(rank=>{
    const rows=whitebook.filter(problem=>rankOf(problem)===rank);
    return {rank,total:rows.length,done:rows.filter(problem=>latestMap.has(problem.problem_id)).length};
  });
  const chapters=[1,2,3,4,5,6,7,8].map(chapter=>{
    const all=data.problems.filter(problem=>problem.chapter===chapter&&(problem.category==="S"||problem.category==="A"));
    return {chapter,all,shown:shown.filter(problem=>problem.chapter===chapter)};
  }).filter(group=>group.shown.length);
  const pastShown=shown.filter(problem=>problem.category==="past_exam");
  return <>
    <section className="master-flow"><div><strong>SS / S</strong><span>型・出発式を固定する土台</span></div><ChevronRight/><div><strong>A+</strong><span>Sを崩された問題への耐性</span></div><ChevronRight/><div><strong>過去問</strong><span>5問から3問を選び答案化</span></div></section>
    <div className="rank-overview">{rankCounts.map(item=><section className={`rank-stat rank-${item.rank.replace("+","plus")}`} key={item.rank}><span>実戦ランク {item.rank}</span><strong>{item.done}<small> / {item.total}題着手</small></strong><div><i style={{width:`${item.total?item.done/item.total*100:0}%`}}/></div></section>)}</div>
    <div className="toolbar problem-toolbar"><div className="segmented">{["all","SS","S","A+","A","past_exam"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x==="all"?"全体":x==="past_exam"?"過去問":x}</button>)}</div><label className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="問題ID・テーマで検索"/></label><button className="primary" onClick={()=>setAdding(true)}><Plus size={17}/>問題を追加</button></div>
    <div className="chapter-master-grid">{chapters.map(group=>{
      const attempted=group.all.filter(problem=>latestMap.has(problem.problem_id)).length;
      const sRows=group.shown.filter(problem=>problem.category==="S"),aRows=group.shown.filter(problem=>problem.category==="A");
      return <section className={`panel chapter-master ${group.chapter===6?"priority-chapter":""}`} key={group.chapter}>
        <div className="chapter-master-head"><div><span>第{group.chapter}章</span><h3>{CHAPTER_META[group.chapter]?.short}</h3></div><div><strong>{attempted}/{group.all.length}</strong><small>着手</small></div></div>
        <div className="chapter-progress"><i style={{width:`${group.all.length?attempted/group.all.length*100:0}%`}}/></div>
        {!!sRows.length&&<div className="problem-lane"><span>S・土台</span><div>{sRows.sort((a,b)=>a.problem_number-b.problem_number).map(problem=><ProblemChip key={problem.problem_id} problem={problem} latest={latestMap.get(problem.problem_id)} rank={rankOf(problem)} select={select}/>)}</div></div>}
        {!!aRows.length&&<div className="problem-lane"><span>A・補強</span><div>{aRows.sort((a,b)=>a.problem_number-b.problem_number).map(problem=><ProblemChip key={problem.problem_id} problem={problem} latest={latestMap.get(problem.problem_id)} rank={rankOf(problem)} select={select}/>)}</div></div>}
      </section>})}</div>
    {!!pastShown.length&&<section className="panel past-problem-master"><div className="panel-title"><div><span className="eyebrow">PAST EXAMS</span><h3>過去問・実施順 2024 → 2025 → 2022 → 2023</h3></div></div><div>{[2024,2025,2022,2023].map(year=><div className="past-year-row" key={year}><strong>{year}</strong>{pastShown.filter(problem=>problem.problem_id.startsWith(`PY-${year}-`)).map(problem=><ProblemChip key={problem.problem_id} problem={problem} latest={latestMap.get(problem.problem_id)} rank="過去問" select={select}/>)}</div>)}</div></section>}
    <details className="panel master-detail-table"><summary>問題マスターを表で確認する</summary><div className="table-wrap"><table><thead><tr><th>問題ID</th><th>原典</th><th>実戦ランク</th><th>テーマ</th><th>最新</th><th>状態</th></tr></thead><tbody>
      {shown.map(p=>{const latest=latestMap.get(p.problem_id);return <tr key={p.problem_id} className="clickable" onClick={()=>select(p)}><td><strong>{p.problem_id}</strong></td><td>{p.category==="past_exam"?"過去問":p.category}</td><td><Badge tone={p.strategy_rank==="SS"?"red":p.strategy_rank==="A+"?"orange":p.category==="S"?"blue":""}>{rankOf(p)}</Badge></td><td>{p.theme||"—"}</td><td>{latest?`${latest.mark} ${latest.score_text||latest.score_label}`:"未着手"}</td><td>{p.completion_status==="review_pending"?"復習待ち":p.completion_status==="completed"?"完了":"進行中"}</td></tr>})}
    </tbody></table></div></details>
    {adding&&<Modal title="問題マスターに追加" close={()=>setAdding(false)}><form onSubmit={e=>{e.preventDefault();run(()=>post("/api/problems",form),"問題を追加しました");setAdding(false)}} className="form-grid">
      <Field label="問題ID"><input required value={form.problem_id} onChange={e=>setForm({...form,problem_id:e.target.value.toUpperCase()})} placeholder="WB-6-A-05"/></Field>
      <Field label="区分"><select value={form.category} onChange={e=>{const c=e.target.value;setForm({...form,category:c,source_type:c==="past_exam"?"past_exam":"whitebook",strategy_rank:c==="S"?"S":c==="A"?"A":"",role:c==="S"?"foundation":c==="A"?"training":"exam"})}}><option>A</option><option>S</option><option value="past_exam">過去問</option></select></Field>
      <Field label="章"><input type="number" value={form.chapter} onChange={e=>setForm({...form,chapter:e.target.value})}/></Field>
      <Field label="問題番号"><input required type="number" value={form.problem_number} onChange={e=>setForm({...form,problem_number:e.target.value})}/></Field>
      <Field label="問題名" wide><input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field>
      <Field label="テーマ" wide><input value={form.theme} onChange={e=>setForm({...form,theme:e.target.value})}/></Field>
      <Field label="実戦ランク"><select value={form.strategy_rank} onChange={e=>setForm({...form,strategy_rank:e.target.value})}>{["SS","S","A+","A"].map(rank=><option key={rank}>{rank}</option>)}</select></Field>
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
  return <><button className="back" onClick={onBack}>← 問題一覧へ</button><div className="detail-hero"><div><div className="detail-badges"><Badge tone={problem.category==="S"?"blue":""}>原典 {problem.category}</Badge>{problem.strategy_rank&&<Badge tone={problem.strategy_rank==="SS"?"red":problem.strategy_rank==="A+"?"orange":""}>実戦 {problem.strategy_rank}</Badge>}</div><h2>{problemDisplayLabel(problem)}</h2><p>{problem.problem_id} ・ {problem.theme}</p></div><button className="primary" onClick={onImport}><ClipboardPaste size={17}/>GPT採点結果を取り込む</button></div>
    {latest&&<section className="panel latest-result"><div><span>最新評価</span><strong>{latest.score_text||latest.score_label} {latest.score_numeric!=null?`/ ${latest.score_numeric}点`:""} / {latest.mark}</strong></div><div><span>K/W/N/C</span><strong>{latest.error_types?.join(" + ")||latest.error_type}</strong></div><div><span>次回復習</span><strong>{nextReview?.due_date||"—"}</strong></div></section>}
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
        <div className="import-effects"><span><CalendarCheck/>次回復習日 <strong>{reviewDate(u)}</strong></span><span><BookOpen/>S確認 <strong>{u.error_type==="K"?(u.linked_s_problem||"関連設定なし"):"追加なし"}</strong></span><span><NotebookPen/>弱点傾向 <strong>{u.error_type!=="none"&&u.error_point?"分析データに追加":"追加なし"}</strong></span></div>
      </div>)}</div><button disabled={busy||updates.some(x=>!x.problem_id)} className="primary wide-btn" onClick={()=>run(()=>post("/api/import",{updates}),`${updates.length}件を一括保存しました`)}><Database size={17}/>{updates.length}件を保存する</button></>}
    </section></div>
}

function ReviewsView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [filter,setFilter]=useState("open"); const pmap=Object.fromEntries(data.problems.map(p=>[p.problem_id,p]));
  const [selectedReview,setSelectedReview]=useState<Review|null>(null);
  const rows=data.reviews.filter(r=>filter==="all"||(filter==="open"?["pending","overdue"].includes(r.status):r.status===filter));
  const reviewPromptItem=(review:Review)=>{
    const source=data.attempts.find(attempt=>attempt.id===review.generated_from_attempt_id),problem=pmap[review.problem_id];
    return {...review,title:problem?.display_label||problem?.title||review.problem_id,theme:problem?.theme||"",mode:review.requires_full_answer?"exam_90min":review.review_type==="main_calc_retry"?"main_calc":"skeleton",
      previous_date:source?.date,previous_score:source?`${source.score_text||source.score_label}${source.score_numeric!=null?` ${source.score_numeric}点`:""}`:"",
      previous_errors:source?.error_types||[source?.error_type||"none"],previous_error_point:source?.error_point||"",previous_next_action:source?.next_action||""};
  };
  const saveReview=(body:Record<string,unknown>)=>{if(!selectedReview)return;const id=selectedReview.id;setSelectedReview(null);run(()=>post(`/api/reviews/${id}/complete`,body),"復習結果を保存し、次回間隔を再計算しました")};
  return <><div className="toolbar"><div className="segmented">{[["open","未完了"],["overdue","期限切れ"],["done","完了"],["all","すべて"]].map(([k,v])=><button key={k} className={filter===k?"active":""} onClick={()=>setFilter(k)}>{v}</button>)}</div></div><div className="review-list">{rows.map(r=><article className="panel review-card" key={r.id}><div className="review-card-head"><div><Badge tone={r.status==="overdue"?"red":r.status==="done"?"green":""}>{r.status==="overdue"?"期限切れ":r.status==="done"?"完了":"予定"}</Badge><h3>{pmap[r.problem_id]?.display_label||pmap[r.problem_id]?.title||r.problem_id}</h3><span>{r.problem_id} ・ 次回復習 {r.due_date}{r.completion_result?` ・ 結果 ${r.completion_result}`:""}</span></div>{r.status==="done"?(r.completion_result?<Badge tone="green">結果記録済み</Badge>:<button disabled={busy} className="small ghost" onClick={()=>run(()=>post(`/api/reviews/${r.id}/pending`,{}),"未完了に戻しました")}>未完了に戻す</button>):<button disabled={busy} className="small primary" onClick={()=>setSelectedReview(r)}><Check size={14}/>復習結果を記録</button>}</div><ReviewPlanDetails item={reviewPromptItem(r)}/></article>)}</div>{!rows.length&&<section className="panel"><Empty>該当する復習予定はありません</Empty></section>}{selectedReview&&<ReviewOutcomeModal item={selectedReview} busy={busy} close={()=>setSelectedReview(null)} save={saveReview}/>}</>
}
function WeakView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [selected,setSelected]=useState<string[]>([]);
  const [copied,setCopied]=useState(false);
  const [editing,setEditing]=useState<Attempt|null>(null);
  const [form,setForm]=useState<Record<string,string>>({});
  const trend=analyzeWeakTrends(data.problems,data.attempts,data.weakNotes);
  const topThemes=trend.themes.slice(0,8),maxTheme=Math.max(1,...topThemes.map(theme=>theme.score));
  const themeSignature=topThemes.map(theme=>theme.label).join("|");
  useEffect(()=>{setSelected(current=>current.length?current.filter(theme=>topThemes.some(row=>row.label===theme)):topThemes.slice(0,3).map(theme=>theme.label))},[themeSignature]);
  const errorCounts=Object.fromEntries(trend.errors.map(error=>[error.error,error.count])) as Record<string,number>;
  const errorTotal=trend.errors.reduce((sum,error)=>sum+error.count,0);
  const errorColors:Record<string,string>={K:"#b33c36",W:"#d17a35",N:"#487da9",C:"#8b9290"};
  let stop=0;
  const donutParts=["K","W","N","C"].map(error=>{const start=stop;stop+=errorTotal?errorCounts[error]/errorTotal*100:0;return `${errorColors[error]} ${start}% ${stop}%`});
  const weekly=trend.weeks,maxWeek=Math.max(1,...weekly.map(week=>week.score));
  const quizPrompt=buildQuizPrompt(selected,data.problems,data.attempts,data.weakNotes,5);
  const copyPrompt=async()=>{await navigator.clipboard.writeText(quizPrompt);setCopied(true);setTimeout(()=>setCopied(false),1800)};
  const dominantError=[...trend.errors].sort((a,b)=>b.score-a.score)[0]?.error||"—";
  const analysisAttempts=data.attempts.filter(attempt=>(attempt.error_types||[attempt.error_type]).some(error=>error!=="none"));
  const noteFor=(attempt:Attempt)=>data.weakNotes.find(note=>note.generated_from_attempt_id===attempt.id)||
    data.weakNotes.find(note=>note.problem_id===attempt.problem_id&&note.date===attempt.date);
  const editAttempt=(attempt:Attempt)=>{
    const note=noteFor(attempt),problem=data.problems.find(item=>item.problem_id===attempt.problem_id);
    setEditing(attempt);setForm({date:attempt.date,mark:attempt.mark,score_label:attempt.score_label,
      score_numeric:attempt.score_numeric==null?"":String(attempt.score_numeric),
      error_types:(attempt.error_types||[attempt.error_type]).filter(error=>error!=="none").join(" + "),
      theme:note?.theme||problem?.theme||"",error_point:attempt.error_point||"",next_action:attempt.next_action||"",
      correction_rule:note?.correction_rule||attempt.next_action||""});
  };
  const saveEdit=(event:React.FormEvent)=>{event.preventDefault();if(!editing)return;setEditing(null);
    run(()=>post(`/api/attempts/${editing.id}/update`,form),"採点データを更新し、苦手分析と復習予定を再計算しました")};
  const removeAttempt=(attempt:Attempt)=>{
    if(!window.confirm(`${attempt.problem_id}（${attempt.date}）の採点データを削除します。関連する復習予定と弱点傾向データも削除されます。`))return;
    run(()=>post(`/api/attempts/${attempt.id}/delete`,{}),"採点データと関連する分析・復習予定を削除しました");
  };
  if(!trend.attemptCount) return <><section className="weak-trend-hero"><div><span className="eyebrow">WEAKNESS TRENDS</span><h2>GPT採点が集まると、苦手の傾向が見えてきます</h2><p>弱点ノートは自分で管理する一覧ではなく、採点結果から傾向を作るための分析データとして使います。</p></div></section><section className="panel"><Empty>まだ分析データがありません。GPT採点結果を取り込むと自動で蓄積されます</Empty></section></>;
  return <>
    <section className="weak-trend-hero"><div><span className="eyebrow">WEAKNESS TRENDS</span><h2>採点結果から見える苦手傾向</h2><p>ここは復習タスクの一覧ではありません。問題とGPT採点結果から、繰り返し落としているテーマとミスの型を俯瞰する場所です。</p></div><div className="trend-summary"><strong>{trend.themes.length}</strong><span>検出テーマ</span><small>最多 {trend.topTheme}</small></div></section>
    <div className="trend-metrics"><Metric label="分析した採点" value={trend.attemptCount} unit="件" hint="K/W/N/Cがある結果"/><Metric label="最多テーマ" value={topThemes[0]?.score||0} unit="点" hint={trend.topTheme}/><Metric label="主なミス型" value={dominantError} hint={`${errorCounts[dominantError]||0}件`}/><Metric label="K発生率" value={trend.kRate} unit="%" hint="骨格崩れの割合"/></div>
    <div className="trend-grid">
      <section className="panel theme-chart"><div className="panel-title"><div><span className="eyebrow">BY THEME</span><h3>苦手テーマ上位</h3></div><BarChart3 size={19}/></div>
        {topThemes.map(theme=><div className="theme-bar-row" key={theme.label}><div><strong>{theme.label}</strong><span>採点 {theme.count}件</span></div><div className="theme-bar"><i style={{width:`${theme.score/maxTheme*100}%`}}/></div><b>{theme.score}</b></div>)}
      </section>
      <section className="panel error-chart"><div className="panel-title"><div><span className="eyebrow">BY ERROR TYPE</span><h3>K/W/N/Cの構成</h3></div></div>
        <div className="donut-wrap"><div className="error-donut" style={{background:errorTotal?`conic-gradient(${donutParts.join(",")})`:"#e8ece8"}}><strong>{errorTotal}</strong><span>分類済み</span></div>
          <div className="error-legend">{["K","W","N","C"].map(error=><div key={error}><i style={{background:errorColors[error]}}/><strong>{error}</strong><span>{errorCounts[error]}件</span></div>)}</div></div>
      </section>
      <section className="panel weekly-chart"><div className="panel-title"><div><span className="eyebrow">6 WEEK TREND</span><h3>ミス検出数の推移</h3></div></div>
        <div className="week-bars">{weekly.map(week=><div key={week.label}><span>{week.score}</span><i style={{height:`${Math.max(4,week.score/maxWeek*100)}%`}}/><small>{week.label.slice(5)}</small></div>)}</div>
      </section>
    </div>
    <section className="panel quiz-builder"><div className="quiz-builder-head"><div><span className="eyebrow">QUIZ WITH GPT</span><h2>苦手テーマをGPTでクイズ復習</h2><p>復習したいテーマを選び、プロンプトをコピーして普段使っているGPTへ貼り付けます。アプリから外部へ自動送信はしません。</p></div><Sparkles size={25}/></div>
      <div className="theme-picker">{topThemes.map(theme=><label className={selected.includes(theme.label)?"selected":""} key={theme.label}><input type="checkbox" checked={selected.includes(theme.label)} onChange={()=>setSelected(values=>values.includes(theme.label)?values.filter(value=>value!==theme.label):[...values,theme.label])}/><span>{theme.label}</span><b>{theme.score}点</b></label>)}</div>
      <textarea className="quiz-prompt" readOnly value={quizPrompt}/>
      <button className="primary copy-quiz" disabled={!selected.length} onClick={copyPrompt}>{copied?<Check size={17}/>:<Copy size={17}/>} {copied?"コピーしました":"GPTクイズ用プロンプトをコピー"}</button>
    </section>
    <details className="panel trend-evidence"><summary>分析に使った採点データを編集・削除</summary><div>{analysisAttempts.map(attempt=>{
      const note=noteFor(attempt),problem=data.problems.find(item=>item.problem_id===attempt.problem_id);
      return <div className="evidence-row managed" key={attempt.id}><ErrorBadge value={attempt.primary_error_type||attempt.error_type}/><div><strong>{note?.theme||problem?.theme||"テーマ未設定"}</strong><span>{attempt.date} ・ {attempt.problem_id} ・ {attempt.error_point||"ミス内容未入力"}</span></div><div className="evidence-actions"><button className="small ghost" onClick={()=>editAttempt(attempt)}><Pencil size={13}/>編集</button><button className="small danger-button" disabled={busy} onClick={()=>removeAttempt(attempt)}><Trash2 size={13}/>削除</button></div></div>})}</div></details>
    {editing&&<Modal title="苦手分析の根拠データを編集" close={()=>setEditing(null)}><form className="form-grid analysis-edit-form" onSubmit={saveEdit}>
      <Field label="問題"><input value={editing.problem_id} readOnly/></Field>
      <Field label="採点日"><input type="date" value={form.date} onChange={event=>setForm({...form,date:event.target.value})}/></Field>
      <Field label="mark"><select value={form.mark} onChange={event=>setForm({...form,mark:event.target.value})}>{["◎","○","△","×"].map(mark=><option key={mark}>{mark}</option>)}</select></Field>
      <Field label="評価"><select value={form.score_label} onChange={event=>setForm({...form,score_label:event.target.value})}>{["S","A","B","C"].map(score=><option key={score}>{score}</option>)}</select></Field>
      <Field label="点数"><input type="number" value={form.score_numeric} onChange={event=>setForm({...form,score_numeric:event.target.value})}/></Field>
      <Field label="K/W/N/C（複数可・空欄でなし）"><input value={form.error_types} onChange={event=>setForm({...form,error_types:event.target.value.toUpperCase()})} placeholder="K + W"/></Field>
      <Field label="分析テーマ" wide><input value={form.theme} onChange={event=>setForm({...form,theme:event.target.value})}/></Field>
      <Field label="ミス内容" wide><textarea value={form.error_point} onChange={event=>setForm({...form,error_point:event.target.value})}/></Field>
      <Field label="修正ルール" wide><textarea value={form.correction_rule} onChange={event=>setForm({...form,correction_rule:event.target.value})}/></Field>
      <Field label="次の行動" wide><textarea value={form.next_action} onChange={event=>setForm({...form,next_action:event.target.value})}/></Field>
      <div className="analysis-edit-note wide"><AlertTriangle size={16}/><span>保存すると、この採点結果から作られた復習予定と弱点傾向が新しい内容で再計算されます。</span></div>
      <div className="form-actions wide"><button type="button" className="ghost" onClick={()=>setEditing(null)}>キャンセル</button><button className="primary" disabled={busy}>更新する</button></div>
    </form></Modal>}
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

function AnswerSheetsView(){
  const sheets=[
    {mode:"skeleton",title:"骨格答案",pages:"1ページ",time:"10〜20分",description:"型、出発式、主役の統計量、条件、定理、結論を答案の設計図として残します。"},
    {mode:"main_calc",title:"主要計算",pages:"1ページ",time:"10〜20分",description:"計算・積分・和・変数変換など、得点の中心になる作業部分だけを途中式付きで書きます。"},
    {mode:"full",title:"フル答案",pages:"2ページ",time:"30〜45分",description:"採点可能な答案を最初から最後まで書くための、方針欄付き横罫シートです。"},
    {mode:"scan",title:"5問スキャン",pages:"1ページ",time:"5〜10分",description:"5問の型、入口、完走見込み、事故リスクを比較し、選ぶ3問と捨てる2問を決めます。"},
    {mode:"exam_90min",title:"90分演習",pages:"4ページ",time:"90分",description:"選題・時間配分の作戦ページと、選択した3問それぞれの答案ページです。"}
  ];
  const allHref="./answer-sheets/00-all-answer-sheets.pdf";
  return <>
    <section className="answer-sheet-hero">
      <div><span className="eyebrow">GOODNOTES / IPAD LANDSCAPE</span><h2>解答方式に合わせて、書く場所を先に決める</h2><p>すべてiPad横画面と同じ4:3比率です。PDFを開いてGoodNotesへ共有し、原本を複製してから使ってください。</p></div>
      <a className="primary" href={allHref} target="_blank" rel="noreferrer"><Download size={17}/>全シートをまとめて開く</a>
    </section>
    <div className="answer-sheet-grid">{sheets.map(sheet=><section className={`panel answer-sheet-card mode-${sheet.mode}`} key={sheet.mode}>
      <div className="sheet-preview"><NotebookPen size={24}/><span>{sheet.pages}</span></div>
      <div className="sheet-card-body"><div><Badge>{modes[sheet.mode]}</Badge><h3>{sheet.title}シート</h3></div><p>{sheet.description}</p><small>目安 {sheet.time}・{sheet.pages}</small></div>
      <a className="ghost" href={sheetHref(sheet.mode)} target="_blank" rel="noreferrer"><Download size={15}/>PDFを開く</a>
    </section>)}</div>
    <section className="panel goodnotes-guide"><div><span className="eyebrow">HOW TO USE</span><h3>GoodNotesへの入れ方</h3></div><ol><li>使うモードの「PDFを開く」を押す</li><li>iPadの共有ボタンから「Goodnotesで開く」を選ぶ</li><li>「新規書類として読み込む」で保存する</li><li>毎回、原本ページを複製してから答案を書く</li><li>書き終えたページを画像またはPDFでGPTへ送る</li></ol></section>
  </>;
}

function SettingsView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [examDate,setExamDate]=useState(data.settings.exam_date);
  const [dailyMinutes,setDailyMinutes]=useState(String(data.settings.daily_study_minutes||150));
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
    <section className="panel"><div className="setting-icon"><Database/></div><h3>iPad内に保存</h3><p>記録はSafari／ホーム画面アプリ内のIndexedDBに保存されます。外部APIやクラウドには送信しません。</p><dl><dt>問題</dt><dd>{data.problems.length}件</dd><dt>解答履歴</dt><dd>{data.attempts.length}件</dd><dt>復習予定</dt><dd>{data.reviews.length}件</dd></dl></section>
    <section className="panel"><div className="setting-icon"><CalendarCheck/></div><h3>試験日と毎日の学習時間</h3><p>試験日から学習段階を判定し、毎日の目標時間に合わせて課題数を調整します。初期値は150分です。</p><Field label="統計検定1級の受験日"><input type="date" value={examDate} onChange={event=>setExamDate(event.target.value)}/></Field><Field label="1日の最低学習時間（分）"><input type="number" min="30" max="600" value={dailyMinutes} onChange={event=>setDailyMinutes(event.target.value)}/></Field><button className="primary setting-save" disabled={busy} onClick={()=>run(()=>post("/api/settings",{exam_date:examDate,daily_study_minutes:Number(dailyMinutes||150)}),"試験日と学習時間を保存し、計画を調整しました")}>保存する</button></section></div>
    <section className="panel install-guide"><div className="setting-icon"><Plus/></div><div><h3>iPadへインストール</h3><p>Safariで公開URLを開き、共有ボタン →「ホーム画面に追加」を選びます。初回表示後はオフラインでも起動できます。</p></div><Badge tone="green">オフライン対応</Badge></section>
    <section className="panel"><div className="panel-title"><div><span className="eyebrow">INITIAL ROADMAP</span><h3>A問題ロードマップ</h3></div><Badge>{data.roadmap.length}題</Badge></div><div className="roadmap">{Object.entries(data.roadmap.reduce((acc,r)=>{(acc[r.block_name]??=[]).push(r);return acc},{} as Record<string,typeof data.roadmap>)).map(([block,rows])=><div className="roadmap-block" key={block}><h4>{block}</h4><div>{rows.map(r=><span key={r.id}><b>{r.order_index}</b>{r.problem_id}<small>{modes[r.expected_mode]}・{r.load_score}</small></span>)}</div></div>)}</div></section>
  </>
}

function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}) {return <label className={`field ${wide?"wide":""}`}><span>{label}</span>{children}</label>}
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) {return <div className="modal-backdrop" onMouseDown={close}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button onClick={close}><X/></button></div>{children}</div></div>}
