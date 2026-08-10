import type {Attempt,GradedPartContract,ProblemAlias,Review} from "./types.ts";
import {resolveCanonicalProblemId} from "./examReadiness.ts";

type OwnerKind="attempt"|"review";
type Node={
  nodeId:string;ownerKind:OwnerKind;ownerId:number;problemId:string;index:number;
  rawId:string;part:GradedPartContract;persistedKey?:string;knownKey?:string;
};

export type StableTargetResolution={
  key?:string;rawId:string;part:GradedPartContract;ambiguous:boolean;reason?:string;
};

export type StableTargetIndex={
  attemptPart:(attemptId:number,rawId:string)=>StableTargetResolution|undefined;
  reviewPart:(reviewId:number,rawId:string)=>StableTargetResolution|undefined;
  attemptParts:(attemptId:number)=>StableTargetResolution[];
  reviewParts:(reviewId:number)=>StableTargetResolution[];
  stableTargetCount:number;ambiguousTargetCount:number;unifiedGenerationCount:number;
};

const LEGACY_DYNAMIC=/^(?:part:[^:]+:\d+:\d+|target_[a-z0-9]+)$/i;
const stableSlotKey=(problemId:string,id:string)=>`target:${problemId}:slot:${id}`;

export function isKnownStablePartId(id:string){
  return !!id&&!LEGACY_DYNAMIC.test(id);
}

