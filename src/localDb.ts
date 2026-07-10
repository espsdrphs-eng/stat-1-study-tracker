import Dexie, { type EntityTable } from "dexie";
import type { AnswerIndexEntry, Attempt, Bootstrap, CorrectionLog, DataDiagnostic, MasterImportLog, PastSession, Problem, ProblemAlias, Review, Roadmap, StudyUpdate, Task, TodayPlanSnapshot, WeakNote } from "./types";
import { japaneseizeMathText } from "./mathJapanese.ts";
import { analyzeWeaknesses } from "./weaknessAnalytics.ts";
import { createAdaptiveReviewPlan, createAttemptReviewPlan, createPastReviewPlan, createSReviewPlan, enforceReviewEvidence, normalizedErrors, type ReviewOutcome, type ReviewPlan, type SState } from "./reviewRules.ts";
import { postponedDueDate } from "./reviewScheduling.ts";
import { applyWeakNoteQuizResult } from "./weakNoteQuiz.ts";
import { selectMixedPractice } from "./studyScheduler.ts";
import { triageTodayTasks } from "./studyTriage.ts";
import { summarizeTodayTime } from "./todayPlan.ts";
import { removeTimingExpressions, sanitizeStudyUpdateTiming } from "./reviewTiming.ts";
import { buildProgressPlan, daysUntilExam } from "./studyProgress.ts";
import { CHAPTER_META, officialProblemEntries, PAST_EXAM_YEAR_ORDER, STRATEGY_A_PLUS_ORDER, STRATEGY_S_ORDER, strategyRankFor } from "./officialMaster.ts";
import { REVIEW_RUBRIC_VERSION } from "./gradingPrompt.ts";
import { allowedReferenceLevel, referenceDecision, type ReferenceLevel } from "./reviewExperience.ts";
import { applyCanonicalMaster, parseAliasesPayload, parseAnswerIndexPayload, parseIntegratedMasterPayload, parseProblemMasterPayload, relatedSIntegrity } from "./masterData.ts";
import { finalizeStudyUpdateForSave } from "./studyCycle.ts";

type SMemory = { problem_id:string; state:"stable"|"check"|"forgotten"|"collapsed"; last_touched?:string; k_trigger_count:number };
type StoredAttempt = Attempt;
type StoredReview = Review;
type StoredWeakNote = WeakNote;
type StoredPastSession = PastSession;
type StoredAnswerPdf={file_name:string;blob:Blob;uploaded_at:string};

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
  answerIndex!: EntityTable<AnswerIndexEntry,"problem_id">;
  correctionLogs!: EntityTable<CorrectionLog,"id">;
  answerPdfs!: EntityTable<StoredAnswerPdf,"file_name">;
  problemAliases!: EntityTable<ProblemAlias,"alias">;
  importLogs!: EntityTable<MasterImportLog,"id">;
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
    this.version(10).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type,task_origin,source_problem_id",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",
      meta:"&key",
      answerIndex:"&problem_id,answer_available,pdf_file_name",
      correctionLogs:"++id,corrected_at,raw_gpt_problem_id,corrected_problem_id",
      answerPdfs:"&file_name,uploaded_at"
    }).upgrade(async tx=>{
      const now=new Date().toISOString();
      const canonical=[
        {problem_id:"WB-6-S-01",theme:"指数型分布族・自然母数・期待値母数",canonical_problem_type:"指数型分布族の読み取り",
          canonical_keywords:["指数型分布族","自然母数","期待値母数","t(X)","Bin(n,p)","Po(λ)","Geo(p)","NB(r,p)","N(μ,σ²)","Ga(α,β)","Beta(α,β)"]},
        {problem_id:"WB-6-S-04",theme:"U(0,θ)、十分統計量、不偏推定量、MSE、MLE",canonical_problem_type:"一様分布の推定・十分統計量・MSE比較",
          canonical_keywords:["U(0,θ)","最大統計量","十分統計量","不偏推定量","標本平均","MSE","最尤推定量","バイアス"]}
      ];
      for(const entry of canonical){
        const problem=await tx.table("problems").get(entry.problem_id) as Problem|undefined;
        if(problem) await tx.table("problems").put({...problem,...entry,canonical_title:problem.display_label||problem.title,
          answer_available:true,master_version:"mathstat-master-v1"});
      }
      const a5=await tx.table("problems").get("WB-6-A-05") as Problem|undefined;
      if(a5) await tx.table("problems").put({...a5,linked_s_problems:"",related_s_problem_ids:[]});
      const q1=await tx.table("problems").get("PY-2025-Q1") as Problem|undefined;
      if(q1) await tx.table("problems").put({...q1,linked_s_problems:"",related_s_problem_ids:[]});
      const answers:AnswerIndexEntry[]=[
        {problem_id:"WB-6-S-01",answer_available:true,pdf_file_name:"MathStat_Answers.pdf",page_start:null,page_end:null,
          section_label:"第6章 問1",answer_excerpt:"Bin, Po, Geo, NB, N, Ga, Beta について、確率関数・密度関数を指数型分布族の形に直し、自然母数 η と t(X) の期待値を読む問題。",
          canonical_keywords:canonical[0].canonical_keywords,imported_at:now,index_version:"mathstat-answers-v1"},
        {problem_id:"WB-6-S-04",answer_available:true,pdf_file_name:"MathStat_Answers.pdf",page_start:null,page_end:null,
          section_label:"第6章 問4",answer_excerpt:"X1,...,Xn が U(0,θ) に従う設定。θに対する十分統計量、最大統計量に基づく不偏推定量、標本平均に基づく不偏推定量、MSE比較、MLE、バイアス、MSEを扱う問題。",
          canonical_keywords:canonical[1].canonical_keywords,imported_at:now,index_version:"mathstat-answers-v1"}
      ];
      await tx.table("answerIndex").bulkPut(answers);
      await tx.table("meta").bulkPut([
        {key:"problem_master_version",value:"mathstat-master-v1"},{key:"problem_master_updated_at",value:now},
        {key:"answer_index_version",value:"mathstat-answers-v1"},{key:"answer_index_updated_at",value:now}
      ]);
      const priorAttempts=await tx.table("attempts").toArray() as Attempt[];
      const priorReviews=await tx.table("reviews").toArray() as Review[];
      for(const review of priorReviews){
        const linked=review.review_type==="s_check",source=priorAttempts.find(attempt=>attempt.id===review.generated_from_attempt_id);
        if(linked&&review.problem_id==="WB-6-S-04"&&source?.problem_id==="WB-6-A-05"&&review.status!=="done"){
          await tx.table("reviews").delete(review.id);continue;
        }
        review.task_origin=linked?"linked_s_check":"review_attempt";
        review.source_problem_id=linked?source?.problem_id:undefined;
        review.attempt_exists=priorAttempts.some(attempt=>attempt.problem_id===review.problem_id);
        review.review_goal_public=linked?"元問題で崩れた基礎型を確認する":undefined;
        await tx.table("reviews").put(review);
      }
    });
    this.version(11).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type,task_origin,source_problem_id",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",meta:"&key",
      answerIndex:"&problem_id,answer_available,pdf_file_name",
      correctionLogs:"++id,corrected_at,raw_gpt_problem_id,corrected_problem_id",
      answerPdfs:"&file_name,uploaded_at",problemAliases:"&alias,problem_id",
      importLogs:"++id,imported_at,file_kind"
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
  [6,1,"指数型分布族・自然母数・期待値母数"],[6,4,"U(0,θ)、十分統計量、不偏推定量、MSE、MLE"],[6,21,"回帰・推定"],[6,22,"回帰・分散分解"],
  [4,7,"変数変換・ヤコビアン"],[5,13,"順序統計量"],[5,17,"最大値・最小値"],
  [7,9,"exact検定"],[7,10,"尤度比検定"]
];
const sLinks:Record<string,string> = {
  "WB-6-A-19":"WB-6-S-21;WB-6-S-22","WB-6-A-20":"WB-6-S-21;WB-6-S-22",
  "WB-4-A-26":"WB-4-S-07","WB-5-A-18":"WB-5-S-13;WB-5-S-17","WB-5-A-21":"WB-5-S-13",
  "WB-5-A-26":"WB-5-S-13;WB-5-S-17","WB-7-A-04":"WB-7-S-09","WB-7-A-08":"WB-7-S-10"
};
const repairRules:[string,string[],string[]][] = [
  ["AIC・自由度",["WB-6-A-05"],[]],["回帰",["WB-6-A-19","WB-6-A-20"],["WB-6-S-21","WB-6-S-22"]],
  ["Fisher情報量",["WB-6-A-26"],[]],["非正則推定",["WB-6-A-10","WB-6-A-29"],[]],
  ["順序統計量",["WB-5-A-18","WB-5-A-21","WB-5-A-26"],["WB-5-S-13","WB-5-S-17"]],
  ["最小値・最大値",["WB-5-A-18","WB-5-A-26"],["WB-5-S-17"]],["ポアソン条件付き",["WB-4-A-34"],[]],
  ["変数変換",["WB-2-A-24","WB-4-A-26"],["WB-4-S-07"]],["パレート",["WB-3-A-11","WB-3-A-12"],[]],
  ["exact検定",["WB-7-A-04"],["WB-7-S-09"]],["LRT",["WB-7-A-08"],["WB-7-S-10"]],
  ["回帰検定",["WB-7-A-22"],[]],["信頼区間",["WB-8-A-13","WB-8-A-14"],[]]
];

