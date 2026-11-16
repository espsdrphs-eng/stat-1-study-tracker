import {capabilityById,capabilityStates,capabilityKinds,CAPABILITY_CATALOG_VERSION} from './capabilityCatalog.ts';
import {capabilityDate,canonicalValue,type CapabilityCheck,type CapabilityEvaluation} from './capabilityEvidence.ts';
import {conceptFocusLabels,theoryAspectKeys,type ConceptFocus,type TheoryAspect} from './capabilityTheory.ts';
import type {GradingErrorType} from './types.ts';
import {GENERATION_CHECKS} from './generatedTransfer.ts';

export const DAILY_LEARNING_VERSION='stat1-daily-learning-v1' as const;
export const DAILY_RECEIPT_PREFIX='daily-learning:v1:';
export const dailyKindLabels={diagnostic:'診断・初回答案',local_repair:'局所補修',immediate_reproduction:'直後の自力再現',delayed_transfer:'後日の確認',exam:'本番形式の練習'} as const;
export const dailyPartLabels={correct:'正しくできた',incorrect:'未達',partial:'部分成功',unattempted:'未着手',unreadable:'判定不能'} as const;
export const dailyComparisonLabels={improved:'改善',recurrence:'再発',partial_repair:'局所補修で改善・自力確認とは別',unverified:'比較未確認'} as const;
const purpose=['diagnostic','local_repair','delayed_transfer','exam'] as const;
const sources=['handwriting','chat_text','other','unknown'] as const;
const familiarity=['unseen','seen','unknown'] as const;
const shown=['statement','ability_name','method','hint','solution','quality','generation_reason','unknown'] as const;
type Choice<T>=T extends readonly (infer U)[]?U:never;
export type DailyKind=keyof typeof dailyKindLabels;
export type DailyRef=string|number;
type PartStatus=keyof typeof dailyPartLabels;
export type DailyPart={part_id:string;status:PartStatus;quote:string|null;finding:string;error_type:GradingErrorType;concept_focus?:ConceptFocus;score?:DailyScore;k_evidence?:string};
type DailyScore={points:number;max:number};
type DailyQuality={generator_pass_id:string;validator_pass_id:string;checked_at:string;checks:Record<(typeof GENERATION_CHECKS)[number],{pass:boolean;evidence:string}>};
type DailyRepair={ability_id:string;target:string;guidance:string;unconfirmed:string|null};
type DailyCoaching=DailyRepair&{baseline:DailyRef};
export type DailyProblem={ref:string;existing_problem_id?:string;title?:string;statement?:string;theme?:string;parts?:Array<{id:string;label:string}>;
 purpose:Choice<typeof purpose>;familiarity:Choice<typeof familiarity>;shown:Array<Choice<typeof shown>>;presented_at:string|null;quality:DailyQuality|null;target_ability_ids:string[];selection_reason:string|null};
export type DailyAnswer={ref:string;problem_ref:string;kind:DailyKind;baseline:DailyRef|null;answered_at:string|null;source:Choice<typeof sources>;
 reference:{level:number|null;hint_used:boolean|null;method_cued:boolean|null;closed_reproduction:boolean|null};score:DailyScore|null;grading_confidence:number|null;parts:DailyPart[];
 first_error_part_id:string|null;affected_part_ids:string[];independent_error_part_ids:string[];repair?:DailyRepair;minutes?:number};
type DailyOutcome='success'|'failure'|'partial'|'uncertain';
export type DailyComparison={against:DailyRef;result:keyof typeof dailyComparisonLabels;reason:string};
export type DailyEvidence={answer_ref:DailyRef;part_ids:string[];outcome:DailyOutcome;aspect:TheoryAspect;concept_focus?:ConceptFocus;observation:string;
 comparison?:DailyComparison;structure_difference?:string};
export type DailyEvaluation=Pick<CapabilityEvaluation,'ability_id'|'state'|'certainty'|'judgement'|'cause_hypothesis'>&{
 cause_confidence?:'low'|'medium'|'high';evidence:DailyEvidence[];next_check:(CapabilityCheck&{basis:DailyRef})|null;
 recurrence_comparison?:{before:DailyRef[];after:DailyRef[];aspect:TheoryAspect;reason:string}};
