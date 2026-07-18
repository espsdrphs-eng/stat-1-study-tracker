import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen, CalendarCheck, Check, ClipboardPaste, Copy, Database, NotebookPen, Pencil, X } from "lucide-react";
import { post } from "./api";
import { applyProblemMaster, parseStudyText, problemDisplayLabel, todayString } from "./importParser";
import { createAttemptReviewPlan } from "./reviewRules";
import { buildGradingPrompt, GRADING_RUBRIC_VERSION, REVIEW_RUBRIC_VERSION } from "./gradingPrompt";
import { reviewDaysForErrors, sanitizeStudyUpdateTiming, timingWarningMessage, timingWarnings } from "./reviewTiming";
import { finalizeStudyUpdateForSave, prepareImportedStudyUpdate } from "./studyCycle";
import type { AnswerIndexEntry, Attempt, Problem, ProblemAlias, Review, StudyUpdate } from "./types";

const modes:Record<string,string>={check:"チェック",skeleton:"骨格",main_calc:"主要計算",full:"フル答案",scan:"スキャン",exam_90min:"90分演習"};
const priority=["K","N","W","C"];
const taskOrigins:Record<NonNullable<StudyUpdate["task_origin"]>,string>={
  first_attempt:"初回",review_attempt:"復習",linked_s_check:"関連S確認",related_drill:"派生補修",past_exam_followup:"過去問補修"
};

type MissingField={key:keyof StudyUpdate|string;field:string;message:string};

const reviewDate=(update:StudyUpdate,days:number)=>{
  const date=new Date(`${update.date}T12:00:00`);
  date.setDate(date.getDate()+days);
  return new Intl.DateTimeFormat("sv-SE").format(date);
};

const missingHelp:Record<string,string>={
  problem_id:"問題IDが未設定です",
  date:"学習日が未設定です",
  task_origin:"初回・復習・関連確認の区分が未設定です",
  mode:"今回の答案形式が未設定です",
  actual_minutes:"実際に使った時間が未設定です",
  mark:"mark が未設定です",
  score_numeric:"点数が未設定です",
  error_types:"K/W/N/C または none が未設定です",
  primary_error_type:"主なエラー分類が未設定です",
  review_after_days:"次回復習間隔が未設定です",
  next_action:"次に何をするかが未設定です"
};

const missingRequiredFields=(update:StudyUpdate):MissingField[]=>{
  const errors=update.error_types?.length?update.error_types:[update.primary_error_type||update.error_type].filter(Boolean) as string[];
  const actualMinutes=Number(update.actual_minutes??update.time_minutes);
  return [
    !update.problem_id?{key:"problem_id",field:"problem_id",message:missingHelp.problem_id}:null,
    !update.date?{key:"date",field:"date",message:missingHelp.date}:null,
    !update.task_origin?{key:"task_origin",field:"task_origin",message:missingHelp.task_origin}:null,
    !update.mode?{key:"mode",field:"mode",message:missingHelp.mode}:null,
    !Number.isFinite(actualMinutes)||actualMinutes<=0?{key:"actual_minutes",field:"actual_minutes",message:missingHelp.actual_minutes}:null,
    !update.mark?{key:"mark",field:"mark",message:missingHelp.mark}:null,
    update.score_numeric==null||Number.isNaN(Number(update.score_numeric))?{key:"score_numeric",field:"score_numeric",message:missingHelp.score_numeric}:null,
    !errors.length?{key:"error_types",field:"error_types",message:missingHelp.error_types}:null,
    !update.primary_error_type?{key:"primary_error_type",field:"error_types",message:missingHelp.primary_error_type}:null,
    update.review_after_days==null||Number.isNaN(Number(update.review_after_days))?{key:"review_after_days",field:"review_after_days",message:missingHelp.review_after_days}:null,
    !String(update.next_action||"").trim()?{key:"next_action",field:"next_action",message:missingHelp.next_action}:null
  ].filter(Boolean) as MissingField[];
};

const inferReviewMethod=(errors:string[],days:number)=>{
  if(errors.includes("K")||errors.includes("N")||days<=2) return "skeleton";
  if(errors.includes("W")||days===3) return "main_calc";
  return "check";
};

const reviewMethodLabel=(method:string|undefined)=>{
  if(method==="check") return "軽い想起チェック・5分";
  if(method==="skeleton") return "骨格再現";
  if(method==="main_calc") return "主要計算";
  if(method==="full") return "フル答案";
  return method||"未設定";
};

