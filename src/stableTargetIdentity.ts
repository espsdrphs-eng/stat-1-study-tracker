import type {Attempt,GradedPartContract,ProblemAlias,Review} from "./types.ts";
import {resolveCanonicalProblemId} from "./examReadiness.ts";

type OwnerKind="attempt"|"review";
type Node={
  nodeId:string;ownerKind:OwnerKind;ownerId:number;problemId:string;index:number;
  rawId:string;part:GradedPartContract;persistedKey?:string;validPersistedKey?:string;knownKey?:string;
};

export type StableTargetResolution={
  /** A valid key already persisted in the lineage. Never an audit-only component id. */
  key?:string;
  /** Identity used while replaying this lineage. It is never written to IndexedDB. */
  identityKey?:string;
  rawId:string;part:GradedPartContract;ambiguous:boolean;needsBackfill:boolean;
  invalidPersistedKeys:string[];reason?:string;
};

export type StableTargetIndex={
  attemptPart:(attemptId:number,rawId:string)=>StableTargetResolution|undefined;
  reviewPart:(reviewId:number,rawId:string)=>StableTargetResolution|undefined;
  attemptParts:(attemptId:number)=>StableTargetResolution[];
  reviewParts:(reviewId:number)=>StableTargetResolution[];
  stableTargetCount:number;ambiguousTargetCount:number;unifiedGenerationCount:number;
  invalidPersistedKeyCount:number;
};

const LEGACY_DYNAMIC=/^(?:part:[^:]+:\d+:\d+|target_[a-z0-9]+)$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stableSlotKey=(problemId:string,id:string)=>`target:${problemId}:slot:${id}`;

function dynamicPartReference(rawId:string){
  const match=/^part:(.+):(\d+):(\d+)$/.exec(rawId);
  return match?{problemId:match[1],sourceAttemptId:Number(match[2]),slot:Number(match[3])}:undefined;
}

export function isKnownStablePartId(id:string){
  return !!id&&!LEGACY_DYNAMIC.test(id);
}

/**
 * Stable keys have exactly two supported origins: a canonical registry slot or
 * an opaque persistent root. Review, Attempt and submission identities are
 * deliberately not valid, even when an older build persisted them.
 */
export function isValidStableTargetKey(problemId:string,value:unknown):value is string{
  const key=String(value||"");
  const slotPrefix=`target:${problemId}:slot:`;
  const rootPrefix=`target:${problemId}:root:`;
  if(key.startsWith(slotPrefix)){
    const id=key.slice(slotPrefix.length);
    return isKnownStablePartId(id)&&!id.includes(":review:")&&!id.includes(":attempt:")&&!id.includes(":submission:");
  }
  return key.startsWith(rootPrefix)&&UUID.test(key.slice(rootPrefix.length));
}

export function issueStableTargetKey(problemId:string){
  return `target:${problemId}:root:${crypto.randomUUID()}`;
}

export function stableTargetKeyForPart(problemId:string,part:GradedPartContract){
  const persisted=part.stableTargetKey||part.stable_target_key;
  if(isValidStableTargetKey(problemId,persisted))return persisted;
  return isKnownStablePartId(part.id)?stableSlotKey(problemId,part.id):undefined;
}

export function withStableTargetKey(part:GradedPartContract,key:string|undefined){
  const normalized={...part};
  delete normalized.stableTargetKey;
  delete normalized.stable_target_key;
  return key?{...normalized,stableTargetKey:key}:normalized;
}

