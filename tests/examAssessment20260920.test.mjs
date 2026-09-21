import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCoachDiagnosisState} from '../src/coachDiagnosis.ts';
import {deriveDashboardKpis} from '../src/dashboardKpi.ts';
import {runIntegrityAudit} from '../src/integrityEngine.ts';
import {deriveExamReadinessAssessment} from '../src/examCapability.ts';

// Minimal, anonymized projection of the 9/20 export. No problem-specific branches.
const metric=(value,numerator,denominator)=>({value,numerator,denominator,evidenceCount:3,
  eligibleEvidenceIds:['session:a','session:b','session:c'],confidence:'medium',
  lastUpdatedAt:'2026-09-16',lastUpdated:'2026-09-16',eligibleEvidenceRule:'selected sessions',modeScope:['selected_three_timed']});
export const readiness={pastExamScoreRate:54,unseenScoreRate:57,timedCompletionRate:33,selectionSuccessRate:100,
  sampleSizes:{pastExams:3,unseen:13,timed:3,scans:3},evidence:{
    selectedThree:{...metric(54,486,9),sessions:[]},individual:metric(66.75,267,4),
    selection:metric(100,3,3),timed:metric(100/3,1,3),transfer:{...metric(0,0,8),evidenceCount:8}}};
const stored={reviewedAt:'2026-09-20',evidenceCutoffAttemptId:1,level:{value:3,label:'GPT proposed level',
  passOutlook:'保存済みGPTの見通しは履歴へ保持する。',confidence:'high',rationale:'GPT rationale'},
  primaryBottleneck:{title:'時間内完遂'},nextActions:[],strengths:[],improvements:[],unknowns:[]};
export function currentProjections(){
  const coach=buildCoachDiagnosisState({history:[stored],attempts:[{id:1}],concepts:[],
    dashboard:{readiness,weaknessInsights:[]},reviews:[],problems:[],
    planner:{phase:'past_exam_main',daysRemaining:56,weeklyActual:{},weeklyTarget:{}},today:'2026-09-20'});
  const kpis=deriveDashboardKpis({today:'2026-09-20',updatedAt:'2026-09-20T03:00:00Z',coach,readiness,concepts:[],
    daysRemaining:56,phaseLabel:'過去問主軸＋弱点補修',pastExamShare:.67,pastExamShareTarget:'65〜70%',pendingReviews:8});
  return {coach,kpis};
}
test('fresh GPT cannot fork current readiness away from Dashboard (9/20 regression)',()=>{
  const {coach,kpis}=currentProjections();
  assert.equal(coach.display.level.value,kpis.examReadiness.level);
  assert.equal(coach.display.level.confidence,kpis.examReadiness.confidence);
  assert.equal(coach.display.level.passOutlook,kpis.passZone.detail);
  assert.equal(coach.current.level.value,3,'raw GPT history remains unchanged');
});
test('audit catches readiness level, metric and mastery label divergence, including fresh GPT',()=>{
  const {coach,kpis}=currentProjections();
  const base={today:'2026-09-20',attempts:[],reviews:[],problems:[],currentReadiness:readiness,currentCoach:coach,currentKpis:kpis};
  assert.equal(runIntegrityAudit(base).blockingIntegrityIssueCount,0);
  const bad=structuredClone(base);
  bad.currentCoach.display.level.value=4;
  bad.currentKpis.assessment.selectionAccuracy={...bad.currentKpis.assessment.selectionAccuracy,denominator:9};
  bad.assessmentLabels={exam:'本番対応力',problem:'本番対応力'};
  const audit=runIntegrityAudit(bad),categories=audit.issues.map(i=>i.category);
  for(const key of ['exam_readiness_level_projection_mismatch','exam_readiness_kpi_projection_mismatch','problem_mastery_exam_level_label_collision'])assert.ok(categories.includes(key),key);
  assert.ok(audit.blockingIntegrityIssueCount>=3);
});
test('canonical assessment version depends on evidence, not generatedAt; metrics keep provenance',()=>{
  const a=deriveExamReadinessAssessment(readiness,'2026-09-20'),b=deriveExamReadinessAssessment(readiness,'2026-09-21');
  assert.equal(a.sourceStateVersion,b.sourceStateVersion);
  assert.deepEqual(a.selectedThreeScore,readiness.evidence.selectedThree);
  assert.equal(a.transfer.numerator,0);assert.equal(a.level,2.5);
  const changed=structuredClone(readiness);changed.evidence.timed.numerator=2;
  assert.notEqual(a.sourceStateVersion,deriveExamReadinessAssessment(changed,'2026-09-20').sourceStateVersion);
});
test('pass judgement retains timing requirement even with a strong selected-three score',()=>{
  const input=structuredClone(readiness);
  input.evidence.selectedThree.value=80;input.pastExamScoreRate=80;input.timedCompletionRate=50;
  assert.notEqual(deriveExamReadinessAssessment(input,'2026-09-20').passJudgement,'合格圏');
});
