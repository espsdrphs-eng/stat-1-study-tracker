import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTransferEvidence,successfulSkillIds,rootProgress} from '../src/skillEvidence.ts';
import {deriveFailureEpisode} from '../src/failureEpisode.ts';
import {analyzeReviewReconciliation} from '../src/reviewReconciliation.ts';
import {calculateExamReadinessMetrics} from '../src/examReadiness.ts';

const skill='maximum_likelihood';
const part=(pid,id,skills=[])=>({id,label:id,cueLabel:id,completionCriterionId:`criterion:${id}`,
 stableTargetKey:`target:${pid}:slot:${id}`,masteryLevel:id==='first_step'?1:2,rootSkillIds:skills});
const finding=(id,error,evidence)=>({graded_part_id:id,error_type:error,resolved:error==='none',evidence});
const source=(id,pid)=>({id,problem_id:pid,date:'2026-10-13',mode:'main_calc',source_type:'past_exam',
 score_numeric:65,error_type:'W',error_types:['W'],learning_purpose:'error_repair',
 actual_reference_level:0,hint_used:false,grading_confidence:.95,assessment_timing:'delayed_retrieval',
 grading_contract:{problemId:pid,gradedParts:[part(pid,'major_calculation',[skill])]},
 graded_findings:[finding('major_calculation','W','対数尤度の微分から最尤推定量を求める主要計算が未完成。')]});
// Minimal structural replay of the actual #334 findings; no original records are edited.
const destination=()=>({id:334,problem_id:'PY-2024-Q1',date:'2026-10-16',mode:'full',source_type:'past_exam',
 score_numeric:55,error_type:'W',error_types:['W','N'],learning_purpose:'exam_performance',
 actual_reference_level:0,reference_level:0,hint_used:false,grading_confidence:.95,assessment_timing:'independent_performance',
 grading_contract:{problemId:'PY-2024-Q1',gradedParts:['first_step','major_calculation','answer_conclusion'].map(id=>part('PY-2024-Q1',id))},
 graded_findings:[
  finding('first_step','none','[1]で対数尤度を立て、[2]で score を sum x_i(y_i-beta x_i)/sigma^2 とし、[3]で2階微分、[4]で Y_iはbeta x_i+epsilon_i を代入する入口はいずれも適切。'),
  finding('major_calculation','W','[2]で score equation から最尤推定量を誤って解いている。[4]の分散も正しくない。'),
  finding('answer_conclusion','W','[2]の最尤推定量、[4]の分散が正答に到達していない。')
 ]});
const repairedDestination=()=>{const d=destination();return {...d,error_types:['none'],error_type:'none',
 grading_contract:{...d.grading_contract,gradedParts:[part(d.problem_id,'major_calculation',[skill])]},
 graded_findings:[finding('major_calculation','none','対数尤度を微分し最尤推定量と分散を自力で正しく求めた。')]};};

