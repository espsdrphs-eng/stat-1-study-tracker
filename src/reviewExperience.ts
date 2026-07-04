import type { Review, Task } from "./types.ts";

type ReviewItem=Partial<Review&Task>;
export type ReferenceLevel=1|2|3|4|5;
export type ReferenceState={
  reference_level:ReferenceLevel;
  no_hint:boolean;
  one_line_hint:boolean;
  previous_mistake:boolean;
  official_answer:boolean;
  gpt_explanation:boolean;
};

export const referenceLabels:Record<ReferenceLevel,string>={
  1:"ヒントなし",
  2:"1行ヒント",
  3:"前回ミスを確認",
  4:"公式解答を確認",
  5:"GPT解説を確認"
};

export function emptyReferenceState():ReferenceState{
  return {
    reference_level:1,no_hint:true,one_line_hint:false,previous_mistake:false,
    official_answer:false,gpt_explanation:false
  };
}

export function referenceStateAtLevel(level:ReferenceLevel):ReferenceState{
  return {
    reference_level:level,
    no_hint:level===1,
    one_line_hint:level===2,
    previous_mistake:level===3,
    official_answer:level===4,
    gpt_explanation:level===5
  };
}

export function revealReference(current:ReferenceState,level:Exclude<ReferenceLevel,1>):ReferenceState{
  return {
    ...current,
    reference_level:Math.max(current.reference_level,level) as ReferenceLevel,
    no_hint:false,
    one_line_hint:current.one_line_hint||level===2,
    previous_mistake:current.previous_mistake||level===3,
    official_answer:current.official_answer||level===4,
    gpt_explanation:current.gpt_explanation||level===5
  };
}

export function normalizeReferenceState(value:Partial<ReferenceState>|undefined):ReferenceState{
  const base=emptyReferenceState();
  if(!value) return base;
  const level=Math.min(5,Math.max(1,Number(value.reference_level||1))) as ReferenceLevel;
  return {
    reference_level:level,
    no_hint:level===1,
    one_line_hint:!!value.one_line_hint,
    previous_mistake:!!value.previous_mistake,
    official_answer:!!value.official_answer,
    gpt_explanation:!!value.gpt_explanation
  };
}

export function referenceCompletion(
  requested:"success"|"partial"|"failed",
  reference:ReferenceState,
  afterReferenceReproduced:boolean
){
  if(requested!=="success") return requested;
  if(reference.reference_level>=3) return "partial" as const;
  if(reference.reference_level===2&&!afterReferenceReproduced) return "partial" as const;
  return "success" as const;
}

export function referenceReviewInterval(level:ReferenceLevel){
  if(level>=4) return 3;
  if(level===3) return 2;
  return undefined;
}

function primaryError(item:ReviewItem){
  const errors=item.previous_errors?.filter(error=>["K","N","W","C"].includes(error))||[];
  return ["K","N","W","C"].find(error=>errors.includes(error))||
    (["K","N","W","C"].includes(String(item.error_type))?String(item.error_type):"none");
}

export function reviewAim(item:ReviewItem){
  switch(primaryError(item)){
    case "K": return "問題文だけから、型・出発式・必要条件を自力で組み立てられるか確認する。";
    case "N": return "前回不足した説明や途中式を、答えを見ずに答案として再現できるか確認する。";
    case "W": return "落とした作業を、範囲・条件・符号に注意して自力でやり直せるか確認する。";
    case "C": return "同じ型で確認項目を使い、ケアレスミスを防げるか確認する。";
    default: return "型・初手・今見る量・注意点を短時間で自力確認する。";
  }
}

export function todayMove(item:ReviewItem){
  if(item.requires_full_answer) return "制限時間で答案化 → 参照前の答案を確定 → GPT採点";
  switch(primaryError(item)){
    case "K": return "ヒントなしで骨格を書く → 必要なら1行ヒント → GPT採点";
    case "N": return "修正ルール1行 → 骨格シート → GPT採点";
    case "W": return "作業部分だけ再演習 → 自力でもう一度 → GPT採点";
    case "C": return "確認項目を1つ決める → 該当箇所だけ確認 → 結果を記録";
    default: return "3〜5分で骨格確認 → 問題なければ結果を記録";
  }
}