const loadFor=(mode:string)=>({check:.2,skeleton:.5,main_calc:.8,full:1.2,scan:.6,exam_90min:3}[mode]??.5);
const todayString=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const taskSnapshotId=(task:Task)=>task.id&&task.review_type?`review:${task.id}`:`task:${task.problem_id}:${task.kind}`;
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
const attemptMatchesProblem=(attempt:Attempt,problem:Problem)=>{
  const text=[attempt.result_summary,attempt.error_point,attempt.next_action,attempt.improvement_guidance,attempt.required_derivation,attempt.corrected_answer].join(" ");
  if(problem.problem_id==="WB-6-S-04"&&/AIC|自由度|指数型分布族|自然母数|期待値母数/.test(text)&&!/U\(0|一様分布|最大統計量|不偏推定量|MSE/.test(text)) return false;
  if(problem.problem_id==="WB-6-S-01"&&/U\(0|一様分布|最大統計量|MSE/.test(text)&&!/指数型分布族|自然母数|期待値母数/.test(text)) return false;
  return true;
};

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
    problems.push({id:id++,problem_id:"PY-2025-Q1",source_type:"past_exam",category:"past_exam",chapter:null,problem_number:1,title:"2025年問1",theme:"AIC・区分的密度・MLE",priority:"core",role:"exam",recommended_mode:"scan",linked_past_exams:"",linked_s_problems:"",linked_a_problems:"WB-6-A-05",notes:"",completion_status:"active",display_label:"2025年問1",difficulty:null,roadmap_label:"2025年問1",normalized_label:"2025年問1",related_s_problem_ids:[],linked_past_exam_ids:[]});
    await db.problems.bulkPut(problems);
    await db.sMemory.bulkPut(sSeed.map(([chapter,number])=>({problem_id:`WB-${chapter}-S-${String(number).padStart(2,"0")}`,state:"stable",k_trigger_count:0})));
    await db.roadmap.bulkPut(roadmapSeed.map(([chapter,number,,mode],i)=>({id:i+1,order_index:i+1,problem_id:`WB-${chapter}-A-${String(number).padStart(2,"0")}`,block_name:blocks.find(([from,to])=>i+1>=from&&i+1<=to)![2],expected_mode:mode,load_score:loadFor(mode),is_active:1})));
    await db.meta.put({key:"seeded",value:"1"});
  });
}

async function ensureBuiltInCanonical(){
  const now=new Date().toISOString();
  const definitions=[
    {problem_id:"WB-6-S-01",theme:"指数型分布族・自然母数・期待値母数",canonical_problem_type:"指数型分布族の読み取り",
      canonical_keywords:["指数型分布族","自然母数","期待値母数","t(X)","Bin(n,p)","Po(λ)","Geo(p)","NB(r,p)","N(μ,σ²)","Ga(α,β)","Beta(α,β)"],
      excerpt:"Bin, Po, Geo, NB, N, Ga, Beta について、確率関数・密度関数を指数型分布族の形に直し、自然母数 η と t(X) の期待値を読む問題。",section:"第6章 問1"},
    {problem_id:"WB-6-S-04",theme:"U(0,θ)、十分統計量、不偏推定量、MSE、MLE",canonical_problem_type:"一様分布の推定・十分統計量・MSE比較",
      canonical_keywords:["U(0,θ)","最大統計量","十分統計量","不偏推定量","標本平均","MSE","最尤推定量","バイアス"],
      excerpt:"X1,...,Xn が U(0,θ) に従う設定。θに対する十分統計量、最大統計量に基づく不偏推定量、標本平均に基づく不偏推定量、MSE比較、MLE、バイアス、MSEを扱う問題。",section:"第6章 問4"}
  ];
  for(const definition of definitions){
    const problem=await db.problems.get(definition.problem_id);
    if(problem) await db.problems.update(definition.problem_id,{
      theme:definition.theme,canonical_title:problem.display_label||problem.title,canonical_problem_type:definition.canonical_problem_type,
      canonical_keywords:definition.canonical_keywords,answer_available:true,master_version:problem.master_version||"mathstat-master-v1"
    });
    const priorAnswer=await db.answerIndex.get(definition.problem_id);
    await db.answerIndex.put({
      ...priorAnswer,problem_id:definition.problem_id,answer_available:true,pdf_file_name:priorAnswer?.pdf_file_name||"MathStat_Answers.pdf",
      page_start:priorAnswer?.page_start??null,page_end:priorAnswer?.page_end??null,
      section_label:definition.section,answer_excerpt:definition.excerpt,canonical_keywords:definition.canonical_keywords,
      imported_at:priorAnswer?.imported_at||now,index_version:priorAnswer?.index_version||"mathstat-answers-v1"
    });
  }
  if(!await db.meta.get("problem_master_version")) await db.meta.put({key:"problem_master_version",value:"mathstat-master-v1"});
  if(!await db.meta.get("answer_index_version")) await db.meta.put({key:"answer_index_version",value:"mathstat-answers-v1"});
}

const planFields=(plan:ReviewPlan)=>({
  review_reason:plan.review_reason,review_method:plan.review_method,review_instruction:plan.review_instruction,
  review_steps:plan.review_steps,estimated_minutes:plan.estimated_minutes,requires_full_answer:plan.requires_full_answer,
  requires_s_check:plan.requires_s_check,linked_s_problem_ids:plan.linked_s_problem_ids,interval_days:plan.interval_days
});
type ReviewInsert=Omit<Review,"id">;
async function addOrReplaceReview(review:ReviewInsert){
  const pending=(await db.reviews.where("problem_id").equals(review.problem_id).toArray()).filter(item=>item.status!=="done");
  const scheduled=pending.filter(item=>item.status!=="deferred");
  const dueDate=[review.due_date,...scheduled.map(item=>item.due_date)].sort()[0];
  if(pending.length) await db.reviews.bulkDelete(pending.map(item=>item.id));
  return Number(await db.reviews.add({id:undefined as unknown as number,...review,due_date:dueDate}));
}

