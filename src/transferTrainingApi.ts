import type {db as database} from "./localDb";
import yaml from "js-yaml";
import type {Bootstrap,Problem,StudyUpdate,Attempt} from "./types.ts";
import {deriveTransferTrainingCandidates,generationMetaKey,generationPrompt,validationPrompt,
  acceptGenerationDraft,acceptGenerationValidation,registerGeneratedProblem,blindGeneratedView,
  type TransferGenerationRecord} from "./generatedTransfer.ts";
import {EXAM_REFERENCE_PACK_META_KEY,EXAM_REFERENCE_EXPOSURE_META_KEY,type StoredExamReferencePack} from "./examReferencePack.ts";
import {buildInitialGradingContract} from "./gradingContract.ts";
import {buildFirstAttemptGradingPrompt} from "./gradingPrompt.ts";
import {parseStudyText} from "./importParser.ts";
import {deriveTransferEvidence} from "./skillEvidence.ts";

/** This is the existing offline GPT copy/paste interface, not a model API. */
export async function transferTrainingRequest(args:{db:typeof database;body:any;
  current:()=>Promise<Bootstrap>;save:(input:StudyUpdate&Record<string,unknown>)=>Promise<number>}){
  const {db,body}=args,key=String(body.key||""),action=String(body.action||"view");
  if(!key.startsWith("training:"))throw new Error("転移確認の計画キーが必要です");
  const [problems,attempts,answers,meta,exposure]=await Promise.all([db.problems.toArray(),db.attempts.toArray(),
    db.answerIndex.toArray(),db.meta.get(EXAM_REFERENCE_PACK_META_KEY),db.meta.get(EXAM_REFERENCE_EXPOSURE_META_KEY)]);
  if(!meta)throw new Error("canonical taxonomy未確認のため保留です");
  const candidates=deriveTransferTrainingCandidates({record:JSON.parse(meta.value) as StoredExamReferencePack,
    problems,attempts,answers,exposureOverrides:JSON.parse(exposure?.value||"{}")});
  const candidate=candidates.find(c=>c.key===key);
  let record:TransferGenerationRecord|undefined;
  const stored=await db.meta.get(generationMetaKey(key));if(stored)record=JSON.parse(stored.value);
  let problem=problems.find(p=>p.generated_transfer?.lineage.key===key);
  const source=problems.find(p=>p.problem_id===(candidate?.lineage.sourceProblemId||record?.lineage.sourceProblemId));
  const sourceFeatures=[source?.canonical_problem_type||"",source?.theme||"",...(source?.canonical_keywords||[])].filter(Boolean);
  const saveRecord=async()=>{if(record)await db.meta.put({key:generationMetaKey(key),value:JSON.stringify(record)});};
  if(action!=="view"&&!problem){
    if(!candidate)throw new Error("補修・遅延確認・taxonomy条件が未達、または確認済みです");
    const current=await args.current();
    if(!current.today.tasks.some(t=>t.transfer_training_key===key&&t.triage==="must"&&!t.checked))
      throw new Error("まだCanonical Study Planの実行対象ではありません");
    if(candidate.kind==="existing"){
      if(action!=="start")throw new Error("既存の転移確認問題を使用してください");
      await db.meta.put({key:`transfer-training-context:${candidate.existingProblemId}`,value:JSON.stringify(candidate.lineage)});
      return {status:"existing",existingProblemId:candidate.existingProblemId};
    }
  }
  if(action==="start"){
    if(!record&&!problem){record={key,lineage:candidate!.lineage,createdAt:new Date().toISOString(),status:"requested",rounds:[]};await saveRecord();}
    if(record?.status==="requested")return {status:record.status,prompt:generationPrompt(record,sourceFeatures)};
  }else if(action==="draft"){
    if(!record||problem)throw new Error("生成依頼がない、または登録済みです");
    record=await acceptGenerationDraft(record,String(body.text||""));await saveRecord();
    return {status:record.status,prompt:validationPrompt(record,sourceFeatures)};
  }else if(action==="validation-prompt"){
    if(!record||problem)throw new Error("検証待ちdraftがありません");
    return {status:record.status,prompt:validationPrompt(record,sourceFeatures)};
  }else if(action==="validate"){
    if(!record||problem)throw new Error("登録済み内容は変更できません");
    record=acceptGenerationValidation(record,String(body.text||""));
    if(record.status==="validation_pending"){
      problem=registerGeneratedProblem(record,`GEN-${crypto.randomUUID().toUpperCase()}`,new Date().toISOString());
      record={...record,status:"registered",problemId:problem.problem_id};
      await db.transaction("rw",[db.problems,db.meta],async()=>{await db.problems.add(problem!);await saveRecord();});
    }else await saveRecord();
  }else if(action==="submit"){
    const content=problem?.generated_transfer;
    if(!content||content.answer_submission)throw new Error("問題未登録、または答案提出済みです");
    const text=String(body.answer||"").trim(),minutes=Number(body.minutes),referenceLevel=Number(body.referenceLevel);
    if(!text||!Number.isFinite(minutes)||minutes<=0||minutes>180||!Number.isInteger(referenceLevel)||referenceLevel<0||referenceLevel>5)
      throw new Error("答案・実時間・参照段階を確認してください");
    problem={...problem!,generated_transfer:{...content,lifecycle_status:"submitted",answer_submission:{text,minutes,referenceLevel,submittedAt:new Date().toISOString()}}};
    await db.problems.put(problem);
  }else if(action==="grading-prompt"){
    const content=problem?.generated_transfer,submission=content?.answer_submission;
    if(!content||!submission)throw new Error("先に参照状況と答案を確定してください");
    const contract=buildInitialGradingContract({problem:problem!,mode:"full"});
    return {status:"submitted",prompt:buildFirstAttemptGradingPrompt({problemId:problem!.problem_id,mode:"full",gradingContract:contract})+
      `\n問題・検証済み解答・rubric・確定答案：\n${JSON.stringify({problem:content.problem_text,solution:content.reference_solution,rubric:content.grading_rubric,submission})}`+
      `\n出力はJSONのstudy_updateを1件。actual_reference_level=${submission.referenceLevel}、time_minutes=${submission.minutes}。`+
      `\nstudy_update内にtarget_skill_assessment: {self_selected:boolean,major_calculation_success:boolean,no_major_error:boolean,evidence:string}を必ず含める。`+
      `対象=${content.root_skill_id}。総合点とは独立に、初手と主要計算の実答案から判定。target外minorでは対象失敗にしない。模範解答の内容を本人の答案と混同しない。`};
  }else if(action==="grade"){
    if(!problem?.generated_transfer?.answer_submission)throw new Error("答案未提出です");
    const raw=JSON.parse(String(body.text||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
    const parsed=parseStudyText(yaml.dump(raw),problems,answers,await db.problemAliases.toArray());
    if(parsed.updates.length!==1||parsed.updates[0].problem_id!==problem.problem_id)throw new Error("この問題の採点1件だけを保存してください");
    await args.save({...parsed.updates[0],target_skill_assessment:raw.study_update?.target_skill_assessment,
      submission_id:`generated:${problem.problem_id}`});
    problem=await db.problems.get(problem.problem_id);
  }else if(action!=="view"&&action!=="start")throw new Error("不明な転移確認操作です");
  const content=problem?.generated_transfer;
  const result:Record<string,unknown>={status:content?.lifecycle_status||record?.status||candidate?.kind||"pending",
    problem:problem?blindGeneratedView(problem):undefined,existingProblemId:candidate?.existingProblemId,
    rounds:record?.rounds.length||0,pendingReason:record?.pendingReason};
  if(content?.answer_submission){
    const facts=await db.attempts.toArray();
    const attempt=facts.find(a=>a.problem_id===problem!.problem_id&&!a.exclude_from_metrics);
    result.afterSubmission={rootSkillId:content.root_skill_id,sourceProblemId:content.lineage.sourceProblemId,
      result:attempt?(deriveTransferEvidence(facts).some(r=>r.successAttemptId===attempt.id)?"training transfer success":"training transfer failure"):"採点待ち",
      evidence:attempt?.target_skill_assessment?.evidence||"",solution:content.reference_solution,rubric:content.grading_rubric};
  }
  return result;
}

export function generatedAttemptFields(problem:Problem,input:Record<string,unknown>){
  const c=problem.generated_transfer,s=c?.answer_submission;
  if(!c||!s)throw new Error("生成問題はblind答案を提出してから採点してください");
  const target=input.target_skill_assessment as Attempt["target_skill_assessment"];
  if(!target||[target.self_selected,target.major_calculation_success,target.no_major_error].some(v=>typeof v!=="boolean")||!target.evidence?.trim())
    throw new Error("target skillの独立採点が必要です");
  return {source_type:"generated" as const,evidence_strength:"training" as const,target_skill_prompted:false,
    source_problem_id:c.lineage.sourceProblemId,
    target_skill_assessment:target,transfer_lineage:c.lineage,exam_score_eligible:false,
    learning_purpose:"transfer_check" as const,learning_stage:"transfer" as const,
    actual_reference_level:Math.max(s.referenceLevel,Number(input.actual_reference_level??input.reference_level??0)),time_minutes:s.minutes,exam_score:null};
}
