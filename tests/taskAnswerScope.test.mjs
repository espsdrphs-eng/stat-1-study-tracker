import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deriveTaskIntroduction} from '../src/learningFeedback.ts';
import {deriveTaskAnswerScope,appendTaskAnswerScope,validateTaskAnswerScopeOverride,taskAnswerScopeKey} from '../src/taskAnswerScope.ts';

function fixture(action,evidence='[6]が未完成である。'){
 const problem={problem_id:'PY-2000-Q3',source_type:'past_exam',category:'past_exam',title:'2000年 問3'};
 const attempt={id:20,problem_id:problem.problem_id,date:'2026-10-12',next_action:action,graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence}]};
 const task={id:30,problem_id:problem.problem_id,review_type:'main_calc_retry',learning_purpose:'error_repair',source_attempt_id:20,grading_contract:{problemId:problem.problem_id,sourceAttemptId:20,contractHash:'current',learningPurpose:'error_repair',gradedParts:[{id:'major_calculation',label:evidence,currentCorrection:action,evidenceSourceAttemptId:20}],completionCriteria:[]}};
 const data={attempts:[attempt],reviews:[task],problemAliases:[],dashboard:{today:'2026-10-12'},masteryByProblem:{},learningWorkByProblem:{},today:{tasks:[task],canonicalStudyPlan:{ranked:{waiting:[]}}}};
 return {data,problem,task};
}
function scope(action,evidence='主要計算が未完'){const f=fixture(action,evidence);return deriveTaskIntroduction(f.data,f.problem,f.task).answerScope;}

test('current answer scope separates required [6], short [1][3], and reference-only [5]',()=>{
 const f=fixture('[6]を『差を作る→[5]より結論』で白紙再現する。併せて指定確認範囲の[1]の分解式と[3]も短く再現する。');
 const intro=deriveTaskIntroduction(f.data,f.problem,f.task);
 assert.match(intro.subparts,/\[6\]/,'legacy renderer cannot identify bracketed subquestions');
 assert.deepEqual(intro.answerScope.primaryTargetParts,['[6]']);
 assert.deepEqual(intro.answerScope.secondaryTargetParts,['[1]','[3]']);
 assert.deepEqual(intro.answerScope.referenceOnlyParts,['[5]']);
 assert.doesNotMatch(intro.subparts,/差を|分解式|結論/);
});
test('current correction outranks stale targeted_parts and a previously repaired subquestion',()=>{
 assert.deepEqual(scope('[2]を平均→分散の順で白紙再現する。その直後に[3]を再現する。','[1]は正しく修復できたが[2][3]は未再現。').primaryTargetParts,['[2]','[3]']);
 assert.deepEqual(scope('[3]を白紙再現する。その後、[1][2]は係数を落とさず短時間で再確認する。').secondaryTargetParts,['[1]','[2]']);
});
test('valid W evidence within legacy-K-invalid Attempt excludes correct 小問1',()=>{
 const f=fixture('独立条件を確認する。','小問1は正しいが、小問2は誤り、小問3は未完、小問4は未回答。');
 f.data.attempts[0].policy_validity='invalid_legacy_k';
 f.data.attempts[0].graded_findings.push({graded_part_id:'first_step',error_type:'K',validity:'invalid_legacy_k',planning_eligible:false,evidence:'小問1を補修',resolved:false});
 assert.deepEqual(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.primaryTargetParts,['小問2','小問3','小問4']);
});
test('internal grading slots and numeric expressions are not original subquestions',()=>{
 const v=scope('major_calculationを確認する。F(1)とP(X=2)を計算する。','内部採点項目answer_conclusionが未完');
 assert.equal(v.status,'unknown');assert.deepEqual(v.primaryTargetParts,[]);
});
test('a source reference is never promoted to an answer target',()=>{
 const v=scope('[6]で[5]を使って再現する。');
 assert.deepEqual(v.primaryTargetParts,['[6]']);assert.deepEqual(v.referenceOnlyParts,['[5]']);
});
test('problem list stays a five-column table and external paper flow has no answer-editor button',async()=>{
 const src=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
 const list=src.slice(src.indexOf('function ProblemsView'),src.indexOf('function MasteryLevels'));
 assert.match(list,/<table/);assert.match(list,/今回解く箇所/);assert.doesNotMatch(src,/解答作成を開始/);
});