async function saveAttempt(input:StudyUpdate&Record<string,unknown>) {
  input={...input,...sanitizeStudyUpdateTiming(input)};
  const problem=await db.problems.get(input.problem_id);
  if(!problem) throw new Error(`未登録の問題IDです: ${input.problem_id}`);
  if(input.requires_problem_confirmation) throw new Error("問題ID候補を確認してから保存してください");
  const answer=await db.answerIndex.get(problem.problem_id);
  input=finalizeStudyUpdateForSave(applyCanonicalMaster(input,problem,answer,await db.problems.toArray(),await db.answerIndex.toArray())) as StudyUpdate&Record<string,unknown>;
  if(input.requires_problem_confirmation) throw new Error(`取り込み内容は ${input.suggested_problem_id||"別の問題"} の可能性があります。問題IDを確認してください`);
  if(input.generated_from_review_id&&[REVIEW_RUBRIC_VERSION,"STAT1-REVIEW-v7","STAT1-REVIEW-v6","STAT1-REVIEW-v5","STAT1-REVIEW-v4"].includes(input.rubric_version||"")){
    const review=await db.reviews.get(input.generated_from_review_id);
    const source=review?await db.attempts.get(review.generated_from_attempt_id):undefined;
    const previousErrors=source?normalizedErrors(source):[];
    input=enforceReviewEvidence(input,previousErrors,input.rubric_version||REVIEW_RUBRIC_VERSION) as StudyUpdate&Record<string,unknown>;
  }
  const date=input.date||todayString();
  const localizedNextAction=japaneseizeMathText(input.next_action||"");
  const improvementGuidance=japaneseizeMathText(input.improvement_guidance||"");
  const requiredDerivation=japaneseizeMathText(input.required_derivation||"");
  const correctedAnswer=japaneseizeMathText(input.corrected_answer||"");
  const primary=input.primary_error_type||input.error_type||"none";
  const errors=input.error_types?.length?input.error_types:[primary];
  const hasRealError=errors.some(error=>["K","W","N","C"].includes(String(error)));
  const localizedErrorPoint=japaneseizeMathText(input.error_point||(hasRealError?"":"大きな問題なし"));
  const actualMinutes=Number(input.actual_minutes??input.time_minutes??0);
  const actualReferenceLevel=Math.min(5,Math.max(0,Number(input.actual_reference_level??input.reference_level??(
    input.external_reference?5:input.official_answer?4:input.saved_gpt_feedback||input.gpt_explanation?3:
      input.previous_mistake?2:input.one_line_hint?1:0
  ))));
  const allowedReference=Math.min(5,Math.max(0,Number(input.allowed_reference_level??0)));
  const referenceClosed=!!(input.reference_closed_reproduction??input.after_hint_reproduced);
  const related=[...new Set([...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)])];
  const id=Number(await db.attempts.add({
    id:undefined as unknown as number,problem_id:input.problem_id,date,mode:input.mode||problem.recommended_mode,
    time_minutes:actualMinutes,mark:input.mark||"△",score_label:input.score_label||"B",
    error_type:primary,error_point:localizedErrorPoint,next_action:localizedNextAction,memo:String(input.memo||""),
    score_text:input.score_text||"",score_numeric:input.score_numeric??null,score_max:input.score_max??null,
    result_summary:japaneseizeMathText(input.result_summary||""),exam_selection_rank:input.exam_selection_rank||"",
    improvement_guidance:improvementGuidance,required_derivation:requiredDerivation,corrected_answer:correctedAnswer,
    target_issue_resolved:input.target_issue_resolved,minimum_pass_condition_met:input.minimum_pass_condition_met,
    resolution_evidence:japaneseizeMathText(input.resolution_evidence||""),
    answer_change_summary:japaneseizeMathText(input.answer_change_summary||""),
    required_work_shown:(input.required_work_shown||[]).map(japaneseizeMathText),
    error_types:errors,primary_error_type:primary,
    secondary_error_type:input.secondary_error_type||"",ignored_parts:input.ignored_parts||[],
    auto_imported:!!input.auto_imported,import_confidence:input.import_confidence??(input.auto_imported?.8:1),
    grading_confidence:input.grading_confidence??null,rubric_version:input.rubric_version||"",
    uncertain_points:input.uncertain_points||[],generated_from_review_id:input.generated_from_review_id,
    is_review_attempt:!!input.generated_from_review_id,evaluation_scope:input.evaluation_scope||"",
    graded_parts:input.graded_parts||[],assumed_correct_parts:input.assumed_correct_parts||[],
    unresolved_carryover:input.unresolved_carryover||[],hint_used:!!input.hint_used,
    hint_level:input.hint_level||"none",after_hint_reproduced:!!input.after_hint_reproduced,
    reference_level:actualReferenceLevel,actual_reference_level:actualReferenceLevel,
    allowed_reference_level:allowedReference,reference_closed_reproduction:referenceClosed,
    no_hint:input.no_hint??actualReferenceLevel===0,
    one_line_hint:!!input.one_line_hint,previous_mistake:!!input.previous_mistake,
    saved_gpt_feedback:!!input.saved_gpt_feedback||!!input.gpt_explanation,
    official_answer:!!input.official_answer,external_reference:!!input.external_reference,
    gpt_explanation:!!input.saved_gpt_feedback||!!input.gpt_explanation,
    task_origin:input.task_origin||(input.generated_from_review_id?"review_attempt":"first_attempt"),attempt_exists:true,
    raw_gpt_problem_id:input.raw_gpt_problem_id||input.problem_id,raw_gpt_theme:input.raw_gpt_theme||"",
    auto_corrected:!!input.auto_corrected,correction_fields:input.correction_fields||[],
    correction_reason:input.correction_reason||"",consistency_score:input.consistency_score
  }));
  if(input.auto_corrected) await db.correctionLogs.add({
    id:undefined,auto_corrected:true,correction_fields:input.correction_fields||[],
    raw_gpt_problem_id:String(input.raw_gpt_problem_id||input.problem_id),corrected_problem_id:input.problem_id,
    raw_gpt_theme:String(input.raw_gpt_theme||""),corrected_theme:problem.theme,
    correction_reason:String(input.correction_reason||"problem_master に基づき補正"),
    consistency_score:Number(input.consistency_score||0),corrected_at:new Date().toISOString()
  });
  if(input.generated_from_review_id){
    await db.reviews.update(input.generated_from_review_id,{
      status:"done",completion_result:input.review_outcome||(["◎","○"].includes(input.mark)?"success":input.mark==="△"?"partial":"failed"),
      hint_used:!!input.hint_used,hint_level:input.hint_level||"none",
      after_hint_reproduced:!!input.after_hint_reproduced,
      reference_level:actualReferenceLevel,actual_reference_level:actualReferenceLevel,
      allowed_reference_level:allowedReference,reference_closed_reproduction:referenceClosed,
      no_hint:input.no_hint??actualReferenceLevel===0,
      one_line_hint:!!input.one_line_hint,previous_mistake:!!input.previous_mistake,
      saved_gpt_feedback:!!input.saved_gpt_feedback||!!input.gpt_explanation,
      official_answer:!!input.official_answer,external_reference:!!input.external_reference,
      gpt_explanation:!!input.saved_gpt_feedback||!!input.gpt_explanation,
      completion_time_minutes:actualMinutes,completed_at:date
    });
  }
  const attempts=(await db.attempts.where("problem_id").equals(input.problem_id).sortBy("date")).filter(x=>x.id!==id);
  const previous=attempts.at(-1);
  let consecutivePerfect=0;
  for(const attempt of [...attempts].reverse()){if(attempt.mark==="◎") consecutivePerfect++;else break}
  const sState:SState=input.mark==="◎"||input.mark==="○"?"stable":input.mark==="×"?"forgotten":"check";
  const basePlan=problem.category==="S"?createSReviewPlan(sState):createAttemptReviewPlan(input,related,consecutivePerfect);
  const exceedsAllowed=actualReferenceLevel>allowedReference;
  const plan=input.generated_from_review_id&&exceedsAllowed&&actualReferenceLevel>=3
    ?{...basePlan,interval_days:3,review_reason:"許可範囲を超えて保存済み解説・公式解答・外部資料を参照したため、3日後に再確認する。"}
    :input.generated_from_review_id&&exceedsAllowed
      ?{...basePlan,interval_days:Math.min(7,basePlan.interval_days||7),review_reason:"許可参照段階を超えたため、次回間隔を軽く短縮する。"}
      :basePlan;
  await addOrReplaceReview({
    problem_id:input.problem_id,due_date:await reviewDueDate(date,plan.interval_days||14),
    review_type:plan.review_type,status:"pending",generated_from_attempt_id:id,duration_minutes:plan.estimated_minutes,
    reason:plan.review_reason,task_origin:"review_attempt",attempt_exists:true,...planFields(plan)
  });
  if(plan.completion_candidate) await db.problems.update(input.problem_id,{completion_status:"completion_candidate"});
  const weakCandidates=input.weak_notes?.length?input.weak_notes:input.weak_note?[input.weak_note]:
    primary!=="none"&&localizedErrorPoint?[{theme:input.theme||problem.theme,error_type:primary,mistake:localizedErrorPoint,correction_rule:japaneseizeMathText(input.correction_rule||localizedNextAction)}]:[];
  for(const weak of weakCandidates) await db.weakNotes.add({
    id:undefined as unknown as number,date,problem_id:input.problem_id,error_type:weak.error_type||primary,
    theme:problem.theme,mistake:japaneseizeMathText(weak.mistake),
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
        reason:sPlan.review_reason,task_origin:"linked_s_check",source_problem_id:input.problem_id,
        attempt_exists:(await db.attempts.where("problem_id").equals(sid).count())>0,
        review_goal_public:"元問題で崩れた基礎型を確認する",...planFields(sPlan)
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
            reason:collapsedPlan.review_reason,task_origin:"linked_s_check",source_problem_id:input.problem_id,
            attempt_exists:(await db.attempts.where("problem_id").equals(s.problem_id).count())>0,
            review_goal_public:"同じ章でKが重なったため基礎型を確認する",...planFields(collapsedPlan)
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
    nextAction=removeTimingExpressions(japaneseizeMathText(String(body.next_action??attempt.next_action)));
  const scoreValue=body.score_numeric??attempt.score_numeric;
  const updated:Attempt={...attempt,date,mode:String(body.mode||attempt.mode),
    time_minutes:body.time_minutes===""||body.time_minutes==null?attempt.time_minutes:Number(body.time_minutes),
    mark:String(body.mark||attempt.mark),score_label:String(body.score_label||attempt.score_label),
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
    reason:plan.review_reason,task_origin:"review_attempt",attempt_exists:true,...planFields(plan)});
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
        reason:sPlan.review_reason,task_origin:"linked_s_check",source_problem_id:attempt.problem_id,
        attempt_exists:(await db.attempts.where("problem_id").equals(sid).count())>0,
        review_goal_public:"元問題で崩れた基礎型を確認する",...planFields(sPlan)});
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
  const latest=[...remaining].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
  if(latest&&problem){
    const plan=problem.category==="S"
      ?createSReviewPlan(latest.mark==="◎"||latest.mark==="○"?"stable":latest.mark==="×"?"forgotten":"check")
      :createAttemptReviewPlan(latest,related,0);
    await addOrReplaceReview({problem_id:latest.problem_id,due_date:await reviewDueDate(latest.date,plan.interval_days||14),
      review_type:plan.review_type,status:"pending",generated_from_attempt_id:latest.id,duration_minutes:plan.estimated_minutes,
      reason:plan.review_reason,task_origin:"review_attempt",attempt_exists:true,...planFields(plan)});
  }
  await db.problems.update(attempt.problem_id,{completion_status:stillWeak?"review_pending":"active"});
}

