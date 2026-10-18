import {useEffect,useState} from "react";
import {post} from "./api";
type View={status:string;statementOnly?:boolean;sourceStatementAvailable?:boolean;problem?:{problem_id:string;display_label:string;difficulty:string;estimated_minutes:number;problem_text:string};existingProblemId?:string;prompt?:string;pendingReason?:string;
  draftPreview?:{problem_text:string;difficulty:string;estimated_minutes:number};
  sourceContext?:{sourceProblemId:string;sourceLabel:string;skillName:string;sourceAttemptId:number;sourceScopeText:string;destinationProblemId?:string;evidenceKind:string};
  afterSubmission?:{rootSkillId:string;rootSkillName?:string;sourceProblemId:string;result:string;evidence:string;solution:string;rubric:string;strategy?:string;calculation?:string;
    feedback?:{score:number|null;scoreMax:number;errorPoint:string;nextAction:string;successCriterion:string}}};
export function TransferTrainingPanel({trainingKey,onSaved,allowBundle=true}:{trainingKey:string;onSaved?:()=>void;onExisting?:(id:string)=>void;allowBundle?:boolean}){
  const ability=trainingKey.startsWith('training:ability:');
  const [view,setView]=useState<View>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[payload,setPayload]=useState(""),
    [minutes,setMinutes]=useState(""),[referenceLevel,setReference]=useState(0),[message,setMessage]=useState(""),[copyFallback,setCopyFallback]=useState(""),
    [preparedPrompt,setPreparedPrompt]=useState(''),
    [sourceContext,setSourceContext]=useState<View['sourceContext']>();
  const request=(action:string,extra:Record<string,unknown>={})=>post<View>("/api/transfer-training",{key:trainingKey,action,...extra});
  useEffect(()=>{let active=true;setView(undefined);setPayload('');setError('');setMessage('');setCopyFallback('');setPreparedPrompt('');setSourceContext(undefined);request("view").then(v=>{if(active)setView(v)}).catch(e=>{if(active)setError(String(e.message))});return()=>{active=false};},[trainingKey]);
  const inspectSource=async()=>{setBusy(true);setError('');try{setSourceContext((await request('lineage')).sourceContext)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
  const act=async(action:string,copy=false)=>{
    setBusy(true);setError("");setMessage("");setCopyFallback("");setPreparedPrompt('');
    try{const response=await request(action,{text:payload,answer_medium:"paper_image",answer_completed:action==="submit",minutes,referenceLevel});
      if(copy&&response.prompt){
        setPreparedPrompt(response.prompt);
        try{await navigator.clipboard.writeText(response.prompt);setMessage(action==="grading-prompt"?"コピーしました。確定答案と問題資料をGPTへ渡し、採点JSON / YAMLを取り込んでください。":['draft','validation-prompt'].includes(action)?"品質確認プロンプトをコピーしました。生成とは別のChatGPT会話で確認し、返ったJSONを下へ貼り付けてください。":"生成プロンプトをコピーしました。ChatGPTの生成結果を下へ貼り付けてください。");}
        catch{setCopyFallback(response.prompt);setError("自動コピーできませんでした。用意したプロンプトを再コピーするか、下の文面を全選択してコピーしてください。");}
      }
      if(action==="grade"||action==="validate"&&response.problem)onSaved?.();
      if(action==='validate'&&response.problem)setMessage('問題を保存しました。下の問題文を紙・Goodnotesで解答してください。模範解答は答案完成後まで表示しません。');
      if(action==='validate'&&(response.status==='requested'||response.status==='pending')&&response.pendingReason)setError(response.pendingReason);
      if(action==='draft'||action==="validate"&&response.problem||action==='grade'&&response.status==='graded')setPayload(current=>current===payload?'':current);
      setView(await request("view"));
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const content=view?.problem;
  const step=!content?(view?.status==='validation_pending'?2:1):view?.afterSubmission?4:3;
  const resultLabel=view?.afterSubmission?.result==='training transfer success'?'転移訓練：成功（自然な本番転移とは別記録）':view?.afterSubmission?.result==='training transfer failure'?'転移訓練：未達（対象技能を再補修）':view?.afterSubmission?.result;
  return <section className="card" aria-label="転移確認">
    <h3>{ability?(!content?'能力トレーニング問題を作成':view?.afterSubmission?'能力トレーニングの採点・結果':'能力トレーニング問題を解く'):!content?'転移問題を作成':view?.afterSubmission?'転移問題の採点・結果':'転移問題を解く'}</h3><p>ChatGPTとのコピー・貼り付けで進めます。{ability?'採点根拠・プロフィールに基づく能力仮説を別問題で検証する訓練':'生成意図を知る可能性がある転移訓練'}であり、自然な本番転移とは別記録です。</p>
    <ol className="transfer-steps" aria-label="転移問題の手順">{['生成','品質確認・登録','紙で解答','採点・保存'].map((label,i)=><li key={label} aria-current={step===i+1?'step':undefined}>{i+1}. {label}{step===i+1?'（現在）':''}</li>)}</ol>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!view&&<p>確認中…</p>}
    {preparedPrompt&&<button className="primary" disabled={busy} onClick={async()=>{try{await navigator.clipboard.writeText(preparedPrompt);setCopyFallback('');setError('');setMessage('用意したプロンプトをコピーしました。ChatGPTへ貼り付けてください。')}catch{setCopyFallback(preparedPrompt);setError('コピーできませんでした。コピー用プロンプトを全選択してコピーしてください。')}}}>用意したプロンプトをコピー</button>}
    {copyFallback&&<details><summary>全選択用のプロンプトを開く（生成条件・検算内容を含みます）</summary><label>コピー用プロンプト<textarea aria-label="コピー用プロンプト" readOnly rows={5} value={copyFallback} onFocus={e=>e.currentTarget.select()} style={{width:"100%"}}/></label></details>}
    {view&&!content&&<><button className="ghost" disabled={busy} onClick={inspectSource}>転移元との対応を確認（訓練の説明）</button>
      {sourceContext&&<section aria-label="転移元の対応"><p>元問題：{sourceContext.sourceLabel}（{sourceContext.sourceProblemId}）／根拠答案 #{sourceContext.sourceAttemptId}</p>
        <p>確認する技能：{sourceContext.skillName}</p><p>元の対象範囲：{sourceContext.sourceScopeText}</p>
        <p>転移先：{sourceContext.destinationProblemId||'開始時に別問題を割り当てます'}</p><small>{sourceContext.evidenceKind}。問題を開いた後の解答前画面には、この情報を自動表示しません。</small></section>}</>}
    {view?.existingProblemId&&!content&&<><p>高信頼の既存問題を使用します。生成は不要です。</p><button disabled={busy} onClick={()=>act("start")}>既存の転移確認問題を開く</button></>}
    {view?.existingProblemId&&!content&&allowBundle&&<button disabled={busy} onClick={()=>act('start-generated',true)}>新しい転移問題の生成プロンプトをコピー</button>}
    {view&&!content&&!view.existingProblemId&&<>
      <p>採点で確認した弱点を生成条件に使います。{view.sourceStatementAvailable?'保存済みの元の生成問題と採点根拠を引き継ぎます。':'元問題の本文・条件はアプリに未登録です。'}</p>
      <p>{view.statementOnly?'この既存依頼は問題文のみの形式です。解答・採点基準は答案確定後に取り込みます。':allowBundle?'ChatGPTの問題・正答・採点基準を取り込み、別の会話で品質確認します。登録後の解答前画面には問題文だけを表示します。':'ChatGPTに問題文だけのJSONを戻してもらい、別の新しい会話で品質確認します。'}</p>
      {["generated","requested"].includes(view.status)&&<button disabled={busy} onClick={()=>act(allowBundle?'start-generated':"start",true)}>問題生成プロンプトをコピー</button>}
      {view.status==="validation_pending"&&<button disabled={busy} onClick={()=>act("validation-prompt",true)}>品質確認プロンプトをコピー</button>}
      {view.draftPreview&&<section className="transfer-draft-preview" aria-label="生成問題のプレビュー"><h4>問題文のプレビュー（まだ未登録）</h4><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{view.draftPreview.problem_text}</p><small>品質確認のJSONを取り込むと保存できます。正答・解説・採点基準はここには表示しません。</small></section>}
      {["requested","validation_pending"].includes(view.status)&&<div>
        {view.status==='requested'&&!view.statementOnly&&<p>生成JSONには模範解答も含まれます。中身を読み解かずに貼り付けてください。確認後の画面は問題文だけに切り替わります。</p>}
        <label>{view.status==="requested"?"生成結果を貼り付け":"品質確認結果を貼り付け"}<textarea aria-label={view.status==="requested"?"生成結果を貼り付け":"品質確認結果を貼り付け"} rows={4} autoComplete="off" value={payload} onChange={e=>setPayload(e.target.value)} style={{width:"100%"}}/></label>
        <button className="primary" disabled={busy||!payload} onClick={()=>act(view.status==="requested"?"draft":"validate",view.status==="requested")}>{view.status==="requested"?"生成JSONを検証・プレビュー":"品質確認して問題を登録"}</button>
      </div>}
      {view.status==="pending"&&<p>候補は保留です。{view.pendingReason}無理に生成せず本番演習へ戻ってください。</p>}
    </>}
    {content&&<>
      {view.status==='problem_pending'&&<p role="status">{view.pendingReason} 新しい会話で問題の条件を再確認してください。</p>}
      <h4>{content.display_label}</h4><p>{content.difficulty}・目安{content.estimated_minutes}分</p>
      {!view?.afterSubmission&&<section className="task-introduction" aria-label="課題の対象と回収目標">
        <p>対象：{content.display_label}（{content.problem_id}）</p><p>今回の作業：{ability?'新しい問題での能力トレーニング':'別問題の転移訓練'}</p>
        <p>前回のつまずき・対象技能：自力で道具を選ぶ確認のため、解答前は表示しません。</p>
        <p>回収目標：この問題を参照なしで解答し、採点後に対象部分の成功・失敗を確認します。本番転移とは別の訓練記録です。</p>
        <p>下の問題文を確認 → 紙／Goodnotesで解答 → 答案完成 → 採点プロンプトをコピー</p>
      </section>}
      <div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{content.problem_text}</div>
      {!view?.afterSubmission?<>
        <p>紙またはGoodnotesに、解答前の方針と理由、その後の答案を書いてください。答案画像は採点時にChatGPTへ直接添付します。</p>
        <label>参照<select value={referenceLevel} onChange={e=>setReference(Number(e.target.value))}><option value={0}>参照なし</option><option value={3}>ヒント・資料・解答を見た</option></select></label>
        <button disabled={busy} onClick={()=>act("submit")}>答案完成・採点へ進む</button>
      </>:<>
        <p>{ability?'今回検証した能力':'確認した技能'}：{view.afterSubmission.rootSkillName||view.afterSubmission.rootSkillId}／{ability?'訓練問題':`元問題：${view.afterSubmission.sourceProblemId}／転移先`}：{content.problem_id}</p>
        <p>{resultLabel}</p><p>{view.afterSubmission.evidence}</p>
        {view.status==='graded'&&view.afterSubmission.strategy&&<p>方針選択：{view.afterSubmission.strategy} ／ 対象の主要計算：{view.afterSubmission.calculation}（答案全体の点数とは別判定）</p>}
        {view.afterSubmission.feedback&&<div>
          <p>今回の得点：{view.afterSubmission.feedback.score??"未測定"} / {view.afterSubmission.feedback.scoreMax}</p>
          <p>失点要因：{view.afterSubmission.feedback.errorPoint}</p>
          <p>次の行動：{view.afterSubmission.feedback.nextAction}</p>
          <p>成功条件：{view.afterSubmission.feedback.successCriterion}</p>
        </div>}
        {view.status!=="graded"&&<><p>新しいChatGPT会話で独立に解答・採点基準を確認し、今回の答案を採点してください。不整合や採点不能なら保存せず、再確認できます。</p><button disabled={busy} onClick={()=>act("grading-prompt",true)}>採点プロンプトをコピー</button>
          <label>正味解答時間（分・任意）<input type="number" min={0.1} step="any" value={minutes} placeholder="未入力は時間不明" onChange={e=>setMinutes(e.target.value)}/></label>
          <label>採点結果を貼り付け（JSON / YAML）<textarea aria-label="採点結果を貼り付け（JSON / YAML）" rows={5} value={payload} onChange={e=>setPayload(e.target.value)} style={{width:"100%"}}/></label>
          <button disabled={busy||!payload} onClick={()=>act("grade")}>結果を保存</button></>}
        {view.status==="graded"&&<><p>手動ChatGPT採点による訓練記録です。採点に疑問がある場合は提出後の解答・採点基準と実答案を照合してください。再確認しても保存済み履歴は上書きしません。</p><button disabled={busy} onClick={()=>act("grading-prompt",true)}>採点を再確認するプロンプトをコピー</button></>}
        <details><summary>提出後の解答・採点基準</summary><div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{view.afterSubmission.solution}{"\n"}{view.afterSubmission.rubric}</div></details>
      </>}
    </>}
  </section>;
}
