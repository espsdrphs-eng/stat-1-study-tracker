import {normalizeCompatibleJson} from './jsonSyntax.ts';

type Change={path:string;before:string;after:string;needsConfirmation:boolean};
export type CoachJsonRepair={json:string;changes:Change[];missingImprovements:boolean};
/** A proposal, never an import. Only the known v2 string-array delimiters may
 * be restored. A missing improvements judgment needs explicit human consent.
 * Everything else must parse strictly; no identity, prose, score or fact edits. */
export function proposeCoachJsonRepair(input:string):CoachJsonRepair|null{
 if(input.length>2_000_000)throw new Error('回答が長すぎます。1回の評価に分けてください。');
 const raw=input.trim(),fence=raw.match(/^```json\s*([\s\S]*?)\s*```$/i),source=normalizeCompatibleJson(fence?.[1]??raw).json;
 let i=0,missingImprovements=false;const changes:Change[]=[];
 const fail=(path:string):never=>{throw new Error(`${path}：括弧だけでは修正できません。修正依頼で内容を確認してください。`)};
 const space=()=>{while(/[\t\r\n ]/.test(source[i]||'x'))i++};
 const string=(path:string):string=>{
  if(source[i]!=='"')return fail(path);const start=i++;let escaped=false;
  while(i<source.length){const c=source[i++];if(escaped){escaped=false;continue}if(c==='\\'){escaped=true;continue}if(c==='"'){try{return JSON.parse(source.slice(start,i)) as string}catch{return fail(path)}}}return fail(path);
 };
 const arrayField=(path:string)=>/^\$\.coach_update\.(?:level|bottleneck)\.refs$/.test(path)||/^\$\.coach_update\.(?:improvements|actions|unknowns)\.\d+\.refs$/.test(path)||/^\$\.coach_update\.ability_profiles\.\d+\.sources\.\d+\.part_ids$/.test(path);
 const value=(path:string,depth:number):unknown=>{
  if(depth>64)fail(path);space();const c=source[i];
  if(c==='"')return string(path);
  if(c==='{'){
   const object:Record<string,unknown>=Object.create(null);i++;space();if(source[i]==='}'){i++;return object}
   while(i<source.length){
    const key=string(path),child=`${path}.${key}`;if(Object.hasOwn(object,key))fail(child);space();if(source[i++]!==':')fail(child);space();
    if(child==='$.coach_update.improvements'&&[',','}'].includes(source[i])){
     object[key]=[];missingImprovements=true;changes.push({path:child,before:'値が未記載',after:'[]（改善点の報告なし）',needsConfirmation:true});
    }else{
     let result=value(child,depth+1);
     if(arrayField(child)&&typeof result==='string'){
      const values=[result];space();
      while(source[i]===','){
       const checkpoint=i;i++;space();if(source[i]!=='"'){i=checkpoint;break}
       const next=string(child);space();if(source[i]===':'){i=checkpoint;break}
       values.push(next);if(values.length>100)fail(child);
      }
      changes.push({path:child,before:values.map(v=>JSON.stringify(v)).join(', '),after:JSON.stringify(values),needsConfirmation:false});result=values;
     }
     object[key]=result;
    }
    space();if(source[i]==='}'){i++;return object}if(source[i++]!==',')fail(child);space();
   }return fail(path);
  }
  if(c==='['){const values:unknown[]=[];i++;space();if(source[i]===']'){i++;return values}while(i<source.length){values.push(value(`${path}.${values.length}`,depth+1));space();if(source[i]===']'){i++;return values}if(source[i++]!==',')fail(path);space()}return fail(path)}
  const token=source.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
  if(!token)return fail(path);i+=token.length;const v:unknown=JSON.parse(token);if(typeof v==='number'&&!Number.isFinite(v))fail(path);return v;
 };
 const result=value('$',0) as {coach_update?:{schema_version?:string}};space();if(i!==source.length||result?.coach_update?.schema_version!=='stat1-coach-v2')fail('$');
 return changes.length?{json:JSON.stringify(result,null,2),changes,missingImprovements}:null;
}

/** Both endpoints derive the proposal again from the exact original. The
 * browser cannot supply an arbitrary replacement under a recovery flag. Full
 * schema, context and evidence checks still run on the resulting JSON. */
export function resolveCoachImport(body:Record<string,unknown>){
 const originalText=String(body.text||body.yaml||'');
 if(body.format_recovery===undefined)return {text:originalText,originalText,note:''};
 const confirmation=body.format_recovery as {confirmed?:boolean;empty_improvements?:boolean}|null;
 if(!confirmation||confirmation.confirmed!==true)throw new Error('形式修正の内容を確認してください。');
 const proposal=proposeCoachJsonRepair(originalText);if(!proposal)throw new Error('確認対象の形式修正がありません。通常のプレビューを使用してください。');
 if(proposal.missingImprovements&&confirmation.empty_improvements!==true)throw new Error('改善点が未記載です。報告なしとして扱う確認、またはChatGPTへの再確認が必要です。');
 return {text:proposal.json,originalText,note:'本人確認済みの形式修正（原文は別途保管）: '+JSON.stringify({changes:proposal.changes,emptyImprovementsConfirmed:proposal.missingImprovements})};
}
