import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {buildPastExamRepairCandidates,analyzeConceptWeaknesses} from '../src/conceptWeakness.ts';
import {deriveTransferEvidence} from '../src/skillEvidence.ts';
import {buildFirstAttemptGradingPrompt} from '../src/gradingPrompt.ts';
import {attempt,problem,record,pastProblem} from './adaptiveFixture.mjs';

// Minimal, de-identified structural fixture; wording is from the 9/16 graded
// finding and the source-indexed Whitebook question, not invented skill tags.
const skill='moment_generating_function';
const evidence='設問1でMGFの最終形へ進む入口は正しいが、e^{sX}の期待値を離散和として書く総和記号が省略されている。';
const source=()=>attempt(1,'PY-2021-Q3','2026-09-16',{score_numeric:55,grading_confidence:.95,
  grading_contract:{gradedParts:[{id:'first_step',label:'初手',stableTargetKey:'target:entry',masteryLevel:1}]},
  graded_findings:[{graded_part_id:'first_step',error_type:'N',resolved:false,evidence}]});
const rec=()=>{const r=record();r.data.pastExamProblems=[pastProblem(2021,3,[skill]),pastProblem(2023,3,[skill])];
  r.data.concepts=[{...r.data.concepts[0],concept_id:skill}];return r;};
const session={id:1,year:2021,session_kind:'selected_three_timed',date:'2026-09-16',
  linked_attempt_ids:[1],selected_timed_attempt_ids:[1],final_selected_problem_ids:['PY-2021-Q3']};
const wb=problem('WB-3-A-24');
const answer={problem_id:wb.problem_id,answer_available:true,document_key:'mathstat_answers_2025_03_07',page_start:62,
  answer_excerpt:'確率変数 X が指数分布 Ex(λ) に従うとする。(1) 積率母関数 MX(t)=E[etX]を求めよ。'};
const build=(attempts,extra={})=>buildPastExamRepairCandidates({record:rec(),sessions:[session],attempts,
  conceptWeaknesses:analyzeConceptWeaknesses({record:rec(),problems:[],attempts,reviews:[],weakNotes:[],today:'2026-09-17'}),
  problems:[wb,problem('PY-2023-Q3',null,'past_exam')],...extra});

test('9/16 explicit finding operation bridges to a sourced Whitebook question, never its chapter',()=>{
  const a=source(),before=JSON.stringify(a);
  assert.deepEqual(deriveFailureEpisode(a).rootWeaknesses[0].skillIds,[skill]);
  const row=build([a],{answers:[answer]})[0];
  assert.equal(row.required,true);assert.equal(row.repairKind,'whitebook');
  assert.equal(row.matchConfidence,'high');assert.deepEqual(row.matchedSkillIds,[skill]);
  assert.match(row.matchReason,/mathstat_answers_2025_03_07/);
  assert.equal(JSON.stringify(a),before,'raw finding/contract must not be rewritten');
});
test('no source text: mini repair then explicit success unlocks different-problem transfer',()=>{
  const a=source();assert.equal(build([a])[0].repairKind,'concept_mini');
  const success={...a,id:2,date:'2026-09-18',error_types:['none'],error_type:'none',review_outcome:'success',
    graded_findings:[{...a.graded_findings[0],error_type:'none',resolved:true,evidence:'MGFを期待値の離散和から正しく計算した。'}]};
  const row=build([a,success])[0];
  assert.equal(row.repairKind,'transfer');assert.equal(row.repairSuccessEvidenceId,2);
  assert.deepEqual(row.transferProblemIds,['PY-2023-Q3']);
  assert.equal(deriveTransferEvidence([a,success]).length,0);
  const transfer={...success,id:3,problem_id:'PY-2023-Q3',date:'2026-09-20'};
  assert.equal(deriveTransferEvidence([a,success,transfer])[0]?.successAttemptId,3);
  assert.equal(build([a,success,transfer]).length,0);
});
test('two failures cannot bypass repair success and schedule unguided transfer',()=>{
  const a=source(),rows=build([a,{...a,id:2,date:'2026-09-17'}]);
  assert.equal(rows[0].interventionChanged,true);assert.notEqual(rows[0].repairKind,'transfer');
});
test('answer-exposed destination cannot be an unseen transfer and missing skill is not fabricated',()=>{
  const a=source(),success={...a,id:2,date:'2026-09-18',graded_findings:[{...a.graded_findings[0],error_type:'none',resolved:true}]};
  assert.equal(build([a,success],{exposureOverrides:{'PY-2023-Q3':'answer_exposed'}})[0].repairKind,'transfer_wait');
  assert.equal(build([a],{answers:[{...answer,answer_excerpt:'第3章：分布と推定。'}]})[0].repairKind,'concept_mini');
});
test('live transfer prompt carries the canonical target without asserting a successful outcome',()=>{
  const prompt=buildFirstAttemptGradingPrompt({problemId:'PY-2023-Q3',repairLineage:{sourceProblemId:'PY-2021-Q3',
    sourceAttemptId:1,repairSuccessEvidenceId:2,rootWeaknessId:'root:entry',weaknessSkillIds:[skill],matchConfidence:'high'}});
  assert.match(prompt,/対象skill: moment_generating_function/);
  assert.match(prompt,/これは今回の成功を意味しない/);
  assert.match(prompt,/graded_findingsのevidence/);
});
test('explicit cross-problem scaffold success is repair, not the later transfer test',()=>{
  const a=source(),scaffold={...a,id:2,problem_id:wb.problem_id,source_problem_id:a.problem_id,
    date:'2026-09-18',learning_purpose:'error_repair',graded_findings:[{...a.graded_findings[0],error_type:'none',resolved:true,
      evidence:'MGFを期待値の和から正しく計算した。'}]};
  assert.equal(deriveTransferEvidence([a,scaffold]).length,0);
  const row=build([a,scaffold])[0];
  assert.equal(row.repairKind,'transfer');assert.equal(row.repairSuccessEvidenceId,2);
});
