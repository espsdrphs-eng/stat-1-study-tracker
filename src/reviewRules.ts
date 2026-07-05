import type { Attempt, PastSession, Review, StudyUpdate } from "./types.ts";
import { referenceDecision, type ReferenceLevel } from "./reviewExperience.ts";

export type SState="stable"|"check"|"forgotten"|"collapsed";
export type ReviewPlan=Pick<Review,
  "review_reason"|"review_method"|"review_instruction"|"review_steps"|"estimated_minutes"|
  "requires_full_answer"|"requires_s_check"|"linked_s_problem_ids"|"interval_days"> & {
  review_type:string; mode:string; completion_candidate?:boolean;
};
export type ReviewOutcome={
  result:"success"|"partial"|"failed";hint_used:boolean;after_hint_reproduced?:boolean;time_minutes:number;
  reference_level?:number;no_hint?:boolean;one_line_hint?:boolean;previous_mistake?:boolean;
  official_answer?:boolean;gpt_explanation?:boolean;
  allowed_reference_level?:number;actual_reference_level?:number;
  reference_closed_reproduction?:boolean;saved_gpt_feedback?:boolean;external_reference?:boolean;
};

const priority=["K","N","W","C"];
const interval:Record<string,number>={K:1,N:2,W:3,C:7,none:14};

const definitions:Record<string,{
  method:string;instruction:string;steps:string[];minutes:number;mode:string;reason:string;
}>={
  K:{
    method:"骨格再現＋関連S確認",minutes:20,mode:"skeleton",
    reason:"方針・出発式・今見る量・条件・道具が崩れているため、放置すると大問全体を落とす危険がある。翌日に答案の設計図だけを再現して、正しい型を入れ直す。",
    instruction:"フル答案と最終計算は不要。方針・入口、出発式、今見る量、先に確認すること、使う道具、解答の流れ、最後に示すことまでを書く。ゴールは種類や方向だけにし、具体的な最終式は書かない。関連S問題があれば確認してから同じA問題の設計図を再現する。",
    steps:["方針・入口を一言で書く","出発式を書く","今見る量を決める","先に確認する条件を書く","使う道具を書く","解答の流れを書く","最後に示すことを種類・方向だけで書く","ここから先は計算と明記する","関連S問題を確認する"]
  },
  N:{
    method:"ノート補修＋骨格再現",minutes:18,mode:"skeleton",
    reason:"理解はあるが、答案として再現するためのノートや型が不足している。放置するとKに戻るため、短期でノート化と骨格再現を行う。",
    instruction:"分かったつもりで止まっていた部分を、次に自力で設計できる形にする。修正ルールを1行にしてから、方針・出発式・今見る量・条件・道具・流れ・最後に示すことを再現する。最終式や完成答案は求めない。",
    steps:["修正ルールを1行で書く","方針・入口を書く","出発式と今見る量を書く","条件と使う道具を書く","解答の流れを書く","最後に示すことを具体式なしで書く","ここから先は計算と区切る"]
  },
  W:{
    method:"該当作業だけ再演習",minutes:12,mode:"main_calc",
    reason:"骨格は合っているが、計算・展開・積分・和の変形などの作業で落としている。該当作業だけを短期で再演習する。",
    instruction:"フル答案は不要。型は合っているので、落とした計算・積分・和の変形・場合分けだけを部分練習する。",
    steps:["どの作業で落ちたか確認する","その作業部分だけを紙に書く","範囲、条件、添字、符号を確認する","同じ作業をもう一度何も見ずに書く","必要なら次回のGPT採点で再発を確認する"]
  },
  C:{
    method:"チェックリスト確認",minutes:7,mode:"check",
    reason:"型や理解は大きく崩れていないが、符号・係数・条件確認などのケアレスミスがある。チェックリスト化し、少し間を空けて再発するか確認する。",
    instruction:"解き直しは最小限でよい。ミスが再発しないように、確認項目をチェックリスト化してから軽く見直す。",
    steps:["ケアレス内容を確認する","再発防止のチェック項目を1つ作る","問題の該当箇所だけ見直す","次回同じ型で確認する項目を決める"]
  },
  none:{
    method:"軽い想起チェック",minutes:5,mode:"check",
    reason:"大きな問題はないため、短期復習よりも新規A問題や過去問に時間を回す。忘れる前に骨格だけ軽く確認する。",
    instruction:"フル答案は不要。型、初手、今見る量、注意点だけを短時間で確認する。",
    steps:["型を一言で言う","初手を確認する","今見る量を確認する","注意点を1つ確認する","問題なければ完了扱いに近づける"]
  }
};

