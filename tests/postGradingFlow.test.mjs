import test from 'node:test';
import assert from 'node:assert/strict';
import {postGradingContext} from '../src/postGradingFlow.ts';
const problem={problem_id:'PY-2018-Q5',category:'past_exam',source_type:'past_exam',title:'2018年問5',display_label:'2018年問5'};
const attempt={id:339,problem_id:problem.problem_id,date:'2026-10-24',task_origin:'review_attempt',learning_purpose:'error_repair',mode:'main_calc',score_numeric:30,mark:'×',generated_from_review_id:543,contract_id:'review:543:1',graded_part_ids:['major_calculation'],graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'[3]の分散の最終値に未到達'}],result_summary:'期待値の一部は改善、分散は未完成',error_point:'[3]の主要計算が未完成',next_action:'主要計算を完成する'};
const review={id:543,problem_id:problem.problem_id,status:'done',source_attempt_id:319,generated_from_attempt_id:319,learning_purpose:'error_repair',targeted_parts:['主対象[3]、補助対象[2]'],grading_contract:{contractId:'review:543:1',gradedParts:[{id:'major_calculation',label:'分散の主要計算'}]}};
const base={problems:[problem],attempts:[attempt],reviews:[review],taskAnswerScopeOverrides:[]};
test('a completed repair opens by saved Attempt, without depending on an unfinished Today task',()=>{
 const before=JSON.stringify(base),v=postGradingContext(base,339);assert.equal(v.available,true);assert.equal(v.kind,'補修');assert.match(v.prompt,/"source_attempt_id": 339/);assert.match(v.prompt,/"source_review_id": 543/);assert.match(v.prompt,/分散の主要計算/);assert.match(v.prompt,/"resolved": false/);assert.match(v.prompt,/元得点.*上書き.*しない/);assert.match(v.prompt,/原問題本文はアプリ未登録/);assert.equal(JSON.stringify(base),before);
});
test('first grading and a generated training remain distinct; an opinion cannot assert retention or transfer',()=>{
 const first={...attempt,id:340,task_origin:'first_attempt',learning_purpose:'exam_performance',mode:'full',generated_from_review_id:undefined};
 const v=postGradingContext({...base,attempts:[first]},340);assert.equal(v.kind,'初回採点');assert.match(v.prompt,/説明を理解しただけで自力成功・保持・転移成功にしない/);
 const generated={...first,source_type:'generated',transfer_lineage:{key:'training:fixture'}};assert.equal(postGradingContext({...base,attempts:[generated]},340).kind,'生成訓練');
});
test('later results are explicitly supplied, not silently treated as continued failure',()=>{
 const newer={...attempt,id:340,date:'2026-10-25',result_summary:'新しい部分成功'};
 const v=postGradingContext({...base,attempts:[attempt,newer]},339);assert.equal(v.newerAttemptId,340);assert.match(v.prompt,/"newer_attempt"/);assert.match(v.prompt,/新しい部分成功/);
});
test('unknown, invalidated, superseded, and missing-problem contexts cannot silently fall back to Today',()=>{
 assert.equal(postGradingContext(base,999).available,false);
 for(const patch of [{invalidated_at:'2026-10-24'},{superseded_by_attempt_id:340}])assert.equal(postGradingContext({...base,attempts:[{...attempt,...patch}]},339).available,false);
 assert.equal(postGradingContext({...base,problems:[]},339).available,false);
});
test('out-of-scope and invalid legacy findings are not promoted into repair targets',()=>{
 const a={...attempt,graded_findings:[...attempt.graded_findings,{graded_part_id:'other',resolved:false,error_type:'K',evidence:'OUTSIDE'},{graded_part_id:'major_calculation',resolved:false,error_type:'K',evidence:'INVALID',planning_eligible:false}]};
 const v=postGradingContext({...base,attempts:[a]},339);assert.equal(v.available,true);assert.doesNotMatch(v.prompt,/OUTSIDE|INVALID/);
});
test('legacy repair without a Review never expands an unknown assigned scope to the whole problem',()=>{
 const a={...attempt,generated_from_review_id:undefined,targeted_parts:[],graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'主要計算が未完成（小問番号は未登録）'}]};
 const v=postGradingContext({...base,attempts:[a],reviews:[]},339);assert.equal(v.available,true);assert.match(v.scope,/未特定/);assert.doesNotMatch(v.scope,/問題全体/);
});
