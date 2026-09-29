import type {Attempt,Problem,RootWeakness,AnswerIndexEntry,PastSession} from "./types.ts";
import type {StoredExamReferencePack} from "./examReferencePack.ts";
import {canonicalPastExamProblemId} from "./examReferencePack.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";
import {findingSkillIds,successfulSkillIds,independentReferenceFree,confidentGrading,problemSkillIds} from "./skillEvidence.ts";
import {groundedWhitebookSkills,matchesFailureOperation} from "./groundedSkills.ts";

export type TransferTrainingLineage={
  key:string;rootWeaknessId:string;rootSkillId:string;sourceProblemId:string;sourceAttemptId:number;
  sourceFindingIds:string[];repairAttemptId:number;retrievalAttemptId:number;
  matchConfidence:"high";observedFailure:string;successCriteria:string;examImpact:"low"|"medium"|"high";
};
export type TransferTrainingCandidate={
  key:string;lineage:TransferTrainingLineage;kind:"existing"|"generated"|"pending";
  existingProblemId?:string;generatedProblemId?:string;reason:string;
};
export type GeneratedDraft={problem_text:string;reference_solution:string;grading_rubric:string;
  difficulty:"統計検定1級";estimated_minutes:number;surface_features:string[];generator_pass_id:string};
export const GENERATION_CHECKS=["well_defined","solution_correct","rubric_aligned","skill_necessary",
  "no_shortcut","surface_distinct","skill_hidden","exam_appropriate","bounded_work"] as const;
export type GenerationValidation={draft_hash:string;validator_pass_id:string;
  checks:Record<typeof GENERATION_CHECKS[number],{pass:boolean;evidence:string}>};
export type GeneratedTransferContent=GeneratedDraft&{
  generation_purpose:"transfer_check";problem_text:string;reference_solution:string;grading_rubric:string;
  root_skill_id:string;lineage:TransferTrainingLineage;difficulty:string;estimated_minutes:number;
  exam_score_eligible:false;transfer_eligible:true;evidence_strength:"training";
  validation:GenerationValidation;content_hash:string;created_at:string;
  lifecycle_status:"ready"|"submitted"|"graded";answer_submission?:{text:string;minutes:number;referenceLevel:number;submittedAt:string};
};
export type TransferGenerationRecord={key:string;lineage:TransferTrainingLineage;createdAt:string;
  status:"requested"|"validation_pending"|"registered"|"pending";
  rounds:Array<{draft:GeneratedDraft;hash:string;validation?:GenerationValidation}>;problemId?:string;pendingReason?:string};
const unique=(a:string[])=>[...new Set(a)];
export const generationMetaKey=(key:string)=>`transfer-generation:${key}`;
export const trainingKey=(skill:string)=>`training:${skill}`;

/** Existing canonical taxonomy is the allow-list. No free-form GPT skill IDs. */
export function canonicalTrainingSkills(record:StoredExamReferencePack){
  return new Set(record.data.concepts.filter(c=>["active","verified"].includes(c.status)&&c.source_confidence==="high").map(c=>c.concept_id));
}
export function delayedTrainingPrerequisites(source:Attempt,root:RootWeakness,attempts:Attempt[]){
  const sourceTargets=new Set((source.grading_contract?.gradedParts||[])
    .filter(part=>root.sourceFindingIds.includes(part.id))
    .map(part=>part.stableTargetKey||part.stable_target_key||part.id));
  const targetFindings=(a:Attempt)=>{
    const parts=new Map((a.grading_contract?.gradedParts||[]).map(part=>[part.id,part]));
    return (a.graded_findings||[]).filter(f=>{
      const part=parts.get(f.graded_part_id);
      return !!part&&sourceTargets.has(part.stableTargetKey||part.stable_target_key||part.id);
    });
  };
  // A successful graded reproduction of the exact stable target is evidence
  // even when its feedback does not repeat the mathematical operation's name.
  const relevant=(a:Attempt)=>root.skillIds.length>0&&sourceTargets.size>0&&
    targetFindings(a).length===sourceTargets.size&&
    targetFindings(a).every(f=>f.resolved&&f.error_type==="none");
  let repair:Attempt|undefined,retrieval:Attempt|undefined;
  for(const a of attempts.filter(a=>a.id>source.id&&a.problem_id===source.problem_id&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id).sort((a,b)=>a.id-b.id)){
    const failed=targetFindings(a).some(f=>!f.resolved&&f.error_type!=="none");
    if(failed){repair=undefined;retrieval=undefined;continue;}
    if(!relevant(a)||!independentReferenceFree(a)||!confidentGrading(a))continue;
    if(a.learning_purpose==="error_repair"){repair=a;retrieval=undefined;}
    else if(repair&&a.learning_purpose==="retrieval_check"&&a.date>repair.date&&a.assessment_timing==="delayed_retrieval")retrieval=a;
  }
  return {repair,retrieval};
}

