export type DraftStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const transferDraftKey=(key:string,stage:string)=>`stat1:transfer-input:v1:${key}:${stage}`;
export function transferInputStage(status:string){return status==='validation_pending'?'quality':['submitted','problem_pending','graded'].includes(status)?'grading':'generation'}
export function readTransferDraft(store:DraftStore,key:string,status:string){return store.getItem(transferDraftKey(key,transferInputStage(status)))||''}
export function writeTransferDraft(store:DraftStore,key:string,status:string,text:string){const id=transferDraftKey(key,transferInputStage(status));if(text)store.setItem(id,text);else store.removeItem(id)}
export type TransferPreparation={referenceLevel:number;minutes:string};
export function readTransferPreparation(store:DraftStore,key:string):TransferPreparation{
 const text=store.getItem(transferDraftKey(key,'preparation'));if(!text)return {referenceLevel:0,minutes:''};
 const value=JSON.parse(text);if(!value||![0,3].includes(value.referenceLevel)||typeof value.minutes!=='string')throw new Error('参照記録の一時保存を確認できません。');return value;
}
export function writeTransferPreparation(store:DraftStore,key:string,value:TransferPreparation){store.setItem(transferDraftKey(key,'preparation'),JSON.stringify(value))}
