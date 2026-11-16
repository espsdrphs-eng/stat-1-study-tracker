import {CAPABILITY_CATALOG_VERSION} from './capabilityCatalog.ts';
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
  const proofs=new Set(a.stateSource?.validation.proofIds.map(id=>Number(id.slice(1)))||[]);
  const support=a.stateSource?.observations.filter(o=>o.attempt&&proofs.has(o.attempt.id)&&o.direct).slice(0,2).map(link)??[];
  const last=a.theory.lastIndependent,lastTransfer=a.theory.aspects.transfer.history.find(o=>o.status==='success');
  if(last)selectedAnswers.set(last.attempt.id,last.attempt);
  if(lastTransfer?.attempt)selectedAnswers.set(lastTransfer.attempt.id,lastTransfer.attempt);
  const recentDaily=confirmed.get(a.id),hold=recentDaily?.entry.status==='held'&&(!a.current||Date.parse(a.current.record.createdAt)<=Date.parse(recentDaily.receipt.saved_at));
  const trace=a.theory.errorTrace,candidate=queue.get(a.id),knownChecks=theoryAspectKeys.map(k=>a.theory.aspects[k].status);
  const success=a.theory.aspects.derivation.history.find(o=>o.status==='success'&&o.link.kind==='immediate_reproduction');
  const lastRepair=valid.find(o=>o.link.kind==='local_repair'&&o.link.outcome==='success');
  const latestCompared=recentDaily?.entry.observations.filter(o=>o.comparison?.accepted).slice(-2)??[];
  const frequency=recentDaily?.entry.recurrence_comparison,onlyDerivation=a.theory.aspects.derivation.status==='success'&&a.theory.aspects.concept.status==='unconfirmed';
  const excluded=observations.find(o=>o.warnings.length&&!support.some(p=>p?.attempt_id===o.link.attempt_id));
  return {ability_id:a.id,name:a.name,domain_id:a.domainId,effective_state:a.state,proposed_state:hold?recentDaily.entry.proposed:a.current?.item.state??null,
   state_reason:a.current?excerpt(a.stateReason,230):null,certainty:a.current?.item.certainty??null,
   ...(support.length?{supports:support}:{}),...(Object.values(latestByOutcome).some(Boolean)?{latest_by_outcome:latestByOutcome}:{}),
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
