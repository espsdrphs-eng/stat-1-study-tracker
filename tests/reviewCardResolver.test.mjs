import test from "node:test";
import assert from "node:assert/strict";
import { correctedDueDate, resolveReviewCard } from "../src/reviewCardResolver.ts";

const problem=(id,category="A",theme="多次元分布・変数変換",type="変数変換による同時密度の導出")=>({
  id:1,problem_id:id,source_type:"whitebook",category,chapter:Number(id.split("-")[1]),problem_number:Number(id.split("-")[3]),
  title:`第${id.split("-")[1]}章${category}問${Number(id.split("-")[3])}`,display_label:`第${id.split("-")[1]}章${category}問${Number(id.split("-")[3])}`,
  theme,canonical_problem_type:type,canonical_keywords:["変数変換","ヤコビアン","定義域","同時密度"],master_version:"v2",
  priority:"core",role:category==="S"?"foundation":"training",recommended_mode:"full",linked_past_exams:"",linked_s_problems:"",
  linked_a_problems:"",notes:"",completion_status:"active"
});

const attempt=(id,problemId,error="K",date="2026-07-15")=>({
  id,problem_id:problemId,date,mode:"full",time_minutes:20,mark:"△",score_label:"B",error_type:error,
  error_types:error==="none"?["none"]:[error],primary_error_type:error,error_point:"変換後の定義域が不足",next_action:"定義域だけ再現",memo:""
});

const resolve=(item,problems,attempts=[],aliases=[])=>resolveReviewCard({item,problems,attempts,aliases,today:"2026-07-15",now:"2026-07-15T00:00:00.000Z"});

test("problem_id変更後の旧文章を正本として使わない",()=>{
  const master=problem("WB-4-A-06");
  const card=resolve({id:10,problem_id:master.problem_id,generated_from_attempt_id:1,review_type:"skeleton_retry",due_date:"2026-07-16",interval_days:1,
    review_instruction:"AICの最大対数尤度と自由パラメータ数を比較する",review_goal_public:"AIC比較"},[master],[attempt(1,master.problem_id)]);
  assert.equal(card.theme,"多次元分布・変数変換");
  assert.doesNotMatch(card.correctionTheme.value,/AIC/);
  assert.equal(card.correctionTheme.provenance.problemId,"WB-4-A-06");
});

test("Kのskeletonは骨格答案シートへ一元化する",()=>{
  const master=problem("WB-4-A-06");
  const card=resolve({id:11,problem_id:master.problem_id,generated_from_attempt_id:1,review_type:"skeleton_retry",mode:"skeleton",
    sheet_type:"check_sheet",sheet_name:"チェックシート",due_date:"2026-07-16",interval_days:1},[master],[attempt(1,master.problem_id)]);
  assert.equal(card.effectiveMode,"skeleton");
  assert.equal(card.sheetType,"skeleton_sheet");
  assert.equal(card.sheetLabel,"骨格答案シート");
  assert.ok(card.consistencyWarnings.some(item=>item.code==="mode_sheet_mismatch"));
});

test("14日後が翌日になっているdueDateを7月29日へ補正する",()=>{
  const master=problem("WB-4-A-06");
  const card=resolve({id:12,problem_id:master.problem_id,generated_from_attempt_id:1,review_type:"light_check",due_date:"2026-07-16",interval_days:14},
    [master],[attempt(1,master.problem_id,"none")]);
  assert.equal(correctedDueDate(card),"2026-07-29");
  assert.ok(card.consistencyWarnings.some(item=>item.code==="due_date_interval_mismatch"));
});

test("target履歴なし・source履歴ありは別欄で解決する",()=>{
  const source=problem("WB-4-A-06"),target=problem("WB-4-S-07","S","変数変換の基礎","変数変換の定義域とヤコビアン");
  const card=resolve({id:13,problem_id:target.problem_id,generated_from_attempt_id:1,source_problem_id:source.problem_id,
    task_origin:"linked_s_check",review_type:"s_check",due_date:"2026-07-16",interval_days:1},[source,target],[attempt(1,source.problem_id)]);
  assert.equal(card.targetAttempt,undefined);
  assert.equal(card.sourceAttempt?.problem_id,source.problem_id);
  assert.equal(card.sourceProblem?.problemId,source.problem_id);
});

test("A問題のlinked_s_checkはrelated_drillへ補正する",()=>{
  const master=problem("WB-4-A-06");
  const card=resolve({id:14,problem_id:master.problem_id,generated_from_attempt_id:1,source_problem_id:"WB-4-A-05",task_origin:"linked_s_check",
    review_type:"s_check",due_date:"2026-07-16",interval_days:1},[master],[attempt(1,master.problem_id)]);
  assert.equal(card.taskOrigin,"related_drill");
  assert.ok(card.consistencyWarnings.some(item=>item.code==="linked_s_target_is_not_s"));
});

test("metadata要確認では具体文を抑制する",()=>{
  const master={...problem("WB-4-A-06"),theme:"要確認",canonical_problem_type:"要確認",metadata_status:"review_needed"};
  const card=resolve({id:15,problem_id:master.problem_id,generated_from_attempt_id:1,review_type:"skeleton_retry",due_date:"2026-07-16",interval_days:1},[master],[attempt(1,master.problem_id)]);
  assert.equal(card.reviewNeeded,true);
  assert.equal(card.correctionTheme.value,"問題情報または前回記録の確認が必要です");
});

test("aliasを先にcanonical IDへ解決して履歴を取得する",()=>{
  const master=problem("WB-2-A-06","A","分布関数","分布関数の導出");
  const aliases=[{alias:"WB-2-S-06",problem_id:"WB-2-A-06"}];
  const card=resolve({id:16,problem_id:"WB-2-S-06",generated_from_attempt_id:1,review_type:"skeleton_retry",due_date:"2026-07-16",interval_days:1},[master],[attempt(1,"WB-2-A-06")],aliases);
  assert.equal(card.canonicalProblemId,"WB-2-A-06");
  assert.equal(card.targetAttempt?.id,1);
  assert.equal(card.displayLabel,master.display_label);
});

test("Resolverはtoday_plan_snapshotの構成を変更しない",()=>{
  const master=problem("WB-4-A-06"),task={id:17,problem_id:master.problem_id,generated_from_attempt_id:1,review_type:"skeleton_retry",due_date:"2026-07-16",interval_days:1};
  const snapshot={date:"2026-07-15",task_ids:["17"],start_of_day_planned_minutes:20,initial_bucket:{17:"must"},initial_estimated_minutes:{17:20},tasks:[task],created_at:"now"};
  const before=structuredClone(snapshot);
  resolve(snapshot.tasks[0],[master],[attempt(1,master.problem_id)]);
  assert.deepEqual(snapshot,before);
});

test("完了済みlinked Sとsupersededカードはactive source mismatchにしない",()=>{
  const source=problem("WB-4-A-06"),target=problem("WB-4-S-07","S","変数変換の基礎","変数変換の定義域");
  const foreign=attempt(1,source.problem_id);
  for(const status of ["done","completed","superseded"]){
    const card=resolve({id:90,problem_id:target.problem_id,generated_from_attempt_id:1,source_problem_id:source.problem_id,
      task_origin:"linked_s_check",review_type:"s_check",status,due_date:"2026-07-16",interval_days:1},[source,target],[foreign]);
    assert.equal(card.consistencyWarnings.some(item=>item.code==="attempt_problem_mismatch"),false,status);
  }
});
