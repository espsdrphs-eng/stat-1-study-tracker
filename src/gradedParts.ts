import type {
  Attempt,
  GradedFinding,
  GradedPartContract,
  GradingErrorType,
  LearningPurpose,
} from "./types.ts";

const normalize = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/[\s。、，．・/\\()[\]「」『』"'`]/g, "");

function unique<T>(rows: T[], key: (row: T) => string) {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

function hash(value: string) {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

type Definition = {
  id: string;
  label: string;
  cueLabel: string;
  criterion: string;
  errors: GradingErrorType[];
  patterns: RegExp[];
};

const definitions: Definition[] = [
  {
    id: "standardization_target",
    label: "標準化する対象と分散の整合",
    cueLabel: "標準化対象",
    criterion: "reproduce_standardization_consistently",
    errors: ["W", "C", "none"],
    patterns: [/標準化/, /V\/?√?\(?1.*rho/i],
  },
  {
    id: "density_transform_direction",
    label: "変数変換後の密度公式の向き",
    cueLabel: "密度公式の向き",
    criterion: "reproduce_density_direction",
    errors: ["W", "C", "none"],
    patterns: [/密度.*向き/, /変数変換.*公式.*向き/, /f.?xy.*f.?uv.*向き/i],
  },
  {
    id: "split_integral_reason",
    label: "積分を0で分ける理由",
    cueLabel: "区間分割の理由",
    criterion: "explain_split_reason",
    errors: ["N", "none"],
    patterns: [/0.*分ける理由/, /積分.*分割.*理由/, /場合分け.*理由/],
  },
  {
    id: "probability_integral_transform_explanation",
    label: "分布関数による一様分布への変換理由",
    cueLabel: "分布関数変換",
    criterion: "explain_pit",
    errors: ["N", "none"],
    patterns: [/分布関数.*一様/, /確率積分変換/, /0から1.*変換/],
  },
  {
    id: "h_orientation",
    label: "Hの配置",
    cueLabel: "Hの向き",
    criterion: "reproduce_h_orientation",
    errors: ["W", "C", "none"],
    patterns: [/H.*配置/i, /H.*転置/i, /転置.*H/i],
  },
  {
    id: "w_w1_distinction",
    label: "WとW1の区別",
    cueLabel: "WとW1",
    criterion: "distinguish_w_w1",
    errors: ["W", "C", "none"],
    patterns: [/W.*W1/i, /W1.*W/i],
  },
  {
    id: "norm_preservation",
    label: "長さ保存",
    cueLabel: "長さ保存",
    criterion: "reproduce_norm_preservation",
    errors: ["W", "C", "none"],
    patterns: [/長さ.*保存/, /W.*転置.*W.*Z.*転置.*Z/i],
  },
  {
    id: "q_expansion",
    label: "Qの展開",
    cueLabel: "Qの展開",
    criterion: "reproduce_q_expansion",
    errors: ["W", "C", "none"],
    patterns: [/Q.*展開/i, /展開.*Q/i],
  },
  {
    id: "problem_type",
    label: "問題の型",
    cueLabel: "型",
    criterion: "recall_problem_type",
    errors: ["K", "N", "C", "none"],
    patterns: [/^問題の型$/, /^型$/],
  },
  {
    id: "first_step",
    label: "最初の一手",
    cueLabel: "初手",
    criterion: "recall_first_step",
    errors: ["K", "N", "C", "none"],
    patterns: [/最初の一手/, /初手/],
  },
  {
    id: "focal_quantity",
    label: "主役となる量",
    cueLabel: "主役の量",
    criterion: "recall_focal_quantity",
    errors: ["K", "N", "C", "none"],
    patterns: [/主役.*量/, /見る量/],
  },
  {
    id: "critical_condition",
    label: "重要条件または注意点",
    cueLabel: "重要条件",
    criterion: "recall_critical_condition",
    errors: ["N", "C", "none"],
    patterns: [/重要条件/, /注意点/],
  },
  {
    id: "full_answer",
    label: "今回提出した答案全体",
    cueLabel: "答案全体",
    criterion: "complete_full_answer",
    errors: ["K", "W", "N", "C", "none"],
    patterns: [/答案全体/],
  },
];

function inferredErrors(text: string, sourceAttempt?: Attempt): GradingErrorType[] {
  if (/理由|説明|根拠/.test(text)) return ["N", "none"];
  const source = (sourceAttempt?.effective_error_types || sourceAttempt?.error_types || [])
    .filter((value) => ["K", "W", "N", "C"].includes(value)) as GradingErrorType[];
  return source.length ? unique([...source, "none"], (value) => value) : ["W", "N", "C", "none"];
}

export function gradedPartContracts(args: {
  texts: string[];
  problemId: string;
  sourceAttempt?: Attempt;
  purpose: LearningPurpose;
}): GradedPartContract[] {
  if (args.purpose === "retrieval_check") {
    return definitions
      .filter((row) => ["problem_type", "first_step", "focal_quantity", "critical_condition"].includes(row.id))
      .map((row) => ({
        id: row.id,
        label: row.label,
        cueLabel: row.cueLabel,
        allowedErrorTypes: row.errors,
        completionCriterionId: row.criterion,
      }));
  }
  if (args.purpose === "exam_performance") {
    const row = definitions.find((item) => item.id === "full_answer")!;
    return [{
      id: row.id,
      label: row.label,
      cueLabel: row.cueLabel,
      allowedErrorTypes: row.errors,
      completionCriterionId: row.criterion,
    }];
  }
  const rows = args.texts.flatMap((text) => {
    const known = definitions.filter((definition) => definition.patterns.some((pattern) => pattern.test(text)));
    if (known.length) {
      return known.map((row) => ({
        id: row.id,
        label: row.label,
        cueLabel: row.cueLabel,
        allowedErrorTypes: row.errors,
        completionCriterionId: row.criterion,
      }));
    }
    const normalized = normalize(text);
    if (!normalized) return [];
    const suffix = hash(`${args.problemId}:${normalized}`);
    return [{
      id: `target_${suffix}`,
      label: text,
      cueLabel: "指定箇所",
      allowedErrorTypes: inferredErrors(text, args.sourceAttempt),
      completionCriterionId: `reproduce_${suffix}`,
    }];
  });
  return unique(rows, (row) => row.id);
}

export function gradedPartIds(parts: GradedPartContract[] | string[] | undefined) {
  return (parts || []).map((part) => typeof part === "string" ? part : part.id).filter(Boolean).sort();
}

export function gradedPartLabels(parts: GradedPartContract[] | string[] | undefined) {
  return (parts || []).map((part) => typeof part === "string" ? part : part.label).filter(Boolean);
}

export function sameGradedPartIds(
  left: GradedPartContract[] | string[] | undefined,
  right: string[] | undefined,
) {
  return JSON.stringify(gradedPartIds(left)) === JSON.stringify([...(right || [])].sort());
}

export function validateGradedFindings(parts: GradedPartContract[], findings: GradedFinding[]) {
  const map = new Map(parts.map((part) => [part.id, part]));
  return findings.flatMap((finding) => {
    const part = map.get(finding.graded_part_id);
    if (!part) {
      return [{
        gradedPartId: finding.graded_part_id,
        errorType: finding.error_type,
        reason: "契約に存在しない採点項目IDです",
      }];
    }
    if (!part.allowedErrorTypes.includes(finding.error_type)) {
      return [{
        gradedPartId: finding.graded_part_id,
        errorType: finding.error_type,
        reason: `許可分類は ${part.allowedErrorTypes.join(" / ")} です`,
      }];
    }
    return [];
  });
}

export function primaryErrorFromFindings(findings: GradedFinding[]): GradingErrorType {
  const priority: GradingErrorType[] = ["K", "N", "W", "C", "none"];
  return priority.find((error) =>
    findings.some((finding) => !finding.resolved && finding.error_type === error),
  ) || "none";
}