export function deriveTransferTrainingCandidates(args:{record:StoredExamReferencePack;attempts:Attempt[];problems:Problem[];
  answers?:AnswerIndexEntry[];exposureOverrides?:Record<string,string>;generationStates?:Record<string,string>;
  pastSessions?:PastSession[]}):TransferTrainingCandidate[]{
  const allowed=canonicalTrainingSkills(args.record),candidates=new Map<string,TransferTrainingCandidate>();
  const references=new Map(args.record.data.pastExamProblems.map(p=>[canonicalPastExamProblemId(p),p]));
  for(const source of [...args.attempts].sort((a,b)=>b.id-a.id)){
    if(!references.has(source.problem_id)||source.exclude_from_metrics||source.duplicate_of_attempt_id)continue;
    for(const root of deriveFailureEpisode(source).rootWeaknesses){
      if(!root.requiredRepair||root.confidence==="low"||!root.skillIds.length||root.skillIds.some(s=>!allowed.has(s)))continue;
      const {repair,retrieval}=delayedTrainingPrerequisites(source,root,args.attempts);
      if(!repair||!retrieval)continue;
      for(const skill of root.skillIds){
        const key=trainingKey(skill);if(candidates.has(key))continue;
        // One independent training question per skill. A failed training attempt
        // returns to diagnosis, not an automatic stream of generated problems.
        const prior=args.problems.find(p=>p.generated_transfer?.lineage.key===key);
        const graded=prior&&args.attempts.some(a=>a.problem_id===prior.problem_id&&!a.exclude_from_metrics);
        if(graded)continue;
        const alreadyUsed=args.attempts.some(a=>a.id>retrieval.id&&a.problem_id!==source.problem_id&&
          a.learning_purpose!=="error_repair"&&successfulSkillIds(a).includes(skill));
        if(alreadyUsed)continue;
        const lineage:TransferTrainingLineage={key,rootWeaknessId:root.rootWeaknessId,rootSkillId:skill,
          sourceProblemId:source.problem_id,sourceAttemptId:source.id,sourceFindingIds:root.sourceFindingIds,
          repairAttemptId:repair.id,retrievalAttemptId:retrieval.id,matchConfidence:"high",observedFailure:root.description,
          successCriteria:root.title,examImpact:root.examImpact};
        const existing=args.problems.filter(p=>p.problem_id!==source.problem_id&&p.source_type!=="generated"&&
          p.schedulable!==false&&p.gradable!==false&&p.metadata_status!=="review_needed"&&
          !p.simulation_protection_default&&!references.get(p.problem_id)?.simulation_protection_default&&
          ![2024,2025].includes(Number(p.problem_id.match(/^PY-(\d{4})/)?.[1]))&&
          !args.attempts.some(a=>a.problem_id===p.problem_id)&&
          !["answer_exposed","unknown"].includes(args.exposureOverrides?.[p.problem_id]||"")&&
          matchesFailureOperation(root.description,skill,p,args.answers)&&
          (groundedWhitebookSkills(p,args.answers).some(t=>t.skillId===skill&&t.confidence==="high")||
            (p.classification_confidence==="high"&&problemSkillIds(p).includes(skill))||
            (references.get(p.problem_id)?.classification_confidence==="high"&&references.get(p.problem_id)?.fine_concept_ids.includes(skill))))
          .sort((a,b)=>Number(b.source_type==="past_exam")-Number(a.source_type==="past_exam")||
            Number(b.source_type==="whitebook")-Number(a.source_type==="whitebook")||a.problem_id.localeCompare(b.problem_id));
        const benchmarkComplete=args.pastSessions?.some(s=>s.year===2024&&s.session_kind==="selected_three_timed"&&
          (!!s.simulation_completed_at||s.session_state==="completed"));
        const repeatedFailure=args.attempts.filter(a=>a.problem_id===source.problem_id&&a.id<=source.id&&
          deriveFailureEpisode(a).rootWeaknesses.some(r=>r.rootWeaknessId===root.rootWeaknessId&&r.requiredRepair)).length>=2;
        const generationDeferred=!!args.pastSessions&&!benchmarkComplete&&!repeatedFailure;
        candidates.set(key,{key,lineage,kind:prior?"generated":existing.length?"existing":
          generationDeferred||args.generationStates?.[key]==="pending"?"pending":"generated",
          generatedProblemId:prior?.problem_id,existingProblemId:prior?undefined:existing[0]?.problem_id,
          reason:prior?"検証済みの同じ生成問題を継続":existing.length?"明示skillが一致する既存問題を優先":
            generationDeferred?"2022/2024の本番測定を先に使い、別問題候補がないrootの生成はその後に再評価":
            "補修・遅延確認成功後の別問題確認。高信頼の既存候補がないため実行時に生成を依頼"});
      }
    }
  }
  return [...candidates.values()];
}

