import type { AnswerIndexEntry, Problem, ProblemAlias, StudyUpdate } from "./types";

export type ProblemMasterPayload={version:string;problems:Partial<Problem>[]};
export type AnswerIndexPayload={version:string;answers:AnswerIndexEntry[]};
export type AliasPayload={version:string;aliases:ProblemAlias[]};
export type IntegratedMasterPayload={
  version:string;problemMaster?:ProblemMasterPayload;answerIndex?:AnswerIndexPayload;
  aliases?:AliasPayload;importGuide?:unknown;
};

const array=(value:unknown)=>Array.isArray(value)?value.map(String).map(item=>item.trim()).filter(Boolean):[];
const chapterNumber=(value:unknown)=>{
  const matched=String(value??"").match(/\d+/);
  return matched?Number(matched[0]):null;
};
const normalizedText=(value:unknown)=>String(value??"").normalize("NFKC").toLowerCase().replace(/\s+/g,"");
const canonicalId=(value:unknown)=>{
  const raw=String(value??"").toUpperCase().replace(/[‐‑‒–—―ー]/g,"-");
  const white=raw.match(/WB-(\d+)-([AS])-(\d+)/);
  if(white) return `WB-${Number(white[1])}-${white[2]}-${String(Number(white[3])).padStart(2,"0")}`;
  const past=raw.match(/PY-(\d{4})-Q(\d+)/);
  return past?`PY-${past[1]}-Q${Number(past[2])}`:raw.trim();
};
const list=(value:unknown)=>Array.isArray(value)?array(value):String(value??"").split(/[;,、\n]+/).map(v=>v.trim()).filter(Boolean);

export function parseProblemMasterPayload(raw:unknown):ProblemMasterPayload{
  const root=Array.isArray(raw)?{problems:raw}:raw as Record<string,unknown>;
  if(!root||!Array.isArray(root.problems)) throw new Error("problem_master.json に problems 配列がありません");
  const version=String(root.version||root.master_version||"mathstat-master-v1");
  const seen=new Set<string>();
  const problems=root.problems.map((entry,index)=>{
    if(!entry||typeof entry!=="object") throw new Error(`${index+1}件目がオブジェクトではありません`);
    const item=entry as Record<string,unknown>,problem_id=canonicalId(item.problem_id);
    if(!/^(WB-\d+-[AS]-\d{2}|PY-\d{4}-Q\d+)$/.test(problem_id)) throw new Error(`${index+1}件目の problem_id が不正です`);
    if(seen.has(problem_id)) throw new Error(`${problem_id} が重複しています`);
    seen.add(problem_id);
    const category=String(item.type||item.category||(problem_id.includes("-S-")?"S":problem_id.includes("-A-")?"A":"past_exam")) as Problem["category"];
    if(!["S","A","past_exam"].includes(category)) throw new Error(`${problem_id} の type は S / A / past_exam のいずれかにしてください`);
    const chapter=chapterNumber(item.chapter)??chapterNumber(problem_id.match(/^WB-(\d+)/)?.[1]);
    const problem_number=Number(item.problem_number||problem_id.match(/(?:-[AS]-|Q)(\d+)$/)?.[1]);
    const display_label=String(item.display_label||item.canonical_title||
      (category==="past_exam"?String(item.title||problem_id):`第${chapter}章${category}問${problem_number}`));
    const theme=String(item.theme||"");
    if(!theme) throw new Error(`${problem_id} の theme が空です`);
    return {
      ...item,problem_id,category,chapter,problem_number,display_label,title:String(item.canonical_title||item.title||display_label),
      canonical_title:String(item.canonical_title||display_label),canonical_problem_type:String(item.canonical_problem_type||theme),
      canonical_keywords:array(item.canonical_keywords),strategy_rank:String(item.roadmap_rank||item.strategy_rank||(category==="S"?"S":"A")),
      roadmap_rank:String(item.roadmap_rank||item.strategy_rank||(category==="S"?"S":"A")),source_book:String(item.source_book||""),
      related_s_problem_ids:list(item.related_s_problems||item.related_s_problem_ids).map(canonicalId),
      related_a_problem_ids:list(item.related_a_problems||item.related_a_problem_ids).map(canonicalId),
      related_past_exam_ids:list(item.related_past_exams||item.related_past_exam_ids).map(canonicalId),
      linked_s_problems:list(item.related_s_problems||item.related_s_problem_ids).map(canonicalId).join(";"),
      linked_a_problems:list(item.related_a_problems||item.related_a_problem_ids).map(canonicalId).join(";"),
      linked_past_exams:list(item.related_past_exams||item.related_past_exam_ids).map(canonicalId).join(";"),
      answer_available:Boolean(item.answer_available),master_version:version,theme
    } as Partial<Problem>;
  });
  return {version,problems};
}

