import type {Attempt,ConceptWeaknessInsight,ExamReferenceCatalogItem,PastSession} from "./types.ts";

export type PastExamTaskType="clean_scan5"|"practice_scan5"|"individual_full"|"timed_three_question_session"|"simulation";
export type PastExamSessionState="planned"|"scan_started"|"selection_committed"|"answers_in_progress"|"grading_pending"|"completed"|"deferred";

/** Derives workflow progress from immutable session facts; refresh never resets it. */
export function derivePastExamSessionState(session?:Partial<PastSession>|null):PastExamSessionState{
  if(!session)return "planned";
  if(session.deferred===true)return "deferred";
  if(session.simulation_completed_at||session.attempt_completed_at&&Number((session.questions||[]).filter(row=>row.completed).length)>=3)return "completed";
  const selected=(session.final_selected_problem_ids||session.initial_selected_problem_ids||[]).filter(Boolean);
  const solved=(session.questions||[]).filter(row=>row.completed);
  if(solved.length&&solved.some(row=>row.actualScore==null))return "grading_pending";
  if(solved.length||session.attempt_started_at)return "answers_in_progress";
  if(selected.length>=3)return "selection_committed";
  if(session.prompt_scanned_at||Number(session.scan_minutes||0)>0)return "scan_started";
  return "planned";
}

export type PastExamYearCandidate={
  year:number;rows:ExamReferenceCatalogItem[];eligibleRows:ExamReferenceCatalogItem[];
  exposure:"clean"|"nearly_clean"|"partial"|"used";cleanScanEligible:boolean;
  attemptedCount:number;recentlyUsed:boolean;transferValue:number;simulationProtected:boolean;
};

const canonicalYear=(id:string)=>Number(String(id).match(/(?:PY-|PE-)(\d{4})/i)?.[1]||0);
const cutoffDate=(today:string,days:number)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today))return "";
  const timestamp=Date.parse(`${today}T12:00:00Z`);
  return Number.isFinite(timestamp)?new Date(timestamp-days*86400000).toISOString().slice(0,10):"";
};

/** Calendar chooses the session kind; exposure and learning evidence choose the year. */
export function buildPastExamYearCandidates(args:{
  catalog:ExamReferenceCatalogItem[];attempts:Attempt[];pastSessions:PastSession[];
  weaknesses?:ConceptWeaknessInsight[];today:string;daysRemaining:number;
}){
  const weakness=new Map((args.weaknesses||[]).map(row=>[row.conceptId,row]));
  const attemptsByYear=new Map<number,Attempt[]>();
  for(const attempt of args.attempts){
    const year=canonicalYear(attempt.problem_id);if(!year)continue;
    attemptsByYear.set(year,[...(attemptsByYear.get(year)||[]),attempt]);
  }
  const sessionsByYear=new Map<number,PastSession[]>();
  for(const session of args.pastSessions){
    const year=Number(session.year||0);if(!year)continue;
    sessionsByYear.set(year,[...(sessionsByYear.get(year)||[]),session]);
  }
  const years=[...new Set(args.catalog.map(row=>row.year))];
  return years.map(year=>{
    const rows=args.catalog.filter(row=>row.year===year);
    const eligibleRows=rows.filter(row=>row.availability==="verified_problem"&&row.schedulable&&row.gradable&&
      !(args.daysRemaining>30&&row.simulationProtected));
    if(!eligibleRows.length)return null;
    const explicitUnseen=eligibleRows.filter(row=>row.exposure==="unseen").length;
    const untouched=eligibleRows.filter(row=>["unseen","unknown"].includes(row.exposure)).length;
    const attempted=(attemptsByYear.get(year)||[]).filter(row=>!row.exclude_from_planning);
    const sessionRows=sessionsByYear.get(year)||[];
    const exposedBySession=sessionRows.some(row=>Number(row.scan_minutes||0)>0||!!row.session_kind);
    const cleanScanEligible=eligibleRows.length>=5&&explicitUnseen===eligibleRows.length&&!attempted.length&&!exposedBySession;
    const exposure:PastExamYearCandidate["exposure"]=cleanScanEligible?"clean":
      eligibleRows.length>=5&&untouched>=eligibleRows.length-1&&!attempted.length&&!exposedBySession?"nearly_clean":
      untouched>0?"partial":"used";
    const recentCutoff=cutoffDate(args.today,14);
    const recentlyUsed=!!recentCutoff&&[...attempted.map(row=>row.date),...sessionRows.map(row=>String(row.date))]
      .some(date=>date>=recentCutoff);
    const transferValue=Math.max(0,...eligibleRows.flatMap(row=>row.fineConceptIds.map(id=>{
      const value=weakness.get(id);return value?value.priorityScore+(value.pastExamFailureCount?1000:0):0;
    })));
    return {year,rows,eligibleRows,exposure,cleanScanEligible,attemptedCount:attempted.length,recentlyUsed,transferValue,
      simulationProtected:eligibleRows.some(row=>row.simulationProtected)};
  }).filter((row):row is PastExamYearCandidate=>!!row);
}

