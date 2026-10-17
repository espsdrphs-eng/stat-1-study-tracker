import test from 'node:test';import assert from 'node:assert/strict';
import * as repair from '../src/repairCheck.ts';
import {generationPrompt} from '../src/generatedTransfer.ts';
const task={id:456,problem_id:'PY-2018-Q5',learning_purpose:'error_repair',grading_contract:{contractId:'review:456',learningPurpose:'error_repair',gradedParts:[]}};
const input={clue:'支持範囲の条件を読む',knowledge:'変数変換の定義',approach:'逆変換を立てる',reason:'密度を変換するため',stage:'calculation'};
test('repair self-report is bound to the exact task, never an inferred mastery result',()=>{
 const c=repair.buildRepairCheck(input,task,0,'2026-10-18T00:00:00Z');assert.equal(c.stage,'calculation');assert.equal(c.beforeAssistance,true);assert.equal(c.problemId,task.problem_id);assert.equal(c.selfReported,true);assert.equal(c.success,undefined);
 assert.equal(repair.repairCheckForTask(c,task),c);assert.equal(repair.repairCheckForTask(c,{...task,id:457}),undefined);
 assert.equal(repair.repairCheckForTask(undefined,task),undefined);assert.equal(repair.repairStageLabel(undefined),'未判定');assert.equal(repair.repairStageLabel(c),'計算・記述');
 assert.equal(repair.buildRepairCheck({...input,stage:'unknown'},task,3).beforeAssistance,false);
 assert.throws(()=>repair.buildRepairCheck({...input,stage:'guess'},task,0),/段階/);
});
test('prompt distinguishes self-report from independently graded skeleton/calculation/transfer',()=>{
 const c=repair.buildRepairCheck(input,task,0);const p=repair.repairCheckPrompt(c);assert.match(p,/自己申告/);assert.match(p,/支持範囲/);assert.match(p,/推測.*成功|成功.*推測/);assert.match(p,/紙|答案画像/);assert.equal(repair.repairCheckPrompt(undefined),'');
});
test('generation carries a recorded stage or unknown without inventing a skill or source statement',()=>{
 const record={lineage:{sourceProblemId:'PY-fixture',rootSkillId:'confirmed-operation',observedFailure:'採点に明記した対象操作'},status:'requested',rounds:[]};
 const known=generationPrompt(record,[],{stuckStage:'解法選択'}),unknown=generationPrompt(record,[]);assert.match(known,/self_reported_stuck_stage.*解法選択/);assert.match(unknown,/self_reported_stuck_stage.*未判定/);assert.match(unknown,/original_statement":null/);
});
