import yaml from "js-yaml";
import type {
  AdaptivePlannerShadow, Attempt, CoachConfidence, CoachDiagnosis, CoachDiagnosisState,
  ConceptWeaknessInsight, Dashboard, Problem, Review
} from "./types.ts";

export const COACH_SCHEMA_VERSION="stat1-coach-v1" as const;
export const COACH_HISTORY_META_KEY="coach-diagnosis-history-v1";

const text=(value:unknown,max=500)=>String(value??"").trim().slice(0,max);
const list=(value:unknown,max=3)=>Array.isArray(value)?value.slice(0,max):[];
const confidence=(value:unknown):CoachConfidence=>{
  const raw=text(value).toLowerCase();
  if(["high","高"].includes(raw))return "high";
  if(["medium","mid","中"].includes(raw))return "medium";
  return "low";
};
const finite=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const block=(source:string,key:string)=>{
  const start=source.indexOf(`${key}:`);
  if(start<0)return source;
  return source.slice(start);
};
const normalizeRows=<T>(rows:unknown,mapper:(row:Record<string,unknown>)=>T)=>(
  list(rows).filter(row=>row&&typeof row==="object").map(row=>mapper(row as Record<string,unknown>))
);

export function normalizeCoachUpdate(raw:unknown):CoachDiagnosis{
  const root=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
  const source=(root.coach_update&&typeof root.coach_update==="object"?root.coach_update:root) as Record<string,unknown>;
  if(source.schema_version&&text(source.schema_version)!==COACH_SCHEMA_VERSION)
    throw new Error(`coach_update schema_versionが不正です: ${text(source.schema_version)}`);
  const level=(source.level&&typeof source.level==="object"?source.level:{}) as Record<string,unknown>;
  const bottleneck=(source.primary_bottleneck&&typeof source.primary_bottleneck==="object"?source.primary_bottleneck:{}) as Record<string,unknown>;
  const probability=(source.optional_pass_probability&&typeof source.optional_pass_probability==="object"
    ?source.optional_pass_probability:null) as Record<string,unknown>|null;
  const rawLevel=finite(level.value);
  if(rawLevel<1||rawLevel>5)throw new Error("level.valueは1〜5で指定してください");
  const value=Math.round(rawLevel*2)/2;
  const cutoff=Math.trunc(finite(source.evidence_cutoff_attempt_id));
  if(cutoff<0)throw new Error("evidence_cutoff_attempt_idが不正です");
  const diagnosis:CoachDiagnosis={
    schemaVersion:COACH_SCHEMA_VERSION,reviewedAt:text(source.reviewed_at)||new Date().toISOString(),
    evidenceCutoffAttemptId:cutoff,
    level:{value,label:text(level.label,80),passOutlook:text(level.pass_outlook,80),
      confidence:confidence(level.confidence),rationale:text(level.rationale,600)},
    primaryBottleneck:{title:text(bottleneck.title,120),explanation:text(bottleneck.explanation,600),
      evidenceProblemIds:list(bottleneck.evidence_problem_ids,12).map(String).filter(Boolean),
      effectOnExam:text(bottleneck.effect_on_exam,400)},
    nextActions:normalizeRows(source.next_actions,row=>({title:text(row.title,120),purpose:text(row.purpose,300),
      practiceMethod:text(row.practice_method,400),successCondition:text(row.success_condition,300)})),
    strengths:normalizeRows(source.strengths,row=>({title:text(row.title,120),evidence:text(row.evidence,400)})),
    improvements:normalizeRows(source.improvements,row=>({title:text(row.title,120),evidence:text(row.evidence,400)})),
    unknowns:normalizeRows(source.unknowns,row=>({title:text(row.title,120),evidenceNeeded:text(row.evidence_needed,400)})),
    optionalPassProbability:probability?{range:text(probability.range,80),confidence:confidence(probability.confidence),
      rationale:text(probability.rationale,400)}:null,
  };
  if(!diagnosis.level.label||!diagnosis.level.passOutlook||!diagnosis.primaryBottleneck.title)
    throw new Error("levelとprimary_bottleneckの必須項目が不足しています");
  return diagnosis;
}

export function parseCoachUpdate(input:string){
  const fenced=[...input.matchAll(/```(?:ya?ml)?\s*([\s\S]*?)```/gi)].map(match=>match[1]);
  const candidates=[...fenced,block(input,"coach_update")];
  let failure:unknown;
  for(const candidate of candidates){
    try{return normalizeCoachUpdate(yaml.load(candidate))}catch(error){failure=error}
  }
  throw failure instanceof Error?failure:new Error("coach_update YAMLを読み取れませんでした");
}

const scoreFor=(attempt:Attempt)=>attempt.score_numeric??Number(String(attempt.score_text||"").match(/\d+/)?.[0]||NaN);
const confLabel=(value:CoachConfidence)=>value==="high"?"高":value==="medium"?"中":"低";

