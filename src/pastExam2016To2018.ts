import type { ExamReferencePackData, PastExamReference } from "./examReferencePack.ts";

export const PAST_EXAM_2016_2018_PACK_VERSION="STAT1-PAST-EXAM-2016-2018-v1";
export const PAST_EXAM_2016_2018_PACK_SHA256="111e65dc117d2edb6c59a307fc74aa6900b142b9062dc97c5b35c226555151c6";
export const PAST_EXAM_2016_2018_SOURCE_SHA256="c7e586e7ae77970b5e684a29a70b7be25c5e28f9b8909994ed28fd76e005b38d";

type VerifiedSupplement={
  year:number;question:number;summary:string;primarySkill:string;pages:string;fineConceptIds:string[];
};

// The wording below is copied from the user-provided structured reference pack.
// Concept IDs are restricted to the existing v1 registry; no taxonomy is inferred here.
export const VERIFIED_PAST_EXAM_2016_2018:VerifiedSupplement[]=[
  {year:2016,question:1,pages:"2-4",summary:"正規標本 Xi~N(μ,1) に対し θ=e^μ を推定する問題。尤度と最尤推定量、最尤推定量のバイアスと不偏化、MSEと一致性、Fisher情報量とクラメール・ラオ下限との比較を扱う。",primarySkill:"推定量の性質を尤度・バイアス・MSE・情報量まで一続きに処理する",fineConceptIds:["normal_distribution","maximum_likelihood","unbiased_estimation","minimum_mse","consistency","fisher_information","cramer_rao","estimator_comparison"]},
  {year:2016,question:2,pages:"5-7",summary:"指数分布 Exp(λ) の平均・上側確率・上側点を求め、λの最尤推定量からプラグイン推定量を作る。さらに独立標本和のガンマ分布を用いて上側確率の不偏推定量を構成する。",primarySkill:"分布の基本量・最尤推定・標本和の分布をつないで推定量を構成する",fineConceptIds:["exponential_distribution","gamma_distribution","maximum_likelihood","unbiased_estimation"]},
  {year:2016,question:3,pages:"8-9",summary:"原点を通る線形モデル Yi=βxi+εi で、複数のβの不偏推定量と最小二乗推定量を比較する。各推定量の期待値・分散を求め、不等式を用いて分散の大小を比較する。",primarySkill:"同じ母数に対する複数推定量を不偏性と分散で比較する",fineConceptIds:["linear_regression","least_squares","unbiased_estimation","estimator_comparison"]},
  {year:2016,question:4,pages:"10-11",summary:"θ=P(0≤Z≤1), Z~N(0,1) を乱数によるモンテカルロ法で推定する。指示関数型、対称性を利用する型、一様乱数による積分型の推定量について分散を比較し、同精度に必要な乱数個数を比較する。",primarySkill:"同じ量を推定する複数のモンテカルロ推定量を分散で比較する",fineConceptIds:["normal_distribution","uniform_distribution","estimator_comparison"]},
  {year:2016,question:5,pages:"12-14",summary:"2変量正規データでYに欠測がある状況を考え、MCARをXの平均差から検定する。検定統計量d²と一元配置分散分析のF統計量の関係、2標本両側t検定との同値性、検定結果の解釈、平均以外の分布差を調べる方法を扱う。",primarySkill:"欠測メカニズムの仮説を群間差の検定へ落とし込む",fineConceptIds:["multivariate_normal","missing_data_anova","hypothesis_test"]},
  {year:2017,question:1,pages:"16-19",summary:"一般母集団の平均・分散・歪度・尖度から、標本平均の期待値・分散・歪度・尖度を求め、大標本での挙動を確認する。正規母集団では分散の最尤推定量も扱う。",primarySkill:"標本平均の高次モーメントと大標本挙動を整理する",fineConceptIds:["unbiased_estimation","central_moments","higher_moments","maximum_likelihood","normal_distribution"]},
  {year:2017,question:2,pages:"20-21",summary:"一様分布 U(0,θ) の標本について、最大値による最尤推定、2Xbar と補正最大値による不偏推定を導き、2つの不偏推定量の分散を比較する。",primarySkill:"端点母数の推定で最大統計量と標本平均を比較する",fineConceptIds:["uniform_distribution","order_statistic_maximum","maximum_likelihood","unbiased_estimation","estimator_comparison"]},
  {year:2017,question:3,pages:"22-23",summary:"ポアソン分布について、二項分布からの極限、モーメント母関数、平均・分散、独立ポアソン和の分布、標準化後の正規極限を扱う。",primarySkill:"離散分布の極限・MGF・和・正規近似を一連で処理する",fineConceptIds:["poisson_distribution","binomial_distribution","moment_generating_function","moments_from_generating_function","reproductive_property","normal_approximation"]},
  {year:2017,question:4,pages:"24-25",summary:"独立な標準正規X,Yから Z=a+kX+Y を作り、Zの分布、XとZの相関、Xを与えたZの条件付き分布、Zを与えたXの条件付き分布を求める。",primarySkill:"正規変数の線形結合から相関と条件付き分布を導く",fineConceptIds:["normal_distribution","multivariate_normal","conditional_distribution","variable_transformation_multivariate"]},
  {year:2017,question:5,pages:"26-28",summary:"標準正規Zと独立な自由度1のカイ二乗X,Yを用い、Z²の密度、比X/Yの密度、さらに (X−Y)/(2√XY) の密度を変数変換で導き、コーシー型の密度へ到達する。",primarySkill:"1変数・2変数の変数変換で複雑な比の分布を導く",fineConceptIds:["chi_square_distribution","cauchy_distribution","variable_transformation_1d","variable_transformation_multivariate"]},
  {year:2018,question:1,pages:"30-33",summary:"正規標本の標本分散S²と標本標準偏差Sについて、S²の不偏性、カイ二乗分布のモーメントからVar(S²)、E[S]を求め、Sをσの推定量としたときのバイアスを大標本で評価する。",primarySkill:"カイ二乗分布と漸近展開を使って分散推定量の性質を調べる",fineConceptIds:["normal_distribution","chi_square_distribution","unbiased_estimation","delta_method","higher_moments"]},
  {year:2018,question:2,pages:"34-38",summary:"有限母集団からの非復元無作為抽出を指示変数で表し、各指示変数の期待値・分散・共分散、赤球個数の超幾何分布とその平均・分散を求める。後半では既知個数の球を追加して母集団サイズNを推定し、推定精度を大標本近似で評価する。",primarySkill:"非復元抽出の依存構造を指示変数と超幾何分布で処理する",fineConceptIds:["hypergeometric_distribution","finite_population_sampling","finite_population_correction","asymptotic_distribution"]},
  {year:2018,question:3,pages:"39-41",summary:"二項分布XをX≥1で条件付けた零切断二項分布を扱う。条件付き確率関数、条件付き期待値・分散、特定条件を満たすθ、条件付き標本からの最尤推定方程式とモーメント法との関係を求める。",primarySkill:"条件付きで切断された分布のモーメントと推定を一貫して処理する",fineConceptIds:["binomial_distribution","conditional_distribution","conditional_expectation","maximum_likelihood","method_of_moments"]},
  {year:2018,question:4,pages:"42-44",summary:"相関ρを持つ正規条件付き分布を用いたマルコフ型の列を扱う。周辺分布、条件付き分布の合成、XtからXt+1への遷移、X0を与えたXtの分布を導き、t→∞で標準正規へ近づくことを示す。",primarySkill:"正規条件付き分布を反復して遷移分布と極限分布を導く",fineConceptIds:["multivariate_normal","conditional_distribution","asymptotic_distribution"]},
  {year:2018,question:5,pages:"45-47",summary:"3個の独立なU(0,1)標本の順序統計量Y1≤Y2≤Y3について、最小値・最大値・中央値の密度と確率を求め、レンジZ=Y3−Y1の期待値と分散を求める。",primarySkill:"少数標本の順序統計量とレンジの分布・モーメントを扱う",fineConceptIds:["uniform_distribution","order_statistic_minimum","order_statistic_maximum","order_statistic_joint_density"]},
];

