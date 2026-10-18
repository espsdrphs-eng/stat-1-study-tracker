/** One compact wire schema used by the prompt and the import validator.
 * Context freshness, evidence membership and mastery proofs remain semantic gates. */
type Schema={type:'object'|'array'|'string'|'number'|'integer'|'null';properties?:Record<string,Schema>;required?:string[];items?:Schema;
 enum?:unknown[];minLength?:number;maxLength?:number;minItems?:number;maxItems?:number;uniqueItems?:boolean;minimum?:number;maximum?:number;multipleOf?:number;nullable?:boolean;pattern?:string};
const text=(max=180):Schema=>({type:'string',minLength:1,maxLength:max});
const object=(properties:Record<string,Schema>,required=Object.keys(properties)):Schema=>({type:'object',properties,required});
const rows=(item:Schema,max=3,min=0):Schema=>({type:'array',items:item,minItems:min,maxItems:max});
const refs:Schema={...rows(text(240),3,1),uniqueItems:true};
const compactSchema={
 $schema:'https://json-schema.org/draft/2020-12/schema',
 ...object({schema_version:{type:'string',enum:['stat1-coach-v2']},review_context_version:text(100),data_version:text(100),
  evidence_cutoff_attempt_id:{type:'integer',minimum:0},reviewed_at:{...text(40),pattern:'^\\d{4}-\\d{2}-\\d{2}T.*(?:Z|[+-]\\d{2}:\\d{2})$'},
  level:object({value:{type:'number',minimum:1,maximum:5,multipleOf:.5},readiness:text(100),confidence:{type:'string',enum:['low','medium','high']},refs}),
  bottleneck:object({text:text(),refs}),improvements:rows(object({text:text(),refs})),
  actions:rows(object({task_id:{...text(240),nullable:true},text:text(),success:text(140),refs})),
  unknowns:rows(object({text:text(),needed:text(140),refs})),
  ability_profiles:rows(object({id:{...text(60),pattern:'^[a-z][a-z0-9-]*$'},name:text(120),state:{type:'string',enum:['needs_practice','improving','confirmed','uncertain']},goal:text(),next:text(),
   sources:rows(object({attempt_id:{type:'integer',minimum:1},part_ids:{type:'array',items:text(200),uniqueItems:true}}),8,1)}))
 },['schema_version','review_context_version','data_version','evidence_cutoff_attempt_id','reviewed_at','level','bottleneck','improvements','actions','unknowns'])
};
export const coachCompactJsonSchema=JSON.parse(JSON.stringify(compactSchema,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)&&v.nullable?Object.fromEntries(Object.entries({...v,type:[v.type,'null']}).filter(([k])=>k!=='nullable')):v));
/** Standard JSON Schema subset above, no coercion/defaults or extra dependency.
 * `nullable` is translated to a type union in the prompt's formal schema below. */
export function validateCoachWire(value:unknown,fail:(path:string,expected:string)=>never){
 const check=(v:unknown,s:Schema,path:string)=>{
  if(v===null&&s.nullable)return;
  const valid=s.type==='object'?!!v&&typeof v==='object'&&!Array.isArray(v):s.type==='array'?Array.isArray(v):s.type==='integer'?typeof v==='number'&&Number.isSafeInteger(v):s.type==='number'?typeof v==='number'&&Number.isFinite(v):s.type==='null'?v===null:typeof v==='string';
  if(!valid)fail(path,`期待する型: ${s.type}${s.nullable?' または null':''}。欠落・空の値を推測補完せず、現在のプロンプトでJSONを再出力してください。`);
  if(s.enum&&!s.enum.includes(v))fail(path,`許可する値: ${s.enum.join(' / ')}。`);
  if(typeof v==='string'&&(!v.trim()||s.minLength!==undefined&&v.trim().length<s.minLength||s.maxLength!==undefined&&v.trim().length>s.maxLength||s.pattern&&!new RegExp(s.pattern).test(v)))fail(path,`期待する型: string（${s.minLength??1}〜${s.maxLength??180}文字、指定形式）。`);
  if(typeof v==='number'&&(s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum||s.multipleOf!==undefined&&v/s.multipleOf!==Math.trunc(v/s.multipleOf)))fail(path,`期待する値: ${s.minimum}〜${s.maximum??'上限なし'}${s.multipleOf?`、${s.multipleOf}刻み`:''}。`);
  if(Array.isArray(v)){if(v.length<(s.minItems??0)||v.length>(s.maxItems??Infinity)||s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)fail(path,`期待する型: array（${s.minItems??0}〜${s.maxItems}件、重複なし）。`);v.forEach((x,i)=>s.items&&check(x,s.items,`${path}.${i}`));}
  if(s.type==='object'){const o=v as Record<string,unknown>;for(const key of s.required||[])if(!(key in o))fail(`${path}.${key}`,`必須項目です。期待する型: ${s.properties?.[key]?.type}。`);for(const[key,child]of Object.entries(s.properties||{}))if(key in o)check(o[key],child,`${path}.${key}`);}
 };
 check(value,compactSchema,'coach_update');
}
export function coachSchemaForPrompt(){
 // JSON Schema uses a union, not OpenAPI's nullable keyword.
 return coachCompactJsonSchema;
}
