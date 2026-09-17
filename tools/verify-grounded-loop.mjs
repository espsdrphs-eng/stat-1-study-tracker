// Actual export is read-only. Future repair/transfer outcomes below are explicitly
// simulated in memory, never written to the user's DB or presented as achievements.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {deriveWhitebookSkillCoverage} from '../src/groundedSkills.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {deriveTransferEvidence} from '../src/skillEvidence.ts';
import {analyzeConceptWeaknesses,buildPastExamRepairCandidates} from '../src/conceptWeakness.ts';
import {buildAdaptivePlannerShadow} from '../src/adaptivePlanner.ts';
import {buildPastExamCatalog} from '../src/examReferencePack.ts';
import {canonicalizePastExamSessions,reconcilePastExamSessionEvidence} from '../src/pastExamPlanning.ts';
import {analyzeReviewReconciliation} from '../src/reviewReconciliation.ts';
const raw=JSON.parse(await readFile(process.argv[2],'utf8'));
const record=JSON.parse(raw.meta.find(m=>m.key==='exam-reference-pack:active').value);
const today=[raw.exported_at.slice(0,10),...raw.attempts.map(a=>a.date)].sort().at(-1),problems=raw.problems;
const sessions=canonicalizePastExamSessions(raw.pastSessions).current.map(s=>reconcilePastExamSessionEvidence(s,raw.attempts));
const overrides=JSON.parse(raw.meta.find(m=>m.key==='exam-reference-pack:exposure-overrides')?.value||'{}');
const coverage=deriveWhitebookSkillCoverage(problems,raw.answerIndex);
const derive=(attempts,answers=raw.answerIndex)=>{
  const planDate=[today,...attempts.map(a=>a.date)].sort().at(-1);
  const weaknesses=analyzeConceptWeaknesses({record,problems,attempts,reviews:raw.reviews,weakNotes:raw.weakNotes,today:planDate});
  const repairs=buildPastExamRepairCandidates({record,problems,attempts,sessions,conceptWeaknesses:weaknesses,answers,exposureOverrides:overrides});
  const planner=buildAdaptivePlannerShadow({record,problems,attempts,reviews:raw.reviews,pastSessions:sessions,weaknesses,
    catalog:buildPastExamCatalog({record,sessions,attempts,exposureOverrides:overrides}),currentTasks:[],repairCandidates:repairs,
    today:planDate,examDate:'2026-11-15',targetMinutes:150});
  return {repairs,planner,tasks:planner.plan14.plan.flatMap(d=>d.tasks)};
};
const initial=derive(raw.attempts);
assert.ok(initial.repairs.some(r=>r.required),'Case 1: actual major repair exists');
assert.ok(initial.tasks.some(t=>t.repairLineage&&t.todayCategory==='repair'),'Case 1: executable repair');
// Discover a real selected failure with a named operation and a legitimate unseen
// destination, not a fixture-specific problem id or synthetic root skill.
const choices=raw.attempts.flatMap(a=>deriveFailureEpisode(a).rootWeaknesses
  .filter(r=>r.requiredRepair&&r.skillIds.length&&sessions.some(s=>(s.selected_timed_attempt_ids||[]).includes(a.id)))
  .map(root=>({source:a,root}))).sort((a,b)=>b.source.id-a.source.id);
