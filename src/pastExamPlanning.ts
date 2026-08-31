import type {Attempt,ConceptWeaknessInsight,ExamReferenceCatalogItem,PastExamSessionPurpose,PastExamSessionState,PastSession} from "./types.ts";
import {attemptPlanningEligible} from "./legacyKPolicy.ts";

export type PastExamTaskType="clean_scan5"|"practice_scan5"|"individual_full"|"timed_three_question_session"|"simulation";
export type {PastExamSessionState} from "./types.ts";

export function pastExamSessionPurpose(session:Partial<PastSession>):PastExamSessionPurpose{
  if(session.session_purpose)return session.session_purpose;
  if(session.simulation===true)return "simulation";
  if(session.session_kind==="selected_three_timed")return "timed_three_question_session";
  if(session.session_kind==="scan_only")return session.scan_evidence_kind==="practice"?"practice_scan5":"clean_scan5";
  if(session.session_kind==="scan_plus_one")return "individual_full";
  return "individual_full";
}

export function stablePastExamSessionKey(args:{date?:string;year:number;purpose:string;ordinal?:number;sessionInstanceId?:string}){
  const logicalPurpose=["clean_scan5","practice_scan5"].includes(args.purpose)?"scan5":args.purpose;
  const instance=args.sessionInstanceId||`session-${Math.max(1,Number(args.ordinal||1))}`;
  return `past_exam_session:${args.year}:${logicalPurpose}:${instance}`;
}

export function pastExamSessionKey(session:Partial<PastSession>){
  return stablePastExamSessionKey({year:Number(session.year||0),purpose:pastExamSessionPurpose(session),
    ordinal:Number(session.session_ordinal||1),sessionInstanceId:session.session_instance_id});
}

/** Derives workflow progress from immutable session facts; refresh never resets it. */
export function derivePastExamSessionState(session?:Partial<PastSession>|null):PastExamSessionState{
  if(!session)return "planned";
  if(session.session_state==="invalidated")return "invalidated";
  if(session.cancelled===true||session.session_state==="cancelled")return "cancelled";
  if(session.deferred===true)return "deferred";
  if(session.simulation_completed_at||session.attempt_completed_at&&Number((session.questions||[]).filter(row=>row.completed).length)>=3)return "completed";
  const selected=(session.final_selected_problem_ids||session.initial_selected_problem_ids||[]).filter(Boolean);
  const solved=(session.questions||[]).filter(row=>row.completed);
  if(solved.length&&solved.some(row=>row.actualScore==null))return "grading_pending";
  if(solved.length||session.attempt_started_at)return "answers_in_progress";
  if(selected.length>=3)return "selection_committed";
  if(selected.length>0||(session.questions||[]).some(row=>row.selected))return "selection_draft";
  if(session.prompt_scanned_at||Number(session.scan_minutes||0)>0)return "scan_started";
  return "planned";
}

const stateRank:Record<PastExamSessionState,number>={planned:0,scan_started:1,selection_draft:2,selection_committed:3,
  answers_in_progress:4,grading_pending:5,completed:6,deferred:-1,cancelled:-2,invalidated:-3};
const inputScore=(session:PastSession)=>Number(session.scan_minutes||0)+Number(session.actual_total_minutes||0)+
  (session.questions||[]).filter(row=>row.predictedType||row.firstStep||row.selectionReason||row.completed).length*10+
  (session.linked_attempt_ids||[]).length*20+(session.analysis?10:0);

/** Read-only current projection. Duplicate raw rows stay as history. */
export function canonicalizePastExamSessions(sessions:PastSession[]){
  const groups=new Map<string,PastSession[]>();
  for(const session of sessions){
    if(session.superseded_by_session_id)continue;
    const state=derivePastExamSessionState(session),purpose=pastExamSessionPurpose(session);
    const active=!['completed','deferred','cancelled','invalidated'].includes(state);
    // Legacy clean/practice rows for one unfinished run must converge even if
    // an old build put a different schedule date in each key.
    const key=active?stablePastExamSessionKey({year:session.year,purpose,ordinal:Number(session.session_ordinal||1)}):
      (session.stable_session_key||pastExamSessionKey(session));
    groups.set(key,[...(groups.get(key)||[]),session]);
  }
  const current:PastSession[]=[],superseded:Array<{sessionId:number;canonicalSessionId:number;reason:string}>=[];
  for(const [key,rows] of groups){
    const ranked=[...rows].sort((a,b)=>stateRank[derivePastExamSessionState(b)]-stateRank[derivePastExamSessionState(a)]||
      inputScore(b)-inputScore(a)||Number(b.id)-Number(a.id));
    const winner=ranked[0];
    const snapshot=rows.map(row=>row.exposure_snapshot_at_start).find(value=>value?.classification==="clean")||
      winner.exposure_snapshot_at_start||{
        classification:rows.some(row=>row.scan_evidence_kind==="clean")?"clean" as const:"practice" as const,
        exposed_problem_ids:[],total_problem_count:5,captured_at:String(winner.prompt_scanned_at||winner.date),
      };
    const rawPurpose=pastExamSessionPurpose(winner);
    const sessionPurpose=["clean_scan5","practice_scan5"].includes(rawPurpose)?
      (snapshot.classification==="clean"?"clean_scan5" as const:"practice_scan5" as const):rawPurpose;
    const richest=<K extends keyof PastSession>(field:K)=>ranked.find(row=>{
      const value=row[field];return Array.isArray(value)?value.length>0:value&&typeof value==="object"?Object.keys(value).length>0:value!=null&&value!=="";
    })?.[field];
    const merged={...winner,
      questions:richest("questions")||winner.questions,
      initial_selected_problem_ids:richest("initial_selected_problem_ids")||winner.initial_selected_problem_ids,
      final_selected_problem_ids:richest("final_selected_problem_ids")||winner.final_selected_problem_ids,
      solve_order:richest("solve_order")||winner.solve_order,
      planned_minutes_by_problem:richest("planned_minutes_by_problem")||winner.planned_minutes_by_problem,
      selection_strategy:richest("selection_strategy")||winner.selection_strategy,
      analysis:richest("analysis")||winner.analysis,
      linked_attempt_ids:uniqueNumbers(rows.flatMap(row=>row.linked_attempt_ids||[])),
      selected_year_reason:richest("selected_year_reason")||winner.selected_year_reason||
        `${winner.year}年の未完了sessionを継続し、開始時点の${snapshot.classification==="clean"?"未露出":"一部露出"}証拠を保持するため`};
    current.push({...merged,stable_session_key:key,session_instance_id:winner.session_instance_id||`session-${Number(winner.session_ordinal||1)}`,
      session_purpose:sessionPurpose,
      session_ordinal:Number(winner.session_ordinal||1),session_state:derivePastExamSessionState(merged),
      exposure_snapshot_at_start:snapshot,scan_evidence_kind:snapshot.classification});
    for(const row of ranked.slice(1))superseded.push({sessionId:row.id,canonicalSessionId:winner.id,
      reason:`同一logical PastExamSession ${key} のcurrent generationへ統合`});
  }
  return {current:current.sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.id-a.id),superseded};
}