async function completeReview(id:number,body:Record<string,unknown>){
  const review=await db.reviews.get(id);
  if(!review) throw new Error("復習予定が見つかりません");
  const source=await db.attempts.get(review.generated_from_attempt_id);
  const problem=await db.problems.get(review.problem_id);
  if(!source||!problem) throw new Error("復習元の採点データが見つかりません");
  const linkedS=review.task_origin==="linked_s_check"||review.review_type==="s_check";
  const requestedResult=["success","partial","failed"].includes(String(body.result))?String(body.result) as ReviewOutcome["result"]:"partial";
  const actualReferenceLevel=Math.min(5,Math.max(0,Number(body.actual_reference_level??body.reference_level??0))) as ReferenceLevel;
  const reviewMode=review.requires_full_answer?"exam_90min":review.review_type==="main_calc_retry"?"main_calc":
    ["careless_check","light_check"].includes(review.review_type)?"check":"skeleton";
  const fallbackAllowed=allowedReferenceLevel({previous_errors:source.error_types||[source.error_type],mode:reviewMode,
    requires_full_answer:review.requires_full_answer});
  const allowedReference=Math.min(5,Math.max(0,Number(body.allowed_reference_level??fallbackAllowed))) as ReferenceLevel;
  const referenceClosed=!!(body.reference_closed_reproduction??body.after_hint_reproduced);
  const referenceCheck=referenceDecision(requestedResult,allowedReference,actualReferenceLevel,referenceClosed);
  const hintUsed=actualReferenceLevel>0||!!body.hint_used,afterHintReproduced=referenceClosed;
  const outcome:ReviewOutcome={
    result:referenceCheck.result,
    hint_used:hintUsed,after_hint_reproduced:afterHintReproduced,time_minutes:Number(body.time_minutes||0),
    reference_level:actualReferenceLevel,allowed_reference_level:allowedReference,
    actual_reference_level:actualReferenceLevel,reference_closed_reproduction:referenceClosed,
    no_hint:actualReferenceLevel===0,one_line_hint:!!body.one_line_hint,
    previous_mistake:!!body.previous_mistake,official_answer:!!body.official_answer,
    saved_gpt_feedback:!!body.saved_gpt_feedback||!!body.gpt_explanation,
    external_reference:!!body.external_reference,gpt_explanation:!!body.saved_gpt_feedback||!!body.gpt_explanation
  };
  const related=[...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)];
  const successful=outcome.result==="success";
  const plan=linkedS?createSReviewPlan(successful?"stable":outcome.result==="partial"?"check":"forgotten"):
    createAdaptiveReviewPlan(source,review,outcome,related);
  const sourceErrors=linkedS?[]:(source.error_types||[source.error_type]).filter(error=>error!=="none");
  const errors=successful?[]:sourceErrors.length?sourceErrors:["K"];
  const date=todayString(),mark=successful?(outcome.hint_used?"○":"◎"):outcome.result==="partial"?"△":"×";
  const attemptId=Number(await db.attempts.add({
    ...source,id:undefined as unknown as number,problem_id:review.problem_id,date,mode:plan.mode,
    time_minutes:outcome.time_minutes,mark,score_label:successful?"A":outcome.result==="partial"?"B":"C",
    error_type:errors[0]||"none",primary_error_type:errors[0]||"none",secondary_error_type:errors[1]||"",
    error_types:errors,error_point:successful?"":linkedS?"関連S確認で基礎型を再現できなかった":source.error_point,
    next_action:plan.review_instruction||"",memo:"復習結果から自動記録",
    score_text:"",score_numeric:null,score_max:null,result_summary:`復習結果：${outcome.result}${outcome.hint_used?"・ヒント使用":""}`,
    improvement_guidance:linkedS?"":source.improvement_guidance,required_derivation:linkedS?"":source.required_derivation,
    corrected_answer:linkedS?"":source.corrected_answer,resolution_evidence:"",answer_change_summary:"",
    required_work_shown:[],graded_parts:[],assumed_correct_parts:[],unresolved_carryover:[],
    auto_imported:false,import_confidence:1,grading_confidence:1,rubric_version:"REVIEW-SELF-v1",
    uncertain_points:[],generated_from_review_id:id,is_review_attempt:true,hint_used:outcome.hint_used,
    hint_level:String(body.hint_level|| (outcome.hint_used?"unspecified":"none")),
    after_hint_reproduced:referenceClosed,reference_closed_reproduction:referenceClosed,
    reference_level:actualReferenceLevel,actual_reference_level:actualReferenceLevel,
    allowed_reference_level:allowedReference,no_hint:actualReferenceLevel===0,
    one_line_hint:!!body.one_line_hint,previous_mistake:!!body.previous_mistake,
    saved_gpt_feedback:!!body.saved_gpt_feedback||!!body.gpt_explanation,
    official_answer:!!body.official_answer,external_reference:!!body.external_reference,
    gpt_explanation:!!body.saved_gpt_feedback||!!body.gpt_explanation,
    task_origin:linkedS?"linked_s_check":"review_attempt",source_problem_id:linkedS?source.problem_id:undefined,attempt_exists:true
  }));
  await db.reviews.update(id,{status:"done",completion_result:outcome.result,hint_used:outcome.hint_used,
    hint_level:String(body.hint_level|| (outcome.hint_used?"unspecified":"none")),after_hint_reproduced:!!outcome.after_hint_reproduced,
    reference_level:actualReferenceLevel,actual_reference_level:actualReferenceLevel,
    allowed_reference_level:allowedReference,reference_closed_reproduction:referenceClosed,
    no_hint:actualReferenceLevel===0,one_line_hint:!!body.one_line_hint,
    previous_mistake:!!body.previous_mistake,official_answer:!!body.official_answer,
    saved_gpt_feedback:!!body.saved_gpt_feedback||!!body.gpt_explanation,
    external_reference:!!body.external_reference,gpt_explanation:!!body.saved_gpt_feedback||!!body.gpt_explanation,
    completion_time_minutes:outcome.time_minutes,completed_at:new Date().toISOString()});
  await addOrReplaceReview({problem_id:review.problem_id,due_date:await reviewDueDate(date,plan.interval_days||14),
    review_type:plan.review_type,status:"pending",generated_from_attempt_id:attemptId,duration_minutes:plan.estimated_minutes,
    reason:plan.review_reason,task_origin:"review_attempt",attempt_exists:true,...planFields(plan)});
  if(successful){
    const resolved=(await db.weakNotes.toArray()).filter(note=>note.generated_from_attempt_id===source.id);
    for(const note of resolved) await db.weakNotes.update(note.id,{is_resolved:1});
  }
  if(!linkedS&&!successful&&source.error_point) await db.weakNotes.add({
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
        reason:sPlan.review_reason,task_origin:"linked_s_check",source_problem_id:review.problem_id,
        attempt_exists:(await db.attempts.where("problem_id").equals(sid).count())>0,
        review_goal_public:"元問題で崩れた基礎型を確認する",...planFields(sPlan)});
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

async function postponeReview(id:number,body:Record<string,unknown>){
  const review=await db.reviews.get(id);
  if(!review) throw new Error("移動する復習予定が見つかりません");
  if(review.status==="done") throw new Error("完了済みの復習予定は移動できません");
  const today=todayString();
  const unscheduled=!!body.unscheduled;
  const dueDate=unscheduled?review.due_date:postponedDueDate(today,body);
  const isToday=String(body.action)==="today";
  const postponedAt=new Date().toISOString();
  const count=Number(review.postpone_count||review.postponed_count||0)+(isToday?0:1);
  await db.reviews.update(id,{
    due_date:dueDate,status:unscheduled?"deferred":"pending",manual_order:isToday?0:Date.now(),
    triage_override:isToday?"must":undefined,
    postponed_count:count,postpone_count:count,last_postponed_at:postponedAt,
    postponed_at:postponedAt,postponed_to:unscheduled?"unscheduled":dueDate,
    postpone_reason:String(body.postpone_reason||"手動調整")
  });
  if(isToday) await db.meta.delete(`today-plan-snapshot:${today}`);
}

async function postponeTask(body:Record<string,unknown>){
  const problemId=String(body.problem_id||""),kind=String(body.kind||"課題");
  if(!problemId) throw new Error("移動する課題が見つかりません");
  const key=`task-postpone:${problemId}:${kind}`;
  const previous=await db.meta.get(key);
  let old:Record<string,unknown>={};
  try{old=previous?JSON.parse(previous.value):{}}catch{old={}}
  const today=todayString(),unscheduled=!!body.unscheduled,isToday=String(body.action)==="today";
  const destination=unscheduled?"unscheduled":postponedDueDate(today,body);
  const record={
    problem_id:problemId,kind,postponed_at:new Date().toISOString(),postponed_to:destination,
    postpone_reason:String(body.postpone_reason||"手動調整"),
    postpone_count:Number(old.postpone_count||0)+(isToday?0:1),
    triage_override:isToday?"must":"",
    mode:String(body.mode||"skeleton"),review_method:String(body.review_method||""),
    review_reason:String(body.review_reason||""),estimated_minutes:Number(body.estimated_minutes||0),
    previous_errors:Array.isArray(body.previous_errors)?body.previous_errors:[],
    error_type:String(body.error_type||"")
  };
  await db.meta.put({key,value:JSON.stringify(record)});
  if(isToday) await db.meta.delete(`today-plan-snapshot:${today}`);
}

function suggest(theme=""){
  return repairRules.filter(([trigger])=>theme.includes(trigger)||trigger.includes(theme))
    .flatMap(([trigger,a,s])=>[...a,...s].map(problem_id=>({trigger,problem_id})));
}

async function appendImportHistory(kind:string,version:string,count:number){
  const key="master_import_history",old=await db.meta.get(key);
  let rows:string[]=[];try{rows=old?JSON.parse(old.value):[]}catch{rows=[]}
  rows.unshift(`${new Date().toISOString()}｜${kind}｜${version}｜${count}件`);
  await db.meta.put({key,value:JSON.stringify(rows.slice(0,20))});
}
async function addImportLog(file_kind:MasterImportLog["file_kind"],version:string,problem_count=0,answer_count=0,alias_count=0){
  await db.importLogs.add({id:undefined,imported_at:new Date().toISOString(),file_kind,version,problem_count,answer_count,alias_count});
}

async function importProblemMaster(raw:unknown){
  const payload=parseProblemMasterPayload(raw),now=new Date().toISOString();
  for(const incoming of payload.problems){
    const old=await db.problems.get(String(incoming.problem_id));
    const category=incoming.category as Problem["category"];
    const problem:Problem={
      ...(old||{}),...incoming,id:old?.id||Date.now()+Math.floor(Math.random()*100000),
      problem_id:String(incoming.problem_id),source_type:category==="past_exam"?"past_exam":"whitebook",
      category,chapter:incoming.chapter??null,problem_number:Number(incoming.problem_number),
      title:String(incoming.canonical_title||incoming.display_label||incoming.title),
      theme:String(incoming.theme),priority:String(incoming.priority||old?.priority||"semi_core"),
      role:String(incoming.role||old?.role||(category==="S"?"foundation":category==="A"?"training":"exam")),
      recommended_mode:String(incoming.recommended_mode||old?.recommended_mode||(category==="S"?"skeleton":category==="A"?"full":"scan")),
      linked_past_exams:String(incoming.linked_past_exams||""),linked_s_problems:String(incoming.linked_s_problems||""),
      linked_a_problems:String(incoming.linked_a_problems||""),notes:String(incoming.notes||old?.notes||""),
      completion_status:old?.completion_status||"active",display_label:String(incoming.display_label),
      normalized_label:String(incoming.display_label).replace(/\s/g,""),master_version:payload.version
    };
    await db.problems.put(problem);
    if(category==="S"&&!await db.sMemory.get(problem.problem_id)) await db.sMemory.put({problem_id:problem.problem_id,state:"check",k_trigger_count:0});
  }
  await db.meta.bulkPut([{key:"problem_master_version",value:payload.version},{key:"problem_master_updated_at",value:now}]);
  await appendImportHistory("problem_master",payload.version,payload.problems.length);
  await addImportLog("problem_master",payload.version,payload.problems.length,0,0);
  await repairDataIntegrity(true);
  return {count:payload.problems.length,version:payload.version};
}

async function importAnswerIndex(raw:unknown){
  const payload=parseAnswerIndexPayload(raw),now=new Date().toISOString();
  await db.answerIndex.bulkPut(payload.answers.map(answer=>({...answer,imported_at:now,index_version:payload.version})));
  for(const answer of payload.answers){
    const problem=await db.problems.get(answer.problem_id);
    if(problem) await db.problems.update(answer.problem_id,{answer_available:answer.answer_available});
  }
  await db.meta.bulkPut([{key:"answer_index_version",value:payload.version},{key:"answer_index_updated_at",value:now}]);
  await appendImportHistory("answer_index",payload.version,payload.answers.length);
  await addImportLog("answer_index",payload.version,0,payload.answers.length,0);
  return {count:payload.answers.length,version:payload.version};
}

