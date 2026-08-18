import type {ObservedOutOfScopeFinding,WholeAnswerScan} from "./types.ts";

export function materializeObservedOutOfScopeFindings(args:{
  rows:ObservedOutOfScopeFinding[];scan?:WholeAnswerScan;mode:string;currentPayloads:Iterable<string>;issueKey:()=>string;
  currentRootTargets?:Iterable<readonly [string,string]>;
}){
  const current=new Set([...args.currentPayloads].map(value=>value.trim()).filter(Boolean));
  const roots=new Map(args.currentRootTargets||[]),issued=new Map<string,string>();
  return args.rows.map(row=>{
    const scanSupportsPromotion=args.scan?.performed===true&&
      (args.scan.effective_reference_coverage||args.scan.reference_coverage)!=="insufficient";
    const targetable=scanSupportsPromotion&&!["scan","scan5"].includes(args.mode)&&row.mastery_area!=="other"&&
      row.materiality==="major"&&row.confidence==="high"&&
      row.create_target_candidate&&!!row.finding.trim()&&!!row.evidence.trim()&&
      !current.has(row.finding.trim())&&!current.has(row.evidence.trim());
    const root=row.root_cause_key?.trim();
    const inherited=row.stable_target_key||(root&&(roots.get(root)||issued.get(root)));
    const stable=inherited||(targetable?args.issueKey():undefined);
    if(root&&stable)issued.set(root,stable);
    return {...row,stable_target_key:stable};
  });
}
