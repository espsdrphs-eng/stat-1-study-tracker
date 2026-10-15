import type {db as database} from "./localDb";
import yaml from "js-yaml";
import type {Bootstrap,Problem,StudyUpdate,Attempt} from "./types.ts";
import {deriveTransferTrainingCandidates,generationMetaKey,generationPrompt,validationPrompt,
  acceptGenerationDraft,acceptGenerationValidation,registerGeneratedProblem,blindGeneratedView,
  transferJson,validateManualGradingReference,type TransferGenerationRecord,type TransferTrainingLineage} from "./generatedTransfer.ts";
import {EXAM_REFERENCE_PACK_META_KEY,EXAM_REFERENCE_EXPOSURE_META_KEY,type StoredExamReferencePack} from "./examReferencePack.ts";
import {buildInitialGradingContract} from "./gradingContract.ts";
import {buildFirstAttemptGradingPrompt} from "./gradingPrompt.ts";
import {parseStudyText} from "./importParser.ts";
import {deriveTransferEvidence,transferTrainingOutcome} from "./skillEvidence.ts";
import {optionalNetMinutes,imageGradingPrompt} from "./learningFeedback.ts";
import {deriveTaskAnswerScope,taskAnswerScopeText,type TaskAnswerScope} from './taskAnswerScope.ts';

export function transferGradingContext(lineage:TransferTrainingLineage,destinationProblemId:string,scope?:TaskAnswerScope){
  return {context_version:'STAT1-TRANSFER-CONTEXT-v1',transfer_key:lineage.key,source_problem_id:lineage.sourceProblemId,
    source_attempt_id:lineage.sourceAttemptId,source_finding_ids:[...lineage.sourceFindingIds],root_weakness_id:lineage.rootWeaknessId,
    root_skill_id:lineage.rootSkillId,repair_attempt_id:lineage.repairAttemptId,retrieval_attempt_id:lineage.retrievalAttemptId,
    destination_problem_id:destinationProblemId,destination_scope:'whole_problem',
    ...(scope?{source_answer_scope:{status:scope.status,primary_target_parts:scope.primaryTargetParts,secondary_target_parts:scope.secondaryTargetParts,reference_only_parts:scope.referenceOnlyParts}}:{})};
}
function transferContextPrompt(context:ReturnType<typeof transferGradingContext>){
  return `\n【転移対応・アプリが管理する識別情報】\nstudy_update.transfer_task_context を次のJSONのまま返してください:\n${JSON.stringify(context)}\n元問題の得点ではなく、転移先の実答案にある対象技能を判定する。sourceとdestinationを入れ替えない。`;
}
function contextValue(value:unknown):unknown{
  if(Array.isArray(value))return value.map(contextValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,contextValue(v)]));
  return value;
}

export function transferAnswerSubmission(body:any){
  const text=String(body.answer||"").trim(),paper=body.answer_medium==="paper_image";
  if(paper&&!body.answer_completed||!paper&&!text)throw new Error("紙／Goodnotesの答案完成を確認してください");
  const minutes=optionalNetMinutes(body.minutes),referenceLevel=Number(body.referenceLevel);
  if(minutes!=null&&minutes>180||!Number.isInteger(referenceLevel)||referenceLevel<0||referenceLevel>5)throw new Error("正味時間と参照段階を確認してください");
  return {text:paper?"":text,minutes,referenceLevel,submittedAt:new Date().toISOString(),...(paper?{medium:"paper_image" as const}:{})};
}

function savedTrainingFeedback(a:Attempt|undefined,success:boolean,criterion:string){
  if(!a)return undefined;
  return {score:a.score_numeric??null,scoreMax:a.score_max||100,
    errorPoint:(a.graded_findings||[]).find(f=>!f.resolved&&f.error_type!=="none")?.evidence||a.error_point||"採点上の失点記録なし（正しさの保証ではありません）",
    nextAction:success?"Todayの次の本番型候補で、自然な転移を再測定する":"Todayの最新順位で、対象技能の補修・参照なし確認を再評価する",
    successCriterion:`${criterion}。参照なしで操作を選び、対象の主要計算を完遂し、対象major errorがないこと。`};
}

