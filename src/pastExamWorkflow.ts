import yaml from "js-yaml";
import type { PastExamExposure, PastExamSessionKind, PastExamStage, PastSession, ScanQuestion, ScanSetSource } from "./types.ts";
import { addCalendarDays } from "./taskScheduler.ts";

export const SCAN5_RUBRIC_VERSION="STAT1-SCAN5-v1";

const list=(value:unknown)=>Array.isArray(value)?value.map(String).filter(Boolean):String(value||"").split(/[;,、\s]+/).map(row=>row.trim()).filter(Boolean);
const nullableNumber=(value:unknown)=>value===""||value==null?null:Number.isFinite(Number(value))?Number(value):null;
const bool=(value:unknown)=>value===true||value===1||value==="true";

export function stageForDays(daysRemaining:number):PastExamStage{
  return daysRemaining>=91?"discrimination":daysRemaining>=31?"calibration":"simulation";
}
export function defaultSessionKind(daysRemaining:number):PastExamSessionKind{
  return daysRemaining>=61?"scan_plus_one":"selected_three_timed";
}
export function scanFrequencyPerWeek(daysRemaining:number){return daysRemaining>=91?1:daysRemaining>=61?1.5:2}

function normalizeQuestion(value:unknown,index:number):ScanQuestion{
  const row=(value&&typeof value==="object"?value:{}) as Record<string,unknown>;
  return {problemId:String(row.problemId||row.problem_id||"")||undefined,questionLabel:String(row.questionLabel||row.question_label||`問${index+1}`),
    predictedType:String(row.predictedType||row.predicted_type||""),firstStep:String(row.firstStep||row.first_step||""),
    predictedScore:nullableNumber(row.predictedScore??row.predicted_score),predictedMinutes:nullableNumber(row.predictedMinutes??row.predicted_minutes),
    sinkRisk:["low","medium","high"].includes(String(row.sinkRisk||row.sink_risk))?String(row.sinkRisk||row.sink_risk) as ScanQuestion["sinkRisk"]:"medium",
    selected:bool(row.selected),selectionReason:String(row.selectionReason||row.selection_reason||""),plannedOrder:nullableNumber(row.plannedOrder??row.planned_order),
    actualScore:nullableNumber(row.actualScore??row.actual_score),actualMinutes:nullableNumber(row.actualMinutes??row.actual_minutes),
    typeJudgmentCorrect:row.typeJudgmentCorrect==null&&row.type_judgment_correct==null?null:bool(row.typeJudgmentCorrect??row.type_judgment_correct),
    firstStepCorrect:row.firstStepCorrect==null&&row.first_step_correct==null?null:bool(row.firstStepCorrect??row.first_step_correct),
    sank:row.sank==null?null:bool(row.sank),hintUsed:bool(row.hintUsed??row.hint_used),referenceUsed:bool(row.referenceUsed??row.reference_used),completed:bool(row.completed)};
}

export function normalizePastExamSession(raw:Record<string,unknown>):PastSession{
  const kind=String(raw.session_kind||raw.sessionKind||raw.session_type||"scan_plus_one") as PastExamSessionKind;
  const questions=(Array.isArray(raw.questions)?raw.questions:[]).map(normalizeQuestion);
  const initial=list(raw.initial_selected_problem_ids||raw.initialSelectedProblemIds||raw.selected_questions);
  const final=list(raw.final_selected_problem_ids||raw.finalSelectedProblemIds||raw.final_selected_problem_ids);
  const changedSelection=final.length>0&&(final.length!==initial.length||final.some(id=>!initial.includes(id)));
  return {...raw,id:Number(raw.id||0),year:Number(raw.year||0),date:String(raw.date||new Date().toISOString().slice(0,10)),session_type:"scan5",session_kind:kind,
    stage:String(raw.stage||"discrimination") as PastExamStage,scan_set_source:String(raw.scan_set_source||raw.scanSetSource||"past_exam_year") as ScanSetSource,
    questions,scan_minutes:Number(raw.scan_minutes||raw.scanMinutes||0),initial_selected_problem_ids:initial.length?initial:questions.filter(row=>row.selected).map(row=>row.problemId||row.questionLabel),
    final_selected_problem_ids:final,solve_order:list(raw.solve_order),actual_total_minutes:Number(raw.actual_total_minutes||raw.actualTotalMinutes||0),
    changed_selection:changedSelection,answer_exposure:bool(raw.answer_exposure),selection_evaluation_eligible:bool(raw.selection_evaluation_eligible),
    optimal_selected_problem_ids:list(raw.optimal_selected_problem_ids),exam_score_eligible:false};
}

