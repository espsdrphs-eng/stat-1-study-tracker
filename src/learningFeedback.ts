import type {Bootstrap,Task,Review,Attempt,Problem,GradingContractSnapshot,StudyUpdate,ExamReferenceCatalogItem} from "./types.ts";
import {selectCurrentReviewsForProblem} from "./integrityEngine.ts";
import {deriveTransferEvidence,currentTransferEvidence,transferTrainingOutcome,transferEvidenceStatus,rootProgress,rootTargetKeys,verifiedTransferRediagnosis,findingEvidenceStatus,successfulSkillIds,findingSkillIds,transferCoversFindings,independentReferenceFree,confidentGrading} from "./skillEvidence.ts";
import {delayedTrainingPrerequisites} from './generatedTransfer.ts';
import {buildStableTargetIndex} from './stableTargetIdentity.ts';
import {attemptPlanningEligible} from "./legacyKPolicy.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";
import {currentTaskIdentity,isPastExamSessionTask} from "./examOptimizationPolicy.ts";
import {resolveCanonicalProblemId,calculateExamReadinessMetrics,type MetricEvidence} from "./examReadiness.ts";
import {deriveTaskAnswerScope,taskAnswerScopeText} from "./taskAnswerScope.ts";
import {resolvePersistedAttemptLifecycle} from './reviewTransition.ts';
import {BUILT_IN_EXAM_REFERENCE_PACK} from './builtinExamReferencePack.ts';
import {deriveExamReadinessAssessment} from './examCapability.ts';

// Neutral projections of existing grading slots/criteria, not new mastery rules.
const targetLabels:Record<string,string>={problem_type:"型の判断",first_step:"初手",focal_quantity:"対象の量",critical_condition:"条件確認",major_calculation:"主要計算",answer_conclusion:"最終結論"};
export function learningTargetLabel(id:string){return targetLabels[id]||'採点対象の操作';}
const criterionLabels:Record<string,string>={identify_problem_type:"問題の型を判断できる",choose_first_step:"最初の一手を自力で選べる",identify_focal_quantity:"求める量を特定できる",track_critical_condition:"必要な条件を確認できる",complete_major_calculation:"主要計算を最後まで完了できる",reach_requested_conclusion:"問われた結論まで答案化できる",retrieval_short_recall:"型・初手・対象の量・重要条件を参照なしで想起できる",reconstruct_full_structure:"問題全体の構成を参照なしで再現できる",reproduce_targeted_points:"指定対象を参照なしで整合的に再現できる",reproduce_current_unresolved_parts:"指定された未解消の対象を再現できる",complete_assigned_scope:"指定範囲を参照なしで完了できる"};
const errorLabels:Record<string,string>={K:"入口・知識の不足",W:"計算・答案化の誤り",N:"条件・理由の不足",C:"記号・表記の誤り"};
// Quote only neutral topics actually present in a recorded target. Never expose
// its equation, corrected value, solution method or free-form cueLabel.
const recordedTopics=(text:string)=>[...new Set(text.match(/係数|指数(?!分布)|符号|添字|支持範囲|分母|平均|分散|期待値|確率|密度|結論|条件|記号/gu)||[])];

/** Read-only original locator. Neither missing documents nor answer PDFs are prerequisites. */
export function deriveProblemReference(problem:Problem,catalog:Pick<ExamReferenceCatalogItem,"canonicalProblemId"|"subject"|"year"|"questionNumber">[]=[]){
  const missing:string[]=[];
  let locator:string;
  if(problem.source_type==="generated"){
    locator=`生成転移問題 ・ ${problem.display_label||problem.title||problem.problem_id}`;
  }else if(problem.source_type==="past_exam"){
    const reference=catalog.find(row=>row.canonicalProblemId===problem.problem_id);
    const exam=problem.problem_id.match(/^(?:PY|PE)-(\d{4})-Q0*(\d+)$/);
    const recorded=[problem.source_book,problem.title,problem.display_label].filter(Boolean).join(" ");
    const subject=reference?.subject?.trim()||recorded.match(/統計数理|統計応用/)?.[0];
    const year=reference?.year||exam?.[1]||recorded.match(/(\d{4})年/)?.[1];
    const question=reference?.questionNumber||exam?.[2]||problem.problem_number;
    if(!subject)missing.push("科目");if(!year)missing.push("年度");if(!question)missing.push("問番号");
    locator=`統計検定1級・${subject||"科目未登録"} ${year?`${year}年`:"年度未登録"} ${question?`問${question}`:"問番号未登録"}`;
  }else{
    if(problem.chapter==null)missing.push("章番号");if(!problem.problem_number)missing.push("問番号");
    locator=[problem.source_book||"白本",problem.chapter!=null?`第${problem.chapter}章`:"章番号未登録",
      problem.problem_number?`${problem.category==="A"||problem.category==="S"?problem.category:""}問${problem.problem_number}`:"問番号未登録"].join(" ・ ");
  }
  return {locator,missing,statement:problem.source_type==="generated"?problem.generated_transfer?.problem_text||null:null,
    availability:problem.source_type==='generated'?'登録済みの生成問題文を確認してください。':'問題本文・原問題PDFへの参照は登録されていません。この特定情報を使い、手元の原本から問題を開いてください。解答資料を原問題として代用しません。'};
}

