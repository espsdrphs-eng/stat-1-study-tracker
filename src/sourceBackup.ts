/** Original-record verification only. No database, learning inference or writes. */
export const SOURCE_TABLE_KEYS={problems:'problem_id',attempts:'id',reviews:'id',roadmap:'order_index',
 weakNotes:'id',pastSessions:'id',sMemory:'problem_id',answerIndex:'problem_id',correctionLogs:'id',
 problemAliases:'alias',importLogs:'id',meta:'key'} as const;
export type SourceTable=keyof typeof SOURCE_TABLE_KEYS;
type Row=Record<string,unknown>;
type Id=string|number;
export type SourceBackup=Partial<Record<SourceTable,Row[]>>&{version?:number;exported_at?:string;source_manifest?:SourceManifest};
export type SourceManifest={schema_version:'STAT1-SOURCE-MANIFEST-v1';algorithm:'SHA-256';header_hash:string;data_hash:string;
 tables:Record<SourceTable,{count:number;hash:string;rows:Array<{id:Id;hash:string}>}>};
export type SourceReference={table:SourceTable;id:Id;field:string;value:unknown;target:SourceTable};
const required:SourceTable[]=['problems','attempts','reviews','roadmap','weakNotes','pastSessions','sMemory'];
const stringKeys=new Set<SourceTable>(['problems','sMemory','answerIndex','problemAliases','meta']);
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable((value as Row)[k])])):value;
const canonical=(value:unknown)=>JSON.stringify(stable(JSON.parse(JSON.stringify(value))));
const sha=async(value:string)=>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
};
function validateShape(input:unknown):asserts input is SourceBackup{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('全データJSONの形式ではありません。');
 const data=input as SourceBackup;
 if(data.version!==undefined&&![1,2,3].includes(data.version))throw new Error('未対応のバックアップ版です。元ファイルを保全し、対応版を確認してください。');
 for(const name of Object.keys(SOURCE_TABLE_KEYS) as SourceTable[]){
  if(!Array.isArray(data[name])){
   if(required.includes(name)||data[name]!==undefined)throw new Error(`バックアップの ${name} 配列が不足、または形式が不正です。`);
   continue;
  }
  const seen=new Set<Id>(),key=SOURCE_TABLE_KEYS[name];
  for(const [index,row]of data[name]!.entries()){
   const id=row&&typeof row==='object'&&!Array.isArray(row)?row[key]:undefined;
   if(stringKeys.has(name)?typeof id!=='string'||!id.trim():typeof id!=='number'||!Number.isSafeInteger(id)||id<0)
    throw new Error(`${name} の${index+1}行目の主キーID（${key}）が不正です。自動補完・再採番はしません。`);
   if(seen.has(id as Id))throw new Error(`${name} の主キーID ${id} が重複しています。`);
   seen.add(id as Id);
  }
 }
}
/** Hashes preserve every original field, including unknown historical fields.
 * The manifest itself is not included, so exports never recursively grow. */
