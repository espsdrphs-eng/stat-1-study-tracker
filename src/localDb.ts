import Dexie, { type EntityTable } from "dexie";
import type { AnswerIndexEntry, Attempt, Bootstrap, CorrectionLog, DataDiagnostic, GradingContractSnapshot, MasterImportLog, PastExamExposure, PastSession, Problem, ProblemAlias, ProblemRelation, Review, Roadmap, StudyUpdate, Task, TodayPlanSnapshot, WeakNote } from "./types";
import { japaneseizeMathText } from "./mathJapanese.ts";
import { analyzeWeaknesses } from "./weaknessAnalytics.ts";
import { createAdaptiveReviewPlan, createAttemptReviewPlan, createSReviewPlan, enforceReviewEvidence, normalizedErrors, type ReviewOutcome, type ReviewPlan, type SState } from "./reviewRules.ts";
import { postponedDueDate } from "./reviewScheduling.ts";
import { applyWeakNoteQuizResult } from "./weakNoteQuiz.ts";
import { selectMixedPractice } from "./studyScheduler.ts";
import { triageTodayTasks } from "./studyTriage.ts";
import { summarizeTodayTime } from "./todayPlan.ts";
import { removeTimingExpressions, sanitizeStudyUpdateTiming } from "./reviewTiming.ts";
import { buildProgressPlan, daysUntilExam } from "./studyProgress.ts";
import { calculateExamReadinessMetrics } from "./examReadiness.ts";
import { correctedDueDate, resolveReviewCard } from "./reviewCardResolver.ts";
import { CHAPTER_META, officialProblemEntries, STRATEGY_A_PLUS_ORDER, STRATEGY_S_ORDER, strategyRankFor } from "./officialMaster.ts";
import { REVIEW_RUBRIC_VERSION } from "./gradingPrompt.ts";
import { allowedReferenceLevel, referenceDecision, type ReferenceLevel } from "./reviewExperience.ts";
import { applyCanonicalMaster, parseAliasesPayload, parseAnswerIndexPayload, parseIntegratedMasterPayload, parseProblemMasterPayload, relatedSIntegrity } from "./masterData.ts";
import { finalizeStudyUpdateForSave } from "./studyCycle.ts";
import { LEARNING_POLICY_VERSION, resolveLearningPolicy } from "./learningPolicyResolver.ts";
import { quotaCandidatesWithinCapacity, taskDraftFromPrescription, weeklySoftQuota } from "./taskScheduler.ts";
import { examScoreEligibility, taskScoreForAttempt } from "./scoreEligibility.ts";
import { resolveLearningEvaluation, resolveReviewTransition } from "./reviewTransition.ts";
import { analyzeLegacyKReorganization } from "./legacyKRepair.ts";
import { classifyKPolicyValidity, excludeLegacyKFromPlanning, planningErrorsForSource } from "./legacyKPolicy.ts";
import { analyzeSourceMismatchRepair, resolveReviewOrigin, REVIEW_ORIGIN_POLICY_VERSION } from "./reviewOrigin.ts";
import { normalizePastExamSession, parseScan5Update, sessionStudyMinutes, validatePastExamSession } from "./pastExamWorkflow.ts";
import { auditLegacyReviewContracts, buildGradingContractSnapshot, computeContractHash, contractDifferences, prescriptionFromContract, repairTargets, taskFieldsFromContract } from "./gradingContract.ts";
import { primaryErrorFromFindings, validateGradedFindings } from "./gradedParts.ts";
import {
  addCalendarDays, auditReviewSchedules, differenceInCalendarDays, pendingReviewIdentityKey, resolveReviewSchedule,
  type ReviewScheduleAudit
} from "./reviewSchedulePolicy.ts";
import {
  APP_SCHEMA_VERSION, createSchemaDiagnostic, DB_NAME, DB_VERSION,
  GPT_SAVE_REQUIRED_STORES, IndexedDbSchemaError, LATEST_STORE_SCHEMAS, REQUIRED_APP_STORES, STORES
} from "./dbSchema.ts";
import {
  ACTIVE_REVIEW_STATUSES, bindContractToReview, classifyExactDuplicateAttempts, logicalReviewKey,
  reviewExecutionMessage, reviewExecutionState, runIntegrityAudit, type IntegrityAudit
} from "./integrityEngine.ts";
import { notifyStudyDataChanged } from "./appEvents.ts";
import {
  buildPastExamCatalog, buildReferencePackStatus, canonicalPastExamProblemId, orderCorePastExamYears,
  enrichReconciledLinks, EXAM_REFERENCE_EXPOSURE_META_KEY, EXAM_REFERENCE_PACK_META_KEY,
  reconcileExamReferencePack, referenceProblemToLiveProblem, validateReferencePackData,
  type ReferencePackValidation, type StoredExamReferencePack
} from "./examReferencePack.ts";
import { analyzeConceptWeaknesses, buildPastExamRepairCandidates } from "./conceptWeakness.ts";
import { buildAdaptivePlannerShadow } from "./adaptivePlanner.ts";
import { ADAPTIVE_PLANNER_VERSION, adaptivePlanDayToTasks } from "./adaptiveTodayPlan.ts";
import { buildAdditionalStudyCandidates } from "./additionalStudy.ts";
import { summarizeReviewPortfolio } from "./reviewPortfolio.ts";
import { BUILT_IN_EXAM_REFERENCE_PACK, builtInReferencePackValidation } from "./builtinExamReferencePack.ts";
import { analyzeReviewReconciliation, reconciliationForProblem, type ReconciliationAudit } from "./reviewReconciliation.ts";

const PLANNER_RUNTIME_MODE_META_KEY="planner-runtime-mode";

type SMemory = { problem_id:string; state:"stable"|"check"|"forgotten"|"collapsed"; last_touched?:string; k_trigger_count:number };
type StoredAttempt = Attempt;
type StoredReview = Review;
type StoredWeakNote = WeakNote;
type StoredPastSession = PastSession;
const LEGACY_V9_PAST_EXAM_YEAR_ORDER=[2024,2025,2022,2023] as const;
type StoredAnswerPdf={
  file_name:string;blob:Blob;uploaded_at:string;document_key?:string;kind?:string;source_book?:string;
  original_file_name?:string;display_name?:string;page_count?:number;sha256?:string;registered_at?:string;
};

export const ANSWER_PDF_DOCUMENTS = [{
  document_key:"mathstat_answers_2025_03_07",
  kind:"answer",
  source_book:"MathStat",
  display_name:"白本・模範解答PDF",
  expected_file_name:"MathStat_Answers.pdf",
  expected_page_count:151,
  expected_sha256:"ca5b9503d01070e898602af2d7b9d0735ab4afdfea02655b90fa80858ea5fd1c"
}] as const;

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
    super(DB_NAME);
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
      for(const year of LEGACY_V9_PAST_EXAM_YEAR_ORDER){
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
    this.version(12).stores({
      problems:"&problem_id,category,chapter,priority,completion_status,normalized_label",
      attempts:"++id,problem_id,date,error_type,mark,primary_error_type,[problem_id+date]",
      reviews:"++id,problem_id,due_date,status,review_type,task_origin,source_problem_id",
      roadmap:"&order_index,problem_id,is_active",
      weakNotes:"++id,problem_id,date,error_type,is_resolved,auto_generated,last_quizzed_at",
      pastSessions:"++id,year,date,session_type,selection_result",
      sMemory:"&problem_id,state,last_touched",meta:"&key",
      answerIndex:"&problem_id,answer_available,pdf_file_name,document_key",
      correctionLogs:"++id,corrected_at,raw_gpt_problem_id,corrected_problem_id",
      answerPdfs:"&file_name,document_key,uploaded_at,registered_at",problemAliases:"&alias,problem_id",
      importLogs:"++id,imported_at,file_kind"
    }).upgrade(async tx=>{
      await tx.table("answerPdfs").toCollection().modify((pdf:StoredAnswerPdf)=>{
        pdf.original_file_name=pdf.original_file_name||pdf.file_name;
        pdf.registered_at=pdf.registered_at||pdf.uploaded_at;
      });
    });
    this.version(DB_VERSION).stores(LATEST_STORE_SCHEMAS).upgrade(async tx=>{
      const now=new Date().toISOString();
      const attempts=await tx.table(STORES.attempts).count();
      const reviews=await tx.table(STORES.reviews).count();
      await tx.table(STORES.meta).bulkPut([
        {key:"db_schema_version",value:String(DB_VERSION)},
        {key:"app_schema_version",value:APP_SCHEMA_VERSION},
        {key:"last_migration",value:`v12→v${DB_VERSION}`},
        {key:"last_migration_result",value:`成功：既存Attempt ${attempts}件、既存Review ${reviews}件を保持`},
        {key:"last_migration_at",value:now}
      ]);
    });
  }
}

export const db = new StudyDatabase();
export const closeLocalDatabase=()=>db.close();

const schemaEvent=(name:string,detail:unknown)=>{
  if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent(name,{detail}));
};
db.on("blocked",()=>schemaEvent("stat1-db-blocked",{
  title:"データベース更新が保留されています",
  message:"このアプリを開いている他のSafariタブやホーム画面アプリを閉じてください。"
}));
db.on("versionchange",()=>{
  db.close();
  schemaEvent("stat1-db-versionchange",{
    title:"アプリが更新されました",
    message:"安全に再読み込みしてデータベース更新を完了してください。"
  });
});

const currentStoreNames=()=>{
  try{return Array.from(db.backendDB().objectStoreNames)}catch{return db.tables.map(table=>table.name)}
};

export async function databaseSchemaStatus(requestedStores:string[]=REQUIRED_APP_STORES,operation="databaseDiagnostic"){
  if(!db.isOpen()) await db.open();
  const existingStores=currentStoreNames();
  const meta=await db.meta.bulkGet(["last_migration","last_migration_result","last_migration_at"]);
  const diagnostic=createSchemaDiagnostic({databaseName:db.name,databaseVersion:db.verno,requestedStores,existingStores,operation,
    migrationVersion:meta[0]?.value||`v${DB_VERSION}`});
  return {
    ...diagnostic,
    valid:diagnostic.missingStores.length===0,
    extraStores:existingStores.filter(store=>!REQUIRED_APP_STORES.includes(store as typeof REQUIRED_APP_STORES[number])),
    lastMigration:meta[0]?.value||"未実行",
    migrationResult:meta[1]?.value||"未記録",
    migratedAt:meta[2]?.value||"",
    counts:{attempts:await db.attempts.count(),evaluations:await db.attempts.count(),reviewPlans:await db.reviews.count()}
  };
}

async function assertDatabaseSchema(operation:string,requiredStores:string[]){
  const status=await databaseSchemaStatus(requiredStores,operation);
  if(!status.valid) throw new IndexedDbSchemaError(status);
  return status;
}

