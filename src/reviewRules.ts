import type { Attempt, PastSession, Review, StudyUpdate } from "./types.ts";

export type SState="stable"|"check"|"forgotten"|"collapsed";
export type ReviewPlan=Pick<Review,
  "review_reason"|"review_method"|"review_instruction"|"review_steps"|"estimated_minutes"|
  "requires_full_answer"|"requires_s_check"|"linked_s_problem_ids"|"interval_days"> & {
  review_type:string; mode:string; completion_candidate?:boolean;
};

const priority=["K","N","W","C"];
const interval:Record<string,number>={K:1,N:2,W:3,C:7,none:14};

const definitions:Record<string,{
  method:string;instruction:string;steps:string[];minutes:number;mode:string;reason:string;
}>={
  K:{
    method:"骨格再現＋関連S確認",minutes:20,mode:"skeleton",
    reason:"型・出発式・主役の統計量・使う定理が崩れているため、放置すると大問全体を落とす危険がある。翌日に骨格だけを再現して、正しい型を入れ直す。",
    instruction:"フル答案は不要。まず、問題の型、出発式、主役の統計量、使う定理、結論の形だけを自力で書く。関連S問題があれば5〜10分確認してから、同じA問題の骨格を再現する。",
    steps:["問題文を見て、型を一言で書く","出発式を書く","主役の統計量または変数を決める","使う定理・条件を書く","最後の結論の形を書く","関連S問題を5〜10分確認する","同じA問題の骨格をもう一度書く"]
  },
  N:{
    method:"ノート補修＋骨格再現",minutes:18,mode:"skeleton",
    reason:"理解はあるが、答案として再現するためのノートや型が不足している。放置するとKに戻るため、短期でノート化と骨格再現を行う。",
    instruction:"分かったつもりで止まっていた部分を、次に自力で書ける形にする。型ノートに1行追加してから、骨格を再現する。",
    steps:["評価文のミス内容を読む","弱点ノートに修正ルールを1行追加する","関連S問題があれば5分確認する","同じ問題の骨格を自力で書く","次回答案で必ず書く一文を決める"]
  },
  W:{
    method:"該当作業だけ再演習",minutes:12,mode:"main_calc",
    reason:"骨格は合っているが、計算・展開・積分・和の変形などの作業で落としている。該当作業だけを短期で再演習する。",
    instruction:"フル答案は不要。型は合っているので、落とした計算・積分・和の変形・場合分けだけを部分練習する。",
    steps:["どの作業で落ちたか確認する","その作業部分だけを紙に書く","範囲、条件、添字、符号を確認する","同じ作業をもう一度何も見ずに書く","必要ならチェックポイントを弱点ノートに追加する"]
  },
  C:{
    method:"チェックリスト確認",minutes:7,mode:"scan",
    reason:"型や理解は大きく崩れていないが、符号・係数・条件確認などのケアレスミスがある。チェックリスト化し、少し間を空けて再発するか確認する。",
    instruction:"解き直しは最小限でよい。ミスが再発しないように、確認項目をチェックリスト化してから軽く見直す。",
    steps:["ケアレス内容を確認する","再発防止のチェック項目を1つ作る","問題の該当箇所だけ見直す","次回同じ型で確認する項目を決める"]
  },
  none:{
    method:"軽い骨格確認",minutes:5,mode:"scan",
    reason:"大きな問題はないため、短期復習よりも新規A問題や過去問に時間を回す。忘れる前に骨格だけ軽く確認する。",
    instruction:"フル答案は不要。問題を見て、型・出発式・結論だけを短時間で確認する。",
    steps:["型を一言で言う","出発式を確認する","主役の統計量を確認する","結論の形を確認する","問題なければ完了扱いに近づける"]
  }
};

export function normalizedErrors(input:Pick<StudyUpdate,"error_types"|"primary_error_type"|"error_type">|Attempt){
  const values=input.error_types?.length?input.error_types:[input.primary_error_type||input.error_type];
  return [...new Set(values.map(String).filter(value=>priority.includes(value)))].sort((a,b)=>priority.indexOf(a)-priority.indexOf(b));
}