export type DailyLearningPackage={schema_version:typeof DAILY_LEARNING_VERSION;session_id:string;learning_date:string;morning_context_version:string;catalog_version:string;
 created_at:string;learning_goal:'long_term_theory';source_status:'observed'|'limited';departure_reason:string|null;
 problems:DailyProblem[];answers:DailyAnswer[];evaluations:DailyEvaluation[];coaching_without_answer:DailyCoaching[]};
/** Written only by the daily batch adapter, not accepted in conventional grading payloads. */
export type StoredDailyAnswer=Omit<DailyAnswer,'baseline'|'reference'|'problem_ref'|'score'|'grading_confidence'|'minutes'>&{
 session_id:string;baseline_attempt_id:number|null;reference:DailyAnswer['reference'];familiarity:DailyProblem['familiarity'];shown:DailyProblem['shown'];target_ability_ids:string[];
 source_status:DailyLearningPackage['source_status'];noncued_quality?:{validator_pass_id:string;ability_ids:string[]};
};
export type DailyAssessmentDiff={ability_id:string;before:CapabilityEvaluation['state'];proposed:CapabilityEvaluation['state']|null;after:CapabilityEvaluation['state'];
 status:'adopted'|'held'|'evidence_only'|'revalidated';reason:string;attempt_ids:number[];next_check?:CapabilityCheck;
 recurrence_comparison?:{reason:string;before:number[];after:number[];before_failures:number|null;after_failures:number|null};
 observations:{attempt_id:number;kind:string;outcome:DailyOutcome;aspect:TheoryAspect;part_ids:string[];status:'success'|'failure'|'unconfirmed';reason:string;
  comparison?:{result:DailyComparison['result'];against_attempt_id:number;accepted:boolean;reason:string}}[]};
export type DailyReceipt={version:typeof DAILY_LEARNING_VERSION;session_id:string;learning_date:string;package_hash:string;archive_id:string;
 morning_context_version:string;assessment_context_version:string;saved_at:string;source_status:DailyLearningPackage['source_status'];departure_reason:string|null;
 problems:{ref:string;problem_id:string;title:string;status:'new'|'existing';part_ids:string[]}[];
 answers:{ref:string;attempt_id:number;problem_id:string;kind:DailyKind;baseline_attempt_id:number|null;score:DailyScore|null;part_ids:string[]}[];
 evaluations:DailyAssessmentDiff[];before_counts:Record<CapabilityEvaluation['state'],number>;after_counts:Record<CapabilityEvaluation['state'],number>;
 coaching_without_answer:Array<DailyRepair&{baseline_attempt_id:number}>;
};
export type DailyPreview=Omit<DailyReceipt,'saved_at'|'archive_id'|'assessment_context_version'>&{
 duplicate:boolean;confirmationToken:string;can_confirm_noncued:boolean;saved_at?:string;archive_id?:string;assessment_context_version?:string;
};

export const dailyFail=(p:string,m:string):never=>{throw new Error(`${p}：${m}`)};
const object=(v:unknown,p:string)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:dailyFail(p,'オブジェクトが必要です。');
const list=(v:unknown,p:string,max:number,min=0)=>Array.isArray(v)&&v.length>=min&&v.length<=max?v as unknown[]:dailyFail(p,`${min}〜${max}件の配列が必要です。`);
const string=(v:unknown,p:string,max:number)=>typeof v==='string'&&v.trim()&&v.length<=max?v:dailyFail(p,`空でない${max}文字以内の文字列が必要です。`);
const nullable=(v:unknown,p:string,max:number)=>v===null?null:string(v,p,max);
const choice=<T extends string>(v:unknown,p:string,allowed:readonly T[])=>typeof v==='string'&&allowed.includes(v as T)?v as T:dailyFail(p,`指定できる値：${allowed.join(' / ')}。`);
const bool=(v:unknown,p:string)=>typeof v==='boolean'?v:dailyFail(p,'true または false が必要です。');
const optionalBool=(v:unknown,p:string)=>v==null?null:bool(v,p);
const number=(v:unknown,p:string,min:number,max:number,integer=false)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&(!integer||Number.isInteger(v))?v:dailyFail(p,`${min}〜${max}の${integer?'整数':'数値'}を指定してください。`);
const distinct=<T>(v:T[],p:string)=>new Set(v).size===v.length?v:dailyFail(p,'重複があります。');
const strings=(v:unknown,p:string,max=24)=>distinct(list(v,p,max).map((s,i)=>string(s,`${p}[${i}]`,200)),p);
const tempRef=(v:unknown,p:string)=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v)?v:dailyFail(p,'英字で始まるパッケージ内の仮IDが必要です。');
const ref=(v:unknown,p:string):DailyRef=>typeof v==='number'?number(v,p,1,Number.MAX_SAFE_INTEGER,true):tempRef(v,p);
const ability=(v:unknown,p:string)=>typeof v==='string'&&capabilityById.has(v)?v:dailyFail(p,`能力マップにないIDです（${String(v)}）。`);
const day=(v:unknown,p:string)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:dailyFail(p,'実在する日付 YYYY-MM-DD が必要です。');
const timestamp=(v:unknown,p:string)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))&&day(v.slice(0,10),p)?v:dailyFail(p,'時差付きの実際の日時が必要です。');
const mayTimestamp=(v:unknown,p:string)=>v==null?null:timestamp(v,p);
const score=(v:unknown,p:string)=>{const x=object(v,p),max=number(x.max,p+'.max',0.001,10000);return {points:number(x.points,p+'.points',0,max),max}};
const errTypes=['K','W','N','C','none'] as const;
export const observedFailure=(x:DailyPart)=>x.status==='incorrect'||x.status==='partial';
export const observedPart=(x:DailyPart)=>x.status==='correct'||observedFailure(x);

