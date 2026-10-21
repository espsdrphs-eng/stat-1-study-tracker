/** Raw correspondence is an archive, not grading evidence. No inference from prose. */
export type GPTExchange={schemaVersion:'STAT1-GPT-EXCHANGE-v1';id:string;createdAt:string;
 kind:'consultation'|'grading'|'planning'|'assessment';problemId:string|null;note:string;rawText:string;rawHash:string;
 confirmedByUser:true;status:'raw_only'};
export const GPT_EXCHANGE_PREFIX='gpt-exchange:v1:';
export async function prepareGPTExchange(body:Record<string,unknown>):Promise<GPTExchange>{
 if(body.confirmedByUser!==true)throw new Error('原文と対象を確認し、確認欄をチェックしてください。');
 if(typeof body.rawText!=='string'||!body.rawText.trim())throw new Error('GPTの回答原文を貼り付けてください。');
 if(body.rawText.length>2_000_000)throw new Error('原文が長すぎます。1回の回答（200万文字以内）に分けて保存してください。');
 if(!['consultation','grading','planning','assessment'].includes(String(body.kind)))throw new Error('記録の用途を選んでください。');
 const problemId=body.problemId==null||body.problemId===''?null:String(body.problemId);
 const rawText=body.rawText,note=typeof body.note==='string'?body.note:'';
 const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const rawHash=await hash(rawText),id=await hash(JSON.stringify({rawText,kind:body.kind,problemId,note}));
 return {schemaVersion:'STAT1-GPT-EXCHANGE-v1',id,createdAt:new Date().toISOString(),kind:body.kind as GPTExchange['kind'],
  problemId,note,rawText,rawHash,confirmedByUser:true,status:'raw_only'};
}
