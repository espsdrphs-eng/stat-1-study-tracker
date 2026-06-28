import yaml from "js-yaml";
import type { Problem, StudyUpdate } from "./types";
import { japaneseizeMathText } from "./mathJapanese.ts";

const errorIntervals:Record<string,number>={K:1,N:2,W:3,C:7,none:14};
const errorPriority=["K","N","W","C"];

export const todayString=()=>new Intl.DateTimeFormat("sv-SE",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());

export function canonicalProblemId(value:string){
  const cleaned=value.replace(/[“”"'`]/g,"").replace(/[‐‑‒–—―ー]/g,"-");
  const white=cleaned.match(/WB-(\d+)-([AS])-(\d+)/i);
  if(white) return `WB-${Number(white[1])}-${white[2].toUpperCase()}-${String(Number(white[3])).padStart(2,"0")}`;
  const past=cleaned.match(/PY-(\d{4})-Q(\d+)/i);
  if(past) return `PY-${past[1]}-Q${Number(past[2])}`;
  return cleaned.trim().toUpperCase();
}

export function problemDisplayLabel(problem:Problem){
  if(problem.display_label) return problem.display_label;
  if(problem.source_type==="past_exam") {
    const year=problem.problem_id.match(/PY-(\d{4})/)?.[1];
    return year?`${year}年問${problem.problem_number}`:problem.title;
  }
  const base=`第${problem.chapter}章${problem.category}問${problem.problem_number}`;
  return problem.difficulty!=null?`${base}（難${problem.difficulty}）`:base;
}

function scalar(value:unknown){
  if(Array.isArray(value)) return value.join(" / ");
  return value==null?"":String(value);
}
function stringArray(value:unknown){
  if(Array.isArray(value)) return value.map(String).map(x=>x.trim()).filter(Boolean);
  return scalar(value).split(/[;,、\n]+/).map(x=>x.trim()).filter(Boolean);
}
function markFromScore(score:number|null|undefined){
  if(score==null||Number.isNaN(score)) return "△";
  return score>=90?"◎":score>=75?"○":score>=50?"△":"×";
}
function scoreLabel(scoreText:string,score:number|null|undefined){
  const label=scoreText.match(/[SABC]/i)?.[0].toUpperCase();
  if(label) return label;
  if(score==null) return "B";
  return score>=90?"S":score>=75?"A":score>=50?"B":"C";
}
function normalizeErrors(values:unknown){
  const found=Array.isArray(values)
    ? values.flatMap(x=>String(x).toUpperCase().match(/\b[KWNC]\b/g)||[])
    : String(values||"").toUpperCase().match(/\b[KWNC]\b/g)||[];
  return [...new Set(found)];
}
function normalizeMode(value:unknown,text:string){
  const raw=scalar(value).trim();
  if(["skeleton","main_calc","full","scan","exam_90min"].includes(raw)) return raw;
  if(/90分|3問答案/.test(raw)) return "exam_90min";
  if(/5問スキャン|選題|スキャン/.test(raw)) return "scan";
  if(/主要計算|途中式/.test(raw)) return "main_calc";
  if(/骨格/.test(raw)) return "skeleton";
  if(/詳細|総合|フル|答案/.test(raw)) return "full";
  return inferMode(text);
}
function inferMode(text:string){
  if(/90\s*分|3\s*問答案/.test(text)) return "exam_90min";
  if(/5\s*問スキャン|選題/.test(text)) return "scan";
  if(/総合評価|点数|記述|本番で選ぶべきか/.test(text)) return "full";
  if(/主要計算|途中式/.test(text)) return "main_calc";
  if(/骨格答案|骨格/.test(text)) return "skeleton";
  return "full";
}
function parseThemes(raw:string){
  const values=raw.split(/[、,／/]+/).map(x=>x.trim()).filter(Boolean);
  const result:string[]=[];
  for(const value of values){
    if(/平均[・･]分散[・･]積率母関数の非存在/.test(value)){
      result.push("平均の非存在","分散の非存在","積率母関数の非存在");
    }else result.push(value);
  }
  return [...new Set(result)];
}
function extractLine(text:string,label:RegExp){
  const match=text.match(new RegExp(`(?:^|\\n)\\s*(?:[*・-]\\s*)?(?:${label.source})\\s*[：:]\\s*([^\\n]+)`,"im"));
  return match?.[1]?.trim()||"";
}
function parseRelatedS(text:string,chapter:number|null){
  const line=extractLine(text,/関連S問題/);
  if(!line) return [];
  const ids=[...line.matchAll(/WB-(\d+)-S-(\d+)/gi)].map(m=>canonicalProblemId(m[0]));
  let currentChapter=chapter;
  for(const match of line.matchAll(/(?:第\s*(\d+)\s*章\s*)?S(?:問題|問)?\s*(\d+)/gi)){
    if(match[1]) currentChapter=Number(match[1]);
    if(currentChapter!=null) ids.push(`WB-${currentChapter}-S-${String(Number(match[2])).padStart(2,"0")}`);
  }
  return [...new Set(ids)];
}
function deriveCandidate(text:string){
  const direct=text.match(/\b(?:WB-\d+-[AS]-\d+|PY-\d{4}-Q\d+)\b/i)?.[0];
  if(direct) return canonicalProblemId(direct);
  const past=text.match(/(\d{4})\s*年\s*問\s*(\d+)/);
  if(past) return `PY-${past[1]}-Q${Number(past[2])}`;
  const chapter=Number(text.match(/第\s*(\d+)\s*章/)?.[1]);
  const typeLine=extractLine(text,/問題の種類/);
  const category=(typeLine.match(/[AS]/i)?.[0]||text.match(/第\s*\d+\s*章(?:[^。\n]*?)\b([AS])(?:問題)?\b/i)?.[1]||text.match(/第\s*\d+\s*章\s*([AS])\s*(?:問題)?\s*問/i)?.[1])?.toUpperCase();
  const explicitNumber=extractLine(text,/問題/).match(/問\s*(\d+)/)?.[1];
  const inlineNumber=text.match(/第\s*\d+\s*章(?:[^。\n]*?)[AS](?:問題)?\s*(?:に|の)?[^。\n]*?問\s*(\d+)/i)?.[1]
    ||text.match(/第\s*\d+\s*章\s*[AS]\s*問\s*(\d+)/i)?.[1];
  const number=Number(explicitNumber||inlineNumber);
  return chapter&&category&&number?`WB-${chapter}-${category}-${String(number).padStart(2,"0")}`:"";
}
function matchMaster(candidate:string,problems:Problem[]){
  const normalized=canonicalProblemId(candidate);
  return problems.find(p=>canonicalProblemId(p.problem_id)===normalized);
}
function difficultyFrom(text:string){
  const value=text.match(/(?:難易度|難)\s*[：:、,]?\s*(\d+)/)?.[1];
  return value?Number(value):null;
}
function weakNoteFromText(text:string,problemId:string,primary:string,themes:string[]){
  const maxGap=text.match(/最大のズレ\s*[：:]\s*([^\n]+)/)?.[1]?.trim();
  if(/対称/.test(text)&&/E\[\|X\|\]/.test(text)){
    return {
      theme:[themes.find(x=>/コーシー/.test(x))||"",themes.find(x=>/平均/.test(x))||"平均の非存在"].filter(Boolean).join("・"),
      error_type:primary==="none"?"N":primary,
      mistake:"対称性から平均を0と判断しそうになった",
      correction_rule:"対称分布でも、期待値を0と書く前に絶対可積分性を確認する。E[|X|]が発散する場合、平均は存在しない。"
    };
  }
  if(!maxGap) return undefined;
  return {
    theme:themes.slice(0,2).join("・"),
    error_type:primary,
    mistake:maxGap,
    correction_rule:"誤りの前提条件を確認し、結論を書く前に根拠を答案上へ明記する。"
  };
}

function normalizeUpdate(raw:Record<string,unknown>,text:string,problems:Problem[]):StudyUpdate{
  const candidate=canonicalProblemId(scalar(raw.problem_id)||deriveCandidate(text));
  const master=matchMaster(candidate,problems);
  const chapter=master?.chapter??(Number(raw.chapter)||null);
  const category=(master?.category||scalar(raw.category)||(/-S-/.test(candidate)?"S":/-A-/.test(candidate)?"A":candidate.startsWith("PY-")?"past_exam":"A")) as StudyUpdate["category"];
  const problemNumber=master?.problem_number??(Number(raw.problem_number)||0);
  const parsedDifficulty=raw.difficulty==null?difficultyFrom(text):Number(raw.difficulty);
  const difficulty=master?.difficulty??(Number.isFinite(parsedDifficulty)?parsedDifficulty:null);
  const rawThemes=raw.theme??raw.themes??extractLine(text,/主テーマ/);
  const themes=Array.isArray(rawThemes)?rawThemes.map(String):parseThemes(scalar(rawThemes));
  const relatedRaw=raw.related_s_problem_ids??raw.linked_s_problems??raw.linked_s_problem;
  const related=relatedRaw?stringArray(relatedRaw).map(canonicalProblemId):parseRelatedS(text,chapter);
  const ignored=stringArray(raw.ignored_parts??extractLine(text,/今回無視する部分/));
  const scoreText=scalar(raw.score_text)||extractLine(text,/段階評価|総合評価/).match(/[SABC][+-]?/i)?.[0]?.toUpperCase()||"";
  const scoreMatch=text.match(/点数\s*[：:]\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  const scoreNumeric=raw.score_numeric!=null?Number(raw.score_numeric):scoreMatch?Number(scoreMatch[1]):null;
  const scoreMax=raw.score_max!=null?Number(raw.score_max):scoreMatch?Number(scoreMatch[2]):scoreNumeric!=null?100:null;
  const diagnostic=extractLine(text,/該当/);
  const errors=normalizeErrors(raw.error_types??raw.primary_error_type??raw.error_type??diagnostic);
  const shortestError=[...errors].sort((a,b)=>errorPriority.indexOf(a)-errorPriority.indexOf(b))[0]||"none";
  const primary=scalar(raw.primary_error_type)||shortestError;
  const secondary=scalar(raw.secondary_error_type)||errors.find(error=>error!==primary)||"";
  const days=raw.review_after_days!=null?Number(raw.review_after_days):(errorIntervals[shortestError]??14);
  const mark=scalar(raw.mark)||markFromScore(scoreNumeric);
  const rawResultSummary=scalar(raw.result_summary)||extractLine(text,/最終結論/);
  const resultSummary=japaneseizeMathText(rawResultSummary);
  const examRank=scalar(raw.exam_selection_rank)||extractLine(text,/本番で選ぶべきか/).match(/[SABC]/i)?.[0]?.toUpperCase()||"";
  const mode=normalizeMode(raw.mode,text);
  const inferredPoint=/平均/.test(text)&&/MGF|積率母関数/.test(text)?"平均非存在とMGF非存在の示し方が答案として粗い":text.match(/最大のズレ\s*[：:]\s*([^\n]+)/)?.[1]?.trim()||"";
  const rawErrorPoint=scalar(raw.error_point)||inferredPoint;
  const rawNextAction=scalar(raw.next_action)||(/E\[\|X\|\]/.test(text)?"E[|X|]の発散計算を再演習し、平均の存在条件をノート化する。":"抽出内容を確認し、誤りの根拠を再演習する。");
  const errorPoint=japaneseizeMathText(rawErrorPoint);
  const nextAction=japaneseizeMathText(rawNextAction);
  const weak=raw.weak_note&&typeof raw.weak_note==="object"
    ? raw.weak_note as StudyUpdate["weak_note"]
    : weakNoteFromText(text,candidate,primary,themes);
  const weakNotes=Array.isArray(raw.weak_notes)?raw.weak_notes.map(item=>{
    if(item&&typeof item==="object"){
      const note=item as Record<string,unknown>;
      return {theme:scalar(note.theme)||themes.slice(0,2).join("・"),error_type:scalar(note.error_type)||primary,
        mistake:japaneseizeMathText(scalar(note.mistake)||scalar(note.correction_rule)),
        correction_rule:japaneseizeMathText(scalar(note.correction_rule)||scalar(note.mistake))};
    }
    const rule=japaneseizeMathText(scalar(item));
    return {theme:themes.slice(0,2).join("・")||master?.theme||"",error_type:primary,mistake:rule,correction_rule:rule};
  }).filter(note=>note.mistake):weak?[weak]:[];
  const localizedWeakNotes=weakNotes.map(note=>({
    ...note,mistake:japaneseizeMathText(note.mistake),correction_rule:japaneseizeMathText(note.correction_rule)
  }));
  const display=master?problemDisplayLabel({...master,difficulty}):candidate.startsWith("PY-")
    ? `${candidate.match(/PY-(\d{4})/)?.[1]}年問${problemNumber}`
    : chapter&&category?`第${chapter}章${category}問${problemNumber}${difficulty!=null?`（難${difficulty}）`:""}`:candidate;
  const confidence=[candidate,master,scoreText||scoreNumeric!=null,errors.length,themes.length].filter(Boolean).length/5;
  return {
    problem_id:candidate,date:scalar(raw.date)==="auto_today"||!raw.date?todayString():scalar(raw.date),
    mode,mark,score_label:scoreLabel(scoreText,scoreNumeric),error_type:primary,error_point:errorPoint,next_action:nextAction,
    display_label:scalar(raw.display_label)||display,source_type:master?.source_type||(candidate.startsWith("PY-")?"past_exam":"whitebook"),
    category,chapter,problem_number:problemNumber,difficulty,themes,theme:themes.join(" / "),
    related_s_problem_ids:related,linked_s_problems:related,linked_s_problem:related.join(";"),
    linked_past_exams:stringArray(raw.linked_past_exams),ignored_parts:ignored,score_text:scoreText,
    score_numeric:scoreNumeric,score_max:scoreMax,result_summary:resultSummary,exam_selection_rank:examRank,
    error_types:errors,primary_error_type:primary,secondary_error_type:secondary,
    review_after_days:days,review_reason:shortestError==="none"?"ミス分類なしのため14日後":`${shortestError}が含まれるため${days}日後`,
    weak_note:localizedWeakNotes[0],weak_notes:localizedWeakNotes,correction_rule:localizedWeakNotes[0]?.correction_rule,source_text:text,auto_imported:true,
    import_confidence:Math.round(confidence*100)/100,master_matched:!!master,status:"review_required",
    math_localized:rawResultSummary!==resultSummary||rawErrorPoint!==errorPoint||rawNextAction!==nextAction||
      weakNotes.some((note,index)=>note.mistake!==localizedWeakNotes[index]?.mistake||note.correction_rule!==localizedWeakNotes[index]?.correction_rule)
  };
}

function extractStructured(text:string){
  const marker=text.search(/(?:^|\n)study_updates?:\s*(?:\n|$)/m);
  if(marker<0) return null;
  const source=text.slice(marker).trim().replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
    .replace(/^\s*```(?:yaml|yml)?\s*$/gim,"").replace(/\t/g,"  ").trim();
  const lines=source.split(/\r?\n/);
  const firstContent=lines.slice(1).find(line=>line.trim());
  const forced=[lines[0],...lines.slice(1).map(line=>line.trim()?`  ${line.trimStart()}`:line)].join("\n");
  const repaired=firstContent&&!/^\s/.test(firstContent)
    ? [lines[0],...lines.slice(1).map(line=>line.trim()?`  ${line}`:line)].join("\n")
    : source;
  try{return yaml.load(repaired,{schema:yaml.JSON_SCHEMA})}
  catch(error){
    if(forced!==repaired) return yaml.load(forced,{schema:yaml.JSON_SCHEMA});
    throw error;
  }
}

export function parseStudyText(text:string,problems:Problem[]){
  const structured=extractStructured(text);
  if(structured&&typeof structured==="object"){
    const obj=structured as Record<string,unknown>;
    let rows:unknown[]=Array.isArray(obj.study_updates)?obj.study_updates:obj.study_update?[obj.study_update]:[];
    // GPTやコピー元がインデントを落とすと study_update が null になり、
    // 各フィールドがトップレベルへ展開される。そこも1件として受け入れる。
    if(!rows.length&&obj.problem_id) rows=[obj];
    const updates=rows.filter(x=>x&&typeof x==="object").map(x=>normalizeUpdate(x as Record<string,unknown>,text,problems));
    if(updates.length) return {structured:true,updates};
  }
  const candidate=deriveCandidate(text);
  if(!candidate) return {structured:false,updates:[] as StudyUpdate[]};
  return {structured:false,updates:[normalizeUpdate({},text,problems)]};
}

export function applyProblemMaster(update:StudyUpdate,problem:Problem):StudyUpdate{
  return {
    ...update,problem_id:problem.problem_id,display_label:problemDisplayLabel(problem),source_type:problem.source_type,
    category:problem.category,chapter:problem.chapter,problem_number:problem.problem_number,
    difficulty:problem.difficulty??null,master_matched:true
  };
}