export function selectPastExamYear(args:{candidates:PastExamYearCandidate[];taskType:PastExamTaskType;excludedYears?:Set<number>}){
  const available=args.candidates.filter(row=>!args.excludedYears?.has(row.year));
  const protectedSimulation=available.filter(row=>row.simulationProtected);
  const rows=args.taskType==="simulation"&&protectedSimulation.length?protectedSimulation:available;
  const session=["clean_scan5","practice_scan5","timed_three_question_session","simulation"].includes(args.taskType);
  return [...rows].sort((a,b)=>{
    const sessionRank=(row:PastExamYearCandidate)=>row.cleanScanEligible?0:row.exposure==="nearly_clean"?1:row.exposure==="partial"?2:3;
    const individualRank=(row:PastExamYearCandidate)=>row.exposure==="partial"?0:row.exposure==="used"?1:row.exposure==="nearly_clean"?2:3;
    return (session?sessionRank(a)-sessionRank(b):individualRank(a)-individualRank(b))||
      Number(a.recentlyUsed)-Number(b.recentlyUsed)||b.transferValue-a.transferValue||a.year-b.year;
  })[0];
}

export function pastExamTaskTypeFor(args:{kind:"past_exam"|"scan5"|"timed";year:PastExamYearCandidate;daysRemaining:number}):PastExamTaskType{
  if(args.daysRemaining<=30&&args.kind==="timed")return "simulation";
  if(args.kind==="timed")return "timed_three_question_session";
  if(args.kind==="scan5")return args.year.cleanScanEligible?"clean_scan5":"practice_scan5";
  return "individual_full";
}

export function generatedUnseenPolicy(args:{distinctPastExamYears:number;examEvidenceCount:number}){
  const eligible=args.distinctPastExamYears>=3&&args.examEvidenceCount>=3;
  return {eligible,shareMin:eligible?0.1:0,shareMax:eligible?0.2:0,countsAsPastExamEvidence:false,
    role:"transfer_training" as const};
}

export function derivePastExamWorkspace(args:{
  catalog:ExamReferenceCatalogItem[];attempts:Attempt[];pastSessions:PastSession[];
  weaknesses?:ConceptWeaknessInsight[];today:string;daysRemaining:number;
}){
  const candidates=buildPastExamYearCandidates(args);
  const taskType:PastExamTaskType=args.daysRemaining<=30?"simulation":args.daysRemaining<=80?"timed_three_question_session":"clean_scan5";
  const year=selectPastExamYear({candidates,taskType});
  if(!year)return {recommended:null,candidates,warning:"利用可能な過去問がありません"};
  const effectiveType:PastExamTaskType=taskType==="clean_scan5"&&!year.cleanScanEligible?"practice_scan5":taskType;
  return {recommended:{year:year.year,taskType:effectiveType,clean:year.cleanScanEligible,
    label:year.cleanScanEligible?"完全未見":"一部露出済み",
    workflow:["timed_three_question_session","simulation"].includes(effectiveType)?
      "5問scan → 3問選択 → 3問答案 → 採点":"5問scan → 3問選択"},candidates,warning:null};
}
