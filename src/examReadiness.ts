import type { Attempt, PastSession, Problem, ProblemAlias } from "./types.ts";
import { examScoreEligibility } from "./scoreEligibility.ts";
import { excludeLegacyKFromPlanning } from "./legacyKPolicy.ts";
import { scanMetrics, selectionSuccessRate, validatePastExamSession } from "./pastExamWorkflow.ts";

export type ExamPhase =
  | "foundation_to_A"
  | "A_and_past_parallel"
  | "past_exam_main"
  | "final_stabilization";

export type ExamReadinessMetrics = {
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
    pastExams: number;
    kReviews: number;
    wReviews: number;
  };
};

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
  if (daysRemaining >= 91) return "foundation_to_A";
  if (daysRemaining >= 61) return "A_and_past_parallel";
  if (daysRemaining >= 31) return "past_exam_main";
  return "final_stabilization";
}

export const examPhaseLabels: Record<ExamPhase, string> = {
  foundation_to_A: "S限定補修＋A問題着手",
  A_and_past_parallel: "A問題＋過去問並行",
  past_exam_main: "過去問主軸＋A問題補修",
  final_stabilization: "本番演習＋弱点限定補修",
};

export const examPhaseAllocations: Record<ExamPhase, string> = {
  foundation_to_A: "A問題45%・S限定補修25%・型識別/5問スキャン15%・過去問観察15%",
  A_and_past_parallel: "A問題40%・過去問30%・S限定補修15%・型識別/選題15%",
  past_exam_main: "過去問55%・A問題補修25%・S限定補修10%・型識別10%",
  final_stabilization: "過去問/本番形式60%・A問題補修25%・S限定補修10%・型識別5%",
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
    const eligibility=attempt.exam_score_eligible===true||examScoreEligibility(attempt,problem).eligible;
    const eligibilityResult=examScoreEligibility(attempt,problem);
    const standaloneExamAttempt=!attempt.parent_past_session_id;
    if (standaloneExamAttempt&&(!previous || daysSince >= 30) && eligibility && noReference(attempt) && validScore(attempt)&&
      Number(attempt.time_minutes||0)<=Number(attempt.time_limit_minutes||eligibilityResult.timeLimitMinutes||0)) transferAttempts.push(attempt);
    const mode = attempt.mode || "";
    const timeLimit = mode === "exam_90min" ? 90 : mode === "full" ? 35 : problem?.category === "past_exam" ? 30 : 0;
    if (standaloneExamAttempt&&eligibility&&(mode === "full" || mode === "exam_90min" || problem?.category === "past_exam") && timeLimit) timedAttempts.push(attempt);
    if (standaloneExamAttempt&&eligibility&&problem?.category === "past_exam" && validScore(attempt)&&
      Number(attempt.time_minutes||0)<=Number(attempt.time_limit_minutes||eligibilityResult.timeLimitMinutes||0)) pastExamAttempts.push(attempt);
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
      Number(attempt.score_numeric || 0) >= 60 &&
      !["×", "ﾃ・"].includes(attempt.mark || "");
  });

  const scanSessions = pastSessions.filter(session => ["scan_5_questions", "scan5"].includes(session.session_type)||!!session.session_kind);
  const scanScores=scanSessions.map(selectionSuccessRate).filter((value):value is number=>value!=null);
  const scanRows=scanSessions.map(scanMetrics);
  const averageNullable=(values:Array<number|null>)=>{const rows=values.filter((value):value is number=>value!=null);return rows.length?Math.round(rows.reduce((a,b)=>a+b,0)/rows.length):null};

  const sessionEligible=(session:PastSession)=>session.session_kind==="selected_three_timed"
    ?session.exam_score_eligible===true&&validatePastExamSession(session).examScoreEligible
    :session.exam_score_eligible===true&&Number(session.actual_reference_level||0)===0&&session.evaluation_scope!=="conditional_full";
  const timedSessions=pastSessions.filter(session=>sessionEligible(session)&&Number(session.actual_total_minutes||session.actual_minutes||session.selection_time_minutes||0)>0);
  const sessionScore=(session:PastSession)=>{
    if(session.session_kind!=="selected_three_timed")return Number(session.score_numeric||0);
    const scored=(session.questions||[]).filter(row=>row.completed&&row.actualScore!=null);
    return scored.length?scored.reduce((sum,row)=>sum+Number(row.actualScore),0)/scored.length:0;
  };
  const timedSessionSuccesses=timedSessions.filter(session=>Number(session.actual_total_minutes||session.actual_minutes||session.selection_time_minutes||0)<=Number(session.time_limit_minutes||90)&&sessionScore(session)>=60);
  const pastSessionScores=pastSessions.filter(session=>sessionEligible(session)).map(sessionScore);

  const kDenominator = [...kGroups.values()].length;
  const wDenominator = [...wGroups.values()].length;

  return {
    unseenScoreRate: scoreAverage(transferAttempts),
    timedCompletionRate: timedAttempts.length+timedSessions.length ? Math.round((timedSuccesses.length+timedSessionSuccesses.length) / (timedAttempts.length+timedSessions.length) * 100) : null,
    selectionSuccessRate: scanScores.length ? Math.round(scanScores.reduce((sum, value) => sum + value, 0) / scanScores.length * 100) : null,
    pastExamScoreRate: pastExamAttempts.length||pastSessionScores.length?Math.round(([...pastExamAttempts.map(attempt=>Number(attempt.score_numeric||0)),...pastSessionScores].reduce((sum,value)=>sum+value,0))/(pastExamAttempts.length+pastSessionScores.length)):null,
    kRecurrenceRate: kDenominator ? Math.round([...kGroups.values()].filter(count => count >= 2).length / kDenominator * 100) : null,
    repeatedWRate: wDenominator ? Math.round([...wGroups.values()].filter(count => count >= 2).length / wDenominator * 100) : null,
    typeIdentificationAccuracy:averageNullable(scanRows.map(row=>row.typeIdentificationAccuracy)),
    firstStepAccuracy:averageNullable(scanRows.map(row=>row.firstStepAccuracy)),
    predictedScoreCalibration:averageNullable(scanRows.map(row=>row.predictedScoreDifference)),
    predictedTimeCalibration:averageNullable(scanRows.map(row=>row.predictedTimeDifference)),
    sampleSizes: {
      unseen: transferAttempts.length,
      timed: timedAttempts.length+timedSessions.length,
      scans: scanScores.length,
      pastExams: pastExamAttempts.length+pastSessionScores.length,
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
