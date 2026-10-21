import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
const api=()=>import('../src/sourceBackup.ts');
const backup=()=>({version:3,exported_at:'2026-10-18T05:53:00+09:00',
 problems:[{problem_id:'PY-2024-Q1',title:'2024年問1',source_type:'past_exam',unknown_legacy:{keep:true}}],
 attempts:[{id:334,problem_id:'PY-2024-Q1',date:'2026-10-16',score_numeric:55,hint_used:false}],
 reviews:[{id:555,problem_id:'PY-2024-Q1',source_attempt_id:334,status:'pending'}],
 weakNotes:[{id:700,problem_id:'PY-2024-Q1',generated_from_attempt_id:334,is_resolved:0}],
 pastSessions:[{id:9,year:2024,final_selected_problem_ids:['PY-2024-Q1'],linked_attempt_ids:[334]}],
 roadmap:[],sMemory:[],answerIndex:[],correctionLogs:[],problemAliases:[],importLogs:[],
 meta:[{key:'unknown-original-metadata',value:'preserve exactly'}]});

test('source manifest covers every exported table, primary key and unknown original field without modifying the source',async()=>{
 const {createSourceManifest,verifySourceBackup}=await api(),b=backup(),before=structuredClone(b);
 const m=await createSourceManifest(b);assert.equal(m.schema_version,'STAT1-SOURCE-MANIFEST-v1');
 assert.equal(Object.keys(m.tables).length,12);assert.equal(m.tables.attempts.rows[0].id,334);
 const check=await verifySourceBackup({...b,source_manifest:m});assert.equal(check.verification,'verified');
 assert.deepEqual(b,before);assert.match(m.tables.attempts.hash,/^[0-9a-f]{64}$/);
});
test('changed score, source date and a missing original record are rejected rather than silently rehashed',async()=>{
 const {createSourceManifest,verifySourceBackup}=await api(),b=backup();b.source_manifest=await createSourceManifest(b);
 for(const change of [x=>x.attempts[0].score_numeric=100,x=>x.exported_at='2026-10-20',x=>x.weakNotes=[]]){
  const changed=structuredClone(b);change(changed);await assert.rejects(()=>verifySourceBackup(changed),/一致|改変|不足|変更/);
 }
});
test('duplicate/missing/mistyped primary IDs are refused before restore while genuine legacy reference holes are reported',async()=>{
 const {verifySourceBackup}=await api();
 for(const change of [x=>x.attempts.push({...x.attempts[0]}),x=>delete x.attempts[0].id,x=>x.attempts[0].id='334']){
  const b=backup();change(b);await assert.rejects(()=>verifySourceBackup(b),/ID|重複|主キー/);
 }
 const b=backup();b.reviews[0].source_attempt_id=175;
 const check=await verifySourceBackup(b);assert.equal(check.verification,'legacy');
 assert.ok(check.references.some(r=>r.table==='reviews'&&r.id===555&&r.value===175));
 assert.equal(b.reviews[0].source_attempt_id,175);
});
test('source comparison distinguishes changed, removed and added rows and does not merge them',async()=>{
 const {compareSourceBackups}=await api(),old=backup(),next=backup();next.attempts[0].score_numeric=45;
 next.weakNotes=[];next.meta.push({key:'new-key',value:'new'});
 const before=JSON.stringify([old,next]),diff=await compareSourceBackups(old,next);
 assert.deepEqual(diff.attempts.changed,[334]);assert.deepEqual(diff.weakNotes.removed,[700]);
 assert.deepEqual(diff.meta.added,['new-key']);assert.equal(JSON.stringify([old,next]),before);
});
test('plain JSON and gzip source files are read without applying grading normalizations',async()=>{
 const {readSourceBackupFile}=await api(),b=backup(),json=JSON.stringify(b);
 for(const file of [new File([json],'source.json'),new File([gzipSync(json)],'source.json.gz')])assert.deepEqual(await readSourceBackupFile(file),b);
 await assert.rejects(()=>readSourceBackupFile(new File(['{ “version”: 3 }'],'not-standard.json')),/JSON|解析/);
});
