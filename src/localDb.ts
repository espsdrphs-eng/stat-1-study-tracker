import Dexie, { type EntityTable } from "dexie";
import type { Attempt, Bootstrap, PastSession, Problem, Review, Roadmap, StudyUpdate, WeakNote } from "./types";

type SMemory = { problem_id:string; state:"stable"|"check"|"forgotten"|"collapsed"; last_touched?:string; k_trigger_count:number };
type StoredAttempt = Attempt;
type StoredReview = Review;
type StoredWeakNote = WeakNote;
type StoredPastSession = PastSession;

class StudyDatabase extends Dexie {
  problems!: EntityTable<Problem,"problem_id">;
  attempts!: EntityTable<StoredAttempt,"id">;
  reviews!: EntityTable<StoredReview,"id">;
  roadmap!: EntityTable<Roadmap,"order_index">;
  weakNotes!: EntityTable<StoredWeakNote,"id">;
  pastSessions!: EntityTable<StoredPastSession,"id">;
  sMemory!: EntityTable<SMemory,"problem_id">;
  meta!: EntityTable<{key:string;value:string},"key">;
  constructor() {
    super("stat-1-study-tracker");
    this.version(1).stores({
      problems:"&problem_id,category,chapter,priority,completion_status",
      attempts:"++id,problem_id,date,error_type,mark,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    });
  }
}

export const db = new StudyDatabase();

const roadmapSeed:[number,number,string,string][] = [
  [6,5,"MLE・AIC・制約付き推定","full"],[6,19,"回帰","full"],[6,20,"回帰","full"],
  [6,23,"推定・尤度","main_calc"],[6,26,"Fisher情報量","main_calc"],[6,29,"非正則推定","full"],
  [2,24,"変数変換","full"],[2,20,"期待値","full"],[2,3,"分布関数","full"],[2,6,"分布関数","full"],
  [4,5,"多次元・畳み込み","full"],[4,6,"多次元分布","full"],[4,23,"条件付き分布","full"],
  [4,26,"変数変換・ヤコビアン","full"],[4,34,"ポアソン条件付き","full"],
  [3,11,"パレート分布","full"],[3,12,"パレート分布","full"],[3,20,"代表分布","full"],
  [5,18,"順序統計量・最小値","full"],[5,21,"順序統計量","full"],[5,26,"順序統計量・最大値","full"],[5,28,"極値・漸近","full"],
  [6,10,"非正則推定","full"],[6,32,"非正則推定","full"],
  [7,4,"exact検定","full"],[7,8,"尤度比検定 LRT","full"],[7,7,"検定","full"],
  [7,19,"検定","full"],[7,21,"分散検定","full"],[7,22,"回帰検定","full"],
  [8,13,"信頼区間","full"],[8,14,"信頼区間","full"],[8,10,"区間推定","full"]
];
const blocks:[number,number,string][] = [
  [1,6,"第6章A：推定・回帰・尤度"],[7,10,"第2章A：分布関数・期待値・変数変換"],
  [11,15,"第4章A：多次元・条件付き・和積変換"],[16,18,"第3章A：代表分布"],
  [19,22,"第5章A：順序統計量・極値・漸近"],[23,24,"第6章A戻り：非正則推定"],
  [25,30,"第7章A：検定"],[31,33,"第8章A：区間推定"]
];
const sSeed:[number,number,string][] = [
  [6,4,"AIC・自由度"],[6,21,"回帰・推定"],[6,22,"回帰・分散分解"],
  [4,7,"変数変換・ヤコビアン"],[5,13,"順序統計量"],[5,17,"最大値・最小値"],
  [7,9,"exact検定"],[7,10,"尤度比検定"]
];
const sLinks:Record<string,string> = {
  "WB-6-A-05":"WB-6-S-04","WB-6-A-19":"WB-6-S-21;WB-6-S-22","WB-6-A-20":"WB-6-S-21;WB-6-S-22",
  "WB-4-A-26":"WB-4-S-07","WB-5-A-18":"WB-5-S-13;WB-5-S-17","WB-5-A-21":"WB-5-S-13",
  "WB-5-A-26":"WB-5-S-13;WB-5-S-17","WB-7-A-04":"WB-7-S-09","WB-7-A-08":"WB-7-S-10"
};
const repairRules:[string,string[],string[]][] = [
  ["AIC・自由度",["WB-6-A-05"],["WB-6-S-04"]],["回帰",["WB-6-A-19","WB-6-A-20"],["WB-6-S-21","WB-6-S-22"]],
  ["Fisher情報量",["WB-6-A-26"],[]],["非正則推定",["WB-6-A-10","WB-6-A-29"],[]],
  ["順序統計量",["WB-5-A-18","WB-5-A-21","WB-5-A-26"],["WB-5-S-13","WB-5-S-17"]],
  ["最小値・最大値",["WB-5-A-18","WB-5-A-26"],["WB-5-S-17"]],["ポアソン条件付き",["WB-4-A-34"],[]],
  ["変数変換",["WB-2-A-24","WB-4-A-26"],["WB-4-S-07"]],["パレート",["WB-3-A-11","WB-3-A-12"],[]],
  ["exact検定",["WB-7-A-04"],["WB-7-S-09"]],["LRT",["WB-7-A-08"],["WB-7-S-10"]],
  ["回帰検定",["WB-7-A-22"],[]],["信頼区間",["WB-8-A-13","WB-8-A-14"],[]]
];

const loadFor=(mode:string)=>({skeleton:.5,main_calc:.8,full:1.2,scan:.6,exam_90min:3}[mode]??.5);
const todayString=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const addDays=(date:string,days:number)=>{
  const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+Number(days));
  return new Intl.DateTimeFormat("sv-SE",{year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
};
const list=(value="")=>String(value).split(/[;,、\s]+/).map(x=>x.trim()).filter(Boolean);

async function initialize() {
  if(await db.meta.get("seeded")) return;
  await db.transaction("rw",db.problems,db.roadmap,db.sMemory,db.meta,async()=>{
    const problems:Problem[]=roadmapSeed.map(([chapter,number,theme,mode],i)=>{
      const problem_id=`WB-${chapter}-A-${String(number).padStart(2,"0")}`;
      return {id:i+1,problem_id,source_type:"whitebook",category:"A",chapter,problem_number:number,title:`第${chapter}章 A${number}`,theme,priority:i<15?"core":"semi_core",role:"training",recommended_mode:mode,linked_past_exams:"",linked_s_problems:sLinks[problem_id]||"",linked_a_problems:"",notes:"",completion_status:"active"};
    });
    let id=problems.length+1;
    for(const [chapter,number,theme] of sSeed){
      const problem_id=`WB-${chapter}-S-${String(number).padStart(2,"0")}`;
      problems.push({id:id++,problem_id,source_type:"whitebook",category:"S",chapter,problem_number:number,title:`第${chapter}章 S${number}`,theme,priority:"repair",role:"foundation",recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active"});
    }
    problems.push({id:id++,problem_id:"PY-2025-Q1",source_type:"past_exam",category:"past_exam",chapter:null,problem_number:1,title:"2025年 問1",theme:"AIC・区分的密度・MLE",priority:"core",role:"exam",recommended_mode:"scan",linked_past_exams:"",linked_s_problems:"WB-6-S-04",linked_a_problems:"WB-6-A-05",notes:"",completion_status:"active"});
    await db.problems.bulkAdd(problems);
    await db.sMemory.bulkAdd(sSeed.map(([chapter,number])=>({problem_id:`WB-${chapter}-S-${String(number).padStart(2,"0")}`,state:"stable",k_trigger_count:0})));
    await db.roadmap.bulkAdd(roadmapSeed.map(([chapter,number,,mode],i)=>({id:i+1,order_index:i+1,problem_id:`WB-${chapter}-A-${String(number).padStart(2,"0")}`,block_name:blocks.find(([from,to])=>i+1>=from&&i+1<=to)![2],expected_mode:mode,load_score:loadFor(mode),is_active:1})));
    await db.meta.add({key:"seeded",value:"1"});
  });
}

function reviewDays(input:StudyUpdate) {
  if(input.review_after_days!==undefined&&input.review_after_days!=="") return Number(input.review_after_days);
  if(input.error_type!=="none") return ({K:1,W:3,N:2,C:7} as Record<string,number>)[input.error_type]??1;
  return input.mark==="◎"?30:input.mark==="○"?14:input.mark==="△"?3:1;
}
function reviewType(input:StudyUpdate){return input.error_type==="K"?"skeleton_retry":input.error_type==="W"?"main_calc_retry":input.mode==="full"?"full_retry":"skeleton_retry"}

async function saveAttempt(input:StudyUpdate&Record<string,unknown>) {
  const problem=await db.problems.get(input.problem_id);
  if(!problem) throw new Error(`未登録の問題IDです: ${input.problem_id}`);
  const date=input.date||todayString();
  const id=Number(await db.attempts.add({
    id:undefined as unknown as number,problem_id:input.problem_id,date,mode:input.mode||problem.recommended_mode,
    time_minutes:Number(input.time_minutes||0),mark:input.mark||"△",score_label:input.score_label||"B",
    error_type:input.error_type||"none",error_point:input.error_point||"",next_action:input.next_action||"",memo:String(input.memo||"")
  }));
  const attempts=(await db.attempts.where("problem_id").equals(input.problem_id).sortBy("date")).filter(x=>x.id!==id);
  const previous=attempts.at(-1);
  if(input.mark==="◎"&&previous?.mark==="◎") await db.problems.update(input.problem_id,{completion_status:"completed"});
  else await db.reviews.add({id:undefined as unknown as number,problem_id:input.problem_id,due_date:addDays(date,reviewDays(input)),review_type:reviewType(input),status:"pending",generated_from_attempt_id:id});
  if(input.error_type!=="none"&&input.error_point) await db.weakNotes.add({
    id:undefined as unknown as number,date,problem_id:input.problem_id,error_type:input.error_type,
    theme:input.theme||problem.theme,mistake:input.error_point,correction_rule:input.correction_rule||input.next_action||"",is_resolved:0
  });
  if(input.error_type==="K"){
    const related=[...new Set([...list(input.linked_s_problem),...list(problem.linked_s_problems)])];
    for(const sid of related){
      if(!await db.problems.get(sid)) continue;
      await db.reviews.add({id:undefined as unknown as number,problem_id:sid,due_date:date,review_type:"s_check",status:"pending",generated_from_attempt_id:id});
      const memory=await db.sMemory.get(sid);
      await db.sMemory.put({problem_id:sid,state:"check",last_touched:memory?.last_touched,k_trigger_count:(memory?.k_trigger_count||0)+1});
    }
    if(problem.chapter!=null){
      const allAttempts=await db.attempts.toArray();
      const pmap=new Map((await db.problems.toArray()).map(p=>[p.problem_id,p]));
      const chapterK=allAttempts.filter(a=>a.error_type==="K"&&pmap.get(a.problem_id)?.chapter===problem.chapter).length;
      if(chapterK>=2){
        const chapterS=(await db.problems.where("category").equals("S").toArray()).filter(p=>p.chapter===problem.chapter);
        for(const s of chapterS){
          const pending=await db.reviews.where("problem_id").equals(s.problem_id).filter(r=>r.review_type==="s_check"&&r.status==="pending").count();
          if(!pending) await db.reviews.add({id:undefined as unknown as number,problem_id:s.problem_id,due_date:date,review_type:"s_check",status:"pending",generated_from_attempt_id:id});
        }
      }
    }
  }
  if(problem.category==="S"){
    const state=input.mark==="◎"||input.mark==="○"?"stable":input.mark==="×"?"forgotten":"check";
    const old=await db.sMemory.get(input.problem_id);
    await db.sMemory.put({problem_id:input.problem_id,state,last_touched:date,k_trigger_count:old?.k_trigger_count||0});
  }
  return id;
}

function suggest(theme=""){
  return repairRules.filter(([trigger])=>theme.includes(trigger)||trigger.includes(theme))
    .flatMap(([trigger,a,s])=>[...a,...s].map(problem_id=>({trigger,problem_id})));
}

async function bootstrap():Promise<Bootstrap>{
  await initialize();
  const [problems,attempts,rawReviews,roadmap,weakNotes,pastSessions,sMemory]=await Promise.all([
    db.problems.toArray(),db.attempts.orderBy("id").reverse().toArray(),db.reviews.orderBy("due_date").toArray(),db.roadmap.orderBy("order_index").toArray(),
    db.weakNotes.orderBy("id").reverse().toArray(),db.pastSessions.orderBy("id").reverse().toArray(),db.sMemory.toArray()
  ]);
  const today=todayString(),week=addDays(today,-6),fortnight=addDays(today,-13);
  const reviews=rawReviews.map(r=>({...r,status:r.status!=="done"&&r.due_date<today?"overdue":r.status}));
  const pmap=new Map(problems.map(p=>[p.problem_id,p]));
  const a14=new Set(attempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="A").map(a=>a.problem_id)).size;
  const skeleton=attempts.filter(a=>a.date>=fortnight&&a.mode==="skeleton");
  const skeletonGood=skeleton.filter(a=>["◎","○"].includes(a.mark)).length;
  const kGroups=new Map<string,number>();
  attempts.filter(a=>a.date>=fortnight&&a.error_type==="K").forEach(a=>kGroups.set(a.problem_id,(kGroups.get(a.problem_id)||0)+1));
  const kRepeat=[...kGroups.values()].filter(n=>n>1).length;
  const pastSkeleton=attempts.filter(a=>a.date>=fortnight&&a.mode==="skeleton"&&pmap.get(a.problem_id)?.category==="past_exam").length;
  const delayed3=reviews.filter(r=>r.status!=="done"&&r.due_date<addDays(today,-3)).length;
  const weakUpdates=weakNotes.filter(w=>w.date>=week).length;
  const checks=[a14>=10&&a14<=14,pastSkeleton>=2,kRepeat<=2,skeleton.length>0&&skeletonGood/skeleton.length>=.8,weakUpdates>=2,delayed3===0];
  const paceLabel=checks.filter(Boolean).length>=5?"合格ペース":checks.filter(Boolean).length>=3?"注意":"危険";
  const scans=pastSessions.filter(s=>s.session_type==="scan_5_questions"),exams=pastSessions.filter(s=>s.session_type==="exam_90min");
  const chapterCounts=new Map<number,number>();
  attempts.filter(a=>a.date>=fortnight&&a.error_type==="K").forEach(a=>{const c=pmap.get(a.problem_id)?.chapter;if(c!=null)chapterCounts.set(c,(chapterCounts.get(c)||0)+1)});
  const themeCounts=new Map<string,number>();
  weakNotes.filter(w=>!w.is_resolved).forEach(w=>themeCounts.set(w.theme,(themeCounts.get(w.theme)||0)+1));
  const dashboard={
    today,weekA:new Set(attempts.filter(a=>a.date>=week&&pmap.get(a.problem_id)?.category==="A").map(a=>a.problem_id)).size,
    weekPast:pastSessions.filter(s=>String(s.date)>=week).length,kRecurrence:kRepeat,
    pending:reviews.filter(r=>r.status!=="done").length,overdue:reviews.filter(r=>r.status==="overdue").length,
    sStableRate:sMemory.length?Math.round(sMemory.filter(s=>s.state==="stable").length/sMemory.length*100):0,
    sForgotten:sMemory.filter(s=>["forgotten","collapsed","check"].includes(s.state)).length,
    scanSuccess:scans.length?Math.round(scans.filter(s=>s.selection_result==="good").length/scans.length*100):0,
    examSuccess:exams.length?Math.round(exams.filter(s=>Number(s.completed_questions_count)>=3).length/exams.length*100):0,
    dangerChapters:[...chapterCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([chapter,count])=>({chapter,count})),
    nextTheme:[...themeCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"ロードマップ先頭のA問題",
    pace:{label:paceLabel,checks,a14,pastSkeleton,kRepeat,skeletonRate:skeleton.length?Math.round(skeletonGood/skeleton.length*100):0,weakUpdates,delayed3,suggestion:paceLabel==="危険"?"新規A問題を減らし、K問題とS復旧を優先してください。":""}
  };
  const dueReviews=reviews.filter(r=>r.status!=="done"&&r.due_date<=today).map(r=>{
    const p=pmap.get(r.problem_id)!;const source=attempts.find(a=>a.id===r.generated_from_attempt_id);
    return {...r,title:p?.title||r.problem_id,theme:p?.theme||"",error_type:source?.error_type,kind:r.review_type==="s_check"?"S確認":"復習",reason:r.status==="overdue"?`期限切れ（${r.due_date}）`:"本日が復習日",mode:r.review_type==="s_check"?"skeleton":r.review_type.replace("_retry",""),minutes:r.review_type==="s_check"?5:20,load:r.review_type==="s_check"?.2:loadFor(r.review_type.replace("_retry",""))};
  }).sort((a,b)=>(a.status==="overdue"&&a.error_type==="K"?0:1)-(b.status==="overdue"&&b.error_type==="K"?0:1));
  const activeS=new Set(dueReviews.filter(r=>r.review_type==="s_check").map(r=>r.problem_id));
  const staleS=sMemory.filter(s=>!activeS.has(s.problem_id)&&(s.state==="forgotten"||s.state==="collapsed"||!!s.last_touched&&s.last_touched<=addDays(today,-30))).map(s=>{
    const p=pmap.get(s.problem_id)!;return {problem_id:s.problem_id,title:p.title,theme:p.theme,kind:"S点検",reason:s.state==="forgotten"||s.state==="collapsed"?"忘却状態から復旧":"30日以上未確認",mode:s.state==="collapsed"?"full":"skeleton",minutes:s.state==="collapsed"?20:3,load:s.state==="collapsed"?.4:.2};
  });
  let load=[...dueReviews,...staleS].reduce((sum,x)=>sum+x.load,0);
  const seen=new Set(attempts.map(a=>a.problem_id)),pastDue=!pastSessions.some(s=>String(s.date)>=week),reserve=pastDue?.6:0;
  const newTasks=[];
  for(const r of roadmap.filter(r=>r.is_active&&!seen.has(r.problem_id))){
    if(newTasks.length>=3||load+r.load_score+reserve>4) break;
    newTasks.push({...r,title:pmap.get(r.problem_id)!.title,theme:pmap.get(r.problem_id)!.theme,kind:"新規A",reason:`ロードマップ ${r.order_index}番`,mode:r.expected_mode,minutes:r.expected_mode==="full"?35:20,load:r.load_score});load+=r.load_score;
  }
  const pastTasks=pastDue&&load+.6<=4?[{problem_id:"PAST-SCAN",title:"5問から3問を選ぶ",kind:"過去問",reason:"今週の選題練習",mode:"scan",minutes:15,load:.6}]:[];
  const weak=weakNotes.filter(w=>!w.is_resolved).at(-1);
  const weakTask=weak?[{...weak,title:pmap.get(weak.problem_id)?.title||weak.problem_id,kind:"弱点ノート",reason:"未解決ミスの確認",mode:"scan",minutes:5,load:.1}]:[];
  const tasks=[...dueReviews,...staleS,...newTasks,...pastTasks,...weakTask];
  const totalLoad=Math.round(tasks.reduce((sum,x)=>sum+x.load,0)*10)/10;
  return {problems:problems.sort((a,b)=>(a.chapter||99)-(b.chapter||99)||a.category.localeCompare(b.category)||a.problem_number-b.problem_number),attempts,reviews,roadmap,weakNotes,pastSessions,dashboard,today:{tasks,totalLoad,warning:totalLoad>4?"今日は負荷が4.0を超えています。1問を骨格モードに落とすか、翌日に回してください。":""}} as Bootstrap;
}

export async function localGet<T>(path:string):Promise<T>{
  if(path==="/api/bootstrap") return await bootstrap() as T;
  if(path.startsWith("/api/repair-suggestions")){
    const theme=new URL(path,location.origin).searchParams.get("theme")||"";
    return suggest(theme) as T;
  }
  throw new Error(`未対応の読み取りです: ${path}`);
}

export async function localPost<T>(path:string,body:any):Promise<T>{
  await initialize();
  if(path==="/api/problems"){
    await db.problems.add({...body,id:Date.now(),chapter:body.chapter?Number(body.chapter):null,problem_number:Number(body.problem_number),completion_status:"active"});
    if(body.category==="S") await db.sMemory.put({problem_id:body.problem_id,state:"stable",k_trigger_count:0});
  } else if(path==="/api/attempts") {
    await db.transaction("rw",db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,()=>saveAttempt(body));
  } else if(path==="/api/import") {
    await db.transaction("rw",db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,async()=>{for(const update of body.updates) await saveAttempt(update)});
  } else if(/^\/api\/reviews\/\d+\/done$/.test(path)) {
    await db.reviews.update(Number(path.split("/")[3]),{status:"done"});
  } else if(/^\/api\/weak-notes\/\d+\/resolve$/.test(path)) {
    await db.weakNotes.update(Number(path.split("/")[3]),{is_resolved:1});
  } else if(path==="/api/past-sessions") {
    await db.pastSessions.add({...body,id:undefined as unknown as number,year:Number(body.year),selection_time_minutes:Number(body.selection_time_minutes||0),completed_questions_count:Number(body.completed_questions_count||0)});
  } else throw new Error(`未対応の保存です: ${path}`);
  return {ok:true} as T;
}

export async function exportBackup(){
  await initialize();
  return {
    version:1,exported_at:new Date().toISOString(),
    problems:await db.problems.toArray(),attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),
    roadmap:await db.roadmap.toArray(),weakNotes:await db.weakNotes.toArray(),pastSessions:await db.pastSessions.toArray(),
    sMemory:await db.sMemory.toArray()
  };
}

export async function restoreBackup(data:any){
  const required=["problems","attempts","reviews","roadmap","weakNotes","pastSessions","sMemory"];
  if(!data||!required.every(k=>Array.isArray(data[k]))) throw new Error("バックアップ形式が正しくありません");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.roadmap,db.weakNotes,db.pastSessions,db.sMemory,db.meta],async()=>{
    await Promise.all([db.problems.clear(),db.attempts.clear(),db.reviews.clear(),db.roadmap.clear(),db.weakNotes.clear(),db.pastSessions.clear(),db.sMemory.clear()]);
    await db.problems.bulkAdd(data.problems);await db.attempts.bulkAdd(data.attempts);await db.reviews.bulkAdd(data.reviews);
    await db.roadmap.bulkAdd(data.roadmap);await db.weakNotes.bulkAdd(data.weakNotes);await db.pastSessions.bulkAdd(data.pastSessions);
    await db.sMemory.bulkAdd(data.sMemory);await db.meta.put({key:"seeded",value:"1"});
  });
}

export async function csvFor(table:"attempts"|"problems"){
  const rows=table==="attempts"?await db.attempts.toArray():await db.problems.toArray();
  if(!rows.length) return "";
  const keys=Object.keys(rows[0]);
  return "\ufeff"+[keys.join(","),...rows.map(row=>keys.map(k=>`"${String((row as any)[k]??"").replaceAll('"','""')}"`).join(","))].join("\n");
}
