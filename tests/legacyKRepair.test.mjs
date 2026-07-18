import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLegacyKReorganization } from "../src/legacyKRepair.ts";

const problem={problem_id:"WB-6-A-20",title:"第6章A問20",source_type:"whitebook",category:"A",chapter:6,problem_number:20,
  theme:"回帰・直交変換",role:"A",recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",
  canonical_problem_type:"直交変換による分解",canonical_keywords:["直交変換"],metadata_status:"ok"};
const source={id:68,problem_id:"WB-6-A-20",date:"2026-07-17",mode:"skeleton",time_minutes:20,mark:"△",score_label:"B",memo:"",
  error_type:"K",primary_error_type:"K",error_types:["K","N","C"],rubric_version:"STAT1-REVIEW-v8",k_evidence:[],
  error_point:"Hの配置が混在し、W1にベクトル全体を置く記号上の誤り。Qの展開も接続不足。",
  next_action:"Hの配置、WとW1の区別、長さの保存、Qの展開を直す",
  improvement_guidance:"方針・今見る量・ゴール・計算開始の境界を追加する。",
  unresolved_carryover:["Hの配置","WとW1の区別","長さの保存","Qの展開","方針・今見る量・ゴール・計算開始の境界を明示する"]};
const review={id:175,problem_id:"WB-6-A-20",due_date:"2026-07-18",review_type:"skeleton_retry",status:"pending",generated_from_attempt_id:68,
  duration_minutes:20,reason:"旧K",review_scope:"targeted_patch",effective_mode:"skeleton",sheet_type:"skeleton_sheet",learning_purpose:"error_repair",
  assessment_timing:"delayed_retrieval",target_kind:"skeleton_expression_patch",policy_version:"STAT1-LEARNING-v1"};

test("pending旧Kタスクを数学的patchへ再解決し2回目は増えない",()=>{
  const first=analyzeLegacyKReorganization({attempts:[source],reviews:[review],problems:[problem]});
  assert.equal(first.invalidLegacyKCount,1);
  assert.equal(first.resolvedTaskCount,1);
  assert.equal(first.supersededTaskCount,0);
  const patch=first.taskActions[0].patch;
  assert.equal(patch.target_kind,"mathematical_patch");
  assert.equal(patch.interval_days,7);
  assert.equal(patch.due_date,"2026-07-24");
  assert.deepEqual(patch.targeted_parts,["Hの配置","WとW1の区別","長さ保存（W転置W=Z転置Z）","Qの展開"]);
  assert.equal(patch.targeted_parts.some(part=>/方針|今見る量|ゴール|ここから先は計算/.test(part)),false);
  const second=analyzeLegacyKReorganization({attempts:[{...source,policy_validity:"invalid_legacy_k"}],reviews:[{...review,...patch}],problems:[problem]});
  assert.equal(second.taskActions.length,0);
});

test("旧Kだけの未完了タスクは削除せずsupersededにする",()=>{
  const kOnly={...source,error_types:["K"],primary_error_type:"K",error_point:"骨格シートのゴール欄とここから先は計算が未記入",next_action:"ゴール欄を書く",unresolved_carryover:["ゴール","ここから先は計算"]};
  const result=analyzeLegacyKReorganization({attempts:[kOnly],reviews:[review],problems:[problem]});
  assert.equal(result.supersededTaskCount,1);
  assert.equal(result.taskActions[0].patch.status,"superseded");
});
