import test from "node:test";
import assert from "node:assert/strict";
import {
  auditLegacyReviewContracts, buildGradingContractSnapshot, buildProblemContextPack,
  contractDifferences, taskFieldsFromContract, validateGradingContract,
} from "../src/gradingContract.ts";
import { buildReviewGradingPrompt } from "../src/gradingPrompt.ts";
import { parseStudyText } from "../src/importParser.ts";

const problem={id:1,problem_id:"WB-6-A-23",display_label:"第6章A問23",title:"第6章A問23",source_type:"whitebook",category:"A",
  chapter:6,problem_number:23,theme:"Pitman推定量",priority:"A",role:"training",recommended_mode:"check",linked_past_exams:"",
  linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",canonical_problem_type:"位置母数のPitman推定",
  canonical_keywords:["位置変換","Pitman推定量"],metadata_status:"ok",master_version:"fixture-v1"};
const attempt35={id:35,problem_id:"WB-6-A-23",date:"2026-07-01",mode:"full",time_minutes:30,mark:"◎",score_label:"A",memo:"",
  error_type:"none",primary_error_type:"none",error_types:["none"],score_numeric:90,error_point:"",next_action:"",
  target_issue_resolved:true,minimum_pass_condition_met:true,
  required_work_shown:["位置変換", "正規分布の平方完成", "一様分布の指示関数の共通区間化"]};
const review87={id:87,problem_id:"WB-6-A-23",due_date:"2026-07-22",review_type:"light_check",status:"pending",generated_from_attempt_id:35,
  duration_minutes:5,inferred_mode:"check",effective_mode:"skeleton",sheet_type:"skeleton_sheet",estimated_minutes:13,
  learning_purpose:"integration_check",review_scope:"full_skeleton",targeted_parts:[...attempt35.required_work_shown]};

test("Review 87 is hydrated as immutable retrieval_check contract",()=>{
  const result=buildGradingContractSnapshot({review:review87,problem,sourceAttempt:attempt35,createdAt:"2026-07-22T00:00:00.000Z"});
  const contract=result.contract;
  assert.equal(result.needsReview,false);
  assert.equal(contract.learningPurpose,"retrieval_check");
  assert.equal(contract.learningStage,"maintenance");
  assert.equal(contract.mode,"check");
  assert.equal(contract.reviewScope,"check_only");
  assert.equal(contract.sheetType,"check_sheet");
  assert.equal(contract.estimatedMinutes,5);
  assert.deepEqual(contract.targetedParts,[]);
  assert.equal(contract.explicitlyOutOfScopeParts.some(part=>part.includes("骨格")),true);
  assert.deepEqual(contract.allowedErrorTypes,["W","C"]);
  assert.equal(validateGradingContract(contract).length,0);
  const fields=taskFieldsFromContract(contract);
  assert.equal(fields.effective_mode,"check");
  assert.equal(fields.sheet_type,"check_sheet");
});

test("success evidence never becomes a grading target and prompt uses the same contract hash",()=>{
  const {contract}=buildGradingContractSnapshot({review:review87,problem,sourceAttempt:attempt35,createdAt:"2026-07-22T00:00:00.000Z"});
  const context=buildProblemContextPack({problemId:problem.problem_id,problems:[problem],aliases:[],attempts:[attempt35],reviews:[review87],currentSourceAttemptId:35});
  const prompt=buildReviewGradingPrompt({reviewId:87,problemId:problem.problem_id,date:"2026-07-22",mode:"skeleton",
    gradingContract:contract,problemContext:context});
  assert.match(prompt,new RegExp(contract.contractHash));
  assert.match(prompt,/learning_purpose：retrieval_check/);
  assert.match(prompt,/review_scope：check_only/);
  assert.doesNotMatch(prompt,/正規分布の平方完成/);
  assert.doesNotMatch(prompt,/一様分布の指示関数の共通区間化/);
  assert.match(prompt,/explicitly_out_of_scope_parts/);
  assert.equal(contractDifferences(contract,{contractHash:contract.contractHash,problemId:contract.problemId,
    learningPurpose:contract.learningPurpose,mode:contract.mode,reviewScope:contract.reviewScope,targetKind:contract.targetKind,
    gradedParts:contract.gradedParts}).length,0);
  assert.equal(contractDifferences(contract,{contractHash:"wrong"}).some(row=>row.field==="contractHash"),true);
});