/** Detailed assistance is only rendered AFTER a recorded, explicit hint action. */
export function taskAssistanceText(data:Pick<Bootstrap,"attempts">,task?:Partial<Task&Review>){
  const valid=(a:Attempt)=>a.exclude_from_planning!==true&&attemptPlanningEligible(a);
  for(const part of task?.grading_contract?.gradedParts||[]){
    const original=data.attempts.find(a=>a.id===part.evidenceSourceAttemptId&&valid(a));
    if(original&&part.currentCorrection)return part.currentCorrection;
  }
  const id=task?.grading_contract?.sourceAttemptId||task?.source_attempt_id||task?.generated_from_attempt_id||task?.repair_lineage?.sourceAttemptId;
  const source=data.attempts.find(a=>a.id===id&&valid(a));
  const hasFailure=source?.graded_findings?.some(f=>!f.resolved&&f.error_type!=="none"&&f.planning_eligible!==false&&f.validity!=="invalid_legacy_k")||
    !source?.graded_findings?.length&&(source?.error_types||[source?.error_type]).some(e=>!!e&&e!=="none");
  return hasFailure?source?.next_action||source?.error_point||"":"";
}

/** Read-only task briefing. Detailed corrections/answers remain explicitly recorded assistance. */
export function deriveTaskIntroduction(data:Bootstrap,problem:Problem,item?:Partial<Task&Review>){
  const view=deriveProblemLearningView(data,problem);
  const problemId=resolveCanonicalProblemId(problem.problem_id,data.problemAliases);
  const workReview=view.work?.reviewId?data.reviews.find(r=>r.id===view.work!.reviewId):undefined;
  const task:Partial<Task&Review>|undefined=item||workReview||view.nextTask||selectCurrentReviewsForProblem({reviews:data.reviews,problemId,aliases:data.problemAliases,today:data.dashboard.today}).current[0];
  const contract=task?.grading_contract;
  const purpose=task?.learning_purpose||contract?.learningPurpose;
  const session=!!task&&isPastExamSessionTask(task as Task);
  const transfer=purpose==="transfer_check"||!!task?.transfer_training_key||!!problem.generated_transfer;
  const review=purpose==="error_repair"||purpose==="retrieval_check";
  const blind=session||transfer||!review;
  const workLabel=problem.generated_transfer?"生成転移訓練":session?"本番形式演習":transfer?"別問題の転移確認":purpose==="retrieval_check"?"保持確認":purpose==="error_repair"?"誤答回収":view.latestAttempt?"通常演習（再挑戦）":"初回解答";
  const sourceId=contract?.sourceAttemptId||task?.source_attempt_id||task?.generated_from_attempt_id||task?.repair_lineage?.sourceAttemptId;
  const source=data.attempts.find(a=>a.id===sourceId&&attemptPlanningEligible(a));
  const parts=contract?.gradedParts||[];
  const evidenceAttemptIds:number[]=[];
  const failures:string[]=[];
  if(!blind)for(const part of parts){
    const original=data.attempts.find(a=>a.id===(part.evidenceSourceAttemptId||sourceId)&&attemptPlanningEligible(a));
    const finding=original?.graded_findings?.find(f=>f.graded_part_id===part.id&&f.error_type!=="none"&&!f.resolved&&f.planning_eligible!==false&&f.validity!=="invalid_legacy_k");
    if(finding&&targetLabels[part.id]){failures.push(`${targetLabels[part.id]}：${errorLabels[finding.error_type]}`);evidenceAttemptIds.push(original!.id);}
  }
  // Legacy graded contracts may contain only a source Attempt's structured error codes.
  if(!blind&&!failures.length&&source){
    const errors=source.graded_findings?.length?source.graded_findings.filter(f=>!f.resolved&&f.error_type!=="none"&&f.planning_eligible!==false&&f.validity!=="invalid_legacy_k").map(f=>f.error_type):source.error_types?.length?source.error_types:[source.error_type];
    const labels=errors.filter((e):e is keyof typeof errorLabels=>!!e&&!!errorLabels[e]).map(e=>errorLabels[e]);
    if(labels.length){failures.push(...labels);evidenceAttemptIds.push(source.id);}
  }
  const answerScope=deriveTaskAnswerScope({problem,task,attempts:data.attempts,overrides:data.taskAnswerScopeOverrides});
  const scope=parts.map((p,i)=>{
    const slot=p.stableTargetKey?.split(":slot:")[1]||p.stable_target_key?.split(":slot:")[1];
    const label=targetLabels[p.id]||(slot?targetLabels[slot]:undefined)||`採点対象${i+1}`;
    const topics=recordedTopics(p.label||"");
    return label+(topics.length?`（記録上の論点：${topics.join("・")}）`:"");
  });
  const goals=!blind?contract?.completionCriteria?.map(c=>criterionLabels[c.id]).filter(Boolean)||[]:[];
  const partGoals=!blind&&contract?.completionCriteria?.length?parts.map(p=>criterionLabels[p.completionCriterionId]).filter(Boolean):[];
  return {taskIdentity:task?currentTaskIdentity(task as Task):`problem:${problemId}`,target:deriveProblemReference(problem,data.adaptiveLearning?.pastExamCatalog).locator,
    workLabel,blind,answerScope,subparts:taskAnswerScopeText(answerScope),
    scope:blind?taskAnswerScopeText(answerScope):scope.length?[...new Set(scope)].join(" / "):"対象範囲未登録",
    previousDifficulty:blind?"独立性を守るため解答前は表示しません":failures.length?[...new Set(failures)].join(" / "):"診断未登録",
    recoveryGoal:blind?"問題文の要求に対して自力で答案を作成し、採点後に確認します":goals.length||partGoals.length?[...new Set([...goals,...partGoals])].join(" / ")+(contract?.allowedReferenceLevel===0&&!goals.some(g=>g.includes("参照なし"))?"（参照なし）":""):"回収条件未設定",
    evidenceAttemptIds:[...new Set(evidenceAttemptIds)],sourceDate:!blind&&source?source.date:null};
}

