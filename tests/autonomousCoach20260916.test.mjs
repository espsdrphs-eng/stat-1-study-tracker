import test from "node:test";
import assert from "node:assert/strict";
import {reconcilePastExamSessionEvidence} from "../src/pastExamPlanning.ts";
import {calculateExamReadinessMetrics} from "../src/examReadiness.ts";
import {normalizeCoachUpdate} from "../src/coachDiagnosis.ts";
import {deriveDashboardKpis} from "../src/dashboardKpi.ts";
import {attempt,problem} from "./adaptiveFixture.mjs";
import {scanMetrics,selectionSuccessRate,validatePastExamSession} from "../src/pastExamWorkflow.ts";
import {runIntegrityAudit} from "../src/integrityEngine.ts";

// Minimal, non-private reproduction of the 9/16 export: a blank manual override
// hides an already linked graded answer, although the session says completed.
export function septemberSession(){
  const scores=[50,24,55,52,22],selected=[1,3,4];
  const attempts=scores.map((score,i)=>attempt(263+i,`PY-2021-Q${i+1}`,i===0?"2026-09-14":"2026-09-16",
    {score_numeric:score,time_minutes:selected.includes(i+1)?35:15,exam_score_eligible:true}));
  const session={id:5,year:2021,date:"2026-09-14",session_kind:"selected_three_timed",session_type:"scan5",
    session_state:"completed",scan_evidence_kind:"clean",scan_minutes:10,prompt_scanned_at:"2026-09-14T04:40:19Z",
    initial_selected_problem_ids:selected.map(i=>`問${i}`),linked_attempt_ids:attempts.map(a=>a.id),
    questions:scores.map((score,i)=>({problemId:`PY-2021-Q${i+1}`,questionLabel:`問${i+1}`,selected:selected.includes(i+1),
      predictedScore:60,actualScore:i===3?null:score,actualScoreSource:i===3?"manual_override":"attempt",
      actualMinutes:selected.includes(i+1)?35:15,completed:selected.includes(i+1)}))};
  return {session,attempts,problems:attempts.map(a=>problem(a.problem_id,null,"past_exam"))};
}
test("blank manual override cannot erase a linked graded outcome; numeric overrides remain explicit",()=>{
  const f=septemberSession(),s=reconcilePastExamSessionEvidence(f.session,f.attempts);
  assert.equal(s.questions[3].actualScore,52);
  assert.equal(s.questions[3].actualScoreSource,"attempt");
  assert.equal(s.session_state,"completed");assert.equal(s.selected_answer_count,3);
  assert.equal(s.selected_solve_minutes,105);assert.equal(s.session_elapsed_minutes,115);
  assert.equal(s.selection_success_count,3);
  f.session.questions[3].actualScore=0;
  assert.equal(reconcilePastExamSessionEvidence(f.session,f.attempts).questions[3].actualScore,0);
});
test("all six capability dimensions carry eligible evidence and do not vanish without transfer",()=>{
  const f=septemberSession(),s=reconcilePastExamSessionEvidence(f.session,f.attempts);
  const r=calculateExamReadinessMetrics({...f,pastSessions:[s],aliases:[],today:"2026-09-16"});
  assert.equal(r.evidence.selectedThree.evidenceCount,1);
  assert.equal(r.evidence.selectedThree.numerator,157);
  for(const key of ["selectedThree","selection","timed","transfer","unseen","repeatedMajor"]){
    const d=r.evidence[key];assert.ok(d,key);assert.ok(Array.isArray(d.eligibleEvidenceIds),key);
    assert.ok("missingEvidenceReason" in d,key);assert.ok("lastUpdatedAt" in d,key);
  }
  const k=deriveDashboardKpis({today:"2026-09-16",updatedAt:"2026-09-16",readiness:r,concepts:[],
    coach:{source:"local_provisional",stale:false,newAttemptCount:0,lastReviewedAt:null,
      display:{level:{value:2,passOutlook:"判定材料不足",confidence:"low"},primaryBottleneck:{title:"測定中"}}},
    daysRemaining:60,phaseLabel:"過去問主軸",pastExamShare:null,pastExamShareTarget:"65〜70%",pendingReviews:0});
  assert.ok(Number.isFinite(k.examReadiness.level));
  assert.match(k.examReadiness.value,/Level/);
  assert.equal(k.examReadiness.confidence,"low");
});
test("coach import preserves a complete outlook longer than the legacy 80 characters",()=>{
  const outlook="複数の本番形式で選択答案の得点化を測定したが、時間内完遂の再現性はまだ十分ではない。".repeat(4);
  const d=normalizeCoachUpdate({schema_version:"stat1-coach-v1",reviewed_at:"2026-09-16",evidence_cutoff_attempt_id:268,
    level:{value:3,pass_outlook:outlook,label:"実戦段階",confidence:"medium",rationale:"実測"},
    primary_bottleneck:{title:"時間内完遂"},next_actions:[],strengths:[],improvements:[],unknowns:[],optional_pass_probability:null});
  assert.equal(d.level.passOutlook,outlook);
});
test("out-of-range scan forecasts are not calibration evidence and cannot be saved again",()=>{
  const f=septemberSession(),s=reconcilePastExamSessionEvidence(f.session,f.attempts);
  s.questions[0].predictedScore=7070;
  assert.ok(validatePastExamSession(s).errors.some(e=>e.includes("0〜100")));
  assert.ok(Math.abs(scanMetrics(s).predictedScoreDifference)<100);
  assert.equal(selectionSuccessRate({...s,scan_evidence_kind:"practice"}),null);
});

test("current audit detects a UI projection that drops a valid selected answer",()=>{
  const f=septemberSession(),canonical=reconcilePastExamSessionEvidence(f.session,f.attempts);
  const stale=structuredClone(canonical);stale.questions[3].actualScore=null;stale.selected_answer_count=2;
  const audit=runIntegrityAudit({...f,reviews:[],pastSessions:[f.session],currentPastSessions:[stale],today:"2026-09-16"});
  assert.ok(audit.issues.some(i=>i.category==="selected_attempt_missing_from_session"&&i.severity==="active"));
  assert.ok(audit.issues.some(i=>i.category==="session_answer_count_mismatch"&&i.severity==="active"));
});

test("an overlong coach outlook fails validation instead of silently truncating",()=>{
  assert.throws(()=>normalizeCoachUpdate({schema_version:"stat1-coach-v1",reviewed_at:"2026-09-16",evidence_cutoff_attempt_id:268,
    level:{value:3,pass_outlook:"長".repeat(16001),label:"実戦",confidence:"medium",rationale:"実測"},
    primary_bottleneck:{title:"時間"},next_actions:[],strengths:[],improvements:[],unknowns:[],optional_pass_probability:null}),
    error=>error.stage==="schema"&&/16000/.test(error.reason));
});
test("stale coach UI describes the displayed objective fallback, not the old diagnosis",async()=>{
  const {readFile}=await import("node:fs/promises");
  const ui=await readFile(new URL("../src/App.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(ui,/前回診断の本番レベル|上記は前回の診断であり/);
  assert.match(ui,/上記は最新の実測からの暫定診断です/);
});

test("PastExam repair details use the same resolved contract as Today and Review",async()=>{
  const {readFile}=await import("node:fs/promises");
  const ui=await readFile(new URL("../src/App.tsx",import.meta.url),"utf8");
  const past=ui.slice(ui.indexOf("function PastView("),ui.indexOf("function AnswerSheetsView("));
  assert.match(past,/resolveReviewCard\(/);
  assert.match(past,/<ReviewPlanDetails item=\{review\} compact resolved=\{reviewCard\}/);
});