export type PastSessionValidation={valid:boolean;errors:string[];warnings:string[];selectedIds:string[];solvedQuestions:ScanQuestion[];examScoreEligible:boolean};
export function validatePastExamSession(session:PastSession):PastSessionValidation{
  const errors:string[]=[],warnings:string[]=[];const questions=session.questions||[];
  const ids=questions.map(row=>row.problemId||row.questionLabel).filter(Boolean);
  if(session.session_kind!=="retrospective_review"&&questions.length!==5)errors.push("5問を登録してください");
  if(new Set(ids).size!==ids.length)errors.push("同じ問題を重複登録できません");
  const selected=(session.final_selected_problem_ids?.length?session.final_selected_problem_ids:session.initial_selected_problem_ids||questions.filter(row=>row.selected).map(row=>row.problemId||row.questionLabel)).filter(Boolean);
  if(session.session_kind!=="retrospective_review"&&selected.length!==3)errors.push("選ぶ問題は3問にしてください");
  const planned=questions.filter(row=>selected.includes(row.problemId||row.questionLabel)).reduce((sum,row)=>sum+Number(row.predictedMinutes||0),0);
  if(session.session_kind==="selected_three_timed"&&planned>90)errors.push("選択3問の予定時間を90分以内にしてください");
  const solved=questions.filter(row=>row.completed);
  if(session.session_kind==="scan_only"&&solved.length)errors.push("scan onlyでは通常答案を登録しません");
  if(session.session_kind==="scan_plus_one"&&solved.length>1)errors.push("scan＋1問でAttempt化できるのは1問だけです");
  if(session.session_kind==="selected_three_timed"&&solved.length!==0&&(solved.length!==3||solved.some(row=>!selected.includes(row.problemId||row.questionLabel))))errors.push("3問90分では、事前保存後に選んだ3問だけをすべて解答してください");
  if(solved.some(row=>row.actualScore==null))warnings.push("解いた問題の得点が未評価です");
  const noReference=solved.every(row=>!row.referenceUsed&&!row.hintUsed)&&!session.answer_exposure;
  const allScored=solved.length===3&&solved.every(row=>row.actualScore!=null);
  const withinTime=Number(session.actual_total_minutes||0)>0&&(Number(session.actual_total_minutes)<=90||bool(session.time_overrun_recorded));
  const eligible=session.session_kind==="selected_three_timed"&&solved.length===3&&allScored&&noReference&&withinTime;
  return {valid:errors.length===0,errors,warnings,selectedIds:selected,solvedQuestions:solved,examScoreEligible:eligible};
}

export function selectionSuccessRate(session:PastSession):number|null{
  if(!session.selection_evaluation_eligible)return null;
  const optimal=session.optimal_selected_problem_ids||[];
  const selected=session.final_selected_problem_ids?.length?session.final_selected_problem_ids:session.initial_selected_problem_ids||[];
  const allComparable=(session.questions||[]).length===5&&(session.questions||[]).every(row=>row.actualScore!=null);
  if(optimal.length!==3||selected.length!==3||(!allComparable&&!session.optimal_selection_basis))return null;
  return Math.round(selected.filter(id=>optimal.includes(id)).length/3*100);
}

export function deriveExposure(session:PastSession):PastExamExposure{
  if(session.answer_viewed_at||session.answer_exposure)return "answer_exposed";
  if(session.simulation_completed_at||(session.session_kind==="selected_three_timed"&&session.attempt_completed_at))return "simulated";
  const completed=(session.questions||[]).filter(row=>row.completed).length;
  if(completed>=5)return "fully_attempted";
  if(completed>0||session.attempt_started_at)return "partially_attempted";
  if(session.prompt_scanned_at||session.scan_minutes)return "prompt_scanned";
  return "unknown";
}

export function sessionStudyMinutes(session:PastSession,linkedAttempts:Array<{id:number;time_minutes:number}>=[]){
  if(session.session_kind==="scan_only")return Number(session.scan_minutes||0);
  if(session.session_kind==="scan_plus_one")return Number(session.scan_minutes||0)+(session.linked_attempt_ids||[]).reduce((sum,id)=>sum+Number(linkedAttempts.find(row=>row.id===id)?.time_minutes||0),0);
  if(session.session_kind==="selected_three_timed")return Number(session.actual_total_minutes||0);
  return Number(session.review_minutes||0);
}

export function scanMetrics(session:PastSession){
  const questions=session.questions||[],solved=questions.filter(row=>row.completed);
  const assessedType=solved.filter(row=>row.typeJudgmentCorrect!=null),assessedStep=solved.filter(row=>row.firstStepCorrect!=null);
  const scoreDiff=solved.filter(row=>row.actualScore!=null&&row.predictedScore!=null).map(row=>Number(row.actualScore)-Number(row.predictedScore));
  const timeDiff=solved.filter(row=>row.actualMinutes!=null&&row.predictedMinutes!=null).map(row=>Number(row.actualMinutes)-Number(row.predictedMinutes));
  return {selectionSuccessRate:selectionSuccessRate(session),typeIdentificationAccuracy:assessedType.length?Math.round(assessedType.filter(row=>row.typeJudgmentCorrect).length/assessedType.length*100):null,
    firstStepAccuracy:assessedStep.length?Math.round(assessedStep.filter(row=>row.firstStepCorrect).length/assessedStep.length*100):null,
    predictedScoreDifference:scoreDiff.length?Math.round(scoreDiff.reduce((a,b)=>a+b,0)/scoreDiff.length):null,
    predictedTimeDifference:timeDiff.length?Math.round(timeDiff.reduce((a,b)=>a+b,0)/timeDiff.length):null,
    sankSelectedCount:solved.filter(row=>row.sank).length,solvedCount:solved.length};
}