export async function contentHash(value:unknown){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function text(value:unknown,name:string,min=1,max=24000){
  if(typeof value!=="string"||value.trim().length<min||value.length>max)throw new Error(`${name}: 長さ・形式が不正です`);
  return value.trim();
}
function object(input:string){
  const raw=JSON.parse(input.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
  if(!raw||Array.isArray(raw)||typeof raw!=="object")throw new Error("JSON objectが必要です");
  return raw;
}
export async function acceptGenerationDraft(record:TransferGenerationRecord,input:string){
  if(record.status==="registered"||record.status==="validation_pending"||record.rounds.length>=2)throw new Error("再生成不可：検証待ち・登録済み、または上限2回です");
  const raw=object(input),minutes=Number(raw.estimated_minutes);
  if(raw.difficulty!=="統計検定1級"||!Number.isInteger(minutes)||minutes<10||minutes>15)throw new Error("難易度または10〜15分の時間制約が不正です");
  if(!Array.isArray(raw.surface_features)||raw.surface_features.length<2)throw new Error("文脈・記号の情報が必要です");
  const draft:GeneratedDraft={problem_text:text(raw.problem_text,"problem_text",30),reference_solution:text(raw.reference_solution,"reference_solution",30),
    grading_rubric:text(raw.grading_rubric,"grading_rubric",20),difficulty:raw.difficulty,estimated_minutes:minutes,
    surface_features:raw.surface_features.map((s:unknown)=>text(s,"surface feature",1,300)),generator_pass_id:text(raw.generator_pass_id,"generator_pass_id")};
  if(draft.problem_text.includes(record.lineage.rootSkillId)||draft.problem_text.includes(record.lineage.sourceProblemId))throw new Error("問題文にtarget/sourceを露出させないでください");
  const hash=await contentHash(draft);
  if(record.rounds.some(r=>r.hash===hash))throw new Error("同じdraftの再投入です");
  return {...record,status:"validation_pending" as const,rounds:[...record.rounds,{draft,hash}]};
}
export function acceptGenerationValidation(record:TransferGenerationRecord,input:string){
  if(record.status!=="validation_pending")throw new Error("先に生成passが必要です");
  const raw=object(input),round=record.rounds.at(-1)!;
  const validator=text(raw.validator_pass_id,"validator_pass_id");
  if(raw.draft_hash!==round.hash||validator===round.draft.generator_pass_id)throw new Error("検証対象hashまたは独立検証passが不正です");
  for(const key of GENERATION_CHECKS){
    if(typeof raw.checks?.[key]?.pass!=="boolean")throw new Error(`検証項目 ${key} が不足しています`);
    text(raw.checks[key].evidence,key,10,4000);
  }
  const validation:GenerationValidation={draft_hash:round.hash,validator_pass_id:validator,checks:raw.checks};
  const passed=GENERATION_CHECKS.every(key=>validation.checks[key].pass);
  return {...record,rounds:[...record.rounds.slice(0,-1),{...round,validation}],
    status:passed?"validation_pending" as const:record.rounds.length>=2?"pending" as const:"requested" as const,
    pendingReason:passed?undefined:"検証不合格。上限2回を超えた場合は保留。"};
}
export function registerGeneratedProblem(record:TransferGenerationRecord,id:string,now:string):Problem{
  const round=record.rounds.at(-1);
  if(record.status!=="validation_pending"||!round?.validation||!GENERATION_CHECKS.every(k=>round.validation!.checks[k].pass))throw new Error("独立検証PASS前は登録できません");
  if(!id.startsWith("GEN-"))throw new Error("generated identityが必要です");
  const label=`生成確認問題 ${id.slice(-8)}`;
  return {id:0,problem_id:id,source_type:"generated",category:"generated",chapter:null,problem_number:0,title:label,display_label:label,
    theme:"転移確認",priority:"repair",role:"training",recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",
    notes:"",completion_status:"active",schedulable:true,gradable:true,
    generated_transfer:{generation_purpose:"transfer_check",...round.draft,root_skill_id:record.lineage.rootSkillId,lineage:record.lineage,
      exam_score_eligible:false,transfer_eligible:true,evidence_strength:"training",validation:round.validation,
      content_hash:round.hash,created_at:now,lifecycle_status:"ready"}};
}
export function blindGeneratedView(problem:Problem){
  const c=problem.generated_transfer;if(!c)throw new Error("検証済み生成問題がありません");
  return {problem_id:problem.problem_id,display_label:problem.display_label,difficulty:c.difficulty,
    estimated_minutes:c.estimated_minutes,problem_text:c.problem_text};
}
export async function validateGeneratedContent(problem:Problem){
  const c=problem.generated_transfer;if(!c||problem.source_type!=="generated")throw new Error("generated content missing");
  const draft:GeneratedDraft={problem_text:c.problem_text,reference_solution:c.reference_solution,grading_rubric:c.grading_rubric,
    difficulty:c.difficulty,estimated_minutes:c.estimated_minutes,surface_features:c.surface_features,generator_pass_id:c.generator_pass_id};
  if(await contentHash(draft)!==c.content_hash||c.validation.draft_hash!==c.content_hash||
    c.validation.validator_pass_id===c.generator_pass_id||!GENERATION_CHECKS.every(k=>c.validation.checks[k]?.pass&&c.validation.checks[k]?.evidence?.length>=10)||
    !c.lineage.repairAttemptId||!c.lineage.retrievalAttemptId||c.lineage.rootSkillId!==c.root_skill_id||
    c.exam_score_eligible!==false||c.evidence_strength!=="training")throw new Error(`生成問題の不変content/検証/lineageが不正です: ${problem.problem_id}`);
}
export function generationPrompt(record:TransferGenerationRecord,sourceFeatures:string[]){
  return `転移確認問題の生成pass。解答者にtargetや解答を見せない運用です。元問題全文は与えません。新しい文脈・記号で、数字変更版を避けてください。\n`+
    JSON.stringify({lineage:record.lineage,target_difficulty:"統計検定1級",estimated_minutes:[10,15],forbidden_source_features:sourceFeatures})+
    `\ntargetを問題文で明示せず、その操作が主要解答に不可欠な問題を1問だけ生成。次のJSONだけ返す：`+
    JSON.stringify({problem_text:"...",reference_solution:"完全な導出",grading_rubric:"target選択・主要計算・major errorを独立採点する基準",difficulty:"統計検定1級",estimated_minutes:12,surface_features:["新文脈","新記号"],generator_pass_id:"unique generation pass id"});
}
export function validationPrompt(record:TransferGenerationRecord,sourceFeatures:string[]){
  const r=record.rounds.at(-1);if(record.status!=="validation_pending"||!r)throw new Error("検証するdraftがありません");
  return `生成時とは別の新しい会話で独立検証してください。生成者の正解主張を信用せず自分で解き直す。迂回解法、元問題の表面コピー、target露出も反証し、不確実なら不合格。検証だけ行い内容を変更しない。\n`+
    JSON.stringify({draft:r.draft,lineage:record.lineage,forbidden_source_features:sourceFeatures})+`\n結果JSON：`+
    JSON.stringify({draft_hash:r.hash,validator_pass_id:"distinct validation pass id",checks:Object.fromEntries(GENERATION_CHECKS.map(k=>[k,{pass:false,evidence:"独立した検算・反証の具体的根拠"}]))});
}