function partsFromAttempt(attempt:Attempt):GradedPartContract[]{
  const stored=(attempt.grading_contract?.gradedParts||[]).flatMap(part=>typeof part!=="string"&&part?.id?[part]:[]);
  const byId=new Map(stored.map(part=>[part.id,part]));
  for(const [index,id] of (attempt.graded_part_ids||[]).entries())if(id&&!byId.has(id)){
    const label=attempt.graded_parts?.[index]||id;
    byId.set(id,{id,label,cueLabel:label,allowedErrorTypes:["K","W","N","C","none"],
      completionCriterionId:`preserve_${id}`});
  }
  for(const finding of attempt.graded_findings||[])if(finding.graded_part_id&&!byId.has(finding.graded_part_id)){
    const id=finding.graded_part_id;
    byId.set(id,{id,label:id,cueLabel:id,allowedErrorTypes:[finding.error_type,"none"],
      completionCriterionId:`preserve_${id}`});
  }
  for(const finding of attempt.observed_out_of_scope_findings||[]){
    const key=finding.stable_target_key;
    if(!key||!isValidStableTargetKey(attempt.problem_id,key))continue;
    const id=`observation:${key.slice(key.lastIndexOf(":")+1)}`;
    if(!byId.has(id))byId.set(id,{id,label:finding.finding,cueLabel:finding.finding,
      allowedErrorTypes:["K","W","N","C","none"],completionCriterionId:`retain_${id}`,
      stableTargetKey:key,currentLabel:finding.finding,currentEvidence:finding.evidence,
      currentCorrection:finding.finding,currentErrorType:finding.mastery_level===1?"K":finding.mastery_level===2?"W":"N",
      masteryLevel:finding.mastery_level,
      evidenceSourceAttemptId:attempt.id,evidenceUpdatedAt:attempt.saved_at||attempt.date});
  }
  return [...byId.values()];
}

function partsFromReview(review:Review):GradedPartContract[]{
  const stored=(review.grading_contract?.gradedParts||[]).flatMap((part,index)=>{
    if(typeof part!=="string")return part?.id?[part]:[];
    const id=review.graded_part_ids?.[index];
    return id?[{id,label:part,cueLabel:part,allowedErrorTypes:["K","W","N","C","none"],
      completionCriterionId:`legacy_${id}`} as GradedPartContract]:[];
  });
  const byId=new Map(stored.map(part=>[part.id,part]));
  for(const [index,id] of (review.graded_part_ids||[]).entries())if(id&&!byId.has(id)){
    const label=review.graded_parts?.[index]||id;
    byId.set(id,{id,label,cueLabel:label,allowedErrorTypes:["K","W","N","C","none"],
      completionCriterionId:`preserve_${id}`});
  }
  return [...byId.values()];
}

/**
 * Builds lineage only from persisted slots and explicit Review/Attempt links.
 * Labels, error text and error type similarity are never identity evidence.
 * Audit-only component ids may contain row ids; they are never exposed as a
 * stableTargetKey and are replaced by one opaque root during an explicit repair.
 */