export function parseAnswerIndexPayload(raw:unknown):AnswerIndexPayload{
  const root=Array.isArray(raw)?{answers:raw}:raw as Record<string,unknown>;
  const rows=Array.isArray(root?.answers)?root.answers:Array.isArray(root?.answer_index)?root.answer_index:null;
  if(!rows) throw new Error("answer_index.json に answers 配列がありません");
  const version=String(root.version||root.index_version||"mathstat-answers-v1"),seen=new Set<string>();
  const answers=rows.map((entry,index)=>{
    if(!entry||typeof entry!=="object") throw new Error(`${index+1}件目がオブジェクトではありません`);
    const item=entry as Record<string,unknown>,problem_id=canonicalId(item.problem_id);
    if(!problem_id) throw new Error(`${index+1}件目の problem_id が空です`);
    if(seen.has(problem_id)) throw new Error(`${problem_id} が重複しています`);
    seen.add(problem_id);
    return {problem_id,answer_available:Boolean(item.answer_available),pdf_file_name:String(item.pdf_file_name||""),
      page_start:item.page_start==null?null:Number(item.page_start),page_end:item.page_end==null?null:Number(item.page_end),
      section_label:String(item.section_label||""),answer_excerpt:String(item.answer_excerpt||""),
      canonical_keywords:array(item.canonical_keywords),index_version:version} as AnswerIndexEntry;
  });
  return {version,answers};
}

export function parseAliasesPayload(raw:unknown):AliasPayload{
  const root=Array.isArray(raw)?{aliases:raw}:raw as Record<string,unknown>;
  const version=String(root?.version||root?.alias_version||"stat1-aliases-v1");
  const source=root?.problem_aliases??root?.aliases;
  const rows:Array<Record<string,unknown>>=[];
  if(Array.isArray(source)){
    for(const entry of source){
      if(typeof entry==="string") continue;
      if(entry&&typeof entry==="object") rows.push(entry as Record<string,unknown>);
    }
  }else if(source&&typeof source==="object"){
    for(const [alias,value] of Object.entries(source as Record<string,unknown>)){
      if(typeof value==="string") rows.push({alias,problem_id:value});
      else if(value&&typeof value==="object") rows.push({alias,...value as Record<string,unknown>});
    }
  }else throw new Error("aliases.json に aliases または problem_aliases がありません");
  const seen=new Set<string>();
  const aliases=rows.map((entry,index)=>{
    const alias=String(entry.alias||entry.name||entry.from||"").trim(),problem_id=canonicalId(entry.problem_id||entry.canonical_id||entry.to);
    if(!alias||!problem_id) throw new Error(`${index+1}件目の alias / problem_id が不足しています`);
    const key=normalizedText(alias);
    if(seen.has(key)) throw new Error(`エイリアス「${alias}」が重複しています`);
    seen.add(key);
    return {alias,problem_id,label:String(entry.label||""),alias_version:version} as ProblemAlias;
  });
  return {version,aliases};
}

export function isProblemPack(raw:unknown){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return false;
  const root=raw as Record<string,unknown>;
  if(["attempts","reviews","roadmap","weakNotes","pastSessions","settings"].some(key=>key in root)) return false;
  return ["problem_master","answer_index","problem_aliases","problems","answers","aliases","import_guide"]
    .some(key=>key in root);
}

export function relatedSIntegrity(sourceProblemId:string,targetProblemId:string,canonicalRelatedIds:string[]){
  if(sourceProblemId&&sourceProblemId===targetProblemId) return {state:"self_reference" as const,recommended_action:"remove" as const};
  if(canonicalRelatedIds.includes(targetProblemId)) return {state:"valid" as const,recommended_action:"repair" as const};
  return {state:"id_review_needed" as const,recommended_action:"hold" as const};
}

export function parseIntegratedMasterPayload(raw:unknown):IntegratedMasterPayload{
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) throw new Error("統合JSONのルートはオブジェクトにしてください");
  const root=raw as Record<string,unknown>,version=String(root.version||root.pack_version||root.name||"stat1_problem_pack");
  const problemSource=root.problem_master??root.problems;
  const answerSource=root.answer_index??root.answers;
  const aliasSource=root.problem_aliases??root.aliases;
  const problemMaster=problemSource===undefined?undefined:parseProblemMasterPayload(
    Array.isArray(problemSource)?{version,problems:problemSource}:problemSource
  );
  const answerIndex=answerSource===undefined?undefined:parseAnswerIndexPayload(
    Array.isArray(answerSource)?{version,answers:answerSource}:answerSource
  );
  const aliasPayload=aliasSource&&typeof aliasSource==="object"&&!Array.isArray(aliasSource)&&
    ("aliases" in aliasSource||"problem_aliases" in aliasSource||"version" in aliasSource)
    ?aliasSource:{version,aliases:aliasSource};
  const aliases=aliasSource===undefined?undefined:parseAliasesPayload(aliasPayload);
  if(!problemMaster&&!answerIndex&&!aliases) throw new Error("problem_master / answer_index / problem_aliases を検出できません");
  return {version,problemMaster,answerIndex,aliases,importGuide:root.import_guide};
}

