import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup} from '../src/localDb.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';
import {projectCapabilityMap} from '../src/capabilityEvidence.ts';

test('future material metadata merges by stable ID without rewriting old notes, grades or capability evidence',async()=>{
 await localGet('/api/bootstrap');const f=capabilityFacts();await db.attempts.bulkPut(f.attempts);
 await db.weakNotes.add({id:9000,problem_id:'PY-2018-Q5',date:'2026-11-01',theme:'元採点時の分類を履歴として保持',mistake:'TEST: 未完了',correction_rule:'TEST: 記録',error_type:'N',is_resolved:0});
 const ctx=await localGet('/api/capabilities/context');await localPost('/api/capabilities/save',{text:JSON.stringify(capabilityWire(ctx)),confirmed:true});
 const before=await exportBackup();
 const payload={version:'TEST-materials-20261111',problems:[{problem_id:'PY-2018-Q5',type:'past_exam',title:'TEST: 教材メタデータのみ更新',theme:'順序統計量'},{problem_id:'WB-99-A-01',type:'A',chapter:99,problem_number:1,title:'TEST: 本文未登録の追加教材',theme:'未分類'}]};
 await localPost('/api/master/problem/import',payload);
 const after=await exportBackup();for(const k of ['attempts','weakNotes','reviews','pastSessions'])assert.deepEqual(after[k],before[k],k);
 assert.equal(after.problems.filter(p=>p.problem_id==='PY-2018-Q5').length,1);assert.ok(after.problems.some(p=>p.problem_id==='WB-99-A-01'));
 const records=after.meta.filter(m=>m.key.startsWith('capability-evaluation:'));assert.deepEqual(records,before.meta.filter(m=>m.key.startsWith('capability-evaluation:')));
 assert.equal(projectCapabilityMap({problems:after.problems,attempts:after.attempts},records.map(m=>JSON.parse(m.value))).counts.immediate_confirmed,1);
 await assert.rejects(()=>localPost('/api/master/problem/import',{version:'TEST-duplicate',problems:[payload.problems[1],{...payload.problems[1],problem_id:'WB-99-A-1'}]}),/重複/);
});
test('a failed material merge rolls back every earlier metadata change and keeps all IDs',async()=>{
 const before=await exportBackup(),fail=(key,p)=>{if(p.problem_id==='WB-98-A-01')throw Error('TEST ONLY: material storage failure')};db.problems.hook('creating',fail);
 try{await assert.rejects(()=>localPost('/api/master/problem/import',{version:'TEST-fail',problems:[{problem_id:'PY-2018-Q5',type:'past_exam',title:'THIS MUST ROLL BACK',theme:'新分類'},{problem_id:'WB-98-A-01',type:'A',chapter:98,title:'失敗する追加',theme:'未分類'}]}),/material storage failure/)}finally{db.problems.hook('creating').unsubscribe(fail)}
 assert.equal((await exportBackup()).source_manifest.data_hash,before.source_manifest.data_hash);
});
test('integrated master import is also atomic when a later alias write fails',async()=>{
 const before=await exportBackup(),fail=()=>{throw Error('TEST ONLY: alias storage failure')};db.problemAliases.hook('creating',fail);
 try{await assert.rejects(()=>localPost('/api/master/integrated/import',{version:'TEST-integrated-failure',problems:[{problem_id:'PY-2018-Q5',type:'past_exam',title:'INTEGRATED ROLLBACK',theme:'新分類'}],aliases:[{alias:'TEST-MATERIAL-ALIAS',problem_id:'PY-2018-Q5'}]}),/alias storage failure/)}finally{db.problemAliases.hook('creating').unsubscribe(fail)}
 assert.equal((await exportBackup()).source_manifest.data_hash,before.source_manifest.data_hash);
});