export function stableTargetKeyForPart(problemId:string,part:GradedPartContract){
  return part.stableTargetKey||part.stable_target_key||
    (isKnownStablePartId(part.id)?stableSlotKey(problemId,part.id):undefined);
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
 * Builds target identity only from persisted slots and explicit Review lineage.
 * It intentionally never compares labels, error text, or error type similarity.
 */
export function buildStableTargetIndex(args:{
  attempts:Attempt[];reviews:Review[];aliases?:ProblemAlias[];
}):StableTargetIndex{
  const aliases=args.aliases||[];
  const canonical=(value:string)=>resolveCanonicalProblemId(value,aliases);
  const nodes:Node[]=[];
  for(const attempt of args.attempts){
    const problemId=canonical(attempt.problem_id);
    partsFromAttempt(attempt).forEach((part,index)=>nodes.push({nodeId:`a:${attempt.id}:${index}`,ownerKind:"attempt",
      ownerId:attempt.id,problemId,index,rawId:part.id,part,persistedKey:part.stableTargetKey||part.stable_target_key,
      knownKey:isKnownStablePartId(part.id)?stableSlotKey(problemId,part.id):undefined}));
  }
  for(const review of args.reviews){
    const problemId=canonical(review.problem_id);
    partsFromReview(review).forEach((part,index)=>nodes.push({nodeId:`r:${review.id}:${index}`,ownerKind:"review",
      ownerId:review.id,problemId,index,rawId:part.id,part,persistedKey:part.stableTargetKey||part.stable_target_key,
      knownKey:isKnownStablePartId(part.id)?stableSlotKey(problemId,part.id):undefined}));
  }
  const parent=new Map(nodes.map(node=>[node.nodeId,node.nodeId]));
  const find=(id:string):string=>{
    const current=parent.get(id)!;
    if(current===id)return id;
    const root=find(current);parent.set(id,root);return root;
  };
  const anchors=(root:string)=>nodes.filter(node=>find(node.nodeId)===root)
    .flatMap(node=>[node.persistedKey,node.knownKey].filter((value):value is string=>!!value));
  const union=(left:Node|undefined,right:Node|undefined)=>{
    if(!left||!right||left.problemId!==right.problemId)return;
    const a=find(left.nodeId),b=find(right.nodeId);if(a===b)return;
    const keys=new Set([...anchors(a),...anchors(b)]);
    if(keys.size>1)return;
    parent.set(b,a);
  };
  const byProblemRaw=new Map<string,Node[]>();
  for(const node of nodes){
    const key=`${node.problemId}|${node.rawId}`;
    byProblemRaw.set(key,[...(byProblemRaw.get(key)||[]),node]);
  }
  // Persisted raw IDs are an explicit slot reference; equal IDs are not fuzzy matching.
  for(const rows of byProblemRaw.values())for(const node of rows.slice(1))union(rows[0],node);
  const attemptNodes=(id:number)=>nodes.filter(node=>node.ownerKind==="attempt"&&node.ownerId===id);
  const reviewNodes=(id:number)=>nodes.filter(node=>node.ownerKind==="review"&&node.ownerId===id);
  const attemptMap=new Map(args.attempts.map(row=>[row.id,row]));
  const reviewMap=new Map(args.reviews.map(row=>[row.id,row]));
  const unionPositionally=(left:Node[],right:Node[])=>{
    if(left.length&&left.length===right.length)left.forEach((node,index)=>union(node,right[index]));
  };
  // An Attempt made from a Review evaluates that Review's contract slots.
  for(const attempt of args.attempts){
    const sourceReview=reviewMap.get(Number(attempt.source_review_id||attempt.generated_from_review_id||0));
    if(!sourceReview)continue;
    const left=attemptNodes(attempt.id),right=reviewNodes(sourceReview.id);
    for(const node of left)union(node,right.find(item=>item.rawId===node.rawId));
    unionPositionally(left,right);
  }
  // A successor Review is generated from the unresolved slots of its source Attempt.
  for(const review of args.reviews){
    const source=attemptMap.get(Number(review.source_attempt_id||review.generated_from_attempt_id||0));
    if(!source)continue;
    const target=reviewNodes(review.id),allSource=attemptNodes(source.id);
    for(const node of target)union(node,allSource.find(item=>item.rawId===node.rawId));
    const unresolvedIds=(source.graded_findings||[])
      .filter(row=>!row.resolved&&row.error_type!=="none").map(row=>row.graded_part_id);
    const unresolved=unresolvedIds.map(id=>allSource.find(node=>node.rawId===id)).filter((node):node is Node=>!!node);
    if(unresolved.length===target.length)unionPositionally(target,unresolved);
    else if(allSource.length===target.length)unionPositionally(target,allSource);
  }
  const components=new Map<string,Node[]>();
  for(const node of nodes){const root=find(node.nodeId);components.set(root,[...(components.get(root)||[]),node]);}
  const result=new Map<string,StableTargetResolution>();
  let ambiguousTargetCount=0,unifiedGenerationCount=0;
  for(const rows of components.values()){
    const explicit=[...new Set(rows.flatMap(node=>[node.persistedKey,node.knownKey].filter((v):v is string=>!!v)))];
    let key:string|undefined,reason:string|undefined;
    if(explicit.length===1)key=explicit[0];
    else if(explicit.length>1)reason=`conflicting stable target keys: ${explicit.join(", ")}`;
    else{
      const reviewRoot=[...rows].filter(node=>node.ownerKind==="review")
        .sort((a,b)=>a.ownerId-b.ownerId||a.index-b.index)[0];
      if(reviewRoot)key=`target:${reviewRoot.problemId}:review:${reviewRoot.ownerId}:slot:${reviewRoot.index+1}`;
      else{
        const withSubmission=[...rows].map(node=>node.ownerKind==="attempt"?attemptMap.get(node.ownerId):undefined)
          .find(attempt=>!!attempt?.submission_id);
        if(withSubmission)key=`target:${rows[0].problemId}:submission:${withSubmission.submission_id}:slot:${rows[0].index+1}`;
        else reason="explicit lineage or stable slot is missing";
      }
    }
    if(rows.length>1)unifiedGenerationCount+=rows.length-1;
    if(!key)ambiguousTargetCount++;
    for(const node of rows)result.set(node.nodeId,{key,rawId:node.rawId,
      part:key?{...node.part,stableTargetKey:key}:node.part,ambiguous:!key,reason});
  }
  const ownerRows=(kind:OwnerKind,id:number)=>nodes.filter(node=>node.ownerKind===kind&&node.ownerId===id)
    .map(node=>result.get(node.nodeId)!).filter(Boolean);
  const ownerPart=(kind:OwnerKind,id:number,rawId:string)=>{
    const node=nodes.find(row=>row.ownerKind===kind&&row.ownerId===id&&row.rawId===rawId);
    return node?result.get(node.nodeId):undefined;
  };
  return {
    attemptPart:(id,raw)=>ownerPart("attempt",id,raw),reviewPart:(id,raw)=>ownerPart("review",id,raw),
    attemptParts:id=>ownerRows("attempt",id),reviewParts:id=>ownerRows("review",id),
    stableTargetCount:new Set([...result.values()].map(row=>row.key).filter(Boolean)).size,
    ambiguousTargetCount,unifiedGenerationCount,
  };
}
