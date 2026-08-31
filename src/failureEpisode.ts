import type {Attempt,FailureEpisode,GradedFinding,GradingErrorType,RootWeakness} from "./types.ts";
import {planningEligibleFindings,planningErrorsForSource} from "./legacyKPolicy.ts";

const unique=<T,>(values:T[])=>[...new Set(values)];
const stableHash=(value:string)=>[...value].reduce((hash,char)=>Math.imul(hash^char.charCodeAt(0),16777619)>>>0,2166136261).toString(16).padStart(8,"0");

type FindingEvidence={
  findingId:string;rootKey:string;errorType:GradingErrorType;evidence:string;title:string;
  masteryLevel:1|2|3;explicitMajor:boolean;confidence:"low"|"medium"|"high";skillIds:string[];
};

function findingEvidence(attempt:Attempt):FindingEvidence[]{
  const parts=new Map((attempt.grading_contract?.gradedParts||[]).map(part=>[part.id,part]));
  const structured=planningEligibleFindings(attempt).map((finding:GradedFinding)=>{
    const part=parts.get(finding.graded_part_id);
    const stable=part?.stableTargetKey||part?.stable_target_key;
    return {findingId:finding.graded_part_id,rootKey:part?.rootCauseKey||stable||finding.graded_part_id,
      errorType:finding.error_type,evidence:finding.evidence||"",title:part?.currentLabel||part?.label||attempt.error_point||finding.graded_part_id,
      masteryLevel:part?.masteryLevel||(finding.error_type==="K"?1:2),explicitMajor:false,confidence:"high" as const,
      skillIds:[part?.rootCauseKey||stable||""].filter(Boolean)};
  });
  const observed=(attempt.observed_out_of_scope_findings||[]).filter(finding=>finding.create_target_candidate&&
    finding.materiality==="major"&&finding.confidence!=="low").map((finding,index)=>({
      findingId:finding.finding_id||finding.stable_target_key||`observed:${index+1}`,
      rootKey:finding.root_cause_key||finding.stable_target_key||finding.finding_id||`observed:${index+1}`,
      errorType:(finding.mastery_level===1?"K":finding.mastery_level===2?"W":"N") as GradingErrorType,
      evidence:finding.evidence,title:finding.finding,masteryLevel:finding.mastery_level,
      explicitMajor:true,confidence:finding.confidence,skillIds:[finding.root_cause_key||""].filter(Boolean),
    }));
  if(structured.length||observed.length)return [...structured,...observed];
  const errors=planningErrorsForSource(attempt) as GradingErrorType[];
  if(!errors.length)return [];
  const description=String(attempt.error_point||attempt.result_summary||attempt.next_action||`${errors.join("/")} error`);
  return [{findingId:`attempt:${attempt.id}:legacy`,rootKey:`legacy:${stableHash(description)}`,
    errorType:errors[0],evidence:description,title:description,
    masteryLevel:errors.includes("K")?1:2,explicitMajor:false,confidence:"medium",skillIds:[]}];
}

/**
 * Converts one assessed answer into learning-sized failure roots. Grouping is
 * based only on explicit contract/root identity; it never fuzzy-splits prose.
 */
export function deriveFailureEpisode(attempt:Attempt,args:{recurrenceByRoot?:Record<string,number>}={}):FailureEpisode{
  const grouped=new Map<string,FindingEvidence[]>();
  for(const row of findingEvidence(attempt))grouped.set(row.rootKey,[...(grouped.get(row.rootKey)||[]),row]);
  const roots:RootWeakness[]=[...grouped].map(([rootKey,rows])=>{
    const errorTypes=unique(rows.map(row=>row.errorType));
    const recurrence=Number(args.recurrenceByRoot?.[rootKey]||0);
    const isolatedC=errorTypes.length===1&&errorTypes[0]==="C"&&recurrence===0;
    const major=rows.some(row=>row.explicitMajor)||errorTypes.some(error=>["K","W"].includes(error))||
      (!isolatedC&&attempt.review_outcome==="failed")||(!isolatedC&&attempt.conclusion_reached===false)||
      (!isolatedC&&attempt.minimum_pass_condition_met===false)||
      (errorTypes.includes("N")&&Number(attempt.score_numeric??100)<70)||recurrence>0;
    const masteryLevel=Math.min(...rows.map(row=>row.masteryLevel)) as 1|2|3;
    const confidence=rows.every(row=>row.confidence==="high")?"high":rows.some(row=>row.confidence!=="low")?"medium":"low";
    const title=rows[0].title;
    return {rootWeaknessId:`root:${attempt.problem_id}:${stableHash(rootKey)}`,sourceAttemptId:attempt.id,
      sourceProblemId:attempt.problem_id,sourceFindingIds:rows.map(row=>row.findingId),masteryLevel,
      errorTypes,title,description:unique(rows.map(row=>row.evidence).filter(Boolean)).join(" / ")||title,
      materiality:major?"major":"minor",examImpact:major?"high":"low",recurrence,confidence,
      unresolved:true,requiredRepair:major&&confidence!=="low",skillIds:unique(rows.flatMap(row=>row.skillIds))};
  });
  return {episodeId:`failure:${attempt.problem_id}:${attempt.id}`,sourceAttemptId:attempt.id,
    sourceProblemId:attempt.problem_id,rootWeaknesses:roots};
}
