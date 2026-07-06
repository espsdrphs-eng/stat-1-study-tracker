import type { Review, Task } from "./types.ts";

type ReviewItem=Partial<Review&Task> & {
  canonical_problem_type?:string;
  canonical_keywords?:string[];
  answer_excerpt?:string;
};
export type ReferenceLevel=0|1|2|3|4|5;
export type ReferenceState={
  reference_level:ReferenceLevel;
  actual_reference_level:ReferenceLevel;
  no_hint:boolean;
  one_line_hint:boolean;
  previous_mistake:boolean;
  saved_gpt_feedback:boolean;
  official_answer:boolean;
  external_reference:boolean;
  gpt_explanation:boolean;
};

export const referenceLabels:Record<ReferenceLevel,string>={
  0:"見ていない",
  1:"1行ヒント",
  2:"前回ミス",
  3:"保存済みGPT解説",
  4:"公式解答",
  5:"外部参照"
};

export function emptyReferenceState():ReferenceState{
  return {
    reference_level:0,actual_reference_level:0,no_hint:true,one_line_hint:false,
    previous_mistake:false,saved_gpt_feedback:false,official_answer:false,
    external_reference:false,gpt_explanation:false
  };
}

export function referenceStateAtLevel(level:ReferenceLevel):ReferenceState{
  return {
    reference_level:level,actual_reference_level:level,no_hint:level===0,
    one_line_hint:level===1,previous_mistake:level===2,saved_gpt_feedback:level===3,
    official_answer:level===4,external_reference:level===5,gpt_explanation:level===3
  };
}

export function revealReference(current:ReferenceState,level:Exclude<ReferenceLevel,0>):ReferenceState{
  const deepest=Math.max(current.actual_reference_level,level) as ReferenceLevel;
  return {
    ...current,reference_level:deepest,actual_reference_level:deepest,no_hint:false,
    one_line_hint:current.one_line_hint||level===1,
    previous_mistake:current.previous_mistake||level===2,
    saved_gpt_feedback:current.saved_gpt_feedback||level===3,
    official_answer:current.official_answer||level===4,
    external_reference:current.external_reference||level===5,
    gpt_explanation:current.gpt_explanation||level===3
  };
}

export function normalizeReferenceState(value:Partial<ReferenceState>|undefined):ReferenceState{
  if(!value) return emptyReferenceState();
  const legacy=Number(value.reference_level??0);
  const raw=value.actual_reference_level??(
    value.external_reference?5:value.official_answer?4:value.saved_gpt_feedback||value.gpt_explanation?3:
      value.previous_mistake?2:value.one_line_hint?1:legacy
  );
  const level=Math.min(5,Math.max(0,Number(raw))) as ReferenceLevel;
  return {
    reference_level:level,actual_reference_level:level,no_hint:level===0,
    one_line_hint:!!value.one_line_hint||level===1,previous_mistake:!!value.previous_mistake||level===2,
    saved_gpt_feedback:!!value.saved_gpt_feedback||!!value.gpt_explanation||level===3,
    official_answer:!!value.official_answer||level===4,external_reference:!!value.external_reference||level===5,
    gpt_explanation:!!value.saved_gpt_feedback||!!value.gpt_explanation||level===3
  };
}

function errorsFor(item:ReviewItem){
  const errors=item.previous_errors?.filter(error=>["K","N","W","C"].includes(error))||[];
  const current=String(item.error_type||"");
  if(["K","N","W","C"].includes(current)&&!errors.includes(current)) errors.push(current);
  return errors;
}

function primaryError(item:ReviewItem){
  const errors=errorsFor(item);
  return ["K","N","W","C"].find(error=>errors.includes(error))||"none";
}

function norm(value:unknown){
  return String(value||"").replace(/\s+/g," ").trim();
}

function allText(item:ReviewItem){
  return [
    item.theme,item.canonical_problem_type,item.answer_excerpt,item.previous_error_point,
    item.previous_next_action,item.previous_improvement_guidance,item.previous_required_derivation,
    item.review_method,item.review_instruction,...(item.canonical_keywords||[])
  ].map(norm).filter(Boolean).join("。");
}

