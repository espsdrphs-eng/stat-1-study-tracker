import type {ExamReadinessMetrics,MetricEvidence} from "./examReadiness.ts";

export type ExamReadinessAssessment={
  level:number;label:string;confidence:"low"|"medium"|"high";passOutlook:string;rationale:string;passJudgement:string;
  selectedThreeScore:MetricEvidence|null;selectionAccuracy:MetricEvidence|null;
  timedCompletion:MetricEvidence|null;transfer:MetricEvidence|null;
  evidenceIds:string[];generatedAt:string;sourceStateVersion:string;
};
type CapabilityInput=Pick<ExamReadinessMetrics,"evidence"|"pastExamScoreRate"|"unseenScoreRate"|"timedCompletionRate"|"selectionSuccessRate"|"sampleSizes">;
export const LEARNING_ASSESSMENT_LABELS={exam:"本番対応力",problem:"問題別到達段階"} as const;

/** One current assessment. Imported coach opinions remain historical guidance,
 * never a second evaluator of the same measured capability. */
export function deriveExamReadinessAssessment(r:CapabilityInput,generatedAt:string):ExamReadinessAssessment{
  const capability=deriveExamCapability(r),e=r.evidence;
  const metrics={selectedThreeScore:e?.selectedThree??null,selectionAccuracy:e?.selection??null,
    timedCompletion:e?.timed??null,transfer:e?.transfer??null};
  const evidenceIds=[...new Set(Object.values(e||{}).flatMap(m=>m?.eligibleEvidenceIds||[]))].sort();
  let hash=2166136261;
  for(const char of JSON.stringify({r,capability}))hash=Math.imul(hash^char.charCodeAt(0),16777619);
  const enough=r.sampleSizes.pastExams>=3&&r.sampleSizes.timed>=3;
  // Preserve the existing pass-judgement timing thresholds. An ordinal score
  // level alone is not evidence that three answers finish within the limit.
  const score=e?.selectedThree?.value??r.pastExamScoreRate??0,timed=r.timedCompletionRate??0;
  const passJudgement=!enough?"判定材料不足":capability.level===5?"安定合格圏":score>=75&&timed>=70?"合格圏":
    score>=60&&timed>=55?"ボーダー域":"ボーダー手前";
  return {...metrics,level:capability.level,label:capability.label,confidence:capability.confidence,
    passOutlook:capability.outlook,rationale:capability.rationale,passJudgement,evidenceIds,generatedAt,
    sourceStateVersion:`exam:${(hash>>>0).toString(36)}`};
}

/** Ordinal evidence rubric, not a pass probability or weighted average.
 * Missing transfer never suppresses the level. A score is not proof of timing.
 */
export function deriveExamCapability(r:Pick<ExamReadinessMetrics,"evidence"|"pastExamScoreRate"|"unseenScoreRate"|"timedCompletionRate"|"selectionSuccessRate"|"sampleSizes">){
  const e=r.evidence,selected=e?.selectedThree,individual=e?.individual;
  const score=selected?.value??individual?.value??r.pastExamScoreRate??r.unseenScoreRate;
  const n=selected?.evidenceCount||individual?.evidenceCount||Math.max(r.sampleSizes.pastExams,r.sampleSizes.unseen);
  let level=score==null?1:score<40?2:score<55?2.5:score<65?3:score<75?3.5:score<85?4:4.5;
  const selectedCount=selected?.evidenceCount||0;
  if(selectedCount<3)level=Math.min(level,3.5);
  if(r.timedCompletionRate!=null&&r.timedCompletionRate<50)level=Math.min(level,3);
  if(r.selectionSuccessRate!=null&&r.selectionSuccessRate<60)level=Math.min(level,3);
  if(selectedCount>=6&&(score??0)>=85&&(r.timedCompletionRate??0)>=80&&(r.selectionSuccessRate??0)>=80)level=5;
  const confidence=selectedCount>=6&&r.sampleSizes.timed>=6&&r.sampleSizes.scans>=6?"high" as const:
    selectedCount>=3&&r.sampleSizes.timed>=3?"medium" as const:"low" as const;
  const label=score==null?"未測定・基準位置（暫定）":level>=4?"合格答案の再現段階":level>=3?"合格圏手前の実戦段階":
    level>=2.5?"実戦得点化の補強段階":"本番得点の基礎補強段階";
  const outlook=score==null?"本番形式の実測が不足しています。まず参照なしの答案で現在地を測定します。":
    `${label}です。得点と時間内完遂は別に評価し、未計測の能力は次の演習で確認します。`;
  const rationale=`自動暫定診断：選題込み本番session ${selectedCount}件、個別過去問 ${individual?.evidenceCount||0}件、未見答案 ${r.sampleSizes.unseen}件。`+
    `利用可能な得点証拠${n}件を基準に、選題・時間内完遂の実測で上限を確認する暫定段階です。合格確率ではありません。`;
  return {level,label,outlook,confidence,rationale};
}
