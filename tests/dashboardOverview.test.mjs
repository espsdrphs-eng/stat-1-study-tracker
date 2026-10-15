import test from 'node:test';import assert from 'node:assert/strict';
import * as coach from '../src/coachDiagnosis.ts';
import {learningTargetLabel} from '../src/learningFeedback.ts';
const overview=()=>import('../src/learningOverview.ts');
const data=()=>({attempts:[],reviews:[],problems:[],problemAliases:[],masteryByProblem:{},
 coach:{current:null,stale:false},dashboard:{today:'2026-10-15',kpis:{support:{daysRemaining:31},assessment:{level:2.5,passJudgement:'ボーダー手前'},bottleneck:{value:'時間内完走の再現性'}},
 readiness:{evidence:{selectedThree:{value:52,evidenceCount:5,lastUpdated:'2026-10-01'},timed:{value:20,evidenceCount:5,lastUpdated:'2026-10-01'},transfer:{value:0,statusCounts:{attempted:2,successful:0,failed:2,uncertain:0,unattempted:6}}}}},
 today:{tasks:[],canonicalStudyPlan:{ranked:{eligible:[],waiting:[]}}}});
test('compact dashboard has three distinct measured metrics, unknown is not zero and Level is not probability',async()=>{
 const {deriveLearningOverview}=await overview(),d=data(),copy=JSON.stringify(d),v=deriveLearningOverview(d);
 assert.equal(v.level,2.5);assert.equal(v.metrics.length,3);assert.deepEqual(v.metrics.map(x=>x.value),[52,20,0]);
 d.dashboard.readiness.evidence.transfer.statusCounts.attempted=0;assert.equal(deriveLearningOverview(d).metrics[2].value,null);
 d.dashboard.readiness.evidence.selectedThree.evidenceCount=0;assert.equal(deriveLearningOverview(d).metrics[0].value,null);
 assert.ok(copy);assert.equal(v.daysRemaining,31);
 assert.equal(learningTargetLabel('answer_conclusion'),'最終結論');assert.equal(learningTargetLabel('unknown_internal_id'),'採点対象の操作');
 const empty=structuredClone(d);empty.dashboard.readiness.evidence={};const unknown=deriveLearningOverview(empty);assert.equal(unknown.level,null);assert.ok(unknown.metrics.every(m=>m.value===null));
});
test('priority repair cards follow eligible Today order, never force waiting or merge distinct task identities',async()=>{
 const {priorityRepairTasks}=await overview(),d=data();d.today.tasks=[
 {problem_id:'PY-A',learning_purpose:'error_repair',ranking:{eligible:true,rank:2}},
 {problem_id:'PY-B',learning_purpose:'error_repair',ranking:{eligible:true,rank:1}},
 {problem_id:'PY-C',learning_purpose:'error_repair',ranking:{eligible:false,rank:0}},
 {problem_id:'GEN-X',learning_purpose:'transfer_check',ranking:{eligible:true,rank:3},transfer_training_key:'training:known'},
 {problem_id:'PY-D',learning_purpose:'error_repair',ranking:{eligible:true,rank:4},checked:true}];
 assert.deepEqual(priorityRepairTasks(d).map(t=>t.problem_id),['PY-B','PY-A']);
});
test('manual reassessment binds exact evidence context and detects same-ID edits and changed measurements',()=>{
 assert.equal(typeof coach.coachReviewContext,'function');const d=data();
 d.attempts=[{id:1,problem_id:'PY-A',score_numeric:45}];const context=coach.coachReviewContext(d);
 assert.notEqual(coach.coachReviewContext({...d,attempts:[{...d.attempts[0],score_numeric:90}]}).version,context.version);
 const changed=structuredClone(d);changed.dashboard.readiness.evidence.timed.value=40;
 assert.notEqual(coach.coachReviewContext(changed).version,context.version);
 assert.ok(context.evidenceIds.includes('attempt:1'));
});
