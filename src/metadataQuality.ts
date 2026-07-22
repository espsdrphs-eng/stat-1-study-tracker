import type { Problem } from "./types.ts";

export type MetadataQuality="verified"|"generic"|"review_needed";

export function metadataQuality(problem:Problem|undefined):MetadataQuality{
  if(!problem||problem.metadata_status==="review_needed"||problem.metadata_status==="metadata_review_needed"||
    !String(problem.theme||"").trim()||problem.theme==="要確認")return "review_needed";
  const keywords=(problem.canonical_keywords||[]).filter(Boolean);
  if(!keywords.length||!problem.canonical_problem_type||problem.theme.trim()===problem.canonical_problem_type.trim())return "generic";
  return "verified";
}

export function safeGenericGuidance(problem:Problem|undefined,evidence?:{error_point?:string;next_action?:string;unresolved_carryover?:string[];required_work_shown?:string[]}){
  const parts=[...(evidence?.unresolved_carryover||[]),evidence?.error_point,evidence?.next_action]
    .map(value=>String(value||"").trim()).filter(value=>value&&value!=="大きな問題なし");
  return {
    correctionTheme:parts[0]||"前回指定された箇所を確認する",
    entryHint:parts[1]||"前回指定された箇所から始める",
    oneLineHint:parts.length?`前回記録の「${parts[0]}」だけを確認する。`:"問題固有の内容は要確認",
    hasProblemSpecificEvidence:parts.length>0,
    metadataQuality:metadataQuality(problem),
  };
}
