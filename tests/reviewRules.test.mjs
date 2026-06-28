import test from "node:test";
import assert from "node:assert/strict";
import { createAttemptReviewPlan, createPastReviewPlan, createSReviewPlan } from "../src/reviewRules.ts";

const update=(errors,mark="△")=>({
  problem_id:"WB-2-A-20",date:"2026-06-29",mode:"full",mark,score_label:"B",
  error_type:errors[0]||"none",primary_error_type:errors[0]||"none",error_types:errors,
  error_point:"",next_action:""
});

test("K/N/W/C/noneの間隔と復習方法を生成する",()=>{
  const cases=[
    [["K"],1,"骨格再現＋関連S確認",20],
    [["N"],2,"ノート補修＋骨格再現",18],
    [["W"],3,"該当作業だけ再演習",12],
    [["C"],7,"チェックリスト確認",7],
    [[],14,"軽い骨格確認",5]
  ];
  for(const [errors,days,method,minutes] of cases){
    const plan=createAttemptReviewPlan(update(errors),["WB-2-S-06"]);
    assert.equal(plan.interval_days,days);
    assert.equal(plan.review_method,method);
    assert.equal(plan.estimated_minutes,minutes);
    assert.equal(plan.requires_full_answer,false);
  }
});

test("複数分類では最短間隔を採用する",()=>{
  assert.equal(createAttemptReviewPlan(update(["K","W"])).interval_days,1);
  assert.equal(createAttemptReviewPlan(update(["W","N"])).interval_days,2);
  assert.equal(createAttemptReviewPlan(update(["N","C"])).interval_days,2);
  assert.equal(createAttemptReviewPlan(update(["W","C"])).interval_days,3);
});

test("関連S確認はK/Nかつ関連問題がある場合だけ必要になる",()=>{
  assert.equal(createAttemptReviewPlan(update(["K"]),["WB-2-S-06"]).requires_s_check,true);
  assert.equal(createAttemptReviewPlan(update(["N"]),["WB-2-S-06"]).requires_s_check,true);
  assert.equal(createAttemptReviewPlan(update(["K"]),[]).requires_s_check,false);
  assert.equal(createAttemptReviewPlan(update(["W"]),["WB-2-S-06"]).requires_s_check,false);
});

test("◎2回連続は30日後、◎3回連続は完了候補になる",()=>{
  const second=createAttemptReviewPlan(update([],"◎"),[],1);
  const third=createAttemptReviewPlan(update([],"◎"),[],2);
  assert.equal(second.interval_days,30);
  assert.equal(second.completion_candidate,false);
  assert.equal(third.interval_days,30);
  assert.equal(third.completion_candidate,true);
});

test("S問題は記憶状態ごとの間隔と方法になる",()=>{
  assert.deepEqual(["stable","check","forgotten","collapsed"].map(state=>{
    const plan=createSReviewPlan(state);
    return [plan.interval_days,plan.review_method,plan.estimated_minutes];
  }),[
    [30,"3分チェック",3],[14,"5分骨格確認",5],
    [3,"10分骨格再構築",10],[1,"10〜20分復旧",20]
  ]);
});

test("過去問は選題と90分答案を別ルールで扱う",()=>{
  const scanGood=createPastReviewPlan({session_type:"scan_5_questions",selection_result:"good"});
  const scanFailed=createPastReviewPlan({session_type:"scan_5_questions",selection_result:"failed"});
  const examGood=createPastReviewPlan({session_type:"exam_90min",completed_questions_count:2});
  const examFailed=createPastReviewPlan({session_type:"exam_90min",completed_questions_count:1});
  assert.deepEqual([scanGood.interval_days,scanGood.review_method,scanGood.requires_full_answer],[14,"軽い選題確認",false]);
  assert.deepEqual([scanFailed.interval_days,scanFailed.review_method],[2,"選題やり直し"]);
  assert.deepEqual([examGood.interval_days,examGood.review_method,examGood.requires_full_answer],[14,"弱点だけ補修",true]);
  assert.deepEqual([examFailed.interval_days,examFailed.review_method,examFailed.requires_full_answer],[5,"過去問補修",true]);
});