export function protectedUnseenYears(sessions:PastSession[],availableYears:number[],daysRemaining:number){
  if(daysRemaining<61)return [];
  const exposed=new Set(sessions.filter(row=>deriveExposure(row)!=="unknown").map(row=>Number(row.year)));
  return [...availableYears].filter(year=>!exposed.has(year)).sort((a,b)=>b-a).slice(0,2);
}

export function recommendScanSource(args:{sessions:PastSession[];availableYears:number[];daysRemaining:number}){
  const protectedYears=protectedUnseenYears(args.sessions,args.availableYears,args.daysRemaining);
  const exposure=new Map<number,PastExamExposure>();for(const row of args.sessions)exposure.set(Number(row.year),deriveExposure(row));
  const exposed=[...args.availableYears].filter(year=>exposure.has(year)&&exposure.get(year)!=="unknown").sort((a,b)=>a-b);
  const oldUnseen=[...args.availableYears].filter(year=>!exposure.has(year)&&!protectedYears.includes(year)).sort((a,b)=>a-b);
  return {source:exposed[0]!=null?"past_exam_year":oldUnseen[0]!=null?"past_exam_year":"mixed_a_problems" as ScanSetSource,
    year:exposed[0]??oldUnseen[0]??null,protectedYears};
}

export function buildScan5Prompt(session:PastSession,daysRemaining:number,metrics=scanMetrics(session)){
  return `あなたは統計検定1級・統計数理の選題判断コーチです。\nルーブリック: ${SCAN5_RUBRIC_VERSION}\n問題文がない場合、真の難易度・最適解法・最適3問・未解答問題の得点を推測しないでください。K/W/N/Cは出力しません。\n\nセッション形式: ${session.session_kind}\n残り日数: ${daysRemaining}\n段階: ${session.stage}\n事前判断:\n${JSON.stringify(session.questions||[],null,2)}\n初期選択: ${(session.initial_selected_problem_ids||[]).join(", ")}\n解答順: ${(session.solve_order||[]).join(", ")}\n実測指標: ${JSON.stringify(metrics)}\n\n良かった判断、誤った判断、主因、次回変更する選題規則1つ、次回確認項目1つを示し、最後に次のYAMLだけを出してください。\n\nscan_update:\n  session_id: "${session.id}"\n  date: "${session.date}"\n  session_kind: "${session.session_kind}"\n  stage: "${session.stage}"\n  good_decisions: []\n  bad_decisions: []\n  primary_selection_error: "none"\n  calibration_findings: []\n  next_selection_rule: ""\n  next_scan_focus: ""\n  candidate_review_problem_id: null\n  candidate_review_reason: ""\n  grading_confidence: 0\n  rubric_version: "${SCAN5_RUBRIC_VERSION}"`;
}

export function parseScan5Update(text:string):Record<string,unknown>{
  const fenced=text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i)?.[1]||text;
  const parsed=yaml.load(fenced) as Record<string,unknown>||{};const row=(parsed.scan_update||parsed) as Record<string,unknown>;
  if(String(row.rubric_version)!==SCAN5_RUBRIC_VERSION)throw new Error(`scan5専用rubric ${SCAN5_RUBRIC_VERSION} が必要です`);
  const allowed=["type_misclassification","first_step_failure","score_overconfidence","score_underconfidence","time_underestimate","sink_risk_missed","poor_selection_balance","none"];
  if(!allowed.includes(String(row.primary_selection_error||"none")))throw new Error("primary_selection_errorが不正です");
  return {...row,rubric_version:SCAN5_RUBRIC_VERSION};
}

export function simulateScanPlan(args:{startDate:string;daysRemaining:number;days?:number}){
  const days=args.days||30,frequency=scanFrequencyPerWeek(args.daysRemaining),spacing=Math.max(3,Math.round(7/frequency));
  const entries:Array<{date:string;kind:PastExamSessionKind;stage:PastExamStage;bucket:"optional"}>=[];
  for(let offset=0;offset<days;offset+=spacing)entries.push({date:addCalendarDays(args.startDate,offset),kind:defaultSessionKind(args.daysRemaining),stage:stageForDays(args.daysRemaining),bucket:"optional"});
  return {entries,count:entries.length,maxPerWeek:Math.ceil(frequency),mandatoryCount:0};
}