export function safeReviewActions(item:ReviewItem){
  if(item.requires_full_answer) return [
    "制限時間内は何も参照せず、答案を確定する",
    "参照前の答案をGPTで採点し、失点箇所だけ補修する"
  ];
  switch(primaryError(item)){
    case "K": return [
      "問題文だけを見て、方針・出発式・今見る量・条件・道具・流れを書く",
      "最後に示すことを種類・方向だけで書き、具体的な最終式は出さない",
      "詰まった場合も、最初は1行ヒントまでに留める"
    ];
    case "N": return [
      "次回も使える修正ルールを、自分の言葉で1行書く",
      "不足していた説明を含む骨格を、何も見ずに再現する"
    ];
    case "W": return [
      "落とした作業部分だけを再演習する",
      "同じ作業を、範囲・条件・符号を確認してもう一度書く"
    ];
    case "C": return [
      "再発防止の確認項目を1つ作る",
      "問題全体ではなく、該当箇所だけを短時間で見直す"
    ];
    default: return [
      "型・初手・今見る量・注意点だけを確認する",
      "問題なければフル答案には進まず終了する"
    ];
  }
}

export function completionChecklist(item:ReviewItem){
  if(item.requires_full_answer) return [
    "制限時間まで答えやヒントを見なかった",
    "参照前の答案を確定した",
    "GPT採点を実行した",
    "復習結果を保存した"
  ];
  switch(primaryError(item)){
    case "K": return [
      "方針・出発式・今見る量・条件・道具・流れを書いた",
      "最後に示すことを具体式なしで書いた",
      "ここから先は計算と区切った",
      "必要部分を何も見ずに再現した",
      "GPT採点を実行した",
      "復習結果を保存した"
    ];
    case "N": return [
      "修正ルールを1行書いた",
      "ヒントなしで骨格を書いた",
      "前回不足した点を自分の言葉で説明できた",
      "GPT採点を実行した",
      "復習結果を保存した"
    ];
    case "W": return [
      "落とした作業部分だけを再演習した",
      "同じ作業を何も見ずにもう一度書いた",
      "範囲・符号・条件を確認した",
      "GPT採点を実行した",
      "復習結果を保存した"
    ];
    case "C": return [
      "再発防止の確認項目を1つ作った",
      "該当箇所だけを見直した",
      "結果を記録した"
    ];
    default: return [
      "型・初手・今見る量・注意点を自力で確認した",
      "必要以上に解き直さなかった",
      "復習結果を保存した"
    ];
  }
}

export function reviewFormat(item:ReviewItem){
  if(item.requires_full_answer) return "今回の復習形式：フル答案。本番と同じ制限時間で、参照前の答案を採点する。";
  const method=item.review_method||"";
  if(method.includes("作業")||method.includes("局所")||item.review_type==="main_calc_retry")
    return "今回の復習形式：作業確認のみ。最初から全部解き直さない。";
  if(method.includes("チェック")||method.includes("3分")||item.review_type==="careless_check")
    return "今回の復習形式：チェックのみ。3〜5分で確認する。";
  return "今回の復習形式：骨格シートのみ。フル答案は不要。";
}

export function oneLineHint(item:ReviewItem){
  switch(primaryError(item)){
    case "K": return "問題文の条件から、使う統計量と最初の式を1つずつ置いてください。";
    case "N": return "結論ではなく、直前の式から次の式へ進む根拠を1行補ってください。";
    case "W": return "計算範囲・添字・符号のうち、途中で変化したものを先に確認してください。";
    case "C": return "計算を始める前に、最後に確認する項目を1つ決めてください。";
    default: return "型・出発式・結論の3点だけを順に確認してください。";
  }
}