export function decodeDailyLearning(raw:unknown,now=new Date().toISOString()):DailyLearningPackage{
 if(typeof raw!=='string'||!raw.trim()||raw.length>2_000_000)return dailyFail('日次JSON','1つのJSONを貼り付けてください（200万文字以内）。');
 const t=raw.trim(),fenced=t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);let parsed:unknown;
 try{parsed=JSON.parse(fenced?fenced[1]:t)}catch{return dailyFail('日次JSON','標準JSONとして読み取れません。原文を保持し、ChatGPTにJSONコードブロック1つだけを再出力させてください。');}
 const v=object(parsed,'日次JSON');
 choice(v.schema_version,'schema_version',[DAILY_LEARNING_VERSION]);choice(v.learning_goal,'learning_goal',['long_term_theory']);
 if(v.catalog_version!==CAPABILITY_CATALOG_VERSION)dailyFail('catalog_version','能力マップの版が異なります。朝の情報を取得し直してください。');
 const session_id=tempRef(v.session_id,'session_id'),learning_date=day(v.learning_date,'learning_date'),created_at=timestamp(v.created_at,'created_at');
 if(learning_date>capabilityDate(created_at)||Date.parse(created_at)>Date.parse(now)+300000)dailyFail('created_at','学習日より前、または端末時刻より未来です。');
 const problems=list(v.problems,'problems',24,1).map((r,i):DailyProblem=>{
  const p=`problems[${i}]`,x=object(r,p),ref=tempRef(x.ref,`${p}.ref`),existing_problem_id=x.existing_problem_id==null?undefined:string(x.existing_problem_id,`${p}.existing_problem_id`,150);
  if(existing_problem_id&&[x.statement,x.parts,x.title,x.theme].some(f=>f!=null))dailyFail(p,'既存問題は既存IDだけで参照します。問題文・採点項目を上書きできません。');
  const parts=existing_problem_id?undefined:list(x.parts,`${p}.parts`,24,1).map((u,j)=>{
   const z=object(u,`${p}.parts[${j}]`),id=string(z.id,`${p}.parts[${j}].id`,16);
   if(id!==`q${j+1}`)dailyFail(`${p}.parts[${j}].id`,`新しい問題の項目IDは順に q1, q2, … です（ここは q${j+1}）。`);
   return {id,label:string(z.label,`${p}.parts[${j}].label`,120)};
  });
  let quality:DailyQuality|null=null;
  if(x.quality!=null){const q=`${p}.quality`,y=object(x.quality,q),checks=object(y.checks,`${q}.checks`);
   quality={generator_pass_id:string(y.generator_pass_id,`${q}.generator_pass_id`,120),validator_pass_id:string(y.validator_pass_id,`${q}.validator_pass_id`,120),checked_at:timestamp(y.checked_at,`${q}.checked_at`),
    checks:Object.fromEntries(GENERATION_CHECKS.map(k=>{const at=`${q}.checks.${k}`,row=object(checks[k],at);return [k,{pass:bool(row.pass,at+'.pass'),evidence:string(row.evidence,at+'.evidence',800)}]})) as DailyQuality['checks']};
   if(Date.parse(quality.checked_at)>Date.parse(created_at))dailyFail(q,'品質確認日時がパッケージ作成日時より後です。');
  }
  const presented_at=mayTimestamp(x.presented_at,`${p}.presented_at`);
  if(presented_at&&Date.parse(presented_at)>Date.parse(created_at))dailyFail(p+'.presented_at','出題時刻がパッケージ作成日時より後です。');
  return {ref,...(existing_problem_id?{existing_problem_id}:{title:string(x.title,`${p}.title`,120),statement:string(x.statement,`${p}.statement`,16000),parts,
   ...(x.theme==null?{}:{theme:string(x.theme,`${p}.theme`,100)})}),purpose:choice(x.purpose,`${p}.purpose`,purpose),familiarity:choice(x.familiarity,`${p}.familiarity`,familiarity),
   shown:distinct(list(x.shown,`${p}.shown`,shown.length,1).map((z,j)=>choice(z,`${p}.shown[${j}]`,shown)),`${p}.shown`),presented_at,quality,
   target_ability_ids:distinct(list(x.target_ability_ids,`${p}.target_ability_ids`,12).map((z,j)=>ability(z,`${p}.target_ability_ids[${j}]`)),`${p}.target_ability_ids`),selection_reason:x.selection_reason==null?null:string(x.selection_reason,`${p}.selection_reason`,500)};
 });
 distinct(problems.map(p=>p.ref),'problems.ref');
 const byProblem=new Map(problems.map(p=>[p.ref,p])),seen=new Set<string>();
 const answers=list(v.answers,'answers',64,1).map((r,i):DailyAnswer=>{
  const p=`answers[${i}]`,x=object(r,p),answerRef=tempRef(x.ref,`${p}.ref`),problem_ref=tempRef(x.problem_ref,`${p}.problem_ref`),problem=byProblem.get(problem_ref);
  if(!problem)return dailyFail(`${p}.problem_ref`,'定義された仮問題IDが必要です。');
  if(seen.has(answerRef))dailyFail(`${p}.ref`,'答案IDが重複しています。');
  const kind=choice(x.kind,`${p}.kind`,Object.keys(dailyKindLabels) as DailyKind[]),baseline=x.baseline===null?null:ref(x.baseline,`${p}.baseline`);
  if((kind==='diagnostic'||kind==='exam')!==(baseline===null))dailyFail(`${p}.baseline`,'診断・本番練習は null、補修・再現・後日は元答案のIDが必要です。');
  if(typeof baseline==='string'&&!seen.has(baseline))dailyFail(`${p}.baseline`,'基準となる仮答案は answers の先に置いてください。');
  const answered_at=mayTimestamp(x.answered_at,`${p}.answered_at`),source=choice(x.source,`${p}.source`,sources);
  if(answered_at&&(capabilityDate(answered_at)!==learning_date||Date.parse(answered_at)>Date.parse(created_at)||problem.presented_at&&Date.parse(answered_at)<Date.parse(problem.presented_at)))
   dailyFail(`${p}.answered_at`,'学習日、出題、答案提出、作成日時の順序を確認してください。');
  const refData=object(x.reference,`${p}.reference`),level=refData.level==null?null:number(refData.level,`${p}.reference.level`,0,5,true);
  const reference={level,hint_used:optionalBool(refData.hint_used,`${p}.reference.hint_used`),method_cued:optionalBool(refData.method_cued,`${p}.reference.method_cued`),closed_reproduction:optionalBool(refData.closed_reproduction,`${p}.reference.closed_reproduction`)};
  if(level===0&&reference.hint_used===true||reference.closed_reproduction===true&&(kind!=='immediate_reproduction'||level!==0||reference.hint_used!==false))
   dailyFail(`${p}.reference`,'参照とヒント、または解説を閉じて別提出した直後再現の条件が矛盾しています。');
  const parts=list(x.parts,`${p}.parts`,24,1).map((r,j):DailyPart=>{
   const q=`${p}.parts[${j}]`,y=object(r,q),part_id=string(y.part_id,`${q}.part_id`,200),status=choice(y.status,`${q}.status`,Object.keys(dailyPartLabels) as PartStatus[]),error_type=choice(y.error_type,`${q}.error_type`,errTypes);
   const quote=nullable(y.quote,`${q}.quote`,2400),finding=string(y.finding,`${q}.finding`,700),concept_focus=y.concept_focus==null?undefined:choice(y.concept_focus,`${q}.concept_focus`,Object.keys(conceptFocusLabels) as ConceptFocus[]);
   if((status==='correct'||status==='incorrect'||status==='partial')&&(!quote||source==='unknown'))dailyFail(q,'実際の答案の引用と、GPTが確認した答案の出典が必要です。確認不能なら unreadable としてください。');
   if((status==='incorrect'||status==='partial')===(error_type==='none'))dailyFail(`${q}.error_type`,'未着手・判定不能・正解は none、観察できた誤りだけを K/W/N/C とします。');
   if((status==='unattempted'||status==='unreadable')&&(concept_focus||y.score!=null)||status==='unattempted'&&quote!==null)dailyFail(q,'白紙・判定不能を採点や概念の誤りに変換できません。');
   if(error_type==='K'&&y.k_evidence==null)dailyFail(`${q}.k_evidence`,'既存採点契約に沿うKの具体的根拠が必要です。');
   return {part_id,status,quote,finding,error_type,...(concept_focus?{concept_focus}:{}),...(y.score==null?{}:{score:score(y.score,`${q}.score`)}),
    ...(y.k_evidence==null?{}:{k_evidence:string(y.k_evidence,`${q}.k_evidence`,500)})};
  });
  distinct(parts.map(f=>f.part_id),`${p}.parts`);
  if(problem.parts&&parts.some(f=>!problem.parts!.some(z=>z.id===f.part_id)))dailyFail(`${p}.parts`,'問題に存在しない採点項目があります。');
  const first_error_part_id=x.first_error_part_id===null?null:string(x.first_error_part_id,`${p}.first_error_part_id`,200),
   affected_part_ids=strings(x.affected_part_ids,`${p}.affected_part_ids`),independent_error_part_ids=strings(x.independent_error_part_ids,`${p}.independent_error_part_ids`);
  const trace=[...(first_error_part_id?[first_error_part_id]:[]),...affected_part_ids,...independent_error_part_ids];
  if(new Set(trace).size!==trace.length||!first_error_part_id&&affected_part_ids.length||trace.some(id=>!parts.some(z=>z.part_id===id&&observedFailure(z))))dailyFail(`${p}.first_error_part_id`,'最初の誤り・波及・独立した誤りは、実際に観察された別々の未達項目です。');
  let repair:DailyRepair|undefined;
  if(x.repair!=null){const q=`${p}.repair`,y=object(x.repair,q);
   if(kind!=='local_repair'&&kind!=='immediate_reproduction')dailyFail(q,'補修・直後再現の答案だけに補修内容を結び付けます。');
   repair={ability_id:ability(y.ability_id,q+'.ability_id'),target:string(y.target,q+'.target',400),guidance:string(y.guidance,q+'.guidance',1200),unconfirmed:y.unconfirmed==null?null:string(y.unconfirmed,q+'.unconfirmed',450)};
  }
  if(kind==='local_repair'&&!repair)dailyFail(`${p}.repair`,'実際に行った局所補修と残る未確認点を記録してください。');
  const total=x.score===null?null:score(x.score,`${p}.score`);
  if(total&&parts.every(z=>z.score)&&['points','max'].some(key=>Math.abs(parts.reduce((sum,z)=>sum+z.score![key as keyof DailyScore],0)-total[key as keyof DailyScore])>0.001))dailyFail(`${p}.score`,'小問別の配点または得点の合計が一致しません。');
  seen.add(answerRef);
  return {ref:answerRef,problem_ref,kind,baseline,answered_at,source,reference,score:total,grading_confidence:x.grading_confidence==null?null:number(x.grading_confidence,`${p}.grading_confidence`,0,100),parts,
   first_error_part_id,affected_part_ids,independent_error_part_ids,...(repair?{repair}:{}),...(x.minutes==null?{}:{minutes:number(x.minutes,p+'.minutes',0.01,600)})};
 });
 if(problems.some(p=>!answers.some(a=>a.problem_ref===p.ref)))dailyFail('problems','提出答案に紐づかない問題は一括保存しません。');
 const evaluations=list(v.evaluations,'evaluations',24).map((r,i):DailyEvaluation=>{
  const p=`evaluations[${i}]`,x=object(r,p),ability_id=ability(x.ability_id,`${p}.ability_id`);
  const evidence=list(x.evidence,`${p}.evidence`,8,1).map((r,j):DailyEvidence=>{
   const q=`${p}.evidence[${j}]`,y=object(r,q),answer_ref=ref(y.answer_ref,`${q}.answer_ref`);
   if(typeof answer_ref!=='string'||!seen.has(answer_ref))dailyFail(`${q}.answer_ref`,'今回提出した仮答案IDを指定してください。過去答案は比較の基準にだけ使います。');
   const part_ids=strings(y.part_ids,`${q}.part_ids`),outcome=choice(y.outcome,`${q}.outcome`,['success','failure','partial','uncertain']),aspect=choice(y.aspect,`${q}.aspect`,theoryAspectKeys);
   if(!part_ids.length)dailyFail(`${q}.part_ids`,'今回採点した項目IDが1件以上必要です。');
   const concept_focus=y.concept_focus==null?undefined:choice(y.concept_focus,`${q}.concept_focus`,Object.keys(conceptFocusLabels) as ConceptFocus[]);
   if(concept_focus&&aspect!=='concept')dailyFail(`${q}.concept_focus`,'説明を採点した concept だけに指定できます。');
   let comparison:DailyComparison|undefined;
   if(y.comparison!=null){const z=object(y.comparison,`${q}.comparison`);comparison={against:ref(z.against,`${q}.comparison.against`),
    result:choice(z.result,`${q}.comparison.result`,Object.keys(dailyComparisonLabels) as DailyComparison['result'][]),reason:string(z.reason,`${q}.comparison.reason`,400)};}
   return {answer_ref,part_ids,outcome,aspect,observation:string(y.observation,`${q}.observation`,500),...(concept_focus?{concept_focus}:{}),...(comparison?{comparison}:{}),
    ...(y.structure_difference==null?{}:{structure_difference:string(y.structure_difference,`${q}.structure_difference`,500)})};
  });
  distinct(evidence.map(e=>canonicalValue([e.answer_ref,e.aspect,e.concept_focus,[...e.part_ids].sort()])),`${p}.evidence`);
  let next_check:DailyEvaluation['next_check']=null;
  if(x.next_check!==null){const q=`${p}.next_check`,y=object(x.next_check,q),basis=ref(y.basis,`${q}.basis`);
   if(!evidence.some(e=>e.answer_ref===basis))dailyFail(q+'.basis','次回提案の元は、この能力の今回の根拠答案を指定してください。');
   const kind=choice(y.kind,`${q}.kind`,Object.keys(capabilityKinds) as DailyKind[]),aspect=y.aspect==null?undefined:choice(y.aspect,`${q}.aspect`,theoryAspectKeys);
   if((aspect==='retention'&&kind!=='delayed_transfer')||y.interval_days!=null&&aspect!=='retention')dailyFail(q,'保持は delayed_transfer で指定し、日数は保持だけに設定します。');
   next_check={basis,kind,due_date:y.due_date===null?null:day(y.due_date,`${q}.due_date`),task:string(y.task,`${q}.task`,240),success_condition:string(y.success_condition,`${q}.success_condition`,240),
    ...(aspect?{aspect}:{}),...(y.interval_days==null?{}:{interval_days:number(y.interval_days,`${q}.interval_days`,1,365,true)}),...(y.estimated_minutes==null?{}:{estimated_minutes:number(y.estimated_minutes,`${q}.estimated_minutes`,1,240,true)})};
   if(next_check.due_date&&next_check.due_date<learning_date)dailyFail(q+'.due_date','次回確認日は学習日より前に設定できません。');
  }
  let recurrence_comparison:DailyEvaluation['recurrence_comparison'];
  if(x.recurrence_comparison!=null){
   const q=`${p}.recurrence_comparison`,y=object(x.recurrence_comparison,q),read=(k:'before'|'after')=>list(y[k],q+'.'+k,8,2).map((z,i)=>ref(z,`${q}.${k}[${i}]`));
   const before=read('before'),after=read('after');distinct([...before,...after],q);
   if(before.length!==after.length||!after.some(id=>evidence.some(e=>e.answer_ref===id)))dailyFail(q,'2件以上の同数の別答案を並べ、今回の確認結果を比較に含めてください。');
   recurrence_comparison={before,after,aspect:choice(y.aspect,q+'.aspect',theoryAspectKeys),reason:string(y.reason,q+'.reason',500)};
  }
  return {ability_id,state:choice(x.state,`${p}.state`,Object.keys(capabilityStates) as DailyEvaluation['state'][]),certainty:choice(x.certainty,`${p}.certainty`,['confirmed','provisional','conflicting']),
   judgement:string(x.judgement,`${p}.judgement`,500),cause_hypothesis:x.cause_hypothesis==null?null:string(x.cause_hypothesis,`${p}.cause_hypothesis`,500),
   ...(x.cause_confidence==null?{}:{cause_confidence:choice(x.cause_confidence,`${p}.cause_confidence`,['low','medium','high'] as const)}),evidence,next_check,...(recurrence_comparison?{recurrence_comparison}:{})};
 });
 distinct(evaluations.map(e=>e.ability_id),'evaluations.ability_id');
 const coaching_without_answer=list(v.coaching_without_answer??[],'coaching_without_answer',12).map((r,i):DailyCoaching=>{
  const p=`coaching_without_answer[${i}]`,x=object(r,p);
  return {baseline:ref(x.baseline,p+'.baseline'),ability_id:ability(x.ability_id,p+'.ability_id'),target:string(x.target,p+'.target',400),
   guidance:string(x.guidance,p+'.guidance',1200),unconfirmed:x.unconfirmed==null?null:string(x.unconfirmed,p+'.unconfirmed',450)};
 });
 distinct(coaching_without_answer.map(r=>canonicalValue([r.baseline,r.ability_id])),'coaching_without_answer');
 return {schema_version:DAILY_LEARNING_VERSION,session_id,learning_date,morning_context_version:string(v.morning_context_version,'morning_context_version',128),catalog_version:CAPABILITY_CATALOG_VERSION,
  created_at,learning_goal:'long_term_theory',source_status:choice(v.source_status,'source_status',['observed','limited']),departure_reason:v.departure_reason==null?null:string(v.departure_reason,'departure_reason',600),
  problems,answers,evaluations,coaching_without_answer};
}

