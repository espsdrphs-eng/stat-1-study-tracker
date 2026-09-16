import type { Attempt, PastSession, Problem, ProblemAlias } from "./types.ts";
import { examScoreEligibility } from "./scoreEligibility.ts";
import { excludeLegacyKFromPlanning, findingPlanningEligible } from "./legacyKPolicy.ts";
import { scanMetrics, selectionSuccessRate } from "./pastExamWorkflow.ts";
import {resolvePastExamProblemId} from "./examReferencePack.ts";
import {deriveTransferEvidence,partSkillIds,problemSkillIds} from "./skillEvidence.ts";
import {examHorizonPolicy} from "./examOptimizationPolicy.ts";
import {deriveFailureEpisode} from "./failureEpisode.ts";

export type ExamPhase =
  | "foundation_to_A"
  | "A_and_past_parallel"
  | "past_exam_main"
  | "final_stabilization";

export type ExamReadinessMetrics = {
  evidence?: LearningMetricEvidence;
  unseenScoreRate: number | null;
  timedCompletionRate: number | null;
  selectionSuccessRate: number | null;
  pastExamScoreRate: number | null;
  kRecurrenceRate: number | null;
  repeatedWRate: number | null;
  typeIdentificationAccuracy:number|null;
  firstStepAccuracy:number|null;
  predictedScoreCalibration:number|null;
  predictedTimeCalibration:number|null;
  sampleSizes: {
    unseen: number;
    timed: number;
    scans: number;
    selectionPending?: number;
    pastExams: number;
    kReviews: number;
    wReviews: number;
  };
};

export type MetricEvidence={value:number|null;numerator:number;denominator:number;evidenceCount:number;
  eligibleEvidenceRule:string;modeScope:string[];lastUpdated:string|null;confidence:"low"|"medium"|"high";
  eligibleEvidenceIds:string[];lastUpdatedAt:string|null;missingEvidenceReason:string|null};
export type LearningMetricEvidence={
  selectedThree:MetricEvidence&{sessions:Array<{sessionId:number;year:number;score:number;attemptIds:number[]}>};
  individual:MetricEvidence;diagnostic:MetricEvidence;timed:MetricEvidence;selection:MetricEvidence;
  transfer?:MetricEvidence;unseen?:MetricEvidence;repeatedMajor?:MetricEvidence;
};
const metric=(numerator:number,denominator:number,count:number,rule:string,modes:string[],date:string|null,percent=false):MetricEvidence=>({
  value:denominator?numerator/denominator*(percent?100:1):null,numerator,denominator,evidenceCount:count,
  eligibleEvidenceRule:rule,modeScope:modes,lastUpdated:date,lastUpdatedAt:date,eligibleEvidenceIds:[],
  missingEvidenceReason:denominator?null:`未計測：${rule}`,confidence:count>=6?"high":count>=3?"medium":"low"});

export function normalizeProblemId(value: string) {
  const raw = String(value || "").toUpperCase().replace(/[‐‑‒–—―ー－]/g, "-").trim();
  const white = raw.match(/^WB-(\d+)-([AS])-(\d+)$/);
  if (white) return `WB-${Number(white[1])}-${white[2]}-${String(Number(white[3])).padStart(2, "0")}`;
  const past = raw.match(/^PY-(\d{4})-Q(\d+)$/);
  return past ? `PY-${past[1]}-Q${Number(past[2])}` : raw;
}

export function resolveCanonicalProblemId(problemId: string, aliases: ProblemAlias[]) {
  let current = normalizeProblemId(problemId);
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const alias = aliases.find(item => {
      const row = item as ProblemAlias & {
        raw_problem_id?: string;
        corrected_problem_id?: string;
        canonical_problem_id?: string;
      };
      return normalizeProblemId(row.raw_problem_id || "") === current ||
        normalizeProblemId(item.alias || "") === current ||
        normalizeProblemId(item.problem_id || "") === current && !!row.corrected_problem_id;
    }) as (ProblemAlias & { corrected_problem_id?: string; canonical_problem_id?: string }) | undefined;
    const next = normalizeProblemId(alias?.corrected_problem_id || alias?.canonical_problem_id || alias?.problem_id || "");
    if (!alias || !next || next === current) break;
    current = next;
  }
  return current;
}

export function getExamPhase(daysRemaining: number): ExamPhase {
  return examHorizonPolicy(daysRemaining).phase;
}