export function masterDiff(current:Problem[],incoming:Partial<Problem>[]){
  const existing=new Map(current.map(problem=>[problem.problem_id,problem]));
  let added=0,changed=0,unchanged=0;
  for(const item of incoming){
    const old=existing.get(String(item.problem_id));
    if(!old){added++;continue}
    const keys=["display_label","category","chapter","problem_number","theme","canonical_problem_type","canonical_keywords","strategy_rank","linked_s_problems","answer_available"] as const;
    if(keys.some(key=>JSON.stringify(old[key])!==JSON.stringify(item[key]))) changed++; else unchanged++;
  }
  return {added,changed,unchanged,total:incoming.length};
}

function keywordMatches(problem:Problem,answer:AnswerIndexEntry|undefined,text:string){
  const keywords=[...(problem.canonical_keywords||[]),...(answer?.canonical_keywords||[])];
  const unique=[...new Set(keywords.map(normalizedText).filter(Boolean))];
  return {matched:unique.filter(keyword=>normalizedText(text).includes(keyword)).length,total:unique.length};
}
function looseSimilarity(left:string,right:string){
  const a=new Set(normalizedText(left).split(/[・、,/／]/).filter(Boolean)),b=new Set(normalizedText(right).split(/[・、,/／]/).filter(Boolean));
  if(!a.size||!b.size) return 0;
  return [...a].filter(value=>[...b].some(other=>other.includes(value)||value.includes(other))).length/Math.max(a.size,b.size);
}

export function consistencyScore(update:StudyUpdate,problem:Problem,answer?:AnswerIndexEntry){
  const source=[update.main_theme,update.theme,...(update.themes||[]),update.result_summary,update.error_point,update.next_action,update.source_text].filter(Boolean).join("\n");
  const keyword=keywordMatches(problem,answer,source);
  const keywordScore=keyword.total?keyword.matched/keyword.total:.5;
  const themeScore=looseSimilarity(problem.theme,[update.main_theme,update.theme,...(update.themes||[])].filter(Boolean).join("・"));
  const labelScore=!update.display_label||normalizedText(update.display_label)===normalizedText(problem.display_label)?1:0;
  const answerScore=answer?.answer_excerpt?looseSimilarity(answer.answer_excerpt,source):.5;
  const linked=update.related_s_problem_ids||update.linked_s_problems||[];
  const canonicalLinks=problem.related_s_problem_ids||[];
  const linkScore=!linked.length ? .5 : linked.every(id=>canonicalLinks.includes(id)) ? 1 : 0;
  return Math.max(0,Math.min(1,Math.round((themeScore*.25+keywordScore*.35+labelScore*.15+answerScore*.2+linkScore*.05)*100)/100));
}

export function findBestProblemCandidate(update:StudyUpdate,problems:Problem[],answers:AnswerIndexEntry[]){
  const answerMap=new Map(answers.map(answer=>[answer.problem_id,answer]));
  return problems.map(problem=>({problem,score:consistencyScore(update,problem,answerMap.get(problem.problem_id))}))
    .sort((a,b)=>b.score-a.score)[0];
}

export function applyCanonicalMaster(update:StudyUpdate,problem:Problem,answer:AnswerIndexEntry|undefined,allProblems:Problem[],answers:AnswerIndexEntry[]){
  const rawTheme=String(update.main_theme||update.theme||(update.themes||[]).join(" / "));
  const score=consistencyScore(update,problem,answer);
  const fields:string[]=[];
  if(update.display_label!==problem.display_label) fields.push("display_label");
  if(rawTheme&&normalizedText(rawTheme)!==normalizedText(problem.theme)) fields.push("theme");
  if(update.category!==problem.category) fields.push("type");
  const best=findBestProblemCandidate(update,allProblems,answers);
  const suspect=best&&best.problem.problem_id!==problem.problem_id&&best.score>=Math.max(.55,score+.18);
  const reason=fields.length?`problem_id は ${problem.problem_id} ですが、GPT由来情報と差があるため problem_master を正として補正しました。`:"problem_master と整合しています。";
  const canonicalLinks=problem.master_version?problem.related_s_problem_ids||[]:update.related_s_problem_ids||update.linked_s_problems||[];
  return {
    ...update,problem_id:problem.problem_id,display_label:problem.display_label,category:problem.category,
    source_type:problem.source_type,chapter:problem.chapter,problem_number:problem.problem_number,
    theme:problem.theme,themes:[problem.theme],canonical_problem_type:problem.canonical_problem_type,
    canonical_keywords:problem.canonical_keywords||[],answer_excerpt:answer?.answer_excerpt||"",
    related_s_problem_ids:canonicalLinks,linked_s_problems:canonicalLinks,
    raw_gpt_problem_id:update.raw_gpt_problem_id||update.problem_id,raw_gpt_theme:rawTheme,
    auto_corrected:fields.length>0,correction_fields:fields,corrected_problem_id:problem.problem_id,
    corrected_theme:problem.theme,correction_reason:reason,consistency_score:score,
    suggested_problem_id:suspect?best.problem.problem_id:undefined,
    suggested_problem_label:suspect?best.problem.display_label:undefined,
    requires_problem_confirmation:!update.problem_id_confirmed&&(!!suspect||score<.5),master_matched:true
  } as StudyUpdate;
}