let scenario;
for(const choice of choices){
  const {source,root}=choice;
  // Follow the existing priority first: finish the currently selected, more
  // recent required repair before expecting the next root to enter the plan.
  const preceding=[...new Set(initial.repairs.filter(r=>r.required&&r.sourceAttemptId>source.id).map(r=>r.sourceAttemptId))]
    .map(id=>raw.attempts.find(a=>a.id===id));
  let nextId=Math.max(...raw.attempts.map(a=>a.id))+1;
  const prelude=preceding.map(a=>({...a,id:nextId++,date:'2026-09-18',mode:'full',time_minutes:30,
    is_review_attempt:true,parent_past_session_id:undefined,session_role:undefined,exam_score_eligible:false,
    actual_reference_level:0,reference_level:0,hint_used:false,grading_confidence:.95,
    assessment_timing:'delayed_retrieval',learning_purpose:'error_repair',mark:'○',score_numeric:90,
    error_type:'none',error_types:['none'],review_outcome:'success',minimum_pass_condition_met:true,
    target_issue_resolved:true,conclusion_reached:true,
    graded_findings:(a.graded_findings||[]).map(f=>({...f,error_type:'none',resolved:true,evidence:'割り当てられた補修の再現成功（sandbox仮想結果）。'}))}));
  const beforeRepair=[...raw.attempts,...prelude],before=derive(beforeRepair,[]);
  if(!before.tasks.some(t=>t.problemId===source.problem_id&&t.todayCategory==='repair'))continue;
  const id=nextId;
  const repair={...source,id,date:'2026-09-18',mode:'main_calc',time_minutes:8,is_review_attempt:true,
    parent_past_session_id:undefined,session_role:undefined,exam_score_eligible:false,
    source_problem_id:source.problem_id,learning_purpose:'error_repair',assessment_timing:'delayed_retrieval',
    actual_reference_level:0,reference_level:0,hint_used:false,grading_confidence:.95,
    mark:'○',score_numeric:90,error_type:'none',error_types:['none'],review_outcome:'success',
    minimum_pass_condition_met:true,target_issue_resolved:true,conclusion_reached:true,
    graded_findings:source.graded_findings.filter(f=>root.sourceFindingIds.includes(f.graded_part_id))
      .map(f=>({...f,error_type:'none',resolved:true,evidence:'指定された数学的操作を参照なしで正しく再現した（sandbox仮想結果）。'}))};
  // Skills are copied from the discovered assessed root into the sandbox grading
  // contract, as an explicit target for a FUTURE test, not invented achievement.
  repair.grading_contract={...source.grading_contract,gradedParts:source.grading_contract.gradedParts
    .filter(p=>root.sourceFindingIds.includes(p.id)).map(p=>({...p,fineConceptIds:root.skillIds}))};
  const after=derive([...beforeRepair,repair],[]);
  const candidate=after.repairs.find(r=>r.rootWeaknessId===root.rootWeaknessId&&r.repairKind==='transfer');
  const task=after.tasks.find(t=>t.purpose==='transfer_check'&&t.repairLineage?.rootWeaknessId===root.rootWeaknessId);
  if(candidate&&task){scenario={source,root,repair,candidate,task,after,beforeRepair,prelude};break;}
}
assert.ok(scenario,'Case 2: real repaired root must materialize a different-problem transfer in full-data Planner');
const {source,root,repair,candidate,task,beforeRepair,prelude}=scenario;
assert.notEqual(task.problemId,source.problem_id);
assert.equal(deriveTransferEvidence([...beforeRepair,repair]).some(t=>t.successAttemptId===repair.id),false,'same problem is not transfer');
const transfer={...repair,id:repair.id+1,date:'2026-09-21',problem_id:task.problemId,mode:'full',time_minutes:30,
  learning_purpose:'transfer_check',source_problem_id:source.problem_id,
  grading_contract:{...repair.grading_contract,problemId:task.problemId,
    gradedParts:repair.grading_contract.gradedParts.filter(p=>root.sourceFindingIds.includes(p.id))},
  graded_findings:repair.graded_findings.filter(f=>root.sourceFindingIds.includes(f.graded_part_id))};
const finalAttempts=[...beforeRepair,repair,transfer];
const evidence=deriveTransferEvidence(finalAttempts).filter(t=>t.sourceProblemId===source.problem_id&&t.successAttemptId===transfer.id);
assert.ok(root.skillIds.every(id=>evidence.some(t=>t.skillId===id)),'Case 3: root-scoped transfer evidence');
const final=derive(finalAttempts,[]);
assert.equal(final.repairs.some(r=>r.rootWeaknessId===root.rootWeaknessId&&r.required),false);
const reconciliation=analyzeReviewReconciliation({attempts:finalAttempts,reviews:raw.reviews,aliases:raw.problemAliases,today:'2026-09-21'});
const current=reconciliation.problems.find(p=>p.problemId===source.problem_id);
assert.ok(!current?.desiredRepairParts.some(p=>root.sourceFindingIds.includes(p.id)),'Case 3: transferred root no longer requires same-problem repair');
const fallback=derive(raw.attempts,[]);
assert.equal(fallback.repairs.some(r=>r.required&&r.repairKind==='whitebook'),false,'Case 4: no unjustified WB');
assert.ok(fallback.tasks.some(t=>t.todayCategory==='repair'&&t.repairLineage),'Case 4: mini repair remains executable');
assert.ok(final.tasks.some(t=>t.minutes===90&&t.sessionProblemIds?.length===5),'Case 5: next PastExam not starved');
const second=derive(finalAttempts,[]);
assert.deepEqual(second.tasks,final.tasks,'sandbox Planner idempotency');
const report={cases:{case1:'PASS',case2:'PASS',case3:'PASS',case4:'PASS',case5:'PASS'},
  futureOutcomesSimulated:true,precedingRequiredRepairs:prelude.map(a=>a.problem_id),coverage,
  sourceAttemptId:source.id,sourceProblemId:source.problem_id,rootWeaknessId:root.rootWeaknessId,
  skillIds:root.skillIds,sourceFindingIds:root.sourceFindingIds,transferCandidate:task.problemId,transferEvidence:evidence,
  nextSessions:final.tasks.filter(t=>t.minutes===90&&t.sessionProblemIds?.length===5).map(t=>({date:t.date,title:t.label})),
  currentRequiredRepairs:initial.repairs.filter(r=>r.required).map(r=>({source:r.sourceProblemId,kind:r.repairKind,skills:r.weaknessSkillIds}))};
await mkdir('outputs',{recursive:true});await writeFile('outputs/grounded-loop-acceptance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,coverage:{high:coverage.high,medium:coverage.medium,unmapped:coverage.unmapped}},null,2));
