import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,previewBackupRestore,restoreBackup} from '../src/localDb.ts';
import {projectCapabilityMap} from '../src/capabilityEvidence.ts';
import {parseStructuredStudyText} from '../src/importParser.ts';
import {sourceRecordsEqual,SOURCE_TABLE_KEYS} from '../src/sourceBackup.ts';
import {capabilityFacts,capabilityWire} from './capabilityFixtures.mjs';

const endpoint='/api/capabilities/context?initial=1&domain=all';
const abilityId='distributions.expectation-variance';
const read=async()=>{
 const [problems,attempts,reviews,pastSessions,recordReply]=await Promise.all([db.problems.toArray(),db.attempts.toArray(),db.reviews.toArray(),db.pastSessions.toArray(),localGet('/api/capabilities/records')]);
 return projectCapabilityMap({problems,attempts,reviews,pastSessions},recordReply.records);
};

test('GPT graded assumptions and an independently checked interval persist without losing other operations, scores or old Reviews',async()=>{
 await localGet('/api/bootstrap');
 const f=capabilityFacts();f.attempts[2].date='2026-11-09';
 const model={problem_id:'PY-2018-Q5',mode:'full',date:'2026-11-10',graded_findings:[{graded_part_id:'major_calculation',error_type:'W',resolved:false,
  evidence:'FIXTURE: 分散の加法性が成立する仮定の説明を誤った。',concept_focus:'assumption'}]};
 const [graded]=parseStructuredStudyText(JSON.stringify({study_update:model}),f.problems).updates;
 assert.equal(graded.graded_findings[0].concept_focus,'assumption');
 assert.throws(()=>parseStructuredStudyText(JSON.stringify({study_update:{...model,graded_findings:[{...model.graded_findings[0],concept_focus:'assumed'}]}}),f.problems),/concept_focus/);
 f.attempts.push({...f.attempts[0],id:4,date:'2026-11-10',graded_findings:graded.graded_findings});
 await db.attempts.bulkPut(f.attempts);
 let context=await localGet(endpoint);
 const other=capabilityWire(context,{ability_id:'distributions.function-identity'});
 await localPost('/api/capabilities/save',{text:JSON.stringify(other),confirmed:true});
 const before=await exportBackup();context=await localGet(endpoint);
 const wire=capabilityWire(context);wire.evaluated_at='2026-11-12T10:00:00+09:00';
 const e=wire.evaluations[0];
 e.evidence[0]={...e.evidence[0],aspect:'derivation',method_not_cued:true};
 e.evidence.push({...e.evidence[0],aspect:'retention',attempt_id:3,kind:'delayed_transfer',baseline_attempt_id:2,transfer_conditions:{different_structure:true,method_not_cued:true}});
 delete e.evidence[1].method_not_cued;
 e.evidence.push({aspect:'concept',concept_focus:'assumption',attempt_id:4,kind:'diagnostic',outcome:'failure',baseline_attempt_id:null,part_ids:['major_calculation'],observation:'FIXTURE: 仮定の説明の未達'});
 e.next_check={...e.next_check,aspect:'retention',interval_days:30,estimated_minutes:10};
 const text=JSON.stringify(wire),p=await localPost('/api/capabilities/preview',{text});
 assert.equal(p.entries[0].afterState,'immediate_confirmed');assert.equal(p.entries[0].theory.concept.status,'failure');
 assert.match(p.entries[0].theory.concept.reason,/#4/);assert.equal(p.entries[0].theory.retention.status,'success');
 assert.equal(p.summary.maintained,1);assert.ok(sourceRecordsEqual(before,await exportBackup()));
 await localPost('/api/capabilities/save',{text,confirmed:true,confirmationToken:p.confirmationToken});
 assert.equal((await localPost('/api/capabilities/save',{text,confirmed:true})).duplicate,true);
 const signed=await exportBackup(),baselineKeys=new Set(before.meta.map(m=>m.key));
 for(const key of Object.keys(SOURCE_TABLE_KEYS).filter(k=>k!=='meta'))assert.deepEqual(signed[key],before[key],key);
 assert.deepEqual(signed.meta.filter(m=>baselineKeys.has(m.key)),before.meta);assert.equal(signed.meta.length,before.meta.length+2);
 const prev=await previewBackupRestore(signed);await restoreBackup(signed,{mode:'original',sourceHash:prev.manifest.data_hash});
 db.close();await db.open();const restored=await exportBackup();assert.ok(sourceRecordsEqual(signed,restored));
 assert.equal(signed.source_manifest.data_hash,restored.source_manifest.data_hash);
 const map=await read(),a=map.abilities.find(u=>u.id===abilityId);
 assert.equal(map.metrics.historyOperations,2);assert.equal(a.theory.aspects.concept.latest.attempt.id,4);
 assert.equal(a.theory.aspects.retention.latest.interval.minimumDays,7);assert.equal(a.theory.milestone,7);
 assert.equal(a.theory.aspects.transfer.status,'unconfirmed');assert.equal(a.theory.lastIndependent.attempt.id,3);
 assert.equal(a.proposalSource.item.next_check.interval_days,30);assert.equal(a.state,'immediate_confirmed');
 // Returning to a pre-extension backup must not materialize retention evidence.
 const old=await previewBackupRestore(before);await restoreBackup(before,{mode:'original',sourceHash:old.manifest.data_hash});
 assert.ok(sourceRecordsEqual(before,await exportBackup()));assert.equal((await read()).abilities.find(u=>u.id===abilityId).theory.milestone,null);
});

test('editing the focus or available minutes does not reschedule saved review rows',async()=>{
 await db.reviews.put({id:9999,problem_id:'PY-2018-Q5',generated_from_attempt_id:1,date:'2026-11-12',due_date:'2026-11-18',status:'pending',reason:'FIXTURE long-term preservation'});
 const before=await db.reviews.toArray();
 await localPost('/api/settings',{exam_date:'2027-11-10',daily_study_minutes:12,focus_exam:true});
 assert.deepEqual(await db.reviews.toArray(),before);
 const bootstrap=await localGet('/api/bootstrap');assert.equal(bootstrap.settings.daily_study_minutes,12);assert.equal(bootstrap.settings.focus_exam,true);
});
