import type {AdaptivePlannerShadow,Attempt,Bootstrap,CoachDiagnosis,ConceptWeaknessInsight,Dashboard,Problem,Review,Task} from './types.ts';
import type {ExamReadinessAssessment} from './examCapability.ts';
import {attemptPlanningEligible,findingPlanningEligible} from './legacyKPolicy.ts';
import {currentTaskIdentity} from './examOptimizationPolicy.ts';
import {deriveTaskAnswerScope,taskAnswerScopeText,type TaskAnswerScopeOverride} from './taskAnswerScope.ts';
import {currentTransferEvidence,findingEvidenceStatus,transferEvidenceStatus} from './skillEvidence.ts';
import {resolvePersistedAttemptLifecycle} from './reviewTransition.ts';
import {legacyAbilityId,abilityTrainingOutcome} from './abilityTraining.ts';

export type CoachReviewInput={history?:CoachDiagnosis[];attempts:Attempt[];reviews:Review[];problems:Problem[];
 concepts:ConceptWeaknessInsight[];dashboard:Dashboard;planner:AdaptivePlannerShadow;today:string;assessment?:ExamReadinessAssessment;
 tasks?:Task[];scopeOverrides?:Record<string,TaskAnswerScopeOverride>;masteryByProblem?:Bootstrap['masteryByProblem']};
const short=(s:unknown,max=180)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,max);
const latest=(rows:Attempt[])=>[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);

