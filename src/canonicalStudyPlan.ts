import type {Attempt,CanonicalStudyPlan,ConceptWeaknessInsight,ExamReferenceCatalogItem,PastExamRepairCandidate,PastSession,Problem,Review,Task} from "./types.ts";
import {deriveCurrentActionClass,prioritizeCurrentTodayTasks,reviewPlanningDecision} from "./todayLearningPolicy.ts";
import {currentActionFingerprint,currentTaskIdentity,isPastExamSessionTask} from "./examOptimizationPolicy.ts";
import {taskFieldsFromContract,buildGradingContractSnapshot} from "./gradingContract.ts";
import {reviewExecutionState} from "./reviewCurrentState.ts";
import {attemptPlanningEligible} from "./legacyKPolicy.ts";
import {resolvePersistedAttemptLifecycle} from "./reviewTransition.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";
import {buildPastExamYearCandidates,derivePastExamRoleRelease,derivePastExamSessionAdmission,derivePastExamSessionState,derivePastExamShortCorrection,pastExamSessionKey,pastExamSessionPurpose,stablePastExamSessionKey,selectedProblemIds,validatePastExamTaskIdentity} from "./pastExamPlanning.ts";

const stableHash=(value:string)=>[...value].reduce((hash,char)=>Math.imul(hash^char.charCodeAt(0),16777619)>>>0,2166136261).toString(16);

/**
 * The sole user-facing action projection. It does not mutate the immutable
 * start-of-day snapshot; it classifies and orders current eligible tasks.
 */
export function deriveCanonicalStudyPlan(args:{tasks:Task[];today:string;generatedAt?:string;ranked?:CanonicalStudyPlan["ranked"]}):CanonicalStudyPlan{
  const tasks=prioritizeCurrentTodayTasks(args.tasks,args.today);
  const open=tasks.filter(task=>!task.checked);
  const examPractice=open.filter(task=>deriveCurrentActionClass(task)==="exam_practice"&&task.triage!=="tomorrow");
  const requiredRepairs=open.filter(task=>deriveCurrentActionClass(task)==="targeted_repair"&&task.triage!=="tomorrow");
  const optionalMaintenance=open.filter(task=>deriveCurrentActionClass(task)==="maintenance");
  const optionalExtras=open.filter(task=>task.triage==="tomorrow"&&deriveCurrentActionClass(task)!=="maintenance");
  const required=[...examPractice,...requiredRepairs].sort((a,b)=>tasks.indexOf(a)-tasks.indexOf(b));
  const primaryAction=args.ranked?open.find(task=>task.ranking?.eligible)||null:required[0]||null;
  const examPracticeMinutes=examPractice.reduce((sum,task)=>sum+Number(task.minutes||0),0);
  const requiredRepairMinutes=requiredRepairs.reduce((sum,task)=>sum+Number(task.minutes||0),0);
  const optionalMinutes=[...optionalMaintenance,...optionalExtras].reduce((sum,task)=>sum+Number(task.minutes||0),0);
  const requiredTotal=examPracticeMinutes+requiredRepairMinutes;
  const sourceStateVersion=stableHash(tasks.map(task=>[
    currentActionFingerprint(task,task.id&&task.review_type?task:undefined),task.checked?1:0,task.triage||"",task.ranking?JSON.stringify(task.ranking):""
  ].join(":")).join("|"));
  const optionalTasks=[...optionalMaintenance.filter(task=>task.triage!=="tomorrow"),...optionalExtras];
  const deferredTasks=open.filter(task=>task.triage==="tomorrow"||deriveCurrentActionClass(task)==="maintenance");
  const reasons=[primaryAction?String(primaryAction.why_today||primaryAction.reason||""):"現在の必須課題はありません"];
  return {ranked:args.ranked,primaryAction,examPractice,requiredRepairs,optionalMaintenance,optionalExtras,
    examPracticeTasks:examPractice,requiredRepairTasks:requiredRepairs,optionalTasks,deferredTasks,
    pastExamSession:examPractice.find(task=>!!task.stable_session_key)||null,
    rollingAllocation:{examPracticeMinutes,requiredRepairMinutes,optionalMinutes,
      examPracticeShare:requiredTotal?examPracticeMinutes/requiredTotal:null},
    reasons,decisionReasons:reasons,
    generatedAt:args.generatedAt||new Date().toISOString(),sourceStateVersion};
}

