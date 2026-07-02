import { useState } from "react";
import { AlertTriangle, BookOpen, CalendarCheck, Check, ClipboardPaste, Copy, Database, NotebookPen, Pencil, X } from "lucide-react";
import { post } from "./api";
import { applyProblemMaster, parseStudyText, problemDisplayLabel, todayString } from "./importParser";
import { createAttemptReviewPlan } from "./reviewRules";
import { buildGradingPrompt, GRADING_RUBRIC_VERSION, REVIEW_RUBRIC_VERSION } from "./gradingPrompt";
import type { Problem, StudyUpdate } from "./types";

const modes:Record<string,string>={skeleton:"骨格",main_calc:"主要計算",full:"フル答案",scan:"スキャン",exam_90min:"90分演習"};
const intervals:Record<string,number>={K:1,N:2,W:3,C:7,none:14};
const priority=["K","N","W","C"];
const reviewDate=(update:StudyUpdate,days:number)=>{
  const date=new Date(`${update.date}T12:00:00`);
  date.setDate(date.getDate()+days);
  return new Intl.DateTimeFormat("sv-SE").format(date);
};
const missingRequiredFields=(update:StudyUpdate)=>{
  const errors=update.error_types||[];
  const hasError=errors.length>0||(update.primary_error_type||update.error_type)!=="none";
  return [
    !update.master_matched||!update.problem_id?"問題マスター":"",
    !Number(update.time_minutes)?"今回の所要時間":"",
    !update.score_text&&update.score_numeric==null?"段階評価または点数":"",
    !update.themes?.length?"主テーマ":"",
    hasError&&!update.error_point.trim()?"ミス内容":"",
    hasError&&!update.next_action.trim()?"次回課題":""
  ].filter(Boolean);
};

function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}){
  return <label className={`field ${wide?"wide":""}`}><span>{label}</span>{children}</label>;
}
function Pill({children,tone=""}:{children:React.ReactNode;tone?:string}){
  return <span className={`badge ${tone}`}>{children}</span>;
}