async function importAliases(raw:unknown){
  const payload=parseAliasesPayload(raw),now=new Date().toISOString();
  await db.problemAliases.bulkPut(payload.aliases.map(alias=>({...alias,imported_at:now,alias_version:payload.version})));
  await db.meta.bulkPut([{key:"problem_alias_version",value:payload.version},{key:"problem_alias_updated_at",value:now}]);
  await appendImportHistory("aliases",payload.version,payload.aliases.length);
  await addImportLog("aliases",payload.version,0,0,payload.aliases.length);
  return {count:payload.aliases.length,version:payload.version};
}

async function importIntegratedMaster(raw:unknown){
  const payload=parseIntegratedMasterPayload(raw);
  let problem_count=0,answer_count=0,alias_count=0;
  if(payload.problemMaster){
    const result=await importProblemMaster(payload.problemMaster);
    problem_count=result.count;
  }
  if(payload.answerIndex){
    const result=await importAnswerIndex(payload.answerIndex);
    answer_count=result.count;
  }
  if(payload.aliases){
    const result=await importAliases(payload.aliases);
    alias_count=result.count;
  }
  await addImportLog("integrated",payload.version,problem_count,answer_count,alias_count);
  await appendImportHistory("統合JSON",payload.version,problem_count+answer_count+alias_count);
  await repairDataIntegrity(true);
  return {version:payload.version,problem_count,answer_count,alias_count,diagnostics:await diagnoseData()};
}

async function diagnoseData():Promise<DataDiagnostic[]>{
  const [problems,attempts,reviews,notes,answers,aliases]=await Promise.all([
    db.problems.toArray(),db.attempts.toArray(),db.reviews.toArray(),db.weakNotes.toArray(),db.answerIndex.toArray(),db.problemAliases.toArray()
  ]);
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem])),amap=new Map(answers.map(answer=>[answer.problem_id,answer]));
  const diagnostics:DataDiagnostic[]=[];
  for(const attempt of attempts){
    const problem=pmap.get(attempt.problem_id);
    if(!problem) diagnostics.push({id:`attempt-${attempt.id}`,severity:"critical",problem_id:attempt.problem_id,record_type:"attempt",message:"問題IDが problem_master に存在しません。",repairable:false});
    else if(!attemptMatchesProblem(attempt,problem)) diagnostics.push({id:`attempt-content-${attempt.id}`,severity:"critical",problem_id:attempt.problem_id,record_type:"attempt",message:"採点内容がこの問題の canonical_keywords と強く矛盾します。元のGPT出力を保持したまま問題IDを確認してください。",suggested_problem_id:attempt.problem_id==="WB-6-S-04"?"WB-6-S-01":undefined,repairable:false});
  }
  for(const review of reviews){
    const problem=pmap.get(review.problem_id),source=attempts.find(attempt=>attempt.id===review.generated_from_attempt_id);
    if(review.status==="ignored") continue;
    if(!problem) diagnostics.push({id:`review-${review.id}`,severity:"critical",problem_id:review.problem_id,record_type:"review",message:"復習の問題IDが problem_master に存在しません。",repairable:false});
    if(review.task_origin==="review_attempt"&&!attempts.some(attempt=>attempt.problem_id===review.problem_id))
      diagnostics.push({id:`review-origin-${review.id}`,severity:"warning",problem_id:review.problem_id,record_type:"review",message:"履歴がないのに review_attempt になっています。",repairable:true});
    if(review.review_type==="s_check"){
      const sourceId=review.source_problem_id||source?.problem_id||"",sourceProblem=pmap.get(sourceId);
      const validLinks=[...new Set([...(sourceProblem?.related_s_problem_ids||[]),...list(sourceProblem?.linked_s_problems||"")])];
      const integrity=relatedSIntegrity(sourceId,review.problem_id,validLinks);
      if(integrity.state==="self_reference") diagnostics.push({
        id:`self-link-${review.id}`,severity:"critical",problem_id:review.problem_id,record_type:"linked_s_check",
        review_id:review.id,source_problem_id:sourceId,target_problem_id:review.problem_id,
        current_related_ids:[review.problem_id],canonical_related_ids:validLinks,
        message:`${sourceId} から同じ問題への自己参照です。`,repairable:true,recommended_action:"remove"
      });
      else if(sourceProblem&&integrity.state==="id_review_needed") diagnostics.push({
        id:`invalid-link-${review.id}`,severity:"critical",problem_id:review.problem_id,record_type:"linked_s_check",
        review_id:review.id,source_problem_id:sourceId,target_problem_id:review.problem_id,
        current_related_ids:[review.problem_id],canonical_related_ids:validLinks,
        message:`${sourceId} からの関連S指定が problem_master と矛盾しています。`,
        repairable:false,recommended_action:"hold"
      });
    }
  }
  for(const note of notes){
    const master=pmap.get(note.problem_id);
    if(master&&note.theme&&note.theme!==master.theme) diagnostics.push({id:`note-${note.id}`,severity:"warning",problem_id:note.problem_id,record_type:"weak_note",message:"弱点テーマが problem_master と異なります。",repairable:true});
  }
  for(const problem of problems){
    const answer=amap.get(problem.problem_id);
    if(problem.answer_available&&!answer) diagnostics.push({id:`answer-${problem.problem_id}`,severity:"warning",problem_id:problem.problem_id,record_type:"answer_index",message:"answer_available ですが answer_index がありません。",repairable:false});
  }
  for(const alias of aliases) if(!pmap.has(alias.problem_id)) diagnostics.push({
    id:`alias-${alias.alias}`,severity:"warning",problem_id:alias.problem_id,record_type:"alias",
    message:`エイリアス「${alias.alias}」の参照先が problem_master にありません。`,repairable:false
  });
  const s4=pmap.get("WB-6-S-04");
  if(s4&&/AIC|自由度|指数型分布族/.test(s4.theme)) diagnostics.push({id:"s4-theme",severity:"critical",problem_id:s4.problem_id,record_type:"problem",message:"WB-6-S-04 のテーマが正本と矛盾しています。",suggested_problem_id:"WB-6-S-01",repairable:true});
  return diagnostics;
}

async function repairDataIntegrity(silent=false){
  const [problems,attempts,reviews,notes]=await Promise.all([db.problems.toArray(),db.attempts.toArray(),db.reviews.toArray(),db.weakNotes.toArray()]);
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  let selfReferencesRemoved=0;
  for(const problem of problems){
    const related=[...new Set([...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)])];
    if(related.includes(problem.problem_id)){
      const cleaned=related.filter(problemId=>problemId!==problem.problem_id);
      await db.problems.update(problem.problem_id,{related_s_problem_ids:cleaned,linked_s_problems:cleaned.join(";")});
      problem.related_s_problem_ids=cleaned;problem.linked_s_problems=cleaned.join(";");
      selfReferencesRemoved++;
    }
  }
  for(const note of notes){
    const problem=pmap.get(note.problem_id);
    if(problem&&note.theme!==problem.theme) await db.weakNotes.update(note.id,{theme:problem.theme});
  }
  for(const review of reviews){
    const ownAttempts=attempts.filter(attempt=>attempt.problem_id===review.problem_id);
    const source=attempts.find(attempt=>attempt.id===review.generated_from_attempt_id);
    if(review.review_type==="s_check"){
      const sourceId=review.source_problem_id||source?.problem_id||"",sourceProblem=pmap.get(sourceId);
      const validLinks=[...new Set([...(sourceProblem?.related_s_problem_ids||[]),...list(sourceProblem?.linked_s_problems||"")])];
      const integrity=relatedSIntegrity(sourceId,review.problem_id,validLinks);
      if(integrity.state==="self_reference"&&review.status!=="done"){
        if(sourceProblem){
          const withoutSelf=validLinks.filter(problemId=>problemId!==review.problem_id);
          await db.problems.update(sourceProblem.problem_id,{related_s_problem_ids:withoutSelf,linked_s_problems:withoutSelf.join(";")});
        }
        await db.reviews.delete(review.id);selfReferencesRemoved++;continue;
      }
      const invalid=!!sourceProblem&&integrity.state==="id_review_needed";
      await db.reviews.update(review.id,{status:review.status==="ignored"?"ignored":invalid&&review.status!=="done"?"id_review_needed":review.status==="id_review_needed"?"pending":review.status,
        task_origin:"linked_s_check",source_problem_id:sourceId,
        attempt_exists:ownAttempts.length>0,review_goal_public:"元問題で崩れた基礎型を確認する"});
    }else await db.reviews.update(review.id,{task_origin:ownAttempts.length?"review_attempt":"first_attempt",attempt_exists:ownAttempts.length>0});
  }
  if(selfReferencesRemoved) await appendImportHistory("自己参照のため削除","integrity-repair",selfReferencesRemoved);
  if(!silent) await appendImportHistory("整合性修復","manual",reviews.length+notes.length);
  const diagnostics=await diagnoseData();
  return {diagnostics,self_references_removed:selfReferencesRemoved,remaining_review_needed:diagnostics.filter(item=>item.recommended_action==="hold").length};
}