export function buildStableTargetIndex(args:{
  attempts:Attempt[];reviews:Review[];aliases?:ProblemAlias[];
}):StableTargetIndex{
  const aliases=args.aliases||[];
  const canonical=(value:string)=>resolveCanonicalProblemId(value,aliases);
  const nodes:Node[]=[];
  for(const attempt of args.attempts){
    const problemId=canonical(attempt.problem_id);
    partsFromAttempt(attempt).forEach((part,index)=>{
      const persistedKey=part.stableTargetKey||part.stable_target_key;
      const validPersistedKey=isValidStableTargetKey(problemId,persistedKey)?persistedKey:undefined;
      nodes.push({nodeId:`a:${attempt.id}:${index}`,ownerKind:"attempt",ownerId:attempt.id,problemId,index,
        rawId:part.id,part,persistedKey,validPersistedKey,
        knownKey:!validPersistedKey&&isKnownStablePartId(part.id)?stableSlotKey(problemId,part.id):undefined});
    });
  }
  for(const review of args.reviews){
    const problemId=canonical(review.problem_id);
    partsFromReview(review).forEach((part,index)=>{
      const persistedKey=part.stableTargetKey||part.stable_target_key;
      const validPersistedKey=isValidStableTargetKey(problemId,persistedKey)?persistedKey:undefined;
      nodes.push({nodeId:`r:${review.id}:${index}`,ownerKind:"review",ownerId:review.id,problemId,index,
        rawId:part.id,part,persistedKey,validPersistedKey,
        knownKey:!validPersistedKey&&isKnownStablePartId(part.id)?stableSlotKey(problemId,part.id):undefined});
    });
  }
  const parent=new Map(nodes.map(node=>[node.nodeId,node.nodeId]));
  const conflicts=new Map<string,Set<string>>();
  const find=(id:string):string=>{
    const current=parent.get(id)!;
    if(current===id)return id;
    const root=find(current);parent.set(id,root);return root;
  };
  const anchors=(root:string)=>nodes.filter(node=>find(node.nodeId)===root)
    .flatMap(node=>[node.validPersistedKey,node.knownKey].filter((value):value is string=>!!value));
  const recordConflict=(left:string,right:string,keys:Set<string>)=>{
    const message=`conflicting stable target keys: ${[...keys].sort().join(", ")}`;
    for(const root of [left,right])conflicts.set(root,new Set([...(conflicts.get(root)||[]),message]));
  };
  const union=(left:Node|undefined,right:Node|undefined)=>{
    if(!left||!right||left.problemId!==right.problemId)return;
    const a=find(left.nodeId),b=find(right.nodeId);if(a===b)return;
    const keys=new Set([...anchors(a),...anchors(b)]);
    if(keys.size>1){recordConflict(a,b,keys);return;}
    parent.set(b,a);
    if(conflicts.has(b))conflicts.set(a,new Set([...(conflicts.get(a)||[]),...conflicts.get(b)!]));
  };
  const byProblemRaw=new Map<string,Node[]>();
  for(const node of nodes){
    const key=`${node.problemId}|${node.rawId}`;
    byProblemRaw.set(key,[...(byProblemRaw.get(key)||[]),node]);
  }
  // Exact stored IDs are explicit references, not fuzzy text matching.
  for(const rows of byProblemRaw.values())for(const node of rows.slice(1))union(rows[0],node);
  // A persisted opaque root is the strongest explicit lineage evidence. It is
  // allowed to survive a later raw-id/label change, so connect equal roots
  // before replaying Review -> Attempt transitions.
  const byPersistedRoot=new Map<string,Node[]>();
  for(const node of nodes)if(node.validPersistedKey){
    const key=`${node.problemId}|${node.validPersistedKey}`;
    byPersistedRoot.set(key,[...(byPersistedRoot.get(key)||[]),node]);
  }
  for(const rows of byPersistedRoot.values())for(const node of rows.slice(1))union(rows[0],node);
  const attemptNodes=(id:number)=>nodes.filter(node=>node.ownerKind==="attempt"&&node.ownerId===id);
  const reviewNodes=(id:number)=>nodes.filter(node=>node.ownerKind==="review"&&node.ownerId===id);
  const attemptMap=new Map(args.attempts.map(row=>[row.id,row]));
  const reviewMap=new Map(args.reviews.map(row=>[row.id,row]));
  // An Attempt made from a Review evaluates that exact contract.
  for(const attempt of args.attempts){
    const sourceReview=reviewMap.get(Number(attempt.source_review_id||attempt.generated_from_review_id||0));
    if(!sourceReview)continue;
    const left=attemptNodes(attempt.id),right=reviewNodes(sourceReview.id);
    for(const node of left)union(node,right.find(item=>item.rawId===node.rawId));
  }
  // A successor Review inherits only the unresolved slots explicitly carried by its source Attempt.
  for(const review of args.reviews){
    const source=attemptMap.get(Number(review.source_attempt_id||review.generated_from_attempt_id||0));
    if(!source)continue;
    const target=reviewNodes(review.id),allSource=attemptNodes(source.id);
    for(const node of target)union(node,allSource.find(item=>item.rawId===node.rawId));
    // Legacy dynamic ids encode an explicit source-Attempt generation and slot:
    // part:<problem>:<sourceAttemptId>:<slot>. When a successor Review expands
    // the contract, only slots that also existed in the source Attempt inherit
    // lineage; additional slots are genuinely new targets. This is structural
    // lineage, never label/error-text similarity.
    for(const node of target){
      const reference=dynamicPartReference(node.rawId);
      if(!reference||canonical(reference.problemId)!==node.problemId||reference.sourceAttemptId!==source.id)continue;
      const inherited=allSource.find(candidate=>dynamicPartReference(candidate.rawId)?.slot===reference.slot);
      union(node,inherited);
    }
  }
  const components=new Map<string,Node[]>();
  for(const node of nodes){const root=find(node.nodeId);components.set(root,[...(components.get(root)||[]),node]);}
  const ordered=[...components.entries()].sort(([,left],[,right])=>left[0].problemId.localeCompare(right[0].problemId)||
    left.map(row=>row.nodeId).sort()[0].localeCompare(right.map(row=>row.nodeId).sort()[0]));
  const result=new Map<string,StableTargetResolution>();
  let ambiguousTargetCount=0,unifiedGenerationCount=0;
  ordered.forEach(([componentRoot,rows],componentIndex)=>{
    const explicit=[...new Set(rows.flatMap(node=>[node.validPersistedKey,node.knownKey].filter((v):v is string=>!!v)))];
    const invalidPersistedKeys=[...new Set(rows.flatMap(node=>node.persistedKey&&!node.validPersistedKey?[node.persistedKey]:[]))];
    const conflictReasons=[...new Set([...(conflicts.get(componentRoot)||[])])];
    let key:string|undefined,identityKey:string|undefined,reason:string|undefined;
    if(conflictReasons.length)reason=conflictReasons.join(" / ");
    else if(explicit.length===1){key=explicit[0];identityKey=key;}
    else if(explicit.length>1)reason=`conflicting stable target keys: ${explicit.join(", ")}`;
    else if(rows.length>1)identityKey=`lineage:${rows[0].problemId}:${componentIndex+1}`;
    else {
      const only=rows[0],review=only.ownerKind==="review"?reviewMap.get(only.ownerId):undefined;
      const reference=dynamicPartReference(only.rawId);
      // A current Review part whose dynamic id explicitly names its own source
      // Attempt is a newly introduced target, not an ambiguous historical
      // generation. Repair may mint its first opaque root exactly once.
      if(review&&["pending","overdue"].includes(String(review.status||""))&&reference&&
        canonical(reference.problemId)===only.problemId&&
        reference.sourceAttemptId===Number(review.source_attempt_id||review.generated_from_attempt_id||0)){
        identityKey=`lineage:${rows[0].problemId}:${componentIndex+1}`;
      }else reason="explicit lineage or stable slot is missing";
    }
    if(rows.length>1)unifiedGenerationCount+=rows.length-1;
    if(!identityKey)ambiguousTargetCount++;
    for(const node of rows)result.set(node.nodeId,{key,identityKey,rawId:node.rawId,
      part:withStableTargetKey(node.part,key),ambiguous:!identityKey,needsBackfill:!!identityKey&&!key,
      invalidPersistedKeys,reason});
  });
  const ownerRows=(kind:OwnerKind,id:number)=>nodes.filter(node=>node.ownerKind===kind&&node.ownerId===id)
    .map(node=>result.get(node.nodeId)!).filter(Boolean);
  const ownerPart=(kind:OwnerKind,id:number,rawId:string)=>{
    const node=nodes.find(row=>row.ownerKind===kind&&row.ownerId===id&&row.rawId===rawId);
    return node?result.get(node.nodeId):undefined;
  };
  return {
    attemptPart:(id,raw)=>ownerPart("attempt",id,raw),reviewPart:(id,raw)=>ownerPart("review",id,raw),
    attemptParts:id=>ownerRows("attempt",id),reviewParts:id=>ownerRows("review",id),
    stableTargetCount:new Set([...result.values()].map(row=>row.identityKey).filter(Boolean)).size,
    ambiguousTargetCount,unifiedGenerationCount,
    invalidPersistedKeyCount:nodes.filter(node=>!!node.persistedKey&&!node.validPersistedKey).length,
  };
}