export function normalizedErrors(input:Pick<StudyUpdate,"error_types"|"primary_error_type"|"error_type">|Attempt){
  const values=input.error_types?.length?input.error_types:[input.primary_error_type||input.error_type];
  return [...new Set(values.map(String).filter(value=>priority.includes(value)))].sort((a,b)=>priority.indexOf(a)-priority.indexOf(b));
}

export function enforceReviewEvidence(input:StudyUpdate,previousErrors:string[],strictVersion:string):StudyUpdate{
  if(!input.generated_from_review_id||input.rubric_version!==strictVersion||input.review_outcome!=="success") return input;
  const targetError=previousErrors.find(error=>priority.includes(error));
  if(!targetError) return input;
  const evidence=String(input.resolution_evidence||"").trim();
  const changed=String(input.answer_change_summary||"").trim();
  const shown=input.required_work_shown||[];
  const scopeIsValid=["full","conditional_full"].includes(String(input.evaluation_scope||""));
  const gradedParts=input.graded_parts||[];
  const unresolved=input.unresolved_carryover||[];
  const actual=Math.min(5,Math.max(0,Number(input.actual_reference_level??input.reference_level??(
    input.external_reference?5:input.official_answer?4:input.saved_gpt_feedback||input.gpt_explanation?3:
      input.previous_mistake?2:input.one_line_hint||input.hint_used?1:0
  )))) as ReferenceLevel;
  const allowed=Math.min(5,Math.max(0,Number(input.allowed_reference_level??0))) as ReferenceLevel;
  const referenceCheck=referenceDecision("success",allowed,actual,
    input.reference_closed_reproduction??input.after_hint_reproduced??actual===0);
  const assistanceIsValid=referenceCheck.result==="success";
  const proofIsValid=input.target_issue_resolved===true&&input.minimum_pass_condition_met===true&&
    evidence.length>=8&&shown.length>0&&scopeIsValid&&gradedParts.length>0&&unresolved.length===0&&assistanceIsValid&&
    !/(変更なし|前回と同じ|同一答案|未修正)/.test(changed);
  if(proofIsValid) return input;
  const reason="前回課題を改善した答案中の具体的な式・説明を確認できないため、successをpartialへ変更した。";
  return {...input,review_outcome:"partial",mark:"△",error_type:targetError,primary_error_type:targetError,
    error_types:[targetError],error_point:String(input.error_point||reason),target_issue_resolved:false,
    minimum_pass_condition_met:false,result_summary:`${String(input.result_summary||"")} ${reason}`.trim()};
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
  const localizedOmission=selected==="N"&&/(途中|式|省略|変形|展開|計算|導出|根拠)/.test(errorPoint);
  const requiresS=(selected==="K"||selected==="N"&&!localizedOmission)&&linkedS.length>0;
  const reason=stable
    ?"かなり安定しているため、短期復習の優先度は低い。得意問題に時間を使いすぎないよう、月1回の軽メンテに回す。"
    :`${errors.length?`${errors.join("＋")}が含まれるため。`:""}${definition.reason}`;
  const method=localizedOmission?"省略部分の局所再現":stable?"月1回の軽いチェック":definition.method;
  const instruction=localizedOmission
    ?`骨格全体やフル答案の書き直しは不要。前回省略した「${errorPoint}」だけを、直前の式から結果が導ける途中式付きで自力再現する。答や方針だけでは完了にしない。`
    :`${stable?"フル答案は不要。型、初手、今見る量、注意点だけを短時間で確認する。":definition.instruction}${errorPoint?` 今回見るポイント：${errorPoint}`:""}`;
  const localSteps=[
    `「${errorPoint}」の直前の式と必要な条件を書く`,
    "省略した式変形を、結果まで理由付きで再現する",
    "答を隠し、その部分だけをもう一度書く"
  ];
  return {
    review_reason:localizedOmission?`N判定の原因が局所的な式・説明の省略であるため、できている骨格は繰り返さず、省略箇所だけを短時間で補修する。`:reason,
    review_method:method,review_instruction:instruction,
    review_steps:localizedOmission?localSteps:errorPoint?[`今回のミス「${errorPoint}」を確認する`,...definition.steps]:definition.steps,estimated_minutes:localizedOmission?12:stable?5:definition.minutes,requires_full_answer:false,
    requires_s_check:requiresS,linked_s_problem_ids:requiresS?linkedS:[],interval_days:days,
    review_type:selected==="W"||localizedOmission?"main_calc_retry":selected==="K"||selected==="N"?"skeleton_retry":selected==="C"?"careless_check":"light_check",
    mode:localizedOmission?"main_calc":stable?"check":definition.mode,completion_candidate:perfectStreak>=3&&selected==="none"
  };
}