test('canonical grading IDs remain unchanged; outside/reference questions cannot be deducted',()=>{
 const f=fixture('[6]で[5]を使って再現する。'),before=JSON.stringify(f.task);
 const s=deriveTaskAnswerScope({problem:f.problem,task:f.task,attempts:f.data.attempts});
 const prompt=appendTaskAnswerScope('contractHash: current',s);
 assert.match(prompt,/主対象：\[6\]/);assert.match(prompt,/参照のみ（採点対象外）：\[5\]/);
 assert.match(prompt,/未回答として減点しない/);assert.match(prompt,/指定外の小問の成績・解消状態を更新しない/);
 assert.equal(JSON.stringify(f.task),before);assert.equal(f.task.actual_reference_level,undefined);
 assert.throws(()=>appendTaskAnswerScope('prompt',scope('範囲未設定')),/対象小問/);
});
test('manual scope is bound to the Review and contract, not to a problem globally',()=>{
 const f=fixture('指定箇所を確認する','主要計算が未完'),key=taskAnswerScopeKey(f.problem,f.task);
 const value=validateTaskAnswerScopeOverride({scopeKey:key,problemId:f.problem.problem_id,taskIdentity:'review:30',primaryTargetParts:['(3)'],secondaryTargetParts:['(1)'],referenceOnlyParts:['(2)']});
 const overrides={[key]:value};
 assert.equal(deriveTaskAnswerScope({problem:f.problem,task:f.task,attempts:f.data.attempts,overrides}).status,'identified');
 for(const changed of [{...f.task,id:31},{...f.task,grading_contract:{...f.task.grading_contract,contractHash:'new'}}])assert.equal(deriveTaskAnswerScope({problem:f.problem,task:changed,attempts:f.data.attempts,overrides}).status,'unknown');
 assert.throws(()=>validateTaskAnswerScopeOverride({...value,referenceOnlyParts:['[3]']}),/重複/);
 assert.throws(()=>validateTaskAnswerScopeOverride({...value,primaryTargetParts:['major_calculation']}),/小問番号/);
});
test('conflicting explicit targets need confirmation; answer scopes keep recorded notation',()=>{
 assert.equal(scope('[2]を再現する。[2]は対象外。').status,'conflict');
 assert.deepEqual(scope('⑹を再現する。併せて⑴⑶を短く再確認する。').primaryTargetParts,['⑹']);
 assert.deepEqual(scope('小問2・3・4を再現する。').primaryTargetParts,['小問2','小問3','小問4']);
 assert.deepEqual(scope('設問3だけを途中式を省略せず再現する。').primaryTargetParts,['設問3']);
 assert.deepEqual(scope('2022年 問4の記録を確認する。').primaryTargetParts,[]);
});
test('invalid-only and duplicate source attempts cannot supply answer targets',()=>{
 const f=fixture('[6]を再現する');
 f.data.attempts[0].duplicate_of_attempt_id=19;
 assert.equal(deriveTaskAnswerScope({problem:f.problem,task:f.task,attempts:f.data.attempts}).status,'unknown');
 f.data.attempts[0].duplicate_of_attempt_id=undefined;f.data.attempts[0].graded_findings[0].planning_eligible=false;
 assert.equal(deriveTaskAnswerScope({problem:f.problem,task:f.task,attempts:f.data.attempts}).status,'unknown');
});
test('explicit task wording about a question and a short single correction remain primary',()=>{
 assert.deepEqual(scope('設問1について、期待値と分散まで白紙再現する。').primaryTargetParts,['設問1']);
 assert.deepEqual(scope('問3の冒頭を正して、もう一度短く白紙再現する。').primaryTargetParts,['問3']);
 assert.deepEqual(scope('問4の外側積分を実行して、その値で問5の平均・分散まで接続する。').primaryTargetParts,['問4','問5']);
});
test('explicit ranges and concatenated parentheses do not become arithmetic numbers',()=>{
 assert.deepEqual(scope('方針を再確認する。','問1から問5まで主要計算は提出されていない。').primaryTargetParts,['問1','問2','問3','問4','問5']);
 assert.deepEqual(scope('指定箇所を確認する','答案(1)(2)は要求された結論に到達していない。').primaryTargetParts,['(1)','(2)']);
 assert.equal(scope('1/(2)を代入して再現する。').status,'unknown');
 assert.equal(scope('X[1]とX[2]を使って再現する。').status,'unknown','vector indices are not original subquestions');
});
test('latest checked-error regions supply physical scope, not correct or out-of-scope regions',()=>{
 const f=fixture('線形結合の分散を再現する','主要計算が未完');
 f.data.attempts[0].whole_answer_scan={performed:true,confidence:'high',effective_reference_coverage:'full',regions:[
  {description:'設問1の分散',status:'checked_error',finding_ids:['GF-major-calculation']},
  {description:'設問2は係数決定',status:'checked_correct',finding_ids:[]},
  {description:'設問4の分散',status:'checked_error',finding_ids:['OO-1']}]};
 f.data.attempts[0].observed_out_of_scope_findings=[{finding_id:'OO-1'}];
 assert.deepEqual(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.primaryTargetParts,['設問1']);
});
test('retention may inherit a unique physical scope only through its bound graded-part lineage',()=>{
 const f=fixture('同じ計算を再現する','主要計算は再現できた');
 f.task.learning_purpose='retrieval_check';f.task.grading_contract.learningPurpose='retrieval_check';
 f.data.attempts[0].graded_findings[0]={graded_part_id:'major_calculation',error_type:'none',resolved:true};
 f.data.attempts[0].grading_contract={sourceAttemptId:19,gradedParts:[{id:'major_calculation',label:'(4)の主要計算が未完',evidenceSourceAttemptId:19}]};
 f.data.attempts.push({id:19,problem_id:f.problem.problem_id,date:'2026-10-10',graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,evidence:'(2)は修復されたが(4)は未完'}]});
 assert.deepEqual(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.primaryTargetParts,['(4)']);
 f.data.attempts[0].grading_contract.gradedParts[0].id='other';
 assert.equal(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.status,'unknown');
});
test('a historical composite slot cannot assign an unrelated numbered failure to a current unnumbered failure',()=>{
 const f=fixture('不偏性を再現する','不偏性が未完');
 f.data.attempts[0].grading_contract={sourceAttemptId:19,gradedParts:[{id:'major_calculation',label:'不偏性が未完。また(4)の積分も未完',evidenceSourceAttemptId:19}]};
 f.data.attempts.push({id:19,problem_id:f.problem.problem_id,date:'2026-10-10',error_type:'W',error_point:'不偏性と(4)の積分が未完'});
 assert.equal(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.status,'unknown');
});
test('numbered partial findings do not pretend to locate other required unnumbered findings',()=>{
 const f=fixture('計算を最後まで再現する','[2]は未完');
 f.task.grading_contract.gradedParts.push({id:'answer_conclusion',label:'最終証明がない',evidenceSourceAttemptId:20});
 f.data.attempts[0].graded_findings.push({graded_part_id:'answer_conclusion',error_type:'N',resolved:false,evidence:'最終証明がない'});
 const s=deriveTaskIntroduction(f.data,f.problem,f.task).answerScope;assert.equal(s.status,'unknown');assert.deepEqual(s.primaryTargetParts,['[2]']);
});
test('exact named quantity locator can bind a residual to a numbered setup without marking the setup wrong',()=>{
 const f=fixture('hat u(alpha)を書いた直後に不偏性を再現する','不偏性の確認がない');
 f.data.attempts[0].error_point='hat u(alpha)は作れたが不偏性確認がない';
 f.data.attempts[0].whole_answer_scan={performed:true,confidence:'high',regions:[{description:'設問3でhat u(alpha)を作る',status:'checked_correct',finding_ids:[]},{description:'不偏性の確認',status:'not_checkable',finding_ids:[]}]};
 const before=JSON.stringify(f.data.attempts);
 assert.deepEqual(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.primaryTargetParts,['設問3']);assert.equal(JSON.stringify(f.data.attempts),before);
 f.data.attempts[0].whole_answer_scan.regions.push({description:'設問4でhat u(alpha)を使う',status:'checked_correct',finding_ids:[]});
 assert.equal(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.status,'unknown','nonunique named quantity is not a locator');
});
test('a legacy K classification cannot erase an explicit source locator for a later valid residual',()=>{
 const f=fixture('分散式を再現する','分散比較の弱不等号が誤り');
 f.data.attempts[0].error_point='分散比較で等号の扱いを誤った';
 f.data.attempts[0].grading_contract={sourceAttemptId:19,gradedParts:[{id:'major_calculation',label:'入口が未完。加えて(3)の大小比較も誤り',evidenceSourceAttemptId:19}]};
 f.data.attempts.push({id:19,problem_id:f.problem.problem_id,date:'2026-10-10',policy_validity:'invalid_legacy_k',exclude_from_planning:true,graded_findings:[{graded_part_id:'first_step',error_type:'K',resolved:false,planning_eligible:false}],whole_answer_scan:{performed:true,confidence:'high',regions:[{description:'(2) 最小二乗の入口',status:'checked_error',finding_ids:['K']},{description:'(3) 分散の大小比較',status:'checked_error',finding_ids:['old-C']}]}});
 const s=deriveTaskIntroduction(f.data,f.problem,f.task).answerScope;assert.deepEqual(s.primaryTargetParts,['(3)']);assert.equal(s.targetEvidence.some(e=>e.source==='lineage.scan.exact_locator'&&e.attemptId===19),true);
 f.data.attempts[0].graded_findings[0].planning_eligible=false;assert.equal(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.status,'unknown');
});
test('valid findings locate a named operation/theorem without promoting invalid K or unrelated numeric errors',()=>{
 const f=fixture('尤度比と証明を再現する','lambda(x)の評価を誤った');
 f.data.attempts[0].graded_findings.push({graded_part_id:'answer_conclusion',error_type:'N',resolved:false,evidence:'Neyman-Pearsonの基本定理を用いた証明がない'},{graded_part_id:'first_step',error_type:'K',resolved:false,planning_eligible:false,validity:'invalid_legacy_k',evidence:'[4]の入口が誤り'});
 f.task.grading_contract.gradedParts.push({id:'answer_conclusion',label:'証明',evidenceSourceAttemptId:20});
 f.data.attempts[0].whole_answer_scan={performed:true,confidence:'high',regions:[
 {description:'[1] サイズの数値計算',status:'checked_error',finding_ids:['unrelated']},
 {description:'[3] 尤度比lambdaの定義',status:'checked_correct',finding_ids:[]},
 {description:'[4] Neyman-Pearsonの基本定理による証明',status:'checked_error',finding_ids:['proof']} ]};
 assert.deepEqual(deriveTaskIntroduction(f.data,f.problem,f.task).answerScope.primaryTargetParts,['[3]','[4]']);
});
