import test from "node:test";
import assert from "node:assert/strict";
import {summarizeReviewPortfolio} from "../src/reviewPortfolio.ts";

const contract=(id,problemId)=>({
  contractId:`review:${id}:1`,contractVersion:"STAT1-CONTRACT-v2",contractHash:`hash-${id}`,
  createdAt:"2026-07-01T00:00:00Z",problemId,sourceAttemptId:id,
  learningPurpose:"retrieval_check",learningStage:"maintenance",mode:"check",reviewScope:"check_only",
  targetedParts:[],gradedParts:[{id:`part-${id}`,label:"注意点",cueLabel:"注意点",
    allowedErrorTypes:["N","C","none"],completionCriterionId:"recall"}],
  explicitlyOutOfScopePartIds:[],explicitlyOutOfScopeParts:[],
  completionCriteria:[{id:"recall",displayText:"短く想起"}],hiddenAnswerKey:[],
  completionConditions:["短く想起"],requiredEvidence:["注意点"],allowedErrorTypes:["N","C"],
  requiresKEvidence:false,allowedReferenceLevel:0,estimatedMinutes:5,sheetType:"check_sheet"
});
const review=(id,due,patch={})=>{
  const problemId=`WB-4-A-${String(id).padStart(2,"0")}`,gradingContract=contract(id,problemId);
  return {id,problem_id:problemId,due_date:due,review_type:"light_check",status:"pending",
    generated_from_attempt_id:id,source_attempt_id:id,source_date:"2026-07-01",review_after_days:2,
    schedule_origin:"policy",policy_version:"STAT1-CONTRACT-v2",learning_purpose:"retrieval_check",
    assessment_timing:"delayed_retrieval",effective_mode:"check",review_scope:"check_only",
    sheet_type:"check_sheet",graded_part_ids:[`part-${id}`],grading_contract:gradingContract,
    contract_id:gradingContract.contractId,contract_version:gradingContract.contractVersion,
    contract_hash:gradingContract.contractHash,...patch};
};

test("23件を期限区分へ分け、無効カードをactive pendingへ含めない",()=>{
  const reviews=[
    ...[1,2,3].map(id=>review(id,"2026-07-31")),
    ...[4,5].map(id=>review(id,"2026-08-01")),
    ...Array.from({length:7},(_,index)=>review(6+index,`2026-08-0${index+2}`)),
    ...Array.from({length:11},(_,index)=>review(13+index,"2026-08-09")),
    review(90,"2026-08-01",{policy_validity:"invalid_legacy_k",exclude_from_planning:true}),
  ];
  const attempts=Array.from({length:100},(_,index)=>({id:index+1,problem_id:`WB-4-A-${String(index+1).padStart(2,"0")}`,
    date:"2026-07-01",mode:"check",time_minutes:5,mark:"○",score_label:"A",error_type:"none",error_point:"",next_action:""}));
  const result=summarizeReviewPortfolio({reviews,attempts,today:"2026-08-01"});
  assert.equal(result.actionable,23);
  assert.equal(result.overdue,3);
  assert.equal(result.dueToday,2);
  assert.equal(result.next7Days,7);
  assert.equal(result.later,11);
  assert.equal(result.inactivePending,1);
});

test("直近7日の完了・次回生成・差引とactive論理重複を分けて集計する",()=>{
  const source=review(1,"2026-07-28",{status:"done",completed_at:"2026-07-30T15:30:00.000Z"});
  const successor=review(2,"2026-08-03",{generated_from_attempt_id:50,source_attempt_id:50,
    generated_at:"2026-07-31T15:30:00.000Z"});
  const attempt={id:50,problem_id:source.problem_id,date:"2026-07-31",mode:"check",time_minutes:5,
    mark:"○",score_label:"A",error_type:"none",error_point:"",next_action:"",generated_from_review_id:1};
  const duplicate={...successor,id:3,contract_id:"review:3:1",grading_contract:{...successor.grading_contract,contractId:"review:3:1"}};
  const result=summarizeReviewPortfolio({reviews:[source,successor,duplicate],attempts:[attempt],today:"2026-08-01"});
  assert.equal(result.completedLast7Days,1);
  assert.equal(result.generatedLast7Days,2);
  assert.equal(result.completedWithSuccessorLast7Days,1);
  assert.equal(result.netChangeLast7Days,1);
  assert.equal(result.activeDuplicateLogicalKeys,1);
});
