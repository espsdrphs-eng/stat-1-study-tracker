import type {Attempt,Bootstrap,Review,Task} from './types.ts';
import {deriveCurrentWeaknessRows,deriveProblemLearningViews} from './learningFeedback.ts';
import {resolveCanonicalProblemId} from './examReadiness.ts';
import {independentReferenceFree} from './skillEvidence.ts';
import {attemptPlanningEligible} from './legacyKPolicy.ts';
import {reviewExecutionState} from './integrityEngine.ts';
import {deriveTaskAnswerScope} from './taskAnswerScope.ts';
import {priorityRepairTasks} from './learningOverview.ts';
import {currentTaskIdentity} from './examOptimizationPolicy.ts';

export const studyScreens=[
 {key:'dashboard',label:'ホーム'},
 {key:'problems',label:'問題'},
 {key:'weak',label:'弱点'},
 {key:'transfer',label:'転移'},
] as const;

/** Presentation only. The planner, evidence gates and source records are unchanged. */
export function studyEvidenceKind(a:Attempt){
  if(a.source_type==='generated'||/^GEN-/.test(a.problem_id))return '生成訓練';
  if(a.transfer_lineage)return '既存問題の転移訓練';
 if(a.session_role==='counterfactual_calibration')return '後日・選択検証';
 if(a.learning_purpose==='error_repair')return '補修';
 if(a.learning_purpose==='retrieval_check')return '保持確認';
 if(a.learning_purpose==='transfer_check')return '別問題の確認';
 if(a.parent_past_session_id!=null&&a.exam_score_eligible===true)return '本番形式';
 if(a.is_review_attempt||a.task_origin==='review_attempt')return '再挑戦';
 return '個別演習';
}
export function scheduleRows(data:Bootstrap){
 return data.reviews.map(review=>{
  const state=reviewExecutionState(review,data.dashboard.today),problem=data.problems.find(p=>p.problem_id===review.problem_id);
  const scope=problem?deriveTaskAnswerScope({problem,task:review,attempts:data.attempts,overrides:data.taskAnswerScopeOverrides}):null;
  const check=state==='needs_review'||state==='stale'||state==='missing'||!problem||scope?.status==='conflict'||scope?.status==='unknown';
  const earliest=review.earliest_date||review.due_date;
  const waiting=earliest>data.dashboard.today;
  const phase=review.grading_contract?.learningPurpose||review.learning_purpose;
  return {review,problem,scope,state,earliest,waiting,phase,
   bucket:state==='completed'?'done':['superseded','invalid','expired_same_session'].includes(state)?'history':check?'check':state!=='actionable'?'history':waiting?'next':'due'};
 }).sort((a,b)=>(a.review.due_date||'9999').localeCompare(b.review.due_date||'9999')||a.review.id-b.review.id);
}
export function reviewTask(review:Review,data:Bootstrap):Task{
 const planned=data.today.tasks.find(t=>t.id===review.id&&t.problem_id===review.problem_id);
 return planned||{...review,title:data.problems.find(p=>p.problem_id===review.problem_id)?.display_label||review.problem_id,
  kind:'復習',load:0,minutes:review.estimated_minutes||12,mode:review.effective_mode||review.grading_contract?.mode||'full'} as Task;
}
/** One card per executable task, not one duplicate row per historical root.
 * The distinct scoped sources remain visible in details and are never merged. */
export function currentIssueTaskRows(data:Bootstrap){
 const groups=deriveCurrentWeaknessRows(data);
 return priorityRepairTasks(data).map(task=>({task,sources:groups.flatMap(g=>g.sources)
  .filter(s=>s.task&&currentTaskIdentity(s.task)===currentTaskIdentity(task))}));
}
/** Current scoped evidence, not counts of old weakNotes or a new mastery score.
 * Each date bar counts source operations with current unassisted evidence. It is
 * not cumulative: a later failure can invalidate an earlier current proof. */
