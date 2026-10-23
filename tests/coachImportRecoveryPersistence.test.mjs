import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {db,localGet,localPost,exportBackup,restoreBackup,previewBackupRestore} from '../src/localDb.ts';
import {COACH_HISTORY_META_KEY} from '../src/coachDiagnosis.ts';

const learning=async()=>Object.fromEntries(await Promise.all(['problems','attempts','reviews','weakNotes','pastSessions','correctionLogs'].map(async t=>[t,await db.table(t).toArray()])));
const wire=async(at='2026-10-22T12:00:00+09:00',bottleneck='計算の完遂は未測定')=>{
 const b=await localGet('/api/bootstrap'),c=b.coach.reviewContext;
 return {coach_update:{schema_version:'stat1-coach-v2',review_context_version:c.version,data_version:c.dataVersion,evidence_cutoff_attempt_id:Math.max(0,...b.attempts.map(a=>a.id)),reviewed_at:at,level:{value:2.5,readiness:'本番再測定待ち',confidence:'medium',refs:['metric:selectedThree','metric:timed']},bottleneck:{text:bottleneck,refs:['metric:timed']},improvements:[],actions:[],unknowns:[{text:'自力の証拠が不足',needed:'新しい無援助答案',refs:['metric:transfer']}],ability_profiles:[]}};
};
const history=async()=>JSON.parse((await db.meta.get(COACH_HISTORY_META_KEY))?.value||'[]');

test('rejected raw assessment can be archived exactly, without applying any opinion or grading',async()=>{
 const r=await wire(),raw=JSON.stringify(r).replace('"improvements":[]','"improvements":'),before=await learning(),old=await history();
 await assert.rejects(()=>localPost('/api/coach/preview',{text:raw,require_current_evidence:true}));
 await assert.rejects(()=>localPost('/api/coach/save',{text:raw,require_current_evidence:true}));
 assert.deepEqual(await history(),old);
 const saved=await localPost('/api/gpt-exchanges',{rawText:raw,kind:'assessment',confirmedByUser:true});
 assert.equal(saved.record.rawText,raw);assert.equal(saved.record.status,'raw_only');
 assert.deepEqual(await learning(),before);assert.deepEqual(await history(),old);
});

test('valid assessment one-save is atomic, survives reopen and restore, and duplicate retry adds no history',async()=>{
 const raw=JSON.stringify(await wire()),before=await learning(),count=(await history()).length;
 const fail=(key,row)=>{if(row.key.startsWith('gpt-exchange:v1:'))throw new Error('FIXTURE: 原文の保存領域が一杯です')};
 db.meta.hook('creating',fail);
 try{await assert.rejects(()=>localPost('/api/coach/save',{text:raw,require_current_evidence:true}),/保存領域/)}finally{db.meta.hook('creating').unsubscribe(fail)}
 assert.equal((await history()).length,count);assert.deepEqual(await learning(),before);
 const result=await localPost('/api/coach/save',{text:raw,require_current_evidence:true});assert.equal(result.duplicate,false);
 assert.equal((await localPost('/api/coach/save',{text:raw,require_current_evidence:true})).duplicate,true);
 assert.equal((await history()).length,count+1);assert.deepEqual(await learning(),before);
 const h=await history(),backup=await exportBackup(),preview=await previewBackupRestore(backup);
 await restoreBackup(backup,{mode:'original',sourceHash:preview.manifest.data_hash});db.close();await db.open();
 assert.deepEqual(await history(),h);assert.deepEqual(await learning(),before);
 assert.ok((await localGet('/api/gpt-exchanges')).some(r=>r.rawText===raw&&r.kind==='assessment'));
});

test('concurrent assessment saves re-read history inside the transaction and never drop another accepted opinion',async()=>{
 const a=await wire('2026-10-22T13:00:00+09:00','FIXTURE A: 未測定'),b=await wire('2026-10-22T13:01:00+09:00','FIXTURE B: 要再確認'),before=(await history()).length;
 await Promise.all([a,b].map(r=>localPost('/api/coach/save',{text:JSON.stringify(r),require_current_evidence:true})));
 const h=await history();assert.equal(h.length,before+2);assert.ok(h.some(r=>r.primaryBottleneck.title===a.coach_update.bottleneck.text));assert.ok(h.some(r=>r.primaryBottleneck.title===b.coach_update.bottleneck.text));
});

test('old context, unknown evidence and wrong screen inputs still refuse without modifying history',async()=>{
 const r=await wire('2026-10-22T14:00:00+09:00'),before=await learning(),h=await history();
 for(const mutate of [u=>u.review_context_version='old-context',u=>u.data_version='wrong-data',u=>u.level.refs=['attempt:999999'],u=>u.actions=[{task_id:'review:999999',text:'対象外の課題',success:'不明',refs:['metric:timed']}]]){
  const bad=structuredClone(r);mutate(bad.coach_update);await assert.rejects(()=>localPost('/api/coach/save',{text:JSON.stringify(bad),require_current_evidence:true}));
 }
 await assert.rejects(()=>localPost('/api/coach/preview',{text:'{"study_update":{"score_numeric":45}}',require_current_evidence:true}),e=>/採点結果/.test(e.reason));
 assert.deepEqual(await learning(),before);assert.deepEqual(await history(),h);
});

test('two saves of the same assessment create one history row; an existing broken history is never overwritten',async()=>{
 const raw=JSON.stringify(await wire('2026-10-22T15:00:00+09:00','並行重複テスト')),count=(await history()).length;
 const receipts=await Promise.all([1,2].map(()=>localPost('/api/coach/save',{text:raw,require_current_evidence:true})));
 assert.equal((await history()).length,count+1);assert.deepEqual(receipts.map(r=>r.duplicate).sort(),[false,true]);
 const original=await db.meta.get(COACH_HISTORY_META_KEY);await db.meta.put({key:COACH_HISTORY_META_KEY,value:'{broken historical record'});
 try{await assert.rejects(()=>localPost('/api/coach/save',{text:raw}),/上書きせず停止/);assert.equal((await db.meta.get(COACH_HISTORY_META_KEY)).value,'{broken historical record')}finally{await db.meta.put(original)}
});
