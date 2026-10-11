import type {Attempt,Problem,Review,Task} from './types.ts';
import {attemptPlanningEligible,planningEligibleFindings} from './legacyKPolicy.ts';
import {currentTaskIdentity,isPastExamSessionTask} from './examOptimizationPolicy.ts';

export type TaskAnswerScope={
  scopeKey:string;status:'identified'|'unknown'|'conflict'|'whole';
  primaryTargetParts:string[];secondaryTargetParts:string[];referenceOnlyParts:string[];excludedParts:string[];
  candidateParts:string[];targetConfidence:'high'|'unconfirmed';
  unresolvedScopeParts?:string[];
  targetEvidence:Array<{part:string;role:string;source:string;attemptId?:number}>;
};
export type TaskAnswerScopeOverride={scopeKey:string;problemId:string;taskIdentity:string;primaryTargetParts:string[];secondaryTargetParts:string[];referenceOnlyParts:string[]};
type ScopeTask=Partial<Task&Review>;
const circled='⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽';
const normalized=(s:string)=>s.replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10));
const partKey=(s:string)=>circled.includes(s)?String(circled.indexOf(s)+1):normalized(s).match(/\d+/)?.[0]||s;
const unique=(parts:string[])=>parts.filter((p,i)=>parts.findIndex(q=>partKey(q)===partKey(p))===i);