/** Read-only reduction of canonical facts. No new mastery, priority or score rule. */
export function buildCoachReviewFacts(args:CoachReviewInput){
 const attempts=latest(args.attempts.filter(a=>attemptPlanningEligible(a)&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id));
 const amap=new Map(attempts.map(a=>[a.id,a])),pmap=new Map(args.problems.map(p=>[p.problem_id,p]));
 const previous=latestReview(args.history||[]),cutoff=Math.max(0,...attempts.map(a=>a.id));
 const chosen=new Map<number,Set<string>>();
 const add=(a:Attempt|undefined,reason:string)=>{if(a){const reasons=chosen.get(a.id)||new Set<string>();reasons.add(reason);chosen.set(a.id,reasons);}};
 // New training results depend on saved answers, not diagnosis-history changes.
 const abilities=new Map<string,number>();for(const a of attempts){const id=a.transfer_lineage?.abilityProfile?.id;if(id&&(abilities.get(id)||0)<3){abilities.set(id,(abilities.get(id)||0)+1);add(a,'ability_training_result');}}
 // Optional profile updates must be able to cite the actual sources of a
 // provisional training, not only its latest generated answers. Bound by the
 // same three representative results per capability; never dump full history.
 for(const[id,reasons]of [...chosen])if(reasons.has('ability_training_result'))for(const s of amap.get(id)?.transfer_lineage?.abilityProfile?.sources||[])add(amap.get(s.attemptId),'ability_source');
 add(attempts.find(a=>!a.transfer_lineage&&(a.graded_findings||[]).some(f=>findingPlanningEligible(a,f)&&findingEvidenceStatus(a,f).outcome==='failure')),'provisional_candidate');
 const profileIds=new Set((previous?.abilityProfiles||[]).flatMap(p=>p.sources.map(s=>s.attemptId)));
 for(const ref of previous?.primaryBottleneck.evidenceIds||[])if(/^attempt:\d+$/.test(ref))profileIds.add(Number(ref.split(':')[1]));
 for(const id of previous?.primaryBottleneck.evidenceProblemIds||[]){const rows=attempts.filter(a=>a.problem_id===id);for(const a of [rows[0],rows.find(a=>a.id<=(previous?.evidenceCutoffAttemptId||0))])if(a)profileIds.add(a.id);}
 const profile_context=[...profileIds].map(id=>amap.get(id)).filter((a):a is Attempt=>!!a).map(a=>({id:`attempt:${a.id}`,problem:a.problem_id,date:a.date,
  findings:(a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)).map(f=>({part:f.graded_part_id,result:findingEvidenceStatus(a,f).outcome,evidence:f.evidence})),
  note:a.graded_findings?.length?undefined:a.error_point}));
 const tasks=(args.tasks||[]).filter(t=>!t.checked&&t.ranking?.eligible).sort((a,b)=>(a.ranking!.rank||Infinity)-(b.ranking!.rank||Infinity));
 const priorities=tasks.slice(0,3).map(t=>{
  const source=amap.get(t.repair_lineage?.sourceAttemptId||t.source_attempt_id||t.grading_contract?.sourceAttemptId||0);
  const current=attempts.find(a=>a.problem_id===t.problem_id);
  add(source,'current_task_source');add(current,'latest_same_problem');
  const p=pmap.get(t.problem_id),scope=p?taskAnswerScopeText(deriveTaskAnswerScope({problem:p,task:t,attempts,overrides:args.scopeOverrides})):'対象情報未登録';
  return {id:currentTaskIdentity(t),problem:t.problem_id,scope,purpose:t.grading_contract?.learningPurpose||t.learning_purpose||t.kind,
   minutes:t.minutes,refs:[...new Set([source?.id,current?.id].filter((id):id is number=>!!id).map(id=>`attempt:${id}`))],
   goal:short(t.grading_contract?.completionCriteria.map(c=>c.displayText).filter(Boolean).join(' / '),220)};
 });
 const metricKeys=['selectedThree','timed','selection','transfer','trainingTransfer','historicalRetest'] as const;
 const metrics=Object.fromEntries(metricKeys.map(key=>{const m=args.dashboard.readiness.evidence?.[key];return [key,
  {id:`metric:${key}`,date:m?.lastUpdated??null,...(m?.statusCounts?{status:m.statusCounts}:
   {value:m&&m.evidenceCount>0?m.value:null,n:m?.numerator??0,d:m?.denominator??0,samples:m?.evidenceCount??0})}];}));
 const measuredSessions=args.dashboard.readiness.evidence?.selectedThree?.sessions||[];
 // Keep a non-recent worst session as well as the latest measurement, not last-N answers.
 const representativeSessions=[...new Map([measuredSessions[0],[...measuredSessions].sort((a,b)=>a.score-b.score)[0]].filter(Boolean).map(s=>[s.sessionId,s])).values()];
 const sessions=representativeSessions.map(s=>({id:`session:${s.sessionId}`,year:s.year,score:s.score,attempt_ids:s.attemptIds||[]}));
 // These are explicitly linked measurement answers, not automatic skill assignments.
 // Keep latest/worst measurements bounded; aggregate timing alone proves no math deficit.
 for(const s of representativeSessions)for(const id of s.attemptIds||[])add(amap.get(id),'benchmark_candidate');
 const transfers=currentTransferEvidence(attempts),confirmed=new Set(transfers.map(e=>e.successAttemptId));
 const trainingLatest=[...new Map([...attempts].reverse().filter(a=>a.transfer_lineage).map(a=>[a.transfer_lineage!.key,a])).values()];
 const training={success:0,failure:0,uncertain:0,assisted:0},ability_training={success:0,failure:0,uncertain:0,assisted:0};
 for(const a of trainingLatest){if(a.transfer_lineage?.abilityProfile){ability_training[abilityTrainingOutcome(a)]++;continue;}const s=transferEvidenceStatus(a,confirmed.has(a.id));const key:keyof typeof training=s.assisted?'assisted':s.outcome==='success'?'success':s.outcome==='failure'?'failure':'uncertain';training[key]++;}
 const outcome=(a:Attempt)=>a.transfer_lineage?.abilityProfile?abilityTrainingOutcome(a):a.transfer_lineage?transferEvidenceStatus(a,confirmed.has(a.id)).outcome:
  resolvePersistedAttemptLifecycle(a).graduated?'retained':
  (a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)).map(f=>findingEvidenceStatus(a,f).outcome).includes('failure')?'failure':
  (a.graded_findings||[]).some(f=>findingEvidenceStatus(a,f).outcome==='success')?'scoped_success':'uncertain';
 const seen=new Set<string>();
 for(const a of attempts){
  const purpose=a.transfer_lineage?'transfer_training':a.learning_purpose;
  if(!['exam_performance','error_repair','retrieval_check','transfer_training'].includes(purpose||''))continue;
  const category=`${purpose}:${outcome(a)}`;
  if(!seen.has(category)){seen.add(category);add(a,category);}
 }
 const evidence=[...chosen].map(([id,reasons])=>{const a=amap.get(id)!;
  const relevant=new Set(tasks.filter(t=>t.problem_id===a.problem_id).flatMap(t=>t.repair_lineage?.sourceFindingIds||t.targeted_parts||t.grading_contract?.gradedParts.map(p=>p.id)||[]));
  const priority=reasons.has('current_task_source')||reasons.has('latest_same_problem')||reasons.has('ability_training_result')||reasons.has('ability_source')||reasons.has('provisional_candidate')||reasons.has('benchmark_candidate');
  const eligible=(a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)).sort((a,b)=>
   Number(relevant.has(b.graded_part_id))-Number(relevant.has(a.graded_part_id))||Number(!b.resolved)-Number(!a.resolved));
  // Keep all scoped priority evidence intact. Other examples are explicit excerpts.
  const findings=(priority?eligible:eligible.slice(0,3)).map(f=>{const s=findingEvidenceStatus(a,f),full=String(f.evidence||'').trim(),evidence=priority?full:short(full,240);
   return {part:f.graded_part_id,result:s.outcome,skills:s.skillIds,evidence,...(evidence.length<full.length?{excerpt:true}:{})};});
  return {id:`attempt:${id}`,problem:a.problem_id,date:a.date,purpose:a.transfer_lineage?'transfer_training':a.learning_purpose,
   role:[...reasons],result:outcome(a),assisted:!!a.hint_used||Number(a.actual_reference_level??a.reference_level)>0,
   findings,...(!findings.length?{note:short(a.error_point)}:{}),
   ...(a.transfer_lineage?{source:a.transfer_lineage.sourceProblemId,skill:a.transfer_lineage.rootSkillId,
    ...(a.transfer_lineage.abilityProfile?{ability:a.transfer_lineage.abilityProfile.id,targetAssessment:a.target_skill_assessment}: {})}: {})};
 });
 const newAttempts=attempts.filter(a=>a.id>(previous?.evidenceCutoffAttemptId??0));
 const concepts=[...args.concepts].filter(c=>!['resolved','unassessed'].includes(c.state)).sort((a,b)=>b.priorityScore-a.priorityScore).slice(0,4)
  .map(c=>({id:`concept:${c.conceptId}`,name:c.displayName,state:c.state,failures:c.independentFailures,delayed:c.delayedNoReferenceSuccesses,
   transfer:c.transferSuccesses,confidence:c.evidenceConfidence,next:short(c.nextRecommendedAction,140)}));
 return {date:args.today,days_remaining:args.planner.daysRemaining,cutoff,
  automatic:{level:args.assessment?.level??null,readiness:args.assessment?.label||'判定材料不足',confidence:args.assessment?.confidence||'low'},
  metrics,sessions,priorities,concepts,evidence,training,ability_training,profile_context,
  retention:{confirmedProblems:args.masteryByProblem?Object.values(args.masteryByProblem).filter(m=>m.normalReviewComplete&&m.levels.some(l=>l.status==='retained'&&l.retainedTargetCount>0)).length:null,
   pending:args.reviews.filter(r=>['pending','overdue'].includes(r.status)&&r.learning_purpose==='retrieval_check').length},
  previous:previous?{at:previous.reviewedAt,cutoff:previous.evidenceCutoffAttemptId,level:previous.level.value,bottleneck:short(previous.primaryBottleneck.title),ability_profiles:previous.abilityProfiles||[],legacy_ability_id:legacyAbilityId(previous.primaryBottleneck.title)}:null,
  since_previous:{new_valid_attempts:previous?newAttempts.length:null,by_purpose:Object.fromEntries([...new Set(newAttempts.map(a=>a.learning_purpose||'unknown'))].map(p=>[p,newAttempts.filter(a=>(a.learning_purpose||'unknown')===p).length])),
   warning:'件数は実施量。改善の断定は対象内の成功・失敗と参照記録を比較。過去評価時の測定値がない項目の差は不明。'}};
}
export const latestReview=(rows:CoachDiagnosis[])=>[...rows].sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt)||b.evidenceCutoffAttemptId-a.evidenceCutoffAttemptId)[0];
export function coachFactReferences(facts:ReturnType<typeof buildCoachReviewFacts>){
 return [...new Set([...Object.values(facts.metrics).map(m=>m.id),...facts.sessions.map(s=>s.id),...facts.evidence.map(e=>e.id),...facts.profile_context.map(e=>e.id),...facts.concepts.map(c=>c.id)])].sort();
}
/** Same non-signature fingerprint convention as coachEvidenceVersion. History-only
 * additions must not invalidate their own evaluation; current scope/metrics must. */
export function coachFactsVersion(facts:ReturnType<typeof buildCoachReviewFacts>){
 // Profile-context excerpts are chosen from the previous diagnosis. All their
 // underlying answers are already bound by coachReviewContext's full-history
 // fingerprint; a new diagnosis must not invalidate itself merely by choosing
 // different representative excerpts. Scope and objective facts remain bound.
 const {previous,since_previous,profile_context,...current}=facts;
 let hash=2166136261;for(const c of JSON.stringify(current))hash=Math.imul(hash^c.charCodeAt(0),16777619);
 return `coach-facts-v2:${(hash>>>0).toString(36)}`;
}
