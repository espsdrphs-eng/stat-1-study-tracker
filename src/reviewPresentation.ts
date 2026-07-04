import type { Review, Task } from "./types.ts";

type ReviewItem=Partial<Review&Task>;
export type ReviewTemplate={
  sheetMode:string;
  sheetLabel:string;
  title:string;
  fields:Array<{label:string;hint:string}>;
};

export function reviewMode(item:ReviewItem){
  if(item.requires_full_answer) return "exam_90min";
  if(item.mode) return item.mode;
  if(item.review_type==="main_calc_retry") return "main_calc";
  if(item.review_type==="careless_check") return "scan";
  return "skeleton";
}

export function reviewTemplate(item:ReviewItem):ReviewTemplate{
  const method=item.review_method||"";
  const mode=reviewMode(item);
  if(method.includes("省略部分の局所再現")) return {
    sheetMode:"main_calc",sheetLabel:"主要計算シート",title:"今回書く欄",
    fields:[
      {label:"直前の式・条件",hint:"省略箇所へ入る直前の式、範囲、添字を書く"},
      {label:"必要な式変形",hint:"結果までを理由付きで途中式にする"},
      {label:"自力再現",hint:"答を隠し、その部分だけもう一度書く"}
    ]
  };
  if(method.includes("骨格再現＋")) return {
    sheetMode:"skeleton",sheetLabel:"骨格シート",title:"骨格の5項目",
    fields:[
      {label:"型",hint:"問題の型を一言で書く"},
      {label:"出発式",hint:"最初に置く式を書く"},
      {label:"主役",hint:"統計量・変数を決める"},
      {label:"条件・定理",hint:"使う条件と定理を書く"},
      {label:"結論",hint:"最後に示す形を書く"}
    ]
  };
  if(method.includes("ノート補修")) return {
    sheetMode:"skeleton",sheetLabel:"骨格シート",title:"ノート補修＋骨格",
    fields:[
      {label:"修正ルール1行",hint:"次回必ず書く規則を1行にする"},
      {label:"不足していた説明",hint:"前回省略した式または説明を補う"},
      {label:"骨格",hint:"出発式から結論の形まで自力で書く"}
    ]
  };
  if(method.includes("該当作業")) return {
    sheetMode:"main_calc",sheetLabel:"主要計算シート",title:"作業部分だけ",
    fields:[
      {label:"計算の入口",hint:"落とした作業の直前の式を書く"},
      {label:"途中計算",hint:"積分・和・変形・場合分けを省略せず書く"},
      {label:"検算",hint:"範囲、添字、符号、係数を確認する"}
    ]
  };
  if(method.includes("チェックリスト")) return {
    sheetMode:"scan",sheetLabel:"軽い確認",title:"再発防止欄",
    fields:[
      {label:"今回のミス",hint:"符号・係数・条件などを一言で書く"},
      {label:"確認項目",hint:"次回見るチェック項目を1つ作る"},
      {label:"該当箇所",hint:"問題の該当部分だけ見直す"}
    ]
  };
  if(method.includes("3分")||method.includes("骨格確認")||method.includes("骨格再構築")||method.includes("復旧")) return {
    sheetMode:"skeleton",sheetLabel:"骨格シート",title:"S問題の確認欄",
    fields:[
      {label:"型",hint:"何の型か一言で書く"},
      {label:"出発式",hint:"最初の式を書く"},
      {label:"主役・条件",hint:"統計量と必要条件を確認する"}
    ]
  };
  if(method.includes("過去問")||item.requires_full_answer) return {
    sheetMode:mode,sheetLabel:mode==="exam_90min"?"90分答案シート":"過去問シート",title:"過去問補修欄",
    fields:[
      {label:"最大失点要因",hint:"落とした型または時間配分を書く"},
      {label:"戻るA/S",hint:"補修する白本問題IDを書く"},
      {label:"今回の修正",hint:"答案化または選題で直す点を1つ書く"}
    ]
  };
  return {
    sheetMode:mode,sheetLabel:mode==="main_calc"?"主要計算シート":"骨格シート",title:"今回の確認欄",
    fields:[
      {label:"出発式",hint:"最初に使う式を書く"},
      {label:"見るポイント",hint:"今回の狙いに対応する部分だけ確認する"},
      {label:"確認結果",hint:"自力で再現できたか記録する"}
    ]
  };
}