export async function createSourceManifest(input:unknown):Promise<SourceManifest>{
 validateShape(input);
 const tables={} as SourceManifest['tables'];
 for(const name of Object.keys(SOURCE_TABLE_KEYS) as SourceTable[]){
  const key=SOURCE_TABLE_KEYS[name],rows=[] as Array<{id:Id;hash:string}>;
  for(const row of input[name]||[])rows.push({id:row[key] as Id,hash:await sha(canonical(row))});
  rows.sort((a,b)=>typeof a.id==='number'&&typeof b.id==='number'?a.id-b.id:a.id===b.id?0:String(a.id)<String(b.id)?-1:1);
  tables[name]={count:rows.length,rows,hash:await sha(canonical(rows))};
 }
 return {schema_version:'STAT1-SOURCE-MANIFEST-v1',algorithm:'SHA-256',
  header_hash:await sha(canonical({version:input.version,exported_at:input.exported_at})),
  data_hash:await sha(canonical(tables)),tables};
}
function sourceReferences(data:SourceBackup){
 const ids=Object.fromEntries((Object.keys(SOURCE_TABLE_KEYS) as SourceTable[]).map(t=>[t,new Set((data[t]||[]).map(r=>r[SOURCE_TABLE_KEYS[t]]))])) as Record<SourceTable,Set<unknown>>;
 const refs:SourceReference[]=[];
 const check=(table:SourceTable,row:Row,field:string,target:SourceTable,value:unknown)=>{
  if(value!==undefined&&value!==null&&value!==''&&value!==0&&!ids[target].has(value))
   refs.push({table,id:row[SOURCE_TABLE_KEYS[table]] as Id,field,value,target});
 };
 for(const t of ['attempts','reviews','weakNotes','roadmap','sMemory','answerIndex'] as SourceTable[])
  for(const row of data[t]||[])check(t,row,'problem_id','problems',row.problem_id);
 for(const row of data.reviews||[])for(const key of ['source_attempt_id','generated_from_attempt_id','derived_from_attempt_id','completed_by_attempt_id'])check('reviews',row,key,'attempts',row[key]);
 for(const row of data.weakNotes||[])check('weakNotes',row,'generated_from_attempt_id','attempts',row.generated_from_attempt_id);
 for(const row of data.attempts||[]){
  for(const key of ['source_review_id','generated_from_review_id'])check('attempts',row,key,'reviews',row[key]);
  for(const key of ['source_attempt_id','duplicate_of_attempt_id','superseded_by_attempt_id'])check('attempts',row,key,'attempts',row[key]);
  check('attempts',row,'parent_past_session_id','pastSessions',row.parent_past_session_id);
 }
 for(const row of data.pastSessions||[]){
  for(const key of ['linked_attempt_ids','selected_timed_attempt_ids','counterfactual_calibration_attempt_ids'])
   for(const value of Array.isArray(row[key])?row[key] as unknown[]:[])check('pastSessions',row,key,'attempts',value);
  for(const key of ['initial_selected_problem_ids','final_selected_problem_ids'])
   for(const value of Array.isArray(row[key])?row[key] as unknown[]:[])check('pastSessions',row,key,'problems',value);
  for(const q of Array.isArray(row.questions)?row.questions as Row[]:[]){
   check('pastSessions',row,'questions.problemId','problems',q.problemId);
   check('pastSessions',row,'questions.sourceAttemptId','attempts',q.sourceAttemptId);
  }
 }
 return refs;
}
export async function verifySourceBackup(input:unknown){
 validateShape(input);
 const manifest=await createSourceManifest(input),provided=input.source_manifest;
 if(provided){
  if(provided.schema_version!=='STAT1-SOURCE-MANIFEST-v1'||provided.algorithm!=='SHA-256')throw new Error('原本照合情報の形式が未対応です。');
  for(const t of Object.keys(SOURCE_TABLE_KEYS) as SourceTable[]){
   const old=provided.tables?.[t],now=manifest.tables[t];
   if(!old||canonical(old)!==canonical(now))throw new Error(`${t} のID・件数・内容が原本の照合情報と一致しません。変更されたファイルは復元できません。`);
  }
  if(provided.header_hash!==manifest.header_hash||provided.data_hash!==manifest.data_hash)throw new Error('バックアップの日時・版または原本ハッシュが一致しません。');
 }
 const references=sourceReferences(input),warnings:string[]=[];
 if(!provided)warnings.push('旧形式のため保存時点のハッシュはありません。現在の内容を検査しましたが、元ファイルとの一致は保証できません。');
 if(references.length)warnings.push(`参照先を照合できない欄が${references.length}件あります。旧表記の問ラベルや未登録教材の索引も含みます。履歴を削除したり架空の記録で補完したりはしません。`);
 if(input.meta===undefined)warnings.push('設定・採点受領・生成途中を含むmetaがない旧形式です。完全な移行原本としては不足しています。');
 return {manifest,verification:provided?'verified' as const:'legacy' as const,references,warnings};
}
export async function compareSourceBackups(current:unknown,incoming:unknown){
 const [a,b]=await Promise.all([createSourceManifest(current),createSourceManifest(incoming)]);
 return Object.fromEntries((Object.keys(SOURCE_TABLE_KEYS) as SourceTable[]).map(t=>{
  const old=new Map(a.tables[t].rows.map(r=>[r.id,r.hash])),next=new Map(b.tables[t].rows.map(r=>[r.id,r.hash]));
  return [t,{before:old.size,after:next.size,added:[...next.keys()].filter(id=>!old.has(id)),removed:[...old.keys()].filter(id=>!next.has(id)),
   changed:[...next].filter(([id,hash])=>old.has(id)&&old.get(id)!==hash).map(([id])=>id)}];
 })) as Record<SourceTable,{before:number;after:number;added:Id[];removed:Id[];changed:Id[]}>;
}
/** Synchronous post-write check inside the restore transaction. No crypto await
 * (which can auto-close IndexedDB transactions in Safari), no ignored fields. */
export function sourceRecordsEqual(expected:SourceBackup,actual:SourceBackup){
 return (Object.keys(SOURCE_TABLE_KEYS) as SourceTable[]).every(table=>{
  const key=SOURCE_TABLE_KEYS[table],rows=new Map((actual[table]||[]).map(row=>[row[key],row]));
  return (expected[table]||[]).length===rows.size&&(expected[table]||[]).every(row=>
   rows.has(row[key])&&canonical(row)===canonical(rows.get(row[key])));
 });
}
export async function readSourceBackupFile(file:Blob){
 let bytes=await file.arrayBuffer();
 if(new Uint8Array(bytes)[0]===0x1f&&new Uint8Array(bytes)[1]===0x8b){
  if(typeof DecompressionStream==='undefined')throw new Error('このブラウザではgzipを展開できません。元ファイルを保全し、展開したJSONを選択してください。');
  try{bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
  catch{throw new Error('gzipを展開できません。ファイル全体をダウンロードし直してください。');}
 }
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
 catch{throw new Error('全データJSONを解析できません。標準JSONまたはそのgzipを選択してください。採点用の自動変換は行いません。');}
}