function Field({label,children,wide=false,fieldId,highlighted=false,help}:{label:string;children:React.ReactNode;wide?:boolean;fieldId?:string;highlighted?:boolean;help?:string}){
  return <label id={fieldId} className={`field ${wide?"wide":""} ${highlighted?"field-highlight":""}`}>
    <span>{label}</span>{children}{help&&<small className="field-help">{help}</small>}
  </label>;
}

function Pill({children,tone=""}:{children:React.ReactNode;tone?:string}){
  return <span className={`badge ${tone}`}>{children}</span>;
}

export default function AdvancedImportView({problems,answerIndex,problemAliases,attempts,reviews,run,busy}:{
  problems:Problem[];answerIndex:AnswerIndexEntry[];problemAliases:ProblemAlias[];attempts:Attempt[];reviews:Review[];run:(action:()=>Promise<unknown>,success:string)=>Promise<boolean>;busy:boolean;
}){
  const draftKey="stat1:gpt-import-draft:v1";
  const readDraft=()=>{try{return JSON.parse(sessionStorage.getItem(draftKey)||"null") as {text?:string;updates?:StudyUpdate[]}|null}catch{return null}};
  const initialDraft=readDraft();
  const [text,setText]=useState(initialDraft?.text||"");
  const [updates,setUpdates]=useState<StudyUpdate[]>(initialDraft?.updates||[]);
  const [structured,setStructured]=useState(false);
  const [editing,setEditing]=useState(false);
  const [error,setError]=useState("");
  const [gradingCopied,setGradingCopied]=useState(false);
  const [saved,setSaved]=useState<{count:number;ids:string[];at:string}|null>(null);
  const [highlightedField,setHighlightedField]=useState("");
  const [saveFailed,setSaveFailed]=useState(false);
  const gradingPrompt=buildGradingPrompt(todayString());

  useEffect(()=>{
    if(text||updates.length) sessionStorage.setItem(draftKey,JSON.stringify({text,updates,savedAt:new Date().toISOString()}));
    else sessionStorage.removeItem(draftKey);
  },[text,updates]);

  const parse=()=>{
    setError("");
    setSaved(null);
    try{
      const result=parseStudyText(text,problems,answerIndex,problemAliases);
      const historyIds=new Set(attempts.map(attempt=>attempt.problem_id));
      const normalized=result.updates.map(update=>prepareImportedStudyUpdate({
        ...update,
        task_origin:update.task_origin||(update.generated_from_review_id?"review_attempt":historyIds.has(update.problem_id)?"review_attempt":"first_attempt")
      } as StudyUpdate,{attempts,today:todayString()}));
      setStructured(result.structured);
      setUpdates(normalized);
      setEditing(false);
      if(!normalized.length) setError("問題を特定できませんでした。問題ID、章、A/S、問番号を確認してください。");
    }catch(reason){
      setError(`解析できませんでした: ${(reason as Error).message}`);
    }
  };

  const change=<K extends keyof StudyUpdate>(index:number,key:K,value:StudyUpdate[K])=>
    setUpdates(rows=>rows.map((row,i)=>i===index?{...row,[key]:value}:row));

  const selectProblem=(index:number,problemId:string)=>{
    const problem=problems.find(p=>p.problem_id===problemId);
    if(problem) setUpdates(rows=>rows.map((row,i)=>i===index?finalizeStudyUpdateForSave(applyProblemMaster(row,problem)):row));
  };

  const changeErrors=(index:number,value:string)=>{
    const upper=value.toUpperCase();
    const none=/\bNONE\b/.test(upper)||upper.trim()==="なし";
    const errors=none?["none"]:[...new Set(upper.match(/\b[KWNC]\b/g)||[])].sort((a,b)=>priority.indexOf(a)-priority.indexOf(b));
    const primary=errors.find(error=>error!=="none")||"none";
    const secondary=errors.find(error=>error!==primary&&error!=="none")||"";
    const realErrors=errors.filter(error=>error!=="none");
    const days=reviewDaysForErrors(realErrors);
    setUpdates(rows=>rows.map((row,i)=>i===index?finalizeStudyUpdateForSave({
      ...row,error_types:errors,primary_error_type:primary,secondary_error_type:secondary,error_type:primary,
      review_after_days:days,review_method:inferReviewMethod(realErrors,days),
      error_point:primary==="none"&&!row.error_point?.trim()?"大きな問題なし":row.error_point,
      review_reason:primary==="none"?"ミス分類なしのため14日後":`${primary}が含まれるため${days}日後`
    }):row));
  };

  const remove=(index:number)=>setUpdates(rows=>rows.filter((_,i)=>i!==index));

  const firstMissing=updates.map((row,index)=>({index,missing:missingRequiredFields(row)[0]})).find(item=>item.missing);
  const allMissing=updates.flatMap((row,index)=>missingRequiredFields(row).map(item=>({...item,index})));
  const canSave=updates.length>0&&allMissing.length===0&&!updates.some(row=>row.requires_problem_confirmation);

  const scrollToMissing=(index:number,field:string)=>{
    setEditing(true);
    const id=`import-${index}-${field}`;
    setHighlightedField(id);
    setTimeout(()=>{
      const target=document.getElementById(id);
      target?.scrollIntoView({behavior:"smooth",block:"center"});
      const input=target?.querySelector("input, select, textarea") as HTMLElement|null;
      input?.focus();
    },50);
  };

  const saveUpdates=async()=>{
    const snapshot=updates.map(update=>sanitizeStudyUpdateTiming(finalizeStudyUpdateForSave(update)));
    sessionStorage.setItem(draftKey,JSON.stringify({text,updates:snapshot,savedAt:new Date().toISOString()}));
    const ok=await run(()=>post("/api/import",{updates:snapshot}),`${snapshot.length}件を保存しました`);
    if(!ok){setSaveFailed(true);return}
    setSaveFailed(false);
    sessionStorage.removeItem(draftKey);
    setText("");
    setUpdates([]);
    setStructured(false);
    setEditing(false);
    setError("");
    setSaved({count:snapshot.length,ids:[...new Set(snapshot.map(row=>row.problem_id))],at:new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit"}).format(new Date())});
  };

  return <div className="import-layout advanced-import">
    <section className="panel">
      <div className="panel-title"><div><span className="eyebrow">PASTE FROM GPT</span><h3>GPT回答取り込み</h3></div><Pill>API不使用</Pill></div>
      <p className="muted">YAMLがあれば優先して解析します。旧キーは保存前に新キーへ自動補正します。</p>
      <textarea className="paste-area" value={text} onChange={event=>{setText(event.target.value);setSaved(null)}} placeholder={"ChatGPTの採点結果を貼り付けてください。\n\nstudy_update / study_updates のYAMLに対応します。"} />
      <button className="primary wide-btn" onClick={parse}><ClipboardPaste size={17}/>内容を解析する</button>
      {error&&<p className="field-error">{error}</p>}
      <div className="parser-note"><strong>旧キーの自動変換</strong><span>time_minutes → actual_minutes / score_label → score_text / reference_closed_reproduction → after_reference_reproduced</span></div>
      <details className="grading-prompt-box"><summary>安定した採点用プロンプト</summary>
        <p>採点基準・根拠・確信度を固定する {GRADING_RUBRIC_VERSION} です。</p>
        <textarea readOnly value={gradingPrompt}/>
        <button className="ghost small" onClick={async()=>{await navigator.clipboard.writeText(gradingPrompt);setGradingCopied(true);setTimeout(()=>setGradingCopied(false),1800)}}>
          {gradingCopied?<Check size={14}/>:<Copy size={14}/>} {gradingCopied?"コピーしました":"採点用プロンプトをコピー"}
        </button>
      </details>
    </section>

    <section className="panel preview">
      <div className="panel-title"><div><span className="eyebrow">CONFIRM BEFORE SAVE</span><h3>取り込み確認</h3></div>
        {updates.length>0&&<Pill tone={structured?"green":"orange"}>{structured?"YAML":"文章抽出"}・{updates.length}件</Pill>}
      </div>
      {!updates.length?(saved?<div className="import-saved">
        <div className="import-saved-icon"><Check size={30}/></div>
        <span>保存完了</span>
        <h3>{saved.count}件の採点結果を登録しました</h3>
        <p>{saved.ids.join(" / ")}</p>
        <small>{saved.at}・入力欄と確認内容をクリアしました。</small>
        <button className="ghost" onClick={()=>setSaved(null)}><ClipboardPaste size={15}/>次の取り込みを始める</button>
      </div>:<div className="empty"><ClipboardPaste size={30}/><p>解析結果がここに表示されます</p></div>):<>
        <div className="confirm-toolbar"><p>保存するまで端末内データは更新されません。</p>
          <button className="ghost small" onClick={()=>firstMissing?.missing?scrollToMissing(firstMissing.index,firstMissing.missing.field):setEditing(value=>!value)}>
            <Pencil size={14}/>{editing?"確認表示に戻る":"修正"}
          </button>
        </div>
        <div className="import-cards">{updates.map((update,index)=>{
          const related=update.related_s_problem_ids||[];
          const errors=(update.error_types?.length?update.error_types:[update.primary_error_type||update.error_type||"none"]).filter(Boolean);
          const realErrors=errors.filter(error=>error!=="none");
          const reviewPlan=createAttemptReviewPlan(update,[]);
          const dateWarnings=[...new Set([...(update.date_expression_warnings||[]),...timingWarnings(update)])];
          const missing=missingRequiredFields(update);
          const isReviewImport=!!update.generated_from_review_id||update.rubric_version===REVIEW_RUBRIC_VERSION;
          const expectedRubric=isReviewImport?REVIEW_RUBRIC_VERSION:GRADING_RUBRIC_VERSION;
          return <article className={`import-card detailed ${!update.master_matched?"unmatched":""}`} key={index}>
            <div className="import-card-head"><div><strong>{update.display_label||update.problem_id||"問題未特定"}</strong><small>{update.problem_id}・{taskOrigins[update.task_origin||"first_attempt"]}・{update.rubric_version||"採点基準未記録"}・採点確信度 {update.grading_confidence==null?"未記録":`${Math.round(update.grading_confidence*100)}%`}</small></div>
              <button onClick={()=>remove(index)} aria-label="候補を削除"><X size={16}/></button></div>
            {!update.master_matched&&<div className="match-warning"><AlertTriangle size={17}/><div><strong>問題マスターに未照合です</strong><span>保存前に登録済み問題を選択してください。</span></div></div>}
            {update.auto_corrected&&<div className="master-correction"><Check size={17}/><div><strong>自動補正しました</strong><span>{update.correction_fields?.join(" / ")}</span><small>{update.correction_reason}</small></div></div>}
            {update.requires_problem_confirmation&&update.suggested_problem_id&&<div className="candidate-confirm"><AlertTriangle size={17}/><div><strong>問題IDの確認が必要です</strong><span>取り込み内容は {update.problem_id} ではなく {update.suggested_problem_id}（{update.suggested_problem_label}）の可能性があります。</span><div>
              <button type="button" className="primary small" onClick={()=>selectProblem(index,update.suggested_problem_id!)}>{update.suggested_problem_id}として保存</button>
              <button type="button" className="ghost small" onClick={()=>setUpdates(rows=>rows.map((row,i)=>i===index?{...row,requires_problem_confirmation:false,problem_id_confirmed:true}:row))}>{update.problem_id}として保存</button>
              <button type="button" className="ghost small" onClick={()=>remove(index)}>キャンセル</button>
            </div></div></div>}
            {missing.length>0&&<div className="match-warning missing-detail"><AlertTriangle size={17}/><div><strong>保存できません。以下の項目が不足しています。</strong>
              <ul>{missing.map(item=><li key={`${index}-${item.key}`}><code>{item.key}</code>：{item.message} <button type="button" className="ghost tiny" onClick={()=>scrollToMissing(index,item.field)}>修正</button></li>)}</ul>
            </div></div>}
            {update.rubric_version&&update.rubric_version!==expectedRubric&&<div className="match-warning"><AlertTriangle size={17}/><div><strong>採点基準を確認してください</strong><span>{expectedRubric} の {isReviewImport?"復習":"初回"} 採点プロンプトによる結果を推奨します。</span></div></div>}
            {update.grading_confidence!=null&&update.grading_confidence<.7&&<div className="match-warning"><AlertTriangle size={17}/><div><strong>採点確信度が低い結果です</strong><span>{update.uncertain_points?.join(" / ")||"根拠を確認してから保存してください。"}</span></div></div>}

            <div className="import-fields expanded">
              <Field label="問題マスター" fieldId={`import-${index}-problem_id`} highlighted={highlightedField===`import-${index}-problem_id`}><select disabled={!editing&&!!update.master_matched} value={update.master_matched?update.problem_id:""} onChange={event=>selectProblem(index,event.target.value)}>
                <option value="">問題を選択</option>{problems.map(problem=><option value={problem.problem_id} key={problem.problem_id}>{problemDisplayLabel(problem)}・{problem.problem_id}</option>)}
              </select></Field>
              <Field label="今回の答案形式" fieldId={`import-${index}-mode`} highlighted={highlightedField===`import-${index}-mode`}><select disabled={!editing} value={update.mode} onChange={event=>change(index,"mode",event.target.value)}>{Object.entries(modes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></Field>
              <Field label="学習日" fieldId={`import-${index}-date`} highlighted={highlightedField===`import-${index}-date`}><input readOnly={!editing} type="date" value={update.date} onChange={event=>change(index,"date",event.target.value)}/></Field>
              <Field label="実際に使った時間（分）" fieldId={`import-${index}-actual_minutes`} highlighted={highlightedField===`import-${index}-actual_minutes`} help="今日の完了時間に加算されます。予定時間とは別です。"><input readOnly={!editing} placeholder="実際に使った分数" type="number" value={update.actual_minutes??update.time_minutes??""} onChange={event=>{const value=event.target.value===""?undefined:Number(event.target.value);change(index,"actual_minutes",value);change(index,"time_minutes",value)}}/></Field>
              <Field label="段階評価"><input readOnly={!editing} placeholder="例：A / B+" value={update.score_text||(update.score_numeric!=null?update.score_label:"")} onChange={event=>change(index,"score_text",event.target.value)}/></Field>
              <Field label="点数" fieldId={`import-${index}-score_numeric`} highlighted={highlightedField===`import-${index}-score_numeric`}><input readOnly={!editing} placeholder="例：78" type="number" value={update.score_numeric??""} onChange={event=>change(index,"score_numeric",event.target.value===""?null:Number(event.target.value))}/></Field>
              <Field label="mark" fieldId={`import-${index}-mark`} highlighted={highlightedField===`import-${index}-mark`}><select disabled={!editing} value={update.mark} onChange={event=>change(index,"mark",event.target.value)}>{["◎","○","△","×"].map(mark=><option key={mark}>{mark}</option>)}</select></Field>
              <Field label="K/W/N/C" fieldId={`import-${index}-error_types`} highlighted={highlightedField===`import-${index}-error_types`}><input readOnly={!editing} value={errors.join(" + ")||"none"} onChange={event=>changeErrors(index,event.target.value)} /></Field>
              <Field label="次回復習"><input readOnly value={`${reviewPlan.interval_days}日後（${reviewDate(update,reviewPlan.interval_days||14)}）`}/></Field>
              <Field label="次回復習方法"><input readOnly value={reviewMethodLabel(update.review_method||reviewPlan.mode)}/></Field>
              <Field label="区分" fieldId={`import-${index}-task_origin`} highlighted={highlightedField===`import-${index}-task_origin`}><select disabled={!editing} value={update.task_origin||""} onChange={event=>change(index,"task_origin",event.target.value as StudyUpdate["task_origin"])}>
                <option value="">未設定</option>{Object.entries(taskOrigins).map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select></Field>
            </div>

            <div className="extracted-block"><span>主テーマ</span><div>{(update.themes||[]).map(theme=><Pill key={theme}>{theme}</Pill>)}{!update.themes?.length&&"—"}</div></div>
            {update.raw_gpt_theme&&update.raw_gpt_theme!==update.theme&&<div className="raw-master-theme"><span>GPT由来テーマ</span><del>{update.raw_gpt_theme}</del><strong>正本：{update.theme}</strong></div>}
            <Field label="ミス内容" wide fieldId={`import-${index}-error_point`} highlighted={highlightedField===`import-${index}-error_point`}><textarea readOnly={!editing} value={update.error_point} onChange={event=>change(index,"error_point",event.target.value)}/></Field>
            <Field label="次回課題" wide fieldId={`import-${index}-next_action`} highlighted={highlightedField===`import-${index}-next_action`}><textarea readOnly={!editing} value={update.next_action} onChange={event=>change(index,"next_action",event.target.value)}/></Field>
            {!!dateWarnings.length&&<div className="timing-warning"><AlertTriangle size={17}/><div><strong>{timingWarningMessage}</strong><span>検出・自動除去：{dateWarnings.join(" / ")}</span></div></div>}

            {(update.evaluation_scope||update.graded_parts?.length||update.assumed_correct_parts?.length)&&<div className="grading-scope-summary">
              <span>採点範囲 <strong>{update.evaluation_scope==="full"?"フル答案":"条件付きフル評価"}</strong></span>
              <span>実際に確認 <strong>{update.graded_parts?.join(" / ")||"記載なし"}</strong></span>
              {update.assumed_correct_parts?.length?<span>正しいと仮定 <strong>{update.assumed_correct_parts.join(" / ")}</strong></span>:null}
              {isReviewImport&&<span>参照状況 <strong>許可 {update.allowed_reference_level??0}・実際 {update.actual_reference_level??update.reference_level??0}・参照後再現 {update.reference_closed_reproduction||update.after_hint_reproduced||update.after_reference_reproduced?"済":"未確認"}</strong></span>}
            </div>}

            <details className="detailed-feedback">
              <summary>修正版答案・途中計算・判定根拠を確認</summary>
              <div className="detailed-feedback-body">
                <Field label="今回の答案に沿った修正版答案" wide><textarea readOnly={!editing} value={update.corrected_answer||""} onChange={event=>change(index,"corrected_answer",event.target.value)} placeholder="今回の答案の正しい部分を残した修正版"/></Field>
                <Field label="採点対象に必要な途中計算" wide><textarea readOnly={!editing} value={update.required_derivation||""} onChange={event=>change(index,"required_derivation",event.target.value)} placeholder={update.mode==="skeleton"||update.mode==="check"?"このモードで計算が対象外なら空欄でよい":"結論を自力で導くために必要な式変形"}/></Field>
                <Field label="次回の直し方" wide><textarea readOnly={!editing} value={update.improvement_guidance||""} onChange={event=>change(index,"improvement_guidance",event.target.value)} placeholder="残す部分・置き換える部分・何も見ずに書く部分"/></Field>
              </div>
            </details>

            <div className="candidate-grid">
              <div className="candidate-box weak"><div><NotebookPen size={16}/><strong>弱点候補データ</strong></div>
                {update.weak_notes?.length?<ul className="weak-candidate-list">{update.weak_notes.map((note,n)=><li key={n}>{note.correction_rule||note.mistake}</li>)}</ul>
                  :update.weak_note?<><p>{update.weak_note.mistake}</p><small>{update.weak_note.correction_rule}</small></>:<p>{realErrors.length?"追加候補なし":"none 判定のため弱点ノートなし"}</p>}</div>
              <div className="candidate-box s-check"><div><BookOpen size={16}/><strong>関連S確認候補</strong></div>
                <p>{related.length?related.map(id=>{const problem=problems.find(p=>p.problem_id===id);return problem?problemDisplayLabel(problem):id}).join(" / "):"候補なし"}</p>
                <small>{realErrors.includes("K")?"10分骨格確認":realErrors.includes("N")?"5分確認候補":realErrors.length?"自動追加なし":"—"}</small></div>
            </div>
            <div className="import-effects">
              <span><CalendarCheck/>復習理由 <strong>{reviewPlan.review_reason}</strong></span>
              <span><CalendarCheck/>復習方法 <strong>{reviewMethodLabel(update.review_method||reviewPlan.mode)}・{reviewPlan.estimated_minutes}分</strong></span>
              <span><BookOpen/>関連S <strong>{reviewPlan.requires_s_check?related.join(", "):"確認不要"}</strong></span>
              <span><NotebookPen/>弱点分析 <strong>{update.weak_notes?.length||update.weak_note? "自動蓄積":"追加なし"}</strong></span>
              {update.math_localized&&<span><Pencil size={14}/>数式表記 <strong>日本語化済み</strong></span>}
            </div>
          </article>;
        })}</div>
        <button disabled={busy||!canSave} className="primary wide-btn" onClick={saveUpdates}>
          <Database size={17}/>{updates.length}件を保存する
        </button>
        {saveFailed&&<div className="database-save-failure"><AlertTriangle size={18}/><div><strong>学習内容はまだ保存されていません</strong><span>解析済みの入力内容はこの画面と一時保存領域に保持しています。データベース更新後、もう一度保存してください。</span><div className="button-row"><button type="button" className="primary small" disabled={busy} onClick={async()=>{const ok=await run(()=>post("/api/database/repair",{}),"データベースを安全に更新しました");if(ok)setSaveFailed(false)}}>データベースを更新する</button><button type="button" className="ghost small" onClick={()=>navigator.clipboard.writeText(JSON.stringify({study_updates:updates},null,2))}><Copy size={14}/>入力内容をコピー</button></div></div></div>}
        {!canSave&&<div className="save-blocked"><strong>保存できません。</strong>
          {allMissing.length?<><span>不足項目：</span><ul>{allMissing.slice(0,8).map(item=><li key={`${item.index}-${item.key}`}><code>{item.key}</code>：{item.message}</li>)}</ul></>:<span>問題ID候補の確認が必要です。</span>}
        </div>}
      </>}
    </section>
  </div>;
}
