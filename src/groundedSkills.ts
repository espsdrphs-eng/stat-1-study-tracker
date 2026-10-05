import type {AnswerIndexEntry,Attempt,GradedFinding,Problem} from "./types.ts";

export type GroundedSkillTag={skillId:string;evidence:string;confidence:"high"|"medium";source:string};
// Deliberately small, auditable vocabulary of explicitly named operations.
// No chapter/theme inference, embeddings, or extrapolation from missing answers.
const rules=[
  {id:"coefficient_tracking_scale_reciprocal",named:/(?=.*(?:1\/Xbar|逆数))(?=.*(?:係数|定数倍))/,ambiguous:/係数が不明|操作が不明/},
  // The assessed finding names a conditional law and its conditioned variables;
  // candidate matching below checks the actual inverse-density operation.
  {id:"conditional_distribution",named:/(?=.*(?:条件付き密度|条件付き分布|X\|Z.{0,8}分布))(?=.*(?:Bayes|ベイズ|X\|Z|f\([^)]*\|[^)]*\)))/i,
    ambiguous:/条件付き期待値だけ|周辺密度の積だけ/},
  {id:"risk_function",named:/(?=.*(?:R\((?:alpha|α)\)|リスク))(?=.*(?:係数.?2|1\/Xbar|逆数))/i,
    ambiguous:/リスクが未定義|係数が不明/},
  {id:"moment_generating_function",named:/積率母関数|モーメント母関数|\bMGF\b/i,
    ambiguous:/存在しない|一意性|Taylor|テイラー|連続性定理|標準化極限|畳み込み/i},
  {id:"law_total_variance",named:/全分散(?:公式)?/,ambiguous:/帰納|周辺化/},
  // Both expressions name the operation, rather than merely the chapter or
  // problem topic. Keep the two required ideas together for covariance prose.
  {id:"finite_population_correction",named:/有限母集団修正|(?=.*非復元抽出)(?=.*(?:負の共分散|共分散))/,
    ambiguous:/適用できるか不明|どの補正を使うか不明/},
];
function extract(text:string,source:string):GroundedSkillTag[]{
  const matched=rules.filter(r=>r.named.test(text));
  return matched.filter(r=>r.id!=="risk_function"||!matched.some(row=>row.id==="coefficient_tracking_scale_reciprocal"))
    .map(r=>({skillId:r.id,evidence:text,source,
    confidence:r.ambiguous.test(text)?"medium":"high"}));
}
export function groundedFindingSkills(attempt:Attempt,finding:GradedFinding):GroundedSkillTag[]{
  // Recognition of a problem type alone is not execution of an operation.
  if(["problem_type","focal_quantity"].includes(finding.graded_part_id))return [];
  const own=extract(finding.evidence||"",`attempt:${attempt.id}/finding:${finding.graded_part_id}`);
  if(own.length)return own;
  // Only inherit an operation when both findings explicitly name the same lost
  // coefficient. Distribution/theme similarity is not causal evidence.
  const coefficient=(finding.evidence||"").match(/係数\s*([0-9]+)/)?.[1];
  if(!coefficient||!/(?:欠落|落と|失|誤)/.test(finding.evidence||""))return [];
  const supports=(attempt.graded_findings||[]).filter(row=>row!==finding&&
    (row.evidence||"").match(/係数\s*([0-9]+)/)?.[1]===coefficient)
    .flatMap(row=>extract(row.evidence||"",`attempt:${attempt.id}/finding:${row.graded_part_id}`))
    .filter(tag=>tag.skillId==="coefficient_tracking_scale_reciprocal"&&tag.confidence==="high");
  return supports.length?[{...supports[0],evidence:`${finding.evidence}\n${supports[0].evidence}`,
    source:`attempt:${attempt.id}/finding:${finding.graded_part_id};${supports[0].source}`}]:[];
}
export function groundedWhitebookSkills(problem:Problem,answers:AnswerIndexEntry[]=[]):GroundedSkillTag[]{
  if(problem.source_type==="generated"||problem.source_type==="past_exam"||problem.category==="past_exam")return [];
  const answer=answers.find(a=>a.problem_id===problem.problem_id);
  if(!answer?.answer_excerpt||!answer.document_key||!answer.page_start)return [];
  return extract(answer.answer_excerpt,`${answer.document_key}:page:${answer.page_start}/${problem.problem_id}`);
}

/** A shared skill name is insufficient when the failed operation requires a
 * general identity but the destination only calculates a named distribution. */
export function matchesFailureOperation(failure:string,skill:string,problem:Problem,answers:AnswerIndexEntry[]=[]){
  const answer=answers.find(row=>row.problem_id===problem.problem_id)?.answer_excerpt||"";
  if(skill==="coefficient_tracking_scale_reciprocal")
    return extract(answer,"candidate solution").some(tag=>tag.skillId===skill&&tag.confidence==="high");
  if(skill==="conditional_distribution"&&/(?:Bayes|ベイズ|逆条件付け|X\|Z)/i.test(failure))
    return /(?:Bayes|ベイズ|条件付き密度.{0,40}周辺密度|周辺密度.{0,40}条件付き密度)/i.test(answer);
  if(skill==="risk_function"&&/(?:係数.?2|1\/Xbar)/.test(failure))
    return /(?:逆数.{0,40}係数|係数.{0,40}逆数|1\/[^\s]{1,30}.{0,40}係数)/.test(answer);
  if(skill!=="moment_generating_function"||
    !/(?:一般.{0,16}(?:分布|確率変数|連続)|積分と微分の交換|一般証明|g\(x\).{0,40}期待値定義|指数分布の具体的MGF)/.test(failure))return true;
  return /(?:一般.{0,16}(?:分布|確率変数|連続)|積分と微分の交換|一般証明)/.test(answer);
}
export function deriveWhitebookSkillCoverage(problems:Problem[],answers:AnswerIndexEntry[]=[]){
  const rows=problems.filter(p=>p.source_type!=="generated"&&p.source_type!=="past_exam"&&p.category!=="past_exam").map(p=>{
    const tags=groundedWhitebookSkills(p,answers);
    return {problemId:p.problem_id,tags,status:tags.some(t=>t.confidence==="high")?"high":tags.length?"medium":"unmapped"};
  });
  return {high:rows.filter(r=>r.status==="high").length,medium:rows.filter(r=>r.status==="medium").length,
    unmapped:rows.filter(r=>r.status==="unmapped").length,rows};
}
