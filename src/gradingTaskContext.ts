import type {GradingContractSnapshot,TargetKind} from './types.ts';
import type {TaskAnswerScope} from './taskAnswerScope.ts';
export const GRADING_TASK_CONTEXT_VERSION='STAT1-GRADING-CONTEXT-v1';
export type GradingAnswerScope={scope_key:string;status:'identified'|'whole';primary_target_parts:string[];secondary_target_parts:string[];reference_only_parts:string[];excluded_parts:string[]};
/** Wire projection of the existing immutable contract, not a new task/store. */
export type GradingTaskContext={context_version?:string;contract_id?:string;contract_version?:string;contract_hash?:string;problem_id?:string;
 source_attempt_id?:number;source_review_id?:number;learning_purpose?:string;learning_stage?:string;mode?:string;review_scope?:string;target_kind?:TargetKind;graded_part_ids?:string[];answer_scope?:GradingAnswerScope};
export function gradingTaskContext(contract:GradingContractSnapshot,scope?:TaskAnswerScope):GradingTaskContext{
 return {context_version:GRADING_TASK_CONTEXT_VERSION,contract_id:contract.contractId,contract_version:contract.contractVersion,contract_hash:contract.contractHash,
  problem_id:contract.problemId,source_attempt_id:contract.sourceAttemptId,source_review_id:contract.reviewId||contract.sourceReviewId,
  learning_purpose:contract.learningPurpose,learning_stage:contract.learningStage,mode:contract.mode,review_scope:contract.reviewScope,target_kind:contract.targetKind,
  graded_part_ids:contract.gradedParts.map(p=>p.id),...(scope&&['identified','whole'].includes(scope.status)?{answer_scope:{scope_key:scope.scopeKey,status:scope.status as 'identified'|'whole',
   primary_target_parts:[...scope.primaryTargetParts],secondary_target_parts:[...scope.secondaryTargetParts],reference_only_parts:[...scope.referenceOnlyParts],excluded_parts:[...scope.excludedParts]}}:{})};
}
export const gradingTaskContextYaml=(contract?:GradingContractSnapshot)=>contract?`  task_context: ${JSON.stringify(gradingTaskContext(contract))}\n`:'';
const object=(v:unknown,label:string):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`${label} は構造化された課題情報にしてください。`);return v as Record<string,unknown>;};
const names:Record<string,string[]>={contract_id:['contract_id','contractId'],contract_version:['contract_version','contractVersion'],contract_hash:['contract_hash','contractHash'],problem_id:['problem_id','problemId'],
 source_attempt_id:['source_attempt_id','sourceAttemptId'],source_review_id:['source_review_id','sourceReviewId','reviewId','review_id'],learning_purpose:['learning_purpose','learningPurpose'],learning_stage:['learning_stage','learningStage'],
 mode:['mode'],review_scope:['review_scope','reviewScope'],target_kind:['target_kind','targetKind'],graded_part_ids:['graded_part_ids','gradedPartIds']};
function value(key:string,v:unknown):unknown{
 if(v==null||v==='')return undefined;
 if(key==='graded_part_ids'){if(!Array.isArray(v)||!v.every(x=>typeof x==='string'))throw new Error('graded_part_ids は採点項目IDの配列にしてください。');return v.map(x=>x.trim());}
 if(key==='source_attempt_id'||key==='source_review_id'){const n=Number(v);if(key==='source_review_id'&&n===0)return undefined;if(!Number.isSafeInteger(n)||n<=0)throw new Error(`${key} は有効な元記録IDにしてください。`);return n;}
 if(typeof v!=='string')throw new Error(`${key} は文字列で返してください。`);
 const text=v.trim();if(key==='target_kind'&&!['mathematical_patch','skeleton_expression_patch','full_answer'].includes(text))throw new Error(`target_kind に未対応の値があります: ${text}`);return text||undefined;
}
function fields(row:Record<string,unknown>){const out:Record<string,unknown>={};for(const [key,aliases] of Object.entries(names)){
 const candidates=aliases.filter(a=>row[a]!=null&&row[a]!=='').map(a=>value(key,row[a])).filter(v=>v!==undefined);
 if(key==='graded_part_ids'&&Array.isArray(row.gradedParts)&&row.gradedParts.every(p=>p&&typeof p==='object'&&typeof p.id==='string'))candidates.push(row.gradedParts.map(p=>p.id));
 const compare=(v:unknown)=>JSON.stringify(key==='graded_part_ids'?[...(v as string[])].sort():v);
 if(candidates.some(v=>compare(v)!==compare(candidates[0])))throw new Error(`${key} の名称違いの値が矛盾しています。`);if(candidates.length)out[key]=candidates[0];
 }return out;}
