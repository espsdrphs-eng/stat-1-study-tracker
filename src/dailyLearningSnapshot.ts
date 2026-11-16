import {CAPABILITY_CATALOG_VERSION,capabilityStates,type CapabilityState} from './capabilityCatalog.ts';
import {capabilityDailyContextVersion,capabilityDate,projectCapabilityMap,type CapabilityFacts} from './capabilityEvidence.ts';
import {deriveCapabilityStudyPlan,takeCapabilityStudyCandidates} from './capabilityStudyPlan.ts';
import {theoryAddDays,theoryAspectKeys} from './capabilityTheory.ts';
import {GENERATION_CHECKS} from './generatedTransfer.ts';
import {DAILY_LEARNING_VERSION,type DailyReceipt} from './dailyLearningContract.ts';
import type {Attempt} from './types.ts';

const excerpt=(t:string|undefined|null,limit=165)=>t&&t.length>limit?t.slice(0,limit)+'…':t||null;
type View=ReturnType<typeof projectCapabilityMap>;
type Observation=View['abilities'][number]['history'][number]['observations'][number];
const byAnswer=(b:Observation,a:Observation)=>(a.attempt?.date||'').localeCompare(b.attempt?.date||'')||(a.attempt?.id||0)-(b.attempt?.id||0);
const recorded=(a:Attempt)=>({attempt_id:a.id,problem_id:a.problem_id,date:a.date,answered_at:a.daily_answer?.answered_at??null,
 kind:a.daily_answer?.kind??a.learning_purpose??null,baseline_attempt_id:a.daily_answer?.baseline_attempt_id??a.grading_contract?.sourceAttemptId??a.transfer_lineage?.sourceAttemptId??null,
 reference_level:a.reference_conditions_known===false?null:a.actual_reference_level??a.reference_level??null,hint_used:a.reference_conditions_known===false?null:a.hint_used??null,
 method_cued:a.daily_answer?.reference.method_cued??null,closed_reproduction:a.daily_answer?.reference.closed_reproduction??(a.reference_closed_reproduction===true?true:null),
 familiarity:a.daily_answer?.familiarity??'unknown',first_error:excerpt(a.error_point),
 ...(a.daily_answer?{first_error_part_id:a.daily_answer.first_error_part_id,affected_part_ids:a.daily_answer.affected_part_ids,independent_error_part_ids:a.daily_answer.independent_error_part_ids}:{}),
 parts:(a.graded_findings||[]).slice(0,24).map(f=>{const original=a.daily_answer?.parts.find(p=>p.part_id===f.graded_part_id);
  return {id:f.graded_part_id,result:original?.status??(f.resolved&&f.error_type==='none'?'correct':f.error_type==='none'?'unverified':'incorrect'),error_type:f.error_type,
   ...(f.concept_focus?{concept_focus:f.concept_focus}:{}),evidence:excerpt(original?.quote??f.evidence,120)};})});

