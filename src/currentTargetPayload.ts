import type {Attempt,GradedFinding,GradedPartContract} from "./types.ts";

const text=(value:unknown)=>String(value||"").trim();

/**
 * Keeps the immutable part/stable identity while replacing its mutable payload
 * with the newest finding that explicitly graded this target.
 */
export function withCurrentFindingPayload(
  part:GradedPartContract,
  finding:GradedFinding,
  attempt:Attempt,
):GradedPartContract{
  const evidence=text(finding.evidence);
  const currentLabel=evidence||text(part.currentLabel)||part.label;
  const correction=text(attempt.next_action)||text(part.currentCorrection);
  return {
    ...part,
    label:currentLabel,
    currentLabel,
    currentEvidence:evidence,
    currentErrorType:finding.error_type,
    ...(correction?{currentCorrection:correction}:{}),
    evidenceSourceAttemptId:attempt.id,
    evidenceUpdatedAt:text(attempt.saved_at)||attempt.date,
  };
}

export function currentTargetPayloadMatches(left:GradedPartContract,right:GradedPartContract){
  if((text(left.currentLabel)||text(left.label))!==(text(right.currentLabel)||text(right.label)))return false;
  // Contracts created before current-payload provenance was introduced remain
  // compatible when their displayed label already equals the latest evidence.
  // Once a provenance field exists, however, it must agree with that evidence.
  const optionalMatches=(actual:unknown,expected:unknown,normalise:(value:unknown)=>unknown=text)=>{
    const present=actual!==undefined&&actual!==null&&String(actual).trim()!=="";
    return !present||normalise(actual)===normalise(expected);
  };
  return optionalMatches(left.currentEvidence,right.currentEvidence)&&
    optionalMatches(left.currentErrorType,right.currentErrorType,value=>String(value||""))&&
    optionalMatches(left.currentCorrection,right.currentCorrection)&&
    optionalMatches(left.evidenceSourceAttemptId,right.evidenceSourceAttemptId,value=>Number(value||0))&&
    optionalMatches(left.evidenceUpdatedAt,right.evidenceUpdatedAt);
}

export function currentTargetLabels(parts:GradedPartContract[]){
  return parts.map(part=>text(part.currentLabel)||text(part.label)).filter(Boolean);
}

export type CurrentTargetDisplay={
  oneLineHint:string;
  todayActions:string[];
  targetCount:number;
  omittedCount:number;
};

/** UI-only summary. It never merges or changes stable target identity. */
export function currentTargetDisplay(parts:GradedPartContract[],maxActions=3):CurrentTargetDisplay{
  const labels=currentTargetLabels(parts),targetCount=labels.length;
  if(!targetCount)return {oneLineHint:"現在の確認対象はありません。",todayActions:[],targetCount:0,omittedCount:0};
  const visible=labels.slice(0,Math.max(1,maxActions));
  const omittedCount=Math.max(0,targetCount-visible.length);
  const todayActions=[...visible,...(omittedCount?[`ほか${omittedCount}件も確認する`]:[])];
  const first=labels[0];
  const oneLineHint=targetCount===1
    ?`「${first}」だけを確認する。`
    :`今回は主に「${first}」を確認する。併せて残り${targetCount-1}点を確認する。`;
  return {oneLineHint,todayActions,targetCount,omittedCount};
}
