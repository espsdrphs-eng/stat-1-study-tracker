import type {GradedFinding,GradingContractSnapshot,Problem,StudyUpdate} from './types.ts';

export const isOriginalProblemId=(id:unknown)=>typeof id==='string'&&/^ORIG-/i.test(id.trim());
export function assertOriginalAnswerDate(date:unknown,today:string){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)
  throw new Error('自作問題の答案は、実際の解答日（YYYY-MM-DD）を指定してください。');
}
const readText=(v:unknown,max:number,label:string,optional=false)=>{
 if(optional&&(v==null||v===''))return '';
 if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${label}を${max}文字以内で入力してください。`);
 return v.replace(/\r\n?/g,'\n').trim();
};

/** An ordinary problem in the existing master, not a transfer request or a new exam source. */
export async function buildOriginalExercise(input:{title?:unknown;statement?:unknown;parts?:unknown;theme?:unknown}):Promise<Problem>{
 const title=readText(input.title,120,'問題名'),statement=readText(input.statement,16000,'問題文');
 const theme=readText(input.theme,100,'分野',true);
 if(!Array.isArray(input.parts)||input.parts.length<1||input.parts.length>24)throw new Error('採点項目は1〜24個。小問番号、または区別して採点する項目を設定してください。');
 const labels=input.parts.map(p=>readText(p,120,'採点項目'));
 if(new Set(labels.map(p=>p.normalize('NFKC').replace(/\s/g,''))).size!==labels.length)throw new Error('採点項目が重複しています。');
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('stat1-original-v1\n'+statement)));
 const problem_id='ORIG-'+[...digest.slice(0,12)].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
 return {id:Date.now(),problem_id,source_type:'original',category:'original',original_exercise:{statement,parts:labels.map((label,i)=>({id:`q${i+1}`,label}))},
  chapter:null,problem_number:0,title,theme,display_label:title,priority:'repair',role:'training',recommended_mode:'full',
  linked_past_exams:'',linked_a_problems:'',linked_s_problems:'',notes:'',completion_status:'active',gradable:true};
}

export function checkOriginalGrading(contract:GradingContractSnapshot|undefined,findings:GradedFinding[]|undefined){
 if(!contract||!findings?.length)throw new Error('自作問題には現在の採点契約と各採点項目の所見が必要です。白紙は未評価として返してください。');
 const ids=new Set(findings.map(f=>f.graded_part_id));
 if(ids.size!==findings.length||ids.size!==contract.gradedParts.length||contract.gradedParts.some(p=>!ids.has(p.id)))
  throw new Error('自作問題では指定された採点項目を、重複や欠落なく1回ずつ返してください。');
 for(const f of findings)if(!f.evidence?.trim()||f.resolved&&f.error_type!=='none'||!f.resolved&&f.error_type==='none'&&f.concept_focus)
  throw new Error(`${f.graded_part_id}：採点の根拠と成功・誤答・未評価の区別を確認してください。`);
}

/** For retrospective imports no question or prompt example may assert a condition.
 * A recorded reference level > 0 remains a known exposure, not a claim of independence. */
export function knownOriginalReferences(input:StudyUpdate){
 const level=input.actual_reference_level??input.reference_level;
 return input.reference_conditions_known===true&&typeof level==='number'&&Number.isInteger(level)&&level>=0&&level<=5&&typeof input.hint_used==='boolean'&&!(level===0&&input.hint_used);
}