export function deriveProvisionalCoachDiagnosis(args:{
  attempts:Attempt[];concepts:ConceptWeaknessInsight[];dashboard:Dashboard;today:string;
}):CoachDiagnosis{
  const recent=[...args.attempts].filter(row=>!row.exclude_from_metrics).sort((a,b)=>b.id-a.id).slice(0,20);
  const scores=recent.map(scoreFor).filter(Number.isFinite);
  const average=scores.length?scores.reduce((sum,value)=>sum+value,0)/scores.length:0;
  const readiness=args.dashboard.readiness;
  const examEvidence=readiness.sampleSizes.pastExams+readiness.sampleSizes.timed+readiness.sampleSizes.unseen;
  let value=!recent.length?1.5:average<50?2:average<70?2.5:average<80?3:average<90?3.5:4;
  if(examEvidence===0)value=Math.min(value,3);
  const strong=args.concepts.reduce((sum,row)=>sum+row.strongFailures,0);
  const transfer=args.concepts.reduce((sum,row)=>sum+row.transferSuccesses,0);
  const delayed=args.concepts.reduce((sum,row)=>sum+row.delayedNoReferenceSuccesses,0);
  const certainty:CoachConfidence=examEvidence>=5&&delayed+transfer>=4?"high":recent.length>=8&&examEvidence+delayed+transfer>=2?"medium":"low";
  const top=args.concepts.filter(row=>row.state!=="resolved"&&row.state!=="unassessed")
    .sort((a,b)=>b.priorityScore-a.priorityScore)[0];
  const resolved=args.concepts.filter(row=>row.state==="resolved").slice(0,3);
  const missing:string[]=[];
  if(!readiness.sampleSizes.timed)missing.push("時間制限答案での安定性");
  if(!readiness.sampleSizes.pastExams)missing.push("過去問実答案での得点力");
  if(!transfer)missing.push("別問題への転移力");
  const label=value>=4.5?"高得点安定":value>=4?"合格答案を作れる段階":value>=3?"A/S問題を解けるが再現不安定":value>=2?"典型問題の理解段階":"基礎知識の補強段階";
  const outlook=value>=4.5?"安定合格圏":value>=4?"合格圏":value>=3?"境界手前〜境界圏":value>=2?"合格圏まで距離あり":"要基礎補強";
  return {schemaVersion:COACH_SCHEMA_VERSION,reviewedAt:`${args.today}T00:00:00+09:00`,
    evidenceCutoffAttemptId:Math.max(0,...args.attempts.map(row=>row.id)),
    level:{value,label,passOutlook:outlook,confidence:certainty,
      rationale:`直近${recent.length}件の答案と本番系証拠${examEvidence}件から作った自動暫定診断。GPTレビュー前の参考値です。`},
    primaryBottleneck:{title:top?`${top.displayName}の再現安定性`:"本番形式の診断証拠不足",
      explanation:top?top.nextRecommendedAction:"得点答案の証拠が不足しているため、最大障害をまだ特定できません。",
      evidenceProblemIds:[],effectOnExam:top?"関連問題の入口・途中式の安定性を下げる可能性があります。":"本番得点力の推定幅が広い状態です。"},
    nextActions:args.concepts.filter(row=>row.state!=="resolved"&&row.state!=="unassessed").slice(0,3).map(row=>({
      title:row.displayName,purpose:row.nextRecommendedAction,practiceMethod:"短い診断または別問題で、参照なしの再現性を確認する。",
      successCondition:"遅延または別問題で、同じconceptを参照なしで成功する。"})),
    strengths:resolved.map(row=>({title:row.displayName,evidence:`遅延成功${row.delayedNoReferenceSuccesses}件・転移成功${row.transferSuccesses}件`})),
    improvements:resolved.map(row=>({title:`${row.displayName}が解消状態`,evidence:row.evidenceSummary.slice(0,2).join("／")})),
    unknowns:missing.slice(0,3).map(title=>({title,evidenceNeeded:`${title}を測れる参照なしの実答案`})),optionalPassProbability:null};
}