/** Display projection only. Eligibility, ranking and capability remain canonical. */
export type SubmittedAnswer={problemId:string;text:string;referenceLevel:number};
export function appendSubmittedAnswer(prompt:string,text?:string,referenceLevel=0){
  return text?.trim()?`${prompt}\n\n【今回の確定答案】\n${text}\n【今回の参照記録】参照段階 ${referenceLevel}。この記録を下げず採点してください。`:prompt;
}
export function attachSubmittedAnswer(update:StudyUpdate&{memo?:string},submission?:SubmittedAnswer):StudyUpdate&{memo?:string}{
  if(update.problem_id!==submission?.problemId)return update;
  return {...update,memo:[update.memo,submission.text.trim()?`今回の確定答案:\n${submission.text}`:"答案は紙／Goodnotesで作成し、画像をChatGPTへ直接添付"].filter(Boolean).join("\n\n"),
    actual_reference_level:Math.max(Number(update.actual_reference_level??update.reference_level??0),submission.referenceLevel) as StudyUpdate["actual_reference_level"]};
}
export function optionalNetMinutes(value:unknown):number|null{
  if(value==null||value==="")return null;
  const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error("正味解答時間は正の分数、または未入力にしてください");return n;
}
export const netMinutesText=(minutes:number|null|undefined)=>minutes==null?"時間不明":`${minutes}分`;
export function imageGradingPrompt(prompt:string,referenceLevel=0,minutes:number|null=null){
  return `${prompt}\n\n【紙／Goodnotesの答案画像による採点】\n本人がこのプロンプトとともに添付した答案画像を採点してください。アプリ内に本人の答案本文はありません。読めない部分は推測せず不確実として返してください。問題文・公式資料と本人の答案を混同しないでください。\n参照段階 ${referenceLevel}。この記録を下げず採点してください。\n正味解答時間は${minutes==null?"不明。actual_minutes: null、time_minutes: null。画像から時間を推測しない":`${minutes}分（中断時間を除く）` }。\n既存の問題ID・契約ID・対象part・採点結果の構造化形式を維持してください。プロンプトのコピーは答案完成・採点成功の証拠ではありません。`;
}
/** One display projection shared by Today/list/detail. Never re-ranks tasks. */
function confirmedRetention(rows:Attempt[],mastery:Bootstrap['masteryByProblem'][string]|undefined){
  if(!mastery?.normalReviewComplete)return false;
  const facts=rows.filter(a=>attemptPlanningEligible(a)&&!a.exclude_from_metrics&&!a.exclude_from_planning&&!a.duplicate_of_attempt_id);
  const delayed=facts.filter(a=>a.learning_purpose==='retrieval_check'&&a.assessment_timing==='delayed_retrieval'&&independentReferenceFree(a)&&confidentGrading(a)&&facts.some(source=>
    source.id===a.grading_contract?.sourceAttemptId&&source.problem_id===a.problem_id&&/^\d{4}-\d{2}-\d{2}$/.test(a.date)&&a.date>source.date));
  return delayed.length>0&&(mastery.levels?.some(level=>level.status==='retained'&&level.retainedTargetCount>0)||delayed.some(a=>resolvePersistedAttemptLifecycle(a).graduated))||
    facts.some(a=>deriveFailureEpisode(a).rootWeaknesses.some(root=>!!delayedTrainingPrerequisites(a,root,facts).retrieval));
}
export function deriveProblemLearningView(data:Bootstrap,problem:Problem,transferEvidence?:ReturnType<typeof deriveTransferEvidence>){
  const aliases=new Map(data.problemAliases.map(a=>[a.alias,a.problem_id]));
  const canonical=(id:string)=>{const seen=new Set<string>();while(aliases.has(id)&&!seen.has(id)){seen.add(id);id=aliases.get(id)!;}return id;};
  const id=canonical(problem.problem_id);
  const rows=data.attempts.filter(a=>canonical(a.problem_id)===id&&!a.duplicate_of_attempt_id).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  const latestAttempt=rows[0],mastery=data.masteryByProblem[id];
  const work=data.learningWorkByProblem?.[id];
  const pendingWork=work&&!rows.some(a=>a.id>work.baselineAttemptId&&!a.exclude_from_metrics);
  const generated=problem.generated_transfer;
  const workStatus=pendingWork?work.stage:generated?.answer_submission&&!rows.length?"awaiting_grading":rows.length?"graded":"unstarted";
  const workLabel={unstarted:"未着手",preparing:"採点準備中",awaiting_grading:"採点待ち",graded:"採点済み"}[workStatus];
  const current=selectCurrentReviewsForProblem({reviews:data.reviews,problemId:id,aliases:data.problemAliases,today:data.dashboard.today}).current;
  const nextTask=data.today.tasks.find(t=>canonical(t.problem_id)===id&&!t.checked&&!t.stable_session_key);
  const transferRepair=!!nextTask&&verifiedTransferRediagnosis(nextTask,data.attempts);
  const needsRepair=transferRepair||!mastery?.normalReviewComplete&&(mastery?.levels.some(l=>["repairing","needs_recheck"].includes(l.status))||current.some(r=>(r.learning_purpose||r.grading_contract?.learningPurpose)==="error_repair"));
  const retentionConfirmed=confirmedRetention(rows,mastery);
  const unverifiedRetentionHistory=!retentionConfirmed&&!!mastery?.normalReviewComplete&&rows.length>0&&
    (mastery.levels?.some(l=>l.status==='retained'&&l.retainedTargetCount>0)||rows.some(a=>resolvePersistedAttemptLifecycle(a).graduated));
  const waitingRetention=unverifiedRetentionHistory||!needsRepair&&!mastery?.normalReviewComplete&&(mastery?.levels.some(l=>l.status==="retention_pending")||current.some(r=>(r.learning_purpose||r.grading_contract?.learningPurpose)==="retrieval_check"));
  const retentionLabel=retentionConfirmed?"保持確認済み":unverifiedRetentionHistory?'再現記録あり・遅延未確認':waitingRetention?"保持確認待ち":"保持未確認";
  const evidence=transferEvidence||currentTransferEvidence(data.attempts.filter(attemptPlanningEligible));
  const related=evidence.filter(e=>canonical(e.sourceProblemId)===id);
  const training=related.some(e=>e.evidenceStrength==="training"),strong=related.some(e=>e.evidenceStrength==="strong");
  const waitingTransfer=generated?generated.lifecycle_status!=="graded":!strong&&(training||!!nextTask?.transfer_training_key||!!data.today.canonicalStudyPlan.ranked?.waiting.some(w=>canonical(w.task.problem_id)===id&&(!!w.task.transfer_training_key||w.task.kind==="転移待機")));
  const transferLabel=generated?rows[0]?transferTrainingOutcome(rows[0],evidence.some(e=>e.successAttemptId===rows[0].id)):"転移訓練中":transferRepair?"転移訓練未達・再補修が必要":strong?"本番転移確認済み":training?"転移訓練成功・本番転移未測定":"本番転移未測定";
  const nextAction=workStatus==="awaiting_grading"?"採点JSONを取り込む":workStatus==="preparing"?"紙／Goodnotesで答案を完成させる":nextTask?.transfer_training_key?"別問題で転移訓練":needsRepair?"未解消範囲を復習":waitingRetention?"参照なしで保持確認":mastery?.normalReviewComplete?"Todayの次の候補へ":nextTask?preAnswerReason(nextTask):"問題を開いて解答する";
  const statusLabel=[workLabel,needsRepair?'再復習予定':waitingRetention?'保持確認待ち':retentionConfirmed?'保持確認済み':''].filter(Boolean).join('・');
  return {workStatus,workLabel,statusLabel,work:pendingWork?work:undefined,latestAttempt,needsRepair:!!needsRepair,waitingRetention:!!waitingRetention,retentionConfirmed,waitingTransfer,retentionLabel,transferLabel,nextAction,nextTask};
}
export function deriveProblemLearningViews(data:Bootstrap){
  const evidence=currentTransferEvidence(data.attempts.filter(attemptPlanningEligible));
  return Object.fromEntries(data.problems.map(p=>[p.problem_id,deriveProblemLearningView(data,p,evidence)]));
}
export function deriveLearningUpdateSummary(data:Pick<Bootstrap,'attempts'|'dashboard'>&Partial<Pick<Bootstrap,'problems'|'pastSessions'|'problemAliases'|'reviews'|'today'|'masteryByProblem'>>){
  const latest=[...data.attempts].filter(attemptPlanningEligible).sort((a,b)=>b.id-a.id)[0];
  if(!latest)return null;
  const local=['error_repair','retrieval_check','transfer_check'].includes(String(latest.learning_purpose));
  const ids=data.dashboard.readiness?.evidence?.selectedThree?.sessions?.flatMap(s=>s.attemptIds)||[];
  const reason=latest.learning_purpose==='error_repair'?'今回は局所補修です。本番得点・時間指標の集計対象ではありません。':
    latest.learning_purpose==='retrieval_check'?'今回は同一問題の保持確認です。別問題の転移成功とは別に判定します。':
    latest.learning_purpose==='transfer_check'?'今回は意図的な転移訓練です。本番session得点や自然な転移成功へ加算しません。':
    ids.includes(latest.id)?'今回の答案は本番sessionの測定証拠です。得点・時間・選題の資格を別々に再評価します。':
    '今回の答案は保存済みです。本番session指標は、その対象証拠が増えた場合だけ更新されます。';
  const facts=data.attempts.filter(attemptPlanningEligible),before=facts.filter(a=>a.id!==latest.id);
  const source=facts.find(a=>a.id===latest.grading_contract?.sourceAttemptId&&a.problem_id===latest.problem_id);
  const index=buildStableTargetIndex({attempts:facts,reviews:data.reviews||[]});
  const targets=(latest.graded_findings||[]).map(f=>{
    const observation=findingEvidenceStatus(latest,f),key=index.attemptPart(latest.id,f.graded_part_id)?.identityKey;
    const prior=source?.graded_findings?.find(old=>key&&index.attemptPart(source.id,old.graded_part_id)?.identityKey===key);
    const previous=prior?findingEvidenceStatus(source!,prior):undefined;
    const improved=!!previous&&['failure','uncertain'].includes(previous.outcome)&&['success','assisted_success'].includes(observation.outcome);
    const newFailure=observation.outcome==='failure'&&!!previous&&previous.outcome!=='failure';
    return {...observation,title:targetLabels[f.graded_part_id]||'今回の採点対象',previous:previous?.label||'対応する比較元なし',improved,newFailure};
  });
  const stageChanges:Array<{rootIds:string[];skillName:string;before:string;after:string}>=[];
  if(data.reviews&&data.today&&data.masteryByProblem){
    const affected=new Set([latest.transfer_lineage?.sourceProblemId||latest.problem_id]);
    if(!latest.transfer_lineage&&!['error_repair','retrieval_check'].includes(String(latest.learning_purpose))){
      const passed=successfulSkillIds(latest);
      for(const a of before)if((a.graded_findings||[]).some(f=>findingSkillIds(a,f).some(id=>passed.includes(id))))affected.add(a.problem_id);
    }
    const current=deriveCurrentWeaknessRows(data as Bootstrap,affected),previous=deriveCurrentWeaknessRows({...data,attempts:before} as Bootstrap,affected);
    const old=new Map(previous.flatMap(r=>r.sources).map(s=>[s.rootId,s]));
    for(const row of current)for(const s of row.sources.filter(s=>s.lastCheckedAttemptId===latest.id||s.latestFailureAttemptId===latest.id)){
      const prior=old.get(s.rootId)?.status||'この対象の過去証拠なし';
      const skillName=s.skillIds.map(id=>BUILT_IN_EXAM_REFERENCE_PACK.data.concepts.find(c=>c.concept_id===id)?.display_name||'技能名未登録').join(' / ')||'技能対応未確定';
      const existing=stageChanges.find(r=>r.skillName===skillName&&r.before===prior&&r.after===s.status);
      if(existing)existing.rootIds.push(s.rootId);else stageChanges.push({rootIds:[s.rootId],skillName,before:prior,after:s.status});
    }
  }
  const metricChanges:Array<{name:string;before:number|null;after:number|null;changed:boolean;evidenceChanged:boolean;date:string|null;rule:string;evidenceIds:string[];nextEvidence:string}>=[];
  let levelChange:{before:number;after:number;changed:boolean}|undefined;
  if(data.problems&&data.pastSessions){
    const measure=(attempts:Attempt[])=>calculateExamReadinessMetrics({problems:data.problems!,attempts,pastSessions:data.pastSessions!,aliases:data.problemAliases||[],today:data.dashboard.today||latest.date});
    const previous=measure(before),current=measure(facts);
    const values=[['selectedThree','選択3問得点','参照なしの新しい本番3問sessionまたは元答案の正式な再採点'],['timed','時間内完走','scanを含む90分sessionの正味時間と3問の完遂結果'],['selection','選題','scan・選択3問と比較可能な5問の採点結果'],['transfer','自然な本番転移','解法を事前提示しない別過去問で、同技能の自力成功']] as const;
    for(const [key,name,nextEvidence]of values){
      const old=previous.evidence?.[key],now=current.evidence?.[key];if(!old||!now)continue;
      const proof=(m:MetricEvidence)=>JSON.stringify([m.numerator,m.denominator,m.lastUpdated,[...m.eligibleEvidenceIds].sort()]);
      metricChanges.push({name,before:old.value,after:now.value,changed:old.value!==now.value,evidenceChanged:proof(old)!==proof(now),date:now.lastUpdated,rule:now.eligibleEvidenceRule,evidenceIds:now.eligibleEvidenceIds,nextEvidence});
    }
    const priorLevel=deriveExamReadinessAssessment(previous,data.dashboard.today||latest.date),nextLevel=deriveExamReadinessAssessment(current,data.dashboard.today||latest.date);
    levelChange={before:priorLevel.level,after:nextLevel.level,changed:priorLevel.level!==nextLevel.level};
  }
  return {attemptId:latest.id,problemId:latest.problem_id,date:latest.date,score:latest.score_numeric,
    unresolved:(latest.graded_findings||[]).filter(f=>!f.resolved&&f.error_type!=='none'&&f.planning_eligible!==false).length,
    reason,local,change:latest.answer_change_summary||latest.result_summary||'',sourceAttemptId:source?.id,targets,stageChanges,metricChanges,levelChange};
}

