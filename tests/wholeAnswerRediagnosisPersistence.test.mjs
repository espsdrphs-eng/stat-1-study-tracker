import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const {db,localGet,localPost}=await import("../src/localDb.ts");

test("existing Attempt rediagnosis preserves original grading and is idempotent",async()=>{
  await localGet("/api/bootstrap");
  const problemId="WB-2-A-06";
  await db.attempts.where("problem_id").equals(problemId).delete();
  await db.reviews.where("problem_id").equals(problemId).delete();
  const attemptId=Number(await db.attempts.add({problem_id:problemId,date:"2026-08-18",mode:"main_calc",time_minutes:20,
    mark:"○",score_label:"S",score_numeric:100,error_type:"none",error_types:["none"],error_point:"",next_action:"",memo:"",
    graded_findings:[{graded_part_id:"canonical-part",error_type:"none",evidence:"current contract成功",resolved:true}]}));
  const text=`whole_answer_diagnostic_update:
  attempt_id: ${attemptId}
  problem_id: ${problemId}
  whole_answer_scan:
    performed: true
    app_reference_coverage: partial
    effective_reference_coverage: full
    written_answer_coverage: full
    confidence: high
    attachments:
      - {attachment_id: problem, kind: problem_statement, description: 問題全文, coverage: full}
      - {attachment_id: official, kind: official_reference_answer, description: 公式解答全文, coverage: full}
      - {attachment_id: answer1, kind: current_answer, description: 答案1頁, coverage: full}
      - {attachment_id: answer2, kind: current_answer, description: 答案2頁, coverage: full}
    regions:
      - {region_id: r1, description: current target, answer_present: true, readable: true, reference_available: true, status: checked_correct, finding_ids: []}
      - {region_id: r2, description: 独立した主要計算, answer_present: true, readable: true, reference_available: true, status: checked_error, finding_ids: [f1]}
  observed_out_of_scope_findings:
    - finding_id: f1
      mastery_level: main_calc
      finding: 主要計算の係数追跡を誤った
      evidence: 答案2頁の係数が公式解答と異なる
      correction: 係数を各項で保持する
      materiality: major
      confidence: high
      create_target_candidate: true
      root_cause_key: coefficient_tracking
  diagnostic_uncertainties: []`;
  const preview=await localPost(`/api/attempts/${attemptId}/whole-diagnostic/preview`,{text});
  assert.equal(preview.changes,1);assert.equal(preview.wholeAnswerScan.effective_reference_coverage,"full");
  const first=await localPost(`/api/attempts/${attemptId}/whole-diagnostic/save`,{text});
  const saved=await db.attempts.get(attemptId),reviewCount=(await db.reviews.where("problem_id").equals(problemId).toArray()).length;
  assert.equal(first.changes,1);assert.equal(saved.score_numeric,100);assert.equal(saved.score_label,"S");assert.equal(saved.mark,"○");
  assert.deepEqual(saved.graded_findings,[{graded_part_id:"canonical-part",error_type:"none",evidence:"current contract成功",resolved:true}]);
  assert.equal(saved.observed_out_of_scope_findings.length,1);assert.match(saved.observed_out_of_scope_findings[0].stable_target_key,/^target:WB-2-A-06:root:/);
  const second=await localPost(`/api/attempts/${attemptId}/whole-diagnostic/save`,{text});
  assert.equal(second.changes,0);assert.equal((await db.reviews.where("problem_id").equals(problemId).toArray()).length,reviewCount);
  assert.equal((await db.attempts.where("problem_id").equals(problemId).toArray()).length,1);
  const audit=await localPost("/api/integrity/preview",{});
  for(const category of ["attached_full_reference_downgraded_by_app_metadata","written_answer_region_unaccounted",
    "readable_region_not_evaluated","material_uncertainty_not_surfaced","whole_scan_empty_with_material_uncertainty",
    "same_root_duplicate_target","independent_major_finding_not_promoted","rediagnosis_changed_original_score",
    "rediagnosis_changed_original_mark","rediagnosis_duplicate_target","rediagnosis_duplicate_review","problem_specific_whole_scan_branch"])
    assert.equal(audit.before.counts[category],0,category);
});