/** This is the existing offline GPT copy/paste interface, not a model API. */
export async function transferTrainingRequest(args:{db:typeof database;body:any;
  current:()=>Promise<Bootstrap>;save:(input:StudyUpdate&Record<string,unknown>)=>Promise<number>}){
  const {db,body}=args,key=String(body.key||""),action=String(body.action||"view");
  if(!key.startsWith("training:"))throw new Error("転移確認の計画キーが必要です");
  const [problems,attempts,pastSessions,answers,meta,exposure]=await Promise.all([db.problems.toArray(),db.attempts.toArray(),
    db.pastSessions.toArray(),db.answerIndex.toArray(),db.meta.get(EXAM_REFERENCE_PACK_META_KEY),db.meta.get(EXAM_REFERENCE_EXPOSURE_META_KEY)]);
  if(!meta)throw new Error("canonical taxonomy未確認のため保留です");
  const candidates=deriveTransferTrainingCandidates({record:JSON.parse(meta.value) as StoredExamReferencePack,
    problems,attempts,pastSessions,answers,planningMode:"ranked",exposureOverrides:JSON.parse(exposure?.value||"{}")});
  const candidate=candidates.find(c=>c.key===key);
  const savedAttempt=attempts.find(a=>a.transfer_lineage?.key===key&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id);
  const existingId=candidate?.existingProblemId||(!problems.find(p=>p.problem_id===savedAttempt?.problem_id)?.generated_transfer?savedAttempt?.problem_id:undefined);
  const contextRow=existingId?await db.meta.get(`transfer-training-context:${existingId}`):undefined;
  let context=contextRow?JSON.parse(contextRow.value) as import("./generatedTransfer.ts").TransferTrainingLineage&{answer_submission?:import("./generatedTransfer.ts").GeneratedTransferContent["answer_submission"]}:undefined;
  if(context&&context.key!==key)throw new Error('この転移先は別の転移課題に割り当て済みです。元問題・技能を取り違えないよう、その課題を確認してから再計画してください。');
  let record:TransferGenerationRecord|undefined;
  const stored=await db.meta.get(generationMetaKey(key));if(stored)record=JSON.parse(stored.value);
  let problem=problems.find(p=>p.generated_transfer?.lineage.key===key);
  const source=problems.find(p=>p.problem_id===(candidate?.lineage.sourceProblemId||record?.lineage.sourceProblemId));
  const sourceFeatures=[source?.canonical_problem_type||"",source?.theme||"",...(source?.canonical_keywords||[])].filter(Boolean);
  const storedPack=JSON.parse(meta.value) as StoredExamReferencePack;
  const skillName=(id:string)=>storedPack.data.concepts.find(c=>c.concept_id===id)?.display_name||'技能名未登録';
  const sourceScope=(lineage:TransferTrainingLineage)=>{
    const p=problems.find(p=>p.problem_id===lineage.sourceProblemId);
    return p?deriveTaskAnswerScope({problem:p,task:{problem_id:p.problem_id,source_attempt_id:lineage.sourceAttemptId,
      learning_purpose:'error_repair',targeted_parts:lineage.sourceFindingIds},attempts}):undefined;
  };
  if(action==='lineage'){
    // Explicit training-purpose inspection only. Never add this information to
    // the blind view or perform generation/start as a side effect of inspection.
    const lineage=(record?.lineage||problem?.generated_transfer?.lineage||context||candidate?.lineage||savedAttempt?.transfer_lineage) as TransferTrainingLineage|undefined;
    if(!lineage)throw new Error('転移元の対応情報がありません。現在のTodayを確認してください。');
    const p=problems.find(p=>p.problem_id===lineage.sourceProblemId),scope=sourceScope(lineage);
    return {status:'lineage',sourceContext:{sourceProblemId:lineage.sourceProblemId,sourceLabel:p?.display_label||p?.title||lineage.sourceProblemId,
      rootSkillId:lineage.rootSkillId,skillName:skillName(lineage.rootSkillId),sourceAttemptId:lineage.sourceAttemptId,
      sourceScopeText:scope?taskAnswerScopeText(scope):'対象小問未特定',destinationProblemId:problem?.problem_id||existingId,
      evidenceKind:'意図的な転移訓練。本番の独立転移とは別集計'}};
  }
  const saveRecord=async()=>{if(record)await db.meta.put({key:generationMetaKey(key),value:JSON.stringify(record)});};
  if(action!=="view"&&!problem&&!savedAttempt){
    if(!candidate)throw new Error("補修・遅延確認・taxonomy条件が未達、または確認済みです");
    const current=await args.current();
    if(candidate.kind==="pending"||!current.today.tasks.some(t=>t.transfer_training_key===key&&
      (t.ranking?.eligible===true||!current.today.canonicalStudyPlan.ranked&&t.triage==="must")&&!t.checked))
      throw new Error("まだCanonical Study Planの実行対象ではありません");
    if(candidate.kind==="existing"){
      if(action==="start"&&!context){context=candidate.lineage;
        await db.meta.put({key:`transfer-training-context:${candidate.existingProblemId}`,value:JSON.stringify(context)});}
      if(!context)throw new Error("先に転移確認を開始してください");
    }
  }
  if(problem?.generated_transfer&&!problem.generated_transfer.answer_submission&&["start","submit"].includes(action)){
    const current=await args.current();
    if(!candidate||candidate.kind==="pending"||!current.today.tasks.some(t=>t.transfer_training_key===key&&t.ranking?.eligible&&!t.checked))
      throw new Error("現在は転移の開始資格がありません。補修・遅延保持を再確認してください");
  }
  if(existingId&&context||existingId&&savedAttempt){
    const existing=problems.find(p=>p.problem_id===existingId)!;
    const lineage=context||savedAttempt!.transfer_lineage!;
    if(action==="submit"){
      if(!context||context.answer_submission||savedAttempt)throw new Error("答案提出済みです");
      context={...context,answer_submission:transferAnswerSubmission(body)};
      await db.meta.put({key:`transfer-training-context:${existingId}`,value:JSON.stringify(context)});
    }else if(action==="grading-prompt"){
      const submission=context?.answer_submission||(lineage as typeof context)?.answer_submission;
      if(!submission)throw new Error("先に参照状況と答案を確定してください");
      const contract=buildInitialGradingContract({problem:existing,mode:"full"});
      return {status:"submitted",prompt:buildFirstAttemptGradingPrompt({problemId:existingId,mode:"full",gradingContract:contract})+
        imageGradingPrompt(`\n答案完成記録：${JSON.stringify(submission)}\n公式の問題文・解答と本人の答案画像を添付して照合すること。資料がなければ推測採点しない。`,submission.referenceLevel,submission.minutes)+
        `\n出力はJSONのstudy_updateを1件だけ（YAMLではない）。grading_confidenceは既存採点契約の0〜100。`+
        `\n対象=${lineage.rootSkillId}。study_update内にtarget_skill_assessment: {self_selected:boolean,major_calculation_success:boolean,no_major_error:boolean,evidence:string}を必ず含める。総合点ではなく実答案の対象操作を独立判定。target外minorは対象失敗にしない。`+
        transferContextPrompt(transferGradingContext(lineage,existingId,sourceScope(lineage)))};
    }else if(action==="grade"&&!savedAttempt){
      if(!context?.answer_submission)throw new Error("答案未提出です");
      const raw=transferJson(String(body.text||""));validateTransferGrade(raw,existingId,transferGradingContext(lineage,existingId,sourceScope(lineage)));
      const parsed=parseStudyText(yaml.dump(raw),problems,answers,await db.problemAliases.toArray());
      if(parsed.updates.length!==1||parsed.updates[0].problem_id!==existingId)throw new Error("この問題の採点1件だけを保存してください");
      const minutes=context.answer_submission.medium==="paper_image"?optionalNetMinutes(body.minutes):context.answer_submission.minutes;
      await args.save({...parsed.updates[0],actual_minutes:minutes,time_minutes:minutes,memo:[typeof raw.study_update?.memo==="string"?raw.study_update.memo:"","答案：紙／Goodnotes画像、採点方法：手動ChatGPT（モデル採点・訓練証拠）"].filter(Boolean).join("\n"),target_skill_assessment:raw.study_update?.target_skill_assessment,submission_id:`training:${key}:${existingId}`});
    }else if(!["view","start","grade"].includes(action))throw new Error("不明な既存転移操作です");
    const facts=await db.attempts.toArray(),attempt=facts.find(a=>a.transfer_lineage?.key===key&&a.problem_id===existingId&&!a.exclude_from_metrics);
    return {status:attempt?"graded":context?.answer_submission?"submitted":"existing_ready",existingProblemId:existingId,
      problem:{problem_id:existingId,display_label:existing.display_label||existing.title||existingId,difficulty:"統計検定1級",estimated_minutes:12,
        problem_text:"書籍・公式PDFの問題文だけを開いて解答してください。問題文の全文はアプリに収録されていません。"},
      afterSubmission:context?.answer_submission||attempt?{rootSkillId:lineage.rootSkillId,rootSkillName:skillName(lineage.rootSkillId),sourceProblemId:lineage.sourceProblemId,
        result:attempt?deriveTransferEvidence(facts).some(e=>e.successAttemptId===attempt.id)?"training transfer success":transferTrainingOutcome(attempt):"採点待ち",
        evidence:attempt?.target_skill_assessment?.evidence||"",feedback:savedTrainingFeedback(attempt,!!attempt&&deriveTransferEvidence(facts).some(e=>e.successAttemptId===attempt.id),lineage.successCriteria),solution:"公式の解答資料で確認してください。",rubric:"対象能力の自力選択・主要計算・major errorを独立に判定"}:undefined};
  }
  if(action==="start"){
    if(!record&&!problem){record={key,lineage:candidate!.lineage,createdAt:new Date().toISOString(),status:"requested",rounds:[],input_format:"statement_only_v1"};await saveRecord();}
    // An unused old request can use the new protocol without touching a draft or historical problem.
    if(record?.status==="requested"&&!record.rounds.length&&!record.input_format){record={...record,input_format:"statement_only_v1"};await saveRecord();}
    if(record?.status==="requested")return {status:record.status,prompt:generationPrompt(record,sourceFeatures)};
  }else if(action==="draft"){
    if(!record||problem)throw new Error("生成依頼がない、または登録済みです");
    const next=await acceptGenerationDraft(record,String(body.text||""));
    if(problems.some(p=>p.generated_transfer?.problem_text.trim()===next.rounds.at(-1)!.draft.problem_text.trim()))throw new Error("同じ問題文が登録済みです。新しい別問題を依頼してください。");
    record=next;await saveRecord();
    return {status:record.status,prompt:validationPrompt(record,sourceFeatures)};
  }else if(action==="validation-prompt"){
    if(!record||problem)throw new Error("検証待ちdraftがありません");
    return {status:record.status,prompt:validationPrompt(record,sourceFeatures)};
  }else if(action==="validate"){
    if(!record||problem)throw new Error("登録済み内容は変更できません");
    record=acceptGenerationValidation(record,String(body.text||""));
    if(record.status==="validation_pending"){
      if(problems.some(p=>p.generated_transfer?.problem_text.trim()===record!.rounds.at(-1)!.draft.problem_text.trim()))throw new Error("同じ問題文が登録済みです。新しい別問題を依頼してください。");
      problem=registerGeneratedProblem(record,`GEN-${crypto.randomUUID().toUpperCase()}`,new Date().toISOString());
      record={...record,status:"registered",problemId:problem.problem_id};
      await db.transaction("rw",[db.problems,db.meta],async()=>{await db.problems.add(problem!);await saveRecord();});
    }else await saveRecord();
  }else if(action==="submit"){
    const content=problem?.generated_transfer;
    if(!content||content.answer_submission)throw new Error("問題未登録、または答案提出済みです");
    problem={...problem!,generated_transfer:{...content,lifecycle_status:"submitted",answer_submission:transferAnswerSubmission(body)}};
    await db.problems.put(problem);
  }else if(action==="grading-prompt"){
    const content=problem?.generated_transfer,submission=content?.answer_submission;
    if(!content||!submission)throw new Error("先に参照状況と答案を確定してください");
    const contract=buildInitialGradingContract({problem:problem!,mode:"full"});
    return {status:"submitted",prompt:buildFirstAttemptGradingPrompt({problemId:problem!.problem_id,mode:"full",gradingContract:contract})+
      `\n問題・確定答案（モデルの解答と本人の答案を混同しない）：\n${JSON.stringify({problem:content.problem_text,...(!content.input_format?{solution:content.reference_solution,rubric:content.grading_rubric}:{}),submission})}`+
      (content.input_format?`\n新しい会話で問題を独立に解き直し、条件不足・解答不能・採点不能がないか検算してから採点する。study_updateと並べてmathematical_reviewを必ず返す：`+
        JSON.stringify({problem_id:problem!.problem_id,content_hash:content.content_hash,reference_solution:"完全な導出",grading_rubric:"得点配分・対象操作の採点基準",checks:{well_defined:{pass:false,evidence:"条件と解答可能性の具体的根拠"},solution_correct:{pass:false,evidence:"独立検算の具体的根拠"},rubric_aligned:{pass:false,evidence:"解答と採点基準の対応"}}})+
        `\n不確実ならpass=falseとし、成功の採点を捏造しない。解答は今の提出後に初めて取り込む。`:"")+
      imageGradingPrompt(`\n出力はJSONのstudy_updateを1件。actual_reference_level=${submission.referenceLevel}。`,submission.referenceLevel,submission.minutes)+
      `\nstudy_update内にtarget_skill_assessment: {self_selected:boolean,major_calculation_success:boolean,no_major_error:boolean,evidence:string}を必ず含める。`+
      `対象=${content.root_skill_id}。総合点とは独立に、初手と主要計算の実答案から判定。target外minorでは対象失敗にしない。模範解答の内容を本人の答案と混同しない。`+
      transferContextPrompt(transferGradingContext(content.lineage,problem!.problem_id,sourceScope(content.lineage)))};
  }else if(action==="grade"){
    if(!problem?.generated_transfer?.answer_submission)throw new Error("答案未提出です");
    const raw=transferJson(String(body.text||""));validateTransferGrade(raw,problem.problem_id,transferGradingContext(problem.generated_transfer.lineage,problem.problem_id,sourceScope(problem.generated_transfer.lineage)));
    const reference=problem.generated_transfer.input_format?validateManualGradingReference(problem,raw.mathematical_review):undefined;
    const parsed=parseStudyText(yaml.dump(raw),problems,answers,await db.problemAliases.toArray());
    if(parsed.updates.length!==1||parsed.updates[0].problem_id!==problem.problem_id)throw new Error("この問題の採点1件だけを保存してください");
    const submission=problem.generated_transfer.answer_submission;
    const minutes=submission.medium==="paper_image"?optionalNetMinutes(body.minutes):submission.minutes;
    await args.save({...parsed.updates[0],actual_minutes:minutes,time_minutes:minutes,memo:[typeof raw.study_update?.memo==="string"?raw.study_update.memo:"","答案：紙／Goodnotes画像、採点方法：手動ChatGPT（モデル採点・訓練証拠）"].filter(Boolean).join("\n"),target_skill_assessment:raw.study_update?.target_skill_assessment,
      manual_generated_reference:reference,
      submission_id:`generated:${problem.problem_id}`});
    problem=await db.problems.get(problem.problem_id);
  }else if(action!=="view"&&action!=="start")throw new Error("不明な転移確認操作です");
  const content=problem?.generated_transfer;
  const result:Record<string,unknown>={status:content?.lifecycle_status||record?.status||candidate?.kind||"pending",
    problem:problem?blindGeneratedView(problem):undefined,existingProblemId:candidate?.existingProblemId,
    rounds:record?.rounds.length||0,pendingReason:record?.pendingReason||candidate?.reason};
  if(content?.answer_submission){
    const facts=await db.attempts.toArray();
    const attempt=facts.find(a=>a.problem_id===problem!.problem_id&&!a.exclude_from_metrics);
    result.afterSubmission={rootSkillId:content.root_skill_id,rootSkillName:skillName(content.root_skill_id),sourceProblemId:content.lineage.sourceProblemId,
      result:attempt?(deriveTransferEvidence(facts).some(r=>r.successAttemptId===attempt.id)?"training transfer success":transferTrainingOutcome(attempt)):"採点待ち",
      evidence:attempt?.target_skill_assessment?.evidence||"",feedback:savedTrainingFeedback(attempt,!!attempt&&deriveTransferEvidence(facts).some(r=>r.successAttemptId===attempt.id),content.lineage.successCriteria),solution:content.grading_reference?.reference_solution||content.reference_solution,rubric:content.grading_reference?.grading_rubric||content.grading_rubric};
  }
  return result;
}