export function deriveWeaknessDisplayRows(data:Bootstrap){
  const groups=new Map<string,ReturnType<typeof deriveCurrentWeaknessRows>[number]>();
  for(const row of deriveCurrentWeaknessRows(data)){
    const key=row.identityPending?`unmapped:${row.sources[0].problemId}`:row.id,old=groups.get(key);
    if(old){old.sources.push(...row.sources);old.rank=Math.min(old.rank,row.rank);
      const order=['補修が必要','証拠不足','補修成功・保持未確認','保持成功・転移未確認','転移訓練確認済み・本番転移未確認','本番転移確認済み'];
      if(order.indexOf(row.status)<order.indexOf(old.status))old.status=row.status;}
    else groups.set(key,{...row,id:key,sources:[...row.sources]});
  }
  const index=buildStableTargetIndex({attempts:data.attempts,reviews:data.reviews});
  return [...groups.values()].sort((a,b)=>a.rank-b.rank||a.id.localeCompare(b.id)).map(row=>{
    const ids=[...new Set(row.sources.flatMap(s=>s.skillIds))];
    const skillName=ids.map(id=>data.adaptiveLearning?.conceptWeaknesses?.find(c=>c.conceptId===id)?.displayName||
      BUILT_IN_EXAM_REFERENCE_PACK.data.concepts.find(c=>c.concept_id===id)?.display_name||'技能名未登録').join(' / ')||'技能の対応を確認中';
    const sources=row.sources.map(s=>{
      const problem=data.problems.find(p=>p.problem_id===s.problemId);
      const latest=data.attempts.find(a=>a.id===s.lastCheckedAttemptId);
      const review=data.reviews.find(r=>r.problem_id===s.problemId&&r.source_attempt_id===s.latestFailureAttemptId&&['pending','overdue'].includes(r.status));
      const task=s.task&&!s.task.transfer_training_key?s.task:review;
      const answerScope=problem&&task?deriveTaskAnswerScope({problem,task,attempts:data.attempts,overrides:data.taskAnswerScopeOverrides}):undefined;
      const linked=latest?.transfer_lineage?.sourceProblemId===s.problemId&&s.skillIds.includes(latest.transfer_lineage.rootSkillId);
      const observations=linked?[transferEvidenceStatus(latest!,s.transferAttemptId===latest!.id)]:(latest?.graded_findings||[]).filter(f=>
        s.targetKeys.includes(index.attemptPart(latest!.id,f.graded_part_id)?.identityKey||'')||
        !s.targetKeys.length&&s.findingIds.includes(f.graded_part_id)||latest!.problem_id!==s.problemId&&findingSkillIds(latest!,f).some(id=>s.skillIds.includes(id))).map(f=>findingEvidenceStatus(latest!,f));
      return {...s,answerScope,answerScopeText:answerScope?taskAnswerScopeText(answerScope):'対象小問未特定',observations,
        improvement:latest?.answer_change_summary||'',successCriterion:completionCriterionText(task?.grading_contract)};
    });
    return {...row,skillName,sources};
  });
}