export const examPhaseLabels: Record<ExamPhase, string> = {
  foundation_to_A: "S限定補修＋A問題着手",
  A_and_past_parallel: "A問題＋過去問並行",
  past_exam_main: "過去問主軸＋弱点補修",
  final_stabilization: "本番演習＋弱点限定補修",
};

export const examPhaseAllocations: Record<ExamPhase, string> = {
  foundation_to_A: "A問題45%・S限定補修25%・型識別/5問スキャン15%・過去問観察15%",
  A_and_past_parallel: "A問題40%・過去問30%・S限定補修15%・型識別/選題15%",
  past_exam_main: "本番演習65〜70%・過去問由来の補修30〜35%",
  final_stabilization: "simulation/本番形式70%以上・確認済み弱点だけ補修",
};

const validScore = (attempt: Attempt) =>
  typeof attempt.score_numeric === "number" && Number.isFinite(attempt.score_numeric);

const scoreAverage = (attempts: Attempt[]) => {
  const scored = attempts.filter(validScore);
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, attempt) => sum + Number(attempt.score_numeric || 0), 0) / scored.length);
};

const noReference = (attempt: Attempt) => Number(attempt.actual_reference_level ?? attempt.reference_level ?? 0) === 0;

function parseProblemList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(/[;,、\s]+/).map(item => item.trim()).filter(Boolean);
}

