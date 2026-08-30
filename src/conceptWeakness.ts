import type {
  Attempt, ConceptWeaknessInsight, GradingErrorType, PastExamRepairCandidate,
  PastSession, Problem, Review, WeakNote
} from "./types.ts";
import type { StoredExamReferencePack } from "./examReferencePack.ts";
import { canonicalPastExamProblemId } from "./examReferencePack.ts";
import { excludeLegacyKFromPlanning } from "./legacyKPolicy.ts";
import { reviewExecutionState } from "./integrityEngine.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";

type ConceptMapping={conceptIds:string[];confidence:"verified"|"candidate"};
type EvidenceEvent={
  conceptId:string;date:string;problemId:string;context:string;failed:boolean;successful:boolean;
  strong:boolean;referenceFree:boolean;mappingConfidence:"verified"|"candidate";pastExam:boolean;timed:boolean;
};

const unique=<T,>(values:T[])=>[...new Set(values)];
const successMark=(attempt:Attempt)=>["◎","○"].includes(attempt.mark)||Number(attempt.score_numeric||0)>=60;
const errorValues=(attempt:Attempt)=>{
  const values=unique([...(attempt.effective_error_types||attempt.error_types||[]),attempt.primary_error_type||attempt.error_type||""]
    .filter((value):value is string=>["K","W","N","C"].includes(value)));
  return values.filter(value=>!(value==="K"&&excludeLegacyKFromPlanning(attempt))) as GradingErrorType[];
};
const attemptContext=(attempt:Attempt,problem?:Problem)=>{
  if(attempt.assessment_timing==="same_session_correction")return "same_session";
  if(attempt.mode==="check"||attempt.review_scope==="check_only")return "check";
  if(attempt.parent_past_session_id||problem?.category==="past_exam")return "past_exam";
  if(attempt.exam_score_eligible||["full","exam_90min","past_exam"].includes(attempt.mode))return "timed";
  if(attempt.assessment_timing==="delayed_retrieval")return "delayed";
  return "standard";
};

export function buildConceptMappings(record?:StoredExamReferencePack|null){
  const mappings=new Map<string,ConceptMapping>();
  if(!record)return mappings;
  const conceptsByPast=new Map(record.data.pastExamProblems.map(problem=>[
    canonicalPastExamProblemId(problem),problem.fine_concept_ids
  ]));
  for(const [problemId,conceptIds] of conceptsByPast)mappings.set(problemId,{conceptIds,confidence:"verified"});
  for(const link of record.data.whitebookLinks){
    if(link.reconciliation_status==="unresolved"||!link.resolved_whitebook_problem_id)continue;
    const concepts=conceptsByPast.get(canonicalPastExamProblemId(link.past_exam_problem_id))||[];
    if(!concepts.length)continue;
    const current=mappings.get(link.resolved_whitebook_problem_id);
    mappings.set(link.resolved_whitebook_problem_id,{
      conceptIds:unique([...(current?.conceptIds||[]),...concepts]),
      confidence:current?.confidence==="verified"?"verified":"candidate"
    });
  }
  return mappings;
}

function evidenceEvents(args:{
  record?:StoredExamReferencePack|null;problems:Problem[];attempts:Attempt[];
}){
  const mappings=buildConceptMappings(args.record);
  const problems=new Map(args.problems.map(problem=>[problem.problem_id,problem]));
  const byKey=new Map<string,EvidenceEvent>();
  const sorted=[...args.attempts].filter(attempt=>!attempt.exclude_from_metrics&&!attempt.duplicate_of_attempt_id)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
  for(const attempt of sorted){
    const canonicalId=canonicalPastExamProblemId(attempt.problem_id);
    const mapping=mappings.get(canonicalId)||mappings.get(attempt.problem_id);
    if(!mapping?.conceptIds.length)continue;
    const problem=problems.get(canonicalId)||problems.get(attempt.problem_id);
    const errors=errorValues(attempt),context=attemptContext(attempt,problem);
    const referenceFree=Number(attempt.actual_reference_level??attempt.reference_level??0)===0&&!attempt.hint_used;
    const failed=errors.length>0||["△","×"].includes(attempt.mark);
    const successful=!failed&&successMark(attempt);
    const timed=context==="timed"||context==="past_exam",strongContext=referenceFree&&
      !["same_session","check"].includes(context)&&attempt.policy_validity!=="invalid_legacy_k";
    for(const conceptId of mapping.conceptIds){
      const key=[conceptId,attempt.date,canonicalId,context].join("|");
      const event:EvidenceEvent={conceptId,date:attempt.date,problemId:canonicalId,context,failed,successful,
        strong:strongContext&&mapping.confidence==="verified",referenceFree,mappingConfidence:mapping.confidence,
        pastExam:context==="past_exam",timed};
      const old=byKey.get(key);
      if(!old||(!old.failed&&event.failed)||(!old.strong&&event.strong))byKey.set(key,event);
    }
  }
  return [...byKey.values()];
}

