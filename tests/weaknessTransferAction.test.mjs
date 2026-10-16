import test from 'node:test';import assert from 'node:assert/strict';import {weaknessTransferAction} from '../src/learningOverview.ts';
test('priority weakness always has a transfer action or an explicit evidence-based waiting reason; no gate bypass',()=>{
 const t={problem_id:'PY-fixture',repair_lineage:{weaknessSkillIds:[]}};
 assert.match(weaknessTransferAction(t,[]).reason,/技能/);assert.equal(weaknessTransferAction(t,[]).key,undefined);
 const c={problem_id:t.problem_id,transfer_training_key:'training:fixture',ranking:{eligible:true},checked:false};
 assert.equal(weaknessTransferAction(t,[c]).key,undefined,'same problem alone cannot prove a skill match');
 const matched={...t,repair_lineage:{weaknessSkillIds:['fixture']}};
 assert.equal(weaknessTransferAction(matched,[c]).key,c.transfer_training_key);
 assert.equal(weaknessTransferAction({...matched,repair_lineage:{weaknessSkillIds:['other']}},[c]).key,undefined);
 assert.equal(weaknessTransferAction(t,[{...c,checked:true}]).key,undefined);
 assert.equal(weaknessTransferAction(t,[{...c,ranking:undefined}]).key,undefined);
 assert.equal(weaknessTransferAction(t,[{...c,problem_id:'different'}]).key,undefined);
});
