import { examPhaseAllocations, examPhaseLabels, getExamPhase } from "./examReadiness.ts";

export type ProgressPhase = "foundation" | "integration" | "past_practice" | "final";
export type ProgressCheck = { label: string; detail: string; status: "ok" | "warning" | "pending" };
export type ProgressMetrics = {
  a14: number; sCore14: number; aPlus14: number; criticalSStable: number; criticalSTotal: number;
  past14: number; pastFull14: number; pastSkeleton14: number; scan14: number; exam14: number; kRepeat: number;
  skeletonCount: number; skeletonRate: number; studyDays14: number; actualMinutes14: number;
  delayed3: number; dailyTargetMinutes: number;
};

export const EXAM_PHASES = [
  {
    from: 91, to: 999, title: examPhaseLabels.foundation_to_A,
    allocation: examPhaseAllocations.foundation_to_A,
    summary: "Sは全面復習ではなく、K/Nや重要Sだけを補修しながらA問題へ入る時期です。",
  },
  {
    from: 61, to: 90, title: examPhaseLabels.A_and_past_parallel,
    allocation: examPhaseAllocations.A_and_past_parallel,
    summary: "A問題で型を増やしつつ、過去問単問と5問スキャンで選題力を測り始めます。",
  },
  {
    from: 31, to: 60, title: examPhaseLabels.past_exam_main,
    allocation: examPhaseAllocations.past_exam_main,
    summary: "過去問を主軸にし、落とした型だけA/Sへ戻して補修します。",
  },
  {
    from: 0, to: 30, title: examPhaseLabels.final_stabilization,
    allocation: examPhaseAllocations.final_stabilization,
    summary: "新規拡張を抑え、本番形式・時間内完走・弱点限定補修へ寄せます。",
  },
] as const;

export function daysUntilExam(today: string, examDate: string, fallback = 136) {
  if (!examDate) return fallback;
  const start = new Date(`${today}T12:00:00`).getTime();
  const end = new Date(`${examDate}T12:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return fallback;
  return Math.max(0, Math.ceil((end - start) / 86400000));
}

export function phaseForDays(days: number): ProgressPhase {
  const phase = getExamPhase(days);
  if (phase === "foundation_to_A") return "foundation";
  if (phase === "A_and_past_parallel") return "integration";
  if (phase === "past_exam_main") return "past_practice";
  return "final";
}

function statusByCount(value: number, target: number): "ok" | "warning" | "pending" {
  if (value === 0) return "pending";
  return value >= target ? "ok" : "warning";
}

export function buildProgressPlan(days: number, metrics: ProgressMetrics) {
  const phase = phaseForDays(days);
  const phaseKey = getExamPhase(days);
  const phaseDefinition = EXAM_PHASES.find(item => days >= item.from && days <= item.to) ?? EXAM_PHASES.at(-1)!;
  const expectedMinutes = metrics.dailyTargetMinutes * 14;
  const timeStatus = metrics.actualMinutes14 === 0
    ? "pending"
    : metrics.actualMinutes14 >= expectedMinutes * 0.75 && metrics.studyDays14 >= 8 ? "ok" : "warning";
  const common: ProgressCheck[] = [
    {
      label: "復習遅延",
      detail: metrics.delayed3 === 0 ? "3日超の遅延なし" : `${metrics.delayed3}件が3日超過`,
      status: metrics.delayed3 === 0 ? "ok" : "warning",
    },
    {
      label: "K再発",
      detail: `同一問題のK再発 ${metrics.kRepeat}件`,
      status: metrics.kRepeat <= 2 ? "ok" : "warning",
    },
    {
      label: "学習実績",
      detail: metrics.actualMinutes14
        ? `2週間で${metrics.actualMinutes14}分・${metrics.studyDays14}日`
        : "実績時間の記録待ち",
      status: timeStatus,
    },
  ];

  const phaseChecks: ProgressCheck[] = phase === "foundation" ? [
    { label: "A問題着手", detail: `2週間でA+/A ${metrics.aPlus14 || metrics.a14}題`, status: statusByCount(metrics.aPlus14 || metrics.a14, 5) },
    { label: "S限定補修", detail: `重要S/SS確認 ${metrics.sCore14}題`, status: statusByCount(metrics.sCore14, 3) },
    { label: "型識別", detail: `5問スキャン ${metrics.scan14}回`, status: metrics.scan14 >= 1 ? "ok" : "pending" },
    { label: "過去問観察", detail: `過去問単問 ${metrics.past14}問`, status: metrics.past14 >= 1 ? "ok" : "pending" },
  ] : phase === "integration" ? [
    { label: "A問題", detail: `2週間でA+/A ${metrics.aPlus14 || metrics.a14}題`, status: statusByCount(metrics.aPlus14 || metrics.a14, 6) },
    { label: "過去問並行", detail: `過去問単問 ${metrics.past14}問`, status: statusByCount(metrics.past14, 2) },
    { label: "選題練習", detail: `5問スキャン ${metrics.scan14}回`, status: statusByCount(metrics.scan14, 1) },
  ] : phase === "past_practice" ? [
    { label: "過去問主軸", detail: `過去問 ${metrics.past14}問`, status: statusByCount(metrics.past14, 5) },
    { label: "答案化", detail: `フル/90分 ${metrics.pastFull14}問`, status: statusByCount(metrics.pastFull14, 3) },
    { label: "選題練習", detail: `5問スキャン ${metrics.scan14}回`, status: statusByCount(metrics.scan14, 2) },
  ] : [
    { label: "本番形式", detail: `90分演習 ${metrics.exam14}回`, status: statusByCount(metrics.exam14, 1) },
    { label: "過去問答案", detail: `フル/90分 ${metrics.pastFull14}問`, status: statusByCount(metrics.pastFull14, 3) },
    { label: "弱点限定補修", detail: `A/S補修 ${metrics.aPlus14 + metrics.sCore14}題`, status: statusByCount(metrics.aPlus14 + metrics.sCore14, 3) },
  ];

  const checks = [...phaseChecks, ...common];
  const judged = checks.filter(item => item.status !== "pending");
  const warnings = checks.filter(item => item.status === "warning").length;
  const insufficientEvidence = metrics.studyDays14 < 3 || metrics.actualMinutes14 < metrics.dailyTargetMinutes * 2;
  const label = insufficientEvidence || judged.length < 3 ? "判定保留" : warnings >= 3 ? "危険" : warnings >= 1 ? "注意" : "合格ペース";
  const suggestion = label === "危険"
    ? "新規問題を減らし、K/Nの補修と時間内答案化を優先してください。"
    : label === "注意"
      ? "今日の主課題を1問に絞り、補修は原因部分だけにしてください。"
      : "";
  const nextPhase = phase === "foundation" ? "残り90日からA問題＋過去問並行へ"
    : phase === "integration" ? "残り60日から過去問主軸へ"
      : phase === "past_practice" ? "残り30日から本番演習＋弱点限定補修へ"
        : "試験直前は新規拡張を止め、完走率を優先";
  return {
    phase, phaseKey, phaseLabel: phaseDefinition.title, summary: phaseDefinition.summary,
    allocation: phaseDefinition.allocation, nextPhase, checks, label, suggestion,
    dangerCriteria: [
      "K再発が2件を超える",
      "時間内答案化の記録が不足している",
      "過去問期に5問スキャンが未実施",
      "3日超の復習遅延が残る",
    ],
    daysRemaining: days,
  };
}
