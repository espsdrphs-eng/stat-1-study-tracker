import test from "node:test";
import assert from "node:assert/strict";
import { classifyKPolicyValidity, planningErrorsForSource } from "../src/legacyKPolicy.ts";
import { resolveLearningPolicy } from "../src/learningPolicyResolver.ts";
import { taskDraftFromPrescription } from "../src/taskScheduler.ts";
import { finalizeStudyUpdateForSave } from "../src/studyCycle.ts";

const wb620={
  problem_id:"WB-6-A-20",date:"2026-07-17",mode:"skeleton",time_minutes:20,mark:"△",score_label:"B",
  error_type:"K",primary_error_type:"K",error_types:["K","N","C"],memo:"",score_numeric:79,
  error_point:"H転置とHの配置が混在し、W1にベクトル全体を置く記号上の誤りがある。Qの展開の接続も不足。",
  improvement_guidance:"方針・今見る量・ゴール・計算開始の境界を追加する。",
  next_action:"Hの配置、WとW1の区別、長さの保存、Qの展開だけを再現する。",
  unresolved_carryover:["HとH転置の配置をそろえる","W1とWを区別する","長さの保存を書く","Qを展開する","方針・今見る量・ゴール・計算開始の境界を明示する"],
  rubric_version:"STAT1-REVIEW-v8",k_evidence:[],generated_from_review_id:144,
};

test("WB-6-A-20の旧Kは局所数学補修へ解決され骨格見出しを継承しない",()=>{
  assert.equal(classifyKPolicyValidity(wb620),"invalid_legacy_k");
  assert.deepEqual(planningErrorsForSource(wb620),["C"]);
  const prescription=resolveLearningPolicy({problemId:"WB-6-A-20",source:{...wb620,learning_purpose:"error_repair",assessment_timing:"delayed_retrieval",review_scope:"targeted_patch"}});
  assert.equal(prescription.targetKind,"mathematical_patch");
  assert.equal(prescription.reviewScope,"targeted_patch");
  assert.deepEqual(prescription.effectiveErrorTypes,["C"]);
  assert.deepEqual(prescription.targetedParts,["Hの配置","WとW1の区別","長さ保存（W転置W=Z転置Z）","Qの展開"]);
  assert.equal(prescription.targetedParts.some(part=>/方針|今見る量|ゴール|ここから先は計算/.test(part)),false);
  assert.deepEqual(prescription.allowedErrorTypes,["C"]);
  const draft=taskDraftFromPrescription({prescription,sourceAttemptId:68,sourceDate:"2026-07-17",errors:prescription.effectiveErrorTypes});
  assert.equal(draft.dueDate,"2026-07-24");
});

test("根拠も局所誤りの情報もない旧Kはneeds_reviewで自動無効化しない",()=>{
  const source={...wb620,error_point:"",next_action:"",improvement_guidance:"",unresolved_carryover:[],error_types:["K"]};
  assert.equal(classifyKPolicyValidity(source),"needs_review");
  assert.deepEqual(planningErrorsForSource(source),["K"]);
});

test("新ルーブリックの具体的構造根拠がないKはraw保存して計画には使わない",()=>{
  const saved=finalizeStudyUpdateForSave({problem_id:"WB-6-A-20",date:"2026-07-18",mode:"skeleton",mark:"△",score_label:"B",
    error_type:"K",primary_error_type:"K",error_types:["K"],error_point:"W1の添字を誤記した",next_action:"W1だけ直す",
    rubric_version:"STAT1-REVIEW-v9",k_evidence:["答案中でW1の添字が違う"]});
  assert.deepEqual(saved.error_types,["K"]);
  assert.deepEqual(saved.effective_error_types,["none"]);
  assert.equal(saved.review_after_days,14);
  assert.equal(saved.k_evidence_valid,false);
});

test("構造崩れを引用したKだけが有効",()=>{
  const source={...wb620,error_types:["K"],error_point:"問題の型を誤った",k_evidence:["答案には『標本平均の問題として解く』と書かれ、問題の型を誤っている"]};
  assert.equal(classifyKPolicyValidity(source),"valid");
  assert.deepEqual(planningErrorsForSource(source),["K"]);
});