export function completionCriterionText(contract?:GradingContractSnapshot){
  return contract?.completionCriteria?.map(c=>c.displayText).filter(Boolean).join(" / ")||
    "対象範囲を参照なしで最後の結論まで再現し、対象major errorがないことを採点で確認";
}
export function preAnswerReason(item:Partial<Task&Review>){
  const purpose=item.grading_contract?.learningPurpose||item.learning_purpose;
  if(item.transfer_training_key||purpose==="transfer_check")return "別問題で自力の再現性を確認します。";
  if(item.past_exam_task_type)return "本番形式で選題・時間内の答案形成を測定します。";
  if(purpose==="retrieval_check")return "参照なしで保持を確認します。";
  if(purpose==="error_repair"||item.repair_lineage)return "未完成の解答範囲に再挑戦します。";
  return "現在の答案形成を確認します。";
}
/** Read-only view of canonical root evidence. No memo toggles, new lifecycle or
 * persisted skill merge: separate source targets remain independently scoped. */
export function deriveCurrentWeaknessRows(data:Bootstrap,sourceProblemIds?:ReadonlySet<string>){
  const facts=data.attempts.filter(a=>attemptPlanningEligible(a)&&!a.exclude_from_planning&&!a.exclude_from_metrics&&!a.duplicate_of_attempt_id);
  const index=buildStableTargetIndex({attempts:facts,reviews:data.reviews});
  const evidence=deriveTransferEvidence(facts),seen=new Set<string>();
  const sources=[];
  for(const source of facts.filter(a=>!a.transfer_lineage&&a.source_type!=='generated'&&(!sourceProblemIds||sourceProblemIds.has(a.problem_id))).sort((a,b)=>a.id-b.id))for(const root of deriveFailureEpisode(source).rootWeaknesses){
    if(!root.requiredRepair||seen.has(root.rootWeaknessId))continue;seen.add(root.rootWeaknessId);
    const progress=rootProgress(source,root,facts,index),delayed=delayedTrainingPrerequisites(source,root,facts);
    const repair=progress.transferFailure?undefined:delayed.repair||(!source.grading_contract?.gradedParts.length?progress.repairSuccess:undefined);
    const retrieval=progress.transferFailure?undefined:delayed.retrieval;
    const transfer=evidence.filter(e=>e.sourceProblemId===source.problem_id&&root.skillIds.includes(e.skillId)&&transferCoversFindings(e,source,root.sourceFindingIds)&&
      e.successAttemptId>(progress.transferFailure?.id||progress.latestFailure.id)).at(-1);
    const task=data.today.tasks.find(t=>!t.checked&&(t.repair_lineage?.rootWeaknessId===root.rootWeaknessId||
      t.problem_id===source.problem_id&&(t.transfer_training_key||t.source_attempt_id===progress.latestFailure.id)));
    const waiting=data.today.canonicalStudyPlan.ranked?.waiting.find(w=>w.task.problem_id===source.problem_id);
    const status=transfer?transfer.evidenceStrength==='strong'?'本番転移確認済み':'転移訓練確認済み・本番転移未確認':
      retrieval?'保持成功・転移未確認':repair?'補修成功・保持未確認':
        root.confidence==='low'||data.masteryByProblem?.[source.problem_id]?.normalReviewComplete&&!progress.transferFailure?'証拠不足':'補修が必要';
    const latestTraining=facts.filter(a=>a.transfer_lineage?.sourceProblemId===source.problem_id&&root.skillIds.includes(a.transfer_lineage.rootSkillId)).sort((a,b)=>a.id-b.id).at(-1);
    const last=[progress.latestFailure,repair,retrieval,latestTraining,facts.find(a=>a.id===(progress.transferFailure?.id||transfer?.successAttemptId))]
      .filter((a):a is Attempt=>!!a).sort((a,b)=>b.id-a.id)[0];
    sources.push({rootId:root.rootWeaknessId,problemId:source.problem_id,sourceAttemptId:source.id,
      targetKeys:[...rootTargetKeys(source,root,facts,index)].sort(),
      findingIds:root.sourceFindingIds,skillIds:root.skillIds,examImpact:root.examImpact,status,description:progress.latestFailure.id===source.id?root.description:
        deriveFailureEpisode(progress.latestFailure).rootWeaknesses.find(r=>r.rootWeaknessId===root.rootWeaknessId)?.description||root.description,
      latestFailureAttemptId:progress.latestFailure.id,repairAttemptId:repair?.id,retrievalAttemptId:retrieval?.id,
      repairAssisted:!!repair&&(!!repair.hint_used||Number(repair.actual_reference_level??repair.reference_level)>0),
      problemReviewComplete:!!data.masteryByProblem?.[source.problem_id]?.normalReviewComplete,
      transferAttemptId:transfer?.successAttemptId,transferFailureAttemptId:progress.transferFailure?.id,
      lastCheckedDate:last?.date,lastCheckedAttemptId:last?.id,task,
      nextAction:task?`${task.title}（Today 優先 ${task.ranking?.rank||'未設定'}）`:transfer?'次の自然な過去問で再測定':
        waiting?`${waiting.reason}。再評価：${waiting.reevaluateWhen}`:retrieval?'別問題候補のskill照合・開始条件を確認':repair?'参照なしの遅延保持を確認':'有効な採点で対象範囲を確認',
      identityPending:!root.skillIds.length});
  }
  const groups=new Map<string,typeof sources>();
  for(const s of sources){const key=s.skillIds.length?`skill:${[...s.skillIds].sort().join('|')}`:
    s.targetKeys.length?`target:${s.problemId}:${s.targetKeys.join('|')}`:s.rootId;groups.set(key,[...(groups.get(key)||[]),s]);}
  const order=['補修が必要','証拠不足','補修成功・保持未確認','保持成功・転移未確認','転移訓練確認済み・本番転移未確認','本番転移確認済み'];
  return [...groups].map(([id,sources])=>({id,sources,status:[...sources].sort((a,b)=>order.indexOf(a.status)-order.indexOf(b.status))[0].status,
    identityPending:sources.some(s=>s.identityPending),rank:Math.min(...sources.map(s=>s.task?.ranking?.rank||Infinity))}))
    .sort((a,b)=>a.rank-b.rank||order.indexOf(a.status)-order.indexOf(b.status)||a.id.localeCompare(b.id));
}
export function deriveCurrentLearningDiagnosis(data:Bootstrap){
  const assessment=data.dashboard.kpis?.assessment;
  const facts=data.attempts.filter(attemptPlanningEligible);
  const tasks=data.today.tasks.filter(t=>!t.checked&&t.ranking?.eligible);
  const deficits:Array<{problemId:string;ability:string;sourceAttemptId:number;date:string;evidence:string;task:Task;successCriterion:string}>=[];
  const used=new Set<string>();
  for(const task of tasks){
    const purpose=task.grading_contract?.learningPurpose||task.learning_purpose;
    if(purpose!=="error_repair"||used.has(task.problem_id)||
      data.masteryByProblem[task.problem_id]?.normalReviewComplete&&!task.repair_lineage?.transferFailureEvidenceId)continue;
    const sourceId=task.repair_lineage?.sourceAttemptId||task.source_attempt_id||task.grading_contract?.sourceAttemptId;
    const source=facts.find(a=>a.id===sourceId);
    if(!source)continue;
    const ids=task.repair_lineage?.sourceFindingIds||task.targeted_parts||task.grading_contract?.gradedParts.map(p=>p.id)||[];
    const failures=(source.graded_findings||[]).filter(f=>!f.resolved&&f.error_type!=="none"&&(!ids.length||ids.includes(f.graded_part_id)));
    const root=deriveFailureEpisode(source).rootWeaknesses.find(r=>r.requiredRepair&&r.sourceFindingIds.some(id=>failures.some(f=>f.graded_part_id===id)));
    const finding=failures.find(f=>root?.sourceFindingIds.includes(f.graded_part_id))||failures[0];
    if(!finding&&!source.error_point)continue;
    used.add(task.problem_id);
    const transferFailure=facts.find(a=>a.id===task.repair_lineage?.transferFailureEvidenceId);
    const evidence=[root?.description||finding?.evidence||source.error_point,
      transferFailure?`直近の別問題 ${transferFailure.problem_id}・${transferFailure.date}・Attempt #${transferFailure.id}で対象技能を再現できなかった。${transferFailure.target_skill_assessment?.evidence||""}`:""]
      .filter(Boolean).join("\n");
    deficits.push({problemId:task.problem_id,ability:evidence,sourceAttemptId:source.id,date:source.date,evidence,task,
      successCriterion:completionCriterionText(task.grading_contract)});
  }
  const transfers=currentTransferEvidence(facts);
  const training=transfers.filter(e=>e.evidenceStrength==="training"),strong=transfers.filter(e=>e.evidenceStrength==="strong");
  const lastTraining=new Map<string,Attempt>();
  for(const a of [...facts].sort((a,b)=>a.id-b.id))if(a.transfer_lineage)lastTraining.set(a.transfer_lineage.key,a);
  const failed=[...lastTraining.values()].filter(a=>transferTrainingOutcome(a)==="training transfer failure");
  const strengths:string[]=[];
  if(assessment?.selectionAccuracy?.denominator&&Number(assessment.selectionAccuracy.value)>=80)strengths.push(`選題は${assessment.selectionAccuracy.numerator}/${assessment.selectionAccuracy.denominator}で成功`);
  const retained=Object.entries(data.masteryByProblem).filter(([id,m])=>confirmedRetention(facts.filter(a=>
    resolveCanonicalProblemId(a.problem_id,data.problemAliases||[])===id),m)).length;
  if(retained)strengths.push(`${retained}問題で保持の証拠を確認（別問題への転移とは区別）`);
  if(strong.length)strengths.push(`本番文脈の別問題で${strong.length}件の自然な転移成功を確認`);
  const pending=data.today.canonicalStudyPlan.ranked?.waiting.filter(w=>w.task.kind==="転移待機")||[];
  return {assessment,stage:assessment?.label||"判定材料不足",strengths,deficits:deficits.slice(0,3),
    retentionPending:tasks.filter(t=>(t.grading_contract?.learningPurpose||t.learning_purpose)==="retrieval_check").length,
    transfer:{trainingSuccess:training.length,strongSuccess:strong.length,failed:failed.length,strongStatus:assessment?.transfer?.statusCounts,
      eligible:tasks.filter(t=>t.learning_purpose==="transfer_check").length,
      pendingProblems:[...new Set(pending.map(w=>w.task.problem_id))],pendingReasons:[...new Set(pending.map(w=>w.task.transfer_training_key?w.reason:w.reevaluateWhen))]},
    latestAttemptId:Math.max(0,...facts.map(a=>a.id))};
}
