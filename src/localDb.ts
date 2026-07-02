import Dexie, { type EntityTable } from "dexie";
import type { Attempt, Bootstrap, PastSession, Problem, Review, Roadmap, StudyUpdate, WeakNote } from "./types";
import { japaneseizeMathText } from "./mathJapanese.ts";
import { analyzeWeaknesses } from "./weaknessAnalytics.ts";
import { createAdaptiveReviewPlan, createAttemptReviewPlan, createPastReviewPlan, createSReviewPlan, type ReviewOutcome, type ReviewPlan, type SState } from "./reviewRules.ts";
import { applyWeakNoteQuizResult } from "./weakNoteQuiz.ts";
import { selectMixedPractice } from "./studyScheduler.ts";
import { buildProgressPlan, daysUntilExam } from "./studyProgress.ts";
import { CHAPTER_META, officialProblemEntries, PAST_EXAM_YEAR_ORDER, STRATEGY_A_PLUS_ORDER, STRATEGY_S_ORDER, strategyRankFor } from "./officialMaster.ts";

type SMemory = { problem_id:string; state:"stable"|"check"|"forgotten"|"collapsed"; last_touched?:string; k_trigger_count:number };
type StoredAttempt = Attempt;
type StoredReview = Review;
type StoredWeakNote = WeakNote;
type StoredPastSession = PastSession;

