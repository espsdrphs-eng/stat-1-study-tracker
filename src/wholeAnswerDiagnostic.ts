import type {ProblemContextPack,WholeAnswerScan} from "./types.ts";

export const UNCONFIRMED_WHOLE_ANSWER_SCAN:WholeAnswerScan={
  performed:false,reference_coverage:"insufficient",confidence:"low",
  reason:"答案全体を照合できる問題文・参照解答が不足しています。",
};

export function suppliedReferenceCoverage(context?:ProblemContextPack):WholeAnswerScan["reference_coverage"]{
  if(context?.problemStatement&&context.officialAnswerText)return "full";
  if(context?.problemStatement||context?.officialAnswerText||context?.answerExcerpt)return "partial";
  return "insufficient";
}

export function normalizeWholeAnswerScan(value:unknown):WholeAnswerScan{
  if(!value||typeof value!=="object")return {...UNCONFIRMED_WHOLE_ANSWER_SCAN};
  const raw=value as Record<string,unknown>;
  const coverage=["full","partial","insufficient"].includes(String(raw.reference_coverage))
    ?String(raw.reference_coverage) as WholeAnswerScan["reference_coverage"]:"insufficient";
  const confidence=["high","medium","low"].includes(String(raw.confidence))
    ?String(raw.confidence) as WholeAnswerScan["confidence"]:"low";
  const requestedPerformed=raw.performed===true||String(raw.performed).toLowerCase()==="true";
  const performed=requestedPerformed&&coverage!=="insufficient";
  return {performed,reference_coverage:coverage,confidence,
    reason:String(raw.reason||(!performed?UNCONFIRMED_WHOLE_ANSWER_SCAN.reason:"確認した参照範囲に基づく答案全体監査"))};
}

export function wholeAnswerScanSummary(scan:WholeAnswerScan|undefined,findingCount:number){
  const current=scan||UNCONFIRMED_WHOLE_ANSWER_SCAN;
  if(!current.performed||current.reference_coverage==="insufficient")return {
    tone:"warning" as const,title:"答案全体の追加誤りは未確認",detail:current.reason,
  };
  if(current.reference_coverage==="partial")return {
    tone:"warning" as const,title:`答案全体を一部確認${findingCount?`・追加finding ${findingCount}件`:""}`,
    detail:`参照範囲が一部のため「追加誤りなし」とは確定しません。${current.reason}`,
  };
  return findingCount?{
    tone:"danger" as const,title:`答案全体の追加確認・finding ${findingCount}件`,detail:current.reason,
  }:{
    tone:"success" as const,title:"答案全体の追加確認・major errorなし",detail:"完全な参照情報で確認した範囲では、追加major errorはありません。",
  };
}
