import type { ProblemRelation } from "./types.ts";

const generic=/^(problem_masterの既存関連指定|problem_masterから読み取り|元問題で崩れた基礎型を確認する|要確認)?$/;

export function eligibleAutomaticRemediation(relation:ProblemRelation){
  return relation.status==="confirmed"&&relation.sourceProblemId!==relation.targetProblemId&&
    String(relation.sourceIssue||"").trim().length>0&&String(relation.targetFocus||"").trim().length>0&&
    !generic.test(String(relation.sourceIssue||"").trim())&&!generic.test(String(relation.targetFocus||"").trim())&&
    String(relation.reason||"").trim().length>0&&!generic.test(String(relation.reason||"").trim());
}

/** 1 Attemptから実行計画へ自動提案できる補修は最大1件。 */
export function selectAutomaticRemediation(relations:ProblemRelation[]){
  return relations.filter(eligibleAutomaticRemediation).slice(0,1);
}