async function resolveDiagnostic(body:Record<string,unknown>){
  const reviewId=Number(body.review_id),action=String(body.action||"hold");
  const review=await db.reviews.get(reviewId);
  if(!review||review.review_type!=="s_check") throw new Error("対象の関連S確認が見つかりません");
  const sourceId=review.source_problem_id||(await db.attempts.get(review.generated_from_attempt_id))?.problem_id||"";
  const source=sourceId?await db.problems.get(sourceId):undefined;
  if(action==="remove"||action==="recommended"){
    if(source){
      const related=[...new Set([...(source.related_s_problem_ids||[]),...list(source.linked_s_problems)])].filter(problemId=>problemId!==review.problem_id);
      await db.problems.update(source.problem_id,{related_s_problem_ids:related,linked_s_problems:related.join(";")});
    }
    await db.reviews.delete(reviewId);
    await appendImportHistory("関連S指定を削除",`${sourceId}→${review.problem_id}`,1);
  }else if(action==="add_to_master"){
    if(!source) throw new Error("元問題が problem_master にありません");
    if(source.problem_id===review.problem_id) throw new Error("自己参照は problem_master に追加できません");
    const related=[...new Set([...(source.related_s_problem_ids||[]),...list(source.linked_s_problems),review.problem_id])];
    await db.problems.update(source.problem_id,{related_s_problem_ids:related,linked_s_problems:related.join(";")});
    await db.reviews.update(reviewId,{status:"pending",source_problem_id:sourceId});
    await appendImportHistory("problem_master に関連Sを追加",`${sourceId}→${review.problem_id}`,1);
  }else if(action==="ignore"){
    await db.reviews.update(reviewId,{status:"ignored"});
    await appendImportHistory("関連S矛盾を無視",`${sourceId}→${review.problem_id}`,1);
  }else{
    await db.reviews.update(reviewId,{status:"id_review_needed",source_problem_id:sourceId});
    await appendImportHistory("ID要確認に保留",`${sourceId}→${review.problem_id}`,1);
  }
  return {diagnostics:await diagnoseData()};
}

export async function problemMasterExport(){
  await initialize();
  const meta=await db.meta.get("problem_master_version");
  const problems=await db.problems.toArray();
  return {version:meta?.value||"unversioned",problems:problems.map(problem=>({
    problem_id:problem.problem_id,display_label:problem.display_label,type:problem.category,chapter:problem.chapter==null?null:`第${problem.chapter}章`,
    problem_number:problem.problem_number,theme:problem.theme,canonical_title:problem.canonical_title||problem.title,
    canonical_problem_type:problem.canonical_problem_type||problem.theme,canonical_keywords:problem.canonical_keywords||[],
    roadmap_rank:problem.roadmap_rank||problem.strategy_rank,source_book:problem.source_book||"",
    related_s_problems:problem.related_s_problem_ids||list(problem.linked_s_problems),
    related_a_problems:problem.related_a_problem_ids||list(problem.linked_a_problems),
    related_past_exams:problem.related_past_exam_ids||list(problem.linked_past_exams),
    answer_available:!!problem.answer_available
  }))};
}
export async function answerIndexExport(){
  await initialize();
  const meta=await db.meta.get("answer_index_version");
  return {version:meta?.value||"unversioned",answers:await db.answerIndex.toArray()};
}
export async function saveAnswerPdf(file:File){
  await initialize();
  await db.answerPdfs.put({file_name:file.name,blob:file,uploaded_at:new Date().toISOString()});
}
export async function openAnswerPdf(fileName:string,page?:number|null){
  const popup=window.open("about:blank","_blank");
  const row=await db.answerPdfs.get(fileName);
  if(!row){popup?.close();throw new Error("PDF本体はこのiPadに登録されていません")}
  const url=URL.createObjectURL(row.blob),target=page?`${url}#page=${page}`:url;
  if(popup) popup.location.href=target; else window.open(target,"_blank");
  setTimeout(()=>URL.revokeObjectURL(url),120000);
}
export async function answerPdfObjectUrl(fileName:string,page?:number|null){
  await initialize();
  const row=await db.answerPdfs.get(fileName);
  if(!row) throw new Error("PDF本体はこのiPadに登録されていません");
  const url=URL.createObjectURL(row.blob);
  return {url,pageUrl:page?`${url}#page=${page}`:url,revoke:()=>URL.revokeObjectURL(url)};
}