export async function buildDailyLearningSnapshot(f:CapabilityFacts,receipts:DailyReceipt[],issues:string[],now=new Date().toISOString(),draftDate?:string){
 const context_version=await capabilityDailyContextVersion(f),today=capabilityDate(now),yesterday=theoryAddDays(today,-1)!;
 const map=projectCapabilityMap(f),plans=deriveCapabilityStudyPlan(map,{today,examDate:f.settings?.exam_date,minutes:f.settings?.daily_study_minutes,focusExam:false});
 const queue=new Map(plans.queue.map(c=>[c.ability.id,c]));
 const due=plans.queue.filter(c=>c.timing==='ready'||c.timing==='overdue'),main=(['repair','transfer','retention'] as const).flatMap(kind=>due.find(c=>c.kind===kind)??[]);
 const candidates=takeCapabilityStudyCandidates([...main,...due.filter(c=>!main.includes(c))],plans.minutes).recommended;
 const recent=[...receipts].filter(r=>r.learning_date<=today).sort((a,b)=>a.learning_date.localeCompare(b.learning_date)||a.saved_at.localeCompare(b.saved_at)||a.session_id.localeCompare(b.session_id));
 const confirmed=new Map<string,{receipt:DailyReceipt;entry:DailyReceipt['evaluations'][number]}>();
 for(const receipt of recent)for(const entry of receipt.evaluations)if(entry.proposed!==null)confirmed.set(entry.ability_id,{receipt,entry});
 const selectedAnswers=new Map<number,Attempt>();
 const link=(o:Observation|undefined)=>{
  if(!o?.attempt)return null;
  selectedAnswers.set(o.attempt.id,o.attempt);if(o.baseline)selectedAnswers.set(o.baseline.id,o.baseline);
  return {attempt_id:o.attempt.id,part_ids:o.link.part_ids,kind:o.link.kind,outcome:o.link.outcome,aspect:o.link.aspect??null,baseline_attempt_id:o.link.baseline_attempt_id,
   valid_direct_evidence:o.direct&&o.certainty==='confirmed',observation:excerpt(o.link.observation,130),...(o.warnings.length?{warnings:o.warnings.map(w=>excerpt(w,140))}:{})};
 };
 const abilities=map.abilities.map(a=>{
  const observations=a.history.flatMap(h=>h.observations).sort(byAnswer),valid=observations.filter(o=>o.direct&&o.certainty==='confirmed');
  const latestByOutcome=Object.fromEntries((['failure','success','partial'] as const).map(k=>[k,link(valid.find(o=>o.link.outcome===k)??observations.find(o=>o.link.outcome===k))]));
  const newest=observations[0],preferred=newest&&latestByOutcome[newest.link.outcome];
  const laterUncertain=newest&&(!newest.direct||newest.certainty!=='confirmed')&&preferred?.attempt_id!==newest.link.attempt_id?link(newest):null;
  const proofs=new Set(a.stateSource?.validation.proofIds.map(id=>Number(id.slice(1)))||[]);
  const support=a.stateSource?.observations.filter(o=>o.attempt&&proofs.has(o.attempt.id)&&o.direct).slice(0,2).map(link)??[];
  const last=a.theory.lastIndependent,lastTransfer=a.theory.aspects.transfer.history.find(o=>o.status==='success');
  if(last)selectedAnswers.set(last.attempt.id,last.attempt);
  if(lastTransfer?.attempt)selectedAnswers.set(lastTransfer.attempt.id,lastTransfer.attempt);
  // The receipt stamps the start of the import; the assessment in that same
  // transaction may be stamped later. Match its exact assessment context too.
  const recentDaily=confirmed.get(a.id),hold=recentDaily?.entry.status==='held'&&(!a.current||
   a.current.record.wire.context_version===recentDaily.receipt.assessment_context_version||Date.parse(a.current.record.createdAt)<=Date.parse(recentDaily.receipt.saved_at));
  const trace=a.theory.errorTrace,candidate=queue.get(a.id),knownChecks=theoryAspectKeys.map(k=>a.theory.aspects[k].status);
  const success=a.theory.aspects.derivation.history.find(o=>o.status==='success'&&o.link.kind==='immediate_reproduction');
  const lastRepair=valid.find(o=>o.link.kind==='local_repair'&&o.link.outcome==='success');
  const latestCompared=recentDaily?.entry.observations.filter(o=>o.comparison?.accepted).slice(-2)??[];
  const frequency=recentDaily?.entry.recurrence_comparison,onlyDerivation=a.theory.aspects.derivation.status==='success'&&a.theory.aspects.concept.status==='unconfirmed';
  const excluded=observations.find(o=>o.warnings.length&&!support.some(p=>p?.attempt_id===o.link.attempt_id));
  return {ability_id:a.id,name:a.name,domain_id:a.domainId,effective_state:a.state,proposed_state:hold?recentDaily.entry.proposed:a.current?.item.state??null,
   state_reason:a.current?excerpt(a.stateReason,230):null,certainty:a.current?.item.certainty??null,
   ...(support.length?{supports:support}:{}),...(Object.values(latestByOutcome).some(Boolean)?{latest_by_outcome:latestByOutcome}:{}),
   ...(laterUncertain&&newest?{newer_uncertain:{...laterUncertain,outcome:newest.link.outcome}}:{}),
   axes:Object.fromEntries(theoryAspectKeys.map((k,i)=>[k,knownChecks[i]])),last_independent_on:last?.attempt.date??null,last_independent_attempt_id:last?.attempt.id??null,
   last_delayed_transfer_on:lastTransfer?.attempt?.date??null,last_delayed_transfer_attempt_id:lastTransfer?.attempt?.id??null,
   unconfirmed_axes:theoryAspectKeys.filter((_k,i)=>knownChecks[i]==='unconfirmed'),
   waiting_for_reevaluation:!!hold||a.newerLinkedAnswers.length>0||a.warnings.length>0,
   ...(hold?{held_proposal:{session_id:recentDaily.receipt.session_id,reason:excerpt(recentDaily.entry.reason,300)}}:{}),
   ...(a.newerLinkedAnswers.length?{unreviewed_attempt_ids:a.newerLinkedAnswers.slice(0,6)}:{}),
   ...((success||lastRepair||a.theory.milestone||latestCompared.length||frequency||onlyDerivation||a.recurrence||a.improved)?{growth:{
    immediate_reproduction_attempt_id:success?.attempt?.id??null,local_repair:link(lastRepair),retention_minimum_days:a.theory.milestone,
    independently_graded_comparisons:latestCompared.map(o=>({attempt_id:o.attempt_id,compared:o.comparison})),
    recurrence_comparison:frequency??null,stage_improved:a.improved,stage_recurrence:a.recurrence,derivation_success_concept_unconfirmed:onlyDerivation}}:{}),
   ...(a.theory.failureAttemptIds.length||trace||a.state==='unrepaired'?{bottleneck:{first_error:excerpt(a.stateSource?.item.first_error??a.current?.item.first_error),
    active_failure_ids:a.theory.failureAttemptIds.slice(0,4),distinct_problem_count:a.theory.failureProblemCount,
    trace:trace??null,next_minimum_operation:candidate?.task??null}}:{}),
   ...(a.warnings.length?{warnings:a.warnings.slice(0,3).map(w=>excerpt(w,190))}:{}),
   ...(a.proposalSource?.item.next_check?{next_check:a.proposalSource.item.next_check}:{}),
   ...(excluded?{excluded_example:link(excluded)}:{})};
 });
 const recentRows=recent.slice(-4).filter(r=>r.learning_date>=yesterday||r===recent.at(-1));
 for(const row of recentRows)for(const a of row.answers){const saved=f.attempts.find(x=>x.id===a.attempt_id);if(saved)selectedAnswers.set(saved.id,saved)}
 for(const a of [...f.attempts].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id).slice(0,8))selectedAnswers.set(a.id,a);
 const previousSessions=recent.filter(r=>r.learning_date===yesterday);
 const previousStatus=draftDate===yesterday?'local_draft_not_confirmed':previousSessions.length?'daily_package_registered':f.attempts.some(a=>a.date===yesterday)?'individual_records_only':'not_registered_or_no_study';
 const latestLearningDate=f.attempts.map(a=>a.date).sort().at(-1)??null;
 const latestLearningTime=f.attempts.filter(a=>a.date===latestLearningDate).map(a=>a.daily_answer?.answered_at).filter((t):t is string=>!!t).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)??null;
 const snapshot={schema_version:'stat1-daily-snapshot-v1',learning_goal:'long_term_theory',catalog_version:CAPABILITY_CATALOG_VERSION,context_version,study_date:today,created_at:now,
  latest_learning_date:latestLearningDate,latest_recorded_answered_at:latestLearningTime,counts:map.counts,metrics:map.metrics,
  previous_day:{date:yesterday,status:previousStatus,saved_sessions:previousSessions.map(r=>r.session_id),
   warning:previousStatus==='daily_package_registered'?null:'前日の日次保存は確認できません（個別記録・貼り付け中・学習なしを区別）。ChatGPTだけの活動はアプリでは確認できません。'},
  candidates:candidates.map(c=>({ability_id:c.ability.id,kind:c.kind,task:c.task,due_date:c.dueDate,success_condition:c.successCondition,reason:c.reason,minutes:c.minutes,source:c.source})),
  abilities,representative_answers:[...selectedAnswers.values()].map(recorded),
  recent_daily_sessions:recentRows.map(r=>({session_id:r.session_id,learning_date:r.learning_date,departure_reason:r.departure_reason,source_status:r.source_status,
   held_ability_ids:r.evaluations.filter(e=>e.status==='held').map(e=>e.ability_id),new_attempt_ids:r.answers.map(a=>a.attempt_id),
   coaching_without_answer:r.coaching_without_answer.map(({ability_id,baseline_attempt_id,target,unconfirmed})=>({ability_id,baseline_attempt_id,target,unconfirmed})),
   observations:r.evaluations.flatMap(e=>e.observations.map(o=>({ability_id:e.ability_id,attempt_id:o.attempt_id,kind:o.kind,outcome:o.outcome,aspect:o.aspect,application_status:o.status,comparison:o.comparison??null}))).slice(0,40)})),
  warnings:[...issues,...recentRows.flatMap(r=>r.evaluations.filter(e=>e.status==='held').map(e=>`${e.ability_id}：${e.reason}`)).slice(0,12)],
  limitations:'代表答案は原本の一部のみ。引用品は一部省略する。学習していない・未着手・取込前の事実は推測しない。再発率の改善は比較可能な観測がなければ判断しない。正式得点とGPT推定採点は別。未確認は未達ではない。'} as const;
 const prompt=`統計検定1級「統計数理」の理論学習を、ChatGPTで指導してください。learning_goal=long_term_theory。
【日中】まず保存済みの失敗・成功・部分成功、取込保留と未確認を照合する。知識の説明・仮定の判断・自力導出・転移・保持を区別する。候補は提案のみ。初見診断・局所補修・遅延転移・本番練習から選び、最初の誤りと連鎖的失点、独立した計算ミスを区別する。重点補修は原則1操作、必要なら2操作。候補を変えた場合は理由を記録する。
診断と非誘導確認では題そのものだけを提示し、能力ID・分野名、解法、公式、生成理由、品質記録・解答を答案の固定前に見せない。既習の類題を初見成功としない。補修は解説段階、別の参照なし自力再現を分ける。失敗が続けば前提操作へ戻る。数値だけ変えた問題を転移にしない。
【夜】私が「今日の学習結果をアプリへ」と言ったときだけ、次の契約の標準JSONを1個返す（半角の引用符、明示的なnull、空配列[]。説明をJSONに混ぜない）。問題・初回・実際に出した別答案・評価を一つにまとめる。写真の再登録は不要。実際に見た式・判断だけを quote として原文のまま短く引用する。再構成した正解・未着手を答案に入れない。判読不能なら unreadable、空欄は unattempted。不明な日時・参照・得点は null にする。日付は日本時間、日時はISO 8601でオフセットを含める。
問題・答案には別々のローカルID p1, a1 など。アプリの正式IDを推測しない。過去の基準答案のみ提示された正の整数IDを使え、同日の基準は先に並べた仮答案IDを使う。既存問題は existing_problem_id だけで参照し、問題文や配点を更新しない。自作問題は q1,q2… の固定項目を順に作る。基準の初回答案には全採点項目を含め、白紙も明示する。補修は実際に採点した部分だけ。補修の得点を初回得点に書き戻さない。
パッケージ：schema_version=${DAILY_LEARNING_VERSION}, session_id（英字で始まる日毎に一意の識別子・再出力時も保持）, learning_date, morning_context_version（下の context_version を変更せず使用）, catalog_version, created_at, learning_goal, source_status=observed|limited, departure_reason, problems[], answers[], evaluations[]。解説は行ったが補修答案は出ていない場合だけ coaching_without_answer:[{baseline,ability_id,target,guidance,unconfirmed}] を加える。架空の答案は作らない。
problems[]：ref,title,statement,parts:[{id,label}], 任意theme（既存は ref,existing_problem_id）、purpose:diagnostic|local_repair|delayed_transfer|exam, familiarity:unseen|seen|unknown, shown:[statement|ability_name|method|hint|solution|quality|generation_reason|unknown の実際に提示したもの], presented_at, quality, target_ability_ids[], selection_reason。不明は明示。独立品質確認を本当に実施した場合のみ quality:{generator_pass_id,validator_pass_id,checked_at,checks:{${GENERATION_CHECKS.map(k=>k+':{pass,evidence}').join(', ')}}}。出題前に別passで照合し、学習者は品質内容を答案提出まで見ない。確認できなければ null。見た場合 shown に記録する。
answers[]：ref,problem_ref,kind:diagnostic|local_repair|immediate_reproduction|delayed_transfer|exam,baseline,answered_at,source:handwriting|chat_text|other|unknown,reference:{level:0〜5またはnull,hint_used,method_cued,closed_reproduction（trueは解説を閉じた別の直後答案だけ）},score:{points,max}またはnull,grading_confidence（0〜100）,parts:[{part_id,status:correct|incorrect|partial|unattempted|unreadable,quote,finding,error_type:none|K|W|N|C,任意 concept_focus:meaning|justification|assumption|limit|distinction|mathematization,任意 score:{points,max},既存基準のKの場合 k_evidence}],first_error_part_id,affected_part_ids[],independent_error_part_ids[]。局所補修の別答案には repair:{ability_id,target,guidance,unconfirmed}。採点尺度と採点範囲が違う得点を比較しない。正式な本番セッションの登録は従来の本番演習の機能を使う。
evaluations[]：今回直接対応づけた能力だけ {ability_id,state:unconfirmed|unrepaired|immediate_confirmed|delayed_transfer_confirmed|exam_confirmed,certainty:confirmed|provisional|conflicting,judgement,cause_hypothesis,任意cause_confidence:low|medium|high,evidence:[{answer_ref,part_ids[],outcome:success|failure|partial|uncertain,aspect:derivation|concept|transfer|retention,observation,説明を採点した場合だけconcept_focus,異構造を実際に照合した場合だけstructure_difference,根拠のある比較だけcomparison:{against,result:improved|recurrence|partial_repair|unverified,reason}}],next_check:{basis（今回の仮答案ID）,kind,due_date,task,success_condition,任意aspect,interval_days（保持のみ）} または null}。再発頻度を比較する場合だけ recurrence_comparison:{before:[答案ID],after:[答案ID],aspect,reason} を追加。同条件で各2件以上・同数、今回の別答案を含める。なければ回数や改善率を推定しない。不確かな対応は保留。局所補修だけで直後再現や保持にしない。同じ問題での後日再現と異構造転移を区別する。間隔は直後、初期転移24〜72時間、保持は約7・30・90日を目安にし、既存予定を上書きしない。
【保存済みスナップショット】\n${JSON.stringify(snapshot)}`;
 return {snapshot,prompt};
}