export function deriveWorkspaceEvidence(data:Bootstrap){
 const groups=deriveCurrentWeaknessRows(data),sources=[...new Map(groups.flatMap(g=>g.sources).map(s=>[s.rootId,s])).values()];
 const byId=new Map(data.attempts.filter(attemptPlanningEligible).map(a=>[a.id,a]));
 const events:Array<{key:string;stage:'repair'|'retention'|'training'|'natural';date:string;attemptId:number;problemId:string;sourceProblemId:string}>=[];
 for(const s of sources){
  for(const [stage,id]of [['repair',s.repairAttemptId],['retention',s.retrievalAttemptId],
   [s.status==='本番転移確認済み'?'natural':'training',s.transferAttemptId]] as const){
   const a=id?byId.get(id):undefined;
   if(!a||!independentReferenceFree(a))continue;
   events.push({key:`${s.problemId}:${s.targetKeys.join('|')||s.rootId}:${stage}:${a.id}`,stage,date:a.date,attemptId:a.id,problemId:a.problem_id,sourceProblemId:s.problemId});
  }
 }
 const unique=[...new Map(events.map(e=>[e.key,e])).values()];
 const timeline=[...new Set(unique.map(e=>e.date))].sort().slice(-6).map(date=>({date,
  repair:unique.filter(e=>e.date===date&&e.stage==='repair').length,
  retention:unique.filter(e=>e.date===date&&e.stage==='retention').length,
  training:unique.filter(e=>e.date===date&&e.stage==='training').length,
  natural:unique.filter(e=>e.date===date&&e.stage==='natural').length,
  attemptIds:[...new Set(unique.filter(e=>e.date===date).map(e=>e.attemptId))]}));
 const schedule=scheduleRows(data);
 return {groups,sources,events:unique,timeline,
  overdue:schedule.filter(s=>s.bucket==='due'&&s.review.due_date<data.dashboard.today).length,
  nextRetention:schedule.find(s=>s.bucket==='next'&&s.phase==='retrieval_check'),
  recent:unique.sort((a,b)=>b.date.localeCompare(a.date)||b.attemptId-a.attemptId).slice(0,3)};
}

export const homeStateLabels={retained:'遅延再現確認済み',recheck:'改善・再確認待ち',repair:'要補修',unknown:'未評価・根拠不足'} as const;
export type HomeProblemState=keyof typeof homeStateLabels;
/** A read-only, problem-unit chart. The stricter shared list/detail projection
 * controls confirmation. A successful part, old transfer flag or raw GPT prose
 * must not certify a whole problem; generated exercises stay in another lane. */
export function deriveHomeEvidence(data:Bootstrap,provided?:ReturnType<typeof deriveWorkspaceEvidence>){
 const proof=provided||deriveWorkspaceEvidence(data),facts=data.attempts.filter(attemptPlanningEligible).filter(a=>!a.exclude_from_metrics&&!a.exclude_from_planning&&!a.duplicate_of_attempt_id);
 const views=deriveProblemLearningViews({...data,attempts:facts}),seen=new Set<string>();
 const problems=data.problems.filter(p=>!p.generated_transfer&&p.source_type!=='generated'&&!p.problem_id.startsWith('GEN-')).filter(p=>{
  const id=resolveCanonicalProblemId(p.problem_id,data.problemAliases||[]);if(seen.has(id))return false;seen.add(id);return true;
 }).map(problem=>{
  const id=resolveCanonicalProblemId(problem.problem_id,data.problemAliases||[]),v=views[problem.problem_id];
  const sources=proof.sources.filter(s=>resolveCanonicalProblemId(s.problemId,data.problemAliases||[])===id);
  const state:HomeProblemState=v.needsRepair?'repair':v.retentionConfirmed?'retained':v.waitingRetention||sources.some(s=>s.repairAttemptId||s.retrievalAttemptId)?'recheck':'unknown';
  const attempts=facts.filter(a=>resolveCanonicalProblemId(a.problem_id,data.problemAliases||[])===id);
  return {problem,view:v,state,learned:attempts.length>0,latestDate:attempts.map(a=>a.date).sort().at(-1)||null};
 });
 const counts={retained:0,recheck:0,repair:0,unknown:0};for(const p of problems)counts[p.state]++;
 const fields=[...new Set(problems.map(p=>p.problem.theme?.trim()||'分野未登録'))].map(name=>{
  const rows=problems.filter(p=>(p.problem.theme?.trim()||'分野未登録')===name),counts={retained:0,recheck:0,repair:0,unknown:0};for(const r of rows)counts[r.state]++;
  return {name,total:rows.length,counts,problemIds:rows.map(r=>r.problem.problem_id)};
 }).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
 const all=proof.sources,identified=all.filter(s=>!s.identityPending);
 const operations=proof.groups.filter(g=>!g.identityPending&&g.sources.some(s=>s.status==='補修が必要')).map(g=>{
  const sources=g.sources.filter(s=>s.status==='補修が必要'),skills=[...new Set(sources.flatMap(s=>s.skillIds))];
  return {id:g.id,skills,problemIds:[...new Set(sources.map(s=>s.problemId))],attemptIds:[...new Set(sources.map(s=>s.latestFailureAttemptId))]};
 }).sort((a,b)=>b.problemIds.length-a.problemIds.length||a.id.localeCompare(b.id));
 const notes=data.weakNotes||[],dates=notes.map(n=>n.date).filter(Boolean).sort();
 return {problems,views,counts,fields,operations,learned:problems.filter(p=>p.learned).length,
  // A global ability denominator is not defined for the unclassified roots.
  abilities:{confirmed:null,repair:null,identifiedSources:identified.length,unidentifiedSources:all.length-identified.length},
  legacyNotes:{total:notes.length,from:dates[0]||null,to:dates.at(-1)||null,counts:Object.fromEntries(['K','W','N','C','none'].map(k=>[k,notes.filter(n=>n.error_type===k).length]))}};
}