function unique(values:string[]){
  return [...new Set(values.map(norm).filter(Boolean))];
}

function keywords(item:ReviewItem){
  const fromMaster=item.canonical_keywords||[];
  const fromTheme=norm(item.theme).split(/[、，・/／\s]+/);
  const fromType=norm(item.canonical_problem_type).split(/[、，・/／\s]+/);
  return unique([...fromMaster,...fromTheme,...fromType]).filter(word=>word.length>=2).slice(0,6);
}

type SpecificPlan={
  type:string;
  target:string;
  first:string;
  next:string;
  work:string;
  caution:string;
  goal:string;
  rule:string;
};

function specificPlan(item:ReviewItem):SpecificPlan{
  const text=allText(item);
  const ks=keywords(item);
  const fallbackTarget=ks[0]||norm(item.theme).split(/[、，・]/)[0]||"この問題の主役";
  const fallbackType=norm(item.canonical_problem_type)||norm(item.theme)||"この問題";
  const has=(re:RegExp)=>re.test(text);
  if(has(/最大統計量|最小統計量|順序統計|最大値|最小値|U\(0|一様分布/)) return {
    type:has(/一様分布|U\(0/)?"一様分布の推定問題":"順序統計量の問題",
    target:has(/最小統計量|最小値/)?"最小統計量":"最大統計量",
    first:has(/最小統計量|最小値/)?"最小統計量の分布関数":"最大統計量の分布関数",
    next:"密度を出して期待値・MSE比較に進む",
    work:"分布関数から密度を出す作業",
    caution:"定義域と積分範囲",
    goal:"十分性・不偏性・MSE比較またはMLEまでの流れ",
    rule:"分布関数から密度を出してから期待値へ進む"
  };
  if(has(/指数型分布族|自然母数|期待値母数|t\(X\)|Bin|Po|Geo|NB|Beta|Ga\(/)) return {
    type:"指数型分布族の読み取り問題",
    target:"指数型分布族",
    first:"確率関数または密度関数を exp の形に直した式",
    next:"xにかかる部分を見て自然母数と十分統計量を読む",
    work:"自然母数と十分統計量を読み取る作業",
    caution:"自然母数と期待値母数を混同しないこと",
    goal:"各分布の自然母数・十分統計量・期待値母数の対応",
    rule:"expの形に直して、xにかかる部分から読む"
  };
  if(has(/AIC|自由パラメータ|最大対数尤度|モデル比較/)) return {
    type:"AIC比較の問題",
    target:"AIC",
    first:"AICに入れる最大対数尤度と自由パラメータ数",
    next:"それぞれを分けて確認して比較する",
    work:"最大対数尤度と自由パラメータ数を分ける作業",
    caution:"自由パラメータ数を数え間違えないこと",
    goal:"AICでどのモデルを選ぶか",
    rule:"最大対数尤度と自由パラメータ数を別々に確認する"
  };
  if(has(/対数尤度|尤度|最尤|MLE|二階微分|最大化/)) return {
    type:"最尤推定の問題",
    target:"対数尤度",
    first:"対数尤度",
    next:"パラメータを含む項だけを残して微分する",
    work:"微分して最尤推定量を出す作業",
    caution:"最大化条件とパラメータ範囲",
    goal:"最尤推定量またはバイアス・MSEへの接続",
    rule:"対数尤度を書き、パラメータを含む項だけを微分する"
  };
  if(has(/Fisher|フィッシャー|CR|クラメール|情報量/)) return {
    type:"Fisher情報量とCR下限の問題",
    target:"Fisher情報量",
    first:"対数尤度の微分または二階微分",
    next:"Fisher情報量を出してCR下限と比較する",
    work:"Fisher情報量を計算してCR下限と比較する作業",
    caution:"期待値を取る位置と標本サイズ",
    goal:"CR下限との一致・不一致",
    rule:"Fisher情報量を出してからCR下限と分散を比較する"
  };
  if(has(/変数変換|ヤコビ|Jacobian|定義域|値域|密度変換/)) return {
    type:"変数変換の問題",
    target:"変数変換後の変数",
    first:"変換後の変数が取る範囲",
    next:"ヤコビアンと密度の定義域を確認する",
    work:"定義域を固定して密度を変換する作業",
    caution:"変換後の範囲と記号統一",
    goal:"変換後の密度または分布",
    rule:"密度を書く前に、新しい変数の範囲を1行で書く"
  };
  if(has(/添字|二重和|和の順序|積分範囲|期待値表示|尾確率|1-F/)) return {
    type:"和・積分範囲の変形問題",
    target:"和または積分の範囲",
    first:"外側と内側の添字範囲",
    next:"順序を入れ替えて尾確率または積分範囲へつなぐ",
    work:"添字範囲を固定して和の順序を入れ替える作業",
    caution:"不等号の向きと端点",
    goal:"期待値表示または尾確率表示",
    rule:"添字を固定し、範囲を書き換えてから内側の和を見る"
  };
  if(has(/回帰|残差平方和|平方和|相関係数|分散分解/)) return {
    type:"回帰・分散分解の問題",
    target:"残差平方和",
    first:"モデル式と残差平方和",
    next:"期待値または分散分解に進む",
    work:"残差平方和を分解して期待値へつなげる作業",
    caution:"自由度と直交分解",
    goal:"不偏分散推定量または検定量",
    rule:"モデル式から残差平方和を置き、自由度を確認して進む"
  };
  if(has(/exact|棄却域|検定|LRT|尤度比|MP|サイズ|検出力/)) return {
    type:"検定の問題",
    target:"検定統計量または棄却域",
    first:"帰無仮説と対立仮説",
    next:"検定統計量を作り棄却域の形にする",
    work:"棄却域を組む作業",
    caution:"サイズと検出力の条件",
    goal:"棄却域または検定の結論",
    rule:"仮説を固定してから検定統計量と棄却域を作る"
  };
  if(has(/信頼区間|区間推定|ピボット|信頼係数/)) return {
    type:"区間推定の問題",
    target:"ピボット量",
    first:"ピボット量とその分布",
    next:"確率不等式をパラメータについて解く",
    work:"ピボット量から信頼区間へ変形する作業",
    caution:"不等号の向きと信頼係数",
    goal:"信頼区間の形",
    rule:"ピボット量の分布を置いてからパラメータについて解く"
  };
  return {
    type:fallbackType,
    target:fallbackTarget,
    first:`${fallbackTarget}に関する出発式`,
    next:"問題で求める量へ進む",
    work:`${fallbackTarget}に関する主要な作業`,
    caution:ks[1]?`${ks[1]}との混同`:"条件・定義域・記号",
    goal:ks[2]?`${ks[2]}までの流れ`:"最後に示す結論の種類",
    rule:`${fallbackTarget}を先に置いてから、条件を確認して進む`
  };
}

export function allowedReferenceLevel(item:ReviewItem):ReferenceLevel{
  const mode=String(item.mode||"");
  const error=primaryError(item);
  if(item.requires_full_answer||mode==="full"||mode==="exam_90min"||mode==="scan") return 0;
  if(["N","W","C"].includes(error)) return 2;
  if(error==="K") return 2;
  return 1;
}

export function referencePolicy(item:ReviewItem){
  switch(primaryError(item)){
    case "K": return "まず何も見ずに骨格を書きます。詰まった箇所を特定した場合だけ前回ミスまで確認し、表示を隠してからもう一度再現してください。";
    case "N": return "前回ミスや不足していた説明の確認は補修の一部です。確認後は表示を隠して骨格を再現してください。";
    case "W": return "前回落とした作業箇所を確認してから、表示を隠して同じ計算を再演習してください。";
    case "C": return "前回の確認漏れを見て、答えではなく再発防止のチェック項目に変換してください。";
    default: return item.requires_full_answer
      ?"制限時間終了まで参照しません。参照前の答案を確定してから補修してください。"
      :"型・初手・今見る量を先に確認し、必要な場合だけ1行ヒントを使ってください。";
  }
}

export type ReferenceDecision={
  result:"success"|"partial"|"failed";
  allowed:ReferenceLevel;
  actual:ReferenceLevel;
  exceedsAllowed:boolean;
  canComplete:boolean;
  shortenReview:boolean;
  message:string;
};

export function referenceDecision(
  requested:"success"|"partial"|"failed",
  allowed:ReferenceLevel,
  actual:ReferenceLevel,
  referenceClosedReproduction:boolean
):ReferenceDecision{
  const exceedsAllowed=actual>allowed;
  let result=requested;
  if(requested==="success"&&actual>0&&!referenceClosedReproduction) result="partial";
  if(requested==="success"&&exceedsAllowed&&actual>=3) result="partial";
  const canComplete=result==="success";
  const shortenReview=exceedsAllowed;
  const message=!referenceClosedReproduction&&actual>0
    ?"参照表示を隠した後の白紙再現が未確認のため、完了扱いにしません。"
    :!exceedsAllowed
      ?"許可範囲内の参照です。補修復習として通常どおり保存できます。"
      :actual<=2
        ?"許可範囲を少し超えています。再現できていれば完了可能ですが、次回間隔を軽く短縮します。"
        :"強い参照を使用したため、完了扱いにせず短期再確認にします。";
  return {result,allowed,actual,exceedsAllowed,canComplete,shortenReview,message};
}

export function referenceCompletion(
  requested:"success"|"partial"|"failed",
  reference:ReferenceState,
  referenceClosedReproduction:boolean,
  allowed:ReferenceLevel=0
){
  return referenceDecision(requested,allowed,reference.actual_reference_level,referenceClosedReproduction).result;
}

export function referenceReviewInterval(actual:ReferenceLevel,allowed:ReferenceLevel=0){
  if(actual<=allowed) return undefined;
  if(actual>=3) return 3;
  return 7;
}

export function correctionTheme(item:ReviewItem){
  const plan=specificPlan(item),mode=String(item.mode||""),error=primaryError(item);
  if(item.requires_full_answer||mode==="full"||mode==="exam_90min")
    return `${plan.first}から${plan.work}を進め、最後に${plan.goal}まで答案として接続する。`;
  if(mode==="check"||error==="C"||error==="none")
    return `${plan.type}の型として、${plan.first}を先に確認し、${plan.caution}に注意する。`;
  if(mode==="main_calc"||error==="W")
    return `${plan.target}について、${plan.work}を、${plan.caution}に注意して再現する。`;
  return `${plan.type}として、${plan.target}を主役にし、${plan.first}から${plan.goal}へ進む骨格を作る。`;
}

export function referenceEntryPoint(item:ReviewItem){
  const plan=specificPlan(item);
  return `まず${plan.first}を書き、そこから${plan.next}。`;
}

export function correctionRuleExample(item:ReviewItem){
  return item.previous_next_action||item.previous_improvement_guidance||
    (primaryError(item)==="N"?"省略した部分は、直前の式から理由を1行添えてつなぐ。":
      primaryError(item)==="W"?"計算前に範囲・添字・符号を固定してから式変形を始める。":
        primaryError(item)==="C"?"答案を閉じる前に、条件・符号・係数を1項目ずつ確認する。":
          "問題文から方針・出発式・今見る量を先に書く。");
}

export function reviewAim(item:ReviewItem){
  const plan=specificPlan(item);
  if(item.mode==="check") return `${plan.type}で、${plan.target}を見ればよいか短時間で確認する。`;
  switch(primaryError(item)){
    case "K": return `${plan.type}として、${plan.first}から${plan.goal}までの設計図を作れるか確認する。`;
    case "N": return `${plan.target}の説明不足を補い、${plan.first}から次へ進む根拠を答案上に残せるか確認する。`;
    case "W": return `${plan.target}の${plan.work}を、${plan.caution}に注意してやり直せるか確認する。`;
    case "C": return `${plan.target}で起きやすい確認漏れを、${plan.caution}のチェック項目に変える。`;
    default: return `${plan.type}で、${plan.target}を見ればよいか短時間で確認する。`;
  }
}

export function todayMove(item:ReviewItem){
  if(item.requires_full_answer) return "制限時間で答案化 → 範囲・条件・結論を確認";
  if(item.mode==="check") return "型・初手・今見る量 → 注意点を1つ確認";
  switch(primaryError(item)){
    case "K": return "何も見ずに骨格を書く → 詰まった箇所を特定 → 表示を隠して再現";
    case "N": return "修正テーマ確認 → 修正ルール1行 → 表示を隠して骨格再現";
    case "W": return "前回の作業箇所を確認 → 該当作業だけ再演習 → 表示を隠して再現";
    case "C": return "確認漏れをチェック項目化 → 型・初手・今見る量を確認";
    default: return "型・初手・今見る量 → 注意点を1つ確認";
  }
}

export function safeReviewActions(item:ReviewItem){
  const plan=specificPlan(item);
  if(item.requires_full_answer) return [
    `${plan.first}と${plan.caution}を確認してから、制限時間内で答案を書く`,
    `最後に${plan.goal}と条件の対応を確認する`
  ];
  if(item.mode==="check") return [`${plan.type}の初手として${plan.first}を確認する`,`${plan.caution}を1つ確認する`];
  switch(primaryError(item)){
    case "K": return [
      `何も見ずに、${plan.target}を主役にした方針・出発式・条件・流れを書く`,
      `詰まった箇所だけを特定し、参照表示を隠して${plan.goal}までの骨格をもう一度書く`
    ];
    case "N": return [
      `${plan.target}について、次回も使える修正ルールを1行書く`,
      `参照表示を隠してから、${plan.first}から始まる骨格を再現する`
    ];
    case "W": return [
      `${plan.target}の${plan.work}だけを確認して再演習する`,
      `参照表示を隠し、同じ作業を${plan.caution}つきでもう一度書く`
    ];
    case "C": return [`${plan.caution}をチェック項目にする`,`${plan.type}の初手として${plan.first}を確認する`];
    default: return [`${plan.type}の初手として${plan.first}を確認する`,`${plan.caution}を1つ確認する`];
  }
}

export function completionChecklist(item:ReviewItem){
  const mode=String(item.mode||"");
  const plan=specificPlan(item);
  if(mode==="scan") return ["5問の初手を確認した","選ぶ3問と捨てる2問を決めた","捨てる理由を1行で書いた"];
  if(item.requires_full_answer||mode==="full"||mode==="exam_90min") return [
    `${plan.first}と${plan.caution}を確認してから答案を書いた`,
    `最後に${plan.goal}との対応を確認した`
  ];
  if(mode==="check") return [`${plan.type}の型・初手を確認した`,`${plan.caution}を1つ確認した`];
  switch(primaryError(item)){
    case "K": return [`まず何も見ずに${plan.target}を使う骨格を書いた`,`詰まった箇所を特定した`,`表示を隠してから、${plan.target}の骨格をもう一度書いた`];
    case "N": return [`修正テーマ（${plan.target}）を確認した`,`${plan.rule}、という修正ルールを1行書いた`,`表示を隠してから、${plan.first}から骨格を再現した`];
    case "W": return [`${plan.target}の作業箇所を確認した`,`該当作業だけを再演習した`,`表示を隠してから、${plan.work}をもう一度書いた`];
    default: return [`${plan.type}の型・初手を確認した`,`${plan.caution}を1つ確認した`];
  }
}

export function reviewFormat(item:ReviewItem){
  if(item.requires_full_answer||item.mode==="full"||item.mode==="exam_90min")
    return "今回の復習形式：フル答案。途中式・条件・計算・結論まで書く。";
  if(item.mode==="scan") return "今回の復習形式：5問スキャン。解き切らず、選題判断だけを行う。";
  const method=item.review_method||"";
  if(method.includes("作業")||method.includes("局所")||item.review_type==="main_calc_retry")
    return "今回の復習形式：作業確認のみ。最初から全部解き直さない。";
  if(method.includes("チェック")||method.includes("3分")||["careless_check","light_check"].includes(String(item.review_type)))
    return "今回の復習形式：チェックのみ。3〜5分で確認する。";
  return "今回の復習形式：骨格シートのみ。最終式・完成答案は書かない。";
}

export function oneLineHint(item:ReviewItem){
  const plan=specificPlan(item);
  return `まず${plan.first}を書き、そこから${plan.next}。`;
}