export async function repairDatabaseSchema(){
  db.close();
  await db.open();
  const status=await databaseSchemaStatus(REQUIRED_APP_STORES,"repairDatabaseSchema");
  if(!status.valid) throw new IndexedDbSchemaError(status);
  await db.meta.bulkPut([
    {key:"last_migration",value:`v${DB_VERSION} schema verification`},
    {key:"last_migration_result",value:"成功：不足storeなし。既存データを保持"},
    {key:"last_migration_at",value:new Date().toISOString()}
  ]);
  return databaseSchemaStatus();
}

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
const addDays=addCalendarDays;
async function reviewDueDate(date:string,days:number){
  return addCalendarDays(date,days);
}
const list=(value="")=>String(value).split(/[;,、\s]+/).map(x=>x.trim()).filter(Boolean);
const attemptMatchesProblem=(attempt:Attempt,problem:Problem)=>{
  const text=[attempt.result_summary,attempt.error_point,attempt.next_action,attempt.improvement_guidance,attempt.required_derivation,attempt.corrected_answer].join(" ");
  if(problem.problem_id==="WB-6-S-04"&&/AIC|自由度|指数型分布族|自然母数|期待値母数/.test(text)&&!/U\(0|一様分布|最大統計量|不偏推定量|MSE/.test(text)) return false;
  if(problem.problem_id==="WB-6-S-01"&&/U\(0|一様分布|最大統計量|MSE/.test(text)&&!/指数型分布族|自然母数|期待値母数/.test(text)) return false;
  return true;
};

const normalizeProblemId=(value:string)=>{
  const raw=String(value||"").toUpperCase().replace(/[‐‑‒–—ー−]/g,"-").trim();
  const white=raw.match(/^WB-(\d+)-([AS])-(\d+)$/);
  if(white) return `WB-${Number(white[1])}-${white[2]}-${String(Number(white[3])).padStart(2,"0")}`;
  const past=raw.match(/^PY-(\d{4})-Q(\d+)$/);
  return past?`PY-${past[1]}-Q${Number(past[2])}`:raw;
};
const resolveCanonicalProblemId=(problemId:string,aliases:ProblemAlias[])=>{
  let currentId=normalizeProblemId(problemId);
  const visited=new Set<string>();
  while(currentId&&!visited.has(currentId)){
    visited.add(currentId);
    const alias=aliases.find(item=>{
      const row=item as ProblemAlias&{raw_problem_id?:string;corrected_problem_id?:string;canonical_problem_id?:string};
      return normalizeProblemId(row.raw_problem_id||item.alias)===currentId;
    }) as (ProblemAlias&{raw_problem_id?:string;corrected_problem_id?:string;canonical_problem_id?:string})|undefined;
    const next=alias?.corrected_problem_id||alias?.canonical_problem_id||alias?.problem_id;
    if(!next)break;
    const normalizedNext=normalizeProblemId(next);
    if(normalizedNext===currentId)break;
    currentId=normalizedNext;
  }
  return currentId||problemId;
};
const expectedProblemMeta=(problemId:string)=>{
  const id=normalizeProblemId(problemId),white=id.match(/^WB-(\d+)-([AS])-(\d{2})$/),past=id.match(/^PY-(\d{4})-Q(\d+)$/);
  if(white){
    const chapter=Number(white[1]),category=white[2] as "S"|"A",problem_number=Number(white[3]);
    return {category,chapter,problem_number,display_label:`第${chapter}章${category}問${problem_number}`};
  }
  if(past) return {category:"past_exam" as const,chapter:null,problem_number:Number(past[2]),display_label:`${past[1]}年問${Number(past[2])}`};
  return null;
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
  const [problem,attempts,aliases,examMeta]=await Promise.all([
    db.problems.get(review.problem_id),db.attempts.toArray(),db.problemAliases.toArray(),db.meta.get("exam_date")
  ]);
  if(!problem){
    return Number(await db.reviews.add({id:undefined as unknown as number,...review,status:"review_needed",review_needed_reason:"problem_masterに対象問題がありません"}));
  }
  const card=resolveReviewCard({item:review,problems:[problem],attempts,aliases,today:todayString(),examDate:examMeta?.value||""});
  const contractFields=taskFieldsFromContract(card.gradingContract);
  const sourceAttempt=attempts.find(attempt=>attempt.id===Number(review.source_attempt_id||review.generated_from_attempt_id||0));
  const sourceDate=String(review.source_date||sourceAttempt?.date||"");
  const reviewAfterDays=Number.isFinite(Number(review.review_after_days??review.interval_days))
    ?Number(review.review_after_days??review.interval_days):undefined;
  const scheduleOrigin=review.schedule_origin||"policy";
  const policyDueDate=scheduleOrigin==="policy"&&sourceDate&&reviewAfterDays!=null
    ?addCalendarDays(sourceDate,reviewAfterDays):review.due_date;
  const candidate={...review,id:0,problem_id:card.canonicalProblemId,...contractFields} as Review;
  const activeReviews=(await db.reviews.toArray()).filter(item=>ACTIVE_REVIEW_STATUSES.has(item.status));
  const logicalKey=logicalReviewKey({review:candidate,aliases,sourceAttempt});
  const exactLogical=activeReviews.find(item=>{
    const existingSource=attempts.find(attempt=>attempt.id===Number(item.source_attempt_id||item.generated_from_attempt_id||0));
    return (item.logical_review_key||logicalReviewKey({review:item,aliases,sourceAttempt:existingSource}))===logicalKey;
  });
  if(exactLogical)return exactLogical.id;
  const identityKey=pendingReviewIdentityKey(candidate,aliases);
  if(identityKey){
    const sameIdentity=activeReviews.filter(item=>pendingReviewIdentityKey(item,aliases)===identityKey);
    if(sameIdentity.length){
      const newestExisting=[...sameIdentity].sort((a,b)=>{
        const sourceA=attempts.find(attempt=>attempt.id===Number(a.source_attempt_id||a.generated_from_attempt_id||0));
        const sourceB=attempts.find(attempt=>attempt.id===Number(b.source_attempt_id||b.generated_from_attempt_id||0));
        return String(sourceB?.date||"").localeCompare(String(sourceA?.date||""))||
          Number(sourceB?.id||0)-Number(sourceA?.id||0)||b.id-a.id;
      })[0];
      const existingSource=attempts.find(attempt=>attempt.id===Number(newestExisting.source_attempt_id||newestExisting.generated_from_attempt_id||0));
      const candidateIsNewer=String(sourceAttempt?.date||"").localeCompare(String(existingSource?.date||""))>0||
        (sourceAttempt?.date===existingSource?.date&&Number(sourceAttempt?.id||0)>Number(existingSource?.id||0));
      if(!candidateIsNewer)return newestExisting.id;
      for(const item of sameIdentity)await db.reviews.update(item.id,{
        status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
        superseded_by_policy_version:review.policy_version||LEARNING_POLICY_VERSION,
        superseded_reason:"同一目的・採点対象の新しいsource Attemptから独立したReviewを生成"
      });
    }
  }
  const provenance={
    reviewGoal:card.reviewGoal,correctionTheme:card.correctionTheme,entryHint:card.entryHint,
    oneLineHint:card.oneLineHint,todayActions:card.todayActions,completionConditions:card.completionConditions
  };
  const insertedId=Number(await db.reviews.add({
    id:undefined as unknown as number,...review,problem_id:card.canonicalProblemId,
    due_date:policyDueDate,source_date:sourceDate||undefined,review_after_days:reviewAfterDays,
    schedule_origin:scheduleOrigin,
    inferred_mode:card.inferredMode,mode_override:card.modeOverride,sheet_name:card.sheetLabel,
    derived_from_problem_id:card.canonicalProblemId,derived_from_attempt_id:card.targetAttempt?.id,
    derived_from_master_version:problem.master_version||"unversioned",derived_generated_at:new Date().toISOString(),
    derived_stale:false,derived_fields:provenance,
    status:card.reviewNeeded?"review_needed":review.status,
    review_needed_reason:card.reviewNeeded?card.consistencyWarnings.map(item=>item.message).join(" "):undefined,
    logical_review_key:logicalKey,contract_revision:1,
    // Contract fields are applied last so legacy mode/scope fields cannot overwrite the immutable contract.
    ...contractFields
  }));
  const persistedContract=bindContractToReview(card.gradingContract,insertedId,1);
  await db.reviews.update(insertedId,{
    ...taskFieldsFromContract(persistedContract),
    logical_review_key:logicalKey,contract_revision:1,
  });
  return insertedId;
}

type ReconcileApplySummary={
  audit:ReconciliationAudit;reviewsSuperseded:number;reviewsReplaced:number;todayActionsUpdated:number;
  ambiguousProblems:number;details:Array<{problemId:string;reviewIds:number[];sourceAttemptId?:number;reason:string}>;
};

function contractWithReconciledParts(args:{
  problem:Problem;source:Attempt;parts:NonNullable<GradingContractSnapshot["gradedParts"]>;
  findings:NonNullable<Attempt["graded_findings"]>;createdAt:string;
}){
  const errors=[...new Set(args.findings.map(row=>row.error_type).filter(value=>value!=="none"))];
  const source={...args.source,error_types:errors.length?errors:["N"],effective_error_types:errors.length?errors:["N"],
    error_type:errors[0]||"N",primary_error_type:errors[0]||"N",targeted_parts:args.parts.map(row=>row.label)};
  const prescription=resolveLearningPolicy({problemId:args.problem.problem_id,problem:args.problem,source,
    learningPurpose:"error_repair",learningStage:"repair",
    assessmentTiming:source.date===todayString()?"same_session_correction":"delayed_retrieval",
    targetedParts:args.parts.map(row=>row.label)});
  const draft:Partial<Review>={problem_id:args.problem.problem_id,source_attempt_id:source.id,
    generated_from_attempt_id:source.id,learning_purpose:"error_repair",learning_stage:"repair",
    assessment_timing:prescription.assessmentTiming,review_scope:prescription.reviewScope,
    effective_mode:prescription.mode==="exam_90min"?"full":prescription.mode,
    sheet_type:prescription.sheetType,target_kind:prescription.targetKind,
    targeted_parts:args.parts.map(row=>row.label),estimated_minutes:prescription.estimatedMinutes,
    allowed_reference_level:prescription.allowedReferenceLevel,generated_at:args.createdAt};
  const base=buildGradingContractSnapshot({review:draft,problem:args.problem,sourceAttempt:source,createdAt:args.createdAt}).contract;
  const completionCriteria=[{id:"reproduce_current_unresolved_parts",
    displayText:`指定された${args.parts.length}点を、参照なしで、対象・記号・式の向きを整合させて再現できた`}];
  const allowedErrorTypes=[...new Set(args.parts.flatMap(part=>part.allowedErrorTypes).filter(value=>value!=="none"))];
  const withoutIdentity={...base,sourceAttemptId:source.id,sourceReviewId:undefined,reviewId:undefined,
    learningPurpose:"error_repair" as const,learningStage:"repair" as const,
    targetedParts:args.parts.map(row=>row.label),gradedParts:args.parts,
    completionCriteria,completionConditions:completionCriteria.map(row=>row.displayText),
    requiredEvidence:args.parts.map(row=>row.label),allowedErrorTypes,
    requiresKEvidence:allowedErrorTypes.includes("K"),createdAt:args.createdAt};
  const {contractId:_oldId,contractHash:_oldHash,createdAt:_createdAt,...hashPayload}=withoutIdentity;
  const contractHash=computeContractHash(hashPayload);
  const contract:GradingContractSnapshot={...withoutIdentity,contractHash,
    contractId:`review:pending:${contractHash.slice(3)}`};
  return {contract,prescription};
}

async function currentReconciliationAudit(todayPlanSnapshots:TodayPlanSnapshot[]=[]){
  const [attempts,reviews,aliases]=await Promise.all([
    db.attempts.toArray(),db.reviews.toArray(),db.problemAliases.toArray()
  ]);
  return analyzeReviewReconciliation({attempts,reviews,aliases,today:todayString(),todayPlanSnapshots});
}

async function staleEvidenceReason(review:Review){
  const audit=await currentReconciliationAudit();
  const problem=reconciliationForProblem(audit,review.problem_id,await db.problemAliases.toArray());
  return problem?.reviewsToSupersede.find(row=>row.reviewId===review.id)?.reason;
}

/**
 * Rebuilds only the active learning state. Attempt/Review history and stored Today Plan
 * snapshots remain immutable; the latter is hydrated against the current Review at read time.
 */
async function reconcileProblemLearningState(problemId?:string,preview=false):Promise<ReconcileApplySummary>{
  const snapshots=await currentTodaySnapshots();
  const [attempts,reviews,aliases,problems]=await Promise.all([
    db.attempts.toArray(),db.reviews.toArray(),db.problemAliases.toArray(),db.problems.toArray()
  ]);
  const audit=analyzeReviewReconciliation({attempts,reviews,aliases,today:todayString(),todayPlanSnapshots:snapshots});
  const plans=problemId?[reconciliationForProblem(audit,problemId,aliases)].filter(Boolean):audit.problems;
  const details=plans.flatMap(plan=>plan?.reviewsToSupersede.length||plan?.replacementRequired||plan?.retentionCheckRequired?[{
    problemId:plan!.problemId,reviewIds:plan!.reviewsToSupersede.map(row=>row.reviewId),
    sourceAttemptId:plan!.desiredSourceAttemptId,
    reason:[...new Set(plan!.reviewsToSupersede.map(row=>row.reason))].join(" / ")||"現在の未解決targetからReviewを生成",
  }]:[]);
  const summary:ReconcileApplySummary={audit,reviewsSuperseded:plans.reduce((sum,plan)=>sum+(plan?.reviewsToSupersede.length||0),0),
    reviewsReplaced:plans.filter(plan=>plan?.replacementRequired||plan?.retentionCheckRequired).length,
    todayActionsUpdated:audit.staleTodayActions,ambiguousProblems:audit.ambiguousProblems,details};
  if(preview)return summary;
  const reviewMap=new Map(reviews.map(row=>[row.id,row]));
  const problemMap=new Map(problems.map(row=>[resolveCanonicalProblemId(row.problem_id,aliases),row]));
  const attemptMap=new Map(attempts.map(row=>[row.id,row]));
  const now=new Date().toISOString();
  for(const plan of plans){
    if(!plan||plan.ambiguousReasons.length)continue;
    for(const action of plan.reviewsToSupersede){
      const old=reviewMap.get(action.reviewId);
      if(!old||!ACTIVE_REVIEW_STATUSES.has(old.status))continue;
      await db.reviews.update(old.id,{status:"superseded",exclude_from_planning:true,
        exclude_from_recurrence_metrics:true,superseded_by_policy_version:LEARNING_POLICY_VERSION,
        superseded_reason:`学習状態reconcile: ${action.reason}`});
    }
    if(plan.retentionCheckRequired&&plan.retentionSourceAttemptId){
      const source=attemptMap.get(plan.retentionSourceAttemptId),problem=problemMap.get(plan.problemId);
      if(source&&problem){
        const prescription=resolveLearningPolicy({problemId:problem.problem_id,problem,
          source:{...source,error_types:["none"],effective_error_types:[],learning_purpose:"retrieval_check",
            assessment_timing:"delayed_retrieval"},learningPurpose:"retrieval_check",
          learningStage:"maintenance",assessmentTiming:"delayed_retrieval"});
        const draft=taskDraftFromPrescription({prescription,sourceAttemptId:source.id,sourceDate:source.date,errors:[]});
        const interval=Math.max(0,differenceInCalendarDays(draft.dueDate,source.date)||0);
        const planFieldsValue=createAttemptReviewPlan({...source,error_types:["none"],error_type:"none"},[],0);
        const inserted=await addOrReplaceReview({...planFields(planFieldsValue),problem_id:problem.problem_id,due_date:draft.dueDate,
          review_type:"light_check",status:"pending",generated_from_attempt_id:source.id,source_attempt_id:source.id,
          source_date:source.date,review_after_days:interval,interval_days:interval,schedule_origin:"policy",
          duration_minutes:prescription.estimatedMinutes,estimated_minutes:prescription.estimatedMinutes,
          reason:"局所補修成功後の遅延保持確認",review_reason:"局所補修成功後の遅延保持確認",
          task_origin:"review_attempt",attempt_exists:true,origin:source.parent_past_session_id?"past_exam_attempt":"direct_attempt",
          target_problem_id:problem.problem_id,parent_past_session_id:source.parent_past_session_id,generated_at:now,
          learning_purpose:"retrieval_check",learning_stage:"maintenance",assessment_timing:"delayed_retrieval",
          review_scope:prescription.reviewScope,effective_mode:"check",sheet_type:"check_sheet",
          targeted_parts:prescription.targetedParts,scope_completion_conditions:prescription.completionConditions,
          required_evidence:prescription.requiredEvidence,allowed_reference_level:prescription.allowedReferenceLevel,
          policy_version:prescription.policyVersion,retention_eligible:true,success_transition:"stable",failure_transition:"error_repair",
          deduplication_key:draft.deduplicationKey,earliest_date:draft.window.earliestDate,
          preferred_date:draft.window.preferredDate,latest_date:draft.window.latestDate});
        for(const id of plan.reviewsToSupersede.map(row=>row.reviewId))await db.reviews.update(id,{replaced_by_review_id:inserted});
      }
      continue;
    }
    if(!plan.replacementRequired||!plan.desiredSourceAttemptId||!plan.desiredRepairParts.length)continue;
    const problem=problemMap.get(plan.problemId),source=attemptMap.get(plan.desiredSourceAttemptId);
    if(!problem||!source)continue;
    const {contract,prescription}=contractWithReconciledParts({problem,source,parts:plan.desiredRepairParts,
      findings:plan.desiredRepairFindings,createdAt:now});
    const oldRows=plan.activeRepairReviewIds.map(id=>reviewMap.get(id)).filter(Boolean) as Review[];
    const oldDue=oldRows.map(row=>row.due_date).filter(Boolean).sort()[0];
    const dueDate=oldDue&&oldDue>todayString()?oldDue:todayString();
    const interval=Math.max(0,differenceInCalendarDays(dueDate,source.date)||0);
    const inserted=await addOrReplaceReview({problem_id:problem.problem_id,due_date:dueDate,
      review_type:prescription.reviewScope,status:"pending",generated_from_attempt_id:source.id,
      source_attempt_id:source.id,source_date:source.date,review_after_days:interval,interval_days:interval,
      schedule_origin:"policy",duration_minutes:contract.estimatedMinutes,estimated_minutes:contract.estimatedMinutes,
      reason:"最新の有効な答案証拠から、現在未解決の採点対象だけを再構成",
      review_reason:"最新の有効な答案証拠から、現在未解決の採点対象だけを再構成",
      task_origin:"review_attempt",attempt_exists:true,origin:source.parent_past_session_id?"past_exam_attempt":"direct_attempt",
      target_problem_id:problem.problem_id,parent_past_session_id:source.parent_past_session_id,
      generated_at:now,learning_purpose:"error_repair",learning_stage:"repair",
      assessment_timing:source.date===todayString()?"same_session_correction":"delayed_retrieval",
      review_scope:contract.reviewScope,effective_review_scope:contract.reviewScope,
      effective_mode:contract.mode,sheet_type:contract.sheetType,target_kind:contract.targetKind,
      targeted_parts:contract.targetedParts,graded_parts:contract.gradedParts.map(part=>part.label),
      graded_part_ids:contract.gradedParts.map(part=>part.id),graded_findings:plan.desiredRepairFindings,
      scope_completion_conditions:contract.completionConditions,required_evidence:contract.requiredEvidence,
      allowed_reference_level:contract.allowedReferenceLevel,policy_version:LEARNING_POLICY_VERSION,
      retention_eligible:false,success_transition:"retrieval_check",failure_transition:"error_repair",
      deduplication_key:`reconcile:${problem.problem_id}:${source.id}:${contract.gradedParts.map(part=>part.id).sort().join(",")}:${LEARNING_POLICY_VERSION}`,
      grading_contract:contract,contract_id:contract.contractId,contract_version:contract.contractVersion,
      contract_hash:contract.contractHash});
    for(const id of plan.reviewsToSupersede.map(row=>row.reviewId))await db.reviews.update(id,{replaced_by_review_id:inserted});
  }
  return summary;
}

type PendingCorrectionLog=Omit<CorrectionLog,"id">;
async function saveAttempt(input:StudyUpdate&Record<string,unknown>,pendingCorrectionLogs:PendingCorrectionLog[]=[]){
  input={...input,...sanitizeStudyUpdateTiming(input)};
  const submissionId=String(input.submission_id||"").trim()||`submission-${crypto.randomUUID()}`;
  const alreadySaved=(await db.attempts.toArray()).find(attempt=>attempt.submission_id===submissionId);
  if(alreadySaved)return alreadySaved.id;
  const problem=await db.problems.get(input.problem_id);
  if(!problem) throw new Error(`未登録の問題IDです: ${input.problem_id}`);
  if(input.requires_problem_confirmation) throw new Error("問題ID候補を確認してから保存してください");
  const answer=await db.answerIndex.get(problem.problem_id);
  input=finalizeStudyUpdateForSave(applyCanonicalMaster(input,problem,answer,await db.problems.toArray(),await db.answerIndex.toArray())) as StudyUpdate&Record<string,unknown>;
  if(input.requires_problem_confirmation) throw new Error(`取り込み内容は ${input.suggested_problem_id||"別の問題"} の可能性があります。問題IDを確認してください`);
  const sourceReview=input.generated_from_review_id?await db.reviews.get(input.generated_from_review_id):undefined;
  if(input.generated_from_review_id&&!sourceReview)
    throw new Error(reviewExecutionMessage("missing"));
  if(sourceReview){
    const sourceState=reviewExecutionState(sourceReview,todayString());
    if(sourceState!=="actionable")throw new Error(reviewExecutionMessage(sourceState,sourceReview));
  }
  if(sourceReview?.grading_contract){
    const supplied={
      contractId:String(input.contract_id||""),contractVersion:String(input.contract_version||""),
      contractHash:String(input.contract_hash||""),problemId:String(input.problem_id||""),
      learningPurpose:input.learning_purpose,mode:input.mode as "check"|"skeleton"|"main_calc"|"full"|"scan5",reviewScope:input.review_scope,
      targetKind:input.target_kind,gradedParts:input.graded_part_ids||input.graded_parts||[],
    };
    const differences=contractDifferences(sourceReview.grading_contract,supplied);
    if(differences.length){
      const detail=differences.map(row=>`${String(row.field)}: 画面=${JSON.stringify(row.expected)} / GPT=${JSON.stringify(row.actual)}`).join("\n");
      throw new Error(`画面に表示した課題とGPT採点範囲が一致しません。\n${detail}`);
    }
    let findings=input.graded_findings||[];
    if(!findings.length){
      const errors=(input.error_types||[]).filter(Boolean);
      if(errors.length===0||errors.every(error=>error==="none")){
        findings=sourceReview.grading_contract.gradedParts.map(part=>({
          graded_part_id:part.id,error_type:"none" as const,evidence:"大きな問題なし",resolved:true
        }));
      }else if(sourceReview.grading_contract.gradedParts.length===1){
        findings=[{
          graded_part_id:sourceReview.grading_contract.gradedParts[0].id,
          error_type:(input.primary_error_type||errors[0]) as "K"|"W"|"N"|"C"|"none",
          evidence:String(input.error_point||input.result_summary||""),resolved:false
        }];
      }else{
        throw new Error("採点項目が複数あるため、graded_findingsを含む現行プロンプトで再採点してください。");
      }
    }
    const findingErrors=validateGradedFindings(sourceReview.grading_contract.gradedParts,findings);
    if(findingErrors.length){
      const detail=findingErrors.map(row=>`${row.gradedPartId}: ${row.reason}（GPT=${row.errorType}）`).join("\n");
      throw new Error(`画面に表示した課題とGPT採点範囲が一致しません。\n${detail}`);
    }
    const primary=primaryErrorFromFindings(findings);
    const errors=[...new Set(findings.filter(finding=>!finding.resolved).map(finding=>finding.error_type))];
    input={...input,graded_findings:findings,graded_part_ids:sourceReview.grading_contract.gradedParts.map(part=>part.id),
      primary_error_type:primary,error_type:primary,error_types:errors.length?errors:["none"]};
  }
  if(sourceReview){
    const staleReason=await staleEvidenceReason(sourceReview);
    if(staleReason)throw new Error(`この復習課題は最新答案により終了または更新されています。${staleReason}`);
  }
  if(input.generated_from_review_id&&[REVIEW_RUBRIC_VERSION,"STAT1-REVIEW-v8","STAT1-REVIEW-v7","STAT1-REVIEW-v6","STAT1-REVIEW-v5","STAT1-REVIEW-v4"].includes(input.rubric_version||"")){
    const source=sourceReview?await db.attempts.get(sourceReview.generated_from_attempt_id):undefined;
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
  const kPolicyValidity=classifyKPolicyValidity(input);
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
  const assessmentTiming=input.assessment_timing||(input.generated_from_review_id?"delayed_retrieval":"independent_performance");
  const scoreCandidate:Partial<Attempt>={
    mode:String(input.mode||problem.recommended_mode),score_numeric:input.score_numeric??null,
    time_minutes:actualMinutes,actual_reference_level:actualReferenceLevel,
    evaluation_scope:String(input.evaluation_scope||""),assessment_timing:assessmentTiming,
    time_limit_minutes:Number(input.time_limit_minutes||0)||undefined,
    conclusion_reached:input.conclusion_reached,incomplete_reason:input.incomplete_reason,
  };
  const examEligibility=examScoreEligibility(scoreCandidate,problem);
  const effectiveErrors=(input.effective_error_types?.length?input.effective_error_types:errors)
    .filter(error=>["K","W","N","C"].includes(String(error)));
  const sourceAttemptForTransition=sourceReview?await db.attempts.get(sourceReview.generated_from_attempt_id):undefined;
  const sourcePrescription=sourceReview?(()=>{
    const resolved=sourceReview.grading_contract
      ?prescriptionFromContract(sourceReview.grading_contract,planningErrorsForSource(sourceAttemptForTransition||input))
      :resolveLearningPolicy({problemId:input.problem_id,problem,source:{...input,...sourceReview},
        learningPurpose:sourceReview.learning_purpose,learningStage:sourceReview.learning_stage,
        assessmentTiming:sourceReview.assessment_timing||"delayed_retrieval",targetedParts:sourceReview.targeted_parts});
    return {...resolved,assessmentTiming:sourceReview.assessment_timing||resolved.assessmentTiming};
  })():undefined;
  const learningPurpose=input.learning_purpose||sourcePrescription?.learningPurpose||
    (examEligibility.eligible?"exam_performance":input.generated_from_review_id?"error_repair":"integration_check");
  const rawGptMark=String(input.mark||"");
  const rawGptMarkWasPresent=input.raw_gpt_mark_present??!!rawGptMark;
  const evaluation=resolveLearningEvaluation({
    learningPurpose,assessmentTiming,result:String(input.review_outcome||"") as "success"|"partial"|"failed",
    reviewOutcome:input.review_outcome,actualReferenceLevel,allowedReferenceLevel:allowedReference,
    hintUsed:!!input.hint_used,referenceClosedReproduction:referenceClosed,
    targetIssueResolved:input.target_issue_resolved,minimumPassConditionMet:input.minimum_pass_condition_met,
    errorTypes:effectiveErrors.length?effectiveErrors:["none"],unresolvedCarryover:input.unresolved_carryover,
    gradedPartIds:input.graded_part_ids||sourceReview?.grading_contract?.gradedParts.map(part=>part.id),
    gradedFindings:input.graded_findings,requireGradedEvidence:!!sourceReview
  });
  const appCorrectionFields=[
    rawGptMarkWasPresent&&rawGptMark!==evaluation.mark?"mark":"",
    input.review_outcome&&input.review_outcome!==evaluation.reviewOutcome?"review_outcome":"",
  ].filter(Boolean);
  input={...input,mark:evaluation.mark,review_outcome:evaluation.reviewOutcome,
    learning_purpose:learningPurpose,
    auto_corrected:!!input.auto_corrected||appCorrectionFields.length>0,
    correction_fields:[...new Set([...(input.correction_fields||[]),...appCorrectionFields])],
    correction_reason:appCorrectionFields.length
      ?`${String(input.correction_reason||"")}${input.correction_reason?" / ":""}markと学習状態を採点契約・答案証拠・履歴からアプリ側で決定`
      :input.correction_reason};
  const completionResult=evaluation.reviewOutcome,objectiveGraduation=evaluation.graduated;
  const transition=sourcePrescription?resolveReviewTransition({prescription:sourcePrescription,result:completionResult,
    referenceClosedReproduction:referenceClosed||actualReferenceLevel===0,
    objectiveRetentionSuccess:objectiveGraduation,crossProblemEvidence:false,verifiedTransferTargetAvailable:false}):undefined;
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
    graded_parts:input.graded_parts||[],graded_part_ids:input.graded_part_ids||[],
    graded_findings:input.graded_findings||[],assumed_correct_parts:input.assumed_correct_parts||[],
    unresolved_carryover:input.unresolved_carryover||[],review_scope:input.review_scope,
    targeted_parts:input.targeted_parts||[],k_evidence:input.k_evidence||[],
    k_evidence_valid:input.k_evidence_valid==null?undefined:!!input.k_evidence_valid,effective_error_types:input.effective_error_types||[],hint_used:!!input.hint_used,
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
    ,learning_purpose:learningPurpose
    ,learning_stage:input.learning_stage||sourceReview?.grading_contract?.learningStage||(examEligibility.eligible?"performance":input.generated_from_review_id?"repair":"acquisition")
    ,assessment_timing:assessmentTiming,task_score:taskScoreForAttempt(scoreCandidate),exam_score:examEligibility.examScore
    ,exam_score_eligible:examEligibility.eligible,time_limit_minutes:examEligibility.timeLimitMinutes||undefined
    ,conclusion_reached:input.conclusion_reached,incomplete_reason:input.incomplete_reason
    ,retention_eligible:assessmentTiming==="delayed_retrieval"
    ,problem_type_key:problem.metadata_status==="ok"?problem.canonical_problem_type:undefined
    ,policy_validity:kPolicyValidity,exclude_from_planning:kPolicyValidity==="invalid_legacy_k"
    ,exclude_from_recurrence_metrics:kPolicyValidity==="invalid_legacy_k"
    ,superseded_by_policy_version:kPolicyValidity==="invalid_legacy_k"?LEARNING_POLICY_VERSION:undefined
    ,parent_past_session_id:Number(input.parent_past_session_id||0)||undefined
     ,contract_id:input.contract_id,contract_version:input.contract_version,contract_hash:input.contract_hash
     ,grading_contract:sourceReview?.grading_contract,explicitly_out_of_scope_parts:input.explicitly_out_of_scope_parts||[]
     ,submission_id:submissionId,source_review_id:input.generated_from_review_id,saved_at:new Date().toISOString()
     ,exclude_from_metrics:false
   }));
  await db.attempts.update(id,{canonical_attempt_id:id});
  if(input.auto_corrected) pendingCorrectionLogs.push({
    auto_corrected:true,correction_fields:input.correction_fields||[],
    raw_gpt_problem_id:String(input.raw_gpt_problem_id||input.problem_id),corrected_problem_id:input.problem_id,
    raw_gpt_theme:String(input.raw_gpt_theme||""),corrected_theme:problem.theme,
    correction_reason:String(input.correction_reason||"problem_master に基づき補正"),
    consistency_score:Number(input.consistency_score||0),corrected_at:new Date().toISOString()
  });
  if(input.generated_from_review_id){
    await db.reviews.update(input.generated_from_review_id,{
      status:"done",completion_result:completionResult,
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
  if(input.minimum_pass_condition_met===true||input.target_issue_resolved===true||
    (input.error_types||[]).every(error=>error==="none")){
    const succeededParts=new Set(input.graded_part_ids||sourceReview?.grading_contract?.gradedParts.map(part=>part.id)||[]);
    const older=succeededParts.size?(await db.reviews.where("problem_id").equals(input.problem_id).toArray()).filter(review=>
      review.id!==input.generated_from_review_id&&ACTIVE_REVIEW_STATUSES.has(review.status)&&
      ["error_repair","retrieval_check"].includes(String(review.grading_contract?.learningPurpose||review.learning_purpose||""))&&
      Number(review.source_attempt_id||review.generated_from_attempt_id||0)<id&&
      (review.grading_contract?.gradedParts.map(part=>part.id)||review.graded_part_ids||[]).every(part=>succeededParts.has(part))
    ):[];
    for(const review of older)await db.reviews.update(review.id,{
      status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
      replaced_by_review_id:input.generated_from_review_id,
      superseded_reason:`Attempt ${id} で同一採点対象の最低合格条件を満たしたため`,
    });
  }
  const attempts=(await db.attempts.where("problem_id").equals(input.problem_id).sortBy("date")).filter(x=>x.id!==id);
  const previous=attempts.at(-1);
  let consecutivePerfect=0;
  for(const attempt of [...attempts].reverse()){if(attempt.mark==="◎") consecutivePerfect++;else break}
  const sState:SState=input.mark==="◎"||input.mark==="○"?"stable":input.mark==="×"?"forgotten":"check";
  // problem_masterの関連指定やGPT候補だけでは関連課題を自動生成しない。
  // confirmedかつ具体的なsourceIssue/targetFocusを持つrelationは、確認UIから別途タスク化する。
  const basePlan=problem.category==="S"?createSReviewPlan(sState):createAttemptReviewPlan(input,[],consecutivePerfect);
  const exceedsAllowed=actualReferenceLevel>allowedReference;
  const plan=input.generated_from_review_id&&exceedsAllowed&&actualReferenceLevel>=3
    ?{...basePlan,interval_days:3,review_reason:"許可範囲を超えて保存済み解説・公式解答・外部資料を参照したため、3日後に再確認する。"}
    :input.generated_from_review_id&&exceedsAllowed
      ?{...basePlan,interval_days:Math.min(7,basePlan.interval_days||7),review_reason:"許可参照段階を超えたため、次回間隔を軽く短縮する。"}
      :basePlan;
  const nextPurpose=sourceReview?transition?.nextPurpose:(effectiveErrors.length?"error_repair":
    problem.source_type==="past_exam"?undefined:"retrieval_check");
  const delayedPrescription=nextPurpose?resolveLearningPolicy({problemId:input.problem_id,problem,source:{...input,
    error_types:effectiveErrors.length?effectiveErrors:["none"],learning_purpose:nextPurpose,
    assessment_timing:"delayed_retrieval"},learningPurpose:nextPurpose,
    targetedParts:nextPurpose===sourcePrescription?.learningPurpose?input.targeted_parts:undefined}):undefined;
  const delayedDraft=delayedPrescription?taskDraftFromPrescription({prescription:delayedPrescription,sourceAttemptId:id,sourceDate:date,errors:effectiveErrors}):undefined;
  const delayedInterval=delayedDraft?Math.max(0,Math.round((Date.parse(delayedDraft.dueDate)-Date.parse(date))/86400000)):0;
  if(delayedPrescription&&delayedDraft&&!(problem.category==="S"&&!effectiveErrors.length))await addOrReplaceReview({
    problem_id:input.problem_id,due_date:await reviewDueDate(date,delayedInterval),
    review_type:plan.review_type,status:"pending",generated_from_attempt_id:id,duration_minutes:delayedPrescription.estimatedMinutes,
    reason:delayedPrescription.schedulingReason,task_origin:"review_attempt",attempt_exists:true,
    origin:input.parent_past_session_id?"past_exam_attempt":"direct_attempt",target_problem_id:input.problem_id,
    parent_past_session_id:Number(input.parent_past_session_id||0)||undefined,generated_at:new Date().toISOString(),
    review_scope:delayedPrescription.reviewScope,targeted_parts:delayedPrescription.targetedParts,
    scope_completion_conditions:delayedPrescription.completionConditions,effective_mode:delayedPrescription.mode==="exam_90min"?"full":delayedPrescription.mode,
    sheet_type:delayedPrescription.sheetType,learning_purpose:delayedPrescription.learningPurpose,
    learning_stage:delayedPrescription.learningStage,assessment_timing:"delayed_retrieval",
    target_kind:delayedPrescription.targetKind,required_evidence:delayedPrescription.requiredEvidence,
    policy_version:delayedPrescription.policyVersion,source_attempt_id:id,deduplication_key:delayedDraft.deduplicationKey,
    earliest_date:delayedDraft.window.earliestDate,preferred_date:delayedDraft.window.preferredDate,latest_date:delayedDraft.window.latestDate,
    retention_eligible:true,success_transition:delayedPrescription.successTransition,failure_transition:delayedPrescription.failureTransition,
    ...planFields(plan),interval_days:delayedInterval
  });
  if(effectiveErrors.length&&!input.generated_from_review_id){
    const immediate=resolveLearningPolicy({problemId:input.problem_id,problem,source:{...input,error_types:effectiveErrors,
      learning_purpose:"error_repair",assessment_timing:"same_session_correction"},targetedParts:input.targeted_parts});
    const immediateDraft=taskDraftFromPrescription({prescription:immediate,sourceAttemptId:id,sourceDate:date,errors:effectiveErrors});
    await addOrReplaceReview({problem_id:input.problem_id,due_date:date,review_type:"same_session_correction",status:"pending",
      generated_from_attempt_id:id,duration_minutes:immediate.estimatedMinutes,reason:immediate.schedulingReason,task_origin:"review_attempt",attempt_exists:true,
      origin:input.parent_past_session_id?"past_exam_attempt":"direct_attempt",target_problem_id:input.problem_id,
      parent_past_session_id:Number(input.parent_past_session_id||0)||undefined,generated_at:new Date().toISOString(),
      review_scope:immediate.reviewScope,targeted_parts:immediate.targetedParts,scope_completion_conditions:immediate.completionConditions,
      effective_mode:immediate.mode==="exam_90min"?"full":immediate.mode,sheet_type:immediate.sheetType,
      learning_purpose:"error_repair",learning_stage:"repair",assessment_timing:"same_session_correction",target_kind:immediate.targetKind,
      required_evidence:immediate.requiredEvidence,policy_version:immediate.policyVersion,source_attempt_id:id,
      deduplication_key:immediateDraft.deduplicationKey,earliest_date:date,preferred_date:date,latest_date:date,
      retention_eligible:false,success_transition:"delayed_retrieval",failure_transition:"delayed_retrieval",
      ...planFields(plan),interval_days:0});
  }
  if(plan.completion_candidate) await db.problems.update(input.problem_id,{completion_status:"completion_candidate"});
  const weakCandidates=primary==="none"?[]:input.weak_notes?.length?input.weak_notes:input.weak_note?[input.weak_note]:
    primary!=="none"&&localizedErrorPoint?[{theme:input.theme||problem.theme,error_type:primary,mistake:localizedErrorPoint,correction_rule:japaneseizeMathText(input.correction_rule||localizedNextAction)}]:[];
  for(const weak of weakCandidates.filter(weak=>weak.error_type!=="none")) await db.weakNotes.add({
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
  if(objectiveGraduation||(problem.source_type==="past_exam"&&!effectiveErrors.length&&completionResult==="success"))
    await db.problems.update(input.problem_id,{completion_status:"completed"});
  else if(primary!=="none"||delayedPrescription)
    await db.problems.update(input.problem_id,{completion_status:"review_pending"});
  if(problem.category==="S"){
    const old=await db.sMemory.get(input.problem_id);
    await db.sMemory.put({problem_id:input.problem_id,state:sState,last_touched:date,k_trigger_count:old?.k_trigger_count||0});
  }
  await reconcileProblemLearningState(input.problem_id);
  return id;
}

async function persistCorrectionLogs(logs:PendingCorrectionLog[]){
  if(!logs.length)return;
  try{await db.correctionLogs.bulkAdd(logs as CorrectionLog[])}
  catch(error){
    try{await db.meta.put({key:"last_auxiliary_log_error",value:`${new Date().toISOString()}｜${error instanceof Error?error.message:String(error)}`})}catch{/* 学習記録本体は保存済みのため再throwしない */}
  }
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
    error_type:primary,primary_error_type:primary,error_types:errors,error_point:errorPoint,next_action:nextAction,
    graded_part_ids:Array.isArray(body.graded_part_ids)?body.graded_part_ids.map(String):attempt.graded_part_ids,
    graded_parts:Array.isArray(body.graded_parts)?body.graded_parts.map(String):attempt.graded_parts,
    graded_findings:Array.isArray(body.graded_findings)?body.graded_findings as Attempt["graded_findings"]:attempt.graded_findings,
    targeted_parts:Array.isArray(body.targeted_parts)?body.targeted_parts.map(String):attempt.targeted_parts,
    target_issue_resolved:body.target_issue_resolved==null?attempt.target_issue_resolved:!!body.target_issue_resolved,
    minimum_pass_condition_met:body.minimum_pass_condition_met==null?attempt.minimum_pass_condition_met:!!body.minimum_pass_condition_met};
  await db.attempts.put(updated);
  const generatedReviews=(await db.reviews.toArray()).filter(review=>review.generated_from_attempt_id===id&&ACTIVE_REVIEW_STATUSES.has(review.status));
  for(const review of generatedReviews)await db.reviews.update(review.id,{status:"superseded",exclude_from_planning:true,
    exclude_from_recurrence_metrics:true,superseded_reason:`Attempt ${id}の採点内容が編集されたため再構成`});
  const noteIds=oldNotes.map(note=>note.id);
  if(noteIds.length) await db.weakNotes.bulkDelete(noteIds);
  const related=[...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)];
  const plan=problem.category==="S"
    ?createSReviewPlan(updated.mark==="◎"||updated.mark==="○"?"stable":updated.mark==="×"?"forgotten":"check")
    :createAttemptReviewPlan(updated,[],0);
  await addOrReplaceReview({problem_id:attempt.problem_id,due_date:await reviewDueDate(date,plan.interval_days||14),
    review_type:plan.review_type,status:"pending",generated_from_attempt_id:id,duration_minutes:plan.estimated_minutes,
    reason:plan.review_reason,task_origin:"review_attempt",attempt_exists:true,...planFields(plan)});
  const theme=String(body.theme||oldNotes[0]?.theme||problem.theme);
  if(primary!=="none"&&errorPoint) await db.weakNotes.add({
    id:undefined as unknown as number,date,problem_id:attempt.problem_id,error_type:primary,theme,mistake:errorPoint,
    correction_rule:japaneseizeMathText(String(body.correction_rule||oldNotes[0]?.correction_rule||nextAction)),
    is_resolved:0,source_text:oldNotes[0]?.source_text||"",auto_generated:true,generated_from_attempt_id:id
  });
  // 汎用の problem_master 関連指定だけでは補修タスクを自動生成しない。
  // confirmed 関係をユーザーが選んだ場合だけ、別の明示操作で最大1件作る。
  if(false&&(errors.includes("K")||errors.includes("N"))&&related.length){
    const state:SState=errors.includes("K")?"collapsed":"check",sPlan=createSReviewPlan(state);
    for(const sid of [...new Set(related)]){
      if(!await db.problems.get(sid)) continue;
      await addOrReplaceReview({problem_id:sid,due_date:await reviewDueDate(date,sPlan.interval_days||1),
        review_type:"s_check",status:"pending",generated_from_attempt_id:id,duration_minutes:sPlan.estimated_minutes,
        reason:sPlan.review_reason,task_origin:"linked_s_check",source_problem_id:attempt!.problem_id,
        attempt_exists:(await db.attempts.where("problem_id").equals(sid).count())>0,
        review_goal_public:"元問題で崩れた基礎型を確認する",...planFields(sPlan)});
    }
  }
  await refreshLinkedSMemory(related);
  await db.problems.update(attempt.problem_id,{completion_status:primary==="none"?"active":"review_pending"});
  await reconcileProblemLearningState(attempt.problem_id);
}

async function deleteAttemptAnalysis(id:number){
  const attempt=await db.attempts.get(id);
  if(!attempt) throw new Error("削除する採点結果が見つかりません");
  const generatedReviews=(await db.reviews.toArray()).filter(review=>review.generated_from_attempt_id===id&&ACTIVE_REVIEW_STATUSES.has(review.status));
  const noteIds=(await db.weakNotes.toArray()).filter(note=>note.generated_from_attempt_id===id||
    (!note.generated_from_attempt_id&&note.problem_id===attempt.problem_id&&note.date===attempt.date)).map(note=>note.id);
  await db.attempts.delete(id);
  for(const review of generatedReviews)await db.reviews.update(review.id,{status:"superseded",exclude_from_planning:true,
    exclude_from_recurrence_metrics:true,superseded_reason:`参照元Attempt ${id}が削除されたため`});
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
      :createAttemptReviewPlan(latest,[],0);
    await addOrReplaceReview({problem_id:latest.problem_id,due_date:await reviewDueDate(latest.date,plan.interval_days||14),
      review_type:plan.review_type,status:"pending",generated_from_attempt_id:latest.id,duration_minutes:plan.estimated_minutes,
      reason:plan.review_reason,task_origin:"review_attempt",attempt_exists:true,...planFields(plan)});
  }
  await db.problems.update(attempt.problem_id,{completion_status:stillWeak?"review_pending":"active"});
  await reconcileProblemLearningState(attempt.problem_id);
}

async function completeReview(id:number,body:Record<string,unknown>){
  const review=await db.reviews.get(id);
  if(!review) throw new Error("復習予定が見つかりません");
  const executionState=reviewExecutionState(review,todayString());
  if(executionState!=="actionable")throw new Error(reviewExecutionMessage(executionState,review));
  const staleReason=await staleEvidenceReason(review);
  if(staleReason)throw new Error(`この復習課題は最新答案により終了または更新されています。${staleReason}`);
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
  const resolvedPrescription=review.grading_contract
    ?prescriptionFromContract(review.grading_contract,planningErrorsForSource(source))
    :resolveLearningPolicy({problemId:review.problem_id,problem,source:{...source,...review},
      learningPurpose:review.learning_purpose,learningStage:review.learning_stage,
      assessmentTiming:review.assessment_timing||"delayed_retrieval",targetedParts:review.targeted_parts});
  const currentPrescription={...resolvedPrescription,
    assessmentTiming:review.assessment_timing||resolvedPrescription.assessmentTiming};
  const objectiveFindings=(review.grading_contract?.gradedParts||[]).map(part=>{
    if(successful)return {graded_part_id:part.id,error_type:"none" as const,evidence:"自己確認で対象を再現",resolved:true};
    const error=(currentPrescription.effectiveErrorTypes.find(value=>value!=="K"&&part.allowedErrorTypes.includes(value))||
      part.allowedErrorTypes.find(value=>value!=="none"&&value!=="K")||"N") as "W"|"N"|"C";
    return {graded_part_id:part.id,error_type:error,evidence:"自己確認で今回の採点対象を再現できなかった",resolved:false};
  });
  const evaluation=resolveLearningEvaluation({
    learningPurpose:currentPrescription.learningPurpose,assessmentTiming:currentPrescription.assessmentTiming,
    result:outcome.result,reviewOutcome:outcome.result,actualReferenceLevel,
    allowedReferenceLevel:allowedReference,hintUsed,referenceClosedReproduction:referenceClosed,
    targetIssueResolved:successful,minimumPassConditionMet:successful,
    errorTypes:successful?["none"]:currentPrescription.effectiveErrorTypes,
    unresolvedCarryover:successful?[]:source.unresolved_carryover,
    gradedPartIds:review.grading_contract?.gradedParts.map(part=>part.id)||[],gradedFindings:objectiveFindings,
    requireGradedEvidence:true
  });
  const transition=resolveReviewTransition({prescription:currentPrescription,result:evaluation.reviewOutcome,
    referenceClosedReproduction:referenceClosed||actualReferenceLevel===0,crossProblemEvidence:false,
    verifiedTransferTargetAvailable:false,objectiveRetentionSuccess:evaluation.graduated});
  const plan=linkedS?createSReviewPlan(evaluation.reviewOutcome==="success"?"stable":evaluation.reviewOutcome==="partial"?"check":"forgotten"):
    createAdaptiveReviewPlan(source,review,outcome,[]);
  const sourceErrors=linkedS?[]:currentPrescription.effectiveErrorTypes;
  const errors=evaluation.reviewOutcome==="success"?[]:sourceErrors.length?sourceErrors:["K"];
  const date=todayString(),mark=evaluation.mark;
  const attemptId=Number(await db.attempts.add({
    ...source,id:undefined as unknown as number,problem_id:review.problem_id,date,
    mode:currentPrescription.mode==="exam_90min"?"full":currentPrescription.mode,
    time_minutes:outcome.time_minutes,mark,score_label:successful?"A":outcome.result==="partial"?"B":"C",
    error_type:errors[0]||"none",primary_error_type:errors[0]||"none",secondary_error_type:errors[1]||"",
    error_types:errors,error_point:successful?"":linkedS?"関連S確認で基礎型を再現できなかった":source.error_point,
    next_action:plan.review_instruction||"",memo:"復習結果から自動記録",
    score_text:"",score_numeric:null,score_max:null,result_summary:`復習結果：${outcome.result}${outcome.hint_used?"・ヒント使用":""}`,
    improvement_guidance:linkedS?"":source.improvement_guidance,required_derivation:linkedS?"":source.required_derivation,
    corrected_answer:linkedS?"":source.corrected_answer,resolution_evidence:successful?"対象partを参照なしで再現":"",answer_change_summary:"",
    target_issue_resolved:successful,minimum_pass_condition_met:successful,
    required_work_shown:[],graded_parts:review.grading_contract?.gradedParts.map(part=>part.label)||[],
    graded_part_ids:review.grading_contract?.gradedParts.map(part=>part.id)||[],graded_findings:objectiveFindings,
    assumed_correct_parts:[],unresolved_carryover:successful?[]:source.unresolved_carryover||[],
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
    task_origin:linkedS?"linked_s_check":"review_attempt",source_problem_id:linkedS?source.problem_id:undefined,attempt_exists:true,
    learning_purpose:currentPrescription.learningPurpose,learning_stage:currentPrescription.learningStage,
    assessment_timing:currentPrescription.assessmentTiming,task_score:null,exam_score:null,exam_score_eligible:false,
    retention_eligible:transition.retentionSuccess,problem_type_key:problem.metadata_status==="ok"?problem.canonical_problem_type:undefined,
    grading_contract:review.grading_contract,contract_id:review.contract_id,contract_version:review.contract_version,contract_hash:review.contract_hash
  }));
  await db.reviews.update(id,{status:"done",completion_result:evaluation.reviewOutcome,hint_used:outcome.hint_used,
    hint_level:String(body.hint_level|| (outcome.hint_used?"unspecified":"none")),after_hint_reproduced:!!outcome.after_hint_reproduced,
    reference_level:actualReferenceLevel,actual_reference_level:actualReferenceLevel,
    allowed_reference_level:allowedReference,reference_closed_reproduction:referenceClosed,
    no_hint:actualReferenceLevel===0,one_line_hint:!!body.one_line_hint,
    previous_mistake:!!body.previous_mistake,official_answer:!!body.official_answer,
    saved_gpt_feedback:!!body.saved_gpt_feedback||!!body.gpt_explanation,
    external_reference:!!body.external_reference,gpt_explanation:!!body.saved_gpt_feedback||!!body.gpt_explanation,
    completion_time_minutes:outcome.time_minutes,completed_at:new Date().toISOString()});
  if(transition.nextPurpose&&!(problem.category==="S"&&evaluation.reviewOutcome==="success")){
    const nextPrescription=resolveLearningPolicy({problemId:review.problem_id,problem,source:{...source,...review,
      error_types:evaluation.reviewOutcome==="success"?["none"]:errors,learning_purpose:transition.nextPurpose,
      assessment_timing:transition.nextTiming||"delayed_retrieval"},learningPurpose:transition.nextPurpose,
      assessmentTiming:transition.nextTiming||"delayed_retrieval",targetedParts:review.targeted_parts});
    const nextDraft=taskDraftFromPrescription({prescription:nextPrescription,sourceAttemptId:attemptId,sourceDate:date,errors:nextPrescription.effectiveErrorTypes});
    const nextInterval=Math.max(0,Math.round((Date.parse(nextDraft.dueDate)-Date.parse(date))/86400000));
    await addOrReplaceReview({problem_id:review.problem_id,due_date:await reviewDueDate(date,nextInterval),
      review_type:nextPrescription.reviewScope,status:"pending",generated_from_attempt_id:attemptId,duration_minutes:nextPrescription.estimatedMinutes,
      reason:nextPrescription.schedulingReason,task_origin:"review_attempt",attempt_exists:true,
      review_scope:nextPrescription.reviewScope,targeted_parts:nextPrescription.targetedParts,
      scope_completion_conditions:nextPrescription.completionConditions,effective_mode:nextPrescription.mode==="exam_90min"?"full":nextPrescription.mode,
      sheet_type:nextPrescription.sheetType,learning_purpose:nextPrescription.learningPurpose,learning_stage:nextPrescription.learningStage,
      assessment_timing:nextPrescription.assessmentTiming,target_kind:nextPrescription.targetKind,
      required_evidence:nextPrescription.requiredEvidence,policy_version:nextPrescription.policyVersion,
      source_attempt_id:attemptId,deduplication_key:nextDraft.deduplicationKey,
      earliest_date:nextDraft.window.earliestDate,preferred_date:nextDraft.window.preferredDate,latest_date:nextDraft.window.latestDate,
      retention_eligible:nextPrescription.assessmentTiming==="delayed_retrieval",success_transition:nextPrescription.successTransition,
      failure_transition:nextPrescription.failureTransition,...planFields(plan),interval_days:nextInterval});
  }
  if(evaluation.reviewOutcome==="success"){
    const resolved=(await db.weakNotes.toArray()).filter(note=>note.generated_from_attempt_id===source.id);
    for(const note of resolved) await db.weakNotes.update(note.id,{is_resolved:1});
  }
  if(!linkedS&&evaluation.reviewOutcome!=="success"&&source.error_point) await db.weakNotes.add({
    id:undefined as unknown as number,date,problem_id:review.problem_id,error_type:errors[0],theme:problem.theme,
    mistake:source.error_point,correction_rule:source.next_action||plan.review_instruction||"",is_resolved:0,
    source_text:"",auto_generated:true,generated_from_attempt_id:attemptId
  });
  // 復習完了時も、旧式の関連S一括生成は停止する（既存記録は保持）。
  if(false&&plan.requires_s_check){
    const sPlan=createSReviewPlan(errors.includes("K")?"collapsed":"check");
    for(const sid of plan.linked_s_problem_ids||[]){
      if(!await db.problems.get(sid)) continue;
      await addOrReplaceReview({problem_id:sid,due_date:await reviewDueDate(date,sPlan.interval_days||1),review_type:"s_check",
        status:"pending",generated_from_attempt_id:attemptId,duration_minutes:sPlan.estimated_minutes,
        reason:sPlan.review_reason,task_origin:"linked_s_check",source_problem_id:review!.problem_id,
        attempt_exists:(await db.attempts.where("problem_id").equals(sid).count())>0,
        review_goal_public:"元問題で崩れた基礎型を確認する",...planFields(sPlan)});
    }
  }
  if(problem.category==="S"){
    const old=await db.sMemory.get(problem.problem_id);
    const state:SState=evaluation.reviewOutcome==="success"?"stable":evaluation.reviewOutcome==="partial"?"check":"forgotten";
    await db.sMemory.put({problem_id:problem.problem_id,state,last_touched:date,k_trigger_count:old?.k_trigger_count||0});
  }
  await refreshLinkedSMemory(related);
  await db.problems.update(review.problem_id,{completion_status:evaluation.graduated?"completed":"review_pending"});
  await reconcileProblemLearningState(review.problem_id);
}

async function postponeReview(id:number,body:Record<string,unknown>){
  const review=await db.reviews.get(id);
  if(!review) throw new Error("移動する復習予定が見つかりません");
  const today=todayString();
  const state=reviewExecutionState(review,today);
  if(state!=="actionable")throw new Error(reviewExecutionMessage(state,review));
  const unscheduled=!!body.unscheduled;
  const dueDate=unscheduled?review.due_date:postponedDueDate(today,body);
  const isToday=String(body.action)==="today";
  const postponedAt=new Date().toISOString();
  const count=Number(review.postpone_count||review.postponed_count||0)+(isToday?0:1);
  await db.reviews.update(id,{
    due_date:dueDate,status:unscheduled?"deferred":"pending",manual_order:isToday?0:Date.now(),
    schedule_origin:"manual",
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
  const [currentAnswers,problems]=await Promise.all([db.answerIndex.toArray(),db.problems.toArray()]);
  const currentMap=new Map(currentAnswers.map(answer=>[answer.problem_id,answer]));
  const problemIds=new Set(problems.map(problem=>problem.problem_id));
  const clean=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([key])=>!["imported_at","index_version"].includes(key)));
  let added=0,changed=0,unchanged=0,unmatched=0;
  const rows=payload.answers.map(answer=>{
    const old=currentMap.get(answer.problem_id);
    if(!old) added++;
    else if(JSON.stringify(clean(old as unknown as Record<string,unknown>))===JSON.stringify(clean(answer as unknown as Record<string,unknown>))) unchanged++;
    else changed++;
    if(!problemIds.has(answer.problem_id)) unmatched++;
    return {...answer,imported_at:now,index_version:payload.version};
  });
  await db.answerIndex.bulkPut(rows);
  for(const answer of payload.answers){
    const problem=await db.problems.get(answer.problem_id);
    if(problem) await db.problems.update(answer.problem_id,{answer_available:answer.answer_available});
  }
  await db.meta.bulkPut([{key:"answer_index_version",value:payload.version},{key:"answer_index_updated_at",value:now}]);
  await appendImportHistory("answer_index",payload.version,payload.answers.length);
  await addImportLog("answer_index",payload.version,0,payload.answers.length,0);
  return {count:payload.answers.length,version:payload.version,added,changed,unchanged,unmatched};
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
  const [problems,attempts,reviews,notes,answers,aliases,examMeta,relations]=await Promise.all([
    db.problems.toArray(),db.attempts.toArray(),db.reviews.toArray(),db.weakNotes.toArray(),db.answerIndex.toArray(),db.problemAliases.toArray(),db.meta.get("exam_date"),storedProblemRelations()
  ]);
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem])),amap=new Map(answers.map(answer=>[answer.problem_id,answer]));
  const diagnostics:DataDiagnostic[]=[];
  for(const problem of problems){
    const expected=expectedProblemMeta(problem.problem_id);
    if(expected){
      if(problem.category!==expected.category) diagnostics.push({id:`problem-category-${problem.problem_id}`,severity:"critical",problem_id:problem.problem_id,record_type:"problem",message:"問題IDとS/A種別が一致していません。",current_value:String(problem.category),suggested_value:expected.category,reason:"problem_idから機械的に判定できます。",repairable:true,recommended_action:"repair"});
      if((problem.chapter??null)!==expected.chapter) diagnostics.push({id:`problem-chapter-${problem.problem_id}`,severity:"critical",problem_id:problem.problem_id,record_type:"problem",message:"問題IDと章番号が一致していません。",current_value:String(problem.chapter??""),suggested_value:String(expected.chapter??""),reason:"problem_idから機械的に判定できます。",repairable:true,recommended_action:"repair"});
      if(Number(problem.problem_number)!==expected.problem_number) diagnostics.push({id:`problem-number-${problem.problem_id}`,severity:"critical",problem_id:problem.problem_id,record_type:"problem",message:"問題IDと問番号が一致していません。",current_value:String(problem.problem_number),suggested_value:String(expected.problem_number),reason:"problem_idから機械的に判定できます。",repairable:true,recommended_action:"repair"});
      if(problem.display_label&&problem.display_label!==expected.display_label) diagnostics.push({id:`problem-label-${problem.problem_id}`,severity:"warning",problem_id:problem.problem_id,record_type:"problem",message:"表示名が問題IDと一致していません。",current_value:problem.display_label,suggested_value:expected.display_label,reason:"第n章S/A問mの表示名はproblem_idから安全に補正できます。",repairable:true,recommended_action:"repair"});
    }
    if(!String(problem.theme||"").trim()) diagnostics.push({id:`problem-theme-${problem.problem_id}`,severity:"critical",problem_id:problem.problem_id,record_type:"problem",message:"themeが未設定です。問題内容を推測せず、metadata_review_neededとして扱ってください。",current_value:"",suggested_value:"要確認",reason:"問題内容の正本が不足しています。",repairable:true,recommended_action:"repair"});
    if(!String(problem.canonical_problem_type||"").trim()) diagnostics.push({id:`problem-type-${problem.problem_id}`,severity:"warning",problem_id:problem.problem_id,record_type:"problem",message:"canonical_problem_typeが未設定です。",current_value:"",suggested_value:"要確認",reason:"出題型の確認が必要です。",repairable:true,recommended_action:"repair"});
  }
  for(const attempt of attempts){
    const canonicalId=resolveCanonicalProblemId(attempt.problem_id,aliases);
    if(canonicalId!==attempt.problem_id) diagnostics.push({id:`attempt-alias-${attempt.id}`,severity:"warning",problem_id:attempt.problem_id,record_type:"attempt",message:"解答履歴のproblem_idがaliasです。表示・集計上はcanonical IDへ統合します。",current_value:attempt.problem_id,suggested_value:canonicalId,reason:"problem_aliasesに基づく補正です。",repairable:true,recommended_action:"repair"});
    const problem=pmap.get(canonicalId)||pmap.get(attempt.problem_id);
    if(!problem) diagnostics.push({id:`attempt-${attempt.id}`,severity:"critical",problem_id:attempt.problem_id,record_type:"attempt",message:"問題IDが problem_master に存在しません。",repairable:false});
    else if(!attemptMatchesProblem(attempt,problem)) diagnostics.push({id:`attempt-content-${attempt.id}`,severity:"critical",problem_id:attempt.problem_id,record_type:"attempt",message:"採点内容がこの問題の canonical_keywords と強く矛盾します。元のGPT出力を保持したまま問題IDを確認してください。",suggested_problem_id:attempt.problem_id==="WB-6-S-04"?"WB-6-S-01":undefined,repairable:false});
  }
  for(const review of reviews){
    const canonicalId=resolveCanonicalProblemId(review.problem_id,aliases);
    if(canonicalId!==review.problem_id) diagnostics.push({id:`review-alias-${review.id}`,severity:"warning",problem_id:review.problem_id,record_type:"review",message:"復習予定のproblem_idがaliasです。表示・集計上はcanonical IDへ統合します。",current_value:review.problem_id,suggested_value:canonicalId,reason:"problem_aliasesに基づく補正です。",review_id:review.id,repairable:true,recommended_action:"repair"});
    const problem=pmap.get(canonicalId)||pmap.get(review.problem_id),source=attempts.find(attempt=>attempt.id===review.generated_from_attempt_id);
    if(review.status==="ignored") continue;
    const inactiveReview=["done","completed","cancelled","superseded"].includes(review.status);
    const origin=resolveReviewOrigin({review,attempts,aliases,relations,problems});
    if(!inactiveReview){
      if(!origin.valid)diagnostics.push({id:`review-source-origin-${review.id}`,severity:"critical",problem_id:review.problem_id,
        canonical_problem_id:origin.targetProblemId,record_type:"source_mismatch",message:origin.reason,review_id:review.id,
        source_problem_id:origin.sourceProblemId,target_problem_id:origin.targetProblemId,source_attempt_id:origin.sourceAttempt?.id,
        repairable:true,recommended_action:"repair"});
    }
    if(!problem) diagnostics.push({id:`review-${review.id}`,severity:"critical",problem_id:review.problem_id,record_type:"review",message:"復習の問題IDが problem_master に存在しません。",repairable:false});
    // 完了済み・取消・superseded は監査履歴として保持するが、現在対応が必要な
    // 復習カード診断（task_origin / linked relation / 派生文章）には含めない。
    if(inactiveReview)continue;
    const ownAttemptExists=attempts.some(attempt=>resolveCanonicalProblemId(attempt.problem_id,aliases)===canonicalId);
    if(review.task_origin==="review_attempt"&&!ownAttemptExists)
      diagnostics.push({id:`review-origin-${review.id}`,severity:"warning",problem_id:review.problem_id,record_type:"review",message:"履歴がないのに review_attempt になっています。",repairable:true});
    if(review.task_origin==="first_attempt"&&ownAttemptExists)
      diagnostics.push({id:`review-origin-first-${review.id}`,severity:"warning",problem_id:review.problem_id,record_type:"review",message:"履歴があるのに first_attempt になっています。",repairable:true});
    if(review.task_origin==="linked_s_check"&&problem?.category!=="S")
      diagnostics.push({id:`review-origin-linked-a-${review.id}`,severity:"critical",problem_id:review.problem_id,record_type:"review",message:"S問題ではないのに linked_s_check になっています。related_drillとして扱う候補です。",current_value:"linked_s_check",suggested_value:"related_drill",reason:"linked_s_checkはS問題確認専用です。",review_id:review.id,repairable:true,recommended_action:"repair"});
    if((review.task_origin==="linked_s_check"||review.review_type==="s_check")&&!review.source_problem_id&&!source)
      diagnostics.push({id:`review-origin-no-source-${review.id}`,severity:"critical",problem_id:review.problem_id,record_type:"review",message:"linked_s_checkなのにsource_problem_idがありません。",review_id:review.id,repairable:false,recommended_action:"hold"});
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
    const card=resolveReviewCard({item:{...review,origin:origin.origin,origin_verified:origin.valid,
      relation_id:origin.relation?.relationId||review.relation_id},problems,attempts,aliases,today:todayString(),examDate:examMeta?.value||""});
    if(!review.derived_from_problem_id||!review.derived_fields){
      diagnostics.push({id:`review-derived-legacy-${review.id}`,severity:"warning",problem_id:review.problem_id,canonical_problem_id:card.canonicalProblemId,
        record_type:"review_card",message:"派生文章に由来情報がない旧データです。共通Resolverで安全に再生成できます。",review_id:review.id,
        task_id:String(review.id),master_theme:card.theme,saved_derived_text:review.review_goal_public||review.review_instruction||"",
        target_attempt_id:card.targetAttempt?.id,source_attempt_id:card.sourceAttempt?.id,effective_mode:card.effectiveMode,sheet_type:card.sheetType,
        due_date:review.due_date,review_after_days:review.interval_days,repairable:true,recommended_action:"repair"});
    }
    for(const warning of card.consistencyWarnings.filter(item=>[
      "attempt_problem_mismatch","mode_sheet_mismatch","due_date_interval_mismatch","source_target_self_reference","metadata_review_needed"
    ].includes(item.code)&&!(inactiveReview&&item.code==="attempt_problem_mismatch")&&!(origin.valid&&item.code==="attempt_problem_mismatch"))){
      diagnostics.push({id:`review-card-${warning.code}-${review.id}`,severity:warning.blocksSpecificGuidance?"critical":"warning",
        problem_id:review.problem_id,canonical_problem_id:card.canonicalProblemId,record_type:"review_card",message:warning.message,
        review_id:review.id,task_id:String(review.id),master_theme:card.theme,saved_derived_text:review.review_goal_public||review.review_instruction||"",
        derived_provenance:review.derived_from_problem_id?`${review.derived_from_problem_id} / Attempt ${review.derived_from_attempt_id||"なし"}`:"なし",
        target_attempt_id:card.targetAttempt?.id,source_attempt_id:card.sourceAttempt?.id,effective_mode:card.effectiveMode,sheet_type:card.sheetType,
        due_date:review.due_date,review_after_days:review.interval_days,repairable:warning.repairable,recommended_action:warning.repairable?"repair":"hold"});
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
  const [problems,attempts,reviews,notes,aliases]=await Promise.all([db.problems.toArray(),db.attempts.toArray(),db.reviews.toArray(),db.weakNotes.toArray(),db.problemAliases.toArray()]);
  const pmap=new Map(problems.map(problem=>[problem.problem_id,problem]));
  let selfReferencesRemoved=0,idCorrections=0,metadataRepairs=0;
  for(const problem of problems){
    const expected=expectedProblemMeta(problem.problem_id);
    if(expected){
      const patch:Partial<Problem>&{rawDisplayLabel?:string;metadata_status?:string}={};
      if(problem.category!==expected.category) patch.category=expected.category;
      if((problem.chapter??null)!==expected.chapter) patch.chapter=expected.chapter;
      if(Number(problem.problem_number)!==expected.problem_number) patch.problem_number=expected.problem_number;
      if(problem.display_label&&problem.display_label!==expected.display_label){
        patch.rawDisplayLabel=problem.display_label;
        patch.display_label=expected.display_label;
        patch.title=expected.display_label;
      }
      if(!String(problem.theme||"").trim()){
        patch.theme="要確認";
        patch.metadata_status="metadata_review_needed";
      }
      if(!String(problem.canonical_problem_type||"").trim()) patch.canonical_problem_type="要確認";
      if(Object.keys(patch).length){
        await db.problems.update(problem.problem_id,patch);
        Object.assign(problem,patch);
        metadataRepairs++;
      }
    }
    const related=[...new Set([...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)])];
    const cleaned=related.filter(problemId=>resolveCanonicalProblemId(problemId,aliases)!==resolveCanonicalProblemId(problem.problem_id,aliases));
    if(cleaned.length!==related.length){
      await db.problems.update(problem.problem_id,{related_s_problem_ids:cleaned,linked_s_problems:cleaned.join(";")});
      problem.related_s_problem_ids=cleaned;problem.linked_s_problems=cleaned.join(";");
      selfReferencesRemoved++;
    }
  }
  for(const attempt of attempts){
    const canonicalId=resolveCanonicalProblemId(attempt.problem_id,aliases);
    if(canonicalId!==attempt.problem_id&&pmap.has(canonicalId)){
      await db.attempts.update(attempt.id,{problem_id:canonicalId,raw_problem_id:attempt.raw_problem_id||attempt.problem_id,id_corrected:true,id_correction_reason:"problem_aliasesに基づきcanonical IDへ補正"});
      idCorrections++;
    }
  }
  for(const note of notes){
    const canonicalId=resolveCanonicalProblemId(note.problem_id,aliases);
    const problem=pmap.get(canonicalId)||pmap.get(note.problem_id);
    if(canonicalId!==note.problem_id&&pmap.has(canonicalId)) await db.weakNotes.update(note.id,{problem_id:canonicalId});
    if(problem&&note.theme!==problem.theme) await db.weakNotes.update(note.id,{theme:problem.theme});
  }
  for(const review of reviews){
    const canonicalId=resolveCanonicalProblemId(review.problem_id,aliases);
    if(canonicalId!==review.problem_id&&pmap.has(canonicalId)){
      await db.reviews.update(review.id,{problem_id:canonicalId,raw_problem_id:review.raw_problem_id||review.problem_id,id_corrected:true,id_correction_reason:"problem_aliasesに基づきcanonical IDへ補正"});
      review.problem_id=canonicalId;idCorrections++;
    }
    const ownAttempts=attempts.filter(attempt=>resolveCanonicalProblemId(attempt.problem_id,aliases)===resolveCanonicalProblemId(review.problem_id,aliases));
    const source=attempts.find(attempt=>attempt.id===review.generated_from_attempt_id);
    const targetProblem=pmap.get(review.problem_id);
    if(review.task_origin==="linked_s_check"&&targetProblem?.category!=="S"){
      await db.reviews.update(review.id,{task_origin:"related_drill"});
      review.task_origin="related_drill";
    }
    if(review.review_type==="s_check"){
      const sourceId=review.source_problem_id||source?.problem_id||"",sourceProblem=pmap.get(sourceId);
      const validLinks=[...new Set([...(sourceProblem?.related_s_problem_ids||[]),...list(sourceProblem?.linked_s_problems||"")])];
      const integrity=relatedSIntegrity(resolveCanonicalProblemId(sourceId,aliases),resolveCanonicalProblemId(review.problem_id,aliases),validLinks.map(id=>resolveCanonicalProblemId(id,aliases)));
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
  if(idCorrections) await appendImportHistory("canonical ID補正","integrity-repair",idCorrections);
  if(metadataRepairs) await appendImportHistory("問題メタ情報補正","integrity-repair",metadataRepairs);
  if(!silent) await appendImportHistory("整合性修復","manual",reviews.length+notes.length);
  const diagnostics=await diagnoseData();
  return {diagnostics,self_references_removed:selfReferencesRemoved,remaining_review_needed:diagnostics.filter(item=>item.recommended_action==="hold").length};
}

async function rebuildReviewCards(){
  const [problems,attempts,reviews,aliases,examMeta,relations]=await Promise.all([
    db.problems.toArray(),db.attempts.toArray(),db.reviews.toArray(),db.problemAliases.toArray(),db.meta.get("exam_date"),storedProblemRelations()
  ]);
  let staleCount=0,regeneratedCount=0,reviewNeededCount=0,sourceTargetMixCount=0,dateCorrectedCount=0,supersededLegacyCount=0;
  const now=new Date().toISOString(),today=todayString();
  for(const review of reviews){
    // 完了・取消・superseded 済みは不変の履歴。派生表示の再構築対象にしない。
    if(["done","completed","cancelled","superseded","ignored"].includes(review.status))continue;
    const legacySource=attempts.find(attempt=>attempt.id===(review.source_attempt_id||review.generated_from_attempt_id));
    if(review.policy_validity==="invalid_legacy_k"){
      await db.reviews.update(review.id,{status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
        superseded_by_policy_version:LEARNING_POLICY_VERSION,
        superseded_reason:"invalid_legacy_k由来の旧契約を現行の採点契約から除外"});
      supersededLegacyCount++;
      const validErrors=planningErrorsForSource(legacySource||review);
      const sameTarget=!!legacySource&&resolveCanonicalProblemId(legacySource.problem_id,aliases)===
        resolveCanonicalProblemId(review.problem_id,aliases);
      if(legacySource&&sameTarget&&validErrors.length){
        const plan=createAttemptReviewPlan({...legacySource,error_types:validErrors,primary_error_type:validErrors[0]},[],0);
        const targets=repairTargets(review,legacySource);
        await addOrReplaceReview({problem_id:review.problem_id,due_date:review.due_date,
          review_type:plan.review_type,status:"pending",generated_from_attempt_id:legacySource.id,
          source_attempt_id:legacySource.id,derived_from_attempt_id:legacySource.id,
          duration_minutes:validErrors.length===1&&validErrors[0]==="C"?5:Math.min(9,Number(plan.estimated_minutes||5)),
          task_origin:"review_attempt",attempt_exists:true,targeted_parts:targets,
          policy_version:LEARNING_POLICY_VERSION,learning_purpose:"error_repair",
          deduplication_key:`${review.problem_id}:error_repair:${legacySource.id}:${LEARNING_POLICY_VERSION}`,
          ...planFields(plan)});
      }
      continue;
    }
    const origin=resolveReviewOrigin({review,attempts,aliases,relations,problems});
    const card=resolveReviewCard({item:{...review,origin:origin.origin,origin_verified:origin.valid,
      relation_id:origin.relation?.relationId||review.relation_id},problems,attempts,aliases,today,examDate:examMeta?.value||"",now});
    const hasLegacyDerived=!!(review.review_goal_public||review.review_instruction||review.review_steps?.length||review.sheet_name);
    const stale=!review.derived_from_problem_id||!review.derived_fields||
      review.derived_from_problem_id!==card.canonicalProblemId||review.derived_from_attempt_id!==card.targetAttempt?.id||
      review.derived_from_master_version!==(problems.find(problem=>problem.problem_id===card.canonicalProblemId)?.master_version||"unversioned")||
      card.consistencyWarnings.some(item=>["mode_sheet_mismatch","stored_mode_stale","due_date_interval_mismatch","attempt_problem_mismatch"].includes(item.code));
    if(stale||hasLegacyDerived) staleCount++;
    if(card.reviewNeeded) reviewNeededCount++;
    if(!origin.valid)sourceTargetMixCount++;
    const resolvedDue=correctedDueDate(card),dueChanged=resolvedDue!==review.due_date;
    const sourceAttempt=attempts.find(attempt=>attempt.id===Number(review.source_attempt_id||review.generated_from_attempt_id||0));
    const schedule=resolveReviewSchedule(review,sourceAttempt);
    if(dueChanged) dateCorrectedCount++;
    const problem=problems.find(entry=>entry.problem_id===card.canonicalProblemId);
    const derivedFields={reviewGoal:card.reviewGoal,correctionTheme:card.correctionTheme,entryHint:card.entryHint,
      oneLineHint:card.oneLineHint,todayActions:card.todayActions,completionConditions:card.completionConditions};
    await db.reviews.update(review.id,{
      problem_id:problem?card.canonicalProblemId:review.problem_id,
      raw_problem_id:problem&&card.canonicalProblemId!==review.problem_id?(review.raw_problem_id||review.problem_id):review.raw_problem_id,
      id_corrected:problem&&card.canonicalProblemId!==review.problem_id?true:review.id_corrected,
      id_correction_reason:problem&&card.canonicalProblemId!==review.problem_id?"problem_aliasesに基づきcanonical IDへ補正":review.id_correction_reason,
      inferred_mode:card.inferredMode,mode_override:card.modeOverride,sheet_name:card.sheetLabel,
      derived_from_problem_id:card.canonicalProblemId,derived_from_attempt_id:card.targetAttempt?.id,
      derived_from_master_version:problem?.master_version||"unversioned",derived_generated_at:now,derived_stale:false,
      derived_fields:derivedFields,
      raw_due_date:dueChanged?(review.raw_due_date||review.due_date):review.raw_due_date,
      due_date:resolvedDue,due_date_correction_reason:dueChanged?`Attempt日と復習間隔から再計算（${card.reviewAfterDays}日）`:review.due_date_correction_reason,
      source_date:schedule.sourceDate||review.source_date,
      review_after_days:schedule.reviewAfterDays??review.review_after_days,
      schedule_origin:schedule.scheduleOrigin,
      review_needed_reason:card.reviewNeeded?card.consistencyWarnings.filter(item=>item.blocksSpecificGuidance).map(item=>item.message).join(" "):undefined,
      ...taskFieldsFromContract(card.gradingContract)
    });
    regeneratedCount++;
  }
  await appendImportHistory("復習カードを安全に再構築","review-card-resolver",regeneratedCount);
  const afterRows=await db.reviews.toArray();
  const rawContractMismatch=afterRows.filter(row=>["pending","overdue","review_needed"].includes(row.status)&&(
    !row.grading_contract||row.effective_mode!==row.grading_contract.mode||row.sheet_type!==row.grading_contract.sheetType||
    row.review_scope!==row.grading_contract.reviewScope)).length;
  const summary={repaired_at:now,stale_count:staleCount,regenerated_count:regeneratedCount,review_needed_count:reviewNeededCount,
    source_target_mix_count:sourceTargetMixCount,date_corrected_count:dateCorrectedCount,superseded_legacy_count:supersededLegacyCount,
    raw_contract_mismatch_count:rawContractMismatch};
  await db.meta.put({key:"review_card_rebuild_summary",value:JSON.stringify(summary)});
  return {...summary,diagnostics:await diagnoseData()};
}

type ReviewScheduleSummary={
  repaired_at:string;
  policy_date_correction_count:number;
  manual_date_preserved_count:number;
  legacy_unknown_count:number;
  past_due_count:number;
  duplicates_superseded_count:number;
  needs_review_count:number;
  raw_policy_mismatch_count:number;
  effective_policy_mismatch_count:number;
  snapshot_actionable_mismatch_count:number;
  remaining_duplicate_count:number;
  remaining_legacy_unknown_count:number;
  completed_unchanged_count:number;
  today_plan_snapshot_unchanged:boolean;
  preview:boolean;
  success:boolean;
};

function scheduleSummaryFromAudit(audit:ReviewScheduleAudit,preview:boolean):ReviewScheduleSummary{
  return {
    repaired_at:new Date().toISOString(),
    policy_date_correction_count:audit.policyDateCorrections,
    manual_date_preserved_count:audit.manualDatePreserved,
    legacy_unknown_count:audit.legacyUnknown,
    past_due_count:audit.pastDueCorrections,
    duplicates_superseded_count:audit.duplicatesToSupersede,
    needs_review_count:audit.needsReview,
    raw_policy_mismatch_count:audit.policyDateCorrections,
    effective_policy_mismatch_count:audit.policyDateCorrections,
    snapshot_actionable_mismatch_count:0,
    remaining_duplicate_count:audit.duplicatesToSupersede,
    remaining_legacy_unknown_count:audit.legacyUnknown,
    completed_unchanged_count:audit.completedUnchanged,
    today_plan_snapshot_unchanged:true,
    preview,
    success:audit.policyDateCorrections===0&&audit.duplicatesToSupersede===0,
  };
}

async function reviewScheduleRepairPreview(){
  const [reviews,attempts,aliases]=await Promise.all([
    db.reviews.toArray(),db.attempts.toArray(),db.problemAliases.toArray()
  ]);
  return scheduleSummaryFromAudit(auditReviewSchedules({reviews,attempts,aliases,today:todayString()}),true);
}

async function repairReviewSchedules(){
  const [reviewsBefore,attemptsBefore,problems,aliases,snapshotRowsBefore]=await Promise.all([
    db.reviews.toArray(),db.attempts.toArray(),db.problems.toArray(),db.problemAliases.toArray(),
    db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()
  ]);
  const snapshotsBefore=JSON.stringify(snapshotRowsBefore.sort((a,b)=>a.key.localeCompare(b.key)).map(row=>[row.key,row.value]));
  const attemptsBeforeJson=JSON.stringify(attemptsBefore);
  const completedBefore=JSON.stringify(reviewsBefore.filter(row=>["done","completed"].includes(row.status)));
  const auditBefore=auditReviewSchedules({reviews:reviewsBefore,attempts:attemptsBefore,aliases,today:todayString()});
  const reviewMap=new Map(reviewsBefore.map(review=>[review.id,review]));
  const attemptMap=new Map(attemptsBefore.map(attempt=>[attempt.id,attempt]));
  const now=new Date().toISOString();
  let dateCorrected=0,manualPreserved=0,legacyResolved=0;

  for(const row of auditBefore.rows){
    const review=reviewMap.get(row.reviewId);
    if(!review)continue;
    if(row.scheduleOrigin==="manual"){
      manualPreserved+=row.manualDatePreserved?1:0;
      if(review.schedule_origin!=="manual")await db.reviews.update(review.id,{schedule_origin:"manual"});
      continue;
    }
    if(row.needsReview||!row.expectedReviewDate)continue;
    const shouldCorrect=row.mismatch||row.scheduleOrigin==="legacy_unknown";
    const card=resolveReviewCard({item:review,problems,attempts:attemptsBefore,aliases,today:todayString(),now});
    const patch:Partial<Review>={
      source_date:row.sourceDate,review_after_days:row.reviewAfterDays??undefined,
      interval_days:row.reviewAfterDays??review.interval_days,schedule_origin:"policy",
      policy_version:review.policy_version||card.prescription.policyVersion,
      ...taskFieldsFromContract(card.gradingContract)
    };
    if(shouldCorrect){
      patch.raw_due_date=review.raw_due_date||review.due_date;
      patch.due_date=row.expectedReviewDate;
      patch.due_date_correction_reason=`sourceDate ${row.sourceDate} と reviewAfterDays ${row.reviewAfterDays} から再計算`;
      dateCorrected++;
      if(row.scheduleOrigin==="legacy_unknown")legacyResolved++;
    }
    await db.reviews.update(review.id,patch);
  }

  let duplicatesSuperseded=0;
  for(const group of auditBefore.duplicateGroups){
    for(const id of group.supersedeReviewIds){
      const review=await db.reviews.get(id);
      if(!review||!["pending","overdue"].includes(review.status))continue;
      await db.reviews.update(id,{
        status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
        superseded_by_policy_version:LEARNING_POLICY_VERSION,
        superseded_reason:`同一問題・目的・モード・採点対象の新しいpending Review ${group.keepReviewId} を保持`
      });
      duplicatesSuperseded++;
    }
  }

  const [reviewsAfter,attemptsAfter,snapshotRowsAfter]=await Promise.all([
    db.reviews.toArray(),db.attempts.toArray(),
    db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()
  ]);
  const auditAfter=auditReviewSchedules({reviews:reviewsAfter,attempts:attemptsAfter,aliases,today:todayString()});
  const snapshotsAfter=JSON.stringify(snapshotRowsAfter.sort((a,b)=>a.key.localeCompare(b.key)).map(row=>[row.key,row.value]));
  const snapshotUnchanged=snapshotsBefore===snapshotsAfter;
  const historyPreserved=attemptsBeforeJson===JSON.stringify(attemptsAfter)&&
    completedBefore===JSON.stringify(reviewsAfter.filter(row=>["done","completed"].includes(row.status)))&&
    reviewsBefore.length===reviewsAfter.length;
  if(!snapshotUnchanged||!historyPreserved)throw new Error("安全性検証に失敗しました。学習履歴または今日の計画は変更されていません。");

  const mismatchIds=new Set(auditAfter.rows.filter(row=>row.mismatch).map(row=>row.reviewId));
  let snapshotActionableMismatch=0;
  for(const snapshotRow of snapshotRowsAfter){
    try{
      const snapshot=JSON.parse(snapshotRow.value) as TodayPlanSnapshot;
      snapshotActionableMismatch+=snapshot.tasks.filter(task=>task.id&&task.review_type&&mismatchIds.has(Number(task.id))).length;
    }catch{/* diagnostic only */}
  }
  const success=auditAfter.policyDateCorrections===0&&auditAfter.duplicatesToSupersede===0&&snapshotActionableMismatch===0;
  const summary:ReviewScheduleSummary={
    repaired_at:now,policy_date_correction_count:dateCorrected,
    manual_date_preserved_count:manualPreserved,
    legacy_unknown_count:auditBefore.legacyUnknown,
    past_due_count:auditBefore.pastDueCorrections,
    duplicates_superseded_count:duplicatesSuperseded,
    needs_review_count:auditAfter.needsReview,
    raw_policy_mismatch_count:auditAfter.policyDateCorrections,
    effective_policy_mismatch_count:auditAfter.policyDateCorrections,
    snapshot_actionable_mismatch_count:snapshotActionableMismatch,
    remaining_duplicate_count:auditAfter.duplicatesToSupersede,
    remaining_legacy_unknown_count:Math.max(0,auditAfter.legacyUnknown-legacyResolved),
    completed_unchanged_count:auditAfter.completedUnchanged,
    today_plan_snapshot_unchanged:snapshotUnchanged,
    preview:false,success,
  };
  await db.meta.put({key:"review_schedule_repair_summary",value:JSON.stringify(summary)});
  await appendImportHistory("復習日と重複カードの整理","review-schedule-policy-v1",dateCorrected+duplicatesSuperseded);
  if(!success)throw new Error("復習日の再診断で不整合が残りました。要確認項目を確認してください。");
  return {...summary,data_preserved:true};
}

async function gradingContractAuditPreview(){
  const [reviews,attempts,aliases]=await Promise.all([db.reviews.toArray(),db.attempts.toArray(),db.problemAliases.toArray()]);
  return {...auditLegacyReviewContracts({reviews,attempts,aliases}),preview:true,contract_version:"STAT1-CONTRACT-v2"};
}

async function legacyKReorganizationPreview(){
  const [attempts,reviews,problems]=await Promise.all([db.attempts.toArray(),db.reviews.toArray(),db.problems.toArray()]);
  const result=analyzeLegacyKReorganization({attempts,reviews,problems});
  return {invalid_legacy_k_count:result.invalidLegacyKCount,needs_review_count:result.needsReviewCount,
    superseded_task_count:result.supersededTaskCount,resolved_task_count:result.resolvedTaskCount,
    policy_version:LEARNING_POLICY_VERSION,preview:true};
}

async function reorganizeLegacyKTasks(){
  const [attemptsBefore,reviewsBefore,problems,snapshotRows]=await Promise.all([
    db.attempts.toArray(),db.reviews.toArray(),db.problems.toArray(),db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()
  ]);
  const attemptKeys=attemptsBefore.map(row=>row.id).sort((a,b)=>a-b).join(",");
  const reviewKeys=reviewsBefore.map(row=>row.id).sort((a,b)=>a-b).join(",");
  const completedBefore=reviewsBefore.filter(row=>row.status==="done").map(row=>row.id).sort((a,b)=>a-b).join(",");
  const actualMinutesBefore=attemptsBefore.reduce((sum,row)=>sum+Number(row.time_minutes||0),0);
  const snapshotsBefore=JSON.stringify(snapshotRows.map(row=>[row.key,row.value]));
  const result=analyzeLegacyKReorganization({attempts:attemptsBefore,reviews:reviewsBefore,problems});
  for(const row of result.classifications){
    await db.attempts.update(row.attemptId,{policy_validity:row.validity,
      exclude_from_planning:row.validity==="invalid_legacy_k",exclude_from_recurrence_metrics:row.validity==="invalid_legacy_k",
      superseded_by_policy_version:row.validity==="invalid_legacy_k"?LEARNING_POLICY_VERSION:undefined});
  }
  for(const action of result.taskActions)await db.reviews.update(action.reviewId,action.patch);
  const summary={analyzed_at:new Date().toISOString(),invalid_legacy_k_count:result.invalidLegacyKCount,
    needs_review_count:result.needsReviewCount,superseded_task_count:result.supersededTaskCount,
    resolved_task_count:result.resolvedTaskCount,policy_version:LEARNING_POLICY_VERSION,preview:false};
  await db.meta.put({key:"legacy_k_reorganization_summary",value:JSON.stringify(summary)});
  const [attemptsAfter,reviewsAfter,snapshotRowsAfter]=await Promise.all([
    db.attempts.toArray(),db.reviews.toArray(),db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()
  ]);
  const safe=attemptKeys===attemptsAfter.map(row=>row.id).sort((a,b)=>a-b).join(",")&&
    reviewKeys===reviewsAfter.map(row=>row.id).sort((a,b)=>a-b).join(",")&&
    completedBefore===reviewsAfter.filter(row=>row.status==="done").map(row=>row.id).sort((a,b)=>a-b).join(",")&&
    actualMinutesBefore===attemptsAfter.reduce((sum,row)=>sum+Number(row.time_minutes||0),0)&&
    snapshotsBefore===JSON.stringify(snapshotRowsAfter.map(row=>[row.key,row.value]));
  if(!safe)throw new Error("旧K再整理の安全性検証に失敗しました。履歴・完了状態・今日の計画は変更していません。");
  return {...summary,data_preserved:true};
}

async function storedProblemRelations():Promise<ProblemRelation[]>{
  const row=await db.meta.get("problem-relations");
  if(!row?.value)return [];
  try{return (JSON.parse(row.value) as ProblemRelation[]).filter(relation=>relation&&relation.relationId)}catch{return []}
}

async function sourceMismatchPreview(){
  const [reviews,attempts,problems,aliases,relations]=await Promise.all([
    db.reviews.toArray(),db.attempts.toArray(),db.problems.toArray(),db.problemAliases.toArray(),storedProblemRelations()
  ]);
  const result=analyzeSourceMismatchRepair({reviews,attempts,problems,aliases,relations});
  return {source_mismatch_count:result.mismatchCount,verified_relation_count:result.verifiedRelationCount,
    superseded_count:result.supersededCount,regenerated_count:result.regeneratedCount,
    needs_review_count:result.needsReviewCount,unchanged_completed_count:result.unchangedCompletedCount,
    active_source_mismatch:result.activeSourceMismatchCount,
    pending_verified_link_needs_migration:result.pendingVerifiedLinkNeedsMigrationCount,
    invalid_legacy_cards_to_supersede:result.invalidLegacyCardsToSupersedeCount,
    historical_completed_linked_reviews:result.historicalCompletedLinkedReviewsCount,
    unresolved_needs_review:result.unresolvedNeedsReviewCount,
    verified_relation_migrated:result.verifiedRelationMigratedCount,
    policy_version:REVIEW_ORIGIN_POLICY_VERSION,preview:true,
    causes:result.actions.reduce<Record<string,number>>((map,row)=>({...map,[row.reason]:(map[row.reason]||0)+1}),{})};
}

async function reorganizeSourceMismatches(){
  const [reviewsBefore,attemptsBefore,problems,aliases,relations,snapshotsBefore]=await Promise.all([
    db.reviews.toArray(),db.attempts.toArray(),db.problems.toArray(),db.problemAliases.toArray(),storedProblemRelations(),
    db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()
  ]);
  const attemptKeys=attemptsBefore.map(row=>row.id).sort((a,b)=>a-b).join(","),reviewKeys=reviewsBefore.map(row=>row.id).sort((a,b)=>a-b).join(",");
  const completed=reviewsBefore.filter(row=>["done","completed"].includes(row.status)).map(row=>`${row.id}:${row.status}`).sort().join(",");
  const scoreTime=attemptsBefore.map(row=>`${row.id}:${row.score_numeric}:${row.time_minutes}`).sort().join("|");
  const snapshotJson=JSON.stringify(snapshotsBefore.map(row=>[row.key,row.value]));
  const result=analyzeSourceMismatchRepair({reviews:reviewsBefore,attempts:attemptsBefore,problems,aliases,relations});
  for(const action of result.actions){
    if(action.patch)await db.reviews.update(action.reviewId,action.patch);
    if(action.replacement)await addOrReplaceReview(action.replacement);
  }
  const summary={reorganized_at:new Date().toISOString(),source_mismatch_count:result.mismatchCount,
    verified_relation_count:result.verifiedRelationCount,superseded_count:result.supersededCount,
    regenerated_count:result.regeneratedCount,needs_review_count:result.needsReviewCount,unchanged_completed_count:result.unchangedCompletedCount,
    active_source_mismatch:result.activeSourceMismatchCount,
    pending_verified_link_needs_migration:result.pendingVerifiedLinkNeedsMigrationCount,
    invalid_legacy_cards_to_supersede:result.invalidLegacyCardsToSupersedeCount,
    historical_completed_linked_reviews:result.historicalCompletedLinkedReviewsCount,
    unresolved_needs_review:result.unresolvedNeedsReviewCount,
    verified_relation_migrated:result.verifiedRelationMigratedCount,
    policy_version:REVIEW_ORIGIN_POLICY_VERSION,preview:false};
  await db.meta.put({key:"source_mismatch_reorganization_summary",value:JSON.stringify(summary)});
  const [reviewsAfter,attemptsAfter,snapshotsAfter]=await Promise.all([db.reviews.toArray(),db.attempts.toArray(),db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")).toArray()]);
  const safe=attemptKeys===attemptsAfter.map(row=>row.id).sort((a,b)=>a-b).join(",")&&
    reviewKeys.split(",").every(id=>reviewsAfter.some(row=>row.id===Number(id)))&&
    completed===reviewsAfter.filter(row=>["done","completed"].includes(row.status)).map(row=>`${row.id}:${row.status}`).sort().join(",")&&
    scoreTime===attemptsAfter.map(row=>`${row.id}:${row.score_numeric}:${row.time_minutes}`).sort().join("|")&&
    snapshotJson===JSON.stringify(snapshotsAfter.map(row=>[row.key,row.value]));
  if(!safe)throw new Error("source mismatch修復の安全性検証に失敗しました。transactionを取り消します。");
  const afterResult=analyzeSourceMismatchRepair({reviews:reviewsAfter,attempts:attemptsAfter,problems,aliases,relations});
  if(afterResult.activeSourceMismatchCount!==0)throw new Error(`出所修復後も現在対応が必要なカードが${afterResult.activeSourceMismatchCount}件残っています。transactionを取り消します。`);
  return {...summary,active_source_mismatch_after:afterResult.activeSourceMismatchCount,data_preserved:true};
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
const pdfPageCountFromText=(text:string)=>[...text.matchAll(/\/Type\s*\/Page\b/g)].length;
const hexFromBuffer=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,"0")).join("");

export async function inspectAnswerPdf(file:File){
  const buffer=await file.arrayBuffer();
  const sha256=crypto?.subtle?hexFromBuffer(await crypto.subtle.digest("SHA-256",buffer)):"";
  const text=new TextDecoder("latin1").decode(new Uint8Array(buffer));
  return {original_file_name:file.name,size:file.size,page_count:pdfPageCountFromText(text),sha256};
}

async function findStoredAnswerPdf(identifier:string){
  await initialize();
  const byDocumentKey=await db.answerPdfs.where("document_key").equals(identifier).first();
  if(byDocumentKey) return byDocumentKey;
  return await db.answerPdfs.get(identifier);
}

export async function saveAnswerPdf(file:File,registration:{document_key:string}){
  await initialize();
  const doc=ANSWER_PDF_DOCUMENTS.find(item=>item.document_key===registration.document_key);
  if(!doc) throw new Error("登録先document_keyが不明です");
  const inspection=await inspectAnswerPdf(file);
  const pageMatches=inspection.page_count===doc.expected_page_count;
  const hashMatches=!doc.expected_sha256||inspection.sha256===doc.expected_sha256;
  if(!pageMatches||!hashMatches){
    throw new Error(`選択したPDFは登録先と一致しない可能性があります。期待：${doc.expected_file_name} / ${doc.expected_page_count}ページ。選択：${file.name} / ${inspection.page_count||"不明"}ページ。別PDFを選んでください。`);
  }
  const now=new Date().toISOString();
  const existing=await db.answerPdfs.where("document_key").equals(registration.document_key).toArray();
  if(existing.length) await db.answerPdfs.bulkDelete(existing.map(row=>row.file_name));
  const storageKey=`${registration.document_key}.pdf`;
  await db.answerPdfs.put({
    file_name:storageKey,document_key:registration.document_key,kind:doc.kind,source_book:doc.source_book,
    original_file_name:file.name,display_name:doc.display_name,page_count:inspection.page_count,
    sha256:inspection.sha256,blob:file,uploaded_at:now,registered_at:now
  });
  const saved=await findStoredAnswerPdf(registration.document_key);
  if(!saved||!saved.blob||saved.blob.size<=0||saved.document_key!==registration.document_key||saved.page_count!==doc.expected_page_count){
    throw new Error("PDFの保存確認に失敗しました。もう一度登録してください。");
  }
}
export async function openAnswerPdf(fileName:string,page?:number|null){
  const popup=window.open("about:blank","_blank");
  const row=await findStoredAnswerPdf(fileName);
  if(!row){popup?.close();throw new Error("PDF本体はこのiPadに登録されていません")}
  const url=URL.createObjectURL(row.blob),target=page?`${url}#page=${page}`:url;
  if(popup) popup.location.href=target; else window.open(target,"_blank");
  setTimeout(()=>URL.revokeObjectURL(url),120000);
}
export async function answerPdfObjectUrl(fileName:string,page?:number|null){
  const row=await findStoredAnswerPdf(fileName);
  if(!row) throw new Error("PDF本体はこのiPadに登録されていません");
  const url=URL.createObjectURL(row.blob);
  return {url,pageUrl:page?`${url}#page=${page}`:url,revoke:()=>URL.revokeObjectURL(url)};
}

export async function answerPdfRecord(identifier:string){
  const row=await findStoredAnswerPdf(identifier);
  if(!row) throw new Error("PDF本体はこのiPadに登録されていません");
  return {
    document_key:row.document_key||row.file_name,
    file_name:row.file_name,
    original_file_name:row.original_file_name||row.file_name,
    display_name:row.display_name||row.original_file_name||row.file_name,
    page_count:row.page_count,
    sha256:row.sha256,
    blob:row.blob
  };
}

export async function deleteAnswerPdf(documentKey:string){
  await initialize();
  const rows=await db.answerPdfs.where("document_key").equals(documentKey).toArray();
  if(rows.length) await db.answerPdfs.bulkDelete(rows.map(row=>row.file_name));
}

function diagnosticsPreview(problems:Problem[],attempts:Attempt[],reviews:Review[],aliases:ProblemAlias[]){
  const pmap=new Map(problems.map(problem=>[resolveCanonicalProblemId(problem.problem_id,aliases),problem]));
  let criticalCount=0;
  for(const problem of problems){
    const expected=expectedProblemMeta(problem.problem_id);
    if(expected&&(
      problem.category!==expected.category||
      (problem.chapter??null)!==expected.chapter||
      Number(problem.problem_number)!==expected.problem_number||
      (problem.display_label||problem.title)!==expected.display_label
    )) criticalCount++;
  }
  for(const attempt of attempts) if(!pmap.has(resolveCanonicalProblemId(attempt.problem_id,aliases))) criticalCount++;
  for(const review of reviews) if(!pmap.has(resolveCanonicalProblemId(review.problem_id,aliases))) criticalCount++;
  return {criticalCount};
}

function jsonMetaValue<T>(entries:Array<{key:string;value:string}>,key:string,fallback:T):T{
  const row=entries.find(entry=>entry.key===key);
  if(!row)return fallback;
  try{return JSON.parse(row.value) as T}catch{return fallback}
}

function storedExamReferencePack(entries:Array<{key:string;value:string}>){
  return jsonMetaValue<StoredExamReferencePack|null>(entries,EXAM_REFERENCE_PACK_META_KEY,null);
}

async function installExamReferencePack(args:{
  data:StoredExamReferencePack["data"];packHash:string;validation:ReferencePackValidation;
  origin:"built_in"|"manual";notify:boolean;
}){
  const {data,packHash}=args;
  if(!data||!packHash)throw new Error("参照パックの解析結果がありません");
  const structure=validateReferencePackData(data);
  if(!structure.valid)throw new Error(`参照パックを採用できません。${structure.errors.join(" ")}`);
  if(args.validation.packHash!==packHash)throw new Error("参照パックhashがpreviewと一致しません");
  const current=await db.meta.get(EXAM_REFERENCE_PACK_META_KEY);
  let savedRecord:StoredExamReferencePack|null=null;
  if(current){
    try{
      savedRecord=JSON.parse(current.value) as StoredExamReferencePack;
      if(args.origin==="built_in"&&savedRecord.packHash!==packHash){
        const verifiedSupplement=savedRecord.data.pastExamProblems.filter(row=>
          [2016,2017,2018].includes(row.year)&&row.availability==="verified_problem"&&row.schedulable
        );
        // Preserve an explicitly newer/manual record. The built-in update is applied only
        // when the existing v1 record still has the former metadata-only 2016-2018 rows.
        if(verifiedSupplement.length===15)
          return {unchanged:true,status:buildReferencePackStatus(savedRecord)};
      }
    }catch{savedRecord=null}
  }
  const [problems,aliases,attempts,pastSessions]=await Promise.all([
    db.problems.toArray(),db.problemAliases.toArray(),db.attempts.toArray(),db.pastSessions.toArray()
  ]);
  const requiredCoreIds=data.pastExamProblems.filter(reference=>
    reference.availability==="verified_problem"&&reference.schedulable
  ).map(canonicalPastExamProblemId);
  const existingById=new Map(problems.map(problem=>[problem.problem_id,problem]));
  if(savedRecord?.packHash===packHash&&requiredCoreIds.every(problemId=>{
    const problem=existingById.get(problemId);
    return !!problem&&problem.schedulable===true&&problem.past_exam_availability==="verified_problem";
  })){
    return {unchanged:true,status:buildReferencePackStatus(savedRecord)};
  }
  const reconciliation=reconcileExamReferencePack({data,problems,aliases,attempts,pastSessions});
  const linkedData={...data,whitebookLinks:enrichReconciledLinks(data,reconciliation)};
  const now=new Date().toISOString();
  const record:StoredExamReferencePack={
    packHash,importedAt:savedRecord?.importedAt||now,shadowStartedAt:savedRecord?.shadowStartedAt||now,
    plannerMode:savedRecord?.plannerMode||"shadow",
    validation:{...args.validation,valid:true,packHash,errors:[],schemaVersions:structure.schemaVersions},
    reconciliation,data:linkedData
  };
  await db.transaction("rw",[db.meta,db.problems],async()=>{
    const currentProblems=new Map((await db.problems.toArray()).map(problem=>[problem.problem_id,problem]));
    for(const row of reconciliation.pastExamRows){
      const reference=linkedData.pastExamProblems.find(problem=>problem.problem_id===row.referenceProblemId);
      if(!reference||!reference.schedulable)continue;
      const existing=currentProblems.get(row.canonicalProblemId);
      if(row.status==="conflict"&&existing){
        const next={...existing,reference_pack_id:reference.problem_id,reference_pack_hash:packHash,
          reference_status:"provisional" as const,past_exam_availability:reference.availability,
          schedulable:reference.schedulable,gradable:reference.gradable,
          simulation_protection_default:reference.simulation_protection_default};
        await db.problems.put(next);currentProblems.set(next.problem_id,next);
        continue;
      }
      if(!["safe_add","safe_enrich"].includes(row.status))continue;
      const next=referenceProblemToLiveProblem(reference,packHash,existing);
      await db.problems.put(next);currentProblems.set(next.problem_id,next);
    }
    await db.meta.put({key:EXAM_REFERENCE_PACK_META_KEY,value:JSON.stringify(record)});
    await db.meta.put({key:"exam-reference-pack:last-import",value:JSON.stringify({
      packHash,importedAt:now,origin:args.origin,counts:buildReferencePackStatus(record).counts,
      reconciliation:buildReferencePackStatus(record).reconciliation
    })});
  });
  if(args.notify)notifyStudyDataChanged({operation:"import-exam-reference-pack"});
  return {unchanged:false,status:buildReferencePackStatus(record)};
}

async function importExamReferencePack(body:Record<string,unknown>){
  const data=body.data as StoredExamReferencePack["data"]|undefined;
  const packHash=String(body.packHash||"").trim();
  const supplied=(body.validation&&typeof body.validation==="object"?body.validation:{}) as Partial<ReferencePackValidation>;
  if(!data||!packHash)throw new Error("参照パックの解析結果がありません");
  return await installExamReferencePack({
    data,packHash,origin:"manual",notify:true,
    validation:{valid:!!supplied.valid,packHash:String(supplied.packHash||""),errors:supplied.errors||[],
      warnings:supplied.warnings||[],verifiedFiles:supplied.verifiedFiles||[],schemaVersions:supplied.schemaVersions||[]}
  });
}

async function ensureBuiltInExamReferencePack(){
  const structure=validateReferencePackData(BUILT_IN_EXAM_REFERENCE_PACK.data);
  if(!structure.valid)throw new Error(`内蔵参照パックが不正です。${structure.errors.join(" ")}`);
  return await installExamReferencePack({
    data:BUILT_IN_EXAM_REFERENCE_PACK.data,
    packHash:BUILT_IN_EXAM_REFERENCE_PACK.packHash,
    validation:builtInReferencePackValidation(structure.schemaVersions),
    origin:"built_in",notify:false
  });
}

async function bootstrap():Promise<Bootstrap>{
  await initialize();
  await ensureBuiltInCanonical();
  await ensureBuiltInExamReferencePack();
  const [problems,attempts,rawReviews,roadmap,weakNotes,pastSessions,sMemory,metaEntries,answerIndex,answerPdfs,problemAliases]=await Promise.all([
    db.problems.toArray(),db.attempts.orderBy("id").reverse().toArray(),db.reviews.orderBy("due_date").toArray(),db.roadmap.orderBy("order_index").toArray(),
    db.weakNotes.orderBy("id").reverse().toArray(),db.pastSessions.orderBy("id").reverse().toArray(),db.sMemory.toArray(),db.meta.toArray(),
    db.answerIndex.toArray(),db.answerPdfs.toArray(),db.problemAliases.toArray()
  ]);
  const today=todayString(),week=addDays(today,-6),fortnight=addDays(today,-13);
  const pmap=new Map(problems.map(p=>[resolveCanonicalProblemId(p.problem_id,problemAliases),p]));
  const problemForId=(problemId:string)=>pmap.get(resolveCanonicalProblemId(problemId,problemAliases));
  const answerMap=new Map(answerIndex.map(answer=>[answer.problem_id,answer]));
  const pdfNames=new Set(answerPdfs.map(pdf=>pdf.file_name));
  const pdfDocumentKeys=new Set(answerPdfs.map(pdf=>pdf.document_key).filter(Boolean) as string[]);
  const smap=new Map(sMemory.map(memory=>[memory.problem_id,memory]));
  const attemptMap=new Map(attempts.map(attempt=>[attempt.id,attempt]));
  const settings={
    exam_date:metaEntries.find(entry=>entry.key==="exam_date")?.value||"",
    daily_study_minutes:Math.max(30,Number(metaEntries.find(entry=>entry.key==="daily_study_minutes")?.value||150))
  };
  const referenceRecord=storedExamReferencePack(metaEntries);
  const exposureOverrides=jsonMetaValue<Record<string,PastExamExposure>>(metaEntries,EXAM_REFERENCE_EXPOSURE_META_KEY,{});
  let storedRelations:ProblemRelation[]=[];
  try{const value=JSON.parse(metaEntries.find(entry=>entry.key==="problem-relations")?.value||"[]");if(Array.isArray(value))storedRelations=value}catch{storedRelations=[]}
  const baseReviews=rawReviews.map(review=>{
    if(review.review_method) return review;
    const problem=problemForId(review.problem_id);
    const source=attemptMap.get(review.generated_from_attempt_id);
    const linked=problem?[...(problem.related_s_problem_ids||[]),...list(problem.linked_s_problems)]:[];
    const legacyPlan=review.review_type==="s_check"
      ?createSReviewPlan((smap.get(review.problem_id)?.state||"check") as SState)
      :source?createAttemptReviewPlan(source,linked,0):null;
    return legacyPlan?{...review,duration_minutes:legacyPlan.estimated_minutes,reason:legacyPlan.review_reason,...planFields(legacyPlan)}:review;
  });
  const resolvedReviews=baseReviews.map(review=>{
    const originResolution=resolveReviewOrigin({review,attempts,aliases:problemAliases,relations:storedRelations,problems});
    const resolvedReview={...review,origin_verified:originResolution.valid};
    const card=resolveReviewCard({item:resolvedReview,problems,attempts,aliases:problemAliases,today,examDate:settings.exam_date});
    const resolvedDue=correctedDueDate(card);
    const status=["pending","overdue"].includes(review.status)&&resolvedDue<today?"overdue":review.status;
    return {...resolvedReview,problem_id:card.canonicalProblemId,due_date:resolvedDue,status,
      inferred_mode:card.inferredMode,mode_override:card.modeOverride,sheet_name:card.sheetLabel,
      consistency_warnings:card.consistencyWarnings,review_needed:card.reviewNeeded,
      derived_fields:{reviewGoal:card.reviewGoal,correctionTheme:card.correctionTheme,entryHint:card.entryHint,
        oneLineHint:card.oneLineHint,todayActions:card.todayActions,completionConditions:card.completionConditions},
      ...taskFieldsFromContract(card.gradingContract)};
  }).sort((a,b)=>a.due_date.localeCompare(b.due_date)||Number(a.manual_order||0)-Number(b.manual_order||0)||a.id-b.id);
  // Read paths also classify stale evidence so an old pending row cannot become current
  // before the user runs the safe, history-preserving repair.
  const liveReconciliation=analyzeReviewReconciliation({attempts,reviews:rawReviews,aliases:problemAliases,today});
  const staleReviewIds=new Set(liveReconciliation.problems.flatMap(row=>row.reviewsToSupersede.map(item=>item.reviewId)));
  const reviews=resolvedReviews.map(review=>staleReviewIds.has(review.id)?{
    ...review,status:"superseded",exclude_from_planning:true,
    superseded_reason:review.superseded_reason||"最新の答案証拠と現在の採点対象が一致しないため（read-only判定）",
  }:review);
  const activeAttempts=attempts.filter(attempt=>!attempt.exclude_from_planning&&!attempt.exclude_from_metrics&&!attempt.duplicate_of_attempt_id);
  const reviewIsExecutable=(review:Review)=>reviewExecutionState(review,today)==="actionable"&&!staleReviewIds.has(review.id);
  const a14=new Set(activeAttempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="A").map(a=>a.problem_id)).size;
  const skeleton=activeAttempts.filter(a=>a.date>=fortnight&&a.mode==="skeleton");
  const skeletonGood=skeleton.filter(a=>["◎","○"].includes(a.mark)).length;
  const kGroups=new Map<string,number>();
  activeAttempts.filter(a=>a.date>=fortnight&&a.error_type==="K"&&!excludeLegacyKFromPlanning(a)).forEach(a=>kGroups.set(a.problem_id,(kGroups.get(a.problem_id)||0)+1));
  const kRepeat=[...kGroups.values()].filter(n=>n>1).length;
  const pastSkeleton=activeAttempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="past_exam").length;
  const delayed3=reviews.filter(r=>reviewExecutionState(r,today)==="actionable"&&
    r.status==="overdue"&&r.due_date<addDays(today,-3)).length;
  const weakUpdates=weakNotes.filter(w=>w.date>=week).length;
  const scans=pastSessions.filter(s=>["scan_5_questions","scan5"].includes(s.session_type)||!!s.session_kind),exams=pastSessions.filter(s=>["exam_90min","past_exam"].includes(s.session_type)||s.session_kind==="selected_three_timed");
  const studyDays14=new Set([...activeAttempts.filter(a=>a.date>=fortnight).map(a=>a.date),...pastSessions.filter(s=>String(s.date)>=fortnight).map(s=>String(s.date))]).size;
  const standaloneMinutes14=activeAttempts.filter(a=>a.date>=fortnight&&!a.parent_past_session_id).reduce((sum,a)=>sum+Math.max(0,Number(a.time_minutes||0)),0);
  const actualMinutes14=standaloneMinutes14+pastSessions.filter(s=>String(s.date)>=fortnight).reduce((sum,session)=>sum+sessionStudyMinutes(session,activeAttempts),0);
  const sCore14=new Set(activeAttempts.filter(a=>a.date>=fortnight&&["SS","S"].includes(pmap.get(a.problem_id)?.strategy_rank||"")).map(a=>a.problem_id)).size;
  const aPlus14=new Set(activeAttempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.strategy_rank==="A+").map(a=>a.problem_id)).size;
  const criticalS=["WB-6-S-21","WB-6-S-22"].map(problemId=>activeAttempts.find(attempt=>attempt.problem_id===problemId)).filter(Boolean) as Attempt[];
  const past14Attempts=activeAttempts.filter(a=>a.date>=fortnight&&pmap.get(a.problem_id)?.category==="past_exam");
  const progress=buildProgressPlan(daysUntilExam(today,settings.exam_date),{
    a14,sCore14,aPlus14,criticalSStable:criticalS.filter(attempt=>["◎","○"].includes(attempt.mark)).length,criticalSTotal:criticalS.length,
    past14:pastSkeleton,pastFull14:past14Attempts.filter(attempt=>attempt.mode==="full"||attempt.mode==="exam_90min").length,
    pastSkeleton14:past14Attempts.filter(attempt=>attempt.mode==="skeleton").length,scan14:scans.filter(s=>String(s.date)>=fortnight).length,
    exam14:exams.filter(s=>String(s.date)>=fortnight).length,kRepeat,
    skeletonCount:skeleton.length,skeletonRate:skeleton.length?Math.round(skeletonGood/skeleton.length*100):0,
    studyDays14,actualMinutes14,delayed3,dailyTargetMinutes:settings.daily_study_minutes
  });
  const pastExamCatalog=buildPastExamCatalog({record:referenceRecord,sessions:pastSessions,exposureOverrides});
  const availablePastYearOrder=orderCorePastExamYears({
    catalog:pastExamCatalog,daysRemaining:progress.daysRemaining
  });
  const orderedPastProblemIds=availablePastYearOrder.flatMap(year=>
    pastExamCatalog.filter(row=>row.year===year)
      .sort((a,b)=>a.questionNumber-b.questionNumber)
      .map(row=>row.canonicalProblemId)
  );
  const checks=progress.checks.map(item=>item.status==="ok");
  const pastAttempts=activeAttempts.filter(attempt=>pmap.get(attempt.problem_id)?.category==="past_exam");
  const chapterCounts=new Map<number,number>();
  activeAttempts.filter(a=>a.date>=fortnight&&a.error_type==="K"&&!excludeLegacyKFromPlanning(a)).forEach(a=>{const c=pmap.get(a.problem_id)?.chapter;if(c!=null)chapterCounts.set(c,(chapterCounts.get(c)||0)+1)});
  const themeCounts=new Map<string,number>();
  weakNotes.filter(w=>!w.is_resolved).forEach(w=>themeCounts.set(w.theme,(themeCounts.get(w.theme)||0)+1));
  const weaknessAnalysis=analyzeWeaknesses(problems,activeAttempts,reviews,weakNotes,today);
  const readiness=calculateExamReadinessMetrics({problems,attempts:activeAttempts,pastSessions,aliases:problemAliases,today});
  const weeklyQuota=weeklySoftQuota({attempts:activeAttempts as unknown as Array<Record<string,unknown>>,
    pastSessions:pastSessions as unknown as Array<Record<string,unknown>>,weekStart:week});
  const weeklyQuotaCandidates=quotaCandidatesWithinCapacity({status:weeklyQuota,remainingMinutes:settings.daily_study_minutes,daysRemaining:progress.daysRemaining});
  const stableBlockingIssues=[
    ...(diagnosticsPreview(problems,attempts,reviews,problemAliases).criticalCount?["問題ID・表示名の重大不一致が残っています。"]:[]),
    ...(!readiness.sampleSizes.unseen?["未見・長期未実施問題の得点記録がまだありません。"]:[]),
    ...(!readiness.sampleSizes.timed?["時間制限付きfull/過去問の記録がまだありません。"]:[]),
    ...(!scans.length?["5問スキャンの記録がまだありません。"]:[]),
  ];
  const stableRelease={
    isStable:stableBlockingIssues.length===0,
    blockingIssues:stableBlockingIssues,
    message:stableBlockingIssues.length===0
      ?"現在は学習運用安定版です。新機能追加より、A問題・過去問・本番演習を優先してください。"
      :"学習運用安定版までの残タスクがあります。新機能追加より、記録と診断の不足を先に埋めてください。"
  };
  const reviewPortfolio=summarizeReviewPortfolio({reviews,attempts:activeAttempts,aliases:problemAliases,today});
  const dashboard={
    today,weekA:new Set(activeAttempts.filter(a=>a.date>=week&&pmap.get(a.problem_id)?.category==="A").map(a=>a.problem_id)).size,
    weekPast:pastAttempts.filter(attempt=>attempt.date>=week).length,kRecurrence:kRepeat,
    pending:reviews.filter(reviewIsExecutable).length,
    overdue:reviews.filter(r=>reviewIsExecutable(r)&&r.status==="overdue").length,
    sStableRate:sMemory.length?Math.round(sMemory.filter(s=>s.state==="stable").length/sMemory.length*100):0,
    sForgotten:sMemory.filter(s=>["forgotten","collapsed","check"].includes(s.state)).length,
    scanSuccess:scans.length?Math.round(scans.filter(s=>s.selection_result==="good").length/scans.length*100):0,
    examSuccess:exams.length?Math.round(exams.filter(s=>Number(s.completed_questions_count)>=3).length/exams.length*100):0,
    dangerChapters:[...chapterCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([chapter,count])=>({chapter,count})),
    nextTheme:[...themeCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||"ロードマップ先頭のA問題",
    analysisConfidence:weaknessAnalysis.confidence,analysisAttemptCount:weaknessAnalysis.attemptCount,
    weaknessInsights:weaknessAnalysis.insights,
    readiness,stableRelease,reviewPortfolio,weeklyQuota:{...weeklyQuota,candidates:weeklyQuotaCandidates},
    pace:{label:progress.label,checks,items:progress.checks,a14,pastSkeleton,kRepeat,
      skeletonRate:skeleton.length?Math.round(skeletonGood/skeleton.length*100):0,weakUpdates,delayed3,
      suggestion:progress.suggestion,phase:progress.phase,phaseLabel:progress.phaseLabel,summary:progress.summary,
      allocation:progress.allocation,nextPhase:progress.nextPhase,dangerCriteria:progress.dangerCriteria,
      daysRemaining:progress.daysRemaining,examDateIsEstimate:!settings.exam_date}
  };
  const dueReviews=reviews.filter(r=>["pending","overdue"].includes(r.status)&&r.due_date<=today&&reviewIsExecutable(r)).map(r=>{
    const p=problemForId(r.problem_id)!;const originSource=attempts.find(a=>a.id===r.generated_from_attempt_id);
    const ownSource=attempts.find(attempt=>resolveCanonicalProblemId(attempt.problem_id,problemAliases)===resolveCanonicalProblemId(r.problem_id,problemAliases)&&p&&attemptMatchesProblem(attempt,p));
    const linkedS=r.task_origin==="linked_s_check"||r.review_type==="s_check";
    const source=linkedS?ownSource:originSource,answer=answerMap.get(r.problem_id);
    const card=resolveReviewCard({item:r,problems,attempts,aliases:problemAliases,today,examDate:settings.exam_date});
    const reviewMode=card.effectiveMode;
    return {...r,task_origin:linkedS?"linked_s_check":r.task_origin||(source?"review_attempt":"first_attempt"),
      source_problem_id:linkedS?(r.source_problem_id||originSource?.problem_id):r.source_problem_id,
      attempt_exists:!!source,review_goal_public:linkedS?"元問題で崩れた基礎型を確認する":r.review_goal_public,
      source_error_summary:linkedS?originSource?.error_point:"",
      error_type:card.prescription.effectiveErrorTypes[0]||"none",
      previous_date:source?.date,previous_score:source?`${source.score_text||source.score_label}${source.score_numeric!=null?` ${source.score_numeric}点`:""}`:"",
      previous_errors:source?.error_types||[source?.error_type||"none"],previous_error_point:source?.error_point||"",previous_next_action:source?.next_action||"",
      previous_improvement_guidance:source?.improvement_guidance||"",previous_required_derivation:source?.required_derivation||"",
      previous_corrected_answer:source?.corrected_answer||"",
      has_saved_gpt_feedback:!!(source?.improvement_guidance||source?.required_derivation||source?.corrected_answer||source?.result_summary),
      official_answer_text:answer?.answer_available&&answer.answer_excerpt?answer.answer_excerpt:p?.official_answer||"",
      official_answer_url:p?.official_answer_url||"",official_answer_pdf_name:answer?.pdf_file_name||"",
      official_answer_pdf_registered:!!answer&&(!!answer.document_key&&pdfDocumentKeys.has(answer.document_key)||!!answer.pdf_file_name&&pdfNames.has(answer.pdf_file_name)),
      answer_section_label:answer?.section_label||"",official_answer_page:answer?.open_page??answer?.page_start??null,
      answer_page_start:answer?.page_start,answer_page_end:answer?.page_end,answer_document_key:answer?.document_key,
      canonical_keywords:[...(p?.canonical_keywords||[]),...(answer?.canonical_keywords||[])],
      answer_excerpt:answer?.answer_excerpt||"",
      kind:r.review_type==="s_check"?"S確認":r.generated_from_past_session_id?"過去問復習":"復習",reason:r.status==="overdue"?`期限切れ（${r.due_date}）`:"本日が復習日",
      title:card.displayLabel,theme:card.theme,canonical_problem_type:card.canonicalProblemType,
      consistency_warnings:card.consistencyWarnings,review_needed:card.reviewNeeded,
      ...taskFieldsFromContract(card.gradingContract),load:loadFor(reviewMode)};
  }).sort((a,b)=>(a.status==="overdue"&&a.error_type==="K"?0:1)-(b.status==="overdue"&&b.error_type==="K"?0:1)||
    Number(a.manual_order||0)-Number(b.manual_order||0));
  const activeS=new Set(reviews.filter(r=>r.review_type==="s_check"&&reviewIsExecutable(r)).map(r=>r.problem_id));
  const staleS=sMemory.filter(s=>!activeS.has(s.problem_id)&&(s.state==="forgotten"||s.state==="collapsed"||!!s.last_touched&&s.last_touched<=addDays(today,-30))).map(s=>{
    const p=pmap.get(s.problem_id)!,answer=answerMap.get(s.problem_id),sPlan=createSReviewPlan(s.state);return {problem_id:s.problem_id,title:p.display_label||p.title,theme:p.theme,
      canonical_problem_type:p.canonical_problem_type||p.theme,canonical_keywords:[...(p.canonical_keywords||[]),...(answer?.canonical_keywords||[])],
      answer_excerpt:answer?.answer_excerpt||"",kind:"S点検",reason:s.state==="forgotten"||s.state==="collapsed"?"忘却状態から復旧":"30日以上未確認",mode:sPlan.mode,minutes:sPlan.estimated_minutes||5,load:s.state==="collapsed"?.4:.2,...planFields(sPlan)};
  });
  let load=[...dueReviews,...staleS].reduce((sum,x)=>sum+x.load,0);
  let plannedMinutes=[...dueReviews,...staleS].reduce((sum,x)=>sum+x.minutes,0);
  const seen=new Set(activeAttempts.map(a=>a.problem_id));
  const occupied=new Set([
    ...reviews.filter(reviewIsExecutable).map(review=>review.problem_id),
    ...dueReviews.map(task=>task.problem_id),...staleS.map(task=>task.problem_id)
  ]);
  const strategySTasks:any[]=[];
  const sLimit=progress.phase==="foundation"?4:progress.phase==="integration"?3:2;
  for(const problemId of STRATEGY_S_ORDER){
    if(strategySTasks.length>=sLimit||plannedMinutes>=settings.daily_study_minutes*.55) break;
    const problem=pmap.get(problemId);
    const latest=activeAttempts.find(attempt=>attempt.problem_id===problemId);
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
    ?selectMixedPractice(problems,activeAttempts,occupied,today):undefined;
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
    for(const problemId of orderedPastProblemIds){
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
    const year=availablePastYearOrder[completedSimulations%availablePastYearOrder.length];
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
  const plannerMode=metaEntries.find(entry=>entry.key===PLANNER_RUNTIME_MODE_META_KEY)?.value==="legacy"
    ?"legacy" as const:"adaptive" as const;
  const conceptWeaknesses=analyzeConceptWeaknesses({record:referenceRecord,problems,attempts:activeAttempts,
    reviews,weakNotes,today});
  const plannerShadow=buildAdaptivePlannerShadow({record:referenceRecord,catalog:pastExamCatalog,
    weaknesses:conceptWeaknesses,problems,attempts:activeAttempts,reviews,pastSessions,
    currentTasks:plannerMode==="legacy"?baseTasks:[],today,examDate:settings.exam_date,
    targetMinutes:settings.daily_study_minutes});
  const adaptiveTodayTasks=adaptivePlanDayToTasks({
    day:plannerShadow.plan14.plan.find(day=>day.date===today),problems,reviews,today
  });
  // The legacy triage path remains available for rollback and developer comparison,
  // but normal daily generation uses only the adaptive planner.
  const generatedTriage=plannerMode==="legacy"
    ?triageTodayTasks(baseTasks,settings.daily_study_minutes,problems,today)
    :{tasks:adaptiveTodayTasks};
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
      tasks:snapshotTasks,created_at:new Date().toISOString(),
      planner_source:plannerMode,planner_version:plannerMode==="adaptive"?ADAPTIVE_PLANNER_VERSION:"legacy-v1"
    };
    await db.meta.put({key:snapshotKey,value:JSON.stringify(snapshot)});
  }
  const generatedMap=new Map(generatedTriage.tasks.map(task=>[taskSnapshotId(task),task]));
  const reviewMap=new Map(reviews.map(review=>[review.id,review]));
  const currentReviewForSaved=(saved:Task)=>{
    if(!saved.id||!saved.review_type)return undefined;
    const stored=reviewMap.get(saved.id);
    if(stored&&reviewIsExecutable(stored)&&stored.due_date<=today)return stored;
    const canonical=resolveCanonicalProblemId(saved.problem_id,problemAliases);
    const savedPurpose=stored?.grading_contract?.learningPurpose||saved.grading_contract?.learningPurpose||saved.learning_purpose;
    const candidates=reviews.filter(review=>reviewIsExecutable(review)&&review.due_date<=today&&
      resolveCanonicalProblemId(review.problem_id,problemAliases)===canonical);
    return candidates.sort((left,right)=>{
      const leftPurpose=left.grading_contract?.learningPurpose||left.learning_purpose;
      const rightPurpose=right.grading_contract?.learningPurpose||right.learning_purpose;
      return Number(rightPurpose===savedPurpose)-Number(leftPurpose===savedPurpose)||
        right.due_date.localeCompare(left.due_date)||right.id-left.id;
    })[0];
  };
  const todayAttemptProblems=new Set(activeAttempts.filter(attempt=>attempt.date===today).map(attempt=>attempt.problem_id));
  const tasks=snapshot.tasks.filter(saved=>{
    if(saved.id&&saved.review_type){
      const currentReview=currentReviewForSaved(saved);
      if(!currentReview)return false;
      // If the replacement already owns another saved slot, do not show/count it twice.
      return currentReview.id===saved.id||!snapshot!.tasks.some(other=>other.id===currentReview.id);
    }
    const record=taskPostponements.get(`${saved.problem_id}:${saved.kind}`);
    if(!record) return true;
    const destination=String(record.postponed_to||"");
    return destination!=="unscheduled"&&destination<=today;
  }).map(saved=>{
    const key=taskSnapshotId(saved),current=generatedMap.get(key),review=currentReviewForSaved(saved);
    const record=!saved.id?taskPostponements.get(`${saved.problem_id}:${saved.kind}`):undefined;
    const answer=answerMap.get(saved.problem_id);
    const forcedMust=review?.triage_override==="must"||record?.triage_override==="must";
    const contract=review?.grading_contract||saved.grading_contract||current?.grading_contract;
    const contractFields=contract?taskFieldsFromContract(contract):{};
    return {...current,...saved,...(review||{}),...contractFields,
      kind:saved.kind,reason:review&&review.id!==saved.id?"最新の復習状態へ同期":saved.reason,
      title:pmap.get(saved.problem_id)?.display_label||pmap.get(saved.problem_id)?.title||saved.title,
      theme:pmap.get(saved.problem_id)?.theme||saved.theme,
      canonical_problem_type:pmap.get(saved.problem_id)?.canonical_problem_type||saved.canonical_problem_type,
      canonical_keywords:[...(pmap.get(saved.problem_id)?.canonical_keywords||[]),...(answer?.canonical_keywords||saved.canonical_keywords||[])],
      answer_excerpt:answer?.answer_excerpt||saved.answer_excerpt,
      official_answer_text:answer?.answer_excerpt||saved.official_answer_text,
      official_answer_pdf_name:answer?.pdf_file_name||saved.official_answer_pdf_name,
      official_answer_pdf_registered:!!answer&&(!!answer.document_key&&pdfDocumentKeys.has(answer.document_key)||!!answer.pdf_file_name&&pdfNames.has(answer.pdf_file_name)),
      answer_section_label:answer?.section_label||saved.answer_section_label,
      official_answer_page:answer?.open_page??answer?.page_start??saved.official_answer_page,
      answer_page_start:answer?.page_start,
      answer_page_end:answer?.page_end,
      answer_document_key:answer?.document_key,
      // Snapshot selection/order/triage/minutes stay fixed. Current Review content is a read-only overlay.
      minutes:Number(snapshot!.initial_estimated_minutes[key]??saved.minutes),
      triage:forcedMust?"must":snapshot!.initial_bucket[key]||saved.triage||"tomorrow",
      checked:checkedKeys.has(`today-check:${today}:${saved.problem_id}:${saved.kind}`)||todayAttemptProblems.has(saved.problem_id)
    } as Task;
  });
  const totalLoad=Math.round(tasks.filter(task=>!task.checked&&task.triage!=="tomorrow").reduce((sum,x)=>sum+x.load,0)*10)/10;
  const actualMinutes=activeAttempts.filter(attempt=>attempt.date===today&&!attempt.parent_past_session_id).reduce((sum,attempt)=>sum+Math.max(0,Number(attempt.time_minutes||0)),0)
    +pastSessions.filter(session=>String(session.date)===today).reduce((sum,session)=>sum+sessionStudyMinutes(session,activeAttempts),0);
  const timeSummary=summarizeTodayTime(tasks,actualMinutes,settings.daily_study_minutes,snapshot.start_of_day_planned_minutes);
  const activeRemainingMinutes=timeSummary.activeRemainingMinutes;
  const postponeCandidateMinutes=timeSummary.postponeCandidateMinutes;
  const remainingMinutes=activeRemainingMinutes;
  const postponedReviewMinutes=reviews.filter(review=>review.postponed_at?.startsWith(today)&&review.postponed_to!==today)
    .reduce((sum,review)=>sum+Number(review.estimated_minutes||review.duration_minutes||0),0);
  const postponedTaskMinutes=[...taskPostponements.values()].filter(record=>String(record.postponed_at||"").startsWith(today)&&String(record.postponed_to||"")!==today)
    .reduce((sum,record)=>sum+Number(record.estimated_minutes||0),0);
  const postponedMinutes=postponedReviewMinutes+postponedTaskMinutes;
  const completedTasks=activeAttempts.filter(attempt=>attempt.date===today).map(attempt=>({
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
  const pdfDocuments=answerPdfs.map(pdf=>({
    document_key:pdf.document_key||pdf.file_name,kind:pdf.kind,source_book:pdf.source_book,
    original_file_name:pdf.original_file_name||pdf.file_name,display_name:pdf.display_name||pdf.original_file_name||pdf.file_name,
    page_count:pdf.page_count,sha256:pdf.sha256,registered_at:pdf.registered_at||pdf.uploaded_at,file_name:pdf.file_name,
    answer_count:answerIndex.filter(answer=>answer.document_key&&pdf.document_key?answer.document_key===pdf.document_key:answer.pdf_file_name===pdf.original_file_name||answer.pdf_file_name===pdf.file_name).length
  }));
  const databaseStatus=await databaseSchemaStatus();
  const validCrossTargetReviewIds=rawReviews.filter(review=>{
    const source=attemptMap.get(review.source_attempt_id||review.generated_from_attempt_id);
    return !!source&&resolveCanonicalProblemId(source.problem_id,problemAliases)!==resolveCanonicalProblemId(review.problem_id,problemAliases)&&
      resolveReviewOrigin({review,attempts,aliases:problemAliases,relations:storedRelations,problems}).valid;
  }).map(review=>review.id);
  const integrityHealth=runIntegrityAudit({
    attempts,reviews:rawReviews,aliases:problemAliases,today,todayPlanSnapshots:[snapshot],validCrossTargetReviewIds
  });
  const masterStatus={
    problem_count:problems.length,answer_count:answerIndex.length,
    problem_version:metaEntries.find(entry=>entry.key==="problem_master_version")?.value||"未設定",
    answer_version:metaEntries.find(entry=>entry.key==="answer_index_version")?.value||"未設定",
    problem_updated_at:metaEntries.find(entry=>entry.key==="problem_master_updated_at")?.value||"",
    answer_updated_at:metaEntries.find(entry=>entry.key==="answer_index_updated_at")?.value||"",
    alias_updated_at:metaEntries.find(entry=>entry.key==="problem_alias_updated_at")?.value||"",
    alias_version:metaEntries.find(entry=>entry.key==="problem_alias_version")?.value||"未設定",
    alias_count:problemAliases.length,
    pdf_files:[...new Set([...pdfNames,...pdfDocumentKeys])],pdf_documents:pdfDocuments,diagnostics,import_history:importHistory,
    review_rebuild_summary:(()=>{try{return JSON.parse(metaEntries.find(entry=>entry.key==="review_card_rebuild_summary")?.value||"null")||undefined}catch{return undefined}})()
    ,legacy_k_summary:(()=>{try{return JSON.parse(metaEntries.find(entry=>entry.key==="legacy_k_reorganization_summary")?.value||"null")||undefined}catch{return undefined}})()
    ,source_mismatch_summary:(()=>{try{return JSON.parse(metaEntries.find(entry=>entry.key==="source_mismatch_reorganization_summary")?.value||"null")||undefined}catch{return undefined}})()
    ,review_schedule_summary:(()=>{try{return JSON.parse(metaEntries.find(entry=>entry.key==="review_schedule_repair_summary")?.value||"null")||undefined}catch{return undefined}})()
    ,integrity_summary:{
      generatedAt:integrityHealth.generatedAt,activeIssueCount:integrityHealth.activeIssueCount,
      historyWarningCount:integrityHealth.historyWarningCount,counts:integrityHealth.counts,
      ...(()=>{try{const saved=JSON.parse(metaEntries.find(entry=>entry.key==="integrity_audit_summary")?.value||"null");return saved?.repairedAt?{repairedAt:saved.repairedAt}:{}}
        catch{return {}}})()
    }
  };
  const pastExamRepairCandidates=buildPastExamRepairCandidates({record:referenceRecord,sessions:pastSessions,
    attempts:activeAttempts,conceptWeaknesses});
  const additionalStudy=buildAdditionalStudyCandidates({
    today,targetMinutes:settings.daily_study_minutes,completedMinutes:actualMinutes,
    activeRemainingMinutes,currentTasks:tasks,shadow:plannerShadow
  });
  const adaptiveLearning={referencePack:buildReferencePackStatus(referenceRecord),pastExamCatalog,
    conceptWeaknesses,pastExamRepairCandidates,plannerShadow,plannerMode,weaknessModel:"concept_evidence_v1" as const};
  return {problems:problems.sort((a,b)=>(a.chapter||99)-(b.chapter||99)||a.category.localeCompare(b.category)||a.problem_number-b.problem_number),attempts,reviews,roadmap,weakNotes,pastSessions,answerIndex,problemAliases,dashboard,settings,masterStatus,databaseStatus,adaptiveLearning,
    today:{tasks,totalLoad,plannedMinutes:plannedTotal,remainingMinutes,actualMinutes,targetMinutes:settings.daily_study_minutes,capacityPercent,warning,guidance,
      planned_minutes_total:plannedTotal,completed_minutes_today:actualMinutes,remaining_minutes_today:remainingMinutes,
      postponed_minutes_today:postponedMinutes,target_minutes_today:settings.daily_study_minutes,
      start_of_day_planned_minutes:snapshot.start_of_day_planned_minutes,active_remaining_minutes:activeRemainingMinutes,
      postpone_candidate_minutes:postponeCandidateMinutes,active_total_if_done:activeTotalIfDone,
      confirmed_plan_minutes:timeSummary.confirmedPlanMinutes,
      confirmed_remaining_minutes:timeSummary.activeRemainingMinutes,
      target_remaining_minutes:timeSummary.targetRemainingMinutes,
      additional_capacity_minutes:timeSummary.additionalCapacityMinutes,
      planner_source:snapshot.planner_source||"legacy",
      remaining_learning_capacity_minutes:additionalStudy.capacity,
      additionalCandidates:additionalStudy.candidates,
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

async function savePastExamSession(body:Record<string,unknown>,existingId?:number){
  return await db.transaction("rw",[db.pastSessions,db.reviews,db.meta,db.problems,db.attempts,db.problemAliases,db.answerIndex,db.weakNotes,db.sMemory],async()=>{
    const previous=existingId?await db.pastSessions.get(existingId):undefined;
    if(existingId&&!previous)throw new Error("過去問セッションが見つかりません");
    const normalized=normalizePastExamSession({...previous,...body,id:existingId||0}),validation=validatePastExamSession(normalized);
    if(!validation.valid)throw new Error(validation.errors.join(" "));
    const now=new Date().toISOString(),hasSolved=validation.solvedQuestions.length>0;
    const session={...previous,...normalized,exam_score_eligible:validation.examScoreEligible,
      prompt_scanned_at:previous?.prompt_scanned_at||normalized.prompt_scanned_at||(normalized.session_kind!=="retrospective_review"?now:undefined),
      attempt_started_at:hasSolved?(previous?.attempt_started_at||now):previous?.attempt_started_at,
      attempt_completed_at:hasSolved?now:previous?.attempt_completed_at,
      answer_viewed_at:previous?.answer_viewed_at||normalized.answer_viewed_at||(normalized.answer_exposure?now:undefined),
      simulation_completed_at:normalized.session_kind==="selected_three_timed"&&validation.solvedQuestions.length===3?now:previous?.simulation_completed_at};
    const sessionId=existingId||Number(await db.pastSessions.add({...session,id:undefined as unknown as number} as PastSession));
    if(existingId)await db.pastSessions.put({...session,id:sessionId} as PastSession);
    const allowedSolved=new Set(validation.solvedQuestions.map(row=>row.problemId).filter(Boolean));
    const attemptUpdates=(Array.isArray(body.attempt_updates)?body.attempt_updates:[]) as Array<StudyUpdate&Record<string,unknown>>;
    const aliases=await db.problemAliases.toArray(),linkedIds=[...(previous?.linked_attempt_ids||[])];
    for(const update of attemptUpdates){
      if(!allowedSolved.has(update.problem_id))throw new Error(`解いていない問題 ${update.problem_id} はAttemptとして保存できません`);
      const target=resolveCanonicalProblemId(update.problem_id,aliases);
      const existingAttempt=(await db.attempts.toArray()).find(row=>row.parent_past_session_id===sessionId&&resolveCanonicalProblemId(row.problem_id,aliases)===target);
      const attemptId=existingAttempt?.id||await saveAttempt({...update,parent_past_session_id:sessionId,date:update.date||normalized.date});
      if(!linkedIds.includes(attemptId))linkedIds.push(attemptId);
    }
    if(linkedIds.length)await db.pastSessions.update(sessionId,{linked_attempt_ids:linkedIds});
    return {sessionId,examScoreEligible:validation.examScoreEligible,warnings:validation.warnings};
  });
}

async function currentTodaySnapshots(){
  const rows=await db.meta.filter(row=>row.key.startsWith("today-plan-snapshot:")&&!row.key.startsWith("today-plan-snapshot-history:")).toArray();
  return rows.flatMap(row=>{try{return [JSON.parse(row.value) as TodayPlanSnapshot]}catch{return []}});
}

async function replaceTodayWithAdaptivePlan(preview:boolean){
  const today=todayString(),key=`today-plan-snapshot:${today}`;
  const row=await db.meta.get(key);
  if(!row?.value)throw new Error("今日の計画が見つかりません");
  const snapshot=JSON.parse(row.value) as TodayPlanSnapshot;
  const current=await bootstrap();
  const proposed=adaptivePlanDayToTasks({
    day:current.adaptiveLearning.plannerShadow.plan14.plan.find(day=>day.date===today),
    problems:current.problems,reviews:current.reviews,today
  });
  const retained=snapshot.tasks.filter(task=>task.checked||task.triage==="tomorrow"||
    task.plan_origin==="adaptive_additional");
  const logical=(task:Task)=>task.id?`review:${task.id}`:
    `${task.problem_id}|${task.learning_purpose||task.purpose_label||task.kind}|${task.mode}`;
  const occupied=new Set(retained.map(logical));
  const added=proposed.filter(task=>!occupied.has(logical(task)));
  const nextTasks=[...retained,...added];
  const removed=snapshot.tasks.filter(task=>!retained.includes(task)&&!added.some(row=>logical(row)===logical(task)));
  const summary={
    preview,retained:retained.length,added:added.length,removed:removed.length,
    beforeMinutes:snapshot.tasks.filter(task=>task.triage!=="tomorrow").reduce((sum,task)=>sum+task.minutes,0),
    afterMinutes:nextTasks.filter(task=>task.triage!=="tomorrow").reduce((sum,task)=>sum+task.minutes,0),
    retainedTaskIds:retained.map(taskSnapshotId),addedTaskIds:added.map(taskSnapshotId),removedTaskIds:removed.map(taskSnapshotId)
  };
  if(preview)return summary;
  const next:TodayPlanSnapshot={...snapshot,tasks:nextTasks,task_ids:nextTasks.map(taskSnapshotId),
    initial_bucket:Object.fromEntries(nextTasks.map(task=>[taskSnapshotId(task),task.triage||"tomorrow"])),
    initial_estimated_minutes:Object.fromEntries(nextTasks.map(task=>[taskSnapshotId(task),task.minutes])),
    start_of_day_planned_minutes:nextTasks.filter(task=>task.triage!=="tomorrow").reduce((sum,task)=>sum+task.minutes,0),
    created_at:new Date().toISOString(),planner_source:"adaptive",planner_version:ADAPTIVE_PLANNER_VERSION,
    activated_at:new Date().toISOString()};
  await db.transaction("rw",db.meta,async()=>{
    await db.meta.put({key:`today-plan-snapshot-history:${today}:${Date.now()}`,value:row.value});
    await db.meta.put({key,value:JSON.stringify(next)});
    await db.meta.put({key:PLANNER_RUNTIME_MODE_META_KEY,value:"adaptive"});
  });
  notifyStudyDataChanged({operation:"activate-adaptive-plan"});
  return {...summary,preview:false};
}

async function integrityAudit():Promise<IntegrityAudit>{
  const [attempts,reviews,aliases,snapshots,problems,relations]=await Promise.all([
    db.attempts.toArray(),db.reviews.toArray(),db.problemAliases.toArray(),currentTodaySnapshots(),
    db.problems.toArray(),storedProblemRelations()
  ]);
  const validCrossTargetReviewIds=reviews.filter(review=>{
    const source=attempts.find(row=>row.id===Number(review.source_attempt_id||review.generated_from_attempt_id));
    return !!source&&resolveCanonicalProblemId(source.problem_id,aliases)!==resolveCanonicalProblemId(review.problem_id,aliases)&&
      resolveReviewOrigin({review,attempts,aliases,relations,problems}).valid;
  }).map(review=>review.id);
  return runIntegrityAudit({attempts,reviews,aliases,today:todayString(),todayPlanSnapshots:snapshots,validCrossTargetReviewIds});
}

async function repairIntegrity(preview=false){
  const before=await integrityAudit();
  const reconciliationPreview=await reconcileProblemLearningState(undefined,true);
  if(preview)return {preview:true,before,after:before,reconciliation:reconciliationPreview.audit,details:reconciliationPreview.details,changes:{
    duplicateAttempts:before.counts.exact_duplicate_attempt,
    reviewsSuperseded:before.counts.inactive_pending+before.counts.expired_same_session+
      before.counts.duplicate_logical_review+before.counts.repeated_deduplication_key,
    contractsRebound:before.counts.duplicate_contract_id+before.counts.contract_top_level_mismatch,
    datesCorrected:before.counts.date_interval_mismatch,
    staleReviewsSuperseded:reconciliationPreview.reviewsSuperseded,
    reviewsReplaced:reconciliationPreview.reviewsReplaced,
    todayActionsUpdated:reconciliationPreview.todayActionsUpdated,
    ambiguousProblems:reconciliationPreview.ambiguousProblems,
  }};
  const now=new Date().toISOString(),today=todayString();
  const changes={duplicateAttempts:0,reviewsSuperseded:0,contractsRebound:0,datesCorrected:0,
    staleReviewsSuperseded:0,reviewsReplaced:0,todayActionsUpdated:0,ambiguousProblems:0};
  await db.transaction("rw",[db.attempts,db.reviews,db.problemAliases,db.problems,db.meta],async()=>{
    const [attempts,reviews,aliases,problems,relations]=await Promise.all([
      db.attempts.toArray(),db.reviews.toArray(),db.problemAliases.toArray(),db.problems.toArray(),storedProblemRelations()
    ]);
    const attemptMap=new Map(attempts.map(row=>[row.id,row]));
    for(const duplicate of classifyExactDuplicateAttempts(attempts)){
      const row=attemptMap.get(duplicate.duplicateAttemptId);
      if(!row||row.duplicate_of_attempt_id===duplicate.canonicalAttemptId)continue;
      await db.attempts.update(row.id,{
        canonical_attempt_id:duplicate.canonicalAttemptId,duplicate_of_attempt_id:duplicate.canonicalAttemptId,
        exclude_from_planning:true,exclude_from_metrics:true,
        duplicate_reason:`Attempt ${duplicate.canonicalAttemptId} とID以外の保存内容が完全一致`,
      });
      changes.duplicateAttempts++;
      for(const review of reviews.filter(item=>ACTIVE_REVIEW_STATUSES.has(item.status)&&
        Number(item.source_attempt_id||item.generated_from_attempt_id)===row.id)){
        await db.reviews.update(review.id,{
          status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
          superseded_reason:`重複Attempt ${row.id} 由来のため。canonical Attemptは${duplicate.canonicalAttemptId}`,
        });
        changes.reviewsSuperseded++;
      }
    }

    const refreshed=await db.reviews.toArray(),active=refreshed.filter(row=>ACTIVE_REVIEW_STATUSES.has(row.status));
    for(const review of active){
      const source=attemptMap.get(review.source_attempt_id||review.generated_from_attempt_id);
      const state=reviewExecutionState(review,today);
      if(state==="expired_same_session"||state==="invalid"){
        await db.reviews.update(review.id,{
          status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
          superseded_reason:state==="expired_same_session"?"same_session_correctionの有効日を過ぎたため":"現行ポリシーで実行不可のため",
        });
        changes.reviewsSuperseded++;
        continue;
      }
      const purpose=review.grading_contract?.learningPurpose||review.learning_purpose;
      const reviewParts=new Set(review.grading_contract?.gradedParts.map(part=>part.id)||review.graded_part_ids||[]);
      const newerSuccess=source&&["error_repair","retrieval_check"].includes(String(purpose||""))&&reviewParts.size
        ?attempts.find(attempt=>attempt.id>source.id&&
          resolveCanonicalProblemId(attempt.problem_id,aliases)===resolveCanonicalProblemId(review.problem_id,aliases)&&
          (attempt.minimum_pass_condition_met===true||attempt.target_issue_resolved===true||
            (attempt.error_types||[]).every(error=>error==="none"))&&
          [...reviewParts].every(part=>(attempt.graded_part_ids||[]).includes(part))):undefined;
      if(newerSuccess){
        await db.reviews.update(review.id,{status:"superseded",exclude_from_planning:true,
          exclude_from_recurrence_metrics:true,
          superseded_reason:`新しいAttempt ${newerSuccess.id}で同一採点対象を解消済み`});
        changes.reviewsSuperseded++;
        continue;
      }
      const originResolution=resolveReviewOrigin({review,attempts,aliases,relations,problems});
      if(source&&resolveCanonicalProblemId(source.problem_id,aliases)!==resolveCanonicalProblemId(review.problem_id,aliases)&&!originResolution.valid){
        await db.reviews.update(review.id,{
          status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
          superseded_reason:"verified relationのないsource/target不一致のため",
        });
        changes.reviewsSuperseded++;
      }else if(source&&originResolution.valid&&originResolution.origin==="verified_linked_problem"){
        await db.reviews.update(review.id,{origin:"verified_linked_problem",origin_verified:true,
          relation_id:originResolution.relation?.relationId||review.relation_id});
      }
    }

    const afterTerminal=await db.reviews.toArray(),stillActive=afterTerminal.filter(row=>ACTIVE_REVIEW_STATUSES.has(row.status));
    const groups=new Map<string,Review[]>();
    for(const review of stillActive){
      const source=attemptMap.get(review.source_attempt_id||review.generated_from_attempt_id);
      const key=review.logical_review_key||logicalReviewKey({review,aliases,sourceAttempt:source});
      groups.set(key,[...(groups.get(key)||[]),review]);
    }
    for(const [key,rows] of groups){
      const ordered=[...rows].sort((a,b)=>{
        const sa=attemptMap.get(a.source_attempt_id||a.generated_from_attempt_id);
        const sb=attemptMap.get(b.source_attempt_id||b.generated_from_attempt_id);
        return String(sb?.date||"").localeCompare(String(sa?.date||""))||
          Number(sb?.id||0)-Number(sa?.id||0)||b.id-a.id;
      });
      const keep=ordered[0];
      await db.reviews.update(keep.id,{logical_review_key:key});
      for(const duplicate of ordered.slice(1)){
        await db.reviews.update(duplicate.id,{
          status:"superseded",exclude_from_planning:true,exclude_from_recurrence_metrics:true,
          replaced_by_review_id:keep.id,superseded_reason:`active logicalReviewKeyがReview ${keep.id}と重複`,
        });
        changes.reviewsSuperseded++;
      }
    }
    const dedupGroups=new Map<string,Review[]>();
    for(const review of (await db.reviews.toArray()).filter(row=>ACTIVE_REVIEW_STATUSES.has(row.status)&&!!row.deduplication_key)){
      dedupGroups.set(review.deduplication_key!,[...(dedupGroups.get(review.deduplication_key!)||[]),review]);
    }
    for(const rows of dedupGroups.values()){
      if(rows.length<2)continue;
      const ordered=[...rows].sort((a,b)=>b.id-a.id),keep=ordered[0];
      for(const duplicate of ordered.slice(1)){
        await db.reviews.update(duplicate.id,{status:"superseded",exclude_from_planning:true,
          exclude_from_recurrence_metrics:true,replaced_by_review_id:keep.id,
          superseded_reason:`deduplication_keyがReview ${keep.id}と重複`});
        changes.reviewsSuperseded++;
      }
    }

    const uniqueActive=(await db.reviews.toArray()).filter(row=>ACTIVE_REVIEW_STATUSES.has(row.status));
    for(const review of uniqueActive){
      const source=attemptMap.get(review.source_attempt_id||review.generated_from_attempt_id);
      const problem=problems.find(row=>row.problem_id===resolveCanonicalProblemId(review.problem_id,aliases));
      let contract=review.grading_contract;
      if(!contract&&problem)contract=buildGradingContractSnapshot({review,problem,sourceAttempt:source,createdAt:review.generated_at||now}).contract;
      if(contract){
        const revision=Math.max(1,Number(review.contract_revision||1));
        const bound=bindContractToReview(contract,review.id,revision);
        await db.reviews.update(review.id,{
          ...taskFieldsFromContract(bound),contract_revision:revision,
          logical_review_key:review.logical_review_key||logicalReviewKey({review:{...review,grading_contract:bound},aliases,sourceAttempt:source}),
        });
        if(review.contract_id!==bound.contractId||review.contract_hash!==bound.contractHash)changes.contractsRebound++;
      }
      const schedule=resolveReviewSchedule(review,source);
      if(schedule.scheduleOrigin==="policy"&&schedule.sourceDate&&schedule.reviewAfterDays!=null){
        const due=addCalendarDays(schedule.sourceDate,schedule.reviewAfterDays);
        if(due!==review.due_date){
          await db.reviews.update(review.id,{source_date:schedule.sourceDate,review_after_days:schedule.reviewAfterDays,
            due_date:due,schedule_origin:"policy",raw_due_date:review.raw_due_date||review.due_date});
          changes.datesCorrected++;
        }
      }
    }
    const reconciled=await reconcileProblemLearningState();
    changes.staleReviewsSuperseded=reconciled.reviewsSuperseded;
    changes.reviewsReplaced=reconciled.reviewsReplaced;
    changes.todayActionsUpdated=reconciled.todayActionsUpdated;
    changes.ambiguousProblems=reconciled.ambiguousProblems;
  });
  const after=await integrityAudit();
  const summary={...after,repairedAt:now};
  await db.meta.put({key:"integrity_audit_summary",value:JSON.stringify(summary)});
  return {preview:false,before,after,changes,success:after.activeIssueCount===0,
    reconciliation:after.reconciliation,details:reconciliationPreview.details};
}

export async function localPost<T>(path:string,body:any):Promise<T>{
  await initialize();
  if(path==="/api/database/repair"){
    return await repairDatabaseSchema() as T;
  } else if(path==="/api/integrity/audit"){
    const audit=await integrityAudit();
    await db.meta.put({key:"integrity_audit_summary",value:JSON.stringify(audit)});
    return audit as T;
  } else if(path==="/api/integrity/preview"){
    return await repairIntegrity(true) as T;
  } else if(path==="/api/integrity/repair"){
    return await repairIntegrity(false) as T;
  } else if(path==="/api/exam-reference-pack/import"){
    return await importExamReferencePack(body as Record<string,unknown>) as T;
  } else if(path==="/api/exam-reference-pack/exposure"){
    const problemId=canonicalPastExamProblemId(String(body.problemId||body.problem_id||""));
    const exposure=String(body.exposure||"") as PastExamExposure;
    const allowed:PastExamExposure[]=["unseen","prompt_scanned","partially_attempted","fully_attempted","answer_exposed","simulated","unknown"];
    if(!allowed.includes(exposure))throw new Error(`露出状態が不正です: ${exposure}`);
    const row=await db.meta.get(EXAM_REFERENCE_PACK_META_KEY);
    if(!row)throw new Error("参照パックが登録されていません");
    const record=JSON.parse(row.value) as StoredExamReferencePack;
    const reference=record.data.pastExamProblems.find(item=>canonicalPastExamProblemId(item)===problemId);
    if(!reference||!reference.schedulable)throw new Error("この問題は露出状態を設定できるcore過去問ではありません");
    const current=await db.meta.get(EXAM_REFERENCE_EXPOSURE_META_KEY);
    let values:Record<string,PastExamExposure>={};
    try{values=JSON.parse(current?.value||"{}")}catch{values={}}
    values[problemId]=exposure;
    await db.meta.put({key:EXAM_REFERENCE_EXPOSURE_META_KEY,value:JSON.stringify(values)});
    notifyStudyDataChanged({operation:"update-past-exam-exposure"});
    return {ok:true,problemId,exposure} as T;
  } else if(path==="/api/master/integrated/import"){
    return await importIntegratedMaster(body) as T;
  } else if(path==="/api/master/problem/import"){
    return await importProblemMaster(body) as T;
  } else if(path==="/api/master/answer/import"){
    return await importAnswerIndex(body) as T;
  } else if(path==="/api/master/aliases/import"){
    return await importAliases(body) as T;
  } else if(path==="/api/master/repair"){
    return await repairDataIntegrity() as T;
  } else if(path==="/api/reviews/rebuild"){
    return await rebuildReviewCards() as T;
  } else if(path==="/api/contracts/preview"){
    return await gradingContractAuditPreview() as T;
  } else if(path==="/api/contracts/hydrate"){
    return await rebuildReviewCards() as T;
  } else if(path==="/api/legacy-k/preview"){
    return await legacyKReorganizationPreview() as T;
  } else if(path==="/api/legacy-k/reorganize"){
    return await db.transaction("rw",[db.attempts,db.reviews,db.problems,db.meta],()=>reorganizeLegacyKTasks()) as T;
  } else if(path==="/api/source-mismatch/preview"){
    return await sourceMismatchPreview() as T;
  } else if(path==="/api/source-mismatch/reorganize"){
    return await db.transaction("rw",[db.attempts,db.reviews,db.problems,db.problemAliases,db.meta],()=>reorganizeSourceMismatches()) as T;
  } else if(path==="/api/review-schedule/preview"){
    return await reviewScheduleRepairPreview() as T;
  } else if(path==="/api/review-schedule/repair"){
    return await db.transaction("rw",[db.attempts,db.reviews,db.problems,db.problemAliases,db.meta],()=>repairReviewSchedules()) as T;
  } else if(path==="/api/master/diagnostic/resolve"){
    return await resolveDiagnostic(body) as T;
  } else if(path==="/api/today/add-candidate"){
    const candidateKey=String(body.candidateKey||"");
    const today=todayString(),key=`today-plan-snapshot:${today}`;
    const existingRow=await db.meta.get(key);
    if(existingRow?.value){
      const existing=JSON.parse(existingRow.value) as TodayPlanSnapshot;
      if(existing.tasks.some(task=>task.additional_candidate_key===candidateKey))
        return {ok:true,candidateKey,alreadyAdded:true} as T;
    }
    const current=await bootstrap();
    const candidate=current.today.additionalCandidates.find(item=>item.candidateKey===candidateKey);
    if(!candidate)throw new Error("追加学習候補が見つからないか、現在の残り時間には収まりません");
    await db.transaction("rw",db.meta,async()=>{
      const row=await db.meta.get(key);
      if(!row?.value)throw new Error("今日の計画が見つかりません");
      const snapshot=JSON.parse(row.value) as TodayPlanSnapshot;
      if(snapshot.tasks.some(task=>task.additional_candidate_key===candidateKey))return;
      const task={...candidate.task,checked:false,triage:"if_time" as const};
      const taskId=taskSnapshotId(task);
      const next:TodayPlanSnapshot={...snapshot,tasks:[...snapshot.tasks,task],
        task_ids:[...snapshot.task_ids,taskId],
        initial_bucket:{...snapshot.initial_bucket,[taskId]:"if_time"},
        initial_estimated_minutes:{...snapshot.initial_estimated_minutes,[taskId]:task.minutes}};
      await db.meta.put({key:`today-plan-snapshot-history:${today}:${Date.now()}`,value:row.value});
      await db.meta.put({key,value:JSON.stringify(next)});
    });
    notifyStudyDataChanged({operation:"add-adaptive-candidate"});
    return {ok:true,candidateKey} as T;
  } else if(path==="/api/today/adaptive-preview"){
    return await replaceTodayWithAdaptivePlan(true) as T;
  } else if(path==="/api/planner/mode"){
    const mode=body.mode==="legacy"?"legacy":"adaptive";
    await db.meta.put({key:PLANNER_RUNTIME_MODE_META_KEY,value:mode});
    notifyStudyDataChanged({operation:"planner-mode-for-future"});
    return {ok:true,mode,appliesFrom:"next-snapshot"} as T;
  } else if(path==="/api/today/recalculate"){
    return await replaceTodayWithAdaptivePlan(false) as T;
  } else if(path==="/api/problems"){
    const chapter=body.chapter?Number(body.chapter):null,number=Number(body.problem_number),difficulty=body.difficulty?Number(body.difficulty):null;
    const display=body.source_type==="past_exam"?body.title:labelFor(chapter,body.category,number,difficulty);
    await db.problems.add({...body,id:Date.now(),chapter,problem_number:number,difficulty,completion_status:"active",
      display_label:display,roadmap_label:display,normalized_label:display.replace(/\s/g,""),
      related_s_problem_ids:list(body.linked_s_problems),linked_past_exam_ids:list(body.linked_past_exams)});
    if(body.category==="S") await db.sMemory.put({problem_id:body.problem_id,state:"stable",k_trigger_count:0});
  } else if(path==="/api/attempts") {
    await assertDatabaseSchema("saveGptEvaluation",GPT_SAVE_REQUIRED_STORES);
    const logs:PendingCorrectionLog[]=[];
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta,db.answerIndex,db.problemAliases,db.correctionLogs],async()=>{
      await saveAttempt(body,logs);
      if(logs.length)await db.correctionLogs.bulkAdd(logs as CorrectionLog[]);
    });
    notifyStudyDataChanged({operation:"save-attempt",reviewId:Number(body.generated_from_review_id||0)||undefined});
  } else if(path==="/api/import") {
    await assertDatabaseSchema("saveGptEvaluationBatch",GPT_SAVE_REQUIRED_STORES);
    const logs:PendingCorrectionLog[]=[];
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta,db.answerIndex,db.problemAliases,db.correctionLogs],async()=>{
      for(const update of body.updates)await saveAttempt(update,logs);
      if(logs.length)await db.correctionLogs.bulkAdd(logs as CorrectionLog[]);
    });
    notifyStudyDataChanged({operation:"save-gpt-import"});
  } else if(/^\/api\/attempts\/\d+\/update$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta,db.problemAliases],
      ()=>updateAttemptAnalysis(Number(path.split("/")[3]),body));
  } else if(/^\/api\/attempts\/\d+\/delete$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta,db.problemAliases],
      ()=>deleteAttemptAnalysis(Number(path.split("/")[3])));
  } else if(/^\/api\/reviews\/\d+\/complete$/.test(path)) {
    await db.transaction("rw",[db.problems,db.attempts,db.reviews,db.weakNotes,db.sMemory,db.meta,db.problemAliases],
      ()=>completeReview(Number(path.split("/")[3]),body));
    notifyStudyDataChanged({operation:"complete-review",reviewId:Number(path.split("/")[3])});
  } else if(/^\/api\/reviews\/\d+\/contract-lock$/.test(path)) {
    const id=Number(path.split("/")[3]),review=await db.reviews.get(id);
    if(!review)throw new Error("復習カードが見つかりません");
    const state=reviewExecutionState(review,todayString());
    if(state!=="actionable")throw new Error(reviewExecutionMessage(state,review));
    const staleReason=await staleEvidenceReason(review);
    if(staleReason)throw new Error(`この復習課題は最新答案により終了または更新されています。${staleReason}`);
    if(!review.contract_locked_at)await db.reviews.update(id,{contract_locked_at:new Date().toISOString()});
  } else if(/^\/api\/reviews\/\d+\/reference$/.test(path)) {
    const id=Number(path.split("/")[3]),review=await db.reviews.get(id);
    if(!review)throw new Error("復習カードが見つかりません");
    const state=reviewExecutionState(review,todayString());
    if(state!=="actionable")throw new Error(reviewExecutionMessage(state,review));
    const staleReason=await staleEvidenceReason(review);
    if(staleReason)throw new Error(`この復習課題は最新答案により終了または更新されています。${staleReason}`);
    const level=Math.min(5,Math.max(Number(review.actual_reference_level||0),Number(body.actual_reference_level||0)));
    await db.reviews.update(id,{actual_reference_level:level,contract_locked_at:review.contract_locked_at||new Date().toISOString()});
  } else if(/^\/api\/reviews\/\d+\/postpone$/.test(path)) {
    await db.transaction("rw",[db.reviews,db.meta],()=>postponeReview(Number(path.split("/")[3]),body));
  } else if(path==="/api/tasks/postpone") {
    await db.transaction("rw",[db.meta],()=>postponeTask(body));
  } else if(/^\/api\/reviews\/\d+\/done$/.test(path)) {
    const id=Number(path.split("/")[3]),review=await db.reviews.get(id);
    const state=reviewExecutionState(review,todayString());
    if(state!=="actionable")throw new Error(reviewExecutionMessage(state,review));
    await db.reviews.update(id,{status:"done",completed_at:new Date().toISOString()});
    notifyStudyDataChanged({operation:"mark-review-done",reviewId:id});
  } else if(/^\/api\/reviews\/\d+\/pending$/.test(path)) {
    const id=Number(path.split("/")[3]),review=await db.reviews.get(id);
    if(!review||["done","completed","superseded"].includes(review.status))throw new Error("完了済み・置換済みの復習課題は再実行できません");
    await db.reviews.update(id,{status:"pending"});
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
        const pending=await db.reviews.filter(review=>
          reviewExecutionState(review,todayString())==="actionable"&&review.due_date>=addDays(examDate,-2)).toArray();
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
    return await savePastExamSession(body) as T;
  } else if(/^\/api\/past-sessions\/\d+\/update$/.test(path)){
    return await savePastExamSession(body,Number(path.split("/")[3])) as T;
  } else if(/^\/api\/past-sessions\/\d+\/analysis$/.test(path)){
    const id=Number(path.split("/")[3]),session=await db.pastSessions.get(id);
    if(!session)throw new Error("対象の5問スキャンセッションが見つかりません");
    const analysis=parseScan5Update(String(body.text||body.yaml||""));
    const normalizedSessionId=Number(String(analysis.session_id??"").trim());
    if(!Number.isInteger(normalizedSessionId)||normalizedSessionId<=0||normalizedSessionId!==id)
      throw new Error(`対象の5問スキャンセッションが見つかりません。受信したsession_id：${String(analysis.session_id??"（空）")}`);
    if(analysis.session_kind!=null&&String(analysis.session_kind)!==String(session.session_kind))
      throw new Error(`session_kindが既存セッションと一致しません。受信値：${String(analysis.session_kind)}／登録値：${String(session.session_kind)}`);
    if(analysis.stage!=null&&String(analysis.stage)!==String(session.stage))
      throw new Error(`stageが既存セッションと一致しません。受信値：${String(analysis.stage)}／登録値：${String(session.stage)}`);
    const rawCandidate=String(analysis.candidate_review_problem_id??"").trim();
    const importLogs=Array.isArray(analysis.import_normalization_logs)?[...analysis.import_normalization_logs] as Array<Record<string,unknown>>:[];
    if(rawCandidate){
      const [problems,aliases]=await Promise.all([db.problems.toArray(),db.problemAliases.toArray()]);
      const canonicalCandidate=resolveCanonicalProblemId(rawCandidate,aliases);
      const matched=problems.find(problem=>resolveCanonicalProblemId(problem.problem_id,aliases)===canonicalCandidate);
      if(matched){
        analysis.candidate_review_problem_id=matched.problem_id;
        if(matched.problem_id!==rawCandidate)importLogs.push({rawValue:rawCandidate,normalizedValue:matched.problem_id,
          fieldName:"candidate_review_problem_id",rubricVersion:String(analysis.rubric_version),timestamp:new Date().toISOString()});
      }else{
        analysis.candidate_review_problem_id=null;analysis.candidate_review_label=rawCandidate;
        importLogs.push({rawValue:rawCandidate,normalizedValue:null,fieldName:"candidate_review_problem_id",
          rubricVersion:String(analysis.rubric_version),timestamp:new Date().toISOString()});
      }
    }else analysis.candidate_review_problem_id=null;
    analysis.import_normalization_logs=importLogs;
    await db.transaction("rw",db.pastSessions,()=>db.pastSessions.update(id,{analysis,rubric_version:String(analysis.rubric_version)}));
    return {ok:true,analysis} as T;
  } else throw new Error(`未対応の保存です: ${path}`);
  return {ok:true} as T;
}

export async function exportBackup(){
  await initialize();
  return {
    version:3,exported_at:new Date().toISOString(),
    problems:await db.problems.toArray(),attempts:await db.attempts.toArray(),reviews:await db.reviews.toArray(),
    roadmap:await db.roadmap.toArray(),weakNotes:await db.weakNotes.toArray(),pastSessions:await db.pastSessions.toArray(),
    sMemory:await db.sMemory.toArray(),answerIndex:await db.answerIndex.toArray(),correctionLogs:await db.correctionLogs.toArray(),
    problemAliases:await db.problemAliases.toArray(),importLogs:await db.importLogs.toArray(),meta:await db.meta.toArray()
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
    if(Array.isArray(data.meta)) await db.meta.bulkPut(data.meta);
    await db.meta.put({key:"seeded",value:"1"});
  });
}

export async function csvFor(table:"attempts"|"problems"){
  const rows=table==="attempts"?await db.attempts.toArray():await db.problems.toArray();
  if(!rows.length) return "";
  const keys=Object.keys(rows[0]);
  return "\ufeff"+[keys.join(","),...rows.map(row=>keys.map(k=>`"${String((row as any)[k]??"").replaceAll('"','""')}"`).join(","))].join("\n");
}
