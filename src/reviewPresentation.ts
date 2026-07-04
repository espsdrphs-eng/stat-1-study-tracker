import type { Review, Task } from "./types.ts";

type ReviewItem=Partial<Review&Task>;
export type ReviewTemplate={
  sheetMode:string;
  sheetLabel:string;
  title:string;
  fields:Array<{label:string;hint:string}>;
};
const skeletonFields=[
  {label:"方針・入口",hint:"何を使って進めるかを一言で書く"},
  {label:"出発式",hint:"最初に置く式を書く"},
  {label:"今見る量",hint:"主役の統計量・変数を決める"},
  {label:"先に確認すること",hint:"条件・定義域・仮定を確認する"},
  {label:"使う道具",hint:"定理・分布・評価方法を書く"},
  {label:"解答の流れ",hint:"計算前までの手順を短文で並べる"},
  {label:"最後に示すこと",hint:"結論の種類・方向だけを書く。具体的な最終式は書かない"},
  {label:"ここから先は計算",hint:"主要計算へ進む境界を明記する"}
];

export function reviewMode(item:ReviewItem){
  if(item.requires_full_answer) return "exam_90min";
  if(item.mode) return item.mode;
  if(item.review_type==="main_calc_retry") return "main_calc";
  if(item.review_type==="careless_check") return "check";
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
    sheetMode:"skeleton",sheetLabel:"骨格シート",title:"答案の設計図",
    fields:skeletonFields
  };
  if(method.includes("ノート補修")) return {
    sheetMode:"skeleton",sheetLabel:"骨格シート",title:"ノート補修＋骨格",
    fields:[
      {label:"修正ルール1行",hint:"次回必ず書く規則を1行にする"},
      {label:"不足していた説明",hint:"前回省略した式または説明を補う"},
      ...skeletonFields
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
    sheetMode:"check",sheetLabel:"チェックシート",title:"再発防止欄",
    fields:[
      {label:"今回のミス",hint:"符号・係数・条件などを一言で書く"},
      {label:"確認項目",hint:"次回見るチェック項目を1つ作る"},
      {label:"該当箇所",hint:"問題の該当部分だけ見直す"}
    ]
  };
  if(method.includes("3分")||method.includes("5分チェック")||method.includes("5分骨格確認")||method.includes("軽いチェック")||method.includes("想起チェック")||method.includes("軽い骨格確認")) return {
    sheetMode:"check",sheetLabel:"チェックシート",title:"短時間チェック",
    fields:[
      {label:"型",hint:"何の型か一言で書く"},
      {label:"初手",hint:"最初の式または操作を書く"},
      {label:"今見る量",hint:"主役の統計量・変数を確認する"},
      {label:"注意点",hint:"符号・条件・定義域などを1つ確認する"}
    ]
  };
  if(method.includes("骨格再構築")||method.includes("復旧")) return {
    sheetMode:"skeleton",sheetLabel:"骨格シート",title:"答案の設計図",
    fields:skeletonFields
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