export function createAdaptiveReviewPlan(
  source:Attempt,review:Review,outcome:ReviewOutcome,linkedS:string[]=[]
):ReviewPlan{
  const previous=Math.max(1,Number(review.interval_days||14));
  const sourceErrors=normalizedErrors(source);
  const successful=outcome.result==="success";
  const actualReferenceLevel=Math.min(5,Math.max(0,Number(outcome.actual_reference_level??outcome.reference_level??0)));
  const allowedReferenceLevel=Math.min(5,Math.max(0,Number(outcome.allowed_reference_level??0)));
  const exceedsAllowed=actualReferenceLevel>allowedReferenceLevel;
  const attemptLike:Attempt={...source,
    mark:successful?(outcome.hint_used?"○":"◎"):outcome.result==="partial"?"△":"×",
    error_type:successful?"none":sourceErrors[0]||"K",
    primary_error_type:successful?"none":sourceErrors[0]||"K",
    error_types:successful?[]:sourceErrors.length?sourceErrors:["K"]
  };
  const plan=createAttemptReviewPlan(attemptLike,linkedS,0);
  const days=exceedsAllowed&&actualReferenceLevel>=3?3:exceedsAllowed?Math.min(7,previous):outcome.result==="failed"?1:
    outcome.result==="partial"?Math.min(7,Math.max(2,Math.round(previous*.6))):
    Math.min(30,Math.max(14,Math.round(previous*2.5)));
  const outcomeLabel=outcome.result==="success"?"自力再現できた":outcome.result==="partial"?"一部のみ再現できた":"再現できなかった";
  return {...plan,interval_days:days,
    review_reason:`前回復習は「${outcomeLabel}」${outcome.hint_used?`（許可${allowedReferenceLevel}・実際${actualReferenceLevel}）`:""}だったため、${days}日後に再確認する。`,
    review_instruction:successful
      ?"次も答えを見る前に、方針・出発式・今見る量・最後に示すことを自力で想起し、別の問題でも同じ型を選べるか確認する。"
      :plan.review_instruction,
    estimated_minutes:successful?5:plan.estimated_minutes,
    requires_s_check:!successful&&plan.requires_s_check,
    linked_s_problem_ids:!successful?plan.linked_s_problem_ids:[]
  };
}

const sDefinitions:Record<SState,{days:number;method:string;instruction:string;minutes:number;mode:string}>={
  stable:{days:30,method:"3分チェック",minutes:3,mode:"check",instruction:"型、初手、今見る量、注意点だけ確認する。フル答案は不要。"},
  check:{days:14,method:"5分チェック",minutes:5,mode:"check",instruction:"少し怪しいため、型・初手・今見る量・注意点を確認する。設計図全体や最終式は書かない。"},
  forgotten:{days:3,method:"10分骨格再構築",minutes:10,mode:"skeleton",instruction:"方針・出発式・今見る量・条件・道具・流れが出ない状態。解説を見て終わらず、計算前までの設計図を自力で再構築する。"},
  collapsed:{days:1,method:"10〜20分復旧",minutes:20,mode:"skeleton",instruction:"A問題または過去問で土台が崩れた可能性がある。関連S問題で答案の設計図を復旧してから、元のA問題へ戻る。"}
};
export function createSReviewPlan(state:SState):ReviewPlan{
  const rule=sDefinitions[state];
  return {
    review_reason:`S問題の記憶状態が「${state}」のため、${rule.days}日後に土台を点検する。`,
    review_method:rule.method,review_instruction:rule.instruction,
    review_steps:state==="stable"||state==="check"?["型を言う","初手を言う","今見る量を確認する","注意点を1つ挙げる"]:
      ["出発式と条件を自力で書く","使う定理を確認する","骨格を見ずに再構築する","必要なら元のA問題へ戻る"],
    estimated_minutes:rule.minutes,requires_full_answer:false,requires_s_check:false,linked_s_problem_ids:[],
    interval_days:rule.days,review_type:"s_check",mode:rule.mode
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