export default function AdvancedImportView({problems,run,busy}:{
  problems:Problem[];run:(action:()=>Promise<unknown>,success:string)=>void;busy:boolean;
}){
  const [text,setText]=useState("");
  const [updates,setUpdates]=useState<StudyUpdate[]>([]);
  const [structured,setStructured]=useState(false);
  const [editing,setEditing]=useState(false);
  const [error,setError]=useState("");
  const [gradingCopied,setGradingCopied]=useState(false);
  const gradingPrompt=buildGradingPrompt(todayString());

  const parse=()=>{
    setError("");
    try{
      const result=parseStudyText(text,problems);
      setStructured(result.structured);
      setUpdates(result.updates);
      setEditing(false);
      if(!result.updates.length) setError("問題を特定できませんでした。問題ID、章、A/S、問番号を確認してください。");
    }catch(reason){setError(`解析できませんでした: ${(reason as Error).message}`)}
  };
  const change=<K extends keyof StudyUpdate>(index:number,key:K,value:StudyUpdate[K])=>
    setUpdates(rows=>rows.map((row,i)=>i===index?{...row,[key]:value}:row));
  const selectProblem=(index:number,problemId:string)=>{
    const problem=problems.find(p=>p.problem_id===problemId);
    if(problem) setUpdates(rows=>rows.map((row,i)=>i===index?applyProblemMaster(row,problem):row));
  };
  const changeErrors=(index:number,value:string)=>{
    const errors=[...new Set((value.toUpperCase().match(/\b[KWNC]\b/g)||[]))].sort((a,b)=>priority.indexOf(a)-priority.indexOf(b));
    const primary=errors[0]||"none",secondary=errors[1]||"";
    const days=intervals[primary]||14;
    setUpdates(rows=>rows.map((row,i)=>i===index?{...row,error_types:errors,primary_error_type:primary,
      secondary_error_type:secondary,error_type:primary,review_after_days:days,
      review_reason:primary==="none"?"ミス分類なしのため14日後":`${primary}が含まれるため${days}日後`}:row));
  };
  const remove=(index:number)=>setUpdates(rows=>rows.filter((_,i)=>i!==index));
  const canSave=updates.length>0&&updates.every(row=>missingRequiredFields(row).length===0);

  return <div className="import-layout advanced-import">
    <section className="panel">
      <div className="panel-title"><div><span className="eyebrow">PASTE FROM GPT</span><h3>GPT回答を貼り付け</h3></div><Pill>API不使用</Pill></div>
      <p className="muted">YAMLがあれば最優先し、なければ通常文章の見出しと本文から抽出します。</p>
      <textarea className="paste-area" value={text} onChange={event=>setText(event.target.value)}
        placeholder={"ChatGPTの解答・添削結果を全文貼り付けてください。\n\n問題表記、評価、点数、K/W/N/C、関連S、弱点ノートを抽出します。"}/>
      <button className="primary wide-btn" onClick={parse}><ClipboardPaste size={17}/>内容を解析する</button>
      {error&&<p className="field-error">{error}</p>}
      <div className="parser-note"><strong>認識する表記例</strong><span>第2章A問20 / 第2章 A問題 問20 / WB-2-A-20</span></div>
      <details className="grading-prompt-box"><summary>安定した採点用プロンプト</summary><p>採点基準・根拠・確信度を固定する {GRADING_RUBRIC_VERSION} です。</p>
        <textarea readOnly value={gradingPrompt}/><button className="ghost small" onClick={async()=>{await navigator.clipboard.writeText(gradingPrompt);setGradingCopied(true);setTimeout(()=>setGradingCopied(false),1800)}}>{gradingCopied?<Check size={14}/>:<Copy size={14}/>} {gradingCopied?"コピーしました":"採点用プロンプトをコピー"}</button></details>
    </section>

    <section className="panel preview">
      <div className="panel-title"><div><span className="eyebrow">CONFIRM BEFORE SAVE</span><h3>取り込み確認</h3></div>
        {updates.length>0&&<Pill tone={structured?"green":"orange"}>{structured?"YAML":"文章抽出"}・{updates.length}件</Pill>}
      </div>
      {!updates.length?<div className="empty"><ClipboardPaste size={30}/><p>解析結果がここに表示されます</p></div>:<>
        <div className="confirm-toolbar"><p>保存するまで端末内データは更新されません。</p>
          <button className="ghost small" onClick={()=>setEditing(value=>!value)}><Pencil size={14}/>{editing?"確認表示に戻る":"修正"}</button>
        </div>
        <div className="import-cards">{updates.map((update,index)=>{
          const related=update.related_s_problem_ids||[];
          const errors=update.error_types||[];
          const reviewPlan=createAttemptReviewPlan(update,related);
          const missing=missingRequiredFields(update);
          const isReviewImport=!!update.generated_from_review_id||update.rubric_version===REVIEW_RUBRIC_VERSION;
          const expectedRubric=isReviewImport?REVIEW_RUBRIC_VERSION:GRADING_RUBRIC_VERSION;
          return <article className={`import-card detailed ${!update.master_matched?"unmatched":""}`} key={index}>
            <div className="import-card-head"><div><strong>{update.display_label||update.problem_id||"問題未特定"}</strong><small>{update.problem_id} ・ {isReviewImport?`復習採点${update.generated_from_review_id?` #${update.generated_from_review_id}`:""}`:"初回採点"} ・ {update.rubric_version||"採点基準未記録"} ・ 採点確信度 {update.grading_confidence==null?"未記載":`${Math.round(update.grading_confidence*100)}%`}</small></div>
              <button onClick={()=>remove(index)} aria-label="候補を削除"><X size={16}/></button></div>
            {!update.master_matched&&<div className="match-warning"><AlertTriangle size={17}/><div><strong>問題マスターに未照合です</strong><span>保存前に登録済み問題を選択してください。</span></div></div>}
            {missing.length>0&&<div className="match-warning"><AlertTriangle size={17}/><div><strong>復習計画に必要な項目が不足しています</strong><span>{missing.join(" / ")}を確認・修正してください。</span></div></div>}
            {update.rubric_version!==expectedRubric&&<div className="match-warning"><AlertTriangle size={17}/><div><strong>採点基準を確認してください</strong><span>{expectedRubric}の{isReviewImport?"復習":"初回"}採点プロンプトによる結果を推奨します。</span></div></div>}
            {update.grading_confidence!=null&&update.grading_confidence<.7&&<div className="match-warning"><AlertTriangle size={17}/><div><strong>採点確信度が低い結果です</strong><span>{update.uncertain_points?.join(" / ")||"根拠を確認してから保存してください。"}</span></div></div>}
            <div className="import-fields expanded">
              <Field label="問題マスター"><select disabled={!editing&&!!update.master_matched} value={update.master_matched?update.problem_id:""} onChange={event=>selectProblem(index,event.target.value)}>
                <option value="">問題を選択</option>{problems.map(problem=><option value={problem.problem_id} key={problem.problem_id}>{problemDisplayLabel(problem)}｜{problem.problem_id}</option>)}
              </select></Field>
              <Field label="モード"><select disabled={!editing} value={update.mode} onChange={event=>change(index,"mode",event.target.value)}>{Object.entries(modes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></Field>
              <Field label="学習日"><input readOnly={!editing} type="date" value={update.date} onChange={event=>change(index,"date",event.target.value)}/></Field>
              <Field label="今回の所要時間（分）"><input readOnly={!editing} placeholder="要確認" type="number" value={update.time_minutes??""} onChange={event=>change(index,"time_minutes",event.target.value===""?undefined:Number(event.target.value))}/></Field>
              <Field label="段階評価"><input readOnly={!editing} placeholder="要確認" value={update.score_text||(update.score_numeric!=null?update.score_label:"")} onChange={event=>change(index,"score_text",event.target.value)}/></Field>
              <Field label="点数"><input readOnly={!editing} placeholder="要確認" type="number" value={update.score_numeric??""} onChange={event=>change(index,"score_numeric",event.target.value===""?null:Number(event.target.value))}/></Field>
              <Field label="mark"><select disabled={!editing} value={update.mark} onChange={event=>change(index,"mark",event.target.value)}>{["◎","○","△","×"].map(mark=><option key={mark}>{mark}</option>)}</select></Field>
              <Field label="K/W/N/C"><input readOnly={!editing} value={errors.join(" + ")||"none"} onChange={event=>changeErrors(index,event.target.value)} /></Field>
              <Field label="次回復習"><input readOnly value={`${reviewPlan.interval_days}日後（${reviewDate(update,reviewPlan.interval_days||14)}）`}/></Field>
            </div>

            <div className="extracted-block"><span>主テーマ</span><div>{(update.themes||[]).map(theme=><Pill key={theme}>{theme}</Pill>)}{!update.themes?.length&&"—"}</div></div>
            <Field label="ミス内容" wide><textarea readOnly={!editing} value={update.error_point} onChange={event=>change(index,"error_point",event.target.value)}/></Field>
            <Field label="次回課題" wide><textarea readOnly={!editing} value={update.next_action} onChange={event=>change(index,"next_action",event.target.value)}/></Field>

            <div className="candidate-grid">
              <div className="candidate-box weak"><div><NotebookPen size={16}/><strong>弱点傾向データ</strong></div>
                {update.weak_notes?.length?<ul className="weak-candidate-list">{update.weak_notes.map((note,n)=><li key={n}>{note.correction_rule||note.mistake}</li>)}</ul>
                  :update.weak_note?<><p>{update.weak_note.mistake}</p><small>{update.weak_note.correction_rule}</small></>:<p>追加候補なし</p>}</div>
              <div className="candidate-box s-check"><div><BookOpen size={16}/><strong>関連S確認候補</strong></div>
                <p>{related.length?related.map(id=>{const problem=problems.find(p=>p.problem_id===id);return problem?problemDisplayLabel(problem):id}).join(" / "):"候補なし"}</p>
                <small>{errors.includes("K")?"10分骨格確認":errors.includes("N")?"5分確認候補":errors.length?"自動追加なし":"—"}</small></div>
            </div>
            <div className="import-effects">
              <span><CalendarCheck/>復習理由 <strong>{reviewPlan.review_reason}</strong></span>
              <span><CalendarCheck/>復習方法 <strong>{reviewPlan.review_method}・{reviewPlan.estimated_minutes}分</strong></span>
              <span><BookOpen/>関連S <strong>{reviewPlan.requires_s_check?related.join(", "):"確認不要"}</strong></span>
              <span><NotebookPen/>傾向分析 <strong>{update.weak_notes?.length||update.weak_note? "自動蓄積":"追加なし"}</strong></span>
              {update.math_localized&&<span><Pencil size={14}/>数式表記 <strong>日本語化済み</strong></span>}
            </div>
          </article>;
        })}</div>
        <button disabled={busy||!canSave} className="primary wide-btn" onClick={()=>run(()=>post("/api/import",{updates}),`${updates.length}件を保存しました`)}>
          <Database size={17}/>{updates.length}件を保存する
        </button>
        {!canSave&&<p className="save-blocked">復習計画に必要な項目が不足しています。「修正」から不足項目を入力してください。</p>}
      </>}
    </section>
  </div>;
}
