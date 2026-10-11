import {useEffect,useState} from "react";
import {post} from "./api";
type View={status:string;problem?:{problem_id:string;display_label:string;difficulty:string;estimated_minutes:number;problem_text:string};existingProblemId?:string;prompt?:string;pendingReason?:string;
  afterSubmission?:{rootSkillId:string;sourceProblemId:string;result:string;evidence:string;solution:string;rubric:string;
    feedback?:{score:number|null;scoreMax:number;errorPoint:string;nextAction:string;successCriterion:string}}};
export function TransferTrainingPanel({trainingKey,onSaved}:{trainingKey:string;onSaved?:()=>void;onExisting?:(id:string)=>void}){
  const [view,setView]=useState<View>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[payload,setPayload]=useState(""),
    [minutes,setMinutes]=useState(""),[referenceLevel,setReference]=useState(0),[message,setMessage]=useState(""),[copyFallback,setCopyFallback]=useState("");
  const request=(action:string,extra:Record<string,unknown>={})=>post<View>("/api/transfer-training",{key:trainingKey,action,...extra});
  useEffect(()=>{let active=true;request("view").then(v=>{if(active)setView(v)}).catch(e=>{if(active)setError(String(e.message))});return()=>{active=false};},[trainingKey]);
  const act=async(action:string,copy=false)=>{
    setBusy(true);setError("");setMessage("");setCopyFallback("");
    try{const response=await request(action,{text:payload,answer_medium:"paper_image",answer_completed:action==="submit",minutes,referenceLevel});
      if(copy&&response.prompt){
        try{await navigator.clipboard.writeText(response.prompt);setMessage(action==="grading-prompt"?"コピーしました。確定答案と問題資料をGPTへ渡し、採点JSONを取り込んでください。":"コピーしました。生成と検証は別のGPT会話で実行してください。");}
        catch{setCopyFallback(response.prompt);setMessage("自動コピーが許可されていません。下のプロンプトを全選択してコピーしてください。");}
      }
      if(action==="grade")onSaved?.();
      setPayload("");setView(await request("view"));
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const content=view?.problem;
  return <section className="card" aria-label="転移確認">
    <h3>転移確認</h3><p>別問題1問の転移訓練です。生成プロンプトで出題意図を知る可能性があるため、本番での独立転移とは数えません。API・キー設定は不要です。</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!view&&<p>確認中…</p>}
    {copyFallback&&<label>コピー用プロンプト<textarea aria-label="コピー用プロンプト" readOnly rows={5} value={copyFallback} onFocus={e=>e.currentTarget.select()} style={{width:"100%"}}/></label>}
    {view?.existingProblemId&&!content&&<><p>高信頼の既存問題を使用します。生成は不要です。</p><button disabled={busy} onClick={()=>act("start")}>既存の転移確認問題を開く</button></>}
    {view&&!content&&!view.existingProblemId&&<>
      <p>ChatGPTに手動で渡し、問題文だけのJSONを戻してください。形式確認後、別の新しい会話で品質確認します。解答・採点基準は答案確定後に取り込みます。</p>
      {["generated","requested"].includes(view.status)&&<button disabled={busy} onClick={()=>act("start",true)}>問題生成プロンプトをコピー</button>}
      {view.status==="validation_pending"&&<button disabled={busy} onClick={()=>act("validation-prompt",true)}>品質確認プロンプトをコピー</button>}
      {["requested","validation_pending"].includes(view.status)&&<div>
        <label>{view.status==="requested"?"生成結果を貼り付け":"品質確認結果を貼り付け"}<textarea rows={5} autoComplete="off" value={payload} onChange={e=>setPayload(e.target.value)} style={{width:"100%"}}/></label>
        <button disabled={busy||!payload} onClick={()=>act(view.status==="requested"?"draft":"validate",view.status==="requested")}>{view.status==="requested"?"問題を登録（品質確認へ）":"品質確認して問題を登録"}</button>
      </div>}
      {view.status==="pending"&&<p>候補は保留です。{view.pendingReason}無理に生成せず本番演習へ戻ってください。</p>}
    </>}
    {content&&<>
      <h4>{content.display_label}</h4><p>{content.difficulty}・目安{content.estimated_minutes}分</p>
      {!view?.afterSubmission&&<section className="task-introduction" aria-label="課題の対象と回収目標">
        <p>対象：{content.display_label}（{content.problem_id}）</p><p>今回の作業：別問題の転移訓練</p>
        <p>前回のつまずき・対象技能：自力で道具を選ぶ確認のため、解答前は表示しません。</p>
        <p>回収目標：この問題を参照なしで解答し、採点後に対象部分の成功・失敗を確認します。本番転移とは別の訓練記録です。</p>
        <p>下の問題文を確認 → 紙／Goodnotesで解答 → 答案完成 → 採点プロンプトをコピー</p>
      </section>}
      <div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{content.problem_text}</div>
      {!view?.afterSubmission?<>
        <p>紙またはGoodnotesで解答し、答案画像を採点時にChatGPTへ直接添付してください。</p>
        <label>参照<select value={referenceLevel} onChange={e=>setReference(Number(e.target.value))}><option value={0}>参照なし</option><option value={3}>ヒント・資料・解答を見た</option></select></label>
        <button disabled={busy} onClick={()=>act("submit")}>答案完成・採点へ進む</button>
      </>:<>
        <p>対象能力：{view.afterSubmission.rootSkillId}／source：{view.afterSubmission.sourceProblemId}</p>
        <p>{view.afterSubmission.result}</p><p>{view.afterSubmission.evidence}</p>
        {view.afterSubmission.feedback&&<div>
          <p>今回の得点：{view.afterSubmission.feedback.score??"未測定"} / {view.afterSubmission.feedback.scoreMax}</p>
          <p>失点要因：{view.afterSubmission.feedback.errorPoint}</p>
          <p>次の行動：{view.afterSubmission.feedback.nextAction}</p>
          <p>成功条件：{view.afterSubmission.feedback.successCriterion}</p>
        </div>}
        {view.status!=="graded"&&<><p>新しいChatGPT会話で独立に解答・採点基準を確認し、今回の答案を採点してください。不整合や採点不能なら保存せず、再確認できます。</p><button disabled={busy} onClick={()=>act("grading-prompt",true)}>採点プロンプトをコピー</button>
          <label>正味解答時間（分・任意）<input type="number" min={0.1} step="any" value={minutes} placeholder="未入力は時間不明" onChange={e=>setMinutes(e.target.value)}/></label>
          <label>採点結果を貼り付け<textarea rows={5} value={payload} onChange={e=>setPayload(e.target.value)} style={{width:"100%"}}/></label>
          <button disabled={busy||!payload} onClick={()=>act("grade")}>結果を保存</button></>}
        {view.status==="graded"&&<><p>手動ChatGPT採点による訓練記録です。採点に疑問がある場合は提出後の解答・採点基準と実答案を照合してください。再確認しても保存済み履歴は上書きしません。</p><button disabled={busy} onClick={()=>act("grading-prompt",true)}>採点を再確認するプロンプトをコピー</button></>}
        <details><summary>提出後の解答・採点基準</summary><div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{view.afterSubmission.solution}{"\n"}{view.afterSubmission.rubric}</div></details>
      </>}
    </>}
  </section>;
}