/** Physical question numbers only; canonical grading slots are NOT question numbers. */
function tokens(text:string){
 const result:Array<{label:string;start:number;end:number;quoted:boolean}>=[];
 const quotes=[...text.matchAll(/『[^』]*』|「[^」]*」/gu)].map(m=>[m.index!,m.index!+m[0].length]);
 const pattern=/(?:小問|設問)\s*[0-9０-９]+(?:(?:から|[〜～])(?:小問|設問)?\s*[0-9０-９]+|(?:[・、]\s*[0-9０-９]+)*)|(?<![年A-Za-z0-9])問\s*[0-9０-９]+(?:(?:から|[〜～])(?:問)?\s*[0-9０-９]+|(?:[・、]\s*[0-9０-９]+)*)|(?<![A-Za-z0-9_α-ωΑ-Ω])[\[［][0-9０-９]+[\]］]|(?<![A-Za-z0-9α-ωΑ-Ω/\^=+*\-])[（(][0-9０-９]+[）)](?=\s|[:：]|の|で|を|は|が|も|に|と|、|・|。|[（(\[［]|$)|[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]/gu;
 for(const m of text.matchAll(pattern)){
  const raw=m[0],start=m.index!,end=start+raw.length,quoted=quotes.some(([a,b])=>start>a&&end<b);
  if(/^問/.test(raw)&&/\d{4}年\s*$/.test(text.slice(Math.max(0,start-10),start)))continue;
  if(/^(?:小問|設問|問)/.test(raw)){
   const prefix=raw.startsWith('小問')?'小問':raw.startsWith('設問')?'設問':'問';
   const range=normalized(raw).match(/^(小問|設問|問)\s*(\d+)(?:から|[〜～])(?:\1)?\s*(\d+)$/);
   if(range){const a=Number(range[2]),b=Number(range[3]);if(a>0&&b>=a&&b-a<30)for(let n=a;n<=b;n++)result.push({label:prefix+n,start,end,quoted});continue;}
   for(const n of raw.match(/[0-9０-９]+/g)||[])result.push({label:prefix+n,start,end,quoted});
  }else result.push({label:raw,start,end,quoted});
 }
 return result;
}
export function taskAnswerScopeKey(problem:Problem,task?:ScopeTask){
 return `${currentTaskIdentity((task||{problem_id:problem.problem_id}) as Task,problem.problem_id)}:${task?.grading_contract?.contractHash||task?.grading_contract?.contractId||task?.grading_contract?.sourceAttemptId||task?.source_attempt_id||task?.generated_from_attempt_id||task?.repair_lineage?.sourceAttemptId||'initial'}`;
}
function afterGroup(text:string,ts:ReturnType<typeof tokens>,index:number){
 let end=ts[index].end,j=index+1;
 while(j<ts.length&&(ts[j].start<=end||/^[\s・、と]*$/.test(text.slice(end,ts[j].start)))){end=Math.max(end,ts[j].end);j++;}
 return text.slice(end,ts[j]?.start??text.length);
}
export function validateTaskAnswerScopeOverride(value:TaskAnswerScopeOverride){
 const roles=[value.primaryTargetParts,value.secondaryTargetParts,value.referenceOnlyParts];
 if(!roles.every(a=>Array.isArray(a)&&a.length<=30&&a.every(p=>typeof p==='string'&&p.length<=20&&tokens(p).length===1&&tokens(p)[0].label===p.trim())))throw new Error('小問番号だけを入力してください（例：[3]、小問2、(4)）。解法や説明は入力できません。');
 if(!roles[0].length)throw new Error('主対象の小問番号を指定してください。未特定を問題全体として扱えません。');
 const keys=roles.flat().map(partKey);
 if(new Set(keys).size!==keys.length)throw new Error('主対象・補助・参照に同じ小問を重複指定できません。');
 return value;
}
export function deriveTaskAnswerScope(args:{problem:Problem;task?:ScopeTask;attempts:Attempt[];overrides?:Record<string,TaskAnswerScopeOverride>}):TaskAnswerScope{
 const {problem,task,attempts}=args;
 const scopeKey=taskAnswerScopeKey(problem,task);
 const empty:TaskAnswerScope={scopeKey,status:'unknown',primaryTargetParts:[],secondaryTargetParts:[],referenceOnlyParts:[],excludedParts:[],candidateParts:[],targetConfidence:'unconfirmed',targetEvidence:[]};
 const purpose=task?.grading_contract?.learningPurpose||task?.learning_purpose;
 // Blind transfer uses the TRANSFER problem, never the source Review's numbered scope.
 if(problem.source_type==='generated'||task&&isPastExamSessionTask(task as Task)||purpose==='transfer_check'||task?.transfer_training_key||!['error_repair','retrieval_check'].includes(purpose||''))return {...empty,status:'whole',targetConfidence:'high'};
 if(problem.source_type!=='past_exam')return {...empty,status:'whole',targetConfidence:'high'};
 const sourceId=task?.grading_contract?.sourceAttemptId||task?.source_attempt_id||task?.generated_from_attempt_id||task?.repair_lineage?.sourceAttemptId;
 const source=attempts.find(a=>a.id===sourceId&&attemptPlanningEligible(a));
 const rows:typeof empty.targetEvidence=[];
 const candidates:string[]=[],primary:string[]=[],secondary:string[]=[],references:string[]=[],excluded:string[]=[];
 const add=(part:string,role:string,field:string,attemptId?:number)=>{
  candidates.push(part);rows.push({part,role,source:field,attemptId});
  (role==='primary'?primary:role==='secondary'?secondary:role==='reference'?references:excluded).push(part);
 };
 function directives(text:string,field:string,attemptId?:number){
  for(const clause of text.split(/[。\n;]/u)){
   const ts=tokens(clause);if(!ts.length)continue;
   for(const [i,t] of ts.entries()){
    candidates.push(t.label);
    const after=afterGroup(clause,ts,i);
    const before=clause.slice(Math.max(0,t.start-15),t.start);
    const reference=/^(?:より|を(?:使|利用|用い|参照|適用)|へ接続|の(?:結果|式)を(?:使|利用|用い))/.test(after)||/参照(?:対象|先)[:：]?\s*$/.test(before);
    if(reference){add(t.label,'reference',field,attemptId);continue;}
    if(t.quoted)continue;
    if(/^(?:は|を|が)?(?:今回)?(?:対象外|採点対象外|解かない|解答しない|既に正解|修復済み)/.test(after)){add(t.label,'excluded',field,attemptId);continue;}
    const short=/補助|短時間|短く|短い確認/.test(clause)&&(/補助|併せて|あわせて|その後/.test(clause)||primary.length>0);
    const actionable=/再現|再確認|再答案|解(?:く|答)|補修|確認(?:する|対象|範囲)|回収|練習|実行|接続|正規化|計算|導出|完遂|残す|求め|出す|出し/.test(clause);
    const pure=clause.trim()===ts.map(x=>x.label).join('');
    const subject=/^(?:を|は|で|の|と|も|に(?:ついて)?|まで|だけ|、|・|$)/.test(after);
    if((actionable&&subject||pure)&&!/^(?:は|が)?(?:完全に)?(?:正解|正答|正しく|修復済み|対象外)/.test(after))add(t.label,short?'secondary':'primary',field,attemptId);
   }
  }
 }
 if(source?.next_action)directives(source.next_action,'attempt.next_action',source.id);
 // A current contract may retain the original failed finding through a successful repair.
 // Use it when the current next_action does not specify physical parts, not stale targeted_parts.
 if(!primary.length&&!secondary.length)for(const part of task?.grading_contract?.gradedParts||[]){
  const origin=attempts.find(a=>a.id===(part.evidenceSourceAttemptId||sourceId)&&attemptPlanningEligible(a));
  if(origin&&part.currentCorrection)directives(part.currentCorrection,'contract.currentCorrection',origin.id);
 }
 const hasDirective=primary.length>0;
 const selectedIds=new Set((task?.grading_contract?.gradedParts||[]).map(p=>p.id));
 const failures=source?planningEligibleFindings(source).filter(f=>!f.resolved&&f.error_type!=='none'):[];
 const selectedFailures=failures.filter(f=>!selectedIds.size||selectedIds.has(f.graded_part_id));
 const located=new Set<string>();
 const failurePattern=/誤|未完|未回答|未再現|未修復|未記載|未提出|停止|崩れ|不足|落と|ではなく|でき(?:な|ず)|(?:到達|完遂|接続|再現)していない|(?:記載|記|提出|実行|再現)されていない|書かれていない|になっていない|が(?:ない|なく)|答案に(?:ない|再現されていない)/;
 function evidence(text:string,field:string,attemptId:number,inherited=false){
   const ts=tokens(text);let found=false;
   // A composite old slot may contain an unnumbered failure plus an unrelated numbered one.
   if(inherited&&ts.length&&failurePattern.test(text.slice(0,ts[0].start)))return false;
   for(const [i,t] of ts.entries()){
    candidates.push(t.label);if(t.quoted)continue;
    let after=afterGroup(text,ts,i).split(/[。\n]/u)[0];
    if(/^(?:より|を(?:使|利用|用い)|へ接続)/.test(after)){add(t.label,'reference',field,attemptId);continue;}
    const subject=/^(?:は|が|の|で|を|について|まで)/.test(after);
    const positive=/正解|正しく|正しい(?:が|。|、|$)|修正された|(?:正答|修復|再現|到達)(?:した|できた)|改善(?:して|した)|完遂(?:した|できた)/.test(after);
    if(!failurePattern.test(after)&&!positive&&/(?:と|および|、)(?:答案)?$/.test(after.trim()))after=text.slice(t.end).split(/[。\n]/u)[0];
    if(/新たな誤答とは扱わない|再評価していない|対象外/.test(after)){add(t.label,'excluded',field,attemptId);continue;}
    const failed=failurePattern.test(after);
    if(subject&&failed){add(t.label,'primary',field,attemptId);found=true;}
    else if(subject&&positive)add(t.label,'excluded',field,attemptId);
    else if(inherited&&(t.start===0||/^答案(?:では)?$/.test(text.slice(0,t.start)))&&subject&&!positive){add(t.label,'primary',field,attemptId);found=true;}
   }
   return found;
 }
 const nonInitialDirective=!!source&&hasDirective&&(tokens(source.next_action||'')[0]?.start||0)>0;
 if((!hasDirective||nonInitialDirective)&&source){
  const scan=source.whole_answer_scan;
  const normalizeId=(id:string)=>id.replace(/^(?:graded:|GF-)/,'').replace(/-/g,'_');
  const outside=new Set((source.observed_out_of_scope_findings||[]).map(f=>f.finding_id));
  const invalidUnresolved=(source.graded_findings||[]).some(f=>!f.resolved&&f.error_type!=='none'&&(f.planning_eligible===false||f.validity==='invalid_legacy_k'));
  const coversAll=!hasDirective&&!invalidUnresolved&&selectedFailures.length>0&&selectedFailures.length===failures.length&&!(source.observed_out_of_scope_findings||[]).length;
  if(scan?.performed&&scan.confidence==='high')for(const region of scan.regions||[]){
   if(region.status!=='checked_error'||region.finding_ids.some(id=>outside.has(id)||/^(?:OO[-:]|diag[-:])/.test(id)))continue;
   const matching=selectedFailures.filter(f=>region.finding_ids.some(id=>normalizeId(id)===normalizeId(f.graded_part_id)));
   if(hasDirective||!coversAll&&!matching.length)continue;
   const physical=tokens(region.description).filter(t=>!t.quoted);
   if(physical.length){for(const t of physical)add(t.label,'primary','attempt.whole_answer_scan.regions',source.id);for(const f of matching)located.add(f.graded_part_id);}
  }
  const scanned=primary.length>0;
  for(const f of selectedFailures)if(evidence(f.evidence||'','finding.evidence',source.id))located.add(f.graded_part_id);
  if(scan?.performed&&scan.confidence==='high')for(const f of selectedFailures){
   if(located.has(f.graded_part_id))continue;
   // Exact recorded names bind a finding to a numbered region; no theme similarity.
   // Prefer a named theorem over a formula which it merely uses as a prerequisite.
   const names=(f.evidence||'').match(/\b[A-Z][A-Za-z]+(?:-[A-Z][A-Za-z]+)+\b/g)||[];
   const functions=[...(f.evidence||'').matchAll(/\b([A-Za-z][A-Za-z_]{3,})\(/g)].map(m=>m[1]);
   const anchors=names.length?names:unique(functions);
   for(const anchor of anchors){
    const matching=(scan.regions||[]).filter(r=>r.status!=='uncertain'&&new RegExp(`\\b${anchor}\\b`).test(r.description)&&!r.finding_ids.some(id=>outside.has(id)||/^(?:OO[-:]|diag[-:])/.test(id)));
    const numbered=unique(matching.flatMap(r=>tokens(r.description).filter(t=>!t.quoted).map(t=>t.label)));
    if(numbered.length===1){add(numbered[0],'primary','finding.scan.named_locator',source.id);located.add(f.graded_part_id);}
   }
  }
  // Latest assigned labels can explicitly locate one exercise while its other grading slots are neutral.
  const assigned=source.graded_parts||[];
  if(!primary.length&&assigned.length===source.graded_part_ids?.length){
   const labels=assigned.filter(t=>tokens(t).length);
   const physical=unique(labels.flatMap(t=>tokens(t).map(x=>x.label)));
   if(physical.length===1&&labels.every(t=>tokens(t)[0].start===0&&!failurePattern.test(t))){for(const part of physical)add(part,'primary','attempt.graded_parts',source.id);for(const f of selectedFailures)located.add(f.graded_part_id);}
  }
  if(scanned&&coversAll)for(const f of selectedFailures)located.add(f.graded_part_id);
  // A recorded named quantity / exact operation can locate an unnumbered residual
  // in a numbered region of this answer or its explicitly linked source answer.
  // This is a within-problem locator, never a cross-problem skill match.
  if(!primary.length&&selectedFailures.length===1){
   const locatorNormalize=(s:string)=>s.replace(/の大小|\s/g,'');
   const anchors=[source.error_point,source.next_action].flatMap(text=>{
    const prefix=String(text||'').split(/について|を書|を|は|で/u)[0].trim();
    return prefix.length>=4&&prefix.length<=40&&(/^[A-Za-z][A-Za-z0-9_ ]*\([^)]*\)$/.test(prefix)||/^[一-龯ぁ-んァ-ン]{4,12}$/.test(prefix))?[locatorNormalize(prefix)]:[];
   });
   let cursor:Attempt|undefined=source;const seen=new Set<number>();
   while(cursor&&!seen.has(cursor.id)&&anchors.length){
    seen.add(cursor.id);const regions=cursor.whole_answer_scan?.confidence==='high'?cursor.whole_answer_scan.regions||[]:[];
    const matches=regions.filter(r=>['checked_error','checked_correct','not_checkable'].includes(r.status)&&anchors.some(a=>locatorNormalize(r.description).includes(a)));
    const numbered=unique(matches.flatMap(r=>tokens(r.description).filter(t=>!t.quoted).map(t=>t.label)));
    if(numbered.length===1){add(numbered[0],'primary','lineage.scan.exact_locator',cursor.id);located.add(selectedFailures[0].graded_part_id);break;}
    const parentId:number|undefined=cursor.grading_contract?.sourceAttemptId;
    cursor=attempts.find(a=>a.id===parentId&&a.problem_id===source!.problem_id&&!a.duplicate_of_attempt_id&&!a.invalidated_at&&
      (attemptPlanningEligible(a)||a.policy_validity==='invalid_legacy_k'&&a.whole_answer_scan?.performed&&a.whole_answer_scan.confidence==='high'));
   }
  }
 }
 // Follow only the same graded part through explicit contract ancestry. Never search arbitrary old notes.
 if(!hasDirective&&source){
  const required=[...(selectedIds.size?selectedIds:new Set(selectedFailures.map(f=>f.graded_part_id)))];
  for(const id of required){
   if(located.has(id))continue;
   let cursor=source;const seen=new Set<number>();
   while(cursor&&!seen.has(cursor.id)){
    seen.add(cursor.id);
    const part=cursor.grading_contract?.gradedParts?.find(p=>p.id===id);
    if(!part)break;
    const parentId:number|undefined=part.evidenceSourceAttemptId||cursor.grading_contract?.sourceAttemptId;
    const parent=attempts.find(a=>a.id===parentId&&a.problem_id===source.problem_id&&attemptPlanningEligible(a));
    if(!parent||parent.id===cursor.id)break;
    if(part.currentCorrection&&tokens(part.currentCorrection)[0]?.start===0){
     const before=rows.length;directives(part.currentCorrection,'lineage.contract.currentCorrection',parent.id);
     if(rows.slice(before).some(r=>r.role==='primary')){located.add(id);break;}
    }
    if(evidence(part.label,'lineage.contract.label',parent.id,true)){located.add(id);break;}
    cursor=parent;
   }
  }
 }
 let p=unique(primary),s=unique(secondary),r=unique(references),e=unique(excluded);
 if(!hasDirective||nonInitialDirective)p.sort((a,b)=>Number(partKey(a))-Number(partKey(b)));
 const conflicting=p.some(x=>[...s,...e].some(y=>partKey(x)===partKey(y)))||s.some(x=>e.some(y=>partKey(x)===partKey(y)));
 const answered=new Set([...p,...s].map(partKey));r=r.filter(x=>!answered.has(partKey(x)));e=e.filter(x=>!answered.has(partKey(x)));
 const explicitAllUnsubmitted=source?.graded_findings?.some(f=>f.planning_eligible!==false&&/(?:小問|設問|問)\d+から(?:小問|設問|問)?\d+まで.*(?:未提出|提出されていない)/.test(f.evidence||''));
 const assignedSingle=rows.some(r=>r.source==='attempt.graded_parts');
 const missing=!hasDirective&&!explicitAllUnsubmitted&&!assignedSingle?selectedFailures.filter(f=>!located.has(f.graded_part_id)).map(f=>f.graded_part_id):[];
 const identified=p.length>0&&!missing.length;
 const derived:TaskAnswerScope={...empty,status:conflicting?'conflict':identified?'identified':'unknown',unresolvedScopeParts:missing,primaryTargetParts:p,secondaryTargetParts:s,referenceOnlyParts:r,excludedParts:e,candidateParts:unique(candidates),targetConfidence:identified&&!conflicting?'high':'unconfirmed',targetEvidence:rows};
 const manual=args.overrides?.[scopeKey];
 if(manual&&manual.problemId===problem.problem_id&&manual.taskIdentity===currentTaskIdentity(task as Task,problem.problem_id)){
  try{validateTaskAnswerScopeOverride(manual);return {...derived,status:'identified',primaryTargetParts:manual.primaryTargetParts,secondaryTargetParts:manual.secondaryTargetParts,referenceOnlyParts:manual.referenceOnlyParts,targetConfidence:'high',targetEvidence:manual.primaryTargetParts.map(part=>({part,role:'primary',source:'manual.task_scope',attemptId:sourceId}))};}catch{/* Invalid/imported overrides are never trusted. */}
 }
 return derived;
}
export function taskAnswerScopeText(scope:TaskAnswerScope){
 if(scope.status==='whole')return '問題全体（問題文の要求範囲）';
 if(scope.status==='unknown'||scope.status==='conflict')return scope.status==='conflict'?'対象小問の記録が矛盾（要確認）':'対象小問未特定・指定が必要';
 return `主対象：${scope.primaryTargetParts.join('・')}${scope.secondaryTargetParts.length?` ／ 補助確認：${scope.secondaryTargetParts.join('・')}`:''}${scope.referenceOnlyParts.length?` ／ 参照のみ：${scope.referenceOnlyParts.join('・')}`:''}`;
}
export function appendTaskAnswerScope(prompt:string,scope:TaskAnswerScope){
 if(scope.status==='unknown'||scope.status==='conflict')throw new Error('対象小問を確認・指定してから採点プロンプトをコピーしてください。');
 if(scope.status==='whole')return prompt+'\n\n【今回の解答範囲】問題全体（問題文の要求範囲）。';
 return prompt+`\n\n【今回の原問題の小問範囲：採点対象の上限】\n主対象：${scope.primaryTargetParts.join('・')}\n補助確認：${scope.secondaryTargetParts.join('・')||'なし'}\n参照のみ（採点対象外）：${scope.referenceOnlyParts.join('・')||'なし'}\n上記の主対象・補助確認以外を未回答として減点しない。参照先を追加解答対象にしない。指定外の小問の成績・解消状態を更新しない。内部graded_part_idsは原問題の小問番号ではない。既存の契約ID・hash・採点項目IDは変更しない。`;
}
