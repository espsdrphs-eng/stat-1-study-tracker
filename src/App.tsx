import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  AlertTriangle, Archive, ArrowDown, BarChart3, BookOpen, CalendarCheck, CalendarClock, Check, ChevronRight, ClipboardPaste,
  Clock3, Copy, Database, Download, Eye, EyeOff, Gauge, LayoutDashboard, ListChecks, Menu, NotebookPen,
  Pencil, Play, Plus, RefreshCw, Search, Settings, Sparkles, Target, Trash2, X
} from "lucide-react";
import yaml from "js-yaml";
import { api, post } from "./api";
import { closeLocalDatabase, csvFor, exportBackup, problemMasterExport, restoreBackup } from "./localDb";
import { createDiagnosticPack } from "./diagnosticPack";
import AdvancedImportView from "./AdvancedImportView";
import { problemDisplayLabel } from "./importParser";
import { createAttemptReviewPlan } from "./reviewRules";
import { analyzeWeakTrends, buildQuizPrompt } from "./weakTrend";
import { buildFirstAttemptGradingPrompt, buildRepairPrompt, buildReviewGradingPrompt } from "./gradingPrompt";
import { reviewMode, reviewTemplate } from "./reviewPresentation";
import {
  allowedReferenceLevel, completionChecklist, correctionRuleExample, correctionTheme, emptyReferenceState,
  normalizeReferenceState, oneLineHint, referenceDecision, referenceEntryPoint, referenceLabels, referencePolicy,
  referenceStateAtLevel, revealReference, reviewAim, reviewFormat, safeReviewActions, todayMove,
  type ReferenceLevel, type ReferenceState
} from "./reviewExperience";
import { removeTimingExpressions } from "./reviewTiming";
import { EXAM_PHASES } from "./studyProgress";
import { sheetUsageForPhase, type ExamPhase } from "./examReadiness";
import { resolveReviewCard, type ResolvedReviewCard } from "./reviewCardResolver";
import { buildScan5Prompt, deriveExposure, scanMetrics, stageForDays, defaultSessionKind } from "./pastExamWorkflow";
import { CHAPTER_META } from "./officialMaster";
import { isProblemPack, masterDiff, parseAliasesPayload, parseIntegratedMasterPayload, parseProblemMasterPayload } from "./masterData";
import { isIndexedDbSchemaError, schemaErrorMessage, type IndexedDbSchemaDiagnostic } from "./dbSchema";
import type { AnswerIndexEntry, Attempt, Bootstrap, PastExamSessionKind, PastSession, Problem, ProblemAlias, Review, ScanQuestion, StudyUpdate, Task } from "./types";