export function calculateExamReadinessMetrics(args: {
  problems: Problem[];
  attempts: Attempt[];
  pastSessions: PastSession[];
  aliases: ProblemAlias[];
  today: string;
}): ExamReadinessMetrics {
  const { problems, attempts, pastSessions, aliases, today } = args;
  void today;
  const sessionAttemptIds=new Set(pastSessions.flatMap(s=>[...(s.linked_attempt_ids||[]),
    ...(s.selected_timed_attempt_ids||[]),...(s.counterfactual_calibration_attempt_ids||[])]));
  const skillProblems=new Map<string,Set<string>>();
  for(const p of problems)for(const id of problemSkillIds(p))skillProblems.set(id,new Set([...(skillProblems.get(id)||[]),p.problem_id]));
  for(const a of attempts)for(const id of (a.grading_contract?.gradedParts||[]).flatMap(partSkillIds))
    skillProblems.set(id,new Set([...(skillProblems.get(id)||[]),a.problem_id]));
  const transferRows=deriveTransferEvidence(attempts);
  const transferOpportunities=new Set(attempts.filter(a=>!a.exclude_from_metrics&&!a.duplicate_of_attempt_id).flatMap(a=>
    (a.graded_findings||[]).filter(f=>findingPlanningEligible(a,f)&&!f.resolved&&f.error_type!=="none").flatMap(f=>
      partSkillIds(a.grading_contract?.gradedParts.find(p=>p.id===f.graded_part_id))
        .filter(id=>(skillProblems.get(id)?.size||0)>1).map(id=>`${a.problem_id}|${id}`))));
  const transferred=new Set(transferRows.map(t=>`${t.sourceProblemId}|${t.skillId}`));
  const problemMap = new Map(problems.map(problem => [resolveCanonicalProblemId(problem.problem_id, aliases), problem]));
  const sorted = [...attempts].sort((a, b) => `${a.date}:${a.id}`.localeCompare(`${b.date}:${b.id}`));
  const lastByProblem = new Map<string, Attempt>();
  const transferAttempts: Attempt[] = [];
  const timedAttempts: Attempt[] = [];
  const pastExamAttempts: Attempt[] = [];
  const kGroups = new Map<string, number>();
  const wGroups = new Map<string, number>();

  for (const attempt of sorted) {
    const canonicalId = resolveCanonicalProblemId(attempt.problem_id, aliases);
    const problem = problemMap.get(canonicalId);
    const previous = lastByProblem.get(canonicalId);
    const daysSince = previous
      ? Math.floor((new Date(`${attempt.date}T12:00:00`).getTime() - new Date(`${previous.date}T12:00:00`).getTime()) / 86400000)
      : Infinity;
    const eligibility=!attempt.exclude_from_metrics&&!attempt.duplicate_of_attempt_id&&
      !attempt.is_review_attempt&&attempt.learning_purpose!=="error_repair"&&
      attempt.evaluation_scope!=="conditional_full"&&attempt.assessment_timing!=="same_session_correction"&&
      ["full","timed","timed_single","exam_90min","past_exam"].includes(attempt.mode)&&noReference(attempt)&&!attempt.hint_used&&
      (attempt.exam_score_eligible===true||examScoreEligibility(attempt,problem).eligible);
    const eligibilityResult=examScoreEligibility(attempt,problem);
    const standaloneExamAttempt=!attempt.parent_past_session_id&&!sessionAttemptIds.has(attempt.id)&&
      attempt.session_role!=="counterfactual_calibration";
    if (standaloneExamAttempt&&(!previous || daysSince >= 30) && eligibility && noReference(attempt) && validScore(attempt)) transferAttempts.push(attempt);
    const mode = attempt.mode || "";
    const timeLimit = mode === "exam_90min" ? 90 : mode === "full" ? 35 : problem?.category === "past_exam" ? 30 : 0;
    if (standaloneExamAttempt&&eligibility&&Number(attempt.time_minutes)>0&&timeLimit) timedAttempts.push(attempt);
    if (standaloneExamAttempt&&eligibility&&problem?.category === "past_exam" && validScore(attempt)) pastExamAttempts.push(attempt);
    const errors = new Set([...(attempt.error_types || []), attempt.primary_error_type || attempt.error_type || ""].filter(Boolean));
    if(excludeLegacyKFromPlanning(attempt))errors.delete("K");
    if (errors.has("K")) kGroups.set(canonicalId, (kGroups.get(canonicalId) || 0) + 1);
    if (errors.has("W")) {
      const theme = problem?.theme || attempt.raw_gpt_theme || canonicalId;
      wGroups.set(theme, (wGroups.get(theme) || 0) + 1);
    }
    lastByProblem.set(canonicalId, attempt);
  }

  const timedSuccesses = timedAttempts.filter(attempt => {
    const problem = problemMap.get(resolveCanonicalProblemId(attempt.problem_id, aliases));
    const mode = attempt.mode || "";
    const limit = mode === "exam_90min" ? 90 : mode === "full" ? 35 : problem?.category === "past_exam" ? 30 : 0;
    return limit > 0 &&
      Number(attempt.time_minutes || 0) > 0 &&
      Number(attempt.time_minutes || 0) <= limit &&
      attempt.conclusion_reached!==false;
  });

  const scanSessions = pastSessions.filter(session => ["scan_5_questions", "scan5"].includes(session.session_type)||!!session.session_kind);
  const scanScores=scanSessions.map(selectionSuccessRate).filter((value):value is number=>value!=null);
  const scanRows=scanSessions.map(scanMetrics);
  const averageNullable=(values:Array<number|null>)=>{const rows=values.filter((value):value is number=>value!=null);return rows.length?Math.round(rows.reduce((a,b)=>a+b,0)/rows.length):null};

  const selectedRows=(session:PastSession)=>{
    const ids=new Set((session.final_selected_problem_ids?.length?session.final_selected_problem_ids:session.initial_selected_problem_ids||[])
      .map(id=>resolvePastExamProblemId(session.year,id)));
    return (session.questions||[]).filter(row=>ids.size?ids.has(resolvePastExamProblemId(session.year,row.problemId)):row.selected);
  };
  // Time overruns are a measured deficit, not a reason to erase the score.
  const eligibleSessions=pastSessions.filter(session=>!session.superseded_by_session_id&&session.session_kind==="selected_three_timed"&&
    Number(session.actual_reference_level||0)===0&&session.evaluation_scope!=="conditional_full"&&
    selectedRows(session).length===3&&selectedRows(session).every(row=>row.actualScore!=null&&Number.isFinite(row.actualScore)&&!row.referenceUsed&&!row.hintUsed));
  const elapsed=(session:PastSession)=>Number(session.session_elapsed_minutes??
    (Number(session.actual_total_minutes||session.actual_minutes||0)+Number(session.scan_minutes||0)));
  const timedSessions=eligibleSessions.filter(session=>elapsed(session)>0);
  const timedSessionSuccesses=timedSessions.filter(session=>elapsed(session)<=Number(session.time_limit_minutes||90)&&
    (session.selected_timed_attempt_ids||[]).every(id=>attempts.find(a=>a.id===id)?.conclusion_reached!==false));
  const selectedScores=eligibleSessions.flatMap(s=>selectedRows(s).map(q=>Number(q.actualScore)));
  const lastDate=(rows:Array<{date:string}>)=>rows.map(r=>r.date).sort().at(-1)||null;
  const lastEvidenceDate=(sessions:PastSession[],role:"selected"|"all"="selected")=>lastDate(sessions.flatMap(s=>{
    const ids=role==="selected"?s.selected_timed_attempt_ids:s.linked_attempt_ids;
    const linked=attempts.filter(a=>(ids||[]).includes(a.id));
    return (linked.length?linked:[s]).map(row=>({date:row.date}));
  }));
  const selectedEvidence={...metric(selectedScores.reduce((a,b)=>a+b,0),selectedScores.length,eligibleSessions.length,
    "参照なしの選択3問のみ。非選択・補修を除外。時間超過も得点の母数に保持",["selected_three_timed"],lastEvidenceDate(eligibleSessions)),
    sessions:eligibleSessions.map(s=>({sessionId:s.id,year:s.year,score:selectedRows(s).reduce((sum,q)=>sum+Number(q.actualScore),0)/3,
      attemptIds:s.selected_timed_attempt_ids||[]}))};
  const diagnosticRows=pastSessions.flatMap(s=>(s.questions||[]).filter(q=>!selectedRows(s).includes(q)&&q.actualScore!=null));
  const individual=metric(pastExamAttempts.reduce((sum,a)=>sum+Number(a.score_numeric),0),pastExamAttempts.length,pastExamAttempts.length,
    "session未所属の参照なしfull/timed。選択3問KPIとは別集計",["full","timed"],lastDate(pastExamAttempts));
  const timed=metric(timedSessions.length?timedSessionSuccesses.length:timedSuccesses.length,
    timedSessions.length||timedAttempts.length,timedSessions.length||timedAttempts.length,
    "時間記録あり・参照なし。得点率とは独立。3問sessionがあればsession単位のみ",timedSessions.length?["selected_three_timed"]:["full","timed"],
    timedSessions.length?lastEvidenceDate(timedSessions):lastDate(timedAttempts),true);

  const kDenominator = [...kGroups.values()].length;
  const wDenominator = [...wGroups.values()].length;
  const evidence:LearningMetricEvidence={selectedThree:selectedEvidence,individual,timed,
      transfer:metric(transferred.size,transferOpportunities.size,transferRows.length,
        "別問題・明示skill一致・参照なし・関連finding成功・採点信頼度80%以上。母数は別問題候補がある失敗root",["different_problem"],
        transferRows.map(t=>t.date).sort().at(-1)||null,true),
      selection:metric(scanScores.reduce((a,b)=>a+b/100,0),scanScores.length,scanScores.length,
        "clean scanと選択3問・比較可能な採点が揃ったsessionのみ",["clean_scan5"],lastEvidenceDate(scanSessions.filter(s=>selectionSuccessRate(s)!=null),"all"),true),
      diagnostic:metric(diagnosticRows.reduce((sum,q)=>sum+Number(q.actualScore),0),diagnosticRows.length,diagnosticRows.length,
        "非選択問題の較正得点。本番3答案・時間に合算しない",["counterfactual_calibration"],lastDate(attempts.filter(a=>pastSessions.some(s=>s.counterfactual_calibration_attempt_ids?.includes(a.id))))) };
  const attemptIds=(rows:Attempt[])=>rows.map(a=>`attempt:${a.id}`),sessionIds=(rows:PastSession[])=>rows.map(s=>`session:${s.id}`);
  evidence.selectedThree.eligibleEvidenceIds=sessionIds(eligibleSessions);
  evidence.individual.eligibleEvidenceIds=attemptIds(pastExamAttempts);
  evidence.timed.eligibleEvidenceIds=timedSessions.length?sessionIds(timedSessions):attemptIds(timedAttempts);
  evidence.selection.eligibleEvidenceIds=sessionIds(scanSessions.filter(s=>selectionSuccessRate(s)!=null));
  evidence.diagnostic.eligibleEvidenceIds=[...new Set(pastSessions.flatMap(s=>(s.counterfactual_calibration_attempt_ids||[]).map(id=>`attempt:${id}`)))];
  evidence.transfer!.eligibleEvidenceIds=[...transferOpportunities].map(id=>`root:${id}`);
  evidence.unseen={...metric(transferAttempts.reduce((sum,a)=>sum+Number(a.score_numeric),0),transferAttempts.length,transferAttempts.length,
    "参照なし初回・30日以上未実施の個別full/timed。時間超過は得点から除外しない",["full","timed"],lastDate(transferAttempts)),
    eligibleEvidenceIds:attemptIds(transferAttempts)};
  const majorRows=attempts.filter(a=>!a.exclude_from_metrics&&!a.duplicate_of_attempt_id).flatMap(a=>
    deriveFailureEpisode(a).rootWeaknesses.filter(root=>root.materiality==="major").map(root=>({
      id:`attempt:${a.id}:${root.rootWeaknessId}`,key:root.skillIds.slice().sort().join("|")||root.rootWeaknessId,date:a.date})));
  const majorGroups=new Map<string,number>();for(const row of majorRows)majorGroups.set(row.key,(majorGroups.get(row.key)||0)+1);
  evidence.repeatedMajor={...metric([...majorGroups.values()].filter(n=>n>=2).length,majorGroups.size,majorRows.length,
    "有効なmajor failureの明示root。2回以上失敗したroot数 / 観測root数",["graded_finding"],lastDate(majorRows),true),
    eligibleEvidenceIds:majorRows.map(r=>r.id)};
  return {
    unseenScoreRate: scoreAverage(transferAttempts),
    timedCompletionRate:timed.value==null?null:Math.round(timed.value),
    selectionSuccessRate: scanScores.length ? Math.round(scanScores.reduce((sum, value) => sum + value, 0) / scanScores.length) : null,
    pastExamScoreRate:(selectedEvidence.value??individual.value)==null?null:Math.round((selectedEvidence.value??individual.value)!),
    evidence,
    kRecurrenceRate: kDenominator ? Math.round([...kGroups.values()].filter(count => count >= 2).length / kDenominator * 100) : null,
    repeatedWRate: wDenominator ? Math.round([...wGroups.values()].filter(count => count >= 2).length / wDenominator * 100) : null,
    typeIdentificationAccuracy:averageNullable(scanRows.map(row=>row.typeIdentificationAccuracy)),
    firstStepAccuracy:averageNullable(scanRows.map(row=>row.firstStepAccuracy)),
    predictedScoreCalibration:averageNullable(scanRows.map(row=>row.predictedScoreDifference)),
    predictedTimeCalibration:averageNullable(scanRows.map(row=>row.predictedTimeDifference)),
    sampleSizes: {
      unseen: transferAttempts.length,
      timed:timed.evidenceCount,
      scans: scanScores.length,
      selectionPending:scanSessions.filter(s=>s.session_kind!=="scan_only"&&selectionSuccessRate(s)==null).length,
      pastExams:eligibleSessions.length||pastExamAttempts.length,
      kReviews: kDenominator,
      wReviews: wDenominator,
    },
  };
}