test("impossible retrieval and integration combinations are rejected",()=>{
  const {contract}=buildGradingContractSnapshot({review:review87,problem,sourceAttempt:attempt35});
  assert.ok(validateGradingContract({...contract,mode:"skeleton",sheetType:"skeleton_sheet"}).length>=2);
  assert.ok(validateGradingContract({...contract,learningPurpose:"integration_check",learningStage:"integration",reviewScope:"check_only"}).length>=1);
});

test("GPT YAML preserves the grading contract fields for save-time validation",()=>{
  const {contract}=buildGradingContractSnapshot({review:review87,problem,sourceAttempt:attempt35});
  const parsed=parseStudyText(`study_update:\n  contract_id: "${contract.contractId}"\n  contract_version: "${contract.contractVersion}"\n  contract_hash: "${contract.contractHash}"\n  problem_id: "WB-6-A-23"\n  date: "2026-07-22"\n  mode: "check"\n  time_minutes: 5\n  mark: "△"\n  score_numeric: 80\n  error_types: ["W"]\n  primary_error_type: "W"\n  next_action: "変数変換を直す"\n  review_after_days: 3\n  learning_purpose: "retrieval_check"\n  learning_stage: "maintenance"\n  review_scope: "check_only"\n  graded_parts:\n${contract.gradedParts.map(part=>`    - "${part}"`).join("\n")}\n  rubric_version: "STAT1-REVIEW-v9"`,[problem]);
  assert.equal(parsed.updates[0].contract_hash,contract.contractHash);
  assert.equal(parsed.updates[0].learning_purpose,"retrieval_check");
  assert.equal(parsed.updates[0].review_scope,"check_only");
  assert.deepEqual(parsed.updates[0].graded_parts,contract.gradedParts);
});

test("supplied real-data counts are reproducible without hard-coding production repair",()=>{
  const modeIds=[87,88,98,99,117,118,131,162,175,186,200,212,214,216,220,223,231];
  const lightIds=[87,88,98,99,117,118,131,162];
  const invalidIds=[175,186,200,212,214,216,220];
  const sourceIds=Array.from({length:18},(_,index)=>index+1);
  const derivedIds=Array.from({length:11},(_,index)=>index+1);
  const allIds=[...new Set([...modeIds,...sourceIds])];
  const reviews=allIds.map(id=>({id,problem_id:`WB-6-S-${String(id%30+1).padStart(2,"0")}`,due_date:"2026-07-22",
    review_type:lightIds.includes(id)?"light_check":"retry",status:"pending",generated_from_attempt_id:1000+id,
    source_attempt_id:1000+id,inferred_mode:modeIds.includes(id)?"check":"skeleton",effective_mode:"skeleton",sheet_type:"skeleton_sheet",
    estimated_minutes:lightIds.includes(id)?13:10,policy_validity:invalidIds.includes(id)?"invalid_legacy_k":"valid",
    exclude_from_planning:invalidIds.includes(id)?false:undefined,derived_from_attempt_id:derivedIds.includes(id)?2000+id:1000+id}));
  const attempts=allIds.map(id=>({id:1000+id,problem_id:sourceIds.includes(id)?"WB-6-A-01":reviews.find(row=>row.id===id).problem_id,
    date:"2026-07-01",mode:"check",time_minutes:5,mark:"○",score_label:"A",memo:"",error_type:"none",error_types:["none"],error_point:"",next_action:""}));
  const audit=auditLegacyReviewContracts({reviews,attempts,aliases:[]});
  assert.equal(audit.pending_mode_mismatch,17);
  assert.equal(audit.light_check_mismatch,8);
  assert.equal(audit.invalid_legacy_pending,7);
  assert.equal(audit.source_target_mismatch,18);
  assert.equal(audit.generated_derived_attempt_mismatch,11);
});
