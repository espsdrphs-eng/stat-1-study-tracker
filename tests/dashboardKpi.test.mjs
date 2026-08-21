import test from "node:test";
import assert from "node:assert/strict";
import {deriveDashboardKpis} from "../src/dashboardKpi.ts";

const readiness=(overrides={})=>({unseenScoreRate:null,timedCompletionRate:null,selectionSuccessRate:null,
  pastExamScoreRate:null,kRecurrenceRate:null,repeatedWRate:null,typeIdentificationAccuracy:null,
  firstStepAccuracy:null,predictedScoreCalibration:null,predictedTimeCalibration:null,
  sampleSizes:{unseen:0,timed:0,scans:0,pastExams:0,kReviews:0,wReviews:0},...overrides});
const coach=(title="制約追跡",stale=false)=>({display:{level:{value:3.5,passOutlook:"境界圏",confidence:"medium"},
  primaryBottleneck:{title}},source:"gpt",stale,newAttemptCount:stale?5:0,lastReviewedAt:"2026-08-20T10:00:00+09:00"});
const base=(extra={})=>({today:"2026-08-22",updatedAt:"2026-08-22T10:00:00+09:00",coach:coach(),readiness:readiness(),
  concepts:[],currentTask:{problem_id:"WB-4-A-24",title:"第4章A問24",kind:"復習",mode:"check",minutes:7,reason:"遅延Review"},
  daysRemaining:85,phaseLabel:"A問題＋過去問並行",pastExamShare:0.3,pastExamShareTarget:"30〜40%",pendingReviews:19,...extra});

test("fresh coach保存後は合格圏と最大ボトルネックを同じprojectionへ反映する",()=>{
  const before=deriveDashboardKpis(base({coach:coach("旧ボトルネック")}));
  const after=deriveDashboardKpis(base({coach:coach("新ボトルネック")}));
  assert.equal(before.bottleneck.value,"旧ボトルネック");
  assert.equal(after.bottleneck.value,"新ボトルネック");
  assert.equal(after.passZone.value,"境界圏");
  assert.equal(after.nextAction.problemId,"WB-4-A-24");
});

test("古いcoachより十分なtimed客観deficitを優先し、n=1では断定しない",()=>{
  const one=deriveDashboardKpis(base({coach:coach("軽微な概念",true),readiness:readiness({timedCompletionRate:22,
    sampleSizes:{unseen:0,timed:1,scans:0,pastExams:0,kReviews:0,wReviews:0}})}));
  assert.notEqual(one.bottleneck.value,"時間内完走の再現性");
  const enough=deriveDashboardKpis(base({coach:coach("古い診断",true),readiness:readiness({timedCompletionRate:22,
    sampleSizes:{unseen:0,timed:3,scans:0,pastExams:0,kReviews:0,wReviews:0}})}));
  assert.equal(enough.bottleneck.value,"時間内完走の再現性");
  assert.equal(enough.bottleneck.source,"timed_evidence");
});

test("本番証拠0件は0%ではなく測定中・判定材料不足になる",()=>{
  const result=deriveDashboardKpis(base({coach:{...coach(),source:"local_provisional"}}));
  assert.equal(result.examReadiness.value,"測定中");
  assert.equal(result.passZone.value,"判定材料不足");
  assert.match(result.examReadiness.detail,/未計測/);
});
