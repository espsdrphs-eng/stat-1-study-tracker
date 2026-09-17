import type {AnswerIndexEntry,Attempt,GradedFinding,Problem} from "./types.ts";

export type GroundedSkillTag={skillId:string;evidence:string;confidence:"high"|"medium";source:string};
// Deliberately small, auditable vocabulary of explicitly named operations.
// No chapter/theme inference, embeddings, or extrapolation from missing answers.
const rules=[
  {id:"moment_generating_function",named:/積率母関数|モーメント母関数|\bMGF\b/i,
    ambiguous:/存在しない|一意性|Taylor|テイラー|連続性定理|標準化極限|畳み込み/i},
  {id:"law_total_variance",named:/全分散(?:公式)?/,ambiguous:/帰納|周辺化/},
];
function extract(text:string,source:string):GroundedSkillTag[]{
  return rules.filter(r=>r.named.test(text)).map(r=>({skillId:r.id,evidence:text,source,
    confidence:r.ambiguous.test(text)?"medium":"high"}));
}
export function groundedFindingSkills(attempt:Attempt,finding:GradedFinding):GroundedSkillTag[]{
  // Recognition of a problem type alone is not execution of an operation.
  if(["problem_type","focal_quantity"].includes(finding.graded_part_id))return [];
  return extract(finding.evidence||"",`attempt:${attempt.id}/finding:${finding.graded_part_id}`);
}
export function groundedWhitebookSkills(problem:Problem,answers:AnswerIndexEntry[]=[]):GroundedSkillTag[]{
  if(problem.source_type==="past_exam"||problem.category==="past_exam")return [];
  const answer=answers.find(a=>a.problem_id===problem.problem_id);
  if(!answer?.answer_excerpt||!answer.document_key||!answer.page_start)return [];
  return extract(answer.answer_excerpt,`${answer.document_key}:page:${answer.page_start}/${problem.problem_id}`);
}
export function deriveWhitebookSkillCoverage(problems:Problem[],answers:AnswerIndexEntry[]=[]){
  const rows=problems.filter(p=>p.source_type!=="past_exam"&&p.category!=="past_exam").map(p=>{
    const tags=groundedWhitebookSkills(p,answers);
    return {problemId:p.problem_id,tags,status:tags.some(t=>t.confidence==="high")?"high":tags.length?"medium":"unmapped"};
  });
  return {high:rows.filter(r=>r.status==="high").length,medium:rows.filter(r=>r.status==="medium").length,
    unmapped:rows.filter(r=>r.status==="unmapped").length,rows};
}
