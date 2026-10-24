import {useState} from 'react';
import type {Bootstrap,Task} from './types';
import {RawGPTArchive} from './RawGPTArchive';
import AdvancedImportView from './AdvancedImportView';
import {CoachReviewControls} from './LearningDashboard';
import {overviewNextTask} from './learningOverview';
import {currentTaskIdentity} from './examOptimizationPolicy';
import {deriveTaskIntroduction} from './learningFeedback';
import {postGradingContext} from './postGradingFlow';
type Run=(a:()=>Promise<unknown>,message:string)=>Promise<boolean>;


export function GPTWorkspace({data,run,busy,onIssues,initialSection='consultation',contextTask,contextAttemptId,onExplain}:{data:Bootstrap;run:Run;busy:boolean;onIssues:()=>void;initialSection?:'consultation'|'grading'|'assessment';contextTask?:Task|null;contextAttemptId?:number|null;onExplain?:(attemptId:number)=>void}){
 const [section,setSection]=useState(initialSection),[copied,setCopied]=useState(false),[fallback,setFallback]=useState('');
 const graded=contextAttemptId?postGradingContext(data,contextAttemptId):null;
 const bound=contextTask?data.today.tasks.find(t=>currentTaskIdentity(t)===currentTaskIdentity(contextTask)&&!t.checked):undefined;
 const task=contextTask?bound:overviewNextTask(data),problem=data.problems.find(p=>p.problem_id===task?.problem_id),intro=problem&&task?deriveTaskIntroduction(data,problem,task):undefined;
 // No hidden answer keys, mathematical hints or pre-answer diagnosis for blind tasks.
 const blind=!!task&&(!!task.stable_session_key||!!task.transfer_training_key||(task.grading_contract?.learningPurpose||task.learning_purpose)==='transfer_check');
 const prompt=`統計検定1級の学習を手伝ってください。紙・Goodnotesで解き、答案画像は私が別途添付します。API連携はありません。\n${intro&&!blind?`今回の個別課題：${intro.target}\n対象：${intro.subparts}\n作業：${intro.workLabel}\n学習目的：${intro.recoveryGoal}`:'今回の問題は手元の原本で確認します。初見の測定・転移では、解答前に解法や過去の失点を教えないでください。'}\nまず私の理解を確認し、一度に答えや解法を示さず対話してください。まだ添付していない答案・問題文を見たと仮定しないでください。説明・相談は通常の文章で構いません。正式な採点はアプリで対象課題の採点プロンプトを取得してから依頼します。原文だけでは得点・習得・転移成功を確定しません。`;
 const handoff=graded?.available?graded.prompt:prompt;
 const copy=async()=>{try{await navigator.clipboard.writeText(handoff);setCopied(true)}catch{setFallback(handoff)}};
 return <div className="gpt-workspace"><div className="screen-tabs" aria-label="GPT連携の目的">{([['consultation','学習相談'],['grading','採点結果'],['assessment','総合評価']] as const).map(([key,label])=><button key={key} className={section===key?'active':''} aria-pressed={section===key} onClick={()=>setSection(key)}>{label}</button>)}</div>
  {section==='consultation'?<><section className="panel gpt-send"><span className="section-kicker">1 · ChatGPTへ渡す</span><h2>{graded?'保存した採点から補修':'相談 → 解答 → 返答を保管'}</h2><p>「勉強する」へ貼り付けます。答案は紙・Goodnotesで作成し、画像をChatGPTへ直接添付してください。</p>{graded?.available?<><h3>{graded.problem.display_label||graded.problem.title} ／ 答案 #{graded.attempt.id}</h3><p>{graded.kind} ・ {graded.attempt.score_numeric??'得点未記録'}{graded.attempt.score_numeric!=null?'点':''} ・ {graded.scope}</p><p>{graded.attempt.result_summary||'採点要約未登録'}</p><p>未解消・要確認：{graded.attempt.error_point||'記録なし'}</p><small>この採点は保存済みです。解説理解・局所補修は元得点や本番成績を変更せず、保持・転移の確認とも区別します。</small>{graded.newerAttemptId&&<p>新しい答案 #{graded.newerAttemptId} もあります。過去の失敗を現在の弱点と断定せず、両方の根拠をGPTへ渡します。</p>}</>:graded?<p role="alert">{graded.reason}</p>:intro&&!blind&&<p><strong>{intro.target}</strong> ／ {intro.subparts}</p>}{!graded&&contextTask&&!bound&&<p role="alert">この課題は更新・完了しました。現在の課題から選び直してください。</p>}<div className="button-row"><button className="primary" disabled={graded?!graded.available:!!contextTask&&!bound} onClick={()=>void copy()}>{copied?'コピーしました':graded?'補修情報をコピー':'学習情報をコピー'}</button><button className="ghost" onClick={onIssues}>現在の課題・訓練問題へ</button></div>{fallback&&<textarea aria-label="コピー用の学習情報" readOnly value={fallback} onFocus={e=>e.currentTarget.select()}/>}</section>{(!graded||graded.available)&&<section className="panel"><span className="section-kicker">2 · 解説・補修の返答を保管</span><RawGPTArchive key={graded?.available?graded.attempt.id:'general'} problems={data.problems} run={run} busy={busy} sourceAttempt={graded?.available?graded.attempt:undefined}/></section>}</>:
   section==='grading'?<AdvancedImportView problems={data.problems} answerIndex={data.answerIndex} problemAliases={data.problemAliases} attempts={data.attempts} reviews={data.reviews} run={run} busy={busy} onExplain={onExplain}/>:
   <section className="panel"><h2>ChatGPTで現在地を再評価</h2><CoachReviewControls data={data} run={run} busy={busy}/></section>}
 </div>;
}
