import test from "node:test";
import assert from "node:assert/strict";
import {deriveFailureEpisode} from "../src/failureEpisode.ts";
import {reviewPlanningDecision} from "../src/todayLearningPolicy.ts";

// 9/20 current-data regression: the original calculation was repaired; the
// only remaining checked-error region is explicitly uncertain and minor.
const residualNotation=()=>({id:901,problem_id:"PY-2020-Q2",date:"2026-09-15",mode:"skeleton",
  score_numeric:92,error_types:["N"],review_outcome:"failed",minimum_pass_condition_met:false,
  graded_findings:[{graded_part_id:"residual",error_type:"N",evidence:"期待値記法に曖昧さが残る",resolved:false}],
  whole_answer_scan:{performed:true,confidence:"high",written_answer_coverage:"full",regions:[
    {region_id:"notation",status:"checked_error"},{region_id:"calculation",status:"checked_correct"}]},
  diagnostic_uncertainties:[{region_id:"notation",potential_materiality:"minor",confidence:"medium"}]});

test("minor-only diagnostic uncertainty is not promoted by a failed targeted Review",()=>{
  const attempt=residualNotation(),root=deriveFailureEpisode(attempt).rootWeaknesses[0];
  assert.equal(root.materiality,"minor");assert.equal(root.requiredRepair,false);
  assert.equal(reviewPlanningDecision({review:{id:902,problem_id:attempt.problem_id,
    learning_purpose:"error_repair",source_attempt_id:attempt.id},attempts:[attempt],
    problems:[{problem_id:attempt.problem_id,source_type:"past_exam"}],weaknesses:[]}).scheduleAsRequired,false);
});

test("minor uncertainty cannot mask an uncovered major region or recurring root",()=>{
  const attempt=residualNotation();
  attempt.whole_answer_scan.regions.push({region_id:"other-calculation",status:"checked_error"});
  assert.equal(deriveFailureEpisode(attempt).rootWeaknesses[0].requiredRepair,true);
  const recurring=residualNotation();
  assert.equal(deriveFailureEpisode(recurring,{recurrenceByRoot:{residual:1}}).rootWeaknesses[0].requiredRepair,true);
});

test("同じroot causeのfirst step・calculation・conclusionを1 weaknessへ集約する",()=>{
  const attempt={id:223,problem_id:"PY-2017-Q3",date:"2026-08-29",mode:"full",score_numeric:58,
    mark:"△",score_label:"C",error_type:"W",error_point:"Poisson和を閉じられない",next_action:"再現",memo:"",
    graded_findings:[
      {graded_part_id:"first",error_type:"K",evidence:"二項定理への接続が出ない",resolved:false},
      {graded_part_id:"calc",error_type:"W",evidence:"同じ接続不足で主要計算が停止",resolved:false},
      {graded_part_id:"conclusion",error_type:"N",evidence:"上流計算停止により結論未完",resolved:false},
    ],grading_contract:{gradedParts:[
      {id:"first",label:"初手",rootCauseKey:"poisson-convolution"},
      {id:"calc",label:"主要計算",rootCauseKey:"poisson-convolution"},
      {id:"conclusion",label:"結論",rootCauseKey:"poisson-convolution"},
    ]}};
  const episode=deriveFailureEpisode(attempt);
  assert.equal(episode.rootWeaknesses.length,1);
  assert.deepEqual(episode.rootWeaknesses[0].sourceFindingIds,["first","calc","conclusion"]);
  assert.equal(episode.rootWeaknesses[0].materiality,"major");
  assert.equal(episode.rootWeaknesses[0].unresolved,true);
});

test("単発で結果を変えないCはoptional判定になる",()=>{
  const episode=deriveFailureEpisode({id:10,problem_id:"WB-5-A-20",date:"2026-08-29",mode:"full",score_numeric:82,
    mark:"△",score_label:"A",error_type:"C",error_point:"V^2をE[V^2]と転記",next_action:"記号確認",memo:"",
    error_types:["C"],review_outcome:"partial",conclusion_reached:true});
  assert.equal(episode.rootWeaknesses.length,1);
  assert.equal(episode.rootWeaknesses[0].materiality,"minor");
  assert.equal(episode.rootWeaknesses[0].requiredRepair,false);
});
