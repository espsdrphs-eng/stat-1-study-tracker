import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {createHash} from 'node:crypto';
import {db,localGet,exportBackup,restoreBackup} from '../src/localDb.ts';
import * as localDb from '../src/localDb.ts';
const tables=['problems','attempts','reviews','weakNotes','pastSessions','roadmap','sMemory','answerIndex','correctionLogs','problemAliases','importLogs','meta'];
const facts=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,await db.table(t).toArray()])));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('export takes a consistent read-only original snapshot instead of refreshing audit/learning records',async()=>{
 await localGet('/api/bootstrap');await db.meta.put({key:'integrity_audit_summary',value:'original raw audit'});
 const before=await facts(),b=await exportBackup();
 assert.equal(digest(await facts()),digest(before));for(const t of tables)assert.equal(digest(b[t]),digest(before[t]));
 assert.equal(b.source_manifest.schema_version,'STAT1-SOURCE-MANIFEST-v1');
});
test('migration/restore preview reports source differences but never applies reconciliation or writes a cache',async()=>{
 const before=await facts(),b=await exportBackup();b.source_manifest=undefined;
 b.meta.push({key:'source-preview-only',value:'not to be imported'});
 assert.equal(typeof localDb.previewBackupRestore,'function');
 const p=await localDb.previewBackupRestore(b);assert.deepEqual(p.differences.meta.added,['source-preview-only']);
 assert.equal(digest(await facts()),digest(before));assert.equal(await db.meta.get('source-preview-only'),undefined);
});
test('a manifest mismatch is rejected before any destructive restore transaction',async()=>{
 const b=await exportBackup(),before=await facts();b.meta.push({key:'tampered',value:'reject'});
 await assert.rejects(()=>restoreBackup(b),/一致|改変|変更/);assert.equal(digest(await facts()),digest(before));
});

test('original snapshot restore replaces destination-only metadata only after explicit preflight confirmation and preserves every incoming field',async()=>{
 const b=await exportBackup();
 await db.meta.put({key:'destination-only-important-history',value:'must be visible in preflight, not silently mixed'});
 const preview=await localDb.previewBackupRestore(b);
 assert.equal(preview.metaPolicy.originalAvailable,true);
 assert.ok(preview.metaPolicy.destinationOnlyKeys.includes('destination-only-important-history'));
 await restoreBackup(b,{mode:'original',sourceHash:preview.manifest.data_hash});
 const restored=await exportBackup();
 const {compareSourceBackups}=await import('../src/sourceBackup.ts');
 for(const diff of Object.values(await compareSourceBackups(b,restored))){
  assert.deepEqual(diff.added,[]);assert.deepEqual(diff.removed,[]);assert.deepEqual(diff.changed,[]);
 }
 assert.equal(await db.meta.get('destination-only-important-history'),undefined);
});
test('original mode refuses an unconfirmed source hash before any database write',async()=>{
 const b=await exportBackup(),before=await facts();
 await assert.rejects(()=>restoreBackup(b,{mode:'original',sourceHash:'wrong-context'}),/照合|確認|一致/);
 assert.equal(digest(await facts()),digest(before));
});
