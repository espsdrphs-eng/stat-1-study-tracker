import type {ObservedOutOfScopeFinding} from "./types.ts";

export function materializeObservedOutOfScopeFindings(args:{
  rows:ObservedOutOfScopeFinding[];mode:string;currentPayloads:Iterable<string>;issueKey:()=>string;
}){
  const current=new Set([...args.currentPayloads].map(value=>value.trim()).filter(Boolean));
  return args.rows.map(row=>{
    const targetable=!["scan","scan5"].includes(args.mode)&&row.materiality==="major"&&row.confidence==="high"&&
      row.create_target_candidate&&!!row.finding.trim()&&!!row.evidence.trim()&&
      !current.has(row.finding.trim())&&!current.has(row.evidence.trim());
    return {...row,stable_target_key:targetable?args.issueKey():undefined};
  });
}