type Page = "dashboard"|"today"|"problems"|"attempt"|"import"|"reviews"|"weak"|"past"|"sheets"|"settings";
const pageTitles:Record<Page,string> = {
  dashboard:"ダッシュボード",today:"今日やること",problems:"問題一覧",attempt:"手入力（予備）",
  import:"GPT回答取り込み",reviews:"復習予定",weak:"弱点傾向",past:"過去問分析",sheets:"解答シート",settings:"設定"
};
const navGroups = [
  {label:"今日",items:[["dashboard",LayoutDashboard],["today",ListChecks],["reviews",CalendarCheck]]},
  {label:"学習",items:[["problems",BookOpen],["past",Target],["weak",AlertTriangle]]},
  {label:"管理",items:[["import",ClipboardPaste],["sheets",Download],["attempt",NotebookPen],["settings",Settings]]}
] as const satisfies readonly {label:string;items:readonly (readonly [Page,typeof LayoutDashboard])[]}[];
const modes:Record<string,string>={check:"チェック",skeleton:"骨格",main_calc:"主要計算",full:"フル答案",scan:"スキャン",exam_90min:"90分演習"};
const sheetFiles:Record<string,string>={check:"00-check.pdf",skeleton:"01-skeleton.pdf",main_calc:"02-main-calculation.pdf",full:"03-full-answer.pdf",scan:"04-five-question-scan.pdf",exam_90min:"05-exam-90min.pdf"};
const sheetHref=(mode:string)=>`./answer-sheets/${sheetFiles[mode]||sheetFiles.skeleton}`;
const reviewNames:Record<string,string>={skeleton_retry:"骨格再現",main_calc_retry:"主要計算",full_retry:"フル再演習",careless_check:"チェックリスト確認",light_check:"短時間チェック",s_check:"S確認",past_exam_link:"過去問連動",past_exam_selection:"選題確認",past_exam_retry:"過去問補修"};
const todayString = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const blankUpdate = ():StudyUpdate => ({problem_id:"",date:todayString(),mode:"full",mark:"△",score_label:"B",error_type:"none",error_point:"",next_action:""});
const attemptConsistentForDisplay=(attempt:Attempt,problem?:Problem)=>{
  if(!problem)return false;
  const text=[attempt.result_summary,attempt.error_point,attempt.next_action,attempt.improvement_guidance,attempt.required_derivation,attempt.corrected_answer].join(" ");
  if(problem.problem_id==="WB-6-S-04"&&/AIC|自由度|指数型分布族|自然母数|期待値母数/.test(text)&&!/U\(0|一様分布|最大統計量|不偏推定量|MSE/.test(text)) return false;
  return true;
};

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
function SheetLink({href,label="シートを見る",primary=false}:{href:string;label?:string;primary?:boolean}){
  const [open,setOpen]=useState(false);
  return <><button type="button" className={`${primary?"primary":"ghost"} sheet-trigger`} onClick={()=>setOpen(true)}><Download size={15}/>{label}</button>
    {open&&<div className="sheet-modal-backdrop" role="presentation" onClick={()=>setOpen(false)}>
      <section className="sheet-modal" role="dialog" aria-modal="true" aria-label={label} onClick={event=>event.stopPropagation()}>
        <header><div><strong>{label}</strong><span>右上の閉じるボタンでアプリに戻れます</span></div><button type="button" className="sheet-modal-close" onClick={()=>setOpen(false)} aria-label="シートを閉じる"><X size={21}/>閉じる</button></header>
        <iframe src={href} title={label}/>
        <footer><button type="button" className="ghost" onClick={()=>setOpen(false)}><X size={15}/>閉じて戻る</button><a className="primary" href={href} target="_blank" rel="noreferrer"><Download size={15}/>GoodNotes用に開く</a></footer>
      </section>
    </div>}</>;
}
export default function App() {
  const {needRefresh:[needRefresh,setNeedRefresh],updateServiceWorker}=useRegisterSW();
  const [data,setData]=useState<Bootstrap|null>(null);
  const [page,setPage]=useState<Page>("dashboard");
  const [menu,setMenu]=useState(false);
  const [selected,setSelected]=useState<Problem|null>(null);
  const [busy,setBusy]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [schemaIssue,setSchemaIssue]=useState<IndexedDbSchemaDiagnostic|null>(null);
  const [databaseNotice,setDatabaseNotice]=useState<{title:string;message:string;reload?:boolean}|null>(null);
  const handleFailure=(reason:unknown)=>{
    if(isIndexedDbSchemaError(reason))setSchemaIssue(reason.diagnostic);
    setError(schemaErrorMessage(reason));
  };
  const load=async()=>{setError("");try{setData(await api<Bootstrap>("/api/bootstrap"));}catch(e){handleFailure(e)}};
  const refresh=async()=>{setRefreshing(true);setError("");try{setData(await api<Bootstrap>("/api/bootstrap"));setMessage("最新データを再読み込みしました")}catch(e){handleFailure(e)}finally{setRefreshing(false)}};
  useEffect(()=>{
    load();
    const blocked=(event:Event)=>setDatabaseNotice({...((event as CustomEvent).detail||{}),reload:false});
    const changed=(event:Event)=>setDatabaseNotice({...((event as CustomEvent).detail||{}),reload:true});
    window.addEventListener("stat1-db-blocked",blocked);window.addEventListener("stat1-db-versionchange",changed);
    return()=>{window.removeEventListener("stat1-db-blocked",blocked);window.removeEventListener("stat1-db-versionchange",changed)};
  },[]);
  const run=async(action:()=>Promise<unknown>,success:string)=>{setBusy(true);setError("");try{await action();setMessage(success);await load();return true}catch(e){handleFailure(e);return false}finally{setBusy(false)}};
  const repairDatabase=async()=>{
    const ok=await run(()=>post("/api/database/repair",{}),"データベースを安全に更新しました");
    if(ok)setSchemaIssue(null);
  };
  const safelyUpdateApp=async()=>{
    const hasDraft=!!sessionStorage.getItem("stat1:gpt-import-draft:v1");
    if(hasDraft&&!window.confirm("未保存のGPT取り込み内容があります。内容は一時保存済みです。アプリを更新しますか？"))return;
    closeLocalDatabase();
    await updateServiceWorker(true);
  };
  const go=(next:Page)=>{setPage(next);setMenu(false);setSelected(null)};
  if(!data) return <div className="boot"><div className="spinner"/><strong>学習データを準備しています</strong>{error&&<p>{error}</p>}{schemaIssue&&<div className="boot-repair"><span>不足している保存先：{schemaIssue.missingStores.join("、")||"確認中"}</span><button className="primary" disabled={busy} onClick={repairDatabase}>データベースを安全に更新</button><button className="ghost" onClick={()=>navigator.clipboard.writeText(JSON.stringify(schemaIssue,null,2))}>診断情報をコピー</button></div>}</div>;
  const writeBusy=busy||!data.databaseStatus.valid;
  return <div className="app-shell">
    <aside className={`sidebar ${menu?"open":""}`}>
      <div className="brand"><div className="brand-mark">1</div><div><strong>統計一級</strong><span>STUDY TRACKER</span></div><button className="mobile-close" onClick={()=>setMenu(false)}><X/></button></div>
      <div className={`today-mini ${data.today.warning?"over":""}`}><span>今日の進捗</span><strong>これから {data.today.active_remaining_minutes}分</strong><div className="load-track"><i style={{width:`${Math.min(100,data.today.capacityPercent)}%`}}/></div><small>完了 {data.today.completed_minutes_today}分・目標 {data.today.target_minutes_today}分</small><small>先送り候補 {data.today.postpone_candidate_minutes}分（実行予定外）</small></div>
      <nav>{navGroups.map(group=><div className="nav-group" key={group.label}><span className="nav-section-label">{group.label}</span>{group.items.map(([key,Icon])=><button key={key} className={page===key?"active":""} onClick={()=>go(key)}><Icon size={19}/><span>{pageTitles[key]}</span>{key==="reviews"&&data.dashboard.pending>0&&<b>{data.dashboard.pending}</b>}</button>)}</div>)}</nav>
      <div className="sidebar-foot"><Gauge size={17}/><div><span>2週間ペース</span><strong className={`pace-${data.dashboard.pace.label}`}>{data.dashboard.pace.label}</strong></div></div>
    </aside>
    {menu&&<div className="scrim" onClick={()=>setMenu(false)}/>}
    <main>
      <header><button className="menu-btn" onClick={()=>setMenu(true)}><Menu/></button><div><span className="eyebrow">{data.dashboard.today.replaceAll("-",".")}</span><h1>{selected?selected.problem_id:pageTitles[page]}</h1></div><button className={`icon-btn ${refreshing?"spinning":""}`} onClick={refresh} title="更新" disabled={refreshing}><RefreshCw size={19}/></button></header>
      {(message||error)&&<div className={`toast ${error?"danger":""}`} onClick={()=>{setMessage("");setError("")}}>{error||message}<X size={16}/></div>}
      {schemaIssue&&<div className="modal-backdrop" role="presentation"><section className="modal database-schema-dialog" role="dialog" aria-modal="true" aria-label="データベース更新"><div className="modal-head"><div><span className="eyebrow">SAFE DATABASE UPDATE</span><h2>保存先データベースの更新が必要です</h2></div><button onClick={()=>setSchemaIssue(null)} aria-label="閉じる"><X/></button></div><p>既存の学習履歴は削除せず、不足している保存先だけを作成・検証します。</p><dl><dt>不足している保存先</dt><dd>{schemaIssue.missingStores.join("、")||"確認中"}</dd><dt>現在のDBバージョン</dt><dd>{schemaIssue.databaseVersion}</dd><dt>必要なDBバージョン</dt><dd>{schemaIssue.requiredDatabaseVersion}</dd><dt>保存処理</dt><dd>{schemaIssue.operation}</dd></dl><div className="button-row"><button className="primary" disabled={busy} onClick={repairDatabase}>データベースを安全に更新</button><button className="ghost" onClick={()=>navigator.clipboard.writeText(JSON.stringify(schemaIssue,null,2))}><Copy size={15}/>診断情報をコピー</button><button className="ghost" onClick={()=>setSchemaIssue(null)}>キャンセル</button></div></section></div>}
      {databaseNotice&&<div className="update-banner" role="alert"><div><strong>{databaseNotice.title}</strong><span>{databaseNotice.message}</span></div>{databaseNotice.reload?<button className="primary small" onClick={()=>location.reload()}>安全に再読み込み</button>:<button className="ghost small" onClick={()=>setDatabaseNotice(null)}>閉じる</button>}</div>}
      {needRefresh&&<div className="update-banner" role="alert"><div><strong>新しいバージョンがあります</strong><span>未保存内容を確認してから、安全に更新できます。</span></div><button className="primary small" onClick={safelyUpdateApp}>安全に更新</button><button className="ghost small" onClick={()=>setNeedRefresh(false)}>後で</button></div>}
      {!data.databaseStatus.valid&&<div className="update-banner database-required" role="alert"><div><strong>アプリのデータベース更新が必要です</strong><span>既存履歴は閲覧できますが、安全のため書き込み操作を一時停止しています。不足：{data.databaseStatus.missingStores.join("、")}</span></div><button className="primary small" disabled={busy} onClick={repairDatabase}>安全に更新</button></div>}
      <div className="content">
        {selected?<ProblemDetail problem={selected} data={data} run={run} busy={busy} onBack={()=>setSelected(null)} onImport={()=>{setSelected(null);setPage("import")}}/>:
        page==="dashboard"?<DashboardView data={data} go={go} select={setSelected}/>:
        page==="today"?<TodayView data={data} busy={writeBusy} run={run} go={go} select={setSelected}/>:
        page==="problems"?<ProblemsView data={data} select={setSelected} run={run} busy={writeBusy}/>:
        page==="attempt"?<AttemptView problems={data.problems} run={run} busy={writeBusy}/>:
        page==="import"?<AdvancedImportView problems={data.problems} answerIndex={data.answerIndex} problemAliases={data.problemAliases} attempts={data.attempts} reviews={data.reviews} run={run} busy={writeBusy}/>:
        page==="reviews"?<ReviewsView data={data} run={run} busy={writeBusy}/>:
        page==="weak"?<WeakView data={data} run={run} busy={writeBusy}/>:
        page==="past"?<PastView data={data} go={go} run={run} busy={writeBusy}/>:
        page==="sheets"?<AnswerSheetsView/>:
        <SettingsView data={data} run={run} busy={busy}/>}
      </div>
    </main>
  </div>
}

function nextQueueTask(data:Bootstrap){
  const open=data.today.tasks.filter(task=>!task.checked);
  const must=open.find(task=>task.triage==="must");
  if(must) return {task:must,source:"今日やること > 必ずやる > 1番目"};
  const ifTime=open.find(task=>task.triage==="if_time");
  if(ifTime) return {task:ifTime,source:"今日やること > 余裕があれば > 1番目"};
  const review=data.reviews.find(review=>["overdue","pending"].includes(review.status));
  if(review){
    const card=resolveReviewCard({item:review,problems:data.problems,attempts:data.attempts,aliases:data.problemAliases,today:data.dashboard.today,examDate:data.settings.exam_date});
    return {task:{problem_id:card.canonicalProblemId,title:card.displayLabel,theme:card.theme,kind:"復習",reason:review.status==="overdue"?"期限切れの復習待ち":"復習待ち",mode:card.effectiveMode,minutes:card.estimatedMinutes,load:0,status:review.status,review_method:card.reviewMethodLabel,effective_mode:card.effectiveMode,sheet_type:card.sheetType,review_needed:card.reviewNeeded} as Task,source:`復習予定 > ${review.status==="overdue"?"期限切れ":"未完了"} > 最優先`};
  }
  return {task:null,source:"今日は完了"};
}
function readinessValue(value:number|null,sample:number,unit="%"){
  if(value==null) return {value:"未計測",hint:"対象0件",unit:""};
  return {value,unit,hint:`対象${sample}件`};
}
function DashboardView({data,go,select}:{data:Bootstrap;go:(p:Page)=>void;select:(p:Problem)=>void}) {
  const d=data.dashboard;
  const pmap=Object.fromEntries(data.problems.map(problem=>[problem.problem_id,problem]));
  const pastIds=new Set(data.problems.filter(problem=>problem.category==="past_exam").map(problem=>problem.problem_id));
  const pastAttemptCount=data.attempts.filter(attempt=>pastIds.has(attempt.problem_id)).length;
  const pastReviewCount=data.reviews.filter(review=>review.status!=="done"&&pastIds.has(review.problem_id)).length;
  const next=nextQueueTask(data);
  const nextTask=next.task;
  const nextProblem=nextTask?pmap[nextTask.problem_id]:undefined;
  const gradingPending=data.today.tasks.filter(task=>task.checked).length;
  return <>
    <section className="hero next-task-card">
      <div><span className="eyebrow">NEXT ACTION</span><h2>{nextTask?`${nextTask.problem_id}｜${nextTask.title}`:(gradingPending?`${gradingPending}件の採点結果を取り込む`:"本日の課題は完了です")}</h2>
        {nextTask?<div className="next-task-meta"><Badge>{modes[nextTask.mode]||nextTask.mode}</Badge><span>{nextTask.minutes}分</span><span>表示元：{next.source}</span></div>:null}
        <p>{nextTask?.reason||(gradingPending?"解答済みの問題をGPTで採点し、結果を貼り付けてください。":"記録を振り返り、次のロードマップを確認しましょう。")}</p></div>
      <div className="hero-actions"><button className="primary" onClick={()=>go(!nextTask&&gradingPending?"import":"today")}>{!nextTask&&gradingPending?<ClipboardPaste size={18}/>:<Play size={18}/>} {!nextTask&&gradingPending?"GPT採点を取り込む":"今日の課題を見る"}</button>
        {nextProblem&&<button className="ghost" onClick={()=>select(nextProblem)}><BookOpen size={18}/>この問題を開く</button>}</div>
    </section>
    {data.today.warning&&<div className="warning"><AlertTriangle/><div><strong>予定時間を調整してください</strong><p>{data.today.warning}</p></div></div>}
    <section className="panel readiness-panel">
      <div className="panel-title"><div><span className="eyebrow">EXAM READINESS</span><h3>本番得点に直結する指標</h3></div><Badge tone={d.stableRelease.isStable?"green":"orange"}>{d.stableRelease.isStable?"学習運用安定版":"運用調整中"}</Badge></div>
      <div className="metrics-grid readiness-grid">
        {(()=>{const m=readinessValue(d.readiness.unseenScoreRate,d.readiness.sampleSizes.unseen);return <Metric label="未見・長期未実施得点率" value={m.value} unit={m.unit} hint={m.hint}/>})()}
        {(()=>{const m=readinessValue(d.readiness.timedCompletionRate,d.readiness.sampleSizes.timed);return <Metric label="時間内完走率" value={m.value} unit={m.unit} hint={m.hint} tone={(d.readiness.timedCompletionRate??100)<60?"amber":""}/>})()}
        {(()=>{const m=readinessValue(d.readiness.selectionSuccessRate,d.readiness.sampleSizes.scans);return <Metric label="5問スキャン選題成功率" value={m.value} unit={m.unit} hint={m.hint}/>})()}
        {(()=>{const m=readinessValue(d.readiness.pastExamScoreRate,d.readiness.sampleSizes.pastExams);return <Metric label="過去問得点" value={m.value} unit={m.unit} hint={m.hint}/>})()}
        {(()=>{const m=readinessValue(d.readiness.kRecurrenceRate,d.readiness.sampleSizes.kReviews);return <Metric label="K再発率" value={m.value} unit={m.unit} hint={m.hint} tone={(d.readiness.kRecurrenceRate??0)>25?"red":""}/>})()}
        {(()=>{const m=readinessValue(d.readiness.repeatedWRate,d.readiness.sampleSizes.wReviews);return <Metric label="同一W再発率" value={m.value} unit={m.unit} hint={m.hint} tone={(d.readiness.repeatedWRate??0)>25?"amber":""}/>})()}
      </div>
      <p className="stable-release-message">{d.stableRelease.message}</p>
      {!!d.stableRelease.blockingIssues.length&&<ul className="stable-blockers">{d.stableRelease.blockingIssues.map(item=><li key={item}>{item}</li>)}</ul>}
      <div className="weekly-soft-quota"><strong>今週の不足候補</strong>{d.weeklyQuota.candidates.length
        ?d.weeklyQuota.candidates.map(item=><span key={item.kind}>{item.kind==="full_skeleton"?"全体統合":item.kind==="timed_full"?"時間制限答案":"5問スキャン"}・{item.minutes}分</span>)
        :<span>今週の最低構成を満たしています</span>}<small>soft quotaのため、今日の上限を超えて自動追加しません。</small></div>
    </section>
    <section className="section-head"><div><span className="eyebrow">OVERVIEW</span><h2>今週の学習状況</h2></div><span className="muted">直近7日間</span></section>
    <div className="metrics-grid">
      <Metric label="今日これから" value={data.today.active_remaining_minutes} unit="分" hint={`完了${data.today.completed_minutes_today}分・先送り候補${data.today.postpone_candidate_minutes}分は除外`} tone={data.today.warning?"red":""}/>
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
    <section className="panel exam-roadmap"><div className="panel-title"><div><span className="eyebrow">4 MONTH ROADMAP</span><h3>残り4か月の得点最大化フェーズ</h3></div><Badge>{d.pace.phaseLabel}</Badge></div>
      <div>{EXAM_PHASES.map(phase=><article className={d.pace.daysRemaining>=phase.from&&d.pace.daysRemaining<=phase.to?"active":""} key={phase.title}><strong>{phase.to===999?"残り91日以上":`残り${phase.to}〜${phase.from}日`}</strong><span>{phase.title}</span><small>{phase.allocation}</small><p>{phase.summary}</p></article>)}</div>
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
const referenceStorageKey=(id?:number)=>`review-reference:${id||"preview"}`;
const referenceClosedStorageKey=(id?:number)=>`review-reference-closed:${id||"preview"}`;
function readReferenceState(id?:number){
  if(!id) return emptyReferenceState();
  try{return normalizeReferenceState(JSON.parse(sessionStorage.getItem(referenceStorageKey(id))||"null")||undefined)}
  catch{return emptyReferenceState()}
}
function rememberReferenceState(id:number|undefined,state:ReferenceState){
  if(id) sessionStorage.setItem(referenceStorageKey(id),JSON.stringify(state));
}
function readReferenceClosed(id?:number){
  return !!id&&sessionStorage.getItem(referenceClosedStorageKey(id))==="true";
}
function rememberReferenceClosed(id:number|undefined,value:boolean){
  if(id) sessionStorage.setItem(referenceClosedStorageKey(id),String(value));
}
function promptHintLevel(level:ReferenceLevel){
  return level===0?"none":level===1?"minimal_hint":level===2?"previous_mistake":
    level===3?"saved_gpt_feedback":level===4?"official_answer":"external_reference";
}
type OpenReferencePanel="one_line_hint"|"previous_mistake"|"correction_rule"|"saved_gpt_feedback"|"official_answer"|"external_reference"|null;
function ReviewPlanDetails({item:rawItem,compact=false,resolved}:{item:Partial<Review&Task>;compact?:boolean;resolved?:ResolvedReviewCard}) {
  const item:Partial<Review&Task>={...rawItem,
    problem_id:resolved?.canonicalProblemId||rawItem.problem_id,title:resolved?.displayLabel||rawItem.title,
    theme:resolved?.theme||rawItem.theme,canonical_problem_type:resolved?.canonicalProblemType||rawItem.canonical_problem_type,
    mode:resolved?.effectiveMode||rawItem.mode,review_method:resolved?.reviewMethodLabel||rawItem.review_method,
    estimated_minutes:resolved?.estimatedMinutes||rawItem.estimated_minutes,
    attempt_exists:resolved?!!resolved.targetAttempt:rawItem.attempt_exists,
    previous_date:resolved?.targetAttempt?.date||rawItem.previous_date,
    previous_errors:resolved?.errorTypes||rawItem.previous_errors,
    previous_error_point:resolved?.targetAttempt?.error_point||rawItem.previous_error_point,
    previous_next_action:resolved?.targetAttempt?.next_action||rawItem.previous_next_action,
  };
  const [promptCopied,setPromptCopied]=useState(false);
  const [reviewMinutes,setReviewMinutes]=useState(String(item.estimated_minutes||item.minutes||""));
  const [reference,setReference]=useState<ReferenceState>(()=>readReferenceState(item.id));
  const [referenceClosedReproduction,setReferenceClosedReproduction]=useState(()=>readReferenceClosed(item.id));
  const [openReferencePanel,setOpenReferencePanel]=useState<OpenReferencePanel>(null);
  if(!item.review_method&&!item.review_reason&&!resolved) return null;
  const actions=resolved?.todayActions.value||safeReviewActions(item);
  const template=reviewTemplate(item);
  const allowed=allowedReferenceLevel(item);
  const hasSavedFeedback=!!item.has_saved_gpt_feedback;
  const hasPreviousAttempt=item.attempt_exists!==false;
  const reveal=(level:Exclude<ReferenceLevel,0>,panel:Exclude<OpenReferencePanel,null>)=>{
    const next=revealReference(reference,level);
    setReference(next);rememberReferenceState(item.id,next);setOpenReferencePanel(panel);
    setReferenceClosedReproduction(false);rememberReferenceClosed(item.id,false);
  };
  const hideReference=()=>setOpenReferencePanel(null);
  const referenceButtonLabel=(panel:Exclude<OpenReferencePanel,null>,initial:string)=>
    openReferencePanel===panel?`${initial.replace(/を見る$/,"")}を表示中`:
      panel==="correction_rule"&&reference.previous_mistake||panel==="one_line_hint"&&reference.one_line_hint||
      panel==="previous_mistake"&&reference.previous_mistake||panel==="saved_gpt_feedback"&&reference.saved_gpt_feedback||
      panel==="official_answer"&&reference.official_answer||panel==="external_reference"&&reference.external_reference
        ?`${initial.replace(/を見る$/,"")}をもう一度見る`:initial;
  const usedReference=reference.actual_reference_level>0;
  const reviewPrompt=item.id&&item.problem_id?buildReviewGradingPrompt({
    reviewId:item.id,problemId:item.problem_id,title:item.title,theme:item.theme,date:todayString(),mode:reviewMode(item),
    previousDate:item.previous_date,previousScore:item.previous_score,previousErrors:item.previous_errors,
    previousErrorPoint:item.previous_error_point,previousNextAction:item.previous_next_action,
    previousImprovementGuidance:item.previous_improvement_guidance,previousRequiredDerivation:item.previous_required_derivation,
    reviewMethod:item.review_method,reviewInstruction:item.review_instruction,reviewSteps:item.review_steps,
    requiresFullAnswer:item.requires_full_answer,linkedSProblemIds:item.linked_s_problem_ids,
    timeMinutes:Number(reviewMinutes||0),hintLevel:promptHintLevel(reference.actual_reference_level),afterHintReproduced:referenceClosedReproduction,
    referenceLevel:reference.actual_reference_level,allowedReferenceLevel:allowed,
    actualReferenceLevel:reference.actual_reference_level,referenceClosedReproduction,
    noHint:reference.no_hint,oneLineHint:reference.one_line_hint,
    previousMistake:reference.previous_mistake,officialAnswer:reference.official_answer,
    gptExplanation:reference.saved_gpt_feedback,externalReference:reference.external_reference,
    reviewScope:resolved?.effectiveReviewScope,targetedParts:resolved?.targetedParts,
    completionConditions:resolved?.completionConditions.value,allowedErrorTypes:resolved?.allowedErrorTypes,
    requiresKEvidence:resolved?.requiresKEvidence,learningPurpose:resolved?.prescription.learningPurpose,
    learningStage:resolved?.prescription.learningStage,assessmentTiming:resolved?.prescription.assessmentTiming,
    targetKind:resolved?.prescription.targetKind
  }):"";
  return <div className={`review-plan ${compact?"compact":""}`}>
    {resolved?.reviewNeeded&&<div className="review-consistency-warning"><AlertTriangle size={18}/><div><strong>要確認</strong><span>問題情報または復習履歴に不整合があります。誤った具体的な指示は表示していません。</span></div></div>}
    {!!resolved?.consistencyWarnings.length&&!resolved.reviewNeeded&&<details className="review-consistency-details"><summary>自動整合済み {resolved.consistencyWarnings.length}件</summary><ul>{resolved.consistencyWarnings.map(warning=><li key={warning.code}>{warning.message}</li>)}</ul></details>}
    <div className="today-move"><span>今日の一手</span><strong>{resolved?.todayActions.value.join(" → ")||todayMove(item)}</strong></div>
    {resolved&&<div className="task-policy-meta"><span>学習段階：{resolved.prescription.learningStage}</span><span>目的：{resolved.prescription.learningPurpose}</span><span>{resolved.prescription.assessmentTiming==="same_session_correction"?"答案直後の5分修正":"時間を空けた再現"}</span></div>}
    <div className="review-plan-summary">
      {item.due_date&&<div><span>次回復習</span><strong>{resolved?`${resolved.dueDate}${resolved.daysUntilDue==null?"":resolved.daysUntilDue===0?"（今日）":resolved.daysUntilDue>0?`（あと${resolved.daysUntilDue}日）`:`（${Math.abs(resolved.daysUntilDue)}日超過）`}`:item.due_date}</strong></div>}
      <div><span>復習方法</span><strong>{resolved?.reviewMethodLabel||item.review_method||"—"}</strong></div>
      <div><span>必要時間</span><strong>{item.estimated_minutes||item.minutes||"—"}分</strong></div>
      <div><span>使用シート</span><strong>{resolved?.sheetLabel||template.sheetLabel}</strong></div>
    </div>
    <div className="review-aim"><span>今回の狙い</span><strong>{resolved?.reviewGoal.value||reviewAim(item)}</strong></div>
    {(resolved?.taskOrigin||item.task_origin)==="linked_s_check"&&<div className="task-origin-note"><Badge tone="blue">関連S確認</Badge><div><strong>この問題自体は{hasPreviousAttempt?"既習":"初回"}確認です</strong><span>元問題：{resolved?.sourceProblem?.displayLabel||item.source_problem_id||"記録なし"}／{resolved?.sourceProblem?.sourceIssue||"元問題で崩れた基礎型を確認します。"}</span></div></div>}
    <div className="correction-theme"><span>修正テーマ</span><strong>{resolved?.correctionTheme.value||correctionTheme(item)}</strong></div>
    <div className="review-entry-point"><span>今回の入口</span><strong>{resolved?.entryHint.value||referenceEntryPoint(item)}</strong></div>
    <div className="review-format"><strong>{reviewFormat(item)}</strong></div>
    <div className="next-actions"><span>今回やること</span><ol>{actions.map((action,index)=><li key={`${index}-${action}`}>{action}</li>)}</ol></div>
    <div className="review-template">
      <div className="review-template-head"><div><span>復習内容の型</span><strong>{resolved?.reviewMethodLabel||template.title}</strong></div><SheetLink href={sheetHref(resolved?.effectiveMode||template.sheetMode)} label={resolved?.sheetLabel||template.sheetLabel}/></div>
      <div className="review-template-fields">{template.fields.map(field=><div key={field.label}><strong>{field.label}</strong><span>{field.hint}</span></div>)}</div>
    </div>
    <div className="completion-checklist"><span>完了条件</span>{(resolved?.completionConditions.value||completionChecklist(item)).map(condition=><label key={condition}><input type="checkbox"/><b>{condition}</b></label>)}</div>
    <div className="reference-gate">
      <div className="reference-gate-head"><div><span>今回見たもの</span><strong>{referenceLabels[reference.actual_reference_level]}</strong></div><small>許可：{referenceLabels[allowed]}まで</small></div>
      <div className="hint-policy"><strong>参照ルール</strong><span>{referencePolicy(item)}</span></div>
      <div className="reference-buttons">
        <button type="button" className={reference.one_line_hint?"viewed":""} onClick={()=>reveal(1,"one_line_hint")}><Eye size={14}/>{referenceButtonLabel("one_line_hint","1行ヒントを見る")}</button>
        {hasPreviousAttempt&&<button type="button" className={reference.previous_mistake?"viewed":""} onClick={()=>reveal(2,"previous_mistake")}><Eye size={14}/>{referenceButtonLabel("previous_mistake","前回ミスを見る")}</button>}
        {hasPreviousAttempt&&<button type="button" className={reference.previous_mistake?"viewed":""} onClick={()=>reveal(2,"correction_rule")}><Eye size={14}/>{referenceButtonLabel("correction_rule","修正ルール例を見る")}</button>}
        {hasSavedFeedback&&<button type="button" className={reference.saved_gpt_feedback?"viewed":""} onClick={()=>reveal(3,"saved_gpt_feedback")}><Eye size={14}/>{referenceButtonLabel("saved_gpt_feedback","保存済みGPT解説を見る")}</button>}
        <button type="button" className={reference.external_reference?"viewed":""} onClick={()=>reveal(5,"external_reference")}><Eye size={14}/>{referenceButtonLabel("external_reference","外部参照を記録")}</button>
      </div>
      {!hasPreviousAttempt&&<div className="no-attempt-note"><span>この問題の前回記録はありません。今回は関連確認または初回確認として扱います。</span></div>}
      {openReferencePanel==="one_line_hint"&&<div className="revealed-reference hint"><div className="revealed-reference-head"><span>1行ヒント</span><button type="button" onClick={hideReference}><EyeOff size={13}/>隠す</button></div><p>{resolved?.oneLineHint.value||oneLineHint(item)}</p></div>}
      {openReferencePanel==="previous_mistake"&&<div className="revealed-reference mistake"><div className="revealed-reference-head"><span>前回ミスの詳細</span><button type="button" onClick={hideReference}><EyeOff size={13}/>隠す</button></div>{item.previous_error_point&&<p>{item.previous_error_point}</p>}{!item.previous_error_point&&<p>前回ミスの詳細記録はありません。</p>}</div>}
      {openReferencePanel==="correction_rule"&&<div className="revealed-reference rule"><div className="revealed-reference-head"><span>修正ルール例</span><button type="button" onClick={hideReference}><EyeOff size={13}/>隠す</button></div><p>{removeTimingExpressions(correctionRuleExample(item))}</p></div>}
      {openReferencePanel==="saved_gpt_feedback"&&hasSavedFeedback&&<div className="revealed-reference explanation"><div className="revealed-reference-head"><span>保存済みGPT解説</span><button type="button" onClick={hideReference}><EyeOff size={13}/>隠す</button></div><p>{item.previous_improvement_guidance||item.previous_required_derivation||item.previous_corrected_answer||removeTimingExpressions(item.previous_next_action)}</p></div>}
      {openReferencePanel==="external_reference"&&<div className="revealed-reference explanation"><div className="revealed-reference-head"><span>外部参照</span><button type="button" onClick={hideReference}><EyeOff size={13}/>隠す</button></div><p>アプリ外のGPT・教材・解説を見たことを記録しました。表示を隠してから白紙で再現してください。</p></div>}
      {usedReference&&!openReferencePanel&&<div className="reference-hidden-status"><EyeOff size={14}/><span>{referenceLabels[reference.actual_reference_level]}を確認済み。参照内容は隠れています。</span></div>}
      <p className="reference-note">参照内容は何度でも開閉できます。一度見た参照段階は記録に残りますが、表示を隠してから白紙で再現してください。「前回ミス」はN・W・Cなどの補修では許可される場合があります。</p>
    </div>
    {reviewPrompt&&<div className="review-prompt-prep">
      <div className="review-prompt-prep-head"><div><span>GPT採点前に入力</span><strong>時間と参照状況をプロンプトへ反映</strong></div></div>
      <div className="review-prompt-inputs">
        <Field label="今回かかった時間（分）"><input type="number" min="0" value={reviewMinutes} onChange={event=>setReviewMinutes(event.target.value)}/></Field>
        <Field label="許可された参照"><input value={`${allowed}. ${referenceLabels[allowed]}まで`} readOnly/></Field>
        <Field label="実際に見た参照"><input value={`${reference.actual_reference_level}. ${referenceLabels[reference.actual_reference_level]}`} readOnly/></Field>
      </div>
      {usedReference&&<label className="after-hint-check"><input type="checkbox" checked={referenceClosedReproduction} onChange={event=>{setReferenceClosedReproduction(event.target.checked);rememberReferenceClosed(item.id,event.target.checked)}}/><span>表示を隠してから、該当部分を白紙で再現した</span></label>}
      <button className="ghost small review-prompt-copy" onClick={async()=>{await navigator.clipboard.writeText(reviewPrompt);setPromptCopied(true);setTimeout(()=>setPromptCopied(false),1800)}}>{promptCopied?<Check size={14}/>:<Copy size={14}/>} {promptCopied?"復習採点プロンプトをコピーしました":"入力内容を含むGPT採点プロンプトをコピー"}</button>
    </div>}
    {item.status==="done"&&<div className="post-review-summary"><span>復習後の確認</span>
      <p><b>前回ミス：</b>{item.previous_error_point||"記録なし"}</p>
      <p><b>修正ルール例：</b>{removeTimingExpressions(correctionRuleExample(item))}</p>
      <p><b>次回課題：</b>{removeTimingExpressions(item.previous_next_action)||"記録なし"}</p>
      <p><b>関連S/A：</b>{item.linked_s_problem_ids?.join(" / ")||"今回の指定なし"}</p>
    </div>}
    <details><summary>詳細を見る</summary><div className="review-explanation"><span>なぜ復習するか</span><p>{item.review_reason}</p><span>詳しい手順</span><p>{item.review_instruction}</p></div>
      {item.task_origin==="linked_s_check"&&item.source_error_summary&&<div className="source-problem-detail"><span>元問題での弱点</span><p>{item.source_error_summary}</p></div>}
      {!!item.review_steps?.length&&<ol>{item.review_steps.map((step,index)=><li key={`${index}-${step}`}>{step}</li>)}</ol>}
      <div className="related-detail"><span>関連S/A・過去問対応</span><p>{item.requires_s_check&&item.linked_s_problem_ids?.length?`関連S：${item.linked_s_problem_ids.join(" / ")}`:"今回の関連問題確認は不要です。"}</p></div>
    </details>
  </div>;
}
function ReviewOutcomeModal({item,busy,close,save}:{item:Partial<Review&Task>;busy:boolean;close:()=>void;save:(body:Record<string,unknown>)=>void}) {
  const [result,setResult]=useState<"success"|"partial"|"failed">("success");
  const [reference,setReference]=useState<ReferenceState>(()=>readReferenceState(item.id));
  const [referenceClosed,setReferenceClosed]=useState(()=>readReferenceClosed(item.id));
  const [minutes,setMinutes]=useState(String(item.estimated_minutes||item.minutes||5));
  const allowed=allowedReferenceLevel(item);
  const chooseReference=(level:ReferenceLevel)=>{
    const next=referenceStateAtLevel(level);
    setReference(next);rememberReferenceState(item.id,next);setReferenceClosed(false);rememberReferenceClosed(item.id,false);
  };
  const decision=referenceDecision(result,allowed,reference.actual_reference_level,referenceClosed);
  const hint=reference.actual_reference_level>0;
  return <Modal title="復習結果を記録" close={close}><div className="review-outcome">
    <p>実際にどこまで自力で再現できたかを記録します。この結果で次回の復習間隔が変わります。</p>
    <div className="outcome-choices">{[["success","自力で再現できた"],["partial","一部だけできた"],["failed","できなかった"]].map(([key,label])=><button type="button" key={key} className={result===key?`selected ${key}`:""} onClick={()=>setResult(key as typeof result)}>{label}</button>)}</div>
    <div className="reference-judgement"><div><span>許可された参照</span><strong>{referenceLabels[allowed]}まで</strong></div><div><span>実際に見た参照</span><strong>{referenceLabels[reference.actual_reference_level]}</strong></div></div>
    <div className="outcome-reference"><span>今回見たもの</span><div>{([0,1,2,3,4,5] as ReferenceLevel[]).map(level=><button type="button" key={level} className={reference.actual_reference_level===level?"selected":""} onClick={()=>chooseReference(level)}>{level}. {referenceLabels[level]}</button>)}</div></div>
    {hint&&<label className="outcome-check"><input type="checkbox" checked={referenceClosed} onChange={event=>{setReferenceClosed(event.target.checked);rememberReferenceClosed(item.id,event.target.checked)}}/><span>表示を隠してから、該当部分を白紙で再現した</span></label>}
    <Field label="実際にかかった時間（分）"><input type="number" min="0" value={minutes} onChange={event=>setMinutes(event.target.value)}/></Field>
    <div className="outcome-preview"><strong>保存前判定</strong><span>{decision.message}</span><small>完了扱い：{decision.canComplete?"可能":"不可"} ／ 次回補正：{decision.shortenReview?"短くする":"なし"}</small></div>
    <div className="form-actions"><button className="ghost" onClick={close}>キャンセル</button><button className="primary" disabled={busy} onClick={()=>save({
      ...reference,result:decision.result,hint_used:hint,hint_level:promptHintLevel(reference.actual_reference_level),
      after_hint_reproduced:referenceClosed,reference_closed_reproduction:referenceClosed,
      allowed_reference_level:allowed,actual_reference_level:reference.actual_reference_level,
      time_minutes:Number(minutes||0)
    })}>結果を保存</button></div>
  </div></Modal>;
}
type ScheduleAction="today"|"tomorrow"|"three"|"weekend"|"unscheduled";
const postponeReasons=["今日の予定時間を超えている","優先度が低い","Cのみなので後回し","S問題メンテなので後回し","体力・時間不足","手動調整"];
function ScheduleQuickButtons({item,busy,select}:{item:Partial<Review&Task>;busy:boolean;select:(action:ScheduleAction)=>void}){
  const errors=new Set([...(item.previous_errors||[]),item.error_type||""]);
  return <div className="schedule-quick-actions">
    <button disabled={busy} onClick={()=>select("today")}>今日やる</button>
    <button disabled={busy} onClick={()=>select("tomorrow")}>明日に送る</button>
    <button disabled={busy} onClick={()=>select("three")}>3日後へ</button>
    <button disabled={busy} onClick={()=>select("weekend")}>週末へ</button>
    {!errors.has("K")&&<button disabled={busy} onClick={()=>select("unscheduled")}>期限なし</button>}
  </div>;
}
function weekendDate(){
  const date=new Date(`${todayString()}T12:00:00`),day=date.getDay();
  date.setDate(date.getDate()+((6-day+7)%7||7));
  return new Intl.DateTimeFormat("sv-SE").format(date);
}
function PostponeReviewModal({item,initial="tomorrow",busy,close,save}:{item:Partial<Review&Task>;initial?:ScheduleAction;busy:boolean;close:()=>void;save:(body:Record<string,unknown>,label:string)=>void}) {
  const [action,setAction]=useState<ScheduleAction>(initial);
  const [reason,setReason]=useState(postponeReasons[0]);
  const errors=new Set([...(item.previous_errors||[]),item.error_type||""]);
  const actions:ScheduleAction[]=errors.has("K")?["today","tomorrow","three"]:
    errors.has("N")?["today","tomorrow","three"]:["today","tomorrow","three","weekend","unscheduled"];
  const labels:Record<ScheduleAction,string>={today:"今日やる",tomorrow:"明日に送る",three:"3日後へ送る",weekend:"週末へ送る",unscheduled:"期限なしにする"};
  const submit=()=>{
    const destination=action==="today"?{days:0,triage_override:"must"}:action==="tomorrow"?{days:1}:
      action==="three"?{days:3}:action==="weekend"?{due_date:weekendDate()}:{unscheduled:true};
    save({...destination,action,postpone_reason:reason,problem_id:item.problem_id,kind:item.kind,
      mode:item.mode,review_method:item.review_method,review_reason:item.review_reason,
      estimated_minutes:item.estimated_minutes||item.minutes,previous_errors:item.previous_errors,
      error_type:item.error_type},labels[action]);
  };
  return <Modal title="復習を後ろへ送る" close={close}><div className="postpone-review">
    <p><strong>{item.problem_id}</strong> の実行日を変更します。先送り理由と回数は復習計画に保存されます。</p>
    {errors.has("K")&&<div className="postpone-alert"><AlertTriangle size={17}/><span>Kを含むため、放置すると型崩れが戻る可能性があります。明日までの先送りを推奨します。</span></div>}
    {!errors.has("K")&&errors.has("N")&&<div className="postpone-alert"><AlertTriangle size={17}/><span>Nを含むため、再現性不足が残っています。短期での復習を推奨します。</span></div>}
    <div className="postpone-quick">{actions.map(value=><button className={action===value?"selected":""} key={value} disabled={busy} onClick={()=>setAction(value)}>{labels[value]}</button>)}</div>
    <Field label="先送り理由"><select value={reason} onChange={event=>setReason(event.target.value)}>{postponeReasons.map(value=><option key={value}>{value}</option>)}</select></Field>
    <div className="form-actions"><button className="ghost" onClick={close}>キャンセル</button><button className="primary" disabled={busy} onClick={submit}>{labels[action]}</button></div>
    <small>「今日やる」は今日必須へ戻します。期限なしは今日の自動予定から外れますが、問題一覧からはいつでも開けます。</small>
  </div></Modal>;
}
function TodayView({data,busy,run,go,select}:{data:Bootstrap;busy:boolean;run:(a:()=>Promise<unknown>,s:string)=>void;go:(p:Page)=>void;select:(p:Problem)=>void}) {
  const [reviewTask,setReviewTask]=useState<Task|null>(null);
  const [postponeTask,setPostponeTask]=useState<{item:Task;initial:ScheduleAction}|null>(null);
  const [todayFilter,setTodayFilter]=useState<"must"|"if_time"|"tomorrow"|"completed"|"all">("must");
  const [recalculateConfirm,setRecalculateConfirm]=useState(false);
  const pmap=Object.fromEntries(data.problems.map(problem=>[problem.problem_id,problem]));
  const saveReview=(body:Record<string,unknown>)=>{if(!reviewTask?.id)return;const id=reviewTask.id;setReviewTask(null);
    sessionStorage.removeItem(referenceStorageKey(id));
    sessionStorage.removeItem(referenceClosedStorageKey(id));
    run(()=>post(`/api/reviews/${id}/complete`,body),"復習結果を保存し、次回間隔を再計算しました")};
  const postponeReview=(body:Record<string,unknown>,label:string)=>{if(!postponeTask)return;const item=postponeTask.item;setPostponeTask(null);
    run(()=>post(item.id&&item.review_type?`/api/reviews/${item.id}/postpone`:"/api/tasks/postpone",body),`課題を「${label}」に変更しました`)};
  const allGroups=[
    {key:"must",label:"今日必ずやる",description:"K・N・過去問直結の必修Aを優先",tasks:data.today.tasks.filter(task=>task.triage==="must")},
    {key:"if_time",label:"余裕があればやる",description:"目標時間内に収まるW・C・通常課題",tasks:data.today.tasks.filter(task=>task.triage==="if_time")},
    {key:"tomorrow",label:"先送り候補",description:"C・none・Sメンテ・緊急性の低い関連S確認",tasks:data.today.tasks.filter(task=>task.triage==="tomorrow")}
  ];
  const triageGroups=allGroups.filter(group=>(todayFilter==="all"||todayFilter===group.key)&&group.tasks.length);
  const summary=[
    {key:"must",label:"必ずやる",count:data.today.triageCounts.must,minutes:data.today.triageMinutes?.must||0},
    {key:"if_time",label:"余裕があれば",count:data.today.triageCounts.if_time,minutes:data.today.triageMinutes?.if_time||0},
    {key:"tomorrow",label:"先送り候補",count:data.today.triageCounts.tomorrow,minutes:data.today.triageMinutes?.tomorrow||0},
    {key:"completed",label:"完了済み",count:data.today.triageCounts.completed,minutes:data.today.completed_minutes_today}
  ] as const;
  const examPhase:ExamPhase=data.dashboard.pace.phase==="integration"?"A_and_past_parallel":
    data.dashboard.pace.phase==="past_practice"?"past_exam_main":
    data.dashboard.pace.phase==="final"?"final_stabilization":"foundation_to_A";
  return <>
    <div className="page-intro"><div><p>課題を終えたらチェックを付け、GPTの採点結果を取り込んでください。</p><div className="button-row"><button className="text-btn" onClick={()=>go("import")}><ClipboardPaste size={15}/>GPT採点結果を取り込む</button><button className="text-btn" onClick={()=>setRecalculateConfirm(true)}><RefreshCw size={15}/>今日の計画を再整理</button></div></div><div className={`load-pill ${data.today.warning?"over":""}`}><Gauge/><div><span>今日の実行見込み／目標</span><strong>{data.today.active_total_if_done} / {data.today.target_minutes_today}分</strong><small>完了 {data.today.completed_minutes_today}分 + これから {data.today.active_remaining_minutes}分</small><small>先送り候補 {data.today.postpone_candidate_minutes}分は含めない</small></div></div></div>
    {data.today.warning&&<div className="warning"><AlertTriangle/><div><strong>今日の実行見込みが目標を超えています</strong><p>{data.today.warning}</p></div></div>}
    <div className="schedule-organizer today-overview"><div><strong>今日の課題</strong><span>朝の計画 {data.today.start_of_day_planned_minutes}分・これから {data.today.active_remaining_minutes}分</span></div><div className="triage-summary four">
      {summary.map(item=><button type="button" className={`${item.key} ${todayFilter===item.key?"active":""}`} onClick={()=>setTodayFilter(item.key)} key={item.key}><span>{item.label}</span><strong>{item.count}件 / {item.minutes}分</strong></button>)}
    </div><div className="today-tabs">{summary.map(item=><button className={todayFilter===item.key?"active":""} onClick={()=>setTodayFilter(item.key)} key={item.key}>{item.label}</button>)}<button className={todayFilter==="all"?"active":""} onClick={()=>setTodayFilter("all")}>すべて</button></div></div>
    {!data.today.warning&&<div className="time-guidance"><Clock3 size={16}/><span>{data.today.guidance}</span></div>}
    <section className="panel">
      <div className="table-wrap"><table><thead><tr><th>種類</th><th>問題</th><th>推奨モード</th><th>予定時間</th><th>理由</th><th/></tr></thead>
      {triageGroups.map(group=><tbody key={group.key} className={`triage-group ${group.key}`}><tr className="triage-heading"><td colSpan={6}><strong>{group.label}</strong>{group.description&&<span>{group.description}</span>}</td></tr>{group.tasks.map((t,i)=><TodayTaskRows key={`${t.problem_id}-${i}`} task={t} problem={pmap[t.problem_id]} data={data} busy={busy} run={run} date={data.dashboard.today} onReview={setReviewTask} onOpenProblem={problem=>select(problem)} onPostpone={(item,initial)=>setPostponeTask({item,initial})} examPhase={examPhase}/>)}</tbody>)}</table></div>
      {todayFilter==="completed"&&<div className="completed-task-list">{data.today.completedTasks.map((task,index)=><div key={`${task.problem_id}-${index}`}><Check size={16}/><strong>{task.title}</strong><span>{task.minutes}分・{task.reason}</span></div>)}{!data.today.completedTasks.length&&<Empty>今日の完了記録はまだありません</Empty>}</div>}
      {todayFilter!=="completed"&&!triageGroups.length&&<Empty>この区分の課題はありません</Empty>}
    </section>
    {reviewTask&&<ReviewOutcomeModal item={reviewTask} busy={busy} close={()=>setReviewTask(null)} save={saveReview}/>}
    {postponeTask&&<PostponeReviewModal item={postponeTask.item} initial={postponeTask.initial} busy={busy} close={()=>setPostponeTask(null)} save={postponeReview}/>}
    {recalculateConfirm&&<Modal title="今日の計画を再整理" close={()=>setRecalculateConfirm(false)}><div className="postpone-review"><p>期限到来タスクは削除せず、必ずやる最大3件・余裕があれば最大2件・目標時間内へ分類し直します。完了状態・実績時間・タスクIDは変わりません。</p><div className="form-actions"><button className="ghost" onClick={()=>setRecalculateConfirm(false)}>キャンセル</button><button className="primary" disabled={busy} onClick={()=>{setRecalculateConfirm(false);run(()=>post("/api/today/recalculate",{}),"今日の実行計画を再整理しました")}}>再整理する</button></div></div></Modal>}
  </>
}
function copyText(text:string,label:string,setCopied:(value:string)=>void){
  return navigator.clipboard.writeText(text).then(()=>{setCopied(label);setTimeout(()=>setCopied(""),1800)});
}
function StudyPromptButtons({item,resolved}:{item:Partial<Review&Task>;resolved?:ResolvedReviewCard}) {
  const [copied,setCopied]=useState("");
  const firstPrompt=buildFirstAttemptGradingPrompt({
    problemId:item.problem_id||"",displayLabel:item.title||item.problem_id,theme:item.theme,
    canonicalProblemType:item.canonical_problem_type,mode:item.mode,estimatedMinutes:item.minutes||item.estimated_minutes
  });
  const reviewPrompt=item.id&&item.problem_id?buildReviewGradingPrompt({
    reviewId:item.id,problemId:item.problem_id,title:item.title,theme:item.theme,date:todayString(),mode:reviewMode(item),
    previousDate:item.previous_date,previousScore:item.previous_score,previousErrors:item.previous_errors,
    previousErrorPoint:item.previous_error_point,previousNextAction:item.previous_next_action,
    previousImprovementGuidance:item.previous_improvement_guidance,previousRequiredDerivation:item.previous_required_derivation,
    reviewMethod:item.review_method,reviewInstruction:item.review_instruction,reviewSteps:item.review_steps,
    requiresFullAnswer:item.requires_full_answer,linkedSProblemIds:item.linked_s_problem_ids,
    reviewScope:resolved?.effectiveReviewScope,targetedParts:resolved?.targetedParts,
    completionConditions:resolved?.completionConditions.value,allowedErrorTypes:resolved?.allowedErrorTypes,
    requiresKEvidence:resolved?.requiresKEvidence,learningPurpose:resolved?.prescription.learningPurpose,
    learningStage:resolved?.prescription.learningStage,assessmentTiming:resolved?.prescription.assessmentTiming,
    targetKind:resolved?.prescription.targetKind
  }):"";
  const repairPrompt=buildRepairPrompt({
    problemId:item.problem_id||"",displayLabel:item.title||item.problem_id,theme:item.theme,
    canonicalProblemType:item.canonical_problem_type,mode:item.mode,estimatedMinutes:item.minutes||item.estimated_minutes
  });
  const isFirst=(item.task_origin||"first_attempt")==="first_attempt"&&!item.id;
  return <div className="prompt-button-row">
    <button type="button" className={isFirst?"primary small":"ghost small"} onClick={()=>void copyText(firstPrompt,"first",setCopied)}><Copy size={14}/>{copied==="first"?"コピー済み":"初回採点プロンプト"}</button>
    <button type="button" className="ghost small" disabled={!reviewPrompt} onClick={()=>reviewPrompt&&void copyText(reviewPrompt,"review",setCopied)}><Copy size={14}/>{copied==="review"?"コピー済み":"復習採点プロンプト"}</button>
    <button type="button" className="ghost small" onClick={()=>void copyText(repairPrompt,"repair",setCopied)}><Copy size={14}/>{copied==="repair"?"コピー済み":"理解補修プロンプト"}</button>
  </div>;
}
function resolveCanonicalProblemId(problemId:string,aliases:ProblemAlias[]):string {
  let currentId=problemId;
  const visited=new Set<string>();
  while(currentId&&!visited.has(currentId)){
    visited.add(currentId);
    const alias=aliases.find(item=>{
      const row=item as ProblemAlias&{raw_problem_id?:string;corrected_problem_id?:string;canonical_problem_id?:string};
      return row.raw_problem_id===currentId||item.alias===currentId;
    }) as (ProblemAlias&{raw_problem_id?:string;corrected_problem_id?:string;canonical_problem_id?:string})|undefined;
    const next=alias?.corrected_problem_id||alias?.canonical_problem_id||alias?.problem_id;
    if(!next||next===currentId)break;
    currentId=next;
  }
  return currentId||problemId;
}
function originLabel(origin:string){
  return origin==="review_attempt"?"復習":origin==="first_attempt"?"初回":origin==="linked_s_check"?"関連確認":origin==="related_drill"?"関連補修":origin==="past_exam_followup"?"過去問補修":origin||"未設定";
}
function TodayTaskDetails({task,problem,onOpenProblem,problemAliases,examPhase,resolved}:{task:Task;problem?:Problem;onOpenProblem:(problem:Problem)=>void;problemAliases:ProblemAlias[];examPhase:ExamPhase;resolved?:ResolvedReviewCard}) {
  const template=reviewTemplate(task);
  const origin=resolved?.taskOrigin||task.task_origin||((task.id||task.review_method)?"review_attempt":"first_attempt");
  const hasPrevious=resolved?!!resolved.targetAttempt:task.attempt_exists!==false&&!!(task.previous_date||task.previous_error_point);
  const canonicalId=resolved?.canonicalProblemId||resolveCanonicalProblemId(task.problem_id,problemAliases);
  const displayLabel=resolved?.displayLabel||problem?.display_label||problem?.title||task.title||task.problem_id;
  const theme=resolved?.theme||problem?.theme||task.theme||"未設定";
  const type=resolved?.canonicalProblemType||problem?.canonical_problem_type||task.canonical_problem_type||"未設定";
  const questionExcerpt=(problem as Problem&{question_excerpt?:string})?.question_excerpt;
  return <div className="today-task-detail">
    <div className="task-detail-head">
      <div><small className="problem-id">{canonicalId!==task.problem_id?`${task.problem_id} → ${canonicalId}`:task.problem_id}</small><h3>{displayLabel}</h3><p>{theme}</p></div>
      <div className="task-meta-line"><span>{originLabel(origin)}</span><span>{modes[resolved?.effectiveMode||task.mode]||resolved?.effectiveMode||task.mode}</span><span>{resolved?.sheetLabel||template.sheetLabel}</span><span>{task.minutes}分</span></div>
    </div>
    <div className="task-detail-grid">
      <div><span>出題型</span><strong>{type}</strong></div>
      <div><span>問題文・概要</span><strong>{questionExcerpt||"問題文と模範解答は、書籍またはGoodNotesで確認してください。"}</strong></div>
    </div>
    {origin==="first_attempt"&&<div className="first-attempt-note"><Badge tone="green">初回</Badge><div><strong>この問題は初回です</strong><span>{task.mode==="full"?"まずフル答案として、方針・出発式・主要計算・結論まで書いてください。":"指定モードで、方針・出発式・今回見る量を明確にしてから解いてください。"}</span></div></div>}
    {origin==="review_attempt"&&<div className="first-attempt-note review"><Badge tone="orange">復習</Badge><div><strong>前回記録：{hasPrevious?"あり":"なし"}</strong><span>{hasPrevious?`前回：${task.previous_score||task.previous_date}`:"前回ミスの詳細はありません。通常確認として扱います。"}</span></div></div>}
    {origin==="linked_s_check"&&<div className="first-attempt-note linked"><Badge tone="blue">関連確認</Badge><div><strong>この問題自体の前回記録：{hasPrevious?"あり":"なし"}</strong><span>元問題の弱点から作られた関連確認です。元問題：{resolved?.sourceProblem?.displayLabel||task.source_problem_id||"記録なし"}</span></div></div>}
    {resolved?.reviewNeeded&&<div className="review-consistency-warning"><AlertTriangle size={18}/><div><strong>要確認</strong><span>問題情報または復習履歴の不整合により、具体的な復習指示を一時的に非表示にしています。</span></div></div>}
    <div className="today-specific-guide">
      <div><span>今日やる理由</span><strong>{task.reason}</strong></div>
      <div><span>今回見るポイント／直す点</span><strong>{resolved?.correctionTheme.value||correctionTheme({...task,theme,canonical_problem_type:type})}</strong></div>
      <div><span>最初に書くもの</span><strong>{resolved?.entryHint.value||referenceEntryPoint({...task,theme,canonical_problem_type:type})}</strong></div>
      <div><span>1行ヒント</span><strong>{resolved?.oneLineHint.value||oneLineHint({...task,theme,canonical_problem_type:type})}</strong></div>
      <div><span>この時期のシート運用</span><strong>{sheetUsageForPhase(resolved?.effectiveMode||task.mode,examPhase)}</strong></div>
    </div>
    <div className="today-card-actions">
      {problem&&<button type="button" className="ghost small" onClick={()=>onOpenProblem(problem)}><BookOpen size={14}/>問題詳細</button>}
      <SheetLink href={sheetHref(resolved?.effectiveMode||task.mode)} label="解答シート"/>
      <StudyPromptButtons resolved={resolved} item={{...task,problem_id:canonicalId,title:displayLabel,theme,canonical_problem_type:type,mode:resolved?.effectiveMode||task.mode,
        previous_date:resolved?.targetAttempt?.date||task.previous_date,previous_errors:resolved?.errorTypes||task.previous_errors,
        previous_error_point:resolved?.targetAttempt?.error_point||task.previous_error_point,previous_next_action:resolved?.targetAttempt?.next_action||task.previous_next_action}}/>
    </div>
  </div>;
}
function TodayTaskRows({task:t,problem,data,busy,run,date,onReview,onOpenProblem,onPostpone,examPhase}:{task:Task;problem?:Problem;data:Bootstrap;busy:boolean;run:(a:()=>Promise<unknown>,s:string)=>void;date:string;onReview:(task:Task)=>void;onOpenProblem:(problem:Problem)=>void;onPostpone:(task:Task,action:ScheduleAction)=>void;examPhase:ExamPhase}) {
  const resolved=resolveReviewCard({item:t,problems:data.problems,attempts:data.attempts,aliases:data.problemAliases,today:data.dashboard.today,examDate:data.settings.exam_date});
  const isReview=!!t.id&&!!t.review_type;
  const toggle=()=>isReview
    ?onReview(t)
    :run(()=>post("/api/today-check",{date,problem_id:t.problem_id,kind:t.kind,checked:!t.checked}),t.checked?"チェックを外しました":"解答済み・採点待ちにしました");
  return <><tr className={t.checked?"task-checked":""}><td><Badge tone={t.kind==="S確認"?"blue":t.error_type==="K"?"red":""}>{t.kind}</Badge></td><td><strong>{t.problem_id}</strong><small>{t.title}{t.checked&&<em className="grading-wait">採点待ち</em>}</small></td><td>{modes[t.mode]||t.mode}</td><td>{t.minutes}分</td><td>{t.reason}{t.postpone_count?` ・ 先送り${t.postpone_count}回（${t.postpone_reason}）`:""}</td><td><div className="task-actions"><SheetLink href={sheetHref(t.mode)} label="シート"/><label className="task-check"><input type="checkbox" checked={!!t.checked} disabled={busy} onChange={toggle}/><span>{isReview?"復習結果を記録":"解答済み"}</span></label></div><ScheduleQuickButtons item={t} busy={busy} select={action=>onPostpone(t,action)}/></td></tr>
    <tr className="task-plan-row"><td colSpan={6}><TodayTaskDetails task={t} problem={problem} onOpenProblem={onOpenProblem} problemAliases={data.problemAliases} examPhase={examPhase} resolved={resolved}/>{(t.review_method||t.review_reason)&&<ReviewPlanDetails item={t} compact resolved={resolved}/>}</td></tr></>;
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

function ProblemDetail({problem,data,run,busy,onBack,onImport}:{problem:Problem;data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean;onBack:()=>void;onImport:()=>void}) {
  const [editing,setEditing]=useState<Attempt|null>(null);
  const [form,setForm]=useState<Record<string,string>>({});
  const canonicalId=resolveCanonicalProblemId(problem.problem_id,data.problemAliases);
  const attempts=data.attempts.filter(a=>resolveCanonicalProblemId(a.problem_id,data.problemAliases)===canonicalId);
  const validAttempts=attempts.filter(attempt=>attemptConsistentForDisplay(attempt,problem));
  const reviews=data.reviews.filter(a=>resolveCanonicalProblemId(a.problem_id,data.problemAliases)===canonicalId);
  const latest=validAttempts[0],nextReview=reviews.filter(r=>r.status!=="done").sort((a,b)=>a.due_date.localeCompare(b.due_date))[0];
  const nextReviewCard=nextReview?resolveReviewCard({item:nextReview,problems:data.problems,attempts:data.attempts,aliases:data.problemAliases,today:data.dashboard.today,examDate:data.settings.exam_date}):undefined;
  const related=problem.related_s_problem_ids?.length?problem.related_s_problem_ids:String(problem.linked_s_problems||"").split(";").filter(Boolean);
  const editAttempt=(attempt:Attempt)=>{
    setEditing(attempt);
    setForm({date:attempt.date,mode:attempt.mode,time_minutes:String(attempt.time_minutes||""),
      mark:attempt.mark,score_label:attempt.score_label,score_numeric:attempt.score_numeric==null?"":String(attempt.score_numeric),
      error_types:(attempt.error_types||[attempt.error_type]).filter(error=>error!=="none").join(" + "),
      error_point:attempt.error_point||"",next_action:attempt.next_action||""});
  };
  const saveEdit=(event:React.FormEvent)=>{
    event.preventDefault();
    if(!editing)return;
    const target=editing;
    setEditing(null);
    run(()=>post(`/api/attempts/${target.id}/update`,form),"解答履歴を更新し、復習予定と苦手分析を再計算しました");
  };
  const removeAttempt=(attempt:Attempt)=>{
    if(!window.confirm(`${attempt.problem_id}（${attempt.date}）の解答履歴を削除します。関連する復習予定と苦手分析データも削除されます。`))return;
    run(()=>post(`/api/attempts/${attempt.id}/delete`,{}),"解答履歴と関連する復習予定・苦手分析データを削除しました");
  };
  return <><button className="back" onClick={onBack}>← 問題一覧へ</button><div className="detail-hero"><div><div className="detail-badges"><Badge tone={problem.category==="S"?"blue":""}>原典 {problem.category}</Badge>{problem.strategy_rank&&<Badge tone={problem.strategy_rank==="SS"?"red":problem.strategy_rank==="A+"?"orange":""}>実戦 {problem.strategy_rank}</Badge>}</div><h2>{problemDisplayLabel(problem)}</h2><p>{problem.problem_id} ・ {problem.theme}</p></div><button className="primary" onClick={onImport}><ClipboardPaste size={17}/>GPT採点結果を取り込む</button></div>
    {latest&&<section className="panel latest-result"><div><span>最新評価</span><strong>{latest.score_text||latest.score_label} {latest.score_numeric!=null?`/ ${latest.score_numeric}点`:""} / {latest.mark}</strong></div><div><span>K/W/N/C</span><strong>{latest.error_types?.join(" + ")||latest.error_type}</strong></div><div><span>次回復習</span><strong>{nextReview?.due_date||"—"}</strong></div></section>}
    {(latest?.corrected_answer||latest?.required_derivation||latest?.improvement_guidance)&&<details className="panel answer-feedback compact-feedback"><summary>GPTの修正版答案・途中計算を確認</summary><div className="feedback-body">
      {latest.corrected_answer&&<div><span>修正版答案</span><p>{latest.corrected_answer}</p></div>}
      {latest.required_derivation&&<div><span>省略してはいけない途中計算</span><p>{latest.required_derivation}</p></div>}
      {latest.improvement_guidance&&<div><span>次回の直し方</span><p>{latest.improvement_guidance}</p></div>}
    </div></details>}
    <div className="detail-grid"><section className="panel"><h3>問題情報</h3><dl><dt>役割</dt><dd>{problem.role}</dd><dt>出題型</dt><dd>{problem.canonical_problem_type||"—"}</dd><dt>難易度</dt><dd>{problem.difficulty!=null?`難${problem.difficulty}`:"—"}</dd><dt>推奨モード</dt><dd>{modes[problem.recommended_mode]}</dd><dt>関連S問題</dt><dd>{related.join(" / ")||"—"}</dd><dt>関連A問題</dt><dd>{problem.linked_a_problems||"—"}</dd><dt>関連過去問</dt><dd>{problem.linked_past_exams||"—"}</dd><dt>次回課題</dt><dd>{removeTimingExpressions(latest?.next_action)||"—"}</dd><dt>メモ</dt><dd>{problem.notes||"—"}</dd></dl>
    </section>
    <section className="panel"><h3>復習予定</h3>{nextReview&&nextReviewCard?<><div className="history"><CalendarCheck/><div><strong>{nextReviewCard.dueDate}</strong><span>{nextReviewCard.reviewMethodLabel}・{nextReview.status}</span></div></div><ReviewPlanDetails item={nextReview} resolved={nextReviewCard}/></>:<Empty>復習予定はありません</Empty>}</section></div>
    <section className="panel"><div className="panel-title"><h3>解答履歴</h3><span className="muted">{attempts.length}回</span></div>{attempts.some(a=>a.policy_validity==="invalid_legacy_k")&&<p className="legacy-k-note">旧ルーブリックによるKは履歴として保持していますが、現在の計画・K再発率には使用しません。</p>}{attempts.length?<div className="table-wrap"><table><thead><tr><th>日付</th><th>モード</th><th>評価</th><th>K/W/N/C</th><th>ミス</th><th>次の行動</th><th>操作</th></tr></thead><tbody>{attempts.map(a=>{const consistent=attemptConsistentForDisplay(a,problem);return <tr key={a.id} className={!consistent?"inconsistent-record":""}><td>{a.date}{!consistent&&<small> ID要確認</small>}</td><td>{modes[a.mode]||a.mode}</td><td>{a.mark} / {a.score_label}{a.score_numeric!=null?` ${a.score_numeric}点`:""}</td><td>{(a.error_types||[a.error_type]).filter(error=>error!=="none").map(error=><ErrorBadge key={error} value={error}/>)}{!(a.error_types||[a.error_type]).some(error=>error!=="none")&&<ErrorBadge value="none"/>}{a.policy_validity==="invalid_legacy_k"&&<small className="legacy-k-note">計画対象外</small>}{a.policy_validity==="needs_review"&&<small className="legacy-k-note">根拠要確認</small>}</td><td>{a.error_point||"—"}</td><td>{removeTimingExpressions(a.next_action)||"—"}</td><td><div className="history-actions"><button className="small ghost" onClick={()=>editAttempt(a)}><Pencil size={13}/>編集</button><button className="small danger-button" disabled={busy} onClick={()=>removeAttempt(a)}><Trash2 size={13}/>削除</button></div></td></tr>})}</tbody></table></div>:<Empty>まだ学習記録がありません</Empty>}</section>
    {editing&&<Modal title="解答履歴を編集" close={()=>setEditing(null)}><form className="form-grid analysis-edit-form" onSubmit={saveEdit}>
      <Field label="問題"><input value={editing.problem_id} readOnly/></Field>
      <Field label="学習日"><input type="date" value={form.date} onChange={event=>setForm({...form,date:event.target.value})}/></Field>
      <Field label="モード"><select value={form.mode} onChange={event=>setForm({...form,mode:event.target.value})}>{Object.entries(modes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></Field>
      <Field label="学習時間（分）"><input type="number" min="0" value={form.time_minutes} onChange={event=>setForm({...form,time_minutes:event.target.value})}/></Field>
      <Field label="mark"><select value={form.mark} onChange={event=>setForm({...form,mark:event.target.value})}>{["◎","○","△","×"].map(mark=><option key={mark}>{mark}</option>)}</select></Field>
      <Field label="評価"><select value={form.score_label} onChange={event=>setForm({...form,score_label:event.target.value})}>{["S","A","B","C"].map(score=><option key={score}>{score}</option>)}</select></Field>
      <Field label="点数"><input type="number" min="0" max="100" value={form.score_numeric} onChange={event=>setForm({...form,score_numeric:event.target.value})}/></Field>
      <Field label="K/W/N/C（複数可・空欄でなし）"><input value={form.error_types} onChange={event=>setForm({...form,error_types:event.target.value.toUpperCase()})} placeholder="N + W"/></Field>
      <Field label="ミス内容" wide><textarea value={form.error_point} onChange={event=>setForm({...form,error_point:event.target.value})}/></Field>
      <Field label="次の行動" wide><textarea value={form.next_action} onChange={event=>setForm({...form,next_action:event.target.value})}/></Field>
      <div className="analysis-edit-note wide"><AlertTriangle size={16}/><span>更新すると、この履歴から作られた復習予定と苦手分析が新しい内容で再計算されます。</span></div>
      <div className="form-actions wide"><button type="button" className="ghost" onClick={()=>setEditing(null)}>キャンセル</button><button className="primary" disabled={busy}>更新する</button></div>
    </form></Modal>}
  </>
}

function AttemptView({problems,run,busy}:{problems:Problem[];run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [form,setForm]=useState<StudyUpdate&{time_minutes:string;memo:string}>({...blankUpdate(),time_minutes:"",memo:""});
  const chosen=problems.find(p=>p.problem_id===form.problem_id);
  const related=chosen?.related_s_problem_ids?.length?chosen.related_s_problem_ids:String(chosen?.linked_s_problems||"").split(";").filter(Boolean);
  const previewPlan=createAttemptReviewPlan(form,[]);
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
  const [filter,setFilter]=useState("open");
  const [selectedReview,setSelectedReview]=useState<Review|null>(null);
  const [postponeReviewItem,setPostponeReviewItem]=useState<{item:Review;initial:ScheduleAction}|null>(null);
  const rows=data.reviews.filter(r=>!["id_review_needed","ignored"].includes(r.status)&&(filter==="all"||(filter==="open"?["pending","overdue","deferred"].includes(r.status):r.status===filter)))
    .sort((a,b)=>a.due_date.localeCompare(b.due_date)||Number(a.manual_order||0)-Number(b.manual_order||0)||a.id-b.id);
  const resolveReview=(review:Review)=>{
    const card=resolveReviewCard({item:review,problems:data.problems,attempts:data.attempts,aliases:data.problemAliases,today:data.dashboard.today,examDate:data.settings.exam_date});
    const source=card.targetAttempt;
    const item:Partial<Review&Task>={...review,problem_id:card.canonicalProblemId,title:card.displayLabel,theme:card.theme,
      task_origin:card.taskOrigin,attempt_exists:!!source,mode:card.effectiveMode,effective_mode:card.effectiveMode,sheet_type:card.sheetType,
      canonical_problem_type:card.canonicalProblemType,canonical_keywords:data.problems.find(problem=>problem.problem_id===card.canonicalProblemId)?.canonical_keywords||[],
      previous_date:source?.date,previous_score:source?`${source.score_text||source.score_label}${source.score_numeric!=null?` ${source.score_numeric}点`:""}`:"",
      previous_errors:card.errorTypes,previous_error_point:source?.error_point||"",previous_next_action:source?.next_action||"",
      previous_improvement_guidance:source?.improvement_guidance||"",previous_required_derivation:source?.required_derivation||"",
      previous_corrected_answer:source?.corrected_answer||"",has_saved_gpt_feedback:!!(source?.improvement_guidance||source?.required_derivation||source?.corrected_answer||source?.result_summary)};
    return {item,card};
  };
  const saveReview=(body:Record<string,unknown>)=>{if(!selectedReview)return;const id=selectedReview.id;setSelectedReview(null);sessionStorage.removeItem(referenceStorageKey(id));sessionStorage.removeItem(referenceClosedStorageKey(id));run(()=>post(`/api/reviews/${id}/complete`,body),"復習結果を保存し、次回間隔を再計算しました")};
  const postpone=(body:Record<string,unknown>,label:string)=>{if(!postponeReviewItem)return;const id=postponeReviewItem.item.id;setPostponeReviewItem(null);
    run(()=>post(`/api/reviews/${id}/postpone`,body),`復習を${label}へ送りました`)};
  return <><div className="toolbar"><div className="segmented">{[["open","未完了"],["overdue","期限切れ"],["deferred","期限なし"],["done","完了"],["all","すべて"]].map(([k,v])=><button key={k} className={filter===k?"active":""} onClick={()=>setFilter(k)}>{v}</button>)}</div></div><div className="review-list">{rows.map(r=>{const resolved=resolveReview(r);return <article className="panel review-card" key={r.id}><div className="review-card-head"><div><Badge tone={resolved.card.reviewNeeded?"red":r.status==="overdue"?"red":r.status==="done"?"green":""}>{resolved.card.reviewNeeded?"要確認":r.status==="overdue"?"期限切れ":r.status==="done"?"完了":r.status==="deferred"?"期限なし":"予定"}</Badge><h3>{resolved.card.displayLabel}</h3><span>{resolved.card.canonicalProblemId} ・ 次回復習 {r.status==="deferred"?"期限なし":resolved.card.dueDate}{(r.postpone_count||r.postponed_count)?` ・ 先送り ${r.postpone_count||r.postponed_count}回`:""}{r.postpone_reason?` ・ ${r.postpone_reason}`:""}{r.completion_result?` ・ 結果 ${r.completion_result}`:""}</span></div>{r.status==="done"?(r.completion_result?<Badge tone="green">結果記録済み</Badge>:<button disabled={busy} className="small ghost" onClick={()=>run(()=>post(`/api/reviews/${r.id}/pending`,{}),"未完了に戻しました")}>未完了に戻す</button>):<div className="review-card-actions"><button disabled={busy||r.status==="deferred"||resolved.card.reviewNeeded} className="small primary" onClick={()=>setSelectedReview(r)}><Check size={14}/>復習結果を記録</button></div>}</div>{r.status!=="done"&&<ScheduleQuickButtons item={resolved.item} busy={busy} select={initial=>setPostponeReviewItem({item:r,initial})}/>}<ReviewPlanDetails item={resolved.item} resolved={resolved.card}/></article>})}</div>{!rows.length&&<section className="panel"><Empty>該当する復習予定はありません</Empty></section>}{selectedReview&&<ReviewOutcomeModal item={resolveReview(selectedReview).item} busy={busy} close={()=>setSelectedReview(null)} save={saveReview}/>} {postponeReviewItem&&<PostponeReviewModal item={resolveReview(postponeReviewItem.item).item} initial={postponeReviewItem.initial} busy={busy} close={()=>setPostponeReviewItem(null)} save={postpone}/>}</>
}
function WeakView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [selected,setSelected]=useState<string[]>([]);
  const [copied,setCopied]=useState(false);
  const [editing,setEditing]=useState<Attempt|null>(null);
  const [form,setForm]=useState<Record<string,string>>({});
  const trend=analyzeWeakTrends(data.problems,data.attempts,data.weakNotes,"",data.problemAliases);
  const topThemes=trend.themes.slice(0,8),maxTheme=Math.max(1,...topThemes.map(theme=>theme.score));
  const themeSignature=topThemes.map(theme=>theme.label).join("|");
  useEffect(()=>{setSelected(current=>current.length?current.filter(theme=>topThemes.some(row=>row.label===theme)):topThemes.slice(0,3).map(theme=>theme.label))},[themeSignature]);
  const errorCounts=Object.fromEntries(trend.errors.map(error=>[error.error,error.count])) as Record<string,number>;
  const errorTotal=trend.errors.reduce((sum,error)=>sum+error.count,0);
  const errorColors:Record<string,string>={K:"#b33c36",W:"#d17a35",N:"#487da9",C:"#8b9290"};
  let stop=0;
  const donutParts=["K","W","N","C"].map(error=>{const start=stop;stop+=errorTotal?errorCounts[error]/errorTotal*100:0;return `${errorColors[error]} ${start}% ${stop}%`});
  const weekly=trend.weeks,maxWeek=Math.max(1,...weekly.map(week=>week.count));
  const quizPrompt=buildQuizPrompt(selected,data.problems,data.attempts,data.weakNotes,5,data.problemAliases);
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
  if(!trend.attemptCount) return <><section className="weak-trend-hero"><div><span className="eyebrow">WEAKNESS TRENDS</span><h2>GPT採点が集まると、苦手の傾向が見えてきます</h2><p>この画面はK/W/N/Cが付いた採点だけから、繰り返すミスを探します。ミスなしの採点は学習履歴には残りますが、弱点グラフには加算しません。</p></div></section><section className="panel weak-empty-explanation">{trend.totalAttemptCount?<><Check size={28}/><h3>採点は{trend.totalAttemptCount}件ありますが、弱点として数えるミスは0件です</h3><p>現在の採点はすべて「none（ミスなし）」です。K/W/N/Cが付いた結果を保存すると、テーマ別・分類別・週別のグラフが表示されます。</p></>:<Empty>まだ採点記録がありません。GPT採点結果を取り込むと自動で蓄積されます</Empty>}</section></>;
  return <>
    <section className="weak-trend-hero"><div><span className="eyebrow">WEAKNESS TRENDS</span><h2>採点結果から見える苦手傾向</h2><p>ここは復習タスクの一覧ではありません。問題とGPT採点結果から、繰り返し落としているテーマとミスの型を俯瞰する場所です。</p></div><div className="trend-summary"><strong>{trend.themes.length}</strong><span>検出テーマ</span><small>最多 {trend.topTheme}</small></div></section>
    <div className="trend-metrics"><Metric label="保存済みの全採点" value={trend.totalAttemptCount} unit="件" hint={`ミスなし ${trend.noErrorCount}件`}/><Metric label="ミスあり採点" value={trend.attemptCount} unit="件" hint="K/W/N/Cが1つ以上"/><Metric label="主なミス型" value={dominantError} hint={`${errorCounts[dominantError]||0}件`}/><Metric label="K発生率" value={trend.kRate} unit="%" hint="ミスあり採点に占める割合"/></div>
    <section className="weak-reading-guide"><strong>この画面の数え方</strong><span>1回の採点にK/W/N/Cが1つでもあれば「ミスあり採点」1件です。テーマの点数は重要度（K=5、N=3、W=2、C=1）の合計で、点数が高いほど先に復習します。ミスなしの結果は弱点には加算しません。</span></section>
    <div className="trend-grid">
      <section className="panel theme-chart"><div className="panel-title"><div><span className="eyebrow">BY THEME</span><h3>苦手テーマ上位</h3></div><BarChart3 size={19}/></div>
        {topThemes.map(theme=><div className="theme-bar-row" key={theme.label}><div><strong>{theme.label}</strong><span>採点 {theme.count}件</span></div><div className="theme-bar"><i style={{width:`${theme.score/maxTheme*100}%`}}/></div><b>{theme.score}</b></div>)}
      </section>
      <section className="panel error-chart"><div className="panel-title"><div><span className="eyebrow">BY ERROR TYPE</span><h3>K/W/N/Cの構成</h3></div></div>
        <div className="donut-wrap"><div className="error-donut" style={{background:errorTotal?`conic-gradient(${donutParts.join(",")})`:"#e8ece8"}}><strong>{errorTotal}</strong><span>分類済み</span></div>
          <div className="error-legend">{["K","W","N","C"].map(error=><div key={error}><i style={{background:errorColors[error]}}/><strong>{error}</strong><span>{errorCounts[error]}件</span></div>)}</div></div>
      </section>
      <section className="panel weekly-chart"><div className="panel-title"><div><span className="eyebrow">WEEKLY DETECTION</span><h3>週別・ミスあり採点件数</h3><p>記録した週に加算されます。増加は悪化ではなく、採点記録が増えた意味です。</p></div></div>
        <div className="week-bars">{weekly.map(week=><div key={week.label}><span>{week.count}件</span><i style={{height:`${Math.max(4,week.count/maxWeek*100)}%`}}/><small>{week.label.slice(5)}<b>重要度 {week.score}</b></small></div>)}</div>
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

function PastView({data,go,run,busy}:{data:Bootstrap;go:(p:Page)=>void;run:(a:()=>Promise<unknown>,s:string)=>Promise<boolean>;busy:boolean}) {
  const days=data.dashboard.pace.daysRemaining;
  const blankQuestions=():ScanQuestion[]=>Array.from({length:5},(_,index)=>({questionLabel:`問${index+1}`,predictedType:"",firstStep:"",predictedScore:null,predictedMinutes:null,sinkRisk:"medium",selected:index<3,selectionReason:"",plannedOrder:index<3?index+1:null,actualScore:null,actualMinutes:null,typeJudgmentCorrect:null,firstStepCorrect:null,sank:null,hintUsed:false,referenceUsed:false,completed:false}));
  const [session,setSession]=useState<{session_kind:PastExamSessionKind;date:string;year:string;scan_set_source:string;scan_minutes:string;actual_total_minutes:string;selection_strategy:string;selection_change_reason:string;notes:string;answer_exposure:boolean;initial_selected_problem_ids:string[];questions:ScanQuestion[]}>({session_kind:defaultSessionKind(days),date:todayString(),year:"2025",scan_set_source:"past_exam_year",scan_minutes:"10",actual_total_minutes:"",selection_strategy:"",selection_change_reason:"",notes:"",answer_exposure:false,initial_selected_problem_ids:[],questions:blankQuestions()});
  const [analysisText,setAnalysisText]=useState<Record<number,string>>({});
  const [editingSessionId,setEditingSessionId]=useState<number|null>(null);
  const pastProblems=data.problems.filter(problem=>problem.category==="past_exam");
  const pmap=new Map(pastProblems.map(problem=>[problem.problem_id,problem]));
  const attempts=data.attempts.filter(attempt=>pmap.has(attempt.problem_id));
  const errorAttempts=attempts.filter(attempt=>(attempt.error_types||[attempt.error_type]).some(error=>error!=="none"));
  const pending=data.reviews.filter(review=>review.status!=="done"&&pmap.has(review.problem_id));
  const themes=new Set(errorAttempts.map(attempt=>pmap.get(attempt.problem_id)?.theme).filter(Boolean));
  const submitSession=async()=>{
    const selectedProblemIds=session.questions.filter(row=>row.selected).map(row=>row.problemId||row.questionLabel);
    const payload={...session,year:Number(session.year),stage:stageForDays(days),scan_minutes:Number(session.scan_minutes||0),actual_total_minutes:Number(session.actual_total_minutes||0),
      initial_selected_problem_ids:editingSessionId?session.initial_selected_problem_ids:selectedProblemIds,
      final_selected_problem_ids:editingSessionId?selectedProblemIds:[],
      solve_order:session.questions.filter(row=>row.selected).sort((a,b)=>Number(a.plannedOrder||99)-Number(b.plannedOrder||99)).map(row=>row.problemId||row.questionLabel)};
    const path=editingSessionId?`/api/past-sessions/${editingSessionId}/update`:"/api/past-sessions";
    const ok=await run(()=>post(path,payload),editingSessionId?"事後結果を保存しました":"5問スキャンの事前判断を保存しました");
    if(ok)setEditingSessionId(null);
  };
  const editPastSession=(saved:PastSession)=>{
    setEditingSessionId(saved.id);setSession({session_kind:saved.session_kind||"scan_plus_one",date:saved.date,year:String(saved.year||""),
      scan_set_source:saved.scan_set_source||"past_exam_year",scan_minutes:String(saved.scan_minutes||0),actual_total_minutes:String(saved.actual_total_minutes||""),
      selection_strategy:saved.selection_strategy||"",selection_change_reason:saved.selection_change_reason||"",notes:saved.notes||"",answer_exposure:!!saved.answer_exposure,
      initial_selected_problem_ids:saved.initial_selected_problem_ids||[],questions:saved.questions?.length?saved.questions:blankQuestions()});
    window.scrollTo({top:0,behavior:"smooth"});
  };
  return <>
    <section className="past-analysis-intro">
      <div><span className="eyebrow">PAST EXAM WORKFLOW</span><h2>5問を見て、得点できる3問を選ぶ</h2><p>スキャン判断は通常答案のK/W/N/Cと分離します。実際に解いた問題だけをGPT採点へ接続し、未解答問題は0点にしません。</p></div>
      <button className="primary" onClick={()=>go("import")}><ClipboardPaste size={17}/>解いた問題をGPT採点</button>
    </section>
    <div className="past-analysis-metrics">
      <Metric label="取り込み済み" value={attempts.length} unit="件" hint="過去問の採点履歴"/>
      <Metric label="要復習" value={errorAttempts.length} unit="件" hint="K/W/N/Cあり" tone={errorAttempts.length?"amber":""}/>
      <Metric label="復習待ち" value={pending.length} unit="件" hint="過去問の未完了予定"/>
      <Metric label="苦手テーマ" value={themes.size} unit="件" hint="失点したテーマ"/>
    </div>
    <details className="panel past-session-quick" open><summary>{editingSessionId?"5問スキャンの事後結果を入力":"5問スキャンを開始"}</summary><form className="scan5-form" onSubmit={event=>{event.preventDefault();void submitSession()}}>
      <div className="form-grid"><Field label="形式"><select value={session.session_kind} onChange={event=>setSession({...session,session_kind:event.target.value as PastExamSessionKind})}><option value="scan_only">scan only</option><option value="scan_plus_one">scan＋1問</option><option value="selected_three_timed">3問90分</option><option value="retrospective_review">事後レビュー</option></select></Field>
      <Field label="実施日"><input type="date" value={session.date} onChange={event=>setSession({...session,date:event.target.value})}/></Field>
      <Field label="年度"><input inputMode="numeric" value={session.year} onChange={event=>setSession({...session,year:event.target.value})}/></Field>
      <Field label="素材"><select value={session.scan_set_source} onChange={event=>setSession({...session,scan_set_source:event.target.value})}><option value="past_exam_year">過去問年度</option><option value="mixed_a_problems">A問題混合</option><option value="custom_set">カスタム</option></select></Field>
      <Field label="スキャン時間"><input type="number" value={session.scan_minutes} onChange={event=>setSession({...session,scan_minutes:event.target.value})}/></Field>
      {session.session_kind==="selected_three_timed"&&<Field label="全体実時間"><input type="number" value={session.actual_total_minutes} onChange={event=>setSession({...session,actual_total_minutes:event.target.value})}/></Field>}
      <Field label="選題方針" wide><input value={session.selection_strategy} onChange={event=>setSession({...session,selection_strategy:event.target.value})} placeholder="確実な2問→残り1問を比較"/></Field>
      {editingSessionId&&<><Field label="選択が変わった理由" wide><input value={session.selection_change_reason} onChange={event=>setSession({...session,selection_change_reason:event.target.value})}/></Field><Field label="事後メモ" wide><textarea value={session.notes} onChange={event=>setSession({...session,notes:event.target.value})}/></Field></>}</div>
      <div className="scan-question-list">{session.questions.map((question,index)=><article className="scan-question-card" key={index}><div className="scan-question-head"><strong>{index+1}問目</strong><label><input type="checkbox" checked={question.selected} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,selected:event.target.checked}:row)})}/>選ぶ</label></div>
        <div className="form-grid"><Field label="問題IDまたはラベル"><input value={question.problemId||question.questionLabel} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,problemId:event.target.value}:row)})}/></Field><Field label="型"><input value={question.predictedType} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,predictedType:event.target.value}:row)})}/></Field><Field label="最初の一手" wide><input value={question.firstStep} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,firstStep:event.target.value}:row)})}/></Field><Field label="予想得点"><input type="number" value={question.predictedScore??""} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,predictedScore:event.target.value===""?null:Number(event.target.value)}:row)})}/></Field><Field label="予想時間"><input type="number" value={question.predictedMinutes??""} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,predictedMinutes:event.target.value===""?null:Number(event.target.value)}:row)})}/></Field><Field label="沈没リスク"><select value={question.sinkRisk} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,sinkRisk:event.target.value as ScanQuestion["sinkRisk"]}:row)})}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field><Field label="解答順"><input type="number" min="1" max="3" value={question.plannedOrder??""} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,plannedOrder:event.target.value===""?null:Number(event.target.value)}:row)})}/></Field><Field label="選ぶ／捨てる理由" wide><input value={question.selectionReason} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,selectionReason:event.target.value}:row)})}/></Field>
        {session.session_kind!=="scan_only"&&<><Field label="実際に解いた"><input type="checkbox" checked={!!question.completed} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,completed:event.target.checked}:row)})}/></Field><Field label="実得点（未評価は空欄）"><input type="number" value={question.actualScore??""} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,actualScore:event.target.value===""?null:Number(event.target.value)}:row)})}/></Field><Field label="実時間"><input type="number" value={question.actualMinutes??""} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,actualMinutes:event.target.value===""?null:Number(event.target.value)}:row)})}/></Field><Field label="型判断"><select value={question.typeJudgmentCorrect==null?"":question.typeJudgmentCorrect?"yes":"no"} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,typeJudgmentCorrect:event.target.value===""?null:event.target.value==="yes"}:row)})}><option value="">未評価</option><option value="yes">正しい</option><option value="no">誤り</option></select></Field><Field label="初手判断"><select value={question.firstStepCorrect==null?"":question.firstStepCorrect?"yes":"no"} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,firstStepCorrect:event.target.value===""?null:event.target.value==="yes"}:row)})}><option value="">未評価</option><option value="yes">正しい</option><option value="no">誤り</option></select></Field><Field label="沈没した"><input type="checkbox" checked={!!question.sank} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,sank:event.target.checked}:row)})}/></Field><Field label="ヒント使用"><input type="checkbox" checked={!!question.hintUsed} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,hintUsed:event.target.checked}:row)})}/></Field><Field label="外部参照"><input type="checkbox" checked={!!question.referenceUsed} onChange={event=>setSession({...session,questions:session.questions.map((row,i)=>i===index?{...row,referenceUsed:event.target.checked}:row)})}/></Field></>}</div></article>)}</div>
      <label className="reference-reproduction-check"><input type="checkbox" checked={session.answer_exposure} onChange={event=>setSession({...session,answer_exposure:event.target.checked})}/>開始前または途中で模範解答を見た</label>
      <div className="form-actions"><button type="button" className="ghost" onClick={()=>{setEditingSessionId(null);setSession({...session,questions:blankQuestions()})}}>入力をリセット</button><button className="primary" disabled={busy}>{editingSessionId?"事後結果を保存":"事前判断を保存"}</button></div>
    </form></details>
    <section className="section-head"><div><span className="eyebrow">SCAN HISTORY</span><h2>過去問セッション</h2></div></section>
    <div className="past-result-list">{data.pastSessions.map(saved=>{const metrics=scanMetrics(saved),exposure=deriveExposure(saved);return <article className="panel past-result-card" key={saved.id}><div className="past-result-head"><div><h3>{saved.year||saved.source_label||"カスタム"}・{saved.session_kind||saved.session_type}</h3><span>{saved.date} ・ 露出：{exposure}</span></div><Badge tone={saved.exam_score_eligible?"green":""}>{saved.exam_score_eligible?"本番得点対象":"学習指標"}</Badge></div><div className="past-result-body"><div><span>型判断</span><p>{metrics.typeIdentificationAccuracy==null?"未評価":`${metrics.typeIdentificationAccuracy}%`}</p></div><div><span>初手判断</span><p>{metrics.firstStepAccuracy==null?"未評価":`${metrics.firstStepAccuracy}%`}</p></div><div><span>選題成功率</span><p>{metrics.selectionSuccessRate==null?"未評価":`${metrics.selectionSuccessRate}%`}</p></div><div><span>解答済み</span><p>{metrics.solvedCount}問</p></div></div><div className="task-actions"><button className="secondary" onClick={()=>editPastSession(saved)}><Pencil size={15}/>事後結果を入力</button><button className="secondary" onClick={()=>navigator.clipboard.writeText(buildScan5Prompt(saved,days))}><Copy size={15}/>GPT分析プロンプト</button>{metrics.solvedCount>0&&<button className="secondary" onClick={()=>go("import")}><ClipboardPaste size={15}/>解いた問題を採点</button>}</div><details><summary>GPT分析結果を取り込む</summary><textarea value={analysisText[saved.id]||""} onChange={event=>setAnalysisText({...analysisText,[saved.id]:event.target.value})} placeholder="scan_update YAMLを貼り付け"/><button className="secondary" disabled={busy||!analysisText[saved.id]} onClick={()=>run(()=>post(`/api/past-sessions/${saved.id}/analysis`,{text:analysisText[saved.id]}),"scan5分析を保存しました")}>専用分析を保存</button></details></article>})}</div>
    <section className="section-head"><div><span className="eyebrow">REPAIR TARGETS</span><h2>過去問で明らかになった要復習箇所</h2></div></section>
    <div className="past-result-list">{errorAttempts.map(attempt=>{
      const problem=pmap.get(attempt.problem_id)!;
      const review=data.reviews.find(item=>item.generated_from_attempt_id===attempt.id&&item.problem_id===attempt.problem_id);
      const insight=data.dashboard.weaknessInsights.find(item=>item.theme.includes(problem.theme)||problem.theme.includes(item.theme));
      const direct=[...String(problem.linked_a_problems||"").split(/[;,、\s]+/),...(problem.related_s_problem_ids||[])].filter(Boolean);
      const targets=[...new Set([...direct,...(insight?.recommendedA||[]),...(insight?.recommendedS||[])])];
      return <article className="panel past-result-card" key={attempt.id}>
        <div className="past-result-head"><div><ErrorBadge value={attempt.primary_error_type||attempt.error_type}/><h3>{problemDisplayLabel(problem)}</h3><span>{attempt.date} ・ {attempt.score_text||attempt.score_label} {attempt.score_numeric!=null?`${attempt.score_numeric}点`:""}</span></div>{review&&<Badge tone={review.status==="overdue"?"red":"orange"}>{review.due_date} 復習</Badge>}</div>
        <div className="past-result-body"><div><span>失点・不安定だった箇所</span><p>{attempt.error_point||attempt.result_summary||"詳細未入力"}</p></div><div><span>次に直すこと</span><p>{removeTimingExpressions(attempt.next_action)||review?.review_instruction||"GPT採点結果の指示を確認"}</p></div></div>
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
    {mode:"check",title:"短時間チェック",pages:"1ページ",time:"3〜5分",description:"C・none・安定S用。型、初手、今見る量、注意点だけを確認します。"},
    {mode:"skeleton",title:"骨格答案",pages:"1ページ",time:"10〜20分",description:"答案の設計図だけを作ります。方針、出発式、今見る量、条件、道具、流れ、最後に示すことを書き、最終計算はしません。"},
    {mode:"main_calc",title:"主要計算",pages:"1ページ",time:"10〜20分",description:"計算・積分・和・変数変換など、得点の中心になる作業部分だけを途中式付きで書きます。"},
    {mode:"full",title:"フル答案",pages:"2ページ",time:"30〜45分",description:"採点可能な答案を最初から最後まで書くための、方針欄付き横罫シートです。"},
    {mode:"scan",title:"5問スキャン",pages:"1ページ",time:"5〜10分",description:"5問の型、入口、完走見込み、事故リスクを比較し、選ぶ3問と捨てる2問を決めます。"},
    {mode:"exam_90min",title:"90分演習",pages:"4ページ",time:"90分",description:"選題・時間配分の作戦ページと、選択した3問それぞれの答案ページです。"}
  ];
  const allHref="./answer-sheets/00-all-answer-sheets.pdf";
  const examplesHref="./answer-sheets/06-filled-examples.pdf";
  return <>
    <section className="answer-sheet-hero">
      <div><span className="eyebrow">GOODNOTES / IPAD LANDSCAPE</span><h2>解答方式に合わせて、書く場所を先に決める</h2><p>すべてiPad横画面と同じ4:3比率です。PDFを開いてGoodNotesへ共有し、原本を複製してから使ってください。</p></div>
      <div className="answer-sheet-hero-actions"><SheetLink href={examplesHref} label="模範記入例を見る"/><SheetLink href={allHref} label="全シートを見る" primary/></div>
    </section>
    <section className="mode-role-guide">
      <div><strong>check</strong><span>思い出せるか。型・初手・今見る量・注意点だけ。</span></div>
      <div><strong>skeleton</strong><span>設計図を作れるか。最終式や完成答案は不要。</span></div>
      <div><strong>main_calc</strong><span>落とした計算だけ直す。問題全体は解き直さない。</span></div>
      <div><strong>full</strong><span>本番答案。途中式・条件・計算・結論まで全部。</span></div>
    </section>
    <div className="answer-sheet-grid">{sheets.map(sheet=><section className={`panel answer-sheet-card mode-${sheet.mode}`} key={sheet.mode}>
      <div className="sheet-preview"><NotebookPen size={24}/><span>{sheet.pages}</span></div>
      <div className="sheet-card-body"><div><Badge>{modes[sheet.mode]}</Badge><h3>{sheet.title}シート</h3></div><p>{sheet.description}</p><small>目安 {sheet.time}・{sheet.pages}</small></div>
      <SheetLink href={sheetHref(sheet.mode)} label="PDFを見る"/>
    </section>)}</div>
    <section className="panel sheet-example-note"><Sparkles size={22}/><div><h3>模範記入例</h3><p>骨格・主要計算・フル答案・5問スキャン・90分作戦の5種類について、「どの程度まで書けばよいか」を記入済みPDFで確認できます。</p></div><SheetLink href={examplesHref} label="5種類の記入例を見る"/></section>
    <section className="panel goodnotes-guide"><div><span className="eyebrow">HOW TO USE</span><h3>GoodNotesへの入れ方</h3></div><ol><li>使うモードの「PDFを見る」を押す</li><li>「GoodNotes用に開く」を押して共有する</li><li>「新規書類として読み込む」で保存する</li><li>毎回、原本ページを複製してから答案を書く</li><li>書き終えたページを画像またはPDFでGPTへ送る</li></ol></section>
  </>;
}

function SettingsView({data,run,busy}:{data:Bootstrap;run:(a:()=>Promise<unknown>,s:string)=>void;busy:boolean}) {
  const [examDate,setExamDate]=useState(data.settings.exam_date);
  const [dailyMinutes,setDailyMinutes]=useState(String(data.settings.daily_study_minutes||150));
  const [problemPreview,setProblemPreview]=useState<{raw:unknown;version:string;added:number;changed:number;unchanged:number;total:number}|null>(null);
  const [aliasPreview,setAliasPreview]=useState<{raw:unknown;version:string;total:number;added:number;changed:number;unchanged:number}|null>(null);
  const [integratedPreview,setIntegratedPreview]=useState<{raw:unknown;version:string;problemCount:number;answerCount:number;aliasCount:number;added:number;changed:number;unchanged:number}|null>(null);
  const [backupMasterWarning,setBackupMasterWarning]=useState<unknown|null>(null);
  const [showDiagnostics,setShowDiagnostics]=useState(false);
  const [masterError,setMasterError]=useState("");
  const [diagnosticExporting,setDiagnosticExporting]=useState(false);
  const [diagnosticResult,setDiagnosticResult]=useState<{readOnlyVerified:boolean;problemCount:number;reviewCount:number;issueCount:number}|null>(null);
  const [diagnosticError,setDiagnosticError]=useState("");
  const [legacyKPreview,setLegacyKPreview]=useState<{invalid_legacy_k_count:number;needs_review_count:number;superseded_task_count:number;resolved_task_count:number}|null>(null);
  const [sourcePreview,setSourcePreview]=useState<{source_mismatch_count:number;verified_relation_count:number;superseded_count:number;regenerated_count:number;needs_review_count:number;unchanged_completed_count:number;
    active_source_mismatch:number;pending_verified_link_needs_migration:number;invalid_legacy_cards_to_supersede:number;
    historical_completed_linked_reviews:number;unresolved_needs_review:number;verified_relation_migrated:number;causes:Record<string,number>}|null>(null);
  const saveBlob=(content:string|Blob,name:string,type:string)=>{
    const payload=content instanceof Blob?content:new Blob([content],{type});
    const url=URL.createObjectURL(payload);const a=document.createElement("a");
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const downloadJson=async()=>saveBlob(JSON.stringify(await exportBackup(),null,2),`stat-study-${todayString()}.json`,"application/json");
  const downloadCsv=async(table:"attempts"|"problems")=>saveBlob(await csvFor(table),`${table}-${todayString()}.csv`,"text/csv;charset=utf-8");
  const restore=async(file:File)=>{
    try{
      const parsed=JSON.parse(await file.text());
      if(isProblemPack(parsed)){setBackupMasterWarning(parsed);return}
      await run(async()=>restoreBackup(parsed),"バックアップを復元しました");
    }catch(error){setMasterError((error as Error).message)}
  };
  const compareRows=<T extends Record<string,unknown>>(current:T[],incoming:T[],key:keyof T)=>{
      const map=new Map(current.map(row=>[String(row[key]),row]));
      let added=0,changed=0,unchanged=0;
      for(const row of incoming){
        const old=map.get(String(row[key]));
        if(!old)added++;
        else {
          const clean=(value:T)=>Object.fromEntries(Object.entries(value).filter(([field])=>field!=="imported_at"));
          if(JSON.stringify(clean(old))===JSON.stringify(clean(row)))unchanged++;
          else changed++;
        }
      }
      return {added,changed,unchanged};
  };
  const packDiff=(raw:unknown)=>{
    const parsed=parseIntegratedMasterPayload(raw);
    const problemDiff=parsed.problemMaster?masterDiff(data.problems,parsed.problemMaster.problems):{added:0,changed:0,unchanged:0,total:0};
    const answerDiff=parsed.answerIndex?compareRows(data.answerIndex as unknown as Record<string,unknown>[],parsed.answerIndex.answers as unknown as Record<string,unknown>[],"problem_id"): {added:0,changed:0,unchanged:0};
    const aliasDiff=parsed.aliases?compareRows(data.problemAliases as unknown as Record<string,unknown>[],parsed.aliases.aliases as unknown as Record<string,unknown>[],"alias"): {added:0,changed:0,unchanged:0};
    return {parsed,added:problemDiff.added+answerDiff.added+aliasDiff.added,
      changed:problemDiff.changed+answerDiff.changed+aliasDiff.changed,
      unchanged:problemDiff.unchanged+answerDiff.unchanged+aliasDiff.unchanged};
  };
  const previewIntegrated=async(file:File)=>{
    try{
      const raw=JSON.parse(await file.text()),diff=packDiff(raw),parsed=diff.parsed;
      setIntegratedPreview({raw,version:parsed.version,problemCount:parsed.problemMaster?.problems.length||0,
        answerCount:parsed.answerIndex?.answers.length||0,aliasCount:parsed.aliases?.aliases.length||0,
        added:diff.added,changed:diff.changed,unchanged:diff.unchanged});
      setMasterError("");
    }catch(error){setIntegratedPreview(null);setMasterError((error as Error).message)}
  };
  const previewProblemMaster=async(file:File)=>{
    try{const raw=JSON.parse(await file.text()),parsed=parseProblemMasterPayload(raw),diff=masterDiff(data.problems,parsed.problems);
      setProblemPreview({raw,version:parsed.version,...diff});setMasterError("");
    }catch(error){setProblemPreview(null);setMasterError((error as Error).message)}
  };
  const previewAliases=async(file:File)=>{
    try{const raw=JSON.parse(await file.text()),parsed=parseAliasesPayload(raw);
      const diff=compareRows(data.problemAliases as unknown as Record<string,unknown>[],parsed.aliases as unknown as Record<string,unknown>[],"alias");
      setAliasPreview({raw,version:parsed.version,total:parsed.aliases.length,...diff});setMasterError("");
    }catch(error){setAliasPreview(null);setMasterError((error as Error).message)}
  };
  const moveBackupToMaster=()=>{
    const raw=backupMasterWarning;setBackupMasterWarning(null);
    if(!raw)return;
    try{
      const diff=packDiff(raw),parsed=diff.parsed;
      setIntegratedPreview({raw,version:parsed.version,problemCount:parsed.problemMaster?.problems.length||0,
        answerCount:parsed.answerIndex?.answers.length||0,aliasCount:parsed.aliases?.aliases.length||0,
        added:diff.added,changed:diff.changed,unchanged:diff.unchanged});
      setTimeout(()=>document.getElementById("problem-master-import")?.scrollIntoView({behavior:"smooth"}),0);
    }catch(error){setMasterError((error as Error).message)}
  };
  const downloadMaster=async()=>saveBlob(JSON.stringify(await problemMasterExport(),null,2),"problem_master.json","application/json");
  const downloadDiagnosticPack=async()=>{
    if(diagnosticExporting)return;
    setDiagnosticExporting(true);setDiagnosticResult(null);setDiagnosticError("");
    try{
      const result=await createDiagnosticPack();
      saveBlob(result.blob,result.fileName,"application/zip");
      setDiagnosticResult(result.summary);
    }catch(error){setDiagnosticError(error instanceof Error?error.message:String(error))}
    finally{setDiagnosticExporting(false)}
  };
  const resolveDiagnosticItem=(item:Bootstrap["masterStatus"]["diagnostics"][number],action:string,label:string)=>{
    if(!item.review_id)return;
    run(()=>post("/api/master/diagnostic/resolve",{review_id:item.review_id,action}),label);
  };
  const previewLegacyK=async()=>{
    try{setLegacyKPreview(await post("/api/legacy-k/preview",{}))}
    catch(error){setMasterError(error instanceof Error?error.message:String(error))}
  };
  const previewSourceMismatch=async()=>{
    try{setSourcePreview(await post("/api/source-mismatch/preview",{}))}
    catch(error){setMasterError(error instanceof Error?error.message:String(error))}
  };
  const unresolvedLinks=data.masterStatus.diagnostics.filter(item=>item.recommended_action==="hold");
  return <><section className="panel master-import-panel master-import-primary" id="problem-master-import"><div className="panel-title"><div><span className="eyebrow">CANONICAL DATA</span><h3>問題マスター取り込み</h3></div><Badge tone="green">バックアップ復元とは別機能</Badge></div>
      <p>ChatGPTで作成した problem_master / aliases JSON を読み込み、問題ID・表示名・テーマ・GPT取り込み補正に使います。統合JSON内の answer_index は互換データとして保存できますが、日常画面では使いません。通常のバックアップ復元とは別機能です。</p>
      <div className="master-import-actions">
        <label className={`master-file-button primary ${busy?"disabled":""}`}><Database size={16}/>統合JSONを読み込む<input disabled={busy} type="file" accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];if(file)void previewIntegrated(file);event.target.value=""}}/></label>
        <label className={`master-file-button ghost ${busy?"disabled":""}`}>problem_master.jsonを読み込む<input disabled={busy} type="file" accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];if(file)void previewProblemMaster(file);event.target.value=""}}/></label>
        <label className={`master-file-button ghost ${busy?"disabled":""}`}>aliases.jsonを読み込む<input disabled={busy} type="file" accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];if(file)void previewAliases(file);event.target.value=""}}/></label>
      </div>
      {masterError&&<div className="match-warning"><AlertTriangle size={17}/><span>{masterError}</span></div>}
      {integratedPreview&&<div className="pack-preview"><div className="panel-title"><div><span className="eyebrow">IMPORT PREVIEW</span><h4>統合JSONの差分確認</h4></div><Badge>{integratedPreview.version}</Badge></div>
        <div className="pack-counts"><span>問題マスター<strong>{integratedPreview.problemCount}件</strong></span><span>互換データ<strong>{integratedPreview.answerCount}件</strong></span><span>エイリアス<strong>{integratedPreview.aliasCount}件</strong></span></div>
        <div className="pack-diff"><span>新規追加 <strong>{integratedPreview.added}件</strong></span><span>更新 <strong>{integratedPreview.changed}件</strong></span><span>変更なし <strong>{integratedPreview.unchanged}件</strong></span><span>削除 <strong>0件</strong></span></div>
        <div className="button-row"><button className="primary" disabled={busy} onClick={()=>{const preview=integratedPreview;setIntegratedPreview(null);run(()=>post("/api/master/integrated/import",preview.raw),"統合問題マスターを取り込み、整合性を診断しました")}}>取り込む</button><button className="ghost" onClick={()=>setIntegratedPreview(null)}>キャンセル</button></div>
      </div>}
      {(problemPreview||aliasPreview)&&<div className="individual-previews">
        {problemPreview&&<div className="master-diff"><strong>問題マスター：{problemPreview.version}・{problemPreview.total}件</strong><span>追加 {problemPreview.added}／更新 {problemPreview.changed}／変更なし {problemPreview.unchanged}／削除 0</span><div className="button-row"><button className="primary small" disabled={busy} onClick={()=>{const preview=problemPreview;setProblemPreview(null);run(()=>post("/api/master/problem/import",preview.raw),"問題マスターを取り込み、整合性を診断しました")}}>取り込む</button><button className="ghost small" onClick={()=>setProblemPreview(null)}>キャンセル</button></div></div>}
        {aliasPreview&&<div className="master-diff"><strong>エイリアス：{aliasPreview.version}・{aliasPreview.total}件</strong><span>追加 {aliasPreview.added}／更新 {aliasPreview.changed}／変更なし {aliasPreview.unchanged}／削除 0</span><div className="button-row"><button className="primary small" disabled={busy} onClick={()=>{const preview=aliasPreview;setAliasPreview(null);run(()=>post("/api/master/aliases/import",preview.raw),"問題エイリアスを取り込みました")}}>取り込む</button><button className="ghost small" onClick={()=>setAliasPreview(null)}>キャンセル</button></div></div>}
      </div>}
      <div className="master-status-row">
        <article><span>問題マスター</span><strong>登録済み {data.masterStatus.problem_count}件</strong><small>最終更新：{data.masterStatus.problem_updated_at?new Date(data.masterStatus.problem_updated_at).toLocaleDateString("ja-JP"):"未登録"}<br/>バージョン：{data.masterStatus.problem_version}</small></article>
        <article><span>エイリアス</span><strong>登録済み {data.masterStatus.alias_count}件</strong><small>最終更新：{data.masterStatus.alias_updated_at?new Date(data.masterStatus.alias_updated_at).toLocaleDateString("ja-JP"):"未登録"}<br/>バージョン：{data.masterStatus.alias_version}</small></article>
      </div>
    </section>
    <div className="settings-grid"><section className="panel"><div className="setting-icon"><Download/></div><h3>バックアップ・書き出し</h3><p>iPadの「ファイル」に定期的に保存してください。機種変更時にも復元できます。</p><div className="button-row"><button className="primary" onClick={downloadJson}><Download size={16}/>全データ JSON</button><button className="ghost" onClick={()=>downloadCsv("attempts")}>学習履歴 CSV</button><button className="ghost" onClick={()=>downloadCsv("problems")}>問題マスター CSV</button></div>
      <label className={`restore-button ${busy?"disabled":""}`}><Database size={16}/>JSONバックアップを復元<input disabled={busy} type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];if(file)restore(file);e.target.value=""}}/></label>
      {backupMasterWarning!==null&&<div className="backup-master-warning"><AlertTriangle size={18}/><div><strong>これはアプリ全体のバックアップではなく、問題マスター用JSONの可能性があります。「問題マスター取り込み」から読み込んでください。</strong><div className="button-row"><button className="primary small" onClick={moveBackupToMaster}>問題マスター取り込みへ移動</button><button className="ghost small" onClick={()=>setBackupMasterWarning(null)}>キャンセル</button></div></div></div>}
    </section>
    <section className="panel diagnostic-export-panel"><div className="setting-icon"><Archive/></div><h3>診断パックを書き出す</h3><p>外部レビュー用に、実データ・DB構造・復習カードと採点プロンプトの差・今日の計画をZIPへまとめます。答案画像、PDF、保存済みBlob、個人情報は含めません。</p>
      <ul className="compact-list"><li>全テーブルの件数と主キーを生成前後で照合</li><li>WB-6-A-20・review 175の生成経路を個別追跡</li><li>データ移行・復習再生成・今日の計画変更は行いません</li></ul>
      <button className="primary" disabled={busy||diagnosticExporting} onClick={()=>void downloadDiagnosticPack()}><Archive size={16}/>{diagnosticExporting?"読み取り・照合中…":"診断パックを書き出す"}</button>
      {diagnosticError&&<div className="match-warning"><AlertTriangle size={17}/><span>{diagnosticError}</span></div>}
      {diagnosticResult&&<div className="diagnostic-export-result"><Check size={17}/><div><strong>diagnostic-pack.zipを書き出しました</strong><span>問題 {diagnosticResult.problemCount}件・復習 {diagnosticResult.reviewCount}件・検出事項 {diagnosticResult.issueCount}件</span><small>{diagnosticResult.readOnlyVerified?"生成前後の件数・主キー・今日の計画は一致しています。":"生成前後の照合に失敗しました。"}</small></div></div>}
    </section>
    <section className="panel"><div className="setting-icon"><Database/></div><h3>iPad内に保存</h3><p>記録はSafari／ホーム画面アプリ内のIndexedDBに保存されます。外部APIやクラウドには送信しません。</p><dl><dt>問題</dt><dd>{data.problems.length}件</dd><dt>解答履歴</dt><dd>{data.attempts.length}件</dd><dt>復習予定</dt><dd>{data.reviews.length}件</dd></dl></section>
    <section className="panel"><div className="setting-icon"><CalendarCheck/></div><h3>試験日と毎日の学習時間</h3><p>試験日から学習段階を判定し、毎日の目標時間に合わせて課題数を調整します。初期値は150分です。</p><Field label="統計検定1級の受験日"><input type="date" value={examDate} onChange={event=>setExamDate(event.target.value)}/></Field><Field label="1日の最低学習時間（分）"><input type="number" min="30" max="600" value={dailyMinutes} onChange={event=>setDailyMinutes(event.target.value)}/></Field><button className="primary setting-save" disabled={busy} onClick={()=>run(()=>post("/api/settings",{exam_date:examDate,daily_study_minutes:Number(dailyMinutes||150)}),"試験日と学習時間を保存し、計画を調整しました")}>保存する</button></section></div>
    <section className="panel master-tools-panel"><div className="panel-title"><div><span className="eyebrow">MASTER TOOLS</span><h3>問題マスター書き出し</h3></div><Badge tone="green">PDF管理なし</Badge></div>
      <p className="muted">問題文と模範解答は、書籍またはGoodNotes・外部PDFビューアで確認します。このアプリは問題管理、計画、GPT採点結果、復習予定に集中します。</p>
      <div className="button-row"><button className="ghost small" onClick={downloadMaster}><Download size={14}/>現在のproblem_masterを書き出す</button></div>
    </section>
    <section className="panel diagnostic-panel"><div className="panel-title"><div><span className="eyebrow">CONSISTENCY</span><h3>整合性診断結果</h3></div><Badge tone={data.masterStatus.diagnostics.some(item=>item.severity==="critical")?"red":data.masterStatus.diagnostics.length?"orange":"green"}>要確認 {data.masterStatus.diagnostics.length}件</Badge></div>
      {!data.masterStatus.diagnostics.length?<p>problem_master と学習履歴は整合しています。</p>:<>
        {!!unresolvedLinks.length&&<div className="diagnostic-remains"><AlertTriangle size={18}/><div><strong>自動補正できる項目は修復済みです。</strong><span>残り{unresolvedLinks.length}件は、関連S指定の真偽を自動判断できないため要確認です。今日の復習予定には含めていません。</span></div></div>}
        <div className="diagnostic-summary">{data.masterStatus.diagnostics.slice(0,3).map(item=><div key={item.id}><strong>{item.problem_id||item.record_type}</strong><span>{item.message}</span></div>)}</div>
        {showDiagnostics&&<div className="diagnostic-list diagnostic-detail-list">{data.masterStatus.diagnostics.slice(0,50).map(item=><div className={item.severity} key={item.id}>
          <div className="diagnostic-fields"><span>対象 problem_id</span><strong>{item.target_problem_id||item.problem_id||"—"}</strong><span>canonical ID</span><strong>{item.canonical_problem_id||item.problem_id||"—"}</strong><span>source_problem_id</span><strong>{item.source_problem_id||"—"}</strong><span>対象／source Attempt</span><strong>{item.target_attempt_id||"—"}／{item.source_attempt_id||"—"}</strong><span>正本テーマ</span><strong>{item.master_theme||"—"}</strong><span>保存済み文章</span><strong>{item.saved_derived_text||"—"}</strong><span>文章の由来</span><strong>{item.derived_provenance||"—"}</strong><span>復習形式／シート</span><strong>{item.effective_mode||"—"}／{item.sheet_type||"—"}</strong><span>復習日／間隔</span><strong>{item.due_date||"—"}／{item.review_after_days??"—"}日</strong><span>現在の関連指定</span><strong>{item.current_related_ids?.join(", ")||"—"}</strong><span>problem_master上の指定</span><strong>{item.canonical_related_ids?.join(", ")||"なし"}</strong><span>推奨処理</span><strong>{item.recommended_action==="hold"?"ID要確認として保留":item.recommended_action==="remove"?"自己参照のため削除":item.repairable?"共通Resolverで再生成":"個別確認"}</strong></div>
          <p>{item.message}</p>
          {item.review_id&&item.record_type==="linked_s_check"?<div className="diagnostic-actions"><button className="primary small" disabled={busy} onClick={()=>resolveDiagnosticItem(item,item.recommended_action==="remove"?"remove":"hold","推奨処理を適用しました")}>推奨処理を適用</button><button className="ghost small" disabled={busy} onClick={()=>resolveDiagnosticItem(item,"remove","関連S指定を削除しました")}>関連指定を削除</button><button className="ghost small" disabled={busy} onClick={()=>resolveDiagnosticItem(item,"add_to_master","problem_masterに関連Sを追加しました")}>problem_masterに追加</button><button className="ghost small" disabled={busy} onClick={()=>resolveDiagnosticItem(item,"hold","ID要確認として保留しました")}>ID要確認に送る</button><button className="ghost small" disabled={busy} onClick={()=>resolveDiagnosticItem(item,"ignore","診断項目を無視しました")}>無視する</button></div>:<small>{item.repairable?"復習カード再構築の対象です":"ユーザー確認が必要です"}</small>}
        </div>)}</div>}
      </>}
      {data.masterStatus.review_rebuild_summary&&<div className="review-rebuild-summary"><strong>前回の復習カード再構築</strong><span>{new Date(data.masterStatus.review_rebuild_summary.repaired_at).toLocaleString("ja-JP")}</span><span>stale {data.masterStatus.review_rebuild_summary.stale_count}件／再生成 {data.masterStatus.review_rebuild_summary.regenerated_count}件／要確認 {data.masterStatus.review_rebuild_summary.review_needed_count}件／source混入 {data.masterStatus.review_rebuild_summary.source_target_mix_count}件／日付補正 {data.masterStatus.review_rebuild_summary.date_corrected_count}件</span></div>}
      <div className="button-row"><button className="primary" disabled={busy} onClick={()=>run(()=>post("/api/reviews/rebuild",{}),"復習カードを安全に再構築しました")}>復習カードを安全に再構築する</button><button className="secondary" disabled={busy||!data.masterStatus.diagnostics.some(item=>item.repairable)} onClick={()=>run(()=>post("/api/master/repair",{}),"自動修復可能な不整合を一括補正しました")}>問題・関連データを一括補正</button><button className="ghost" disabled={!data.masterStatus.diagnostics.length} onClick={()=>setShowDiagnostics(true)}>個別確認する</button><button className="ghost" disabled={!data.masterStatus.diagnostics.length} onClick={()=>setShowDiagnostics(false)}>後で確認する</button></div>
      <div className="legacy-k-diagnostic">
        <strong>旧K由来タスク診断</strong>
        <p>過去のKは削除・再採点せず、根拠のない旧Kだけを将来の計画と再発率から除外します。</p>
        {data.masterStatus.legacy_k_summary&&<span>前回結果：invalid {data.masterStatus.legacy_k_summary.invalid_legacy_k_count}件／要確認 {data.masterStatus.legacy_k_summary.needs_review_count}件／superseded {data.masterStatus.legacy_k_summary.superseded_task_count}件／再解決 {data.masterStatus.legacy_k_summary.resolved_task_count}件</span>}
        {legacyKPreview&&<div className="legacy-k-preview"><span>invalid_legacy_k <strong>{legacyKPreview.invalid_legacy_k_count}件</strong></span><span>needs_review <strong>{legacyKPreview.needs_review_count}件</strong></span><span>除外予定 <strong>{legacyKPreview.superseded_task_count}件</strong></span><span>再解決予定 <strong>{legacyKPreview.resolved_task_count}件</strong></span><small>Attempt、過去点数、K/W/N/C、実績時間、完了済みタスク、todayPlanSnapshotは変更しません。</small></div>}
        <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>void previewLegacyK()}>件数をプレビュー</button>{legacyKPreview&&<button className="primary" disabled={busy} onClick={()=>{setLegacyKPreview(null);run(()=>post("/api/legacy-k/reorganize",{}),"旧K由来タスクを安全に再整理しました")}}>旧K由来タスクを安全に再整理</button>}</div>
      </div>
      <div className="legacy-k-diagnostic source-origin-diagnostic">
        <strong>復習カードの出所診断</strong>
        <p>source Attemptと対象問題のcanonical IDを照合し、verified relationのない異問題カードを単純なID付け替えなしで整理します。</p>
        {data.masterStatus.source_mismatch_summary&&<span>前回結果：不一致 {data.masterStatus.source_mismatch_summary.source_mismatch_count}件／superseded {data.masterStatus.source_mismatch_summary.superseded_count}件／対象問題自身から再生成 {data.masterStatus.source_mismatch_summary.regenerated_count}件／要確認 {data.masterStatus.source_mismatch_summary.needs_review_count}件</span>}
        {sourcePreview&&<div className="legacy-k-preview"><span>現在対応が必要 <strong>{sourcePreview.active_source_mismatch}件</strong></span><span>verified relation移行対象 <strong>{sourcePreview.pending_verified_link_needs_migration}件</strong></span><span>invalid legacy K整理対象 <strong>{sourcePreview.invalid_legacy_cards_to_supersede}件</strong></span><span>過去の関連S履歴 <strong>{sourcePreview.historical_completed_linked_reviews}件</strong></span><span>superseded予定 <strong>{sourcePreview.superseded_count}件</strong></span><span>対象Attemptから独立再生成 <strong>{sourcePreview.regenerated_count}件</strong></span><span>未解決 <strong>{sourcePreview.unresolved_needs_review}件</strong></span><small>実行前に上の「全データ JSON」でバックアップしてください。Attempt、点数、実績時間、完了済みカード、todayPlanSnapshotは変更しません。</small><details><summary>原因別詳細を表示</summary>{Object.entries(sourcePreview.causes).map(([reason,count])=><div key={reason}>{reason}：{count}件</div>)}</details></div>}
        <div className="button-row"><button className="secondary" disabled={busy} onClick={()=>void previewSourceMismatch()}>出所修復をプレビュー</button>{sourcePreview&&<button className="primary" disabled={busy} onClick={()=>{setSourcePreview(null);run(()=>post("/api/source-mismatch/reorganize",{}),"出所が矛盾する復習カードを整理しました")}}>出所が矛盾する復習カードを整理</button>}</div>
      </div>
      {!!data.masterStatus.import_history.length&&<details><summary>取り込み履歴</summary><ul>{data.masterStatus.import_history.map((row,index)=><li key={index}>{row}</li>)}</ul></details>}
    </section>
    <section className="panel database-integrity-panel"><div className="panel-title"><div><span className="eyebrow">LOCAL DATABASE</span><h3>データベース整合性</h3></div><Badge tone={data.databaseStatus.valid?"green":"red"}>{data.databaseStatus.valid?"正常":"更新が必要"}</Badge></div><div className="database-status-grid"><span>DB名</span><strong>{data.databaseStatus.databaseName}</strong><span>DBバージョン</span><strong>{data.databaseStatus.databaseVersion}</strong><span>アプリ要求バージョン</span><strong>{data.databaseStatus.requiredDatabaseVersion}</strong><span>アプリschema</span><strong>{data.databaseStatus.appSchemaVersion}</strong><span>build</span><strong>{data.databaseStatus.buildVersion}</strong><span>存在する保存先</span><strong>{data.databaseStatus.existingStores.join("、")}</strong><span>不足</span><strong>{data.databaseStatus.missingStores.join("、")||"なし"}</strong><span>余分な旧保存先</span><strong>{data.databaseStatus.extraStores.join("、")||"なし"}</strong><span>最終migration</span><strong>{data.databaseStatus.lastMigration}</strong><span>結果</span><strong>{data.databaseStatus.migrationResult}</strong><span>保持件数</span><strong>Attempt {data.databaseStatus.counts.attempts}件・Evaluation {data.databaseStatus.counts.evaluations}件・ReviewPlan {data.databaseStatus.counts.reviewPlans}件</strong></div><div className="button-row"><button className="secondary" disabled={busy} onClick={()=>run(()=>post("/api/database/repair",{}),"データベースを診断し、不足storeを安全に補修しました")}>不足している保存先を作成</button><button className="ghost" disabled={busy} onClick={()=>run(()=>api("/api/bootstrap"),"データベースを診断しました")}>診断する</button><button className="ghost" onClick={downloadJson}><Download size={15}/>バックアップを書き出す</button></div></section>
    <section className="panel install-guide"><div className="setting-icon"><Plus/></div><div><h3>iPadへインストール</h3><p>Safariで公開URLを開き、共有ボタン →「ホーム画面に追加」を選びます。初回表示後はオフラインでも起動できます。</p></div><Badge tone="green">オフライン対応</Badge></section>
    <section className="panel"><div className="panel-title"><div><span className="eyebrow">INITIAL ROADMAP</span><h3>A問題ロードマップ</h3></div><Badge>{data.roadmap.length}題</Badge></div><div className="roadmap">{Object.entries(data.roadmap.reduce((acc,r)=>{(acc[r.block_name]??=[]).push(r);return acc},{} as Record<string,typeof data.roadmap>)).map(([block,rows])=><div className="roadmap-block" key={block}><h4>{block}</h4><div>{rows.map(r=><span key={r.id}><b>{r.order_index}</b>{r.problem_id}<small>{modes[r.expected_mode]}・{r.load_score}</small></span>)}</div></div>)}</div></section>
  </>
}

function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}) {return <label className={`field ${wide?"wide":""}`}><span>{label}</span>{children}</label>}
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) {return <div className="modal-backdrop" onMouseDown={close}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button onClick={close}><X/></button></div>{children}</div></div>}