function conceptExamValue(record:StoredExamReferencePack,conceptId:string){
  const years=unique(record.data.pastExamProblems.filter(problem=>problem.schedulable&&problem.fine_concept_ids.includes(conceptId)).map(problem=>problem.year));
  const recent=years.filter(year=>year>=2023);
  return {years:years.length,recent:recent.length,
    importance:Math.min(100,Math.round((years.length/6*.7+recent.length/3*.3)*100))};
}

export function analyzeConceptWeaknesses(args:{
  record?:StoredExamReferencePack|null;problems:Problem[];attempts:Attempt[];reviews:Review[];
  weakNotes:WeakNote[];today:string;
}):ConceptWeaknessInsight[]{
  if(!args.record)return [];
  const events=evidenceEvents(args),byConcept=new Map<string,EvidenceEvent[]>();
  for(const event of events)byConcept.set(event.conceptId,[...(byConcept.get(event.conceptId)||[]),event]);
  const conceptMap=new Map(args.record.data.concepts.map(concept=>[concept.concept_id,concept]));
  const mappings=buildConceptMappings(args.record);
  const activeRepairProblems=new Set(args.reviews.filter(review=>reviewExecutionState(review,args.today)==="actionable"&&
    review.learning_purpose==="error_repair").map(review=>review.problem_id));
  const results:ConceptWeaknessInsight[]=[];
  for(const concept of args.record.data.concepts){
    const rows=[...(byConcept.get(concept.concept_id)||[])].sort((a,b)=>a.date.localeCompare(b.date));
    const failures=rows.filter(row=>row.failed),successes=rows.filter(row=>row.successful);
    const verifiedRows=rows.filter(row=>row.mappingConfidence==="verified");
    const strongFailures=failures.filter(row=>row.strong).length;
    const weakFailures=failures.length-strongFailures;
    const distinctFailureProblems=unique(failures.map(row=>row.problemId));
    const distinctFailureDates=unique(failures.map(row=>row.date));
    const pastExamFailures=failures.filter(row=>row.pastExam);
    const pastExamFailureYears=unique(pastExamFailures
      .map(row=>row.problemId.match(/(?:^|[-_])((?:19|20)\d{2})(?:[-_]|$)/)?.[1]).filter(Boolean));
    let state:ConceptWeaknessInsight["state"]="unassessed",lastFailureDate="";
    let resolvedOnce=false;
    for(const row of rows){
      if(row.failed){
        if(row.strong&&state==="resolved"){state="relapsed";resolvedOnce=true}
        else if(row.strong)state="confirmed";
        else if(state==="unassessed")state="suspected";
        lastFailureDate=row.date;
      }else if(row.successful&&lastFailureDate&&row.date>lastFailureDate&&row.strong){
        const after=successes.filter(item=>item.strong&&item.date>lastFailureDate&&item.date<=row.date);
        const transfer=unique(after.map(item=>item.problemId)).length>=2||after.some(item=>item.pastExam);
        if(after.length>=2&&transfer)state="resolved";else if(["confirmed","repairing","relapsed","transfer_pending"].includes(state))state="transfer_pending";
      }
    }
    if(state==="confirmed"&&[...activeRepairProblems].some(problemId=>mappings.get(problemId)?.conceptIds.includes(concept.concept_id)))state="repairing";
    if(!verifiedRows.length&&failures.length)state="suspected";
    const delayedNoReferenceSuccesses=successes.filter(row=>row.strong&&row.referenceFree&&row.context!=="same_session").length;
    const transferSuccesses=unique(successes.filter(row=>row.strong&&lastFailureDate&&row.date>lastFailureDate)
      .map(row=>row.problemId)).length;
    const failureRate=rows.length?failures.length/rows.length:null;
    const exam=conceptExamValue(args.record,concept.concept_id);
    const normalizedFailure=rows.length?(failures.length+1)/(rows.length+2):0;
    const recurrence=Math.max(0,unique(failures.map(row=>`${row.date}|${row.problemId}`)).length-1);
    let weaknessScore=Math.round(Math.min(100,normalizedFailure*65+Math.min(20,strongFailures*8)+Math.min(15,recurrence*5)));
    if(state==="resolved")weaknessScore=Math.round(weaknessScore*.25);
    if(state==="relapsed"||resolvedOnce&&failures.length)weaknessScore=Math.min(100,weaknessScore+15);
    const estimatedRepairMinutes=15;
    const priorityScore=Math.round(weaknessScore*(.45+exam.importance/100*.55)/estimatedRepairMinutes*10);
    const rawNotes=args.weakNotes.filter(note=>{
      const mapping=mappings.get(note.problem_id);return mapping?.conceptIds.includes(concept.concept_id);
    }).length;
    const evidenceConfidence:ConceptWeaknessInsight["evidenceConfidence"]=
      strongFailures>=2&&distinctFailureDates.length>=2?"high":strongFailures?"medium":"low";
    const nextRecommendedAction=state==="unassessed"||state==="suspected"
      ?"参照なしの別日診断で、弱点かどうかを確認する"
      :state==="transfer_pending"?"別問題または過去問実答案で転移を確認する"
      :state==="resolved"?"低頻度の維持確認に留める"
      :state==="repairing"?"現在の局所補修を完了し、遅延確認へ進む"
      :"最も得点波及の大きい1点だけを補修する";
    results.push({conceptId:concept.concept_id,displayName:concept.display_name,state,
      independentOpportunities:rows.length,independentFailures:failures.length,
      failureRate:failureRate==null?null:Math.round(failureRate*100),strongFailures,weakFailures,
      delayedNoReferenceSuccesses,transferSuccesses,distinctProblemCount:distinctFailureProblems.length,
      distinctFailureDateCount:distinctFailureDates.length,recurrenceCount:recurrence,
      examYearCount:exam.years,examOccurrenceYearCount:exam.years,
      pastExamFailureCount:pastExamFailures.length,pastExamFailureYearCount:pastExamFailureYears.length,
      recentExamYearCount:exam.recent,
      examImportance:exam.importance,weaknessScore,priorityScore,estimatedRepairMinutes,
      mappingConfidence:verifiedRows.length?"verified":"candidate",evidenceConfidence,nextRecommendedAction,
      latestEvidenceDate:rows.at(-1)?.date||null,evidenceSummary:[
        rows.length?`履歴由来の暫定失敗 ${failures.length}/${rows.length}`:"独立した答案証拠なし",
        strongFailures?`強い失敗証拠 ${strongFailures}回`:"強い失敗証拠なし",
        delayedNoReferenceSuccesses?`参照なし遅延成功 ${delayedNoReferenceSuccesses}回`:"参照なし遅延成功なし",
        rawNotes?`raw weakNote ${rawNotes}件（順位計算には未使用）`:"raw weakNoteなし"
      ]});
  }
  return results.sort((a,b)=>b.priorityScore-a.priorityScore||b.weaknessScore-a.weaknessScore||
    a.displayName.localeCompare(b.displayName,"ja"));
}

