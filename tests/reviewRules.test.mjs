import test from "node:test";
import assert from "node:assert/strict";
import { createAdaptiveReviewPlan, createAttemptReviewPlan, createPastReviewPlan, createSReviewPlan, enforceReviewEvidence } from "../src/reviewRules.ts";

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

test("Nが途中式の省略なら、できている骨格を繰り返さず局所計算だけ復習する",()=>{
  const plan=createAttemptReviewPlan({...update(["N"]),error_type:"N",error_types:["N"],
    error_point:"尤度微分から推定量までの式変形を省略した"},["WB-6-S-04"]);
  assert.equal(plan.review_method,"省略部分の局所再現");
  assert.equal(plan.mode,"main_calc");
  assert.equal(plan.review_type,"main_calc_retry");
  assert.equal(plan.requires_full_answer,false);
  assert.equal(plan.requires_s_check,false);
  assert.match(plan.review_instruction,/答や方針だけでは完了にしない/);
  assert.equal(plan.review_steps.length,3);
  assert.ok(plan.review_steps.some(step=>step.includes("理由付き")));
});

test("前回Nなのに改善根拠がないsuccessはpartialへ下げる",()=>{
  const result=enforceReviewEvidence({...update([],"○"),generated_from_review_id:12,
    rubric_version:"STAT1-REVIEW-v5",review_outcome:"success",
    target_issue_resolved:true,minimum_pass_condition_met:true,
    resolution_evidence:"骨格は正しい",answer_change_summary:"前回と同じ答案",
    required_work_shown:[],evaluation_scope:"conditional_full",graded_parts:["骨格"],
    unresolved_carryover:["式変形"]} ,["N"],"STAT1-REVIEW-v5");
  assert.equal(result.review_outcome,"partial");
  assert.equal(result.error_type,"N");
  assert.equal(result.mark,"△");
});

test("前回Nの省略部分を途中式で改善した場合だけsuccessを維持する",()=>{
  const result=enforceReviewEvidence({...update([],"○"),generated_from_review_id:12,
    rubric_version:"STAT1-REVIEW-v5",review_outcome:"success",
    target_issue_resolved:true,minimum_pass_condition_met:true,
    resolution_evidence:"答案にスコア方程式から推定量までの3行がある",
    answer_change_summary:"前回省略した式変形を3行追加した",
    required_work_shown:["対数尤度の微分","分母の通分","未知量について解く"],
    evaluation_scope:"conditional_full",graded_parts:["主要計算"],assumed_correct_parts:["骨格","結論"],
    unresolved_carryover:[]},["N"],"STAT1-REVIEW-v5");
  assert.equal(result.review_outcome,"success");
  assert.equal(result.error_type,"none");
});

test("ヒントを見た後に白紙再現していないsuccessはpartialへ下げる",()=>{
  const base={...update([],"○"),generated_from_review_id:12,rubric_version:"STAT1-REVIEW-v5",review_outcome:"success",
    target_issue_resolved:true,minimum_pass_condition_met:true,resolution_evidence:"答案に必要な式変形がある",
    answer_change_summary:"前回省略した2行を追加",required_work_shown:["微分","整理"],
    evaluation_scope:"conditional_full",graded_parts:["主要計算"],unresolved_carryover:[],hint_used:true,
    hint_level:"solution"};
  const failed=enforceReviewEvidence({...base,after_hint_reproduced:false},["N"],"STAT1-REVIEW-v5");
  const passed=enforceReviewEvidence({...base,after_hint_reproduced:true},["N"],"STAT1-REVIEW-v5");
  assert.equal(failed.review_outcome,"partial");
  assert.equal(passed.review_outcome,"success");
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

test("復習結果に応じて次回間隔を適応させる",()=>{
  const source={...update(["W"]),id:1,time_minutes:20,score_numeric:60,memo:""};
  const review={id:1,problem_id:source.problem_id,due_date:"2026-06-30",review_type:"main_calc_retry",status:"pending",generated_from_attempt_id:1,interval_days:10};
  assert.equal(createAdaptiveReviewPlan(source,review,{result:"failed",hint_used:false,time_minutes:10}).interval_days,1);
  assert.equal(createAdaptiveReviewPlan(source,review,{result:"partial",hint_used:false,time_minutes:10}).interval_days,6);
  assert.equal(createAdaptiveReviewPlan(source,review,{result:"success",hint_used:true,time_minutes:8}).interval_days,17);
  assert.equal(createAdaptiveReviewPlan(source,review,{result:"success",hint_used:false,time_minutes:6}).interval_days,25);
  assert.equal(createAdaptiveReviewPlan(source,review,{result:"partial",hint_used:true,reference_level:4,official_answer:true,time_minutes:8}).interval_days,3);
  assert.equal(createAdaptiveReviewPlan(source,review,{result:"partial",hint_used:true,reference_level:5,gpt_explanation:true,time_minutes:8}).interval_days,3);
});

test("自力成功の適応間隔は30日を上限にする",()=>{
  const source={...update(["K"]),id:1,time_minutes:20,score_numeric:50,memo:""};
  const review={id:1,problem_id:source.problem_id,due_date:"2026-06-30",review_type:"skeleton_retry",status:"pending",generated_from_attempt_id:1,interval_days:20};
  const plan=createAdaptiveReviewPlan(source,review,{result:"success",hint_used:false,time_minutes:5});
  assert.equal(plan.interval_days,30);
  assert.equal(plan.requires_s_check,false);
});