const migrationSProblems=[
  {chapter:2,number:1,theme:"確率分布の基本"},
  {chapter:2,number:6,theme:"非負整数値確率変数の期待値"},
  {chapter:2,number:7,theme:"密度と期待値"},
  {chapter:2,number:10,theme:"平均・分散の存在"},
  {chapter:2,number:25,theme:"積率母関数"}
];
const labelFor=(chapter:number|null,category:string,number:number,difficulty?:number|null)=>
  chapter==null?`問${number}`:`第${chapter}章${category}問${number}${difficulty!=null?`（難${difficulty}）`:""}`;

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
    this.version(2).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    }).upgrade(async tx=>{
      await tx.table("problems").toCollection().modify((problem:Problem)=>{
        const difficulty=problem.problem_id==="WB-2-A-20"?4:(problem.difficulty??null);
        const display=problem.source_type==="past_exam"
          ? `${problem.problem_id.match(/PY-(\d{4})/)?.[1]||""}年問${problem.problem_number}`
          : labelFor(problem.chapter,problem.category,problem.problem_number,difficulty);
        problem.difficulty=difficulty;
        problem.display_label=problem.display_label||display;
        problem.roadmap_label=problem.roadmap_label||display;
        problem.normalized_label=problem.normalized_label||display.replace(/\s/g,"");
        problem.related_s_problem_ids=problem.related_s_problem_ids||String(problem.linked_s_problems||"").split(";").filter(Boolean);
        problem.linked_past_exam_ids=problem.linked_past_exam_ids||String(problem.linked_past_exams||"").split(";").filter(Boolean);
      });
      for(const item of migrationSProblems){
        const problem_id=`WB-${item.chapter}-S-${String(item.number).padStart(2,"0")}`;
        if(!await tx.table("problems").get(problem_id)){
          const display=labelFor(item.chapter,"S",item.number,null);
          await tx.table("problems").add({
            id:Date.now()+item.number,problem_id,source_type:"whitebook",category:"S",chapter:item.chapter,
            problem_number:item.number,title:display,theme:item.theme,priority:"repair",role:"foundation",
            recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",
            notes:"",completion_status:"active",display_label:display,difficulty:null,roadmap_label:display,
            normalized_label:display,related_s_problem_ids:[],linked_past_exam_ids:[]
          });
          await tx.table("sMemory").put({problem_id,state:"stable",k_trigger_count:0});
        }
      }
    });
    this.version(3).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    }).upgrade(async tx=>{
      const item=migrationSProblems.find(problem=>problem.number===6)!;
      const problem_id="WB-2-S-06";
      if(!await tx.table("problems").get(problem_id)){
        const display=labelFor(item.chapter,"S",item.number,null);
        await tx.table("problems").add({
          id:Date.now()+item.number,problem_id,source_type:"whitebook",category:"S",chapter:item.chapter,
          problem_number:item.number,title:display,theme:item.theme,priority:"repair",role:"foundation",
          recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",
          notes:"",completion_status:"active",display_label:display,difficulty:null,roadmap_label:display,
          normalized_label:display,related_s_problem_ids:[],linked_past_exam_ids:[]
        });
        await tx.table("sMemory").put({problem_id,state:"stable",k_trigger_count:0});
      }
    });
    this.version(4).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    });
    this.version(5).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    }).upgrade(async tx=>{
      await tx.table("reviews").toCollection().modify((review:Review)=>{
        if(review.generated_from_past_session_id) review.status="done";
      });
    });
    this.version(6).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    }).upgrade(async tx=>{
      await tx.table("weakNotes").toCollection().modify((note:WeakNote)=>{
        note.quiz_correct_count=note.quiz_correct_count||0;
        note.quiz_wrong_count=note.quiz_wrong_count||0;
      });
    });
    this.version(7).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    }).upgrade(async tx=>{
      const attempts=await tx.table("attempts").toArray() as Attempt[];
      await tx.table("weakNotes").toCollection().modify((note:WeakNote)=>{
        note.generated_from_attempt_id=note.generated_from_attempt_id||
          attempts.find(attempt=>attempt.problem_id===note.problem_id&&attempt.date===note.date)?.id;
      });
    });
    this.version(8).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    }).upgrade(async tx=>{
      const rows=await tx.table("reviews").toArray() as Review[];
      const groups=new Map<string,Review[]>();
      rows.filter(review=>review.status!=="done").forEach(review=>groups.set(review.problem_id,[...(groups.get(review.problem_id)||[]),review]));
      for(const duplicates of groups.values()){
        if(duplicates.length<2) continue;
        const sorted=[...duplicates].sort((a,b)=>b.id-a.id),keep=sorted[0];
        keep.due_date=duplicates.map(review=>review.due_date).sort()[0];
        await tx.table("reviews").put(keep);
        await tx.table("reviews").bulkDelete(sorted.slice(1).map(review=>review.id));
      }
    });
    this.version(9).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key"
    }).upgrade(async tx=>{
      const migrateProblemId=async(oldId:string,newId:string,category:"S"|"A",chapter:number,number:number)=>{
        const oldProblem=await tx.table("problems").get(oldId) as Problem|undefined;
        if(!oldProblem) return;
        const current=await tx.table("problems").get(newId) as Problem|undefined;
        const display=labelFor(chapter,category,number,null);
        await tx.table("problems").put({...oldProblem,...current,problem_id:newId,category,chapter,problem_number:number,
          title:current?.title||display,display_label:current?.display_label||display,normalized_label:display.replace(/\s/g,"")});
        await tx.table("attempts").where("problem_id").equals(oldId).modify({problem_id:newId});
        await tx.table("reviews").where("problem_id").equals(oldId).modify({problem_id:newId});
        await tx.table("weakNotes").where("problem_id").equals(oldId).modify({problem_id:newId});
        await tx.table("roadmap").where("problem_id").equals(oldId).modify({problem_id:newId});
        await tx.table("problems").delete(oldId);
      };
      await migrateProblemId("WB-6-A-21","WB-6-S-21","S",6,21);
      await migrateProblemId("WB-6-A-22","WB-6-S-22","S",6,22);

      for(const entry of officialProblemEntries()){
        const current=await tx.table("problems").get(entry.problem_id) as Problem|undefined;
        const display=labelFor(entry.chapter,entry.category,entry.problem_number,null);
        const base:Problem=current||{
          id:Date.now()+entry.chapter*100+entry.problem_number,problem_id:entry.problem_id,source_type:"whitebook",
          category:entry.category,chapter:entry.chapter,problem_number:entry.problem_number,title:display,
          theme:CHAPTER_META[entry.chapter]?.short||"",priority:"semi_core",role:entry.category==="S"?"foundation":"training",
          recommended_mode:entry.category==="S"?"skeleton":"full",linked_past_exams:"",linked_s_problems:"",
          linked_a_problems:"",notes:"",completion_status:"active",display_label:display,difficulty:null,
          roadmap_label:display,normalized_label:display.replace(/\s/g,""),related_s_problem_ids:[],linked_past_exam_ids:[]
        };
        await tx.table("problems").put({...base,category:entry.category,strategy_rank:entry.strategy_rank,
          priority:["SS","A+"].includes(entry.strategy_rank)?"core":entry.strategy_rank==="S"?"core":"semi_core",
          role:entry.category==="S"?"foundation":"training"});
        if(entry.category==="S"&&!await tx.table("sMemory").get(entry.problem_id)){
          await tx.table("sMemory").put({problem_id:entry.problem_id,state:"check",k_trigger_count:0});
        }
      }
      await tx.table("problems").toCollection().modify((problem:Problem)=>{
        if(problem.source_type==="whitebook"&&(problem.category==="S"||problem.category==="A")){
          problem.strategy_rank=problem.strategy_rank||strategyRankFor(problem.problem_id,problem.category);
        }
      });
      for(const year of PAST_EXAM_YEAR_ORDER){
        for(let question=1;question<=5;question++){
          const problem_id=`PY-${year}-Q${question}`,current=await tx.table("problems").get(problem_id) as Problem|undefined;
          if(current) continue;
          await tx.table("problems").put({
            id:Date.now()+year*10+question,problem_id,source_type:"past_exam",category:"past_exam",chapter:null,
            problem_number:question,title:`${year}年問${question}`,theme:"過去問・テーマ未登録",priority:"core",role:"exam",
            recommended_mode:"scan",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",
            completion_status:"active",display_label:`${year}年問${question}`,difficulty:null,roadmap_label:`${year}年問${question}`,
            normalized_label:`${year}年問${question}`,related_s_problem_ids:[],linked_past_exam_ids:[]
          });
        }
      }
      const allProblems=await tx.table("problems").toArray() as Problem[];
      const aPlusSet=new Set(STRATEGY_A_PLUS_ORDER);
      const aRemainder=allProblems.filter(problem=>problem.category==="A"&&!aPlusSet.has(problem.problem_id))
        .sort((a,b)=>(a.chapter||99)-(b.chapter||99)||a.problem_number-b.problem_number).map(problem=>problem.problem_id);
      const order=[...STRATEGY_A_PLUS_ORDER,...aRemainder];
      await tx.table("roadmap").clear();
      await tx.table("roadmap").bulkPut(order.map((problem_id,index)=>{
        const problem=allProblems.find(item=>item.problem_id===problem_id)!;
        const phase=index<STRATEGY_A_PLUS_ORDER.length
          ?[6,4,2].includes(problem.chapter||0)?"フェーズ1：第6章→第4章→第2章 A+":"フェーズ2：第5章→第7章→第3章 A+"
          :"余力枠：ランクA";
        return {id:index+1,order_index:index+1,problem_id,block_name:phase,
          expected_mode:problem.recommended_mode||"full",
          load_score:({skeleton:.5,main_calc:.8,full:1.2,scan:.6,exam_90min:3} as Record<string,number>)[problem.recommended_mode||"full"]??.5,
          is_active:1};
      }));
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
  [2,1,"確率分布の基本"],[2,6,"非負整数値確率変数の期待値"],[2,7,"密度と期待値"],[2,10,"平均・分散の存在"],[2,25,"積率母関数"],
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
async function reviewDueDate(date:string,days:number){
  const normal=addDays(date,days),examDate=(await db.meta.get("exam_date"))?.value||"";
  if(!examDate||examDate<=date||normal<addDays(examDate,-2)) return normal;
  const preExam=addDays(examDate,-3);
  return preExam>date?preExam:addDays(date,1);
}
const list=(value="")=>String(value).split(/[;,、\s]+/).map(x=>x.trim()).filter(Boolean);

async function initialize() {
  if(await db.meta.get("seeded")) return;
  if(await db.problems.count()){
    await db.meta.put({key:"seeded",value:"1"});
    return;
  }
  await db.transaction("rw",db.problems,db.roadmap,db.sMemory,db.meta,async()=>{
    const problems:Problem[]=roadmapSeed.map(([chapter,number,theme,mode],i)=>{
      const problem_id=`WB-${chapter}-A-${String(number).padStart(2,"0")}`;
      const difficulty=problem_id==="WB-2-A-20"?4:null;
      const display=labelFor(chapter,"A",number,difficulty);
      const related=(sLinks[problem_id]||"").split(";").filter(Boolean);
      return {id:i+1,problem_id,source_type:"whitebook",category:"A",chapter,problem_number:number,title:display,theme,priority:i<15?"core":"semi_core",role:"training",recommended_mode:mode,linked_past_exams:"",linked_s_problems:sLinks[problem_id]||"",linked_a_problems:"",notes:"",completion_status:"active",display_label:display,difficulty,roadmap_label:display,normalized_label:display.replace(/\s/g,""),related_s_problem_ids:related,linked_past_exam_ids:[]};
    });
    let id=problems.length+1;
    for(const [chapter,number,theme] of sSeed){
      const problem_id=`WB-${chapter}-S-${String(number).padStart(2,"0")}`;
      const display=labelFor(chapter,"S",number,null);
      problems.push({id:id++,problem_id,source_type:"whitebook",category:"S",chapter,problem_number:number,title:display,theme,priority:"repair",role:"foundation",recommended_mode:"skeleton",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",display_label:display,difficulty:null,roadmap_label:display,normalized_label:display.replace(/\s/g,""),related_s_problem_ids:[],linked_past_exam_ids:[]});
    }
    problems.push({id:id++,problem_id:"PY-2025-Q1",source_type:"past_exam",category:"past_exam",chapter:null,problem_number:1,title:"2025年問1",theme:"AIC・区分的密度・MLE",priority:"core",role:"exam",recommended_mode:"scan",linked_past_exams:"",linked_s_problems:"WB-6-S-04",linked_a_problems:"WB-6-A-05",notes:"",completion_status:"active",display_label:"2025年問1",difficulty:null,roadmap_label:"2025年問1",normalized_label:"2025年問1",related_s_problem_ids:["WB-6-S-04"],linked_past_exam_ids:[]});
    await db.problems.bulkPut(problems);
    await db.sMemory.bulkPut(sSeed.map(([chapter,number])=>({problem_id:`WB-${chapter}-S-${String(number).padStart(2,"0")}`,state:"stable",k_trigger_count:0})));
    await db.roadmap.bulkPut(roadmapSeed.map(([chapter,number,,mode],i)=>({id:i+1,order_index:i+1,problem_id:`WB-${chapter}-A-${String(number).padStart(2,"0")}`,block_name:blocks.find(([from,to])=>i+1>=from&&i+1<=to)![2],expected_mode:mode,load_score:loadFor(mode),is_active:1})));
    await db.meta.put({key:"seeded",value:"1"});
  });
}

const planFields=(plan:ReviewPlan)=>({
  review_reason:plan.review_reason,review_method:plan.review_method,review_instruction:plan.review_instruction,
  review_steps:plan.review_steps,estimated_minutes:plan.estimated_minutes,requires_full_answer:plan.requires_full_answer,
  requires_s_check:plan.requires_s_check,linked_s_problem_ids:plan.linked_s_problem_ids,interval_days:plan.interval_days
});
type ReviewInsert=Omit<Review,"id">;
async function addOrReplaceReview(review:ReviewInsert){
  const pending=(await db.reviews.where("problem_id").equals(review.problem_id).toArray()).filter(item=>item.status!=="done");
  const dueDate=[review.due_date,...pending.map(item=>item.due_date)].sort()[0];
  if(pending.length) await db.reviews.bulkDelete(pending.map(item=>item.id));
  return Number(await db.reviews.add({id:undefined as unknown as number,...review,due_date:dueDate}));
}

async function saveAttempt(input:StudyUpdate&Record<string,unknown>) {
  const problem=await db.problems.get(input.problem_id);
  if(!problem) throw new Error(`未登録の問題IDです: ${input.problem_id}`);
  const date=input.date||todayString();
  const localizedErrorPoint=japaneseizeMathText(input.error_point||"");
  const localizedNextAction=japaneseizeMathText(input.next_action||"");
  const improvementGuidance=japaneseizeMathText(input.improvement_guidance||"");
  const requiredDerivation=japaneseizeMathText(input.required_derivation||"");
  const correctedAnswer=japaneseizeMathText(input.corrected_answer||"");
  const primary=input.primary_error_type||input.error_type||"none";
  const errors=input.error_types?.length?input.error_types:[primary];
  const related=[...new Set([...(input.related_s_problem_ids||input.linked_s_problems||[]),...list(input.linked_s_problem),...list(problem.linked_s_problems)])];
  const id=Number(await db.attempts.add({
    id:undefined as unknown as number,problem_id:input.problem_id,date,mode:input.mode||problem.recommended_mode,
    time_minutes:Number(input.time_minutes||0),mark:input.mark||"△",score_label:input.score_label||"B",
    error_type:primary,error_point:localizedErrorPoint,next_action:localizedNextAction,memo:String(input.memo||""),
    score_text:input.score_text||"",score_numeric:input.score_numeric??null,score_max:input.score_max??null,
    result_summary:japaneseizeMathText(input.result_summary||""),exam_selection_rank:input.exam_selection_rank||"",
    improvement_guidance:improvementGuidance,required_derivation:requiredDerivation,corrected_answer:correctedAnswer,
    error_types:errors,primary_error_type:primary,
    secondary_error_type:input.secondary_error_type||"",ignored_parts:input.ignored_parts||[],
    auto_imported:!!input.auto_imported,import_confidence:input.import_confidence??(input.auto_imported?.8:1),
    grading_confidence:input.grading_confidence??null,rubric_version:input.rubric_version||"",
    uncertain_points:input.uncertain_points||[],generated_from_review_id:input.generated_from_review_id,
    is_review_attempt:!!input.generated_from_review_id
  }));
  if(input.generated_from_review_id){
    await db.reviews.update(input.generated_from_review_id,{
      status:"done",completion_result:input.review_outcome||(["◎","○"].includes(input.mark)?"success":input.mark==="△"?"partial":"failed"),
      hint_used:!!input.hint_used,completion_time_minutes:Number(input.time_minutes||0),completed_at:date
    });
  }
  const attempts=(await db.attempts.where("problem_id").equals(input.problem_id).sortBy("date")).filter(x=>x.id!==id);
  const previous=attempts.at(-1);
  let consecutivePerfect=0;
  for(const attempt of [...attempts].reverse()){if(attempt.mark==="◎") consecutivePerfect++;else break}
  const sState:SState=input.mark==="◎"||input.mark==="○"?"stable":input.mark==="×"?"forgotten":"check";
  const plan=problem.category==="S"?createSReviewPlan(sState):createAttemptReviewPlan(input,related,consecutivePerfect);
  await addOrReplaceReview({
    problem_id:input.problem_id,due_date:await reviewDueDate(date,plan.interval_days||14),
    review_type:plan.review_type,status:"pending",generated_from_attempt_id:id,duration_minutes:plan.estimated_minutes,
    reason:plan.review_reason,...planFields(plan)
  });
  if(plan.completion_candidate) await db.problems.update(input.problem_id,{completion_status:"completion_candidate"});
  const weakCandidates=input.weak_notes?.length?input.weak_notes:input.weak_note?[input.weak_note]:
    primary!=="none"&&localizedErrorPoint?[{theme:input.theme||problem.theme,error_type:primary,mistake:localizedErrorPoint,correction_rule:japaneseizeMathText(input.correction_rule||localizedNextAction)}]:[];
  for(const weak of weakCandidates) await db.weakNotes.add({
    id:undefined as unknown as number,date,problem_id:input.problem_id,error_type:weak.error_type||primary,
    theme:weak.theme||input.theme||problem.theme,mistake:japaneseizeMathText(weak.mistake),
    correction_rule:japaneseizeMathText(weak.correction_rule||input.correction_rule||localizedNextAction),is_resolved:0,
    source_text:input.source_text||"",auto_generated:!!input.auto_imported,generated_from_attempt_id:id
  });
  if(related.length){
    await db.problems.update(input.problem_id,{
      linked_s_problems:related.join(";"),related_s_problem_ids:related
    });
  }
  if(primary!=="none") await db.problems.update(input.problem_id,{completion_status:"review_pending"});
  if(errors.includes("K")||errors.includes("N")){
    const linkedState:SState=errors.includes("K")?"collapsed":"check";
    const sPlan=createSReviewPlan(linkedState);
    for(const sid of related){
      if(!await db.problems.get(sid)) continue;
      await addOrReplaceReview({
        problem_id:sid,due_date:await reviewDueDate(date,sPlan.interval_days||1),
        review_type:"s_check",status:"pending",generated_from_attempt_id:id,duration_minutes:sPlan.estimated_minutes,
        reason:sPlan.review_reason,...planFields(sPlan)
      });
      const memory=await db.sMemory.get(sid);
      await db.sMemory.put({problem_id:sid,state:linkedState,last_touched:memory?.last_touched,k_trigger_count:(memory?.k_trigger_count||0)+1});
    }
    if(errors.includes("K")&&problem.chapter!=null){
      const allAttempts=await db.attempts.toArray();
      const pmap=new Map((await db.problems.toArray()).map(p=>[p.problem_id,p]));
      const chapterK=allAttempts.filter(a=>a.error_type==="K"&&pmap.get(a.problem_id)?.chapter===problem.chapter).length;
      if(chapterK>=2){
        const chapterS=(await db.problems.where("category").equals("S").toArray()).filter(p=>p.chapter===problem.chapter);
        const collapsedPlan=createSReviewPlan("collapsed");
        for(const s of chapterS){
          await addOrReplaceReview({
            problem_id:s.problem_id,due_date:await reviewDueDate(date,1),
            review_type:"s_check",status:"pending",generated_from_attempt_id:id,duration_minutes:collapsedPlan.estimated_minutes,
            reason:collapsedPlan.review_reason,...planFields(collapsedPlan)
          });
        }
      }
    }
  }
  if(problem.category==="S"){
    const old=await db.sMemory.get(input.problem_id);
    await db.sMemory.put({problem_id:input.problem_id,state:sState,last_touched:date,k_trigger_count:old?.k_trigger_count||0});
  }
  return id;
}

const editedErrors=(value:unknown,fallback="none")=>{
  const errors=[...new Set(String(value===undefined?fallback:value).toUpperCase().match(/\b[KWNC]\b/g)||[])];
  return errors.length?errors:["none"];
};

async function refreshLinkedSMemory(linkedIds:string[]){
  if(!linkedIds.length) return;
  const [attempts,problems]=await Promise.all([db.attempts.toArray(),db.problems.toArray()]);
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  for(const sid of [...new Set(linkedIds)]){
    const linkedAttempts=attempts.filter(attempt=>{
      const problem=pmap.get(attempt.problem_id);
      const links=[...(problem?.related_s_problem_ids||[]),...list(problem?.linked_s_problems||"")];
      return links.includes(sid);
    });
    const latestByProblem=new Map<string,Attempt>();
    [...linkedAttempts].sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id).forEach(attempt=>latestByProblem.set(attempt.problem_id,attempt));
    const triggers=[...latestByProblem.values()].filter(attempt=>(attempt.error_types||[attempt.error_type]).some(error=>error==="K"||error==="N"));
    const state:SState=triggers.some(attempt=>(attempt.error_types||[attempt.error_type]).includes("K"))?"collapsed":
      triggers.length?"check":"stable";
    const old=await db.sMemory.get(sid);
    await db.sMemory.put({problem_id:sid,state,last_touched:old?.last_touched,k_trigger_count:triggers.length});
  }
}

async function updateAttemptAnalysis(id:number,body:Record<string,unknown>){
  const attempt=await db.attempts.get(id);
  if(!attempt) throw new Error("編集する採点結果が見つかりません");
  const problem=await db.problems.get(attempt.problem_id);
  if(!problem) throw new Error("問題マスターが見つかりません");
  const oldNotes=(await db.weakNotes.toArray()).filter(note=>note.generated_from_attempt_id===id||
    (!note.generated_from_attempt_id&&note.problem_id===attempt.problem_id&&note.date===attempt.date));
  const errors=editedErrors(body.error_types,attempt.error_type),primary=errors[0];
  const date=String(body.date||attempt.date),errorPoint=japaneseizeMathText(String(body.error_point??attempt.error_point)),
    nextAction=japaneseizeMathText(String(body.next_action??attempt.next_action));
  const scoreValue=body.score_numeric??attempt.score_numeric;
  const updated:Attempt={...attempt,date,mark:String(body.mark||attempt.mark),score_label:String(body.score_label||attempt.score_label),
    score_numeric:scoreValue===""||scoreValue==null?null:Number(scoreValue),
    error_type:primary,primary_error_type:primary,error_types:errors,error_point:errorPoint,next_action:nextAction};
  await db.attempts.put(updated);
  const reviewIds=(await db.reviews.toArray()).filter(review=>review.generated_from_attempt_id===id).map(review=>review.id);
  if(reviewIds.length) await db.reviews.bulkDelete(reviewIds);
  const noteIds=oldNotes.map(note=>note.id);
  if(noteIds.length) await db.weakNotes.bulkDelete(noteIds);
  const related=[...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)];
  const plan=problem.category==="S"
    ?createSReviewPlan(updated.mark==="◎"||updated.mark==="○"?"stable":updated.mark==="×"?"forgotten":"check")
    :createAttemptReviewPlan(updated,related,0);
  await addOrReplaceReview({problem_id:attempt.problem_id,due_date:await reviewDueDate(date,plan.interval_days||14),
    review_type:plan.review_type,status:"pending",generated_from_attempt_id:id,duration_minutes:plan.estimated_minutes,
    reason:plan.review_reason,...planFields(plan)});
  const theme=String(body.theme||oldNotes[0]?.theme||problem.theme);
  if(primary!=="none"&&errorPoint) await db.weakNotes.add({
    id:undefined as unknown as number,date,problem_id:attempt.problem_id,error_type:primary,theme,mistake:errorPoint,
    correction_rule:japaneseizeMathText(String(body.correction_rule||oldNotes[0]?.correction_rule||nextAction)),
    is_resolved:0,source_text:oldNotes[0]?.source_text||"",auto_generated:true,generated_from_attempt_id:id
  });
  if((errors.includes("K")||errors.includes("N"))&&related.length){
    const state:SState=errors.includes("K")?"collapsed":"check",sPlan=createSReviewPlan(state);
    for(const sid of [...new Set(related)]){
      if(!await db.problems.get(sid)) continue;
      await addOrReplaceReview({problem_id:sid,due_date:await reviewDueDate(date,sPlan.interval_days||1),
        review_type:"s_check",status:"pending",generated_from_attempt_id:id,duration_minutes:sPlan.estimated_minutes,
        reason:sPlan.review_reason,...planFields(sPlan)});
    }
  }
  await refreshLinkedSMemory(related);
  await db.problems.update(attempt.problem_id,{completion_status:primary==="none"?"active":"review_pending"});
}

async function deleteAttemptAnalysis(id:number){
  const attempt=await db.attempts.get(id);
  if(!attempt) throw new Error("削除する採点結果が見つかりません");
  const reviewIds=(await db.reviews.toArray()).filter(review=>review.generated_from_attempt_id===id).map(review=>review.id);
  const noteIds=(await db.weakNotes.toArray()).filter(note=>note.generated_from_attempt_id===id||
    (!note.generated_from_attempt_id&&note.problem_id===attempt.problem_id&&note.date===attempt.date)).map(note=>note.id);
  await db.attempts.delete(id);
  if(reviewIds.length) await db.reviews.bulkDelete(reviewIds);
  if(noteIds.length) await db.weakNotes.bulkDelete(noteIds);
  const problem=await db.problems.get(attempt.problem_id);
  const related=[...(problem?.related_s_problem_ids||[]),...list(problem?.linked_s_problems||"")];
  await refreshLinkedSMemory(related);
  const remaining=await db.attempts.where("problem_id").equals(attempt.problem_id).toArray();
  const stillWeak=remaining.some(item=>(item.error_types||[item.error_type]).some(error=>error!=="none"));
  await db.problems.update(attempt.problem_id,{completion_status:stillWeak?"review_pending":"active"});
}

async function completeReview(id:number,body:Record<string,unknown>){
  const review=await db.reviews.get(id);
  if(!review) throw new Error("復習予定が見つかりません");
  const source=await db.attempts.get(review.generated_from_attempt_id);
  const problem=await db.problems.get(review.problem_id);
  if(!source||!problem) throw new Error("復習元の採点データが見つかりません");
  const outcome:ReviewOutcome={
    result:["success","partial","failed"].includes(String(body.result))?String(body.result) as ReviewOutcome["result"]:"partial",
    hint_used:!!body.hint_used,time_minutes:Number(body.time_minutes||0)
  };
  const related=[...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)];
  const plan=createAdaptiveReviewPlan(source,review,outcome,related);
  const successful=outcome.result==="success",sourceErrors=(source.error_types||[source.error_type]).filter(error=>error!=="none");
  const errors=successful?[]:sourceErrors.length?sourceErrors:["K"];
  const date=todayString(),mark=successful?(outcome.hint_used?"○":"◎"):outcome.result==="partial"?"△":"×";
  const attemptId=Number(await db.attempts.add({
    ...source,id:undefined as unknown as number,problem_id:review.problem_id,date,mode:plan.mode,
    time_minutes:outcome.time_minutes,mark,score_label:successful?"A":outcome.result==="partial"?"B":"C",
    error_type:errors[0]||"none",primary_error_type:errors[0]||"none",secondary_error_type:errors[1]||"",
    error_types:errors,error_point:successful?"":source.error_point,
    next_action:plan.review_instruction||"",memo:"復習結果から自動記録",
    score_text:"",score_numeric:null,score_max:null,result_summary:`復習結果：${outcome.result}${outcome.hint_used?"・ヒント使用":""}`,
    auto_imported:false,import_confidence:1,grading_confidence:1,rubric_version:"REVIEW-SELF-v1",
    uncertain_points:[],generated_from_review_id:id,is_review_attempt:true
  }));
  await db.reviews.update(id,{status:"done",completion_result:outcome.result,hint_used:outcome.hint_used,
    completion_time_minutes:outcome.time_minutes,completed_at:new Date().toISOString()});
  await addOrReplaceReview({problem_id:review.problem_id,due_date:await reviewDueDate(date,plan.interval_days||14),
    review_type:plan.review_type,status:"pending",generated_from_attempt_id:attemptId,duration_minutes:plan.estimated_minutes,
    reason:plan.review_reason,...planFields(plan)});
  if(successful){
    const resolved=(await db.weakNotes.toArray()).filter(note=>note.generated_from_attempt_id===source.id);
    for(const note of resolved) await db.weakNotes.update(note.id,{is_resolved:1});
  }
  if(!successful&&source.error_point) await db.weakNotes.add({
    id:undefined as unknown as number,date,problem_id:review.problem_id,error_type:errors[0],theme:problem.theme,
    mistake:source.error_point,correction_rule:source.next_action||plan.review_instruction||"",is_resolved:0,
    source_text:"",auto_generated:true,generated_from_attempt_id:attemptId
  });
  if(plan.requires_s_check){
    const sPlan=createSReviewPlan(errors.includes("K")?"collapsed":"check");
    for(const sid of plan.linked_s_problem_ids||[]){
      if(!await db.problems.get(sid)) continue;
      await addOrReplaceReview({problem_id:sid,due_date:await reviewDueDate(date,sPlan.interval_days||1),review_type:"s_check",
        status:"pending",generated_from_attempt_id:attemptId,duration_minutes:sPlan.estimated_minutes,
        reason:sPlan.review_reason,...planFields(sPlan)});
    }
  }
  if(problem.category==="S"){
    const old=await db.sMemory.get(problem.problem_id);
    const state:SState=successful?"stable":outcome.result==="partial"?"check":"forgotten";
    await db.sMemory.put({problem_id:problem.problem_id,state,last_touched:date,k_trigger_count:old?.k_trigger_count||0});
  }
  await refreshLinkedSMemory(related);
  await db.problems.update(review.problem_id,{completion_status:successful?"active":"review_pending"});
}

function suggest(theme=""){
  return repairRules.filter(([trigger])=>theme.includes(trigger)||trigger.includes(theme))
    .flatMap(([trigger,a,s])=>[...a,...s].map(problem_id=>({trigger,problem_id})));
}

async function bootstrap():Promise<Bootstrap>{
  await initialize();
  const [problems,attempts,rawReviews,roadmap,weakNotes,pastSessions,sMemory,metaEntries]=await Promise.all([
    db.problems.toArray(),db.attempts.orderBy("id").reverse().toArray(),db.reviews.orderBy("due_date").toArray(),db.roadmap.orderBy("order_index").toArray(),
    db.weakNotes.orderBy("id").reverse().toArray(),db.pastSessions.orderBy("id").reverse().toArray(),db.sMemory.toArray(),db.meta.toArray()
  ]);
  const today=todayString(),week=addDays(today,-6),fortnight=addDays(today,-13);
  const pmap=new Map(problems.map(p=>[p.problem_id,p]));
  const smap=new Map(sMemory.map(memory=>[memory.problem_id,memory]));
  const attemptMap=new Map(attempts.map(attempt=>[attempt.id,attempt]));
  const settings={
    exam_date:metaEntries.find(entry=>entry.key==="exam_date")?.value||"",
    daily_study_minutes:Math.max(30,Number(metaEntries.find(entry=>entry.key==="daily_study_minutes")?.value||150))
  };
  const reviews=rawReviews.map(review=>{
    const status=review.status!=="done"&&review.due_date<today?"overdue":review.status;
    if(review.review_method) return {...review,status};
    const problem=pmap.get(review.problem_id);
    const source=attemptMap.get(review.generated_from_attempt_id);
    const linked=problem?[...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)]:[];
    const legacyPlan=review.review_type==="s_check"
      ?createSReviewPlan((smap.get(review.problem_id)?.state||"check") as SState)
      :source?createAttemptReviewPlan(source,linked,0):null;
    return legacyPlan?{...review,status,duration_minutes:legacyPlan.estimated_minutes,reason:legacyPlan.review_reason,...planFields(legacyPlan)}:{...review,status};
  });
  const a14=new Set(attempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="A").map(a=>a.problem_id)).size;
  const skeleton=attempts.filter(a=>a.date>=fortnight&&a.mode==="skeleton");
  const skeletonGood=skeleton.filter(a=>["◎","○"].includes(a.mark)).length;
  const kGroups=new Map<string,number>();
  attempts.filter(a=>a.date>=fortnight&&a.error_type==="K").forEach(a=>kGroups.set(a.problem_id,(kGroups.get(a.problem_id)||0)+1));
  const kRepeat=[...kGroups.values()].filter(n=>n>1).length;
  const pastSkeleton=attempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="past_exam").length;
  const delayed3=reviews.filter(r=>r.status!=="done"&&r.due_date<addDays(today,-3)).length;
  const weakUpdates=weakNotes.filter(w=>w.date>=week).length;
  const scans=pastSessions.filter(s=>s.session_type==="scan_5_questions"),exams=pastSessions.filter(s=>s.session_type==="exam_90min");
  const studyDays14=new Set(attempts.filter(a=>a.date>=fortnight).map(a=>a.date)).size;
  const actualMinutes14=attempts.filter(a=>a.date>=fortnight).reduce((sum,a)=>sum+Math.max(0,Number(a.time_minutes||0)),0);
  const sCore14=new Set(attempts.filter(a=>a.date>=fortnight&&["SS","S"].includes(pmap.get(a.problem_id)?.strategy_rank||"")).map(a=>a.problem_id)).size;
  const aPlus14=new Set(attempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.strategy_rank==="A+").map(a=>a.problem_id)).size;
  const criticalS=["WB-6-S-21","WB-6-S-22"].map(problemId=>attempts.find(attempt=>attempt.problem_id===problemId)).filter(Boolean) as Attempt[];
  const past14Attempts=attempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="past_exam");
  const progress=buildProgressPlan(daysUntilExam(today,settings.exam_date),{
    a14,sCore14,aPlus14,criticalSStable:criticalS.filter(attempt=>["◎","○"].includes(attempt.mark)).length,criticalSTotal:criticalS.length,
    past14:pastSkeleton,pastFull14:past14Attempts.filter(attempt=>attempt.mode==="full"||attempt.mode==="exam_90min").length,
    pastSkeleton14:past14Attempts.filter(attempt=>attempt.mode==="skeleton").length,scan14:scans.filter(s=>String(s.date)>=fortnight).length,
    exam14:exams.filter(s=>String(s.date)>=fortnight).length,kRepeat,
    skeletonCount:skeleton.length,skeletonRate:skeleton.length?Math.round(skeletonGood/skeleton.length*100):0,
    studyDays14,actualMinutes14,delayed3,dailyTargetMinutes:settings.daily_study_minutes
  });
  const checks=progress.checks.map(item=>item.status==="ok");
  const pastAttempts=attempts.filter(attempt=>pmap.get(attempt.problem_id)?.category==="past_exam");
  const chapterCounts=new Map<number,number>();
  attempts.filter(a=>a.date>=fortnight&&a.error_type==="K").forEach(a=>{const c=pmap.get(a.problem_id)?.chapter;if(c!=null)chapterCounts.set(c,(chapterCounts.get(c)||0)+1)});
  const themeCounts=new Map<string,number>();
  weakNotes.filter(w=>!w.is_resolved).forEach(w=>themeCounts.set(w.theme,(themeCounts.get(w.theme)||0)+1));
  const weaknessAnalysis=analyzeWeaknesses(problems,attempts,reviews,weakNotes,today);
  const dashboard={
    today,weekA:new Set(attempts.filter(a=>a.date>=week&&pmap.get(a.problem_id)?.category==="A").map(a=>a.problem_id)).size,
    weekPast:pastAttempts.filter(attempt=>attempt.date>=week).length,kRecurrence:kRepeat,
    pending:reviews.filter(r=>r.status!=="done").length,overdue:reviews.filter(r=>r.status==="overdue").length,
    sStableRate:sMemory.length?Math.round(sMemory.filter(s=>s.state==="stable").length/sMemory.length*100):0,
    sForgotten:sMemory.filter(s=>["forgotten","collapsed","check"].includes(s.state)).length,
    scanSuccess:scans.length?Math.round(scans.filter(s=>s.selection_result==="good").length/scans.length*100):0,
    examSuccess:exams.length?Math.round(exams.filter(s=>Number(s.completed_questions_count)>=3).length/exams.length*100):0,
    dangerChapters:[...chapterCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([chapter,count])=>({chapter,count})),
    nextTheme:[...themeCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"ロードマップ先頭のA問題",
    analysisConfidence:weaknessAnalysis.confidence,analysisAttemptCount:weaknessAnalysis.attemptCount,
    weaknessInsights:weaknessAnalysis.insights,
    pace:{label:progress.label,checks,items:progress.checks,a14,pastSkeleton,kRepeat,
      skeletonRate:skeleton.length?Math.round(skeletonGood/skeleton.length*100):0,weakUpdates,delayed3,
      suggestion:progress.suggestion,phase:progress.phase,phaseLabel:progress.phaseLabel,summary:progress.summary,
      allocation:progress.allocation,nextPhase:progress.nextPhase,dangerCriteria:progress.dangerCriteria,
      daysRemaining:progress.daysRemaining,examDateIsEstimate:!settings.exam_date}
  };
  const dueReviews=reviews.filter(r=>r.status!=="done"&&r.due_date<=today).map(r=>{
    const p=pmap.get(r.problem_id)!;const source=attempts.find(a=>a.id===r.generated_from_attempt_id);
    const defaultMinutes=r.estimated_minutes||r.duration_minutes||20;
    const minutes=source?.is_review_attempt&&source.time_minutes>0?Math.max(3,Math.round((defaultMinutes+source.time_minutes)/2)):defaultMinutes;
    return {...r,title:p?.display_label||p?.title||(r.generated_from_past_session_id?`${r.problem_id.replace("-SESSION","")} 過去問演習`:r.problem_id),theme:p?.theme||"",error_type:source?.error_type,
      previous_date:source?.date,previous_score:source?`${source.score_text||source.score_label}${source.score_numeric!=null?` ${source.score_numeric}点`:""}`:"",
      previous_errors:source?.error_types||[source?.error_type||"none"],previous_error_point:source?.error_point||"",previous_next_action:source?.next_action||"",
      previous_improvement_guidance:source?.improvement_guidance||"",previous_required_derivation:source?.required_derivation||"",
      kind:r.review_type==="s_check"?"S確認":r.generated_from_past_session_id?"過去問復習":"復習",reason:r.status==="overdue"?`期限切れ（${r.due_date}）`:"本日が復習日",
      mode:r.requires_full_answer?"exam_90min":r.review_type==="s_check"?"skeleton":r.review_type==="main_calc_retry"?"main_calc":r.review_type==="careless_check"?"scan":"skeleton",
      minutes,estimated_minutes:minutes,load:loadFor(r.requires_full_answer?"exam_90min":r.review_type==="main_calc_retry"?"main_calc":r.review_type==="careless_check"?"scan":"skeleton")};
  }).sort((a,b)=>(a.status==="overdue"&&a.error_type==="K"?0:1)-(b.status==="overdue"&&b.error_type==="K"?0:1));
  const activeS=new Set(dueReviews.filter(r=>r.review_type==="s_check").map(r=>r.problem_id));
  const staleS=sMemory.filter(s=>!activeS.has(s.problem_id)&&(s.state==="forgotten"||s.state==="collapsed"||!!s.last_touched&&s.last_touched<=addDays(today,-30))).map(s=>{
    const p=pmap.get(s.problem_id)!,sPlan=createSReviewPlan(s.state);return {problem_id:s.problem_id,title:p.display_label||p.title,theme:p.theme,kind:"S点検",reason:s.state==="forgotten"||s.state==="collapsed"?"忘却状態から復旧":"30日以上未確認",mode:sPlan.mode,minutes:sPlan.estimated_minutes||5,load:s.state==="collapsed"?.4:.2,...planFields(sPlan)};
  });
  let load=[...dueReviews,...staleS].reduce((sum,x)=>sum+x.load,0);
  let plannedMinutes=[...dueReviews,...staleS].reduce((sum,x)=>sum+x.minutes,0);
  const seen=new Set(attempts.map(a=>a.problem_id));
  const occupied=new Set([...dueReviews,...staleS].map(task=>task.problem_id));
  const strategySTasks:any[]=[];
  const sLimit=progress.phase==="foundation"?4:progress.phase==="integration"?3:2;
  for(const problemId of STRATEGY_S_ORDER){
    if(strategySTasks.length>=sLimit||plannedMinutes>=settings.daily_study_minutes*.55) break;
    const problem=pmap.get(problemId);
    const latest=attempts.find(attempt=>attempt.problem_id===problemId);
    if(!problem||occupied.has(problemId)||(latest&&latest.date>addDays(today,-21))) continue;
    const minutes=problemId==="WB-6-S-21"||problemId==="WB-6-S-22"?15:10;
    strategySTasks.push({problem_id:problemId,title:problem.display_label||problem.title,theme:problem.theme,
      kind:"S再固定",reason:`戦略${problem.strategy_rank||"S"}・${progress.phaseLabel}`,mode:"skeleton",minutes,load:.4});
    occupied.add(problemId);load+=.4;plannedMinutes+=minutes;
  }
  const mixedProblem=progress.phase==="foundation"||progress.phase==="integration"
    ?selectMixedPractice(problems,attempts,occupied,today):undefined;
  const mixedMinutes=mixedProblem?12:0;
  const newTasks:any[]=[];
  if(progress.phase==="foundation"||progress.phase==="integration") for(const r of roadmap.filter(r=>r.is_active&&!seen.has(r.problem_id))){
    const problem=pmap.get(r.problem_id);
    if(!problem||occupied.has(r.problem_id)) continue;
    const expectedChapters=progress.phase==="foundation"?[6,4,2]:[5,7,3];
    if(problem.strategy_rank!=="A+"||!expectedChapters.includes(problem.chapter||0)) continue;
    const minutes=r.expected_mode==="full"?35:r.expected_mode==="main_calc"?20:15;
    if(newTasks.length>=3||plannedMinutes>=settings.daily_study_minutes*.9) break;
    if(newTasks.length>0&&plannedMinutes+minutes+mixedMinutes>settings.daily_study_minutes+15) break;
    newTasks.push({...r,title:problem.display_label||problem.title,theme:problem.theme,kind:"A+演習",
      reason:`${progress.phaseLabel}・ロードマップ ${r.order_index}番`,mode:r.expected_mode,minutes,load:r.load_score});
    occupied.add(r.problem_id);
    load+=r.load_score;plannedMinutes+=minutes;
  }
  const pastTasks:any[]=[];
  if(progress.phase==="past_practice"){
    const orderedPast=PAST_EXAM_YEAR_ORDER.flatMap(year=>[1,2,3,4,5].map(question=>`PY-${year}-Q${question}`));
    for(const problemId of orderedPast){
      if(pastTasks.length>=3||plannedMinutes>=settings.daily_study_minutes*.95) break;
      const problem=pmap.get(problemId);
      if(!problem||seen.has(problemId)||occupied.has(problemId)) continue;
      const question=problem.problem_number;
      const mode=question<=3?"full":"skeleton";
      const minutes=mode==="full"?35:20;
      if(pastTasks.length&&plannedMinutes+minutes>settings.daily_study_minutes+15) break;
      pastTasks.push({problem_id:problemId,title:problem.display_label||problem.title,theme:problem.theme,
        kind:"過去問",reason:`${progress.phaseLabel}・3問フル＋2問骨格`,mode,minutes,load:mode==="full"?1.5:.8});
      occupied.add(problemId);load+=mode==="full"?1.5:.8;plannedMinutes+=minutes;
    }
  }
  const simulationTasks:any[]=[];
  const weekday=new Date(`${today}T12:00:00`).getDay();
  if(progress.phase==="final"&&(weekday===0||weekday===3)&&plannedMinutes+90<=settings.daily_study_minutes+30){
    const completedSimulations=pastSessions.filter(session=>session.session_type==="exam_90min").length;
    const year=PAST_EXAM_YEAR_ORDER[completedSimulations%PAST_EXAM_YEAR_ORDER.length];
    simulationTasks.push({problem_id:`PY-${year}-Q1`,title:`${year}年 3問90分`,theme:"本番シミュレーション",
      kind:"本番シミュ",reason:"最終24日・最低3回の本番演習",mode:"exam_90min",minutes:90,load:3});
    load+=3;plannedMinutes+=90;
  }
  const mixedTasks=mixedProblem&&plannedMinutes+mixedMinutes<=settings.daily_study_minutes+15?[{problem_id:mixedProblem.problem_id,title:mixedProblem.display_label||mixedProblem.title,
    theme:mixedProblem.theme,kind:"混合確認",reason:"既習テーマから型を見分ける混合演習",mode:"skeleton",minutes:12,load:.5}]:[];
  if(mixedTasks.length){load+=.5;plannedMinutes+=mixedMinutes}
  const checkedKeys=new Set(metaEntries.filter(entry=>entry.key.startsWith(`today-check:${today}:`)&&entry.value==="1").map(entry=>entry.key));
  const tasks=[...dueReviews,...staleS,...strategySTasks,...newTasks,...pastTasks,...simulationTasks,...mixedTasks].map(task=>({
    ...task,checked:checkedKeys.has(`today-check:${today}:${task.problem_id}:${task.kind}`)
  }));
  const totalLoad=Math.round(tasks.filter(task=>!task.checked).reduce((sum,x)=>sum+x.load,0)*10)/10;
  const remainingMinutes=tasks.filter(task=>!task.checked).reduce((sum,task)=>sum+task.minutes,0);
  const actualMinutes=attempts.filter(attempt=>attempt.date===today).reduce((sum,attempt)=>sum+Math.max(0,Number(attempt.time_minutes||0)),0);
  const capacityPercent=Math.round(plannedMinutes/settings.daily_study_minutes*100);
  const warning=plannedMinutes>settings.daily_study_minutes+30
    ?`予定は${plannedMinutes}分です。目標${settings.daily_study_minutes}分を30分以上超えるため、期限の低い課題を翌日に回してください。`:"";
  const guidance=plannedMinutes<settings.daily_study_minutes-15
    ?`アプリ内予定は${plannedMinutes}分です。残り${settings.daily_study_minutes-plannedMinutes}分は弱点クイズ、解説確認、または既習A問題の混合確認に使えます。`
    :`目標${settings.daily_study_minutes}分に対して、無理のない範囲の学習計画です。`;
  return {problems:problems.sort((a,b)=>(a.chapter||99)-(b.chapter||99)||a.category.localeCompare(b.category)||a.problem_number-b.problem_number),attempts,reviews,roadmap,weakNotes,pastSessions,dashboard,settings,
    today:{tasks,totalLoad,plannedMinutes,remainingMinutes,actualMinutes,targetMinutes:settings.daily_study_minutes,capacityPercent,warning,guidance}} as Bootstrap;
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
    const chapter=body.chapter?Number(body.chapter):null,number=Number(body.problem_number),difficulty=body.difficulty?Number(body.difficulty):null;
    const display=body.source_type==="past_exam"?body.title:labelFor(chapter,body.category,number,difficulty);
    await db.problems.add({...body,id:Date.now(),chapter,problem_number:number,difficulty,completion_status:"active",
      display_label:display,roadmap_label:display,normalized_label:display.replace(/\s/g,""),
      related_s_problem_ids:list(body.linked_s_problems),linked_past_exam_ids:list(body.linked_past_exams)});
    if(body.category==="S") await db.sMemory.put({problem_id:body.problem_id,state:"stable",k_trigger_count:0});
  } else if(path==="/api/attempts") {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],()=>saveAttempt(body));
  } else if(path==="/api/import") {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],async()=>{for(const update of body.updates) await saveAttempt(update)});
  } else if(/^\/api\/attempts\/\d+\/update$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],
      ()=>updateAttemptAnalysis(Number(path.split("/")[3]),body));
  } else if(/^\/api\/attempts\/\d+\/delete$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],
      ()=>deleteAttemptAnalysis(Number(path.split("/")[3])));
  } else if(/^\/api\/reviews\/\d+\/complete$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],
      ()=>completeReview(Number(path.split("/")[3]),body));
  } else if(/^\/api\/reviews\/\d+\/done$/.test(path)) {
    await db.reviews.update(Number(path.split("/")[3]),{status:"done"});
  } else if(/^\/api\/reviews\/\d+\/pending$/.test(path)) {
    await db.reviews.update(Number(path.split("/")[3]),{status:"pending"});
  } else if(path==="/api/today-check") {
    const key=`today-check:${body.date||todayString()}:${body.problem_id}:${body.kind}`;
    if(body.checked) await db.meta.put({key,value:"1"}); else await db.meta.delete(key);
  } else if(path==="/api/settings") {
    const examDate=String(body.exam_date||"");
    const dailyMinutes=Math.max(30,Math.min(600,Number(body.daily_study_minutes||150)));
    await db.transaction("rw",db.meta,db.reviews,async()=>{
      await db.meta.put({key:"exam_date",value:examDate});
      await db.meta.put({key:"daily_study_minutes",value:String(dailyMinutes)});
      if(examDate&&examDate>todayString()){
        const cap=addDays(examDate,-3),minimum=addDays(todayString(),1);
        const due=cap>minimum?cap:minimum;
        const pending=await db.reviews.filter(review=>review.status!=="done"&&review.due_date>=addDays(examDate,-2)).toArray();
        for(const review of pending) await db.reviews.update(review.id,{due_date:due});
      }
    });
  } else if(/^\/api\/weak-notes\/\d+\/resolve$/.test(path)) {
    await db.weakNotes.update(Number(path.split("/")[3]),{is_resolved:1});
  } else if(/^\/api\/weak-notes\/\d+\/unresolve$/.test(path)) {
    await db.weakNotes.update(Number(path.split("/")[3]),{is_resolved:0,quiz_correct_count:0});
  } else if(/^\/api\/weak-notes\/\d+\/quiz$/.test(path)) {
    const id=Number(path.split("/")[3]),note=await db.weakNotes.get(id);
    if(!note) throw new Error("弱点ノートが見つかりません");
    await db.weakNotes.update(id,applyWeakNoteQuizResult(note,body.result==="remembered"?"remembered":"retry"));
  } else if(path==="/api/past-sessions") {
    await db.transaction("rw",db.pastSessions,db.reviews,db.meta,async()=>{
      const session={...body,id:undefined as unknown as number,year:Number(body.year),selection_time_minutes:Number(body.selection_time_minutes||0),completed_questions_count:Number(body.completed_questions_count||0)};
      const sessionId=Number(await db.pastSessions.add(session));
      const plan=createPastReviewPlan(session);
      await addOrReplaceReview({
        problem_id:`PY-${session.year}-SESSION`,
        due_date:await reviewDueDate(String(session.date||todayString()),plan.interval_days||7),review_type:plan.review_type,
        status:"pending",generated_from_attempt_id:0,generated_from_past_session_id:sessionId,
        duration_minutes:plan.estimated_minutes,reason:plan.review_reason,...planFields(plan)
      });
    });
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
