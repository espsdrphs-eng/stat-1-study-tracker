import type { Review, Task } from "./types.ts";

type ReviewItem=Partial<Review&Task>;
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
  const source=String(item.previous_error_point||"");
  if(/定義域|値域|範囲/.test(source)&&/変数変換|密度|ヤコビ/.test(source)) return "変数変換後の定義域を確認する";
  if(/添字|和の範囲|積分範囲/.test(source)) return "添字や計算範囲を先に固定する";
  if(/Fisher|フィッシャー|CR|クラメール/.test(source)) return "Fisher情報量とCR下限の比較手順を確認する";
  if(/対数尤度|二階微分/.test(source)) return "対数尤度から二階微分までの流れを確認する";
  switch(primaryError(item)){
    case "K": return "答案の設計図を自力で再構築する";
    case "N": return "途中式・説明の省略を減らす";
    case "W": return "落とした計算過程を途中式付きで再現する";
    case "C": return "確認漏れをチェックリスト化する";
    default: return "型・初手・今見る量を短時間で確認する";
  }
}

export function correctionRuleExample(item:ReviewItem){
  return item.previous_next_action||item.previous_improvement_guidance||
    (primaryError(item)==="N"?"省略した部分は、直前の式から理由を1行添えてつなぐ。":
      primaryError(item)==="W"?"計算前に範囲・添字・符号を固定してから式変形を始める。":
        primaryError(item)==="C"?"答案を閉じる前に、条件・符号・係数を1項目ずつ確認する。":
          "問題文から方針・出発式・今見る量を先に書く。");
}

export function reviewAim(item:ReviewItem){
  if(item.mode==="check") return "型・初手・今見る量・注意点を短時間で確認する。";
  switch(primaryError(item)){
    case "K": return "問題文だけから、方針・出発式・必要条件を自力で組み立てられるか確認する。";
    case "N": return "不足していた説明を補い、答案の設計図として再現できるか確認する。";
    case "W": return "落とした作業を、範囲・条件・符号に注意してやり直せるか確認する。";
    case "C": return "同じ型で確認項目を使い、ケアレスミスを防げるか確認する。";
    default: return "型・初手・今見る量・注意点を短時間で確認する。";
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
  if(item.requires_full_answer) return [
    "方針と条件を確認してから、制限時間内で答案を書く",
    "最後に範囲・条件・結論の対応を確認する"
  ];
  if(item.mode==="check") return ["型・初手・今見る量を短く確認する","注意点を1つ確認する"];
  switch(primaryError(item)){
    case "K": return [
      "何も見ずに、方針・出発式・今見る量・条件・道具・流れを書く",
      "詰まった箇所だけを特定し、参照表示を隠して骨格をもう一度書く"
    ];
    case "N": return [
      "修正テーマを確認し、次回も使える修正ルールを1行書く",
      "参照表示を隠してから、最終式を含まない骨格を再現する"
    ];
    case "W": return [
      "前回落とした作業部分だけを確認して再演習する",
      "参照表示を隠し、同じ作業を範囲・条件・符号付きでもう一度書く"
    ];
    case "C": return ["確認漏れを1つチェック項目にする","型・初手・今見る量を短く確認する"];
    default: return ["型・初手・今見る量を短く確認する","注意点を1つ確認する"];
  }
}

export function completionChecklist(item:ReviewItem){
  const mode=String(item.mode||"");
  if(mode==="scan") return ["5問の初手を確認した","選ぶ3問と捨てる2問を決めた","捨てる理由を1行で書いた"];
  if(item.requires_full_answer||mode==="full"||mode==="exam_90min") return [
    "方針・条件を確認してから答案を書いた",
    "最後に範囲・条件・結論の対応を確認した"
  ];
  if(mode==="check") return ["型・初手・今見る量を確認した","注意点を1つ確認した"];
  switch(primaryError(item)){
    case "K": return ["まず何も見ずに骨格を書いた","詰まった箇所を特定した","表示を隠してから、骨格をもう一度書いた"];
    case "N": return ["修正テーマを確認した","修正ルールを1行書いた","表示を隠してから、骨格を再現した"];
    case "W": return ["前回落とした作業箇所を確認した","該当作業だけを再演習した","表示を隠してから、同じ作業をもう一度書いた"];
    default: return ["型・初手・今見る量を確認した","注意点を1つ確認した"];
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
  switch(primaryError(item)){
    case "K": return "問題文の条件から、今見る量と出発式を1つずつ置いてください。";
    case "N": return "結論ではなく、直前の式から次の式へ進む根拠を1行補ってください。";
    case "W": return "計算範囲・添字・符号のうち、途中で変化したものを先に確認してください。";
    case "C": return "計算を始める前に、最後に確認する項目を1つ決めてください。";
    default: return "型・初手・今見る量の3点だけを順に確認してください。";
  }
}
