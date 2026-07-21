import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSourceMismatchRepair, resolveReviewOrigin } from "../src/reviewOrigin.ts";

test("verified relation is regenerated from targetFocus only",()=>{
  const source=attempt(70,"WB-6-A-20"),row=review();
  const relation={relationId:"r1",sourceProblemId:"WB-6-A-20",targetProblemId:"WB-6-S-01",relationType:"remediation",sourceIssue:"domain",targetFocus:"transformed domain",reason:"verified remediation",relationSource:"user_confirmed",status:"confirmed",createdAt:"",updatedAt:""};
  const result=analyzeSourceMismatchRepair({reviews:[row],attempts:[source],problems:[problem("WB-6-S-01")],aliases:[],relations:[relation]});
  assert.equal(result.actions[0].action,"regenerate");
  assert.deepEqual(result.actions[0].replacement.targeted_parts,["transformed domain"]);
  assert.equal(result.actions[0].replacement.origin,"verified_linked_problem");
  assert.equal(result.actions[0].replacement.relation_id,"r1");
});

const problem=id=>({id:1,problem_id:id,source_type:"whitebook",category:id.includes("-S-")?"S":"A",chapter:6,problem_number:Number(id.slice(-2)),title:id,theme:"回帰",priority:"core",role:"training",recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",canonical_problem_type:"回帰",canonical_keywords:["回帰"],metadata_status:"ok"});
const attempt=(id,problem_id,errors=["W"])=>({id,problem_id,date:"2026-07-20",mode:"main_calc",time_minutes:15,mark:"△",score_label:"B",error_type:errors[0],error_types:errors,primary_error_type:errors[0],error_point:"対象計算で誤った",next_action:"対象計算を直す",memo:"",rubric_version:"STAT1-REVIEW-v9",k_evidence:errors.includes("K")?["出発式を別の式として選んだ"]:[]});
const review=(overrides={})=>({id:10,problem_id:"WB-6-S-01",due_date:"2026-07-22",review_type:"s_check",status:"pending",generated_from_attempt_id:70,source_attempt_id:70,task_origin:"linked_s_check",source_problem_id:"WB-6-A-20",...overrides});

test("direct_attemptはsourceとtargetのcanonical IDが一致する",()=>{
  const own=attempt(1,"WB-6-A-20");const row=review({problem_id:"WB-6-A-20",generated_from_attempt_id:1,source_attempt_id:1,task_origin:"review_attempt",source_problem_id:undefined});
  assert.deepEqual(resolveReviewOrigin({review:row,attempts:[own],aliases:[],relations:[]}).valid,true);
});

test("past_exam_attemptもsourceとtargetの一致が必須",()=>{
  const source=attempt(2,"PY-2024-Q1"),row=review({problem_id:"PY-2024-Q2",generated_from_attempt_id:2,parent_past_session_id:3});
  assert.equal(resolveReviewOrigin({review:row,attempts:[source],aliases:[],relations:[]}).valid,false);
});

test("異なる問題にはverified relationが必要で同じ章だけでは通らない",()=>{
  const source=attempt(70,"WB-6-A-20"),row=review();
  assert.equal(resolveReviewOrigin({review:row,attempts:[source],aliases:[],relations:[]}).valid,false);
  const relation={relationId:"r1",sourceProblemId:"WB-6-A-20",targetProblemId:"WB-6-S-01",relationType:"remediation",sourceIssue:"直交変換",targetFocus:"直交変換の基礎",reason:"直接補修",relationSource:"user_confirmed",status:"confirmed",createdAt:"",updatedAt:""};
  assert.equal(resolveReviewOrigin({review:row,attempts:[source],aliases:[],relations:[relation]}).valid,true);
});

test("source mismatchを単純rebindせず古いカードをsupersededにする",()=>{
  const foreign=attempt(70,"WB-6-A-20"),own=attempt(80,"WB-6-S-01",["N"]);
  const result=analyzeSourceMismatchRepair({reviews:[review()],attempts:[foreign,own],problems:[problem("WB-6-S-01")],aliases:[],relations:[]});
  assert.equal(result.actions[0].action,"regenerate");
  assert.equal(result.actions[0].patch.status,"superseded");
  assert.equal(result.actions[0].replacement.generated_from_attempt_id,80);
  assert.notEqual(result.actions[0].replacement.generated_from_attempt_id,70);
});

test("invalid legacy Kしかないtargetから新規カードを作らない",()=>{
  const foreign=attempt(70,"WB-6-A-20"),own={...attempt(80,"WB-6-S-01",["K"]),rubric_version:"STAT1-REVIEW-v8",k_evidence:[],error_point:"骨格シートのゴール欄が空欄"};
  const result=analyzeSourceMismatchRepair({reviews:[review()],attempts:[foreign,own],problems:[problem("WB-6-S-01")],aliases:[],relations:[]});
  assert.equal(result.actions[0].action,"supersede");assert.equal(result.regeneratedCount,0);
});

test("対象Attemptなし・relationなしはsuperseded",()=>{
  const result=analyzeSourceMismatchRepair({reviews:[review()],attempts:[attempt(70,"WB-6-A-20")],problems:[problem("WB-6-S-01")],aliases:[],relations:[]});
  assert.equal(result.supersededCount,1);assert.equal(result.actions[0].patch.status,"superseded");
});

test("再生成後の2回目修復は変更を増やさない",()=>{
  const foreign=attempt(70,"WB-6-A-20"),own=attempt(80,"WB-6-S-01",["W"]),first=analyzeSourceMismatchRepair({reviews:[review()],attempts:[foreign,own],problems:[problem("WB-6-S-01")],aliases:[],relations:[]});
  const old={...review(),...first.actions[0].patch},replacement={id:11,...first.actions[0].replacement};
  const second=analyzeSourceMismatchRepair({reviews:[old,replacement],attempts:[foreign,own],problems:[problem("WB-6-S-01")],aliases:[],relations:[]});
  assert.equal(second.actions.length,0);
});
