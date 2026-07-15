export const DB_NAME = "stat-1-study-tracker";
export const DB_VERSION = 13;
export const APP_SCHEMA_VERSION = "stat1-schema-v13";
export const APP_BUILD_VERSION = "2026.07.16-db13";

export const STORES = {
  problems: "problems",
  attempts: "attempts",
  reviews: "reviews",
  roadmap: "roadmap",
  weakNotes: "weakNotes",
  pastSessions: "pastSessions",
  sMemory: "sMemory",
  meta: "meta",
  answerIndex: "answerIndex",
  correctionLogs: "correctionLogs",
  answerPdfs: "answerPdfs",
  problemAliases: "problemAliases",
  importLogs: "importLogs"
} as const;

export type StoreName = typeof STORES[keyof typeof STORES];

export const LATEST_STORE_SCHEMAS:Record<StoreName,string> = {
  [STORES.problems]: "&problem_id,category,chapter,priority,completion_status,normalized_label",
  [STORES.attempts]: "++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
  [STORES.reviews]: "++id,problem_id,due_date,status,review_type,task_origin,source_problem_id",
  [STORES.roadmap]: "&order_index,problem_id,is_active",
  [STORES.weakNotes]: "++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
  [STORES.pastSessions]: "++id,year,date,session_type,selection_result",
  [STORES.sMemory]: "&problem_id,state,last_touched",
  [STORES.meta]: "&key",
  [STORES.answerIndex]: "&problem_id,answer_available,pdf_file_name,document_key",
  [STORES.correctionLogs]: "++id,corrected_at,raw_gpt_problem_id,corrected_problem_id",
  [STORES.answerPdfs]: "&file_name,document_key,uploaded_at,registered_at",
  [STORES.problemAliases]: "&alias,problem_id",
  [STORES.importLogs]: "++id,imported_at,file_kind"
};

export const REQUIRED_APP_STORES = Object.values(STORES);

export const GPT_SAVE_REQUIRED_STORES:StoreName[] = [
  STORES.problems,
  STORES.attempts,
  STORES.reviews,
  STORES.weakNotes,
  STORES.sMemory,
  STORES.meta,
  STORES.answerIndex,
  STORES.problemAliases
];

export type IndexedDbSchemaDiagnostic = {
  databaseName:string;
  databaseVersion:number;
  requiredDatabaseVersion:number;
  requestedStores:string[];
  existingStores:string[];
  missingStores:string[];
  operation:string;
  appSchemaVersion:string;
  buildVersion:string;
  migrationVersion:string;
};

export class IndexedDbSchemaError extends Error {
  readonly code = "INDEXED_DB_SCHEMA_MISMATCH";
  readonly diagnostic:IndexedDbSchemaDiagnostic;
  constructor(diagnostic:IndexedDbSchemaDiagnostic) {
    super(`IndexedDB schema mismatch: ${diagnostic.missingStores.join(", ")}`);
    this.name = "IndexedDbSchemaError";
    this.diagnostic = diagnostic;
  }
}

export function missingStoreNames(existingStores:Iterable<string>,requestedStores:Iterable<string>) {
  const existing = new Set(existingStores);
  return [...requestedStores].filter(store=>!existing.has(store));
}

export function createSchemaDiagnostic(input:{
  databaseName?:string;
  databaseVersion:number;
  requestedStores:string[];
  existingStores:string[];
  operation:string;
  migrationVersion?:string;
}):IndexedDbSchemaDiagnostic {
  return {
    databaseName: input.databaseName||DB_NAME,
    databaseVersion: input.databaseVersion,
    requiredDatabaseVersion: DB_VERSION,
    requestedStores: [...input.requestedStores],
    existingStores: [...input.existingStores],
    missingStores: missingStoreNames(input.existingStores,input.requestedStores),
    operation: input.operation,
    appSchemaVersion: APP_SCHEMA_VERSION,
    buildVersion: APP_BUILD_VERSION,
    migrationVersion: input.migrationVersion||`v${DB_VERSION}`
  };
}

export function isIndexedDbSchemaError(error:unknown):error is IndexedDbSchemaError {
  return error instanceof IndexedDbSchemaError||(
    !!error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code==="INDEXED_DB_SCHEMA_MISMATCH"
  );
}

export function schemaErrorMessage(error:unknown) {
  if(isIndexedDbSchemaError(error)){
    const diagnostic=error.diagnostic;
    return `保存先データベースの更新が必要です。不足している保存先：${diagnostic.missingStores.join("、")||"確認中"}。現在のDBバージョン：${diagnostic.databaseVersion}、必要なDBバージョン：${diagnostic.requiredDatabaseVersion}`;
  }
  if(error instanceof DOMException&&error.name==="NotFoundError"){
    return "学習結果を保存できませんでした。端末内データベースに、最新アプリで必要な保存先がありません。入力内容は保持されています。";
  }
  return error instanceof Error?error.message:String(error);
}