async function bootstrap():Promise<Bootstrap>{
  await initialize();
  await ensureBuiltInCanonical();
  const [problems,attempts,rawReviews,roadmap,weakNotes,pastSessions,sMemory,metaEntries,answerIndex,answerPdfs,problemAliases]=await Promise.all([
    db.problems.toArray(),db.attempts.orderBy("id").reverse().toArray(),db.reviews.orderBy("due_date").toArray(),db.roadmap.orderBy("order_index").toArray(),
    db.weakNotes.orderBy("id").reverse().toArray(),db.pastSessions.orderBy("id").reverse().toArray(),db.sMemory.toArray(),db.meta.toArray(),
    db.answerIndex.toArray(),db.answerPdfs.toArray(),db.problemAliases.toArray()
  ]);
  const today=todayString(),week=addDays(today,-6),fortnight=addDays(today,-13);
  const pmap=new Map(problems.map(p=>[p.problem_id,p]));
  const answerMap=new Map(answerIndex.map(answer=>[answer.problem_id,answer]));
  const pdfNames=new Set(answerPdfs.map(pdf=>pdf.file_name));
  const smap=new Map(sMemory.map(memory=>[memory.problem_id,memory]));
  const attemptMap=new Map(attempts.map(attempt=>[attempt.id,attempt]));
  const settings={
    exam_date:metaEntries.find(entry=>entry.key==="exam_date")?.value||"",
    daily_study_minutes:Math.max(30,Number(metaEntries.find(entry=>entry.key==="daily_study_minutes")?.value||150))
  };
  const reviews=rawReviews.map(review=>{
    const status=["pending","overdue"].includes(review.status)&&review.due_date<today?"overdue":review.status;
    if(review.review_method) return {...review,status};
    const problem=pmap.get(review.problem_id);
    const source=attemptMap.get(review.generated_from_attempt_id);
    const linked=problem?[...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)]:[];
    const legacyPlan=review.review_type==="s_check"
      ?createSReviewPlan((smap.get(review.problem_id)?.state||"check") as SState)
      :source?createAttemptReviewPlan(source,linked,0):null;
    return legacyPlan?{...review,status,duration_minutes:legacyPlan.estimated_minutes,reason:legacyPlan.review_reason,...planFields(legacyPlan)}:{...review,status};
  }).sort((a,b)=>a.due_date.localeCompare(b.due_date)||Number(a.manual_order||0)-Number(b.manual_order||0)||a.id-b.id);
  const a14=new Set(attempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="A").map(a=>a.problem_id)).size;
  const skeleton=attempts.filter(a=>a.date>=fortnight&&a.mode==="skeleton");
  const skeletonGood=skeleton.filter(a=>["◎","○"].includes(a.mark)).length;
  const kGroups=new Map<string,number>();
  attempts.filter(a=>a.date>=fortnight&&a.error_type==="K").forEach(a=>kGroups.set(a.problem_id,(kGroups.get(a.problem_id)||0)+1));
  const kRepeat=[...kGroups.values()].filter(n=>n>1).length;
  const pastSkeleton=attempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="past_exam").length;
  const delayed3=reviews.filter(r=>r.status==="overdue"&&r.due_date<addDays(today,-3)).length;
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
    pending:reviews.filter(r=>["pending","overdue"].includes(r.status)).length,overdue:reviews.filter(r=>r.status==="overdue").length,
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
  const dueReviews=reviews.filter(r=>["pending","overdue"].includes(r.status)&&r.due_date<=today).map(r=>{
    const p=pmap.get(r.problem_id)!;const originSource=attempts.find(a=>a.id===r.generated_from_attempt_id);
    const ownSource=attempts.find(attempt=>attempt.problem_id===r.problem_id&&p&&attemptMatchesProblem(attempt,p));
    const linkedS=r.task_origin==="linked_s_check"||r.review_type==="s_check";
    const source=linkedS?ownSource:originSource,answer=answerMap.get(r.problem_id);
    const defaultMinutes=r.estimated_minutes||r.duration_minutes||20;
    const minutes=source?.is_review_attempt&&source.time_minutes>0?Math.max(3,Math.round((defaultMinutes+source.time_minutes)/2)):defaultMinutes;
    const reviewMode=r.requires_full_answer?"exam_90min":r.review_type==="main_calc_retry"?"main_calc":
      ["careless_check","light_check"].includes(r.review_type)||(/軽い骨格確認|軽い想起チェック|月1回の軽い/.test(r.review_method||""))||
      r.review_type==="s_check"&&(/3分|5分チェック|5分骨格確認/.test(r.review_method||""))?"check":"skeleton";
    return {...r,task_origin:linkedS?"linked_s_check":r.task_origin||(source?"review_attempt":"first_attempt"),
      source_problem_id:linkedS?(r.source_problem_id||originSource?.problem_id):r.source_problem_id,
      attempt_exists:!!source,review_goal_public:linkedS?"元問題で崩れた基礎型を確認する":r.review_goal_public,
      source_error_summary:linkedS?originSource?.error_point:"",
      title:p?.display_label||p?.title||(r.generated_from_past_session_id?`${r.problem_id.replace("-SESSION","")} 過去問演習`:r.problem_id),theme:p?.theme||"",error_type:source?.error_type,
      previous_date:source?.date,previous_score:source?`${source.score_text||source.score_label}${source.score_numeric!=null?` ${source.score_numeric}点`:""}`:"",
      previous_errors:source?.error_types||[source?.error_type||"none"],previous_error_point:source?.error_point||"",previous_next_action:source?.next_action||"",
      previous_improvement_guidance:source?.improvement_guidance||"",previous_required_derivation:source?.required_derivation||"",
      previous_corrected_answer:source?.corrected_answer||"",
      has_saved_gpt_feedback:!!(source?.improvement_guidance||source?.required_derivation||source?.corrected_answer||source?.result_summary),
      official_answer_text:answer?.answer_available&&answer.answer_excerpt?answer.answer_excerpt:p?.official_answer||"",
      official_answer_url:p?.official_answer_url||"",official_answer_pdf_name:answer?.pdf_file_name||"",
      official_answer_pdf_registered:!!answer?.pdf_file_name&&pdfNames.has(answer.pdf_file_name),
      answer_section_label:answer?.section_label||"",official_answer_page:answer?.page_start??null,
      canonical_problem_type:p?.canonical_problem_type||p?.theme||"",
      canonical_keywords:[...(p?.canonical_keywords||[]),...(answer?.canonical_keywords||[])],
      answer_excerpt:answer?.answer_excerpt||"",
      kind:r.review_type==="s_check"?"S確認":r.generated_from_past_session_id?"過去問復習":"復習",reason:r.status==="overdue"?`期限切れ（${r.due_date}）`:"本日が復習日",
      mode:reviewMode,minutes,estimated_minutes:minutes,load:loadFor(reviewMode)};
  }).sort((a,b)=>(a.status==="overdue"&&a.error_type==="K"?0:1)-(b.status==="overdue"&&b.error_type==="K"?0:1)||
    Number(a.manual_order||0)-Number(b.manual_order||0));
  const activeS=new Set(reviews.filter(r=>r.review_type==="s_check"&&["pending","overdue","deferred"].includes(r.status)).map(r=>r.problem_id));
  const staleS=sMemory.filter(s=>!activeS.has(s.problem_id)&&(s.state==="forgotten"||s.state==="collapsed"||!!s.last_touched&&s.last_touched<=addDays(today,-30))).map(s=>{
    const p=pmap.get(s.problem_id)!,answer=answerMap.get(s.problem_id),sPlan=createSReviewPlan(s.state);return {problem_id:s.problem_id,title:p.display_label||p.title,theme:p.theme,
      canonical_problem_type:p.canonical_problem_type||p.theme,canonical_keywords:[...(p.canonical_keywords||[]),...(answer?.canonical_keywords||[])],
      answer_excerpt:answer?.answer_excerpt||"",kind:"S点検",reason:s.state==="forgotten"||s.state==="collapsed"?"忘却状態から復旧":"30日以上未確認",mode:sPlan.mode,minutes:sPlan.estimated_minutes||5,load:s.state==="collapsed"?.4:.2,...planFields(sPlan)};
  });
  let load=[...dueReviews,...staleS].reduce((sum,x)=>sum+x.load,0);
  let plannedMinutes=[...dueReviews,...staleS].reduce((sum,x)=>sum+x.minutes,0);
  const seen=new Set(attempts.map(a=>a.problem_id));
  const occupied=new Set([
    ...reviews.filter(review=>["pending","overdue","deferred"].includes(review.status)).map(review=>review.problem_id),
    ...dueReviews.map(task=>task.problem_id),...staleS.map(task=>task.problem_id)
  ]);
  const strategySTasks:any[]=[];
  const sLimit=progress.phase==="foundation"?4:progress.phase==="integration"?3:2;
  for(const problemId of STRATEGY_S_ORDER){
    if(strategySTasks.length>=sLimit||plannedMinutes>=settings.daily_study_minutes*.55) break;
    const problem=pmap.get(problemId);
    const latest=attempts.find(attempt=>attempt.problem_id===problemId);
    if(!problem||occupied.has(problemId)||(latest&&latest.date>addDays(today,-21))) continue;
    const minutes=problemId==="WB-6-S-21"||problemId==="WB-6-S-22"?15:10;
    const answer=answerMap.get(problemId);
    strategySTasks.push({problem_id:problemId,title:problem.display_label||problem.title,theme:problem.theme,
      canonical_problem_type:problem.canonical_problem_type||problem.theme,canonical_keywords:[...(problem.canonical_keywords||[]),...(answer?.canonical_keywords||[])],
      answer_excerpt:answer?.answer_excerpt||"",
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
    const answer=answerMap.get(r.problem_id);
    newTasks.push({...r,title:problem.display_label||problem.title,theme:problem.theme,
      canonical_problem_type:problem.canonical_problem_type||problem.theme,canonical_keywords:[...(problem.canonical_keywords||[]),...(answer?.canonical_keywords||[])],
      answer_excerpt:answer?.answer_excerpt||"",kind:"A+演習",
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
      const answer=answerMap.get(problemId);
      pastTasks.push({problem_id:problemId,title:problem.display_label||problem.title,theme:problem.theme,
        canonical_problem_type:problem.canonical_problem_type||problem.theme,canonical_keywords:[...(problem.canonical_keywords||[]),...(answer?.canonical_keywords||[])],
        answer_excerpt:answer?.answer_excerpt||"",
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
  const mixedAnswer=mixedProblem?answerMap.get(mixedProblem.problem_id):undefined;
  const mixedTasks=mixedProblem&&plannedMinutes+mixedMinutes<=settings.daily_study_minutes+15?[{problem_id:mixedProblem.problem_id,title:mixedProblem.display_label||mixedProblem.title,
    theme:mixedProblem.theme,canonical_problem_type:mixedProblem.canonical_problem_type||mixedProblem.theme,
    canonical_keywords:[...(mixedProblem.canonical_keywords||[]),...(mixedAnswer?.canonical_keywords||[])],
    answer_excerpt:mixedAnswer?.answer_excerpt||"",kind:"混合確認",reason:"既習テーマから型を見分ける混合演習",mode:"skeleton",minutes:12,load:.5}]:[];
  if(mixedTasks.length){load+=.5;plannedMinutes+=mixedMinutes}
  const checkedKeys=new Set(metaEntries.filter(entry=>entry.key.startsWith(`today-check:${today}:`)&&entry.value==="1").map(entry=>entry.key));
  const regularReviews=dueReviews.filter(review=>!review.manual_order);
  const movedBackReviews=dueReviews.filter(review=>!!review.manual_order);
  const rawBaseTasks=[...regularReviews,...staleS,...strategySTasks,...newTasks,...pastTasks,...simulationTasks,...mixedTasks,...movedBackReviews].map(task=>({
    ...task,checked:checkedKeys.has(`today-check:${today}:${task.problem_id}:${task.kind}`)
  })) as Task[];
  const taskPostponements=new Map<string,Record<string,unknown>>();
  for(const entry of metaEntries.filter(entry=>entry.key.startsWith("task-postpone:"))){
    try{taskPostponements.set(entry.key.slice("task-postpone:".length),JSON.parse(entry.value))}catch{/* ignore invalid legacy value */}
  }
  const baseTasks=rawBaseTasks.filter(task=>{
    if(task.id&&task.review_type) return true;
    const record=taskPostponements.get(`${task.problem_id}:${task.kind}`);
    if(!record) return true;
    const destination=String(record.postponed_to||"");
    return destination!=="unscheduled"&&destination<=today;
  }).map(task=>{
    if(task.id&&task.review_type) return task;
    const record=taskPostponements.get(`${task.problem_id}:${task.kind}`);
    if(!record) return task;
    return {...task,triage_override:record.triage_override==="must"?"must" as const:undefined,
      postponed_at:String(record.postponed_at||""),postponed_to:String(record.postponed_to||""),
      postpone_reason:String(record.postpone_reason||""),postpone_count:Number(record.postpone_count||0)};
  });
  const generatedTriage=triageTodayTasks(baseTasks,settings.daily_study_minutes,problems,today);
  const snapshotKey=`today-plan-snapshot:${today}`;
  let snapshot:TodayPlanSnapshot|null=null;
  const storedSnapshot=metaEntries.find(entry=>entry.key===snapshotKey)?.value;
  if(storedSnapshot) try{snapshot=JSON.parse(storedSnapshot) as TodayPlanSnapshot}catch{snapshot=null}
  if(!snapshot){
    const snapshotTasks=generatedTriage.tasks.map(task=>({...task,checked:false}));
    snapshot={
      date:today,task_ids:snapshotTasks.map(taskSnapshotId),
      start_of_day_planned_minutes:snapshotTasks.reduce((sum,task)=>sum+task.minutes,0),
      initial_bucket:Object.fromEntries(snapshotTasks.map(task=>[taskSnapshotId(task),task.triage||"tomorrow"])),
      initial_estimated_minutes:Object.fromEntries(snapshotTasks.map(task=>[taskSnapshotId(task),task.minutes])),
      tasks:snapshotTasks,created_at:new Date().toISOString()
    };
    await db.meta.put({key:snapshotKey,value:JSON.stringify(snapshot)});
  }
  const generatedMap=new Map(generatedTriage.tasks.map(task=>[taskSnapshotId(task),task]));
  const reviewMap=new Map(reviews.map(review=>[review.id,review]));
  const todayAttemptProblems=new Set(attempts.filter(attempt=>attempt.date===today).map(attempt=>attempt.problem_id));
  const tasks=snapshot.tasks.filter(saved=>{
    if(saved.id&&saved.review_type){
      const review=reviewMap.get(saved.id);
      return !!review&&["pending","overdue"].includes(review.status)&&review.due_date<=today;
    }
    const record=taskPostponements.get(`${saved.problem_id}:${saved.kind}`);
    if(!record) return true;
    const destination=String(record.postponed_to||"");
    return destination!=="unscheduled"&&destination<=today;
  }).map(saved=>{
    const key=taskSnapshotId(saved),current=generatedMap.get(key),review=saved.id?reviewMap.get(saved.id):undefined;
    const record=!saved.id?taskPostponements.get(`${saved.problem_id}:${saved.kind}`):undefined;
    const forcedMust=review?.triage_override==="must"||record?.triage_override==="must";
    return {...saved,...current,
      title:pmap.get(saved.problem_id)?.display_label||pmap.get(saved.problem_id)?.title||saved.title,
      theme:pmap.get(saved.problem_id)?.theme||saved.theme,
      canonical_problem_type:pmap.get(saved.problem_id)?.canonical_problem_type||saved.canonical_problem_type,
      canonical_keywords:[...(pmap.get(saved.problem_id)?.canonical_keywords||[]),...(answerMap.get(saved.problem_id)?.canonical_keywords||saved.canonical_keywords||[])],
      answer_excerpt:answerMap.get(saved.problem_id)?.answer_excerpt||saved.answer_excerpt,
      minutes:Number(snapshot!.initial_estimated_minutes[key]??saved.minutes),
      triage:forcedMust?"must":snapshot!.initial_bucket[key]||saved.triage||"tomorrow",
      checked:checkedKeys.has(`today-check:${today}:${saved.problem_id}:${saved.kind}`)||todayAttemptProblems.has(saved.problem_id)
    } as Task;
  });
  const totalLoad=Math.round(tasks.filter(task=>!task.checked&&task.triage!=="tomorrow").reduce((sum,x)=>sum+x.load,0)*10)/10;
  const actualMinutes=attempts.filter(attempt=>attempt.date===today).reduce((sum,attempt)=>sum+Math.max(0,Number(attempt.time_minutes||0)),0);
  const timeSummary=summarizeTodayTime(tasks,actualMinutes,settings.daily_study_minutes,snapshot.start_of_day_planned_minutes);
  const activeRemainingMinutes=timeSummary.activeRemainingMinutes;
  const postponeCandidateMinutes=timeSummary.postponeCandidateMinutes;
  const remainingMinutes=activeRemainingMinutes;
  const postponedReviewMinutes=reviews.filter(review=>review.postponed_at?.startsWith(today)&&review.postponed_to!==today)
    .reduce((sum,review)=>sum+Number(review.estimated_minutes||review.duration_minutes||0),0);
  const postponedTaskMinutes=[...taskPostponements.values()].filter(record=>String(record.postponed_at||"").startsWith(today)&&String(record.postponed_to||"")!==today)
    .reduce((sum,record)=>sum+Number(record.estimated_minutes||0),0);
  const postponedMinutes=postponedReviewMinutes+postponedTaskMinutes;
  const completedTasks=attempts.filter(attempt=>attempt.date===today).map(attempt=>({
    problem_id:attempt.problem_id,title:pmap.get(attempt.problem_id)?.display_label||attempt.problem_id,
    kind:"完了",reason:`${attempt.mark} ${attempt.score_text||attempt.score_label}`,mode:attempt.mode,
    minutes:Number(attempt.time_minutes||0),load:loadFor(attempt.mode),checked:true
  } as Task));
  const plannedTotal=snapshot.start_of_day_planned_minutes;
  const activeTotalIfDone=timeSummary.activeTotalIfDone;
  const capacityPercent=timeSummary.capacityPercent;
  const warning=timeSummary.warning,guidance=timeSummary.guidance;
  const diagnostics=await diagnoseData();
  let importHistory:string[]=[];try{importHistory=JSON.parse(metaEntries.find(entry=>entry.key==="master_import_history")?.value||"[]")}catch{importHistory=[]}
  const masterStatus={
    problem_count:problems.length,answer_count:answerIndex.length,
    problem_version:metaEntries.find(entry=>entry.key==="problem_master_version")?.value||"未設定",
    answer_version:metaEntries.find(entry=>entry.key==="answer_index_version")?.value||"未設定",
    problem_updated_at:metaEntries.find(entry=>entry.key==="problem_master_updated_at")?.value||"",
    answer_updated_at:metaEntries.find(entry=>entry.key==="answer_index_updated_at")?.value||"",
    alias_updated_at:metaEntries.find(entry=>entry.key==="problem_alias_updated_at")?.value||"",
    alias_version:metaEntries.find(entry=>entry.key==="problem_alias_version")?.value||"未設定",
    alias_count:problemAliases.length,
    pdf_files:[...pdfNames],diagnostics,import_history:importHistory
  };
  return {problems:problems.sort((a,b)=>(a.chapter||99)-(b.chapter||99)||a.category.localeCompare(b.category)||a.problem_number-b.problem_number),attempts,reviews,roadmap,weakNotes,pastSessions,answerIndex,problemAliases,dashboard,settings,masterStatus,
    today:{tasks,totalLoad,plannedMinutes:plannedTotal,remainingMinutes,actualMinutes,targetMinutes:settings.daily_study_minutes,capacityPercent,warning,guidance,
      planned_minutes_total:plannedTotal,completed_minutes_today:actualMinutes,remaining_minutes_today:remainingMinutes,
      postponed_minutes_today:postponedMinutes,target_minutes_today:settings.daily_study_minutes,
      start_of_day_planned_minutes:snapshot.start_of_day_planned_minutes,active_remaining_minutes:activeRemainingMinutes,
      postpone_candidate_minutes:postponeCandidateMinutes,active_total_if_done:activeTotalIfDone,
      triageMinutes:{
        must:tasks.filter(task=>task.triage==="must"&&!task.checked).reduce((sum,task)=>sum+task.minutes,0),
        if_time:tasks.filter(task=>task.triage==="if_time"&&!task.checked).reduce((sum,task)=>sum+task.minutes,0),
        tomorrow:postponeCandidateMinutes
      },triageCounts:{must:tasks.filter(t=>t.triage==="must"&&!t.checked).length,
        if_time:tasks.filter(t=>t.triage==="if_time"&&!t.checked).length,tomorrow:tasks.filter(t=>t.triage==="tomorrow"&&!t.checked).length,
        completed:completedTasks.length},completedTasks}} as Bootstrap;
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
  if(path==="/api/master/integrated/import"){
    return await importIntegratedMaster(body) as T;
  } else if(path==="/api/master/problem/import"){
    return await importProblemMaster(body) as T;
  } else if(path==="/api/master/answer/import"){
    return await importAnswerIndex(body) as T;
  } else if(path==="/api/master/aliases/import"){
    return await importAliases(body) as T;
  } else if(path==="/api/master/repair"){
    return await repairDataIntegrity() as T;
  } else if(path==="/api/master/diagnostic/resolve"){
    return await resolveDiagnostic(body) as T;
  } else if(path==="/api/today/recalculate"){
    await db.meta.delete(`today-plan-snapshot:${todayString()}`);
    await appendImportHistory("今日の予定を再計算","manual",1);
    return {ok:true} as T;
  } else if(path==="/api/problems"){
    const chapter=body.chapter?Number(body.chapter):null,number=Number(body.problem_number),difficulty=body.difficulty?Number(body.difficulty):null;
    const display=body.source_type==="past_exam"?body.title:labelFor(chapter,body.category,number,difficulty);
    await db.problems.add({...body,id:Date.now(),chapter,problem_number:number,difficulty,completion_status:"active",
      display_label:display,roadmap_label:display,normalized_label:display.replace(/\s/g,""),
      related_s_problem_ids:list(body.linked_s_problems),linked_past_exam_ids:list(body.linked_past_exams)});
    if(body.category==="S") await db.sMemory.put({problem_id:body.problem_id,state:"stable",k_trigger_count:0});
  } else if(path==="/api/attempts") {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta,db.answerIndex,db.correctionLogs],()=>saveAttempt(body));
  } else if(path==="/api/import") {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta,db.answerIndex,db.correctionLogs],async()=>{for(const update of body.updates) await saveAttempt(update)});
  } else if(/^\/api\/attempts\/\d+\/update$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],
      ()=>updateAttemptAnalysis(Number(path.split("/")[3]),body));
  } else if(/^\/api\/attempts\/\d+\/delete$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],
      ()=>deleteAttemptAnalysis(Number(path.split("/")[3])));
  } else if(/^\/api\/reviews\/\d+\/complete$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta],
      ()=>completeReview(Number(path.split("/")[3]),body));
  } else if(/^\/api\/reviews\/\d+\/postpone$/.test(path)) {
    await db.transaction("rw",[db.reviews,db.meta],()=>postponeReview(Number(path.split("/")[3]),body));
  } else if(path==="/api/tasks/postpone") {
    await db.transaction("rw",[db.meta],()=>postponeTask(body));
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
        duration_minutes:plan.estimated_minutes,reason:plan.review_reason,task_origin:"past_exam_followup",
        attempt_exists:false,...planFields(plan)
      });
    });
  } else throw new Error(`未対応の保存です: ${path}`);
  return {ok:true} as T;
}