const uniqueNumbers=(values:number[])=>[...new Set(values)];

export type PastExamYearCandidate={
  year:number;rows:ExamReferenceCatalogItem[];eligibleRows:ExamReferenceCatalogItem[];
  exposure:"clean"|"nearly_clean"|"partial"|"used";cleanScanEligible:boolean;
  attemptedCount:number;recentlyUsed:boolean;transferValue:number;simulationProtected:boolean;
  exposedCount:number;
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
    const attempted=(attemptsByYear.get(year)||[]).filter(row=>attemptPlanningEligible(row));
    const sessionRows=(sessionsByYear.get(year)||[]).filter(row=>!row.superseded_by_session_id);
    const exposedBySession=sessionRows.some(row=>!["planned","deferred","cancelled","invalidated"].includes(derivePastExamSessionState(row)));
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
    const exposedCount=eligibleRows.filter(row=>!["unseen","unknown"].includes(row.exposure)).length;
    return {year,rows,eligibleRows,exposure,cleanScanEligible,attemptedCount:attempted.length,recentlyUsed,transferValue,exposedCount,
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
  const canonicalSessions=canonicalizePastExamSessions(args.pastSessions).current;
  const candidates=buildPastExamYearCandidates({...args,pastSessions:canonicalSessions});
  const taskType:PastExamTaskType=args.daysRemaining<=30?"simulation":args.daysRemaining<=80?"timed_three_question_session":"clean_scan5";
  const active=canonicalSessions.find(session=>!["completed","deferred","cancelled","invalidated"].includes(derivePastExamSessionState(session))&&
    ["clean_scan5","practice_scan5","timed_three_question_session","simulation"].includes(pastExamSessionPurpose(session)));
  const year=active?candidates.find(row=>row.year===active.year):selectPastExamYear({candidates,taskType});
  const unseenIndividualPool=candidates.flatMap(candidate=>candidate.eligibleRows.filter(row=>
    ["unseen","unknown"].includes(row.exposure)&&!args.attempts.some(attempt=>canonicalYear(attempt.problem_id)===candidate.year&&
      attempt.problem_id===row.canonicalProblemId)));
  if(!year)return {recommended:null,candidates,unseenIndividualPool,warning:"利用可能な過去問がありません"};
  const effectiveType:PastExamTaskType=taskType==="clean_scan5"&&!year.cleanScanEligible?"practice_scan5":taskType;
  const chosenType=active?pastExamSessionPurpose(active):effectiveType;
  const prior=candidates.filter(row=>row.year<year.year&&row.exposedCount>0).sort((a,b)=>b.year-a.year)[0];
  const selectedYearReason=active?.selected_year_reason||[
    prior?`${prior.year}年は${prior.exposedCount}/${prior.eligibleRows.length}問が既露出のためclean選題測定には使わない`:"より古い利用可能年度にclean候補なし",
    `${year.year}年は${year.exposedCount}/${year.eligibleRows.length}問露出で、clean選題証拠を取得できるため`,
    "2024/2025はsimulation保護を維持",
  ].join("。 ");
  const clean=active?.exposure_snapshot_at_start?.classification==="clean"||!active&&year.cleanScanEligible;
  return {recommended:{year:year.year,taskType:chosenType,clean,
    label:clean?"完全未見":"一部露出済み",selectedYearReason,stableSessionKey:active?pastExamSessionKey(active):undefined,
    workflow:["timed_three_question_session","simulation"].includes(chosenType)?
      "5問scan → 3問選択 → 3問答案 → 採点":"5問scan → 3問選択"},candidates,unseenIndividualPool,warning:null};
}
