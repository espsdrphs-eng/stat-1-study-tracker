import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCanonicalMaster, consistencyScore, isProblemPack, parseAliasesPayload,
  parseAnswerIndexPayload, parseIntegratedMasterPayload, parseProblemMasterPayload, relatedSIntegrity
} from "../src/masterData.ts";

const rawProblems={version:"mathstat-master-v1",problems:[
  {problem_id:"WB-6-S-01",display_label:"第6章S問1",type:"S",chapter:"第6章",problem_number:1,
    theme:"指数型分布族・自然母数・期待値母数",canonical_problem_type:"指数型分布族の読み取り",
    canonical_keywords:["指数型分布族","自然母数","期待値母数","Bin","Po","Geo","NB","Beta"],related_s_problems:[],answer_available:true},
  {problem_id:"WB-6-S-04",display_label:"第6章S問4",type:"S",chapter:"第6章",problem_number:4,
    theme:"U(0,θ)、十分統計量、不偏推定量、MSE、MLE",canonical_problem_type:"一様分布の推定・十分統計量・MSE比較",
    canonical_keywords:["U(0,θ)","最大統計量","十分統計量","不偏推定量","MSE","MLE"],related_s_problems:[],answer_available:true}
]};
const rawAnswers={version:"mathstat-answers-v1",answers:[
  {problem_id:"WB-6-S-01",answer_available:true,answer_excerpt:"Bin Po Geo NB Beta を指数型分布族の形にして自然母数と期待値母数を読む",canonical_keywords:["指数型分布族","自然母数","Bin","Po","Geo","NB","Beta"]},
  {problem_id:"WB-6-S-04",answer_available:true,answer_excerpt:"U(0,θ) の最大統計量、十分統計量、不偏推定量、MSE、MLEを扱う",canonical_keywords:["U(0,θ)","最大統計量","十分統計量","MSE","MLE"]}
]};

test("problem_master と answer_index のスキーマを正規化する",()=>{
  const master=parseProblemMasterPayload(rawProblems),answers=parseAnswerIndexPayload(rawAnswers);
  assert.equal(master.problems[0].chapter,6);
  assert.equal(master.problems[1].theme,"U(0,θ)、十分統計量、不偏推定量、MSE、MLE");
  assert.equal(answers.answers[0].problem_id,"WB-6-S-01");
});

test("S4に指数型分布族が貼られた場合はS1候補を出し、表示テーマをS4正本へ補正する",()=>{
  const problems=parseProblemMasterPayload(rawProblems).problems.map((problem,index)=>({
    id:index+1,source_type:"whitebook",priority:"core",role:"foundation",recommended_mode:"skeleton",
    linked_past_exams:"",linked_s_problems:"",linked_a_problems:"",notes:"",completion_status:"active",
    ...problem
  }));
  const answers=parseAnswerIndexPayload(rawAnswers).answers;
  const update={problem_id:"WB-6-S-04",date:"2026-07-06",mode:"skeleton",mark:"△",score_label:"B",
    error_type:"N",error_point:"自然母数の読み取り",next_action:"指数型分布族を整理する",
    display_label:"第6章S問4",category:"S",themes:["指数型分布族","自然母数","Bin","Po","Geo","NB","Beta"],
    theme:"指数型分布族・自然母数",source_text:"Bin Po Geo NB Beta の自然母数と期待値母数"};
  const result=applyCanonicalMaster(update,problems[1],answers[1],problems,answers);
  assert.equal(result.theme,"U(0,θ)、十分統計量、不偏推定量、MSE、MLE");
  assert.equal(result.suggested_problem_id,"WB-6-S-01");
  assert.equal(result.requires_problem_confirmation,true);
  assert.ok(consistencyScore(update,problems[0],answers[0])>consistencyScore(update,problems[1],answers[1]));
});

test("統合JSONの4キーと短縮配列名を読み込める",()=>{
  const pack=parseIntegratedMasterPayload({
    version:"stat1_problem_pack_with_past",
    problem_master:rawProblems,
    answer_index:rawAnswers,
    problem_aliases:{"第6章S問1":"WB-6-S-01"},
    import_guide:{source:"ChatGPT"}
  });
  assert.equal(pack.problemMaster?.problems.length,2);
  assert.equal(pack.answerIndex?.answers.length,2);
  assert.equal(pack.aliases?.aliases[0].problem_id,"WB-6-S-01");
  assert.deepEqual(pack.importGuide,{source:"ChatGPT"});

  const short=parseIntegratedMasterPayload({
    problems:rawProblems.problems,answers:rawAnswers.answers,
    aliases:[{alias:"6章S1",problem_id:"WB-6-S-01"}]
  });
  assert.equal(short.problemMaster?.problems.length,2);
  assert.equal(short.answerIndex?.answers.length,2);
  assert.equal(short.aliases?.aliases.length,1);
  assert.equal(parseIntegratedMasterPayload({
    problem_aliases:{version:"aliases-v2",aliases:[{alias:"S1",problem_id:"WB-6-S-01"}]}
  }).aliases?.version,"aliases-v2");
});

test("問題エイリアスを配列とマップの両方から正規化する",()=>{
  assert.equal(parseAliasesPayload({aliases:[{alias:"第6章S問4",problem_id:"WB-6-S-04"}]}).aliases[0].problem_id,"WB-6-S-04");
  assert.equal(parseAliasesPayload({problem_aliases:{"6-S-4":"WB-6-S-04"}}).aliases[0].alias,"6-S-4");
});

test("問題パックとアプリ全体バックアップを区別する",()=>{
  assert.equal(isProblemPack({problem_master:rawProblems}),true);
  assert.equal(isProblemPack({problems:rawProblems.problems,answers:rawAnswers.answers}),true);
  assert.equal(isProblemPack({problems:rawProblems.problems,attempts:[],reviews:[],settings:{}}),false);
});

test("関連Sの自己参照は削除し、正本にない関連指定はID要確認に保留する",()=>{
  assert.deepEqual(relatedSIntegrity("WB-6-S-01","WB-6-S-01",[]),{
    state:"self_reference",recommended_action:"remove"
  });
  assert.deepEqual(relatedSIntegrity("WB-6-A-29","WB-6-S-01",[]),{
    state:"id_review_needed",recommended_action:"hold"
  });
  assert.equal(relatedSIntegrity("WB-6-A-29","WB-6-S-01",["WB-6-S-01"]).state,"valid");
});