export function applyVerifiedPastExam2016To2018(data:ExamReferencePackData):ExamReferencePackData{
  const supplements=new Map(VERIFIED_PAST_EXAM_2016_2018.map(row=>[`${row.year}-${row.question}`,row]));
  const conceptIds=new Set(data.concepts.map(row=>row.concept_id));
  const upgraded=data.pastExamProblems.map(reference=>{
    const supplement=supplements.get(`${reference.year}-${reference.question_number}`);
    if(!supplement)return reference;
    const fineConceptIds=supplement.fineConceptIds.filter(id=>conceptIds.has(id));
    if(!fineConceptIds.length)throw new Error(`${reference.problem_id} を既存concept registryへ照合できません`);
    const sourceId=`${PAST_EXAM_2016_2018_PACK_VERSION}:${PAST_EXAM_2016_2018_SOURCE_SHA256}`;
    const sourceReferences=(reference.source_references||[]).some(row=>row.source_id===sourceId)
      ?reference.source_references||[]:[...(reference.source_references||[]),{source_id:sourceId,role:"verified_problem_summary"}];
    return {...reference,availability:"verified_problem",schedulable:true,gradable:true,
      title:`${supplement.year}年 統計数理 問${supplement.question}`,summary:supplement.summary,
      fine_concept_ids:fineConceptIds,exposure_default:"unknown",simulation_protection_default:false,
      source_references:sourceReferences,classification_confidence:"verified_reference_pack",
      notes:[`主要能力：${supplement.primarySkill}`,`参照パック記載ページ：${supplement.pages}`]
    } satisfies PastExamReference;
  });
  const core=upgraded.filter(row=>row.availability==="verified_problem"&&row.schedulable).length;
  const metadataOnly=upgraded.filter(row=>row.availability==="metadata_only").length;
  const dailySlots=data.plannerPolicy.daily_slots.map(row=>row.slot==="score_building"
    ?{...row,max_count:2}:row);
  return {...data,manifest:{...data.manifest,counts:{...data.manifest.counts,
    past_exam_records:upgraded.length,core_schedulable:core,metadata_only:metadataOnly}},
    pastExamProblems:upgraded,plannerPolicy:{...data.plannerPolicy,daily_slots:dailySlots},
    pastExamMetadata:{...data.pastExamMetadata,
      supplemental_pack_version:PAST_EXAM_2016_2018_PACK_VERSION,
      supplemental_pack_sha256:PAST_EXAM_2016_2018_PACK_SHA256,
      supplemental_source_sha256:PAST_EXAM_2016_2018_SOURCE_SHA256}};
}
