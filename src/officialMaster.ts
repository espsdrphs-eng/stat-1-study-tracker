export type StrategyRank="SS"|"S"|"A+"|"A";

export const CHAPTER_META:Record<number,{title:string;short:string}>={
  1:{title:"第1章：基礎・記述統計",short:"基礎・記述統計"},
  2:{title:"第2章：分布関数・期待値・変数変換",short:"分布・期待値"},
  3:{title:"第3章：代表分布",short:"代表分布"},
  4:{title:"第4章：多次元・条件付き・和積変換",short:"多次元分布"},
  5:{title:"第5章：順序統計量・極値・漸近",short:"順序統計・漸近"},
  6:{title:"第6章：推定・回帰・尤度",short:"推定・回帰"},
  7:{title:"第7章：検定",short:"検定"},
  8:{title:"第8章：区間推定",short:"区間推定"}
};

const rankLists:Record<StrategyRank,Record<number,number[]>>={
  SS:{
    2:[7,10,25],
    4:[3,4,10,14,16],
    5:[13,17,22,23,25],
    6:[1,4,6,12,13,15,21,22],
    7:[1,3,5,9,10,13,20]
  },
  S:{
    1:[5,6,11],
    2:[1,4],
    3:[8,9,10,13,14,18],
    5:[6,10,12,27],
    7:[11,15,17],
    8:[1,2,3,4,7,11,12,16]
  },
  "A+":{
    2:[3,6,16,20,24],
    3:[11,12],
    4:[5,6,8,9,20,21,23,24,26,27,29,34],
    5:[14,18,20,21,26,28,29],
    6:[19,20,23,26,29],
    7:[4,7,8,14,21,22]
  },
  A:{
    1:[2,8],
    8:[10,13,14]
  }
};

// 第6章は原典S/Aを完全に固定する。A+以外の原典AはランクAとして登録する。
export const CHAPTER6_ORIGINAL_S=[1,4,6,12,13,15,21,22];
export const CHAPTER6_ORIGINAL_A=[2,3,5,7,8,9,10,14,16,17,18,19,20,23,24,25,26,27,29,31,32];

export type OfficialProblemEntry={
  problem_id:string;chapter:number;problem_number:number;category:"S"|"A";strategy_rank:StrategyRank;
};

const idFor=(chapter:number,category:"S"|"A",number:number)=>
  `WB-${chapter}-${category}-${String(number).padStart(2,"0")}`;

export function officialProblemEntries(){
  const entries=new Map<string,OfficialProblemEntry>();
  for(const [rank,chapters] of Object.entries(rankLists) as [StrategyRank,Record<number,number[]>][]){
    const category=rank==="SS"||rank==="S"?"S":"A";
    for(const [chapterText,numbers] of Object.entries(chapters)){
      const chapter=Number(chapterText);
      for(const number of numbers){
        const problem_id=idFor(chapter,category,number);
        entries.set(problem_id,{problem_id,chapter,problem_number:number,category,strategy_rank:rank});
      }
    }
  }
  for(const number of CHAPTER6_ORIGINAL_S){
    const problem_id=idFor(6,"S",number);
    if(!entries.has(problem_id)) entries.set(problem_id,{problem_id,chapter:6,problem_number:number,category:"S",strategy_rank:"S"});
  }
  for(const number of CHAPTER6_ORIGINAL_A){
    const problem_id=idFor(6,"A",number);
    if(!entries.has(problem_id)) entries.set(problem_id,{problem_id,chapter:6,problem_number:number,category:"A",strategy_rank:"A"});
  }
  return [...entries.values()];
}

const ids=(chapter:number,category:"S"|"A",numbers:number[])=>
  numbers.map(number=>idFor(chapter,category,number));

export const STRATEGY_S_ORDER=[
  ...ids(6,"S",[21,22,12,13,15,1,4,6]),
  ...ids(4,"S",[3,4,10,14,16]),
  ...ids(2,"S",[7,10,25,1,4]),
  ...ids(5,"S",[13,17,22,23,25,6,10,12,27]),
  ...ids(7,"S",[1,3,5,9,10,13,20,11,15,17]),
  ...ids(3,"S",[8,9,10,13,14,18]),
  ...ids(1,"S",[5,6,11]),
  ...ids(8,"S",[1,2,3,4,7,11,12,16])
];

export const STRATEGY_A_PLUS_ORDER=[
  ...ids(6,"A",[19,20,23,26,29]),
  ...ids(4,"A",[5,6,8,9,20,21,23,24,26,27,29,34]),
  ...ids(2,"A",[3,6,16,20,24]),
  ...ids(5,"A",[14,18,20,21,26,28,29]),
  ...ids(7,"A",[4,7,8,14,21,22]),
  ...ids(3,"A",[11,12])
];

export const PAST_EXAM_YEAR_ORDER=[2024,2025,2022,2023];

export function strategyRankFor(problemId:string,category:"S"|"A"){
  const official=officialProblemEntries().find(entry=>entry.problem_id===problemId);
  return official?.strategy_rank||(category==="S"?"S":"A");
}
