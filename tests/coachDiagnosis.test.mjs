import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoachDiagnosisState, buildCoachReviewPrompt, coachPreview, normalizeCoachUpdate, parseCoachUpdate
} from "../src/coachDiagnosis.ts";

const diagnosis=(cutoff=4,level=3.5)=>({coach_update:{schema_version:"stat1-coach-v1",reviewed_at:"2026-08-17T10:00:00+09:00",
  evidence_cutoff_attempt_id:cutoff,level:{value:level,label:"A/S問題を解けるが再現不安定",pass_outlook:"境界手前〜境界圏",confidence:"medium",rationale:"答案証拠に基づく"},
  primary_bottleneck:{title:"変数・係数・制約の追跡",explanation:"複数問題で再発",evidence_problem_ids:["WB-6-A-20"],effect_on_exam:"途中式から失点"},
  next_actions:[{title:"置換後の全式更新",purpose:"追跡力",practice_method:"別問題で再現",success_condition:"参照なし成功"}],
  strengths:[{title:"標準化",evidence:"遅延成功"}],improvements:[{title:"PIT",evidence:"別問題成功"}],
  unknowns:[{title:"時間内完走",evidence_needed:"timed答案"}],optional_pass_probability:null}});

test("coach_updateを固定contractへ正規化し差分previewを作る",()=>{
  const next=normalizeCoachUpdate(diagnosis());
  assert.equal(next.level.value,3.5);
  assert.equal(next.level.confidence,"medium");
  assert.equal(next.primaryBottleneck.evidenceProblemIds[0],"WB-6-A-20");
  assert.equal(coachPreview(null,next).diff.level,"未診断 → 3.5");
});

test("fenced YAMLからcoach_updateを読み取る",()=>{
  const yaml=`coach_update:\n  schema_version: stat1-coach-v1\n  reviewed_at: 2026-08-17T10:00:00+09:00\n  evidence_cutoff_attempt_id: 4\n  level:\n    value: 3.5\n    label: 境界圏\n    pass_outlook: 境界手前〜境界圏\n    confidence: medium\n    rationale: 根拠\n  primary_bottleneck:\n    title: 制約追跡\n    explanation: 再発\n    evidence_problem_ids: []\n    effect_on_exam: 失点\n  next_actions: []\n  strengths: []\n  improvements: []\n  unknowns: []\n  optional_pass_probability: null`;
  assert.equal(parseCoachUpdate(`説明\n\`\`\`yaml\n${yaml}\n\`\`\``).primaryBottleneck.title,"制約追跡");
});

test("strict JSON・code fence・前後説明からcoach_updateを安全に抽出する",()=>{
  const json=JSON.stringify(diagnosis());
  assert.equal(parseCoachUpdate(json).level.value,3.5);
  assert.equal(parseCoachUpdate(`\n\`\`\`json\n${json}\n\`\`\`\n`).primaryBottleneck.title,"変数・係数・制約の追跡");
  assert.equal(parseCoachUpdate(`診断結果です。\n${json}\n以上です。`).evidenceCutoffAttemptId,4);
});

test("説明中の波括弧が先行しても唯一のvalid coach_updateを抽出する",()=>{
  const raw=`以下の {coach_update} が診断結果です。\n${JSON.stringify(diagnosis())}\n保存前に確認してください。`;
  assert.equal(parseCoachUpdate(raw).primaryBottleneck.title,"変数・係数・制約の追跡");
});

test("typographic quoteをJSON delimiterとして使った実入力を無加工で取り込む",()=>{
  const ascii=JSON.stringify(diagnosis());
  let inString=false;
  const smart=[...ascii].map((char,index,chars)=>{
    if(char!==String.fromCharCode(34)||chars[index-1]==="\\")return char;
    inString=!inString;return inString?"“":"”";
  }).join("");
  const parsed=parseCoachUpdate(smart);
  assert.equal(parsed.level.value,3.5);
  assert.equal(parsed.primaryBottleneck.title,"変数・係数・制約の追跡");
});

test("全角quote delimiterを受理し文字列内部の引用と日本語括弧は保持する",()=>{
  const raw=`{＂coach_update＂:{＂schema_version＂:＂stat1-coach-v1＂,＂reviewed_at＂:＂2026-08-22T10:00:00+09:00＂,＂evidence_cutoff_attempt_id＂:4,＂level＂:{＂value＂:3.5,＂label＂:＂「境界圏」＂,＂pass_outlook＂:＂境界手前〜境界圏＂,＂confidence＂:＂medium＂,＂rationale＂:＂GPTは“制約”を追跡と評価し、『根拠』を確認＂},＂primary_bottleneck＂:{＂title＂:＂制約追跡＂,＂explanation＂:＂再発＂,＂evidence_problem_ids＂:[],＂effect_on_exam＂:＂失点＂},＂next_actions＂:[],＂strengths＂:[],＂improvements＂:[],＂unknowns＂:[],＂optional_pass_probability＂:null}}`;
  const parsed=parseCoachUpdate(raw);
  assert.equal(parsed.level.label,"「境界圏」");
  assert.equal(parsed.level.rationale,"GPTは“制約”を追跡と評価し、『根拠』を確認");
});

test("quote互換化後もbraceが壊れている入力は推測修復しない",()=>{
  assert.throws(()=>parseCoachUpdate(`{“coach_update”:{“schema_version”:“stat1-coach-v1”}`),error=>error.stage==="parse");
});

