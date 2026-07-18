import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import JSZip from "jszip";

const { diagnosticAuditInternals,createDiagnosticPack }=await import("../src/diagnosticPack.ts");
const { localGet,db }=await import("../src/localDb.ts");

const provenance={problemId:"WB-6-A-20",attemptId:401,masterVersion:"master-v1",generatedAt:"2026-07-18T00:00:00.000Z"};
const baseCard={
  taskId:"175",problemId:"WB-6-A-20",canonicalProblemId:"WB-6-A-20",displayLabel:"第6章A問20",
  theme:"回帰・分散分解",canonicalProblemType:"回帰モデルの推定",taskOrigin:"review_attempt",
  errorTypes:["N"],primaryErrorType:"N",inferredMode:"skeleton",effectiveMode:"skeleton",
  reviewMethodLabel:"骨格確認",sheetType:"skeleton_sheet",sheetLabel:"骨格答案シート",estimatedMinutes:15,
  reviewGoal:{value:"省略した説明だけ補う",provenance},correctionTheme:{value:"分散分解の説明を補う",provenance},
  entryHint:{value:"残差平方和から始める",provenance},oneLineHint:{value:"対象式を書いて説明を補う",provenance},
  todayActions:{value:["不足した説明だけ再現する"],provenance},
  completionConditions:{value:["不足した説明を白紙で再現した"],provenance},
  dueDate:"2026-07-20",reviewAfterDays:2,daysUntilDue:2,consistencyWarnings:[],reviewNeeded:false,
  targetAttempt:{id:401,problem_id:"WB-6-A-20",date:"2026-07-18",mode:"skeleton",time_minutes:15,mark:"△",
    score_label:"B",error_type:"N",error_types:["N"],primary_error_type:"N",error_point:"分散分解の説明を省略",
    next_action:"不足した説明だけを書く",memo:""}
};

test("局所補修なのに骨格全項目を要求するプロンプトを検出する",()=>{
  const review={id:175,problem_id:"WB-6-A-20",due_date:"2026-07-20",review_type:"skeleton",status:"pending",
    generated_from_attempt_id:401,interval_days:2,review_method:"骨格確認",review_instruction:"不足した説明だけ補う",
    review_steps:["不足した説明を書く"],effective_mode:"skeleton",sheet_type:"skeleton_sheet"};
  const audit=diagnosticAuditInternals.buildPromptAudit(review,baseCard);
  assert.equal(audit.reviewScope,"targeted_patch");
  assert.equal(audit.generatedPromptGradingScope,"full_skeleton");
  assert.ok(audit.mismatchWarnings.some(item=>item.code==="targeted_patch_requires_full_skeleton"));
  assert.ok(audit.mismatchWarnings.some(item=>item.code==="out_of_scope_blank_can_be_k"));
});

test("modeと保存済みシートの不一致を監査する",()=>{
  const review={id:176,problem_id:"WB-6-A-20",due_date:"2026-07-20",review_type:"skeleton",status:"pending",
    generated_from_attempt_id:401,interval_days:2,effective_mode:"skeleton",sheet_type:"check_sheet"};
  const audit=diagnosticAuditInternals.buildPromptAudit(review,baseCard);
  assert.equal(audit.sheetType,"skeleton_sheet");
  assert.ok(audit.mismatchWarnings.some(item=>item.code==="mode_sheet_mismatch"));
});

test("安定化文字列はオブジェクトのキー順に依存しない",()=>{
  assert.equal(diagnosticAuditInternals.stableStringify({b:2,a:{d:4,c:3}}),diagnosticAuditInternals.stableStringify({a:{c:3,d:4},b:2}));
});

test("診断ZIPは実データを変更せず7ファイルを書き出す",async()=>{
  await localGet("/api/bootstrap");
  const before={attempts:await db.attempts.count(),reviews:await db.reviews.count(),snapshots:await db.meta.where("key").startsWith("today-plan-snapshot:").toArray()};
  const result=await createDiagnosticPack();
  assert.equal(result.summary.readOnlyVerified,true);
  const zip=await JSZip.loadAsync(await result.blob.arrayBuffer());
  for(const name of ["app-info.json","db-schema.json","learning-data.json","consistency-report.json","prompt-audit.json","planner-audit.json","test-report.txt"]){
    assert.ok(zip.file(name),`${name} should exist`);
  }
  assert.equal(Object.keys(zip.files).some(name=>/pdf|image/i.test(name)),false);
  const appInfo=JSON.parse(await zip.file("app-info.json").async("string"));
  assert.equal(appInfo.readOnlyVerification.verified,true);
  const after={attempts:await db.attempts.count(),reviews:await db.reviews.count(),snapshots:await db.meta.where("key").startsWith("today-plan-snapshot:").toArray()};
  assert.deepEqual(after,before);
});