const jsonLine=(value:unknown)=>JSON.stringify(value);
export function buildCoachReviewPrompt(args:{
  attempts:Attempt[];reviews:Review[];problems:Problem[];concepts:ConceptWeaknessInsight[];
  dashboard:Dashboard;planner:AdaptivePlannerShadow;today:string;
}){
  const pmap=new Map(args.problems.map(row=>[row.problem_id,row]));
  const attempts=[...args.attempts].filter(row=>!row.exclude_from_metrics).sort((a,b)=>b.id-a.id).slice(0,12).map(row=>({
    id:row.id,date:row.date,problem_id:row.problem_id,theme:pmap.get(row.problem_id)?.theme,mode:row.mode,
    learning_stage:row.learning_stage,learning_purpose:row.learning_purpose,score:row.score_numeric??row.score_label,mark:row.mark,
    errors:row.error_types||[row.error_type],findings:(row.graded_findings||[]).slice(0,6),error_point:text(row.error_point,220),
    reference:row.actual_reference_level??row.reference_level??0,hint:!!row.hint_used,review_outcome:row.review_outcome,
    transfer:!!row.transfer_evidence,retention:!!row.retention_eligible
  }));
  const concepts=args.concepts.slice(0,8).map(row=>({concept_id:row.conceptId,label:row.displayName,state:row.state,
    opportunities:row.independentOpportunities,failures:row.independentFailures,strong_failures:row.strongFailures,
    distinct_dates:row.distinctFailureDateCount,distinct_problems:row.distinctProblemCount,
    delayed_success:row.delayedNoReferenceSuccesses,transfer_success:row.transferSuccesses,
    past_exam_failures:row.pastExamFailureCount,confidence:row.evidenceConfidence,next:row.nextRecommendedAction}));
  const cutoff=Math.max(0,...args.attempts.map(row=>row.id));
  const reviewSummary={active:args.reviews.filter(row=>["pending","overdue"].includes(row.status)).length,
    success:args.reviews.filter(row=>row.completion_result==="success").length,
    failed:args.reviews.filter(row=>row.completion_result==="failed").length};
  return `あなたは統計検定1級・統計数理の学習コーチです。以下のFACTだけを根拠に、本番得点力としての現在地を評価してください。\n`+
    `テーマ別件数を言い換えるだけでなく、複数問題に共通する横断能力の最大ボトルネックを1件に絞ってください。根拠のない精密な合格確率は出さず、証拠不足はconfidenceとunknownsへ反映してください。\n\n`+
    `FACT_EVIDENCE_CUTOFF_ATTEMPT_ID: ${cutoff}\nDATE: ${args.today}\n`+
    `READINESS: ${jsonLine(args.dashboard.readiness)}\nREVIEW_SUMMARY: ${jsonLine(reviewSummary)}\n`+
    `PLANNER_READINESS: ${jsonLine({phase:args.planner.phase,days_remaining:args.planner.daysRemaining,weekly_actual:args.planner.weeklyActual,weekly_target:args.planner.weeklyTarget})}\n`+
    `RECENT_REPRESENTATIVE_ATTEMPTS: ${jsonLine(attempts)}\nTOP_CONCEPT_EVIDENCE: ${jsonLine(concepts)}\n\n`+
    `次のYAMLだけを返してください。reviewed_atは現在時刻、evidence_cutoff_attempt_idは${cutoff}をそのまま使用してください。level.valueは1〜5の0.5刻みです。optional_pass_probabilityは十分な根拠がなければnullにしてください。\n`+
`coach_update:
  schema_version: "${COACH_SCHEMA_VERSION}"
  reviewed_at: "YYYY-MM-DDTHH:mm:ss+09:00"
  evidence_cutoff_attempt_id: ${cutoff}
  level:
    value: <1.0-5.0>
    label: ""
    pass_outlook: ""
    confidence: "low | medium | high"
    rationale: ""
  primary_bottleneck:
    title: ""
    explanation: ""
    evidence_problem_ids: []
    effect_on_exam: ""
  next_actions:
    - title: ""
      purpose: ""
      practice_method: ""
      success_condition: ""
  strengths:
    - title: ""
      evidence: ""
  improvements:
    - title: ""
      evidence: ""
  unknowns:
    - title: ""
      evidence_needed: ""
  optional_pass_probability: null`;
}

export function buildCoachDiagnosisState(args:{
  history:CoachDiagnosis[];attempts:Attempt[];concepts:ConceptWeaknessInsight[];dashboard:Dashboard;
  reviews:Review[];problems:Problem[];planner:AdaptivePlannerShadow;today:string;
}):CoachDiagnosisState{
  const history=[...args.history].sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt)||
    b.evidenceCutoffAttemptId-a.evidenceCutoffAttemptId);
  const current=history[0]||null;
  const display=current||deriveProvisionalCoachDiagnosis(args);
  const newAttemptCount=current?args.attempts.filter(row=>row.id>current.evidenceCutoffAttemptId&&!row.exclude_from_metrics).length:args.attempts.length;
  return {current,display,history,source:current?"gpt":"local_provisional",stale:!!current&&newAttemptCount>0,
    newAttemptCount,prompt:buildCoachReviewPrompt(args),lastReviewedAt:current?.reviewedAt||null};
}

export function coachPreview(current:CoachDiagnosis|null,next:CoachDiagnosis){
  return {current,next,diff:{level:`${current?.level.value??"未診断"} → ${next.level.value}`,
    bottleneck:{before:current?.primaryBottleneck.title||"未診断",after:next.primaryBottleneck.title},
    nextActions:{before:(current?.nextActions||[]).map(row=>row.title),after:next.nextActions.map(row=>row.title)}}};
}

export const coachConfidenceLabel=confLabel;
