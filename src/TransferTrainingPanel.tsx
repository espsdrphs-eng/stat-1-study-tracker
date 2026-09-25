import {useEffect,useState} from "react";
import {post} from "./api";
type View={status:string;problem?:{problem_id:string;display_label:string;difficulty:string;estimated_minutes:number;problem_text:string};existingProblemId?:string;prompt?:string;pendingReason?:string;
  afterSubmission?:{rootSkillId:string;sourceProblemId:string;result:string;evidence:string;solution:string;rubric:string}};
export function TransferTrainingPanel({trainingKey,onExisting}:{trainingKey:string;onExisting?:(id:string)=>void}){
  const [view,setView]=useState<View>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[payload,setPayload]=useState(""),
    [answer,setAnswer]=useState(""),[minutes,setMinutes]=useState(12),[referenceLevel,setReference]=useState(0),[message,setMessage]=useState("");
  const request=(action:string,extra:Record<string,unknown>={})=>post<View>("/api/transfer-training",{key:trainingKey,action,...extra});
  useEffect(()=>{let active=true;request("view").then(v=>{if(active)setView(v)}).catch(e=>{if(active)setError(String(e.message))});return()=>{active=false};},[trainingKey]);
  const act=async(action:string,copy=false)=>{
    setBusy(true);setError("");setMessage("");
    try{const response=await request(action,{text:payload,answer,minutes,referenceLevel});
      if(response.status==="existing"&&response.existingProblemId){onExisting?.(response.existingProblemId);return;}
      if(copy&&response.prompt){await navigator.clipboard.writeText(response.prompt);setMessage("コピーしました。生成と検証は別のGPT会話で実行してください。");}
      setPayload("");setView(await request("view"));
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const content=view?.problem;
  return <section className="card" aria-label="転移確認">
    <h3>転移確認</h3><p>別問題1問で確認するtrainingです。本番で自然に転移できた証拠とは区別します。</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!view&&<p>確認中…</p>}
    {view?.existingProblemId&&!content&&<><p>高信頼の既存問題を使用します。生成は不要です。</p><button disabled={busy} onClick={()=>act("start")}>既存の転移確認問題を開く</button></>}
    {view&&!content&&!view.existingProblemId&&<>
      <p>問題は独立検証後に表示します。生成・検証出力には解答を含むため、読まずにコピーして貼り付けてください。</p>
      {["generated","requested"].includes(view.status)&&<button disabled={busy} onClick={()=>act("start",true)}>生成依頼プロンプトをコピー</button>}
      {view.status==="validation_pending"&&<button disabled={busy} onClick={()=>act("validation-prompt",true)}>独立検証プロンプトをコピー</button>}
      {["requested","validation_pending"].includes(view.status)&&<div>
        <label>GPT結果JSON（解答を隠して取り込み）<input type="password" autoComplete="off" value={payload} onChange={e=>setPayload(e.target.value)} style={{width:"100%"}}/></label>
        <button disabled={busy||!payload} onClick={()=>act(view.status==="requested"?"draft":"validate",view.status==="requested")}>{view.status==="requested"?"生成結果を受け取り、独立検証へ":"検証結果を取り込む"}</button>
      </div>}
      {view.status==="pending"&&<p>候補は保留です。{view.pendingReason}無理に生成せず本番演習へ戻ってください。</p>}
    </>}
    {content&&<>
      <h4>{content.display_label}</h4><p>{content.difficulty}・目安{content.estimated_minutes}分</p>
      <div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{content.problem_text}</div>
      {!view?.afterSubmission?<>
        <label>答案<textarea rows={8} value={answer} onChange={e=>setAnswer(e.target.value)} style={{width:"100%"}}/></label>
        <label>実時間（分）<input type="number" min={1} max={180} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>
        <label>参照<select value={referenceLevel} onChange={e=>setReference(Number(e.target.value))}><option value={0}>参照なし</option><option value={3}>ヒント・資料・解答を見た</option></select></label>
        <button disabled={busy||!answer.trim()} onClick={()=>act("submit")}>答案を確定する（以後変更不可）</button>
      </>:<>
        <p>対象能力：{view.afterSubmission.rootSkillId}／source：{view.afterSubmission.sourceProblemId}</p>
        <p>{view.afterSubmission.result}</p><p>{view.afterSubmission.evidence}</p>
        {view.status!=="graded"&&<><button disabled={busy} onClick={()=>act("grading-prompt",true)}>通常Attempt採点プロンプトをコピー</button>
          <label>GPT採点JSON<textarea rows={5} value={payload} onChange={e=>setPayload(e.target.value)} style={{width:"100%"}}/></label>
          <button disabled={busy||!payload} onClick={()=>act("grade")}>採点を保存</button></>}
        <details><summary>提出後の解答・採点基準</summary><div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{view.afterSubmission.solution}{"\n"}{view.afterSubmission.rubric}</div></details>
      </>}
    </>}
  </section>;
}