export const qualityBeforeAnswer=(p:DailyProblem,a:DailyAnswer)=>p.purpose==='delayed_transfer'&&a.kind==='delayed_transfer'&&p.familiarity==='unseen'&&
 !!p.presented_at&&!!a.answered_at&&p.shown.length===1&&p.shown[0]==='statement'&&p.target_ability_ids.length>0&&
 a.reference.level===0&&a.reference.hint_used===false&&a.reference.method_cued===false&&a.source!=='unknown'&&
 !!p.quality&&p.quality.generator_pass_id!==p.quality.validator_pass_id&&GENERATION_CHECKS.every(k=>p.quality!.checks[k].pass)&&
 Date.parse(p.quality.checked_at)<=Date.parse(p.presented_at)&&Date.parse(p.presented_at)<Date.parse(a.answered_at);

export const dailyHash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

export function readDailyReceipts(meta:{key:string;value:string}[]){
 const receipts:DailyReceipt[]=[],issues:string[]=[];
 for(const row of meta){try{const v=JSON.parse(row.value) as DailyReceipt;
  if(v.version!==DAILY_LEARNING_VERSION||row.key!==DAILY_RECEIPT_PREFIX+v.session_id||!Array.isArray(v.answers)||!Array.isArray(v.problems)||!Array.isArray(v.evaluations)||
   !Array.isArray(v.coaching_without_answer)||!/^[0-9a-f]{64}$/.test(v.package_hash)||typeof v.archive_id!=='string'||typeof v.saved_at!=='string'||typeof v.learning_date!=='string'||
   v.answers.some(a=>!a||!Number.isSafeInteger(a.attempt_id)||typeof a.problem_id!=='string')||v.problems.some(p=>!p||typeof p.problem_id!=='string')||
   v.evaluations.some(e=>!e||!capabilityById.has(e.ability_id)||!Array.isArray(e.observations)))throw Error('format');
  receipts.push(v);
 }catch{issues.push(`保存済み日次記録 ${row.key} を読み取れません。原文は変更していません。`);}}
 return {receipts,issues};
}
