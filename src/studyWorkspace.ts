import type {Attempt,Bootstrap,Review,Task} from './types.ts';
import {deriveCurrentWeaknessRows} from './learningFeedback.ts';
import {independentReferenceFree} from './skillEvidence.ts';
import {attemptPlanningEligible} from './legacyKPolicy.ts';
import {reviewExecutionState} from './integrityEngine.ts';
import {deriveTaskAnswerScope} from './taskAnswerScope.ts';
import {priorityRepairTasks} from './learningOverview.ts';
import {currentTaskIdentity} from './examOptimizationPolicy.ts';

export const studyScreens=[
 {key:'dashboard',label:'ダッシュボード'},
 {key:'problems',label:'問題・答案履歴'},
 {key:'reviews',label:'復習・転移'},
 {key:'weak',label:'現在の課題'},
 {key:'import',label:'GPT連携'},
] as const;

/** Presentation only. The planner, evidence gates and source records are unchanged. */
export function studyEvidenceKind(a:Attempt){
 if(a.transfer_lineage||a.source_type==='generated'||/^GEN-/.test(a.problem_id))return '生成訓練';
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