export function buildPastExamRepairCandidates(args:{
  record?:StoredExamReferencePack|null;sessions:PastSession[];attempts:Attempt[];
  conceptWeaknesses:ConceptWeaknessInsight[];problems?:Problem[];
}):PastExamRepairCandidate[]{
  if(!args.record)return [];
  const references=new Map(args.record.data.pastExamProblems.map(problem=>[canonicalPastExamProblemId(problem),problem]));
  const linksByPast=new Map<string,string[]>();
  for(const link of args.record.data.whitebookLinks){
    if(!link.resolved_whitebook_problem_id||link.reconciliation_status==="unresolved")continue;
    const key=canonicalPastExamProblemId(link.past_exam_problem_id);
    linksByPast.set(key,unique([...(linksByPast.get(key)||[]),link.resolved_whitebook_problem_id]));
  }
  const weakness=new Map(args.conceptWeaknesses.map(row=>[row.conceptId,row]));
  const candidates:PastExamRepairCandidate[]=[];
  for(const session of args.sessions){
    if(session.session_kind==="scan_only")continue;
    const linked=new Set((session.linked_attempt_ids||[]).map(Number));
    const attempts=args.attempts.filter(attempt=>linked.has(attempt.id)||attempt.parent_past_session_id===session.id);
    for(const attempt of attempts){
      if(!errorValues(attempt).length)continue;
      const sourceProblemId=canonicalPastExamProblemId(attempt.problem_id);
      const reference=references.get(sourceProblemId);
      if(!reference)continue;
      const ranked=reference.fine_concept_ids.map(conceptId=>weakness.get(conceptId))
        .filter((row):row is ConceptWeaknessInsight=>!!row)
        .sort((a,b)=>b.priorityScore-a.priorityScore).slice(0,2);
      const recurrence=Math.max(0,...ranked.map(row=>row.recurrenceCount));
      const episode=deriveFailureEpisode(attempt,{recurrenceByRoot:Object.fromEntries(
        (attempt.grading_contract?.gradedParts||[]).map(part=>[part.rootCauseKey||part.stableTargetKey||part.id,recurrence]))});
      for(const root of episode.rootWeaknesses.slice(0,2)){
        const explicitRow=ranked.find(candidate=>root.skillIds.includes(candidate.conceptId));
        const row=explicitRow||(ranked.length===1?ranked[0]:undefined);
        const conceptId=row?.conceptId||root.skillIds[0]||root.rootWeaknessId;
        const linkedWhitebook=(row?linksByPast.get(sourceProblemId)||[]:[]).filter(problemId=>{
          const problem=args.problems?.find(item=>item.problem_id===problemId);
          return !!problem?.fine_concept_ids?.includes(row!.conceptId);
        }).slice(0,2);
        const matchConfidence:PastExamRepairCandidate["matchConfidence"]=linkedWhitebook.length?"high":"low";
        const required=root.requiredRepair;
        const transfer=row?args.record.data.pastExamProblems.filter(problem=>problem.schedulable&&
          canonicalPastExamProblemId(problem)!==sourceProblemId&&problem.fine_concept_ids.includes(row.conceptId))
          .map(canonicalPastExamProblemId).slice(0,3):[];
        candidates.push({sessionId:session.id,sourceAttemptId:attempt.id,sourceProblemId,
          sourceFindingId:root.sourceFindingIds[0],sourceFindingIds:root.sourceFindingIds,
          rootWeaknessId:root.rootWeaknessId,conceptId,conceptLabel:root.title,
          materiality:root.materiality,recurrence:root.recurrence,examImpact:root.examImpact,required,
          whitebookProblemIds:linkedWhitebook,transferProblemIds:transfer,
          weaknessSkillIds:unique([...root.skillIds,...(row?[row.conceptId]:[])]),matchedSkillIds:linkedWhitebook.length&&row?[row.conceptId]:[],
          matchScore:linkedWhitebook.length?100:0,matchConfidence,repairKind:linkedWhitebook.length?"whitebook":"concept_mini",
          matchReason:linkedWhitebook.length?`fine concept「${row!.displayName}」と検証済みsolution linkが一致`:
            `exact skill/operation一致の白本がないため、${sourceProblemId}の該当部分を局所補修`,
          reason:root.requiredRepair?`過去問 ${sourceProblemId} の本番得点を変える${root.errorTypes.join("/")} rootを最小補修`:
            `単発の${root.errorTypes.join("/")}は必須化せず任意確認`,
          requiresUserConfirmation:true});
      }
    }
  }
  const dedup=new Map<string,PastExamRepairCandidate>();
  for(const row of candidates){
    const key=`${row.sessionId}|${row.sourceProblemId}|${row.rootWeaknessId||row.conceptId}`;
    if(!dedup.has(key)&&[...dedup.values()].filter(item=>item.sessionId===row.sessionId).length<2)dedup.set(key,row);
  }
  return [...dedup.values()];
}

export function mappedConceptIdsForProblem(record:StoredExamReferencePack|undefined|null,problemId:string){
  return buildConceptMappings(record).get(canonicalPastExamProblemId(problemId))?.conceptIds||[];
}