export function generatedAttemptFields(problem:Problem,input:Record<string,unknown>){
  const c=problem.generated_transfer,s=c?.answer_submission;
  if(!c||!s)throw new Error("生成問題はblind答案を提出してから採点してください");
  if(c.input_format)validateManualGradingReference(problem,input.manual_generated_reference);
  const target=input.target_skill_assessment as Attempt["target_skill_assessment"];
  if(!target||[target.self_selected,target.major_calculation_success,target.no_major_error].some(v=>typeof v!=="boolean")||!target.evidence?.trim())
    throw new Error("target skillの独立採点が必要です");
  return {source_type:"generated" as const,evidence_strength:"training" as const,target_skill_prompted:true,
    source_problem_id:c.lineage.sourceProblemId,memo:[input.memo,`今回の確定答案:\n${s.text}`,"手動生成プロンプトの閲覧は未検証。本番の独立転移とは区別。"].filter(Boolean).join("\n\n"),
    target_skill_assessment:target,transfer_lineage:c.lineage,exam_score_eligible:false,
    learning_purpose:"transfer_check" as const,learning_stage:"transfer" as const,
    actual_reference_level:Math.max(s.referenceLevel,input.hint_used?3:0,Number(input.actual_reference_level??input.reference_level??0)),time_minutes:input.actual_minutes===null?null:input.actual_minutes!=null?Number(input.actual_minutes):s.minutes,exam_score:null};
}