test('actual #334 pattern: first-step success with unclassified major failures is not whole-skill success',()=>{
 const d=destination(),before=structuredClone(d);
 assert.deepEqual(successfulSkillIds(d),[]);
 assert.deepEqual(d,before);
});
test('actual #330/#331 -> #334 pattern cannot produce two successful transfers',()=>{
 const rows=[source(330,'PY-2022-Q4'),source(331,'PY-2018-Q3'),destination()];
 assert.deepEqual(deriveTransferEvidence(rows),[]);
});
test('a source major-calculation failure is not covered by a destination first-step-only success',()=>{
 const d=destination();d.graded_findings=d.graded_findings.slice(0,1);d.grading_contract.gradedParts=d.grading_contract.gradedParts.slice(0,1);
 assert.deepEqual(deriveTransferEvidence([source(330,'PY-2022-Q4'),d]),[]);
});
test('a local first-step retry does not complete the source major-calculation repair',()=>{
 const s=source(330,'PY-2022-Q4'),d=destination();d.id=332;d.problem_id=s.problem_id;d.learning_purpose='error_repair';
 d.graded_findings=d.graded_findings.slice(0,1);d.grading_contract.gradedParts=[part(s.problem_id,'first_step',[skill])];
 const root=deriveFailureEpisode(s).rootWeaknesses[0];
 assert.equal(rootProgress(s,root,[s,d]).repairSuccess,undefined);
});
test('a positive first step cannot remove the major-calculation slot from Review555/556',()=>{
 const sources=[source(330,'PY-2022-Q4'),source(331,'PY-2018-Q3')];
 const reviews=sources.map((a,i)=>({id:555+i,problem_id:a.problem_id,status:'pending',due_date:'2026-10-20',
  source_attempt_id:a.id,generated_from_attempt_id:a.id,learning_purpose:'error_repair',grading_contract:a.grading_contract}));
 const report=analyzeReviewReconciliation({attempts:[...sources,destination()],reviews,today:'2026-10-20'});
 for(const s of sources)assert.ok(report.problems.find(p=>p.problemId===s.problem_id).desiredRepairParts.some(p=>p.id==='major_calculation'));
});
test('root progress does not promote an unrelated positive finding into transfer',()=>{
 const s=source(330,'PY-2022-Q4'),root=deriveFailureEpisode(s).rootWeaknesses[0];
 assert.equal(rootProgress(s,root,[s,destination()]).transfer,undefined);
});
test('confirmed matching calculation success is retained, even with a separately mapped other-skill failure',()=>{
 const s=source(330,'PY-2022-Q4'),d=repairedDestination();
 d.grading_contract.gradedParts.push(part(d.problem_id,'other_operation',['a_different_explicit_operation']));
 d.graded_findings.push(finding('other_operation','W','別の操作は未完成。'));
 const rows=deriveTransferEvidence([s,d]);
 assert.equal(rows.length,1);assert.equal(rows[0].successAttemptId,334);
 assert.deepEqual(rows[0].sourceFindingIds,['major_calculation']);
 assert.equal(successfulSkillIds(d).includes(skill),true);
});
test('successful repair, same-problem retention, assisted and generated training never become natural exam evidence',()=>{
 const s=source(330,'PY-2022-Q4');
 for(const patch of [{problem_id:s.problem_id},{actual_reference_level:3,hint_used:true},{learning_purpose:'error_repair'}]){
  assert.deepEqual(deriveTransferEvidence([s,{...repairedDestination(),...patch}]),[]);
 }
 const generated={...repairedDestination(),source_type:'generated',problem_id:'GEN-fixture',evidence_strength:'training'};
 assert.ok(deriveTransferEvidence([s,generated]).every(e=>e.evidenceStrength!=='strong'));
});
test('partial destination evidence is pending, not a proven failure or successful natural transfer',()=>{
 const rows=[source(330,'PY-2022-Q4'),source(331,'PY-2018-Q3'),destination()];
 const e=calculateExamReadinessMetrics({attempts:rows,problems:[],pastSessions:[],aliases:[],today:'2026-10-20'}).evidence.transfer;
 assert.equal(e.statusCounts.successful,0);assert.equal(e.statusCounts.failed,0);assert.equal(e.statusCounts.uncertain,2);
 assert.equal(e.evidenceCount,0);assert.equal(e.assessmentWarnings.length,2);
});

test('a later explicitly assessed same-skill failure supersedes the earlier partial evidence, not the historical answers',()=>{
 const rows=[source(330,'PY-2022-Q4'),source(331,'PY-2018-Q3'),destination()];
 const newer={...destination(),id:336,problem_id:'PY-2024-Q3',
  grading_contract:{problemId:'PY-2024-Q3',gradedParts:[part('PY-2024-Q3','first_step',[skill])]},
  graded_findings:[finding('first_step','W','尤度を構成できず、その後の対数尤度・微分も誤っている。')]};
 const before=structuredClone(rows);rows.push(newer);
 const e=calculateExamReadinessMetrics({attempts:rows,problems:[],pastSessions:[],aliases:[],today:'2026-10-20'}).evidence.transfer;
 assert.equal(e.statusCounts.successful,0);assert.equal(e.statusCounts.failed,2);assert.equal(e.statusCounts.uncertain,0);
 assert.deepEqual(rows.slice(0,3),before);
});
