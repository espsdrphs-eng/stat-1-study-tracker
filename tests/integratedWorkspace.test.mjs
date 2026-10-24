import test from 'node:test';
import assert from 'node:assert/strict';
import * as workspace from '../src/studyWorkspace.ts';
import {readFile} from 'node:fs/promises';

test('four primary areas retain the other learning tools as secondary destinations',()=>{
 assert.deepEqual(workspace.studyScreens.map(s=>s.key),['dashboard','problems','weak','transfer']);
});
test('quality adoption before the paper answer never renders the validator solution evidence',async()=>{
 const text=await readFile('src/TransferTrainingPanel.tsx','utf8'),section=text.slice(text.indexOf('aria-label="登録前の品質確認"'),text.indexOf('{view.status==="pending"'));
 assert.ok(section.includes('答案後'));assert.doesNotMatch(section,/\{c\.evidence\}/);
});
test('home evidence counts problem states, never raw unresolved notes or draft creation as mastery',()=>{
 assert.equal(typeof workspace.deriveHomeEvidence,'function');
 const d={problems:[{problem_id:'PY-2024-Q1',theme:'確率分布',source_type:'past_exam',category:'past_exam'}],attempts:[],reviews:[],weakNotes:Array.from({length:704},(_,id)=>({id,is_resolved:0,error_type:'N'})),problemAliases:[],masteryByProblem:{},dashboard:{today:'2026-10-24'},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 const before=JSON.stringify(d),v=workspace.deriveHomeEvidence(d);
 assert.equal(v.problems.length,1);assert.equal(v.counts.unknown,1);assert.equal(v.counts.retained,0);
 assert.equal(v.learned,0);assert.equal(v.abilities.confirmed,null);assert.equal(v.legacyNotes.total,704);
 assert.equal(JSON.stringify(d),before);
});
test('an old graduation mark is retained as history, not promoted to documented delayed reproduction',()=>{
 const p={problem_id:'PY-legacy-Q1',source_type:'past_exam',category:'past_exam'},a={id:1,problem_id:p.problem_id,date:'2026-08-01',mark:'◎',score_numeric:100};
 const d={problems:[p],attempts:[a],reviews:[],weakNotes:[],problemAliases:[],masteryByProblem:{[p.problem_id]:{normalReviewComplete:true,levels:[{status:'retained'}]}},dashboard:{today:'2026-10-24'},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 const before=JSON.stringify(d),v=workspace.deriveHomeEvidence(d);
 assert.equal(v.counts.retained,0);assert.doesNotMatch(v.problems[0].view.retentionLabel,/保持確認済み/);
 assert.equal(JSON.stringify(d),before);assert.equal(d.attempts[0].mark,'◎');
});
test('a delayed flag cannot turn a same-day reproduction after assisted work into spaced retention',()=>{
 const p={problem_id:'WB-fixture',source_type:'whitebook',category:'A'},first={id:1,problem_id:p.problem_id,date:'2026-08-05',mark:'○',actual_reference_level:1,hint_used:true},second={id:2,problem_id:p.problem_id,date:first.date,mark:'◎',actual_reference_level:0,hint_used:false,grading_confidence:.99,learning_purpose:'retrieval_check',assessment_timing:'delayed_retrieval',grading_contract:{sourceAttemptId:1,gradedParts:[]}};
 const d={problems:[p],attempts:[first,second],reviews:[],weakNotes:[],problemAliases:[],masteryByProblem:{[p.problem_id]:{normalReviewComplete:true,levels:[{status:'retained',retainedTargetCount:1}]}},dashboard:{today:'2026-10-24'},today:{tasks:[],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 const v=workspace.deriveHomeEvidence(d);assert.equal(v.counts.retained,0);assert.doesNotMatch(v.problems[0].view.retentionLabel,/保持確認済み/);
});
