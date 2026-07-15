import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  APP_SCHEMA_VERSION, createSchemaDiagnostic, DB_NAME, DB_VERSION, GPT_SAVE_REQUIRED_STORES,
  IndexedDbSchemaError, LATEST_STORE_SCHEMAS, missingStoreNames, REQUIRED_APP_STORES, schemaErrorMessage, STORES
} from "../src/dbSchema.ts";

test("DB v13は現行storeを一か所で定義する",()=>{
  assert.equal(DB_NAME,"stat-1-study-tracker");
  assert.equal(DB_VERSION,13);
  assert.equal(APP_SCHEMA_VERSION,"stat1-schema-v13");
  assert.deepEqual(new Set(Object.keys(LATEST_STORE_SCHEMAS)),new Set(REQUIRED_APP_STORES));
  assert.ok(LATEST_STORE_SCHEMAS[STORES.attempts].includes("++id"));
  assert.ok(LATEST_STORE_SCHEMAS[STORES.reviews].includes("++id"));
});

test("GPT保存preflightはproblemAliases不足を具体名で検出する",()=>{
  const existing=GPT_SAVE_REQUIRED_STORES.filter(store=>store!==STORES.problemAliases);
  assert.deepEqual(missingStoreNames(existing,GPT_SAVE_REQUIRED_STORES),[STORES.problemAliases]);
  const diagnostic=createSchemaDiagnostic({databaseVersion:12,requestedStores:GPT_SAVE_REQUIRED_STORES,existingStores:existing,operation:"saveGptEvaluation"});
  assert.equal(diagnostic.requiredDatabaseVersion,13);
  assert.deepEqual(diagnostic.missingStores,["problemAliases"]);
  const message=schemaErrorMessage(new IndexedDbSchemaError(diagnostic));
  assert.match(message,/不足している保存先：problemAliases/);
  assert.match(message,/必要なDBバージョン：13/);
});

test("GPT保存transactionはresolverが読むproblemAliasesを含み補助ログを分離する",async()=>{
  const source=await readFile(new URL("../src/localDb.ts",import.meta.url),"utf8");
  const saveBranch=source.slice(source.indexOf('path==="/api/attempts"'),source.indexOf('path==="/api/import"'));
  const importBranch=source.slice(source.indexOf('path==="/api/import"'),source.indexOf('/^\\/api\\/attempts'));
  assert.match(saveBranch,/db\.problemAliases/);
  assert.match(importBranch,/db\.problemAliases/);
  assert.doesNotMatch(saveBranch,/db\.correctionLogs/);
  assert.doesNotMatch(importBranch,/db\.correctionLogs/);
  assert.match(source,/persistCorrectionLogs\(logs\)/);
});

test("v13 migrationは既存履歴を削除せず件数を記録する",async()=>{
  const source=await readFile(new URL("../src/localDb.ts",import.meta.url),"utf8");
  const migration=source.slice(source.indexOf("this.version(DB_VERSION)"),source.indexOf("export const db"));
  assert.match(migration,/LATEST_STORE_SCHEMAS/);
  assert.match(migration,/既存Attempt/);
  assert.match(migration,/既存Review/);
  assert.doesNotMatch(migration,/\.clear\(/);
  assert.doesNotMatch(migration,/deleteObjectStore/);
});

test("安全バックアップはtoday_plan_snapshotを含むmetaも保持する",async()=>{
  const source=await readFile(new URL("../src/localDb.ts",import.meta.url),"utf8");
  const backup=source.slice(source.indexOf("export async function exportBackup"),source.indexOf("export async function csvFor"));
  assert.match(backup,/meta:await db\.meta\.toArray\(\)/);
  assert.match(backup,/db\.meta\.bulkPut\(data\.meta\)/);
  assert.doesNotMatch(backup,/db\.meta\.clear\(\)/);
});