export function sheetUsageForPhase(mode: string, phase: ExamPhase) {
  if (mode === "check") return "3〜5分。型・出発式・主役の量・注意1行だけ確認する。";
  if (mode === "main_calc") return "Wがある時だけ使用。開始式、対象計算、結論への接続だけを書く。";
  if (mode === "full") {
    if (phase === "foundation_to_A") return "週1問以上。途中式と条件を省略せず答案化する。";
    if (phase === "A_and_past_parallel") return "週2問程度。時間内に結論へ到達する練習へ移す。";
    if (phase === "past_exam_main") return "週2〜3問＋過去問。得点できる答案の完成を優先する。";
    return "本番形式中心。新規拡張より完走率と失点原因の限定を優先する。";
  }
  if (mode === "scan") {
    if (phase === "foundation_to_A") return "週1回。解かずに型・初手・選ぶ/捨てる理由を記録する。";
    if (phase === "A_and_past_parallel") return "週1〜2回。A問題と過去問の橋渡しとして使う。";
    return "週2回以上。5問から3問を選ぶ判断を本番用に固定する。";
  }
  if (mode === "skeleton") {
    if (phase === "foundation_to_A") return "全欄を使用。方針・出発式・条件・流れを固める。";
    if (phase === "A_and_past_parallel") return "方針・出発式・流れ・ゴール中心。書きすぎない。";
    if (phase === "past_exam_main") return "縮約骨格。解く/捨てる判断と初手確認を優先する。";
    return "白紙またはフル答案上部で自由に設計する。";
  }
  return "今回のモードに必要な最小限だけを書く。";
}