test("壊れたJSONとschema不足はfriendly errorで拒否し診断へ進めない",()=>{
  assert.throws(()=>parseCoachUpdate('{"coach_update":{"schema_version":"stat1-coach-v1",}'),error=>
    error.stage==="parse"&&/JSONを読み込めません/.test(error.message));
  const missing=diagnosis();delete missing.coach_update.primary_bottleneck;
  assert.throws(()=>parseCoachUpdate(JSON.stringify(missing)),error=>
    error.stage==="schema"&&error.path==="coach_update.primary_bottleneck"&&/現在の仕様と一致/.test(error.message));
  const semantic=diagnosis();semantic.coach_update.level.value=0;
  assert.throws(()=>parseCoachUpdate(JSON.stringify(semantic)),error=>
    error.stage==="semantic"&&error.path==="coach_update.level.value"&&/必要な値/.test(error.message));
});

test("semantic diffはlevel・outlook・confidenceと各リストの追加削除を示す",()=>{
  const current=normalizeCoachUpdate(diagnosis(3,3));
  const changed=diagnosis(4,3.5);
  changed.coach_update.level.pass_outlook="合格圏";
  changed.coach_update.level.confidence="high";
  changed.coach_update.next_actions=[{title:"新しい訓練",purpose:"転移",practice_method:"過去問",success_condition:"参照なし"}];
  const preview=coachPreview(current,normalizeCoachUpdate(changed));
  assert.equal(preview.diff.passOutlook.after,"合格圏");
  assert.equal(preview.diff.confidence.after,"high");
  assert.deepEqual(preview.diff.nextActions.added,["新しい訓練"]);
  assert.deepEqual(preview.diff.nextActions.removed,["置換後の全式更新"]);
});

test("新Attemptは診断をstaleにし再レビューでcutoffを更新できる",()=>{
  const current=normalizeCoachUpdate(diagnosis(3));
  const attempts=[1,2,3,4].map(id=>({id,problem_id:"WB-6-A-20",date:"2026-08-17",mode:"full",time_minutes:10,mark:"○",score_label:"A",error_type:"none",error_point:"",next_action:"",memo:""}));
  const dashboard={readiness:{sampleSizes:{pastExams:0,timed:0,unseen:0}},weaknessInsights:[]};
  const state=buildCoachDiagnosisState({history:[current],attempts,concepts:[],dashboard,reviews:[],problems:[],
    planner:{phase:"foundation_to_A",daysRemaining:90,weeklyActual:{},weeklyTarget:{}},today:"2026-08-17"});
  assert.equal(state.stale,true);assert.equal(state.newAttemptCount,1);
  const refreshed=normalizeCoachUpdate(diagnosis(4,4));
  const next=buildCoachDiagnosisState({...state,history:[current,refreshed],attempts,concepts:[],dashboard,reviews:[],problems:[],
    planner:{phase:"foundation_to_A",daysRemaining:90,weeklyActual:{},weeklyTarget:{}},today:"2026-08-17"});
  assert.equal(next.stale,false);assert.equal(next.history.length,2);assert.equal(next.display.level.value,4);
});

test("confidence低は自動暫定として明示され、concept evidenceを変更しない",()=>{
  const concepts=[{conceptId:"c1",displayName:"最尤推定",state:"suspected",priorityScore:20,strongFailures:0,
    delayedNoReferenceSuccesses:0,transferSuccesses:0,evidenceSummary:[],nextRecommendedAction:"要診断"}];
  const dashboard={readiness:{sampleSizes:{pastExams:0,timed:0,unseen:0}},weaknessInsights:[]};
  const before=structuredClone(concepts);
  const state=buildCoachDiagnosisState({history:[],attempts:[],concepts,dashboard,reviews:[],problems:[],
    planner:{phase:"foundation_to_A",daysRemaining:90,weeklyActual:{},weeklyTarget:{}},today:"2026-08-17"});
  assert.equal(state.source,"local_provisional");assert.equal(state.display.level.confidence,"low");
  assert.match(state.display.level.rationale,/自動暫定/);assert.deepEqual(concepts,before);
});

test("レビューpromptは代表Attemptを12件に圧縮し精密確率を要求しない",()=>{
  const attempts=Array.from({length:20},(_,index)=>({id:index+1,problem_id:"WB-6-A-20",date:"2026-08-17",mode:"full",
    time_minutes:10,mark:"○",score_label:"A",error_type:"none",error_point:"",next_action:"",memo:""}));
  const prompt=buildCoachReviewPrompt({attempts,reviews:[],problems:[],concepts:[],dashboard:{readiness:{}},
    planner:{phase:"foundation_to_A",daysRemaining:90,weeklyActual:{},weeklyTarget:{}},today:"2026-08-17"});
  const payload=JSON.parse(prompt.match(/RECENT_REPRESENTATIVE_ATTEMPTS: (\[[^\n]+\])/)[1]);
  assert.equal(payload.length,12);assert.match(prompt,/根拠のない精密な合格確率は出さず/);
  assert.match(prompt,/"evidence_cutoff_attempt_id": 20/);
  assert.match(prompt,/JSON objectを1個だけ/);assert.doesNotMatch(prompt,/次のYAMLだけ/);
  assert.match(prompt,/ASCII double quote U\+0022/);assert.match(prompt,/typographic quotation marks/);
});
