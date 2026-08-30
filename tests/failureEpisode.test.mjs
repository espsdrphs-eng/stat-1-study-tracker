import test from "node:test";
import assert from "node:assert/strict";
import {deriveFailureEpisode} from "../src/failureEpisode.ts";

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
