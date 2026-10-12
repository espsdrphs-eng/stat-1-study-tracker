import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';import Dexie from 'dexie';
import {DB_NAME,LATEST_STORE_SCHEMAS} from '../src/dbSchema.ts';
test('existing v12 database opens safely as v13 with missing aliases added, preserving recorded facts',async()=>{
 const old=new Dexie(DB_NAME);old.version(12).stores(Object.fromEntries(Object.entries(LATEST_STORE_SCHEMAS).filter(([name])=>name!=='problemAliases')));await old.open();
 const attempt={id:700,problem_id:'PY-2000-Q1',date:'2026-10-01',mark:'△',score_numeric:55};const review={id:701,problem_id:'PY-2000-Q1',due_date:'2026-10-04',status:'pending'};
 await old.table('attempts').put(attempt);await old.table('reviews').put(review);old.close();
 const {db,databaseSchemaStatus}=await import('../src/localDb.ts');await db.open();const status=await databaseSchemaStatus();assert.equal(status.valid,true);assert.ok(status.existingStores.includes('problemAliases'));assert.deepEqual(await db.attempts.get(700),attempt);assert.deepEqual(await db.reviews.get(701),review);
});
