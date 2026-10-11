import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import 'fake-indexeddb/auto';
import {deriveTaskIntroduction} from '../src/learningFeedback.ts';
const {db,restoreBackup,exportBackup,localGet,localPost}=await import('../src/localDb.ts');
const raw=JSON.parse(await readFile(process.argv[2],'utf8'));
await restoreBackup(raw);
const b=await localGet('/api/bootstrap');
const before=await exportBackup();
const rows=b.problems.filter(p=>p.source_type==='past_exam').map(p=>{
 const i=deriveTaskIntroduction(b,p),task=b.today.tasks.find(t=>t.problem_id===p.problem_id&&!t.checked&&!t.stable_session_key&&!t.transfer_training_key);
 if(task)assert.deepEqual(deriveTaskIntroduction(b,p,task).answerScope,i.answerScope,`Today/list scope mismatch: ${p.problem_id}`);
 return {problemId:p.problem_id,taskIdentity:i.taskIdentity,status:i.answerScope.status,text:i.subparts,scopeKey:i.answerScope.scopeKey};
});
const targetIds=['PY-2022-Q1','PY-2019-Q3','PY-2018-Q4','PY-2018-Q5'];
const targets=rows.filter(r=>targetIds.includes(r.problemId));
for(const r of targets)assert.equal(r.status,'identified',r.problemId);
const unknown=rows.find(r=>r.status==='unknown');
if(unknown)await localPost('/api/task-answer-scope',{problemId:unknown.problemId,scopeKey:unknown.scopeKey,primaryTargetParts:['[3]'],secondaryTargetParts:['[1]'],referenceOnlyParts:['[2]']});
const modified=await localGet('/api/bootstrap'),p=unknown?modified.problems.find(p=>p.problem_id===unknown.problemId):undefined;
if(unknown)assert.equal(deriveTaskIntroduction(modified,p).answerScope.status,'identified');
const after=await exportBackup();
assert.deepEqual(after.attempts,before.attempts,'scope display/manual selection must not change grading history');
assert.deepEqual(after.reviews,before.reviews,'scope display/manual selection must not change review or hint history');
assert.deepEqual(after.weakNotes,before.weakNotes,'scope display/manual selection must not rewrite weakness flags');
await restoreBackup(after);
const fresh=await localGet('/api/bootstrap');
if(unknown)assert.equal(deriveTaskIntroduction(fresh,fresh.problems.find(row=>row.problem_id===p.problem_id)).subparts,deriveTaskIntroduction(modified,p).subparts);
for(const id of targetIds){const p=fresh.problems.find(p=>p.problem_id===id);assert.equal(deriveTaskIntroduction(fresh,p).subparts,targets.find(r=>r.problemId===id).text);}
const again=await localGet('/api/bootstrap');
assert.deepEqual(again.taskAnswerScopeOverrides,fresh.taskAnswerScopeOverrides);
if(unknown)await assert.rejects(()=>localPost('/api/task-answer-scope',{problemId:p.problem_id,scopeKey:unknown.scopeKey+':stale',primaryTargetParts:['[3]'],secondaryTargetParts:[],referenceOnlyParts:[]}),/更新/);
const report={status:'PASS',exportedAt:raw.exported_at,targets,manualScope:unknown?{problemId:p.problem_id,scopeKey:unknown.scopeKey,roundtrip:'PASS',hintChanges:0}:{status:'Not needed for current production copy; synthetic persistence regression separately'},
 history:{attemptsPreserved:after.attempts.length,reviewsPreserved:after.reviews.length,weakNotesPreserved:after.weakNotes.length},
 counts:{identified:rows.filter(r=>r.status==='identified').length,unknown:rows.filter(r=>r.status==='unknown').length,conflict:rows.filter(r=>r.status==='conflict').length,whole:rows.filter(r=>r.status==='whole').length},rows};
await mkdir('outputs/subparts-20261012',{recursive:true});await writeFile('outputs/subparts-20261012/copy-e2e.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,rows:undefined},null,2));await db.delete();