/** Full evidence-based pool, BEFORE pagination. No calendar slot, quota or daily
 * capacity enters eligibility. This extends the existing canonical plan; there
 * is no persisted queue and no second lifecycle/transfer engine. */
export function deriveRankedStudyCandidates(args:{today:string;daysRemaining:number;problems:Problem[];attempts:Attempt[];
  reviews:Review[];pastSessions:PastSession[];catalog:ExamReferenceCatalogItem[];weaknesses:ConceptWeaknessInsight[];
  repairCandidates:PastExamRepairCandidate[];taskPostponements?:Array<{problem_id:string;kind:string;stable_session_key?:string;postponed_to:string}>}){
  const tasks:Task[]=[],waiting:Array<{task:Task;reason:string;reevaluateWhen:string}>=[],dataQualityWarnings:string[]=[];
  const pmap=new Map(args.problems.map(p=>[p.problem_id,p]));
  const valid=args.attempts.filter(attemptPlanningEligible),latest=new Map<string,Attempt>();
  for(const a of [...valid].sort((a,b)=>b.id-a.id))if(!latest.has(a.problem_id))latest.set(a.problem_id,a);
  const graduated=(id:string)=>{const a=latest.get(id);return !!a&&resolvePersistedAttemptLifecycle(a).graduated&&
    !args.reviews.some(r=>r.problem_id===id&&["pending","overdue"].includes(r.status)&&!r.exclude_from_planning&&
      (r.grading_contract?.learningPurpose||r.learning_purpose)==="error_repair");};
  const selectedIds=new Set(args.pastSessions.filter(s=>s.session_kind==="selected_three_timed").flatMap(selectedProblemIds));
  const catalogById=new Map(args.catalog.map(p=>[p.canonicalProblemId,p]));
  const yearCandidates=buildPastExamYearCandidates({...args,weaknesses:args.weaknesses});
  const allowedYears=new Set(yearCandidates.map(y=>y.year));
  const release=derivePastExamRoleRelease(args);
  const dayDiff=(from:string)=>Math.max(0,Math.floor((Date.parse(args.today)-Date.parse(from))/86400000)||0);
  const originDate=(task:Task)=>task.earliest_date||valid.find(a=>a.id===task.source_attempt_id)?.date||
    valid.filter(a=>a.problem_id===task.problem_id).sort((a,b)=>a.id-b.id)[0]?.date||
    (task.past_exam_year?args.pastSessions.filter(s=>s.year===task.past_exam_year).map(s=>String(s.date)).sort()[0]:undefined)||
    args.today; // Unknown candidate age is zero, not a fabricated waiting date.
  const add=(task:Task,band:number,category:string,reason:string,evidenceIds:string[]=[])=>{
    const postponed=args.taskPostponements?.find(row=>task.stable_session_key?row.stable_session_key===task.stable_session_key:
      !row.stable_session_key&&row.problem_id===task.problem_id&&row.kind===task.kind);
    if(postponed&&(postponed.postponed_to==="unscheduled"||postponed.postponed_to>args.today)){
      waiting.push({task,reason:"明示的な延期",reevaluateWhen:postponed.postponed_to});return;
    }
    const wait=dayDiff(originDate(task));
    task.ranking={version:"learning-value-v1",rank:0,band,category,waitingDays:wait,evidenceIds,reasons:[reason],eligible:true};
    task.today_category=task.action_class==="exam_practice"?"exam_practice":"repair";
    // `if_time` is a compatibility transport value, NOT a daily admission or
    // instruction to finish the whole pool. Execution uses current eligibility.
    task.triage="if_time";task.why_today=reason;task.reason=reason;task.plan_origin="adaptive_planner";
    tasks.push(task);
  };
  const base=(id:string,kind:string,mode:string,minutes:number):Task=>({problem_id:id,title:pmap.get(id)?.display_label||pmap.get(id)?.title||id,
    kind,mode,minutes,load:0,reason:"",checked:false});
  const actionable=args.reviews.filter(r=>reviewExecutionState(r,args.today)==="actionable");
  const reviewed=new Set(actionable.map(r=>r.problem_id));
  for(const review of args.reviews){
    if(!["pending","overdue"].includes(review.status)||review.exclude_from_planning)continue;
    const problem=pmap.get(review.problem_id);if(!problem)continue;
    const contract=review.grading_contract,purpose=contract?.learningPurpose||review.learning_purpose;
    const candidate=args.repairCandidates.find(c=>c.sourceProblemId===review.problem_id&&c.required&&c.repairKind!=="transfer");
    const task={...base(review.problem_id,purpose==="retrieval_check"?"遅延保持":"局所補修",contract?.mode||review.effective_mode||"check",
      Number(contract?.estimatedMinutes||review.estimated_minutes||review.duration_minutes||10)),...review,
      ...(contract?taskFieldsFromContract(contract):{}),review_type:review.review_type||"targeted_review",checked:false,load:0} as Task;
    const decision=reviewPlanningDecision({...args,review,pastExamIsPrimary:true});
    const isPast=problem.source_type==="past_exam"||problem.category==="past_exam";
    const wbMatch=args.repairCandidates.find(c=>c.required&&c.repairKind==="whitebook"&&c.matchConfidence==="high"&&c.whitebookProblemIds.includes(review.problem_id)&&
      !!c.sourceFindingIds?.length&&!!c.weaknessSkillIds?.length&&!!c.matchedSkillIds?.length&&c.sourceProblemId.startsWith("PY-"));
    if(!isPast&&!wbMatch){
      const suspected=!!review.source_problem_id?.startsWith("PY-")||!!review.parent_past_session_id||!!review.generated_from_past_session_id||
        !!problem.linked_past_exams;
      if(suspected)dataQualityWarnings.push(`${review.problem_id} / Review ${review.id}: 過去問関連の記録はあるがhigh-confidence operation lineage未確認`);
      waiting.push({task,reason:decision.reason,reevaluateWhen:"有効な過去問失点とhigh-confidence operation lineageが確認された時"});continue;
    }
    if(graduated(review.problem_id)&&purpose!=="transfer_check")continue;
    if(reviewExecutionState(review,args.today)!=="actionable"||String(review.earliest_date||review.due_date)>args.today||
      !!review.postponed_to&&(review.postponed_to==="unscheduled"||review.postponed_to>args.today)){
      waiting.push({task,reason:"保持間隔・延期・実行資格を維持",reevaluateWhen:review.postponed_to||review.earliest_date||review.due_date});continue;
    }
    if(candidate?.interventionChanged){
      task.kind="局所再診断";task.purpose_label="教材確認・足場付き局所補修 → 後日の参照なし確認";
      // Do not change a locked grading contract/reference allowance. A diagnosis
      // is materialized separately below; its ordinary Review remains waiting.
      waiting.push({task,reason:candidate.reason,reevaluateWhen:"再診断・局所scaffold後の有効な成功/失敗記録"});continue;
    }
    task.action_class="targeted_repair";task.direct_exam_loss=selectedIds.has(review.problem_id);
    task.review_planning_tier=decision.tier;
    if(wbMatch)task.repair_lineage={...wbMatch,rootConceptId:wbMatch.conceptId,repairProblemId:review.problem_id};
    task.diagnostic_only=isPast&&!selectedIds.has(review.problem_id)&&args.pastSessions.some(s=>s.year===Number(review.problem_id.match(/^PY-(\d+)/)?.[1])&&s.session_kind==="selected_three_timed");
    const source=valid.find(a=>a.id===(contract?.sourceAttemptId||review.source_attempt_id));
    task.hard_blocker=!!source&&deriveFailureEpisode(source).rootWeaknesses.some(root=>root.requiredRepair&&
      root.masteryLevel===1&&root.errorTypes.includes("K")&&root.confidence==="high"&&
      (contract?.gradedParts||[]).some(p=>root.sourceFindingIds.includes(p.id)));
    const band=task.hard_blocker?0:purpose==="retrieval_check"?(decision.scheduleAsRequired?5:6):
      decision.scheduleAsRequired?(task.diagnostic_only?6:2):6;
    add(task,band,purpose==="retrieval_check"?"保持":"補修",decision.reason,[`review:${review.id}`,`attempt:${task.source_attempt_id||review.source_attempt_id||"unknown"}`]);
  }
  const usedRoots=new Set<string>();
  for(const c of args.repairCandidates){
    const root=c.rootWeaknessId||`${c.sourceProblemId}:${c.conceptId}`;
    if(usedRoots.has(root))continue;usedRoots.add(root);
    if(c.repairKind==="transfer_wait"||c.transferTraining?.kind==="pending"){
      waiting.push({task:base(c.sourceProblemId,"転移待機","check",0),reason:c.reason,reevaluateWhen:"参照なし遅延保持・明示skill候補・benchmarkの条件が満たされた時"});continue;
    }
    if(!c.required)continue;
    if(c.repairKind!=="transfer"&&graduated(c.sourceProblemId))continue;
    if(c.repairKind!=="transfer"&&!c.interventionChanged&&actionable.some(r=>r.problem_id===c.sourceProblemId))continue;
    const training=c.transferTraining;
    const id=training?.generatedProblemId||training?.existingProblemId||(c.repairKind==="transfer"?c.transferProblemIds[0]:
      c.repairKind==="whitebook"&&c.matchConfidence==="high"?c.whitebookProblemIds[0]:c.sourceProblemId);
    if(!id&& !training)continue;
    const repairId=id||c.sourceProblemId;
    if(c.repairKind==="whitebook"&&!(c.matchConfidence==="high"&&c.sourceFindingIds?.length&&c.weaknessSkillIds?.length&&c.matchedSkillIds?.length))continue;
    if(tasks.some(t=>t.problem_id===repairId&&!isPastExamSessionTask(t))&&c.repairKind!=="transfer"){
      waiting.push({task:base(repairId,"同問題の別target","skeleton",7),reason:"同問題の有効な補修を先に実施し、結果から残るtargetを再評価",reevaluateWhen:"現在の補修記録保存後"});continue;
    }
    const task=base(repairId,training?"転移確認":c.interventionChanged?"局所再診断":c.repairKind==="transfer"?"別問題確認":"局所補修",
      training||c.repairKind==="transfer"?"full":"skeleton",training?12:c.repairKind==="transfer"?35:c.repairKind==="whitebook"?15:7);
    task.source_attempt_id=c.sourceAttemptId;task.action_class="targeted_repair";
    task.learning_purpose=c.repairKind==="transfer"?"transfer_check":"error_repair";
    if(training){task.transfer_training_key=training.key;task.title="転移確認";}
    else task.repair_lineage={...c,rootConceptId:c.conceptId,repairProblemId:repairId,intervention:c.interventionChanged?"rediagnosis":undefined};
    if(c.repairKind!=="transfer"){
      const built=buildGradingContractSnapshot({review:{...task,learning_stage:"repair",assessment_timing:"same_session_correction",
        review_scope:"targeted_patch",targeted_parts:c.sourceFindingIds,allowed_reference_level:c.interventionChanged?3:0},
        problem:pmap.get(repairId),sourceAttempt:valid.find(a=>a.id===c.sourceAttemptId),createdAt:`${args.today}T00:00:00Z`});
      if(built.needsReview){waiting.push({task,reason:"局所補修の採点scopeを確定できません",reevaluateWhen:"有効なtargetと採点契約を確認した時"});continue;}
      Object.assign(task,taskFieldsFromContract(built.contract),{grading_contract:built.contract});
    }
    task.direct_exam_loss=selectedIds.has(c.sourceProblemId);
    add(task,c.repairKind==="transfer"?5:task.direct_exam_loss?2:3,c.repairKind==="transfer"?"転移":"補修",
      training?"補修・遅延保持後の別問題1問で確認。本番の転移証拠とは区別します。":c.reason,[`attempt:${c.sourceAttemptId}`,root]);
  }
  const active=args.pastSessions.find(s=>s.session_kind==="selected_three_timed"&&
    !["completed","cancelled","invalidated","deferred"].includes(derivePastExamSessionState(s))&&!s.superseded_by_session_id&&
    derivePastExamSessionAdmission({...args,year:s.year,session:s}).required);
  const reserved=new Set<number>();
  for(const row of yearCandidates){
    const own=args.pastSessions.find(s=>s.year===row.year&&s.session_kind==="selected_three_timed"&&!s.superseded_by_session_id&&
      !["completed","cancelled","invalidated","deferred"].includes(derivePastExamSessionState(s)));
    const admission=derivePastExamSessionAdmission({...args,year:row.year,session:own,clean:row.cleanScanEligible});
    const session=base(row.eligibleRows[0].canonicalProblemId,"本番測定","exam_90min",90);
    session.title=`${row.year}年 本番型session`;session.past_exam_year=row.year;session.past_exam_year_role=row.yearRole;
    session.past_exam_task_type=own&&pastExamSessionPurpose(own)==="simulation"?"simulation":"timed_three_question_session";session.session_problem_ids=row.rows.map(p=>p.canonicalProblemId);
    session.stable_session_key=own?pastExamSessionKey(own):stablePastExamSessionKey({year:row.year,purpose:"timed_three_question_session",sessionInstanceId:`session-${row.year}-1`});
    session.clean_selection_evidence=row.cleanScanEligible||own?.exposure_snapshot_at_start?.classification==="clean";
    session.past_exam_session_state=own?derivePastExamSessionState(own):"planned";session.session_workflow="5問scan → 3問選択 → 3問答案 → 採点（scan込み90分）";
    session.selected_year_reason=`${row.year}年: ${row.yearRole} / ${row.exposedCount}/${row.rows.length}問既露出。${row.sessionAdmission?.reason||"現在の能力を本番形式で測定"}`;
    if(!validatePastExamTaskIdentity(session).valid)continue;
    if(row.completedTimed&&!own)continue;
    if(active&&active.year!==row.year){waiting.push({task:session,reason:"開始済み本番sessionを先に完了",reevaluateWhen:`session ${active.id} terminal`});reserved.add(row.year);continue;}
    if(!admission.required){
      waiting.push({task:session,reason:admission.reason,reevaluateWhen:"full形式の再測定が必要な未解決証拠が得られた時"});continue;
    }
    reserved.add(row.year);session.action_class="exam_practice";
    add(session,active?.year===row.year?1:4,"本番測定",admission.reason);
  }
  for(const p of args.problems.filter(p=>p.source_type==="past_exam"||p.category==="past_exam")){
    const row=catalogById.get(p.problem_id),year=Number(p.problem_id.match(/^PY-(\d+)/)?.[1]);
    if(!row||!row.schedulable||!row.gradable||p.schedulable===false||p.gradable===false)continue;
    const task=base(p.problem_id,"過去問攻略","full",35);task.action_class="exam_practice";task.learning_purpose="exam_performance";
    if(!allowedYears.has(year)){
      task.past_exam_year=year;
      const blockers=release.pendingRoots.map(({attempt,root})=>`${root.rootWeaknessId} (Attempt ${attempt.id})`);
      waiting.push({task,reason:year===2024&&blockers.length?`benchmark前の最小major補修が未成功: ${blockers.join(", ")}`:
        "年度の本番測定・historical retest保護条件が未達",reevaluateWhen:year===2024?
        "release window内でclean測定と必要最大2 major rootのrepair成功（保持全件は要求しない）":
        "current benchmark完了後、後続本番演習またはtransfer確認とrelease window"});continue;
    }
    if(graduated(p.problem_id)||reviewed.has(p.problem_id)||tasks.some(t=>!isPastExamSessionTask(t)&&t.problem_id===p.problem_id))continue;
    if(reserved.has(year)){waiting.push({task,reason:"年度のblind本番測定を先に実施し、個別先行露出を避ける",reevaluateWhen:"同年度本番session terminal"});continue;}
    const a=latest.get(p.problem_id);
    if(a&&["○","◎"].includes(a.mark)&&a.review_outcome!=="failed")continue;
    add(task,1,"未完成過去問",a?"未完成の過去問。現在の未習得部分を確認し答案化する":"未着手過去問で現在の得点能力を測る",a?[`attempt:${a.id}`]:[]);
  }
  const correction=derivePastExamShortCorrection(args);
  if(correction){const task=base(`PY-${correction.year}-Q1`,"scan・時間較正","scan5",10);
    task.title=`${correction.year}年 scan・時間較正`;task.past_exam_year=correction.year;task.past_exam_task_type="practice_scan5";
    task.session_problem_ids=args.catalog.filter(p=>p.year===correction.year).map(p=>p.canonicalProblemId);
    task.stable_session_key=correction.stableSessionKey;task.clean_selection_evidence=false;task.action_class="exam_practice";
    task.selected_year_reason=correction.reason;task.session_workflow="5問scan・得点予測・scan込み90分の答案配分を補正";
    if(validatePastExamTaskIdentity(task).valid)add(task,4,"時間較正",correction.reason);}
  const seen=new Set<string>();
  const recentInterventions=(task:Task)=>new Set(valid.filter(a=>a.problem_id===task.problem_id&&
    ["error_repair","retrieval_check"].includes(String(a.learning_purpose))&&dayDiff(a.date)<=7).map(a=>a.date)).size;
  const ordered=tasks.filter(t=>{const id=currentTaskIdentity(t);if(seen.has(id))return false;seen.add(id);return true;})
    .sort((a,b)=>{
      const x=a.ranking!,y=b.ranking!;
      // Within non-blocking high-value bands, extended waiting is a bounded
      // promotion. It never outranks a proven prerequisite and cannot turn
      // diagnostic maintenance into an urgent exam failure.
      const adjusted=(t:Task)=>t.ranking!.band>=1&&t.ranking!.band<=3?
        Math.max(1,t.ranking!.band-Math.min(2,Math.floor(t.ranking!.waitingDays/14))):t.ranking!.band;
      return adjusted(a)-adjusted(b)||Number(!!b.direct_exam_loss)-Number(!!a.direct_exam_loss)||
        y.waitingDays-x.waitingDays||recentInterventions(a)-recentInterventions(b)||
        a.minutes-b.minutes||currentTaskIdentity(a).localeCompare(currentTaskIdentity(b));
    });
  ordered.forEach((t,i)=>{t.ranking!.rank=i+1;t.ranking!.reasons.push(`順位帯 ${t.ranking!.band} / 有効な介入待機 ${t.ranking!.waitingDays}日 / 直近7日の介入 ${recentInterventions(t)}日 / ${t.minutes}分（推定）`);});
  return {tasks:ordered,waiting,dataQualityWarnings};
}