export function validateTransferGrade(raw:any,problemId:string,context?:ReturnType<typeof transferGradingContext>){
  const u=raw?.study_update;
  if(!u||u.problem_id!==problemId)throw new Error("対象問題が一致しません。この問題の採点結果だけを貼り付けてください。");
  if(u.transfer_task_context!==undefined){
    if(!context||!u.transfer_task_context||typeof u.transfer_task_context!=='object')throw new Error('転移の対応情報を確認できません。現在の採点プロンプトを使ってください。');
    for(const [key,expected]of Object.entries(context))if(JSON.stringify(contextValue(u.transfer_task_context[key]))!==JSON.stringify(contextValue(expected)))
      throw new Error(`転移の対応情報が一致しません（${key}）。元問題・転移先・対象技能を現在の採点プロンプトで確認してください。`);
  }
  if(typeof u.score_numeric!=="number"||!Number.isFinite(u.score_numeric)||u.score_numeric<0||u.score_numeric>100||u.score_max!=null&&u.score_max!==100)
    throw new Error("点数は0〜100の数値で必要です。採点プロンプトで再確認してください。");
  if(typeof u.grading_confidence!=="number"||!Number.isFinite(u.grading_confidence)||u.grading_confidence<0||u.grading_confidence>100||
    !Array.isArray(u.graded_findings)||!u.graded_findings.length)throw new Error("採点根拠と確信度（0〜100、0〜1形式も可）が必要です。");
  for(const key of ["actual_reference_level","reference_level"]){
    if(u[key]!=null&&(typeof u[key]!=="number"||!Number.isInteger(u[key])||u[key]<0||u[key]>5))throw new Error("参照段階は0〜5の整数で必要です。");
  }
  const t=u.target_skill_assessment;
  if(!t||[t.self_selected,t.major_calculation_success,t.no_major_error].some(v=>typeof v!=="boolean")||typeof t.evidence!=="string"||!t.evidence.trim())
    throw new Error("対象能力の採点と具体的根拠が不足しています。");
}