export function createAttemptReviewPlan(
  input:StudyUpdate|Attempt,linkedS:string[]=[],consecutivePerfect=0
):ReviewPlan{
  const errors=normalizedErrors(input);
  const selected=errors[0]||"none";
  const perfectStreak=input.mark==="◎"?consecutivePerfect+1:0;
  const stable=perfectStreak>=2&&selected==="none";
  const days=stable?30:interval[selected];
  const definition=definitions[selected];
  const errorPoint=String(input.error_point||"").trim();
  const requiresS=(selected==="K"||selected==="N")&&linkedS.length>0;
  const reason=stable
    ?"かなり安定しているため、短期復習の優先度は低い。得意問題に時間を使いすぎないよう、月1回の軽メンテに回す。"
    :`${errors.length?`${errors.join("＋")}が含まれるため。`:""}${definition.reason}`;
  return {
    review_reason:reason,review_method:stable?"月1回の軽い骨格確認":definition.method,
    review_instruction:`${stable?"フル答案は不要。型・出発式・結論の形だけを短時間で確認する。":definition.instruction}${errorPoint?` 今回見るポイント：${errorPoint}`:""}`,
    review_steps:errorPoint?[`今回のミス「${errorPoint}」を確認する`,...definition.steps]:definition.steps,estimated_minutes:stable?5:definition.minutes,requires_full_answer:false,
    requires_s_check:requiresS,linked_s_problem_ids:requiresS?linkedS:[],interval_days:days,
    review_type:selected==="W"?"main_calc_retry":selected==="K"||selected==="N"?"skeleton_retry":selected==="C"?"careless_check":"skeleton_retry",
    mode:stable?"scan":definition.mode,completion_candidate:perfectStreak>=3&&selected==="none"
  };
}

const sDefinitions:Record<SState,{days:number;method:string;instruction:string;minutes:number}>={
  stable:{days:30,method:"3分チェック",minutes:3,instruction:"型、出発式、主役の統計量だけ確認する。フル答案は不要。"},
  check:{days:14,method:"5分骨格確認",minutes:5,instruction:"少し怪しいため、出発式と使う定理を確認する。必要なら関連A問題に戻る。"},
  forgotten:{days:3,method:"10分骨格再構築",minutes:10,instruction:"出発式や条件が出ない状態。解説を見て終わらず、自力で骨格を再構築する。"},
  collapsed:{days:1,method:"10〜20分復旧",minutes:20,instruction:"A問題または過去問で土台が崩れた可能性がある。関連S問題で型を復旧してから、元のA問題へ戻る。"}
};
export function createSReviewPlan(state:SState):ReviewPlan{
  const rule=sDefinitions[state];
  return {
    review_reason:`S問題の記憶状態が「${state}」のため、${rule.days}日後に土台を点検する。`,
    review_method:rule.method,review_instruction:rule.instruction,
    review_steps:state==="stable"?["型を言う","出発式を書く","主役の統計量を確認する"]:
      ["出発式と条件を自力で書く","使う定理を確認する","骨格を見ずに再構築する","必要なら元のA問題へ戻る"],
    estimated_minutes:rule.minutes,requires_full_answer:false,requires_s_check:false,linked_s_problem_ids:[],
    interval_days:rule.days,review_type:"s_check",mode:"skeleton"
  };
}

export function createPastReviewPlan(session:PastSession|Record<string,unknown>):ReviewPlan{
  const scan=session.session_type==="scan_5_questions";
  const result=String(session.selection_result||"questionable");
  const completed=Number(session.completed_questions_count||0);
  if(scan){
    if(result==="good") return pastPlan(14,"軽い選題確認","5問から3問を選ぶ判断は安定している。次回は別年度で同じ判断ができるか確認する。",10,false);
    if(result==="failed") return pastPlan(2,"選題やり直し","本番では選題ミスが致命傷になる。解き直しより先に、どの問題を選ぶべきだったかを再判断する。",10,false);
    return pastPlan(7,"選題理由の再確認","選べてはいるが判断に迷いがある。選んだ理由と捨てた理由を1行ずつ書き直す。",10,false);
  }
  if(completed>=2) return pastPlan(14,"弱点だけ補修","本番形式としては合格圏。全問解き直しではなく、落とした型だけA問題またはS問題に戻る。",30,true);
  return pastPlan(completed<1.5?5:7,"過去問補修","答案化が不足している。年度全体をもう一度やる前に、落とした型を対応A問題で補修する。",45,true);
}
function pastPlan(days:number,method:string,instruction:string,minutes:number,full:boolean):ReviewPlan{
  return {
    review_reason:instruction,review_method:method,review_instruction:instruction,
    review_steps:method.includes("選題")?["選んだ3問と捨てた2問を見直す","選択理由と捨てた理由を1行ずつ書く","別年度でも同じ基準を使えるか確認する"]:
      ["最大失点要因を確認する","落とした型を対応A/S問題で補修する","時間配分を修正する","必要なら答案化を再実施する"],
    estimated_minutes:minutes,requires_full_answer:full,requires_s_check:false,linked_s_problem_ids:[],
    interval_days:days,review_type:full?"past_exam_retry":"past_exam_selection",mode:full?"exam_90min":"scan"
  };
}