type DailySnapshot=Awaited<ReturnType<typeof buildDailyLearningSnapshot>>['snapshot'];
const supportedOutcome=['failure','success','partial'] as const;
const pickText=(lines:Array<string|undefined|null>,limit:number)=>lines.filter((x):x is string=>!!x).map(x=>excerpt(x,limit));

/** Compress the presentation, not the evidence universe or the context hash.
 * In particular, don't use today's suggested queue to decide which abilities
 * may expose an earlier success, a recent failure or an uncertain observation. */
export function buildBriefDailyPrompt(s:DailySnapshot){
 const states=Object.keys(capabilityStates) as CapabilityState[];
 const byState=Object.fromEntries(states.map(state=>[state,s.abilities.filter(a=>a.effective_state===state).map(a=>[a.ability_id,a.name])]));
 const recent=s.recent_daily_sessions.at(-1);
 const shortEvidence=(o:NonNullable<DailySnapshot['abilities'][number]['latest_by_outcome']>[string])=>o&&[o.attempt_id,o.part_ids,o.kind,o.aspect,o.valid_direct_evidence,excerpt(o.observation,96),o.baseline_attempt_id];
 const facts=Object.fromEntries(s.abilities.flatMap(a=>{
  const outcomes=Object.fromEntries(supportedOutcome.flatMap(k=>{
   const o=a.latest_by_outcome?.[k];
   return o?[[k,shortEvidence(o)]]:[];
  }));
  const recurrence=a.growth?.recurrence_comparison;
  const row={
   ...(Object.keys(outcomes).length?{outcomes}:{}),
   ...(a.supports?.length?{state_proof_ids:[...new Set(a.supports.flatMap(o=>o?[o.attempt_id]:[]))]}:{}),
   ...(a.unconfirmed_axes.length!==theoryAspectKeys.length?{checked_aspects:Object.fromEntries(Object.entries(a.axes).filter(([,status])=>status!=='unconfirmed'))}:{}),
   ...(a.last_independent_on?{last_independent:[a.last_independent_on,a.last_independent_attempt_id]}:{}),
   ...(a.last_delayed_transfer_on?{last_transfer:[a.last_delayed_transfer_on,a.last_delayed_transfer_attempt_id]}:{}),
   ...(a.proposed_state&&a.proposed_state!==a.effective_state?{gpt_proposal:a.proposed_state}:{}),
   ...(a.certainty&&a.certainty!=='confirmed'?{latest_gpt_certainty:a.certainty}:{}),
   ...(a.newer_uncertain?{newer_uncertain:{observed_outcome:a.newer_uncertain.outcome,evidence:shortEvidence(a.newer_uncertain)}}:{}),
   ...(a.waiting_for_reevaluation?{needs_review:true,review_reason:excerpt(a.held_proposal?.reason??a.warnings?.[0],120)??undefined}:{}),
   ...(a.unreviewed_attempt_ids?.length?{unreviewed_attempt_ids:a.unreviewed_attempt_ids}:{}),
   ...(a.growth?.retention_minimum_days?{retention_days_at_least:a.growth.retention_minimum_days}:{}),
   ...(a.growth?.stage_recurrence?{recorded_recurrence:true}:{}),...(a.growth?.stage_improved?{recorded_stage_change:true}:{}),
   ...(a.growth?.independently_graded_comparisons.length?{comparisons:a.growth.independently_graded_comparisons.map(c=>[c.attempt_id,c.compared?.against_attempt_id,c.compared?.result])}:{}),
   ...(recurrence&&recurrence.before_failures!==null&&recurrence.after_failures!==null?{verified_recurrence_comparison:{...recurrence,reason:excerpt(recurrence.reason,110)}}:{}),
   ...(a.bottleneck?.first_error?{first_error:excerpt(a.bottleneck.first_error,96)}:{}),
   ...(a.bottleneck?.distinct_problem_count?{unrepaired_evidence:[a.bottleneck.distinct_problem_count,a.bottleneck.active_failure_ids]}:{}),
   ...(a.bottleneck?.trace?{error_trace:a.bottleneck.trace}:{}),
   ...(a.next_check?{next_check:[a.next_check.kind,a.next_check.due_date,excerpt(a.next_check.task,94)]}:{}),
  };
  return Object.keys(row).length?[[a.ability_id,row]]:[];
 }));
 const evidenceExtras=new Map<number,Set<string>>();
 for(const a of s.abilities)for(const o of [...Object.values(a.latest_by_outcome||{}),a.newer_uncertain])if(o){
  const parts=evidenceExtras.get(o.attempt_id)??new Set<string>();for(const id of o.part_ids.slice(0,3))parts.add(id);evidenceExtras.set(o.attempt_id,parts);
 }
 const brief={schema_version:'stat1-daily-brief-v1',learning_goal:s.learning_goal,catalog_version:s.catalog_version,context_version:s.context_version,study_date:s.study_date,
  latest_learning_date:s.latest_learning_date,latest_recorded_answered_at:s.latest_recorded_answered_at,counts:s.counts,
  previous_day:{date:s.previous_day.date,status:s.previous_day.status},
  candidates:s.candidates.map(c=>({ability_id:c.ability_id,kind:c.kind,due_date:c.due_date,task:excerpt(c.task,96),reason:excerpt(c.reason,92),success_condition:excerpt(c.success_condition,80)})),
  abilities_by_state:byState,ability_facts:facts,
  outcome_columns:['attempt_id','part_ids','kind','aspect','direct_and_confirmed','observation','baseline_attempt_id'],
  answer_columns:['problem_id','date','kind','reference_level','hint_used','familiarity','baseline_attempt_id'],
  representative_answers:s.representative_answers.map(a=>({attempt_id:a.attempt_id,conditions:[a.problem_id,a.date,a.kind,a.reference_level,a.hint_used,a.familiarity,a.baseline_attempt_id],
   ...(a.method_cued!==null?{method_cued:a.method_cued}:{}),...(a.closed_reproduction!==null?{closed_reproduction:a.closed_reproduction}:{}),
   ...(evidenceExtras.has(a.attempt_id)?{excerpts:a.parts.filter(f=>evidenceExtras.get(a.attempt_id)!.has(f.id)).slice(0,1).map(f=>[f.id,f.result,excerpt(f.evidence,68)])}:{}),
   ...(a.affected_part_ids?.length?{first_part_id:a.first_error_part_id,affected_part_ids:a.affected_part_ids}:{}),
   ...(a.independent_error_part_ids?.length?{independent_error_part_ids:a.independent_error_part_ids}:{})})),
  ...(recent?{recent_daily:{learning_date:recent.learning_date,source_status:recent.source_status,departure_reason:excerpt(recent.departure_reason,84),
   new_attempt_ids:recent.new_attempt_ids,held_ability_ids:recent.held_ability_ids,
   observation_columns:['ability_id','attempt_id','outcome','kind','aspect','application_status'],
   observations:recent.observations.map(e=>[e.ability_id,e.attempt_id,e.outcome,e.kind,e.aspect,e.application_status]),
   ...(recent.coaching_without_answer.length?{coaching_without_answer:recent.coaching_without_answer.map(x=>[x.ability_id,x.baseline_attempt_id,excerpt(x.target,70),excerpt(x.unconfirmed,70)])}:{})}}:{}),
  warnings:pickText([s.previous_day.warning,...s.warnings.slice(0,6)],130),
 };
 // Serialize a single example so JSON field names/quoting don't depend on a
 // prose description. A placeholder created_at makes the example itself
 // non-importable; GPT must use the actual date, task and submitted work.
 const example={schema_version:DAILY_LEARNING_VERSION,catalog_version:s.catalog_version,morning_context_version:s.context_version,
  session_id:`study-${s.study_date}-1`,learning_date:s.study_date,created_at:'実際の出力日時（時差付きISO）',learning_goal:s.learning_goal,source_status:'limited',
  problems:[{ref:'p1',title:'題名',statement:'実際の問題文',purpose:'diagnostic',familiarity:'unknown',shown:['unknown'],target_ability_ids:[],parts:[{id:'q1',label:'小問1'}]}],
  answers:[{ref:'a1',problem_ref:'p1',kind:'diagnostic',baseline:null,source:'handwriting',answered_at:null,
   reference:{level:null,hint_used:null,method_cued:null,closed_reproduction:null},score:null,grading_confidence:null,
   first_error_part_id:null,affected_part_ids:[],independent_error_part_ids:[],parts:[{part_id:'q1',status:'unreadable',quote:null,finding:'読めない場合の例',error_type:'none'}]}],evaluations:[]};
 return `統計検定1級「統計数理」の長期学習を指導してください。以下はアプリの事実と候補で、指導・出題・補修の決定はあなたが行います。候補は必須でも順位の確定でもありません。候補外や長く未確認の操作も検討し、記録の多さ・低得点だけで弱点扱いしないでください。補修は原則1操作。判断を変えうる過去の成功／失敗や条件が足りなければ、対象能力・答案IDを示して詳細を求めてください。
全75能力は abilities_by_state（各行はID、名称）。ability_facts は根拠の抜粋で、載っていないことは失敗を意味しません。outcomes は失敗・成功・部分成功を別々に示します。列は outcome_columns / answer_columns。unrepaired_evidence は未修復証拠の異なる問題数と代表答案ID。direct_and_confirmed:false は未確定。日付、答案の実施区分、参照の有無を照合し、古い自力成功と最近の未達を両方考慮。補修の成功は自力成功・転移とは別。未着手を未達にしないでください。
初見・非誘導の出題では答案確定まで能力名・公式・解法・正答・品質確認を明かさず、既習と区別。採点では最初の誤り・波及・独立ミスを区別し、確認済みの得点は書き換えないでください。
「今日の学習結果をアプリへ」と言われたら下の形式の標準JSONを1個だけ。capability_update は返さない。例の文言は保存せず、実際の日付・題・答案に置換。版番号は例のまま、session_id は同日内で一意にし再出力時は保持。learning_date は実際の学習日、created_at は出力日時（時差付きISO、必須）。出題・提出時刻の不明は null。候補から変更した理由は departure_reason。確認できない問題や答えは作らず資料を求めてください。quote は実際の答案の引用。parts.status は correct/incorrect/partial/unattempted/unreadable。白紙は unattempted・error_type:none・quote:null。実際の誤りだけ K/W/N/C（Kには根拠 k_evidence が必須）、得点は score:{points,max}。problems は新規なら元の問題文と q1,q2… の固定項目、既存なら existing_problem_id で参照し問題文・採点項目は送らない。答案は仮ID、先に初回を置き、同じ問題の局所補修は別 ref・kind:local_repair・baseline:初回の仮ID・repair:{ability_id,target,guidance,unconfirmed}。解説を閉じヒントなしで別答案を出したときだけ immediate_reproduction。非誘導の遅延転移は独立した品質確認・構造差・非閲覧を詳しい版の要件で照合し、不明は昇格させない。
evaluations は採点項目で裏付けられる能力だけ、不要なら []。各行 {ability_id,state,certainty,judgement,evidence:[{answer_ref,part_ids,outcome,aspect,observation}],next_check:null または {basis,kind,due_date,task,success_condition}}。outcome は success/failure/partial/uncertain、aspect は derivation/concept/transfer/retention、certainty は confirmed/provisional/conflicting。評価状態は abilities_by_state のキー。concept_focus は meaning/justification/assumption/limit/distinction/mathematization。実際に説明を採点したときだけ採点項目と証拠に付ける。判断が変わる詳細が必要なら「全75能力の詳しい情報をコピー」を依頼してください。
【夜の形式例】\n${JSON.stringify(example)}
【保存済みスナップショット】\n${JSON.stringify(brief)}`;
}