function answerScope(v:unknown):GradingAnswerScope{const row=object(v,'answer_scope'),get=(snake:string,camel:string)=>row[snake]??row[camel];
 const status=row.status,key=get('scope_key','scopeKey');if(!['identified','whole'].includes(String(status))||typeof key!=='string'||!key)throw new Error('対象小問の answer_scope.scope_key / status が不足しています。');
 const parts=(s:string,c:string,optional=false)=>{const v=get(s,c);if(optional&&v===undefined)return [];if(!Array.isArray(v)||!v.every(p=>typeof p==='string'))throw new Error(`対象小問の answer_scope.${s} が不足しています。`);return v as string[];};
 return {scope_key:key,status:status as 'identified'|'whole',primary_target_parts:parts('primary_target_parts','primaryTargetParts'),secondary_target_parts:parts('secondary_target_parts','secondaryTargetParts'),reference_only_parts:parts('reference_only_parts','referenceOnlyParts'),excluded_parts:parts('excluded_parts','excludedParts',true)};
}
/** Accept only known aliases/containers, rejecting conflicts rather than hiding them. */
export function normalizeGradingContextInput(raw:Record<string,unknown>){
 const nested=[raw.task_context==null?undefined:object(raw.task_context,'task_context'),raw.grading_contract==null?undefined:object(raw.grading_contract,'grading_contract')].filter(Boolean) as Record<string,unknown>[];
 const rows=[fields(raw),...nested.map(fields)],out={...raw};
 for(const key of Object.keys(names)){const supplied=rows.filter(r=>r[key]!==undefined).map(r=>r[key]);const signature=(v:unknown)=>JSON.stringify(key==='graded_part_ids'?[...(v as string[])].sort():v);
  if(supplied.some(v=>signature(v)!==signature(supplied[0])))throw new Error(`${key} が本文と課題コンテキストで一致しません。`);if(supplied.length)out[key]=supplied[0];
 }
 // Known GPT scope/kind confusion. full_answer is a scope, not a repair kind.
 // Keep purpose/contract identity unchanged; save-time exact contract matching
 // still verifies the persisted initial/session/transfer contract and parts.
 const fullScopeAlias=out.target_kind==='full_answer';
 if(fullScopeAlias){
  if(out.review_scope!=='full_answer'||out.mode!=='full'||!['exam_performance','transfer_check'].includes(String(out.learning_purpose))||
    !out.contract_id||!out.contract_version||!out.contract_hash||!out.problem_id||!Array.isArray(out.graded_part_ids)||!out.graded_part_ids.length)
   throw new Error('target_kind: full_answer は答案全体の範囲です。review_scope=full_answer・mode=full・学習目的・契約ID/hash・採点項目の一致が必要です。補修課題には変換できません。');
  delete out.target_kind;
 }
 if(out.source_review_id){
  if(raw.generated_from_review_id!=null&&Number(raw.generated_from_review_id)!==0&&Number(raw.generated_from_review_id)!==out.source_review_id)throw new Error('generated_from_review_id と source_review_id が一致しません。');
  if(raw.generated_from_review_id==null)out.generated_from_review_id=out.source_review_id;
 }
 if(nested.length){const echo:Record<string,unknown>={};for(const row of nested)Object.assign(echo,fields(row));
  if(fullScopeAlias)delete echo.target_kind;
  const versions=nested.map(r=>r.context_version??r.contextVersion).filter(v=>v!=null&&v!=='');if(versions.some(v=>v!==GRADING_TASK_CONTEXT_VERSION))throw new Error('task_context の形式バージョンが未対応です。現行プロンプトを使用してください。');if(versions.length)echo.context_version=versions[0];
  const scopes=nested.map(r=>r.answer_scope??r.answerScope).filter(v=>v!=null).map(answerScope);if(scopes.some(s=>JSON.stringify(s)!==JSON.stringify(scopes[0])))throw new Error('対象小問のコンテキストが矛盾しています。');if(scopes.length)echo.answer_scope=scopes[0];
  out.task_context=echo as GradingTaskContext;
 }
 return out;
}