export async function exportBackup(){
  await initialize();
  return {
    version:2,exported_at:new Date().toISOString(),
    problems:await db.problems.toArray(),attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),
    roadmap:await db.roadmap.toArray(),weakNotes:await db.weakNotes.toArray(),pastSessions:await db.pastSessions.toArray(),
    sMemory:await db.sMemory.toArray(),answerIndex:await db.answerIndex.toArray(),correctionLogs:await db.correctionLogs.toArray(),
    problemAliases:await db.problemAliases.toArray(),importLogs:await db.importLogs.toArray()
  };
}

export async function restoreBackup(data:any){
  const required=["problems","attempts","reviews","roadmap","weakNotes","pastSessions","sMemory"];
  if(!data||!required.every(k=>Array.isArray(data[k]))) throw new Error("バックアップ形式が正しくありません");
  await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.roadmap,db.weakNotes,db.pastSessions,db.sMemory,db.meta,db.answerIndex,db.correctionLogs,db.problemAliases,db.importLogs],async()=>{
    await Promise.all([db.problems.clear(),db.attempts.clear(),db.reviews.clear(),db.roadmap.clear(),db.weakNotes.clear(),db.pastSessions.clear(),db.sMemory.clear(),db.answerIndex.clear(),db.correctionLogs.clear(),db.problemAliases.clear(),db.importLogs.clear()]);
    await db.problems.bulkAdd(data.problems);await db.attempts.bulkAdd(data.attempts);await db.reviews.bulkAdd(data.reviews);
    await db.roadmap.bulkAdd(data.roadmap);await db.weakNotes.bulkAdd(data.weakNotes);await db.pastSessions.bulkAdd(data.pastSessions);
    await db.sMemory.bulkAdd(data.sMemory);
    if(Array.isArray(data.answerIndex)) await db.answerIndex.bulkAdd(data.answerIndex);
    if(Array.isArray(data.correctionLogs)) await db.correctionLogs.bulkAdd(data.correctionLogs);
    if(Array.isArray(data.problemAliases)) await db.problemAliases.bulkAdd(data.problemAliases);
    if(Array.isArray(data.importLogs)) await db.importLogs.bulkAdd(data.importLogs);
    await db.meta.put({key:"seeded",value:"1"});
  });
}

export async function csvFor(table:"attempts"|"problems"){
  const rows=table==="attempts"?await db.attempts.toArray():await db.problems.toArray();
  if(!rows.length) return "";
  const keys=Object.keys(rows[0]);
  return "\ufeff"+[keys.join(","),...rows.map(row=>keys.map(k=>`"${String((row as any)[k]??"").replaceAll('"','""')}"`).join(","))].join("\n");
}
