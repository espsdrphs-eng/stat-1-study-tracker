import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSourceMismatchRepair, resolveReviewOrigin } from "../src/reviewOrigin.ts";

test("verified relation is migrated in place from targetFocus only",()=>{
  const source=attempt(70,"WB-6-A-20"),row=review();
  const relation={relationId:"r1",sourceProblemId:"WB-6-A-20",targetProblemId:"WB-6-S-01",relationType:"remediation",sourceIssue:"domain",targetFocus:"transformed domain",reason:"verified remediation",relationSource:"user_confirmed",status:"confirmed",createdAt:"",updatedAt:""};
  const result=analyzeSourceMismatchRepair({reviews:[row],attempts:[source],problems:[problem("WB-6-S-01")],aliases:[],relations:[relation]});
  assert.equal(result.actions[0].action,"migrate_verified");
  assert.deepEqual(result.actions[0].patch.targeted_parts,["transformed domain"]);
  assert.equal(result.actions[0].patch.origin,"verified_linked_problem");
  assert.equal(result.actions[0].patch.relation_id,"r1");
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

test("problem_masterの正式な関連指定をverified_masterとして解決する",()=>{
  const sourceProblem={...problem("WB-2-S-06"),master_version:"v7",related_s_problem_ids:["WB-2-S-07"]};
  const targetProblem=problem("WB-2-S-07"),source=attempt(52,"WB-2-S-06",["N"]);
  const row=review({id:115,problem_id:"WB-2-S-07",generated_from_attempt_id:52,source_attempt_id:undefined,source_problem_id:"WB-2-S-06"});
  const result=analyzeSourceMismatchRepair({reviews:[row],attempts:[source],problems:[sourceProblem,targetProblem],aliases:[],relations:[]});
  assert.equal(result.pendingVerifiedLinkNeedsMigrationCount,1);
  assert.equal(result.actions[0].action,"migrate_verified");
  assert.equal(result.actions[0].patch.relation_id,"master:v7:WB-2-S-06:WB-2-S-07:remediation");
});

test("完了済みlinked Sはhistorical_completedとしてactive errorへ数えない",()=>{
  const row=review({id:2,status:"done",problem_id:"WB-2-S-07",source_problem_id:"WB-2-S-06"});
  const result=analyzeSourceMismatchRepair({reviews:[row],attempts:[attempt(70,"WB-2-S-06")],problems:[problem("WB-2-S-07")],aliases:[],relations:[]});
  assert.equal(result.historicalCompletedLinkedReviewsCount,1);
  assert.equal(result.activeSourceMismatchCount,0);
  assert.equal(result.actions.length,0);
});

test("source mismatchを単純rebindせず古いカードをsupersededにする",()=>{
  const foreign=attempt(70,"WB-6-A-20"),own=attempt(80,"WB-6-S-01",["N"]);
  const result=analyzeSourceMismatchRepair({reviews:[review()],attempts:[foreign,own],problems:[problem("WB-6-S-01")],aliases:[],relations:[]});
  assert.equal(result.actions[0].action,"regenerate");
  assert.equal(result.actions[0].patch.status,"superseded");
  assert.equal(result.actions[0].replacement.generated_from_attempt_id,80);
  assert.equal(result.actions[0].replacement.source_attempt_id,80);
  assert.equal(result.actions[0].replacement.derived_from_attempt_id,80);
  assert.equal(result.actions[0].replacement.derived_fields.reviewGoal.provenance.attemptId,80);
  assert.notEqual(result.actions[0].replacement.generated_from_attempt_id,70);
  assert.notEqual(result.actions[0].replacement.reason,review().reason);
});

test("invalid legacy Kしかないtargetから新規カードを作らない",()=>{
  const foreign=attempt(70,"WB-6-A-20"),own={...attempt(80,"WB-6-S-01",["K"]),rubric_version:"STAT1-REVIEW-v8",k_evidence:[],error_point:"骨格シートのゴール欄が空欄"};
  const result=analyzeSourceMismatchRepair({reviews:[review()],attempts:[foreign,own],problems:[problem("WB-6-S-01")],aliases:[],relations:[]});
  assert.equal(result.actions[0].action,"supersede");assert.equal(result.regeneratedCount,0);
});

test("invalid legacy Kのcross-target pendingは関係があっても現行triggerなしならsuperseded",()=>{
  const source={...attempt(71,"WB-6-A-19",["K"]),policy_validity:"invalid_legacy_k",exclude_from_planning:true};
  const row=review({policy_validity:"invalid_legacy_k",superseded_by_policy_version:"STAT1-v9"});
  const relation={relationId:"master:v1:a:s:remediation",sourceProblemId:"WB-6-A-19",targetProblemId:"WB-6-S-01",relationType:"remediation",sourceIssue:"old K",targetFocus:"基礎",reason:"master",relationSource:"problem_master",status:"confirmed",createdAt:"",updatedAt:""};
  const result=analyzeSourceMismatchRepair({reviews:[row],attempts:[source],problems:[problem("WB-6-S-01")],aliases:[],relations:[relation]});
  assert.equal(result.invalidLegacyCardsToSupersedeCount,1);
  assert.equal(result.actions[0].action,"supersede");
  assert.equal(result.actions[0].patch.exclude_from_planning,true);
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

test("a verified master link superseded by the old origin policy is recoverable",()=>{
  const sourceProblem={...problem("WB-2-S-06"),master_version:"v7",related_s_problem_ids:["WB-2-S-07"]};
  const targetProblem=problem("WB-2-S-07"),source=attempt(52,"WB-2-S-06",["N"]);
  const row=review({id:115,problem_id:"WB-2-S-07",generated_from_attempt_id:52,source_attempt_id:undefined,
    source_problem_id:"WB-2-S-06",status:"superseded",exclude_from_planning:true,
    superseded_by_policy_version:"STAT1-ORIGIN-v1",superseded_reason:"verified relation missing"});
  const result=analyzeSourceMismatchRepair({reviews:[row],attempts:[source],problems:[sourceProblem,targetProblem],aliases:[],relations:[]});
  assert.equal(result.pendingVerifiedLinkNeedsMigrationCount,1);
  assert.equal(result.actions[0].action,"migrate_verified");
  assert.equal(result.actions[0].patch.status,"pending");
  assert.equal(result.actions[0].patch.exclude_from_planning,false);
  assert.equal(result.actions[0].patch.relation_id,"master:v7:WB-2-S-06:WB-2-S-07:remediation");
  const migrated={...row,...result.actions[0].patch};
  const after=analyzeSourceMismatchRepair({reviews:[migrated],attempts:[source],problems:[sourceProblem,targetProblem],aliases:[],relations:[]});
  assert.equal(after.activeSourceMismatchCount,0);
  assert.equal(after.actions.length,0);
});
