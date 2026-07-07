export const GRADING_RUBRIC_VERSION="STAT1-GRADE-v5";
export const REVIEW_RUBRIC_VERSION="STAT1-REVIEW-v8";

export type ReviewPromptContext={
  reviewId?:number;problemId:string;title?:string;theme?:string;date:string;mode:string;
  previousDate?:string;previousScore?:string;previousErrors?:string[];
  previousErrorPoint?:string;previousNextAction?:string;
  previousImprovementGuidance?:string;previousRequiredDerivation?:string;
  reviewMethod?:string;reviewInstruction?:string;reviewSteps?:string[];
  requiresFullAnswer?:boolean;linkedSProblemIds?:string[];
  timeMinutes?:number;hintLevel?:"none"|"minimal_hint"|"previous_mistake"|"saved_gpt_feedback"|"official_answer"|"external_reference";
  afterHintReproduced?:boolean;
  referenceLevel?:number;noHint?:boolean;oneLineHint?:boolean;previousMistake?:boolean;
  officialAnswer?:boolean;gptExplanation?:boolean;externalReference?:boolean;
  allowedReferenceLevel?:number;actualReferenceLevel?:number;referenceClosedReproduction?:boolean;
};

export type FirstAttemptPromptContext={
  problemId:string;
  displayLabel?:string;
  theme?:string;
  canonicalProblemType?:string;
  mode?:string;
  estimatedMinutes?:number;
};

export function buildFirstAttemptGradingPrompt(context:FirstAttemptPromptContext){
  const mode=context.mode||"full";
  return `あなたは統計検定1級・統計数理の答案採点者です。
以下の問題について、私の初回答案を採点してください。

今回は初回答案です。
前回ミスや前回復習履歴はありません。
復習ではなく、初回の到達度診断として採点してください。

【重要】
problem_id は下記の指定値を必ずそのまま使ってください。
GPT側で別の problem_id を推測して変更しないでください。

problem_id:
${context.problemId}

display_label:
${context.displayLabel||context.problemId}

theme:
${context.theme||"未設定"}

canonical_problem_type:
${context.canonicalProblemType||context.theme||"未設定"}

mode:
${mode}

予定時間の目安:
${context.estimatedMinutes||""}分

【入力】
問題文：
ここに問題文または画像を貼る

私の答案：
ここに自分の答案または画像を貼る

模範解答：
ここに模範解答または画像を貼る

【採点方針】
以下を診断してください。

1. 方針・入口が正しいか
2. 出発式が正しいか
3. 主要計算が再現できているか
4. 条件・定義域・添字・独立性などの確認が足りているか
5. 結論が問題の要求に対応しているか
6. 試験答案として再現可能か
7. K/W/N/C のどれが主な弱点か

【K/W/N/C】
K：型・方針・入口が崩れている
W：計算・式変形・積分・和・場合分けなどの作業で崩れている
N：ノート不足・説明不足・再現性不足
C：符号・係数・範囲・条件などのケアレス
none：大きな問題なし

【出力】
最後に、以下のYAMLを必ず出してください。
アプリ取り込み用なので、YAML内ではLaTeXを使わず、自然な日本語またはプレーンテキストで書いてください。
next_action には日付や「何日後」を書かないでください。
review_after_days は error_types から決めてください。Kあり=1、Nあり=2、Wあり=3、Cあり=7、none=14。複数なら最短です。

\`\`\`yaml
study_update:
  problem_id: "${context.problemId}"
  display_label: "${context.displayLabel||context.problemId}"
  date: "auto_today"
  task_origin: "first_attempt"
  mode: "${mode}"
  review_method: ""
  mark: "△"
  score_text: ""
  score_numeric:
  time_minutes:
  result_summary: ""
  exam_selection_rank: ""
  error_types:
    - "N"
  primary_error_type: "N"
  main_theme: "${context.theme||""}"
  themes:
    - "${context.theme||""}"
  error_point: ""
  next_action: ""
  review_after_days: 2
  linked_s_problems: []
  linked_past_exams: []
  ignored_parts: []
  weak_notes:
    - ""
  s_check_suggestions: []
  grading_confidence: 85
  rubric_version: "${GRADING_RUBRIC_VERSION}"
  evaluation_scope: "full"
  graded_parts:
    - "答案から実際に採点した部分"
  assumed_correct_parts: []
  unresolved_carryover: []
  uncertain_points: []
\`\`\``;
}

export function buildRepairPrompt(context:FirstAttemptPromptContext){
  return `次の統計検定1級の問題について、解答を教えるのではなく、理解補修用の短いクイズを作ってください。

problem_id: ${context.problemId}
display_label: ${context.displayLabel||context.problemId}
theme: ${context.theme||"未設定"}
canonical_problem_type: ${context.canonicalProblemType||context.theme||"未設定"}

条件：
- 1問ずつ出してください。
- 最初から答えや模範解答を出さないでください。
- 方針、出発式、主要計算、条件確認の順に確認してください。
- 私が答えるまで正解を表示しないでください。
- 最後に、復習で書くべき修正ルールを1行にまとめてください。`;
}

export function buildGradingPrompt(date:string){
  return `あなたは統計検定1級・統計数理の答案採点者です。
以下のルーブリックに厳密に従い、答案の正しさと再現可能性を診断してください。

rubric_version: ${GRADING_RUBRIC_VERSION}

【入力】
問題ID：
問題文：
私の答案：
模範解答・参考解答（あれば）：
解答モード：full／main_calc／skeleton／check
学習時間（分）：

【採点ルール】
1. どの解答モードでも同じフル答案ルーブリックを使う。正しさの基準は緩めず、採点に必要な証拠範囲だけを変える。
   check：思い出せるかだけを確認する。型、初手、今見る量、注意点だけを採点し、それ以外は要求しない。
   skeleton：答案の設計図を採点する。方針・入口、出発式、今見る量、先に確認すること、使う道具、解答の流れ、最後に示すこと、計算へ進む境界を見る。最終式・計算完了・完成答案は要求しない。
   main_calc：指定された主要計算と、その計算を開始する式・条件・範囲・添字だけを採点する。問題全体の解き直し、骨格の再提出、最終結論は要求しない。
   full：型、出発式、条件、統計量、定理、途中計算、結論をすべて答案から採点する。省略部分を正しいと仮定しない。
2. score_numeric と score_label は、上記の仮定を明示したうえでフル答案と同じ配点基準に換算する。採点した部分と仮定した部分を混同しない。
3. 採点対象部分は推測で正解扱いにしない。問題文・答案・参考解答から確認できない部分は uncertain_points に入れる。
4. 各減点について、答案のどの記述を根拠にしたかを明記する。
5. K/W/N/Cを複数選択してよい。
   K：方針・入口、出発式、今見る量、条件、道具、解答の流れが崩れた
   W：計算・展開・積分・和・整理など作業部分で落ちた
   N：途中式や説明不足により答案として再現できない
   C：符号・係数・条件確認などのケアレスミス
6. grading_confidence は0〜100。根拠不足なら80以上にしない。
7. 修正は、次回に自力で実行できる短い規則にする。
8. fullでは答案全体、main_calcでは指定計算だけ、skeletonでは設計図だけ、checkでは確認項目だけの修正版を作る。モード外の内容を追加要求しない。
9. skeletonでは、最終式や完成答案を求めない。評価するのは、方針・出発式・今見る量・条件・道具・流れ・最後に示すこと。ゴールは「MLEを示す」など種類・方向だけとし、具体的な最終計算まで要求しない。
10. main_calcまたはfullで必要な計算は、「整理すると」で飛ばさず、積分範囲、添字変換、微分、式変形、場合分け、定理の条件が追える途中式を書く。
11. 次回の直し方は、今回の答案を引用または要約して「残す部分」「置き換える部分」「次回何も見ずに書く部分」に分ける。
12. result_summary、error_point、next_actionは各1〜2文で簡潔にする。詳細な式変形はrequired_derivationへ分離する。
13. next_actionには日付や復習間隔を書かない。「何をするか」だけを書く。復習間隔はreview_after_daysにのみ入れる。
14. review_after_daysはerror_typesから決める。Kあり=1、Nあり=2、Wあり=3、Cあり=7、none=14。複数なら最短を採用する。
15. 採点説明は次の順で出力する。
   【採点と根拠】
   【今回の答案に沿った修正版答案】
   【省略してはいけない途中計算】
   【次回の直し方】
16. evaluation_scopeはfull答案ならfull、それ以外はconditional_fullとする。
17. 出力末尾に必ず次のYAMLを付ける。YAML内ではLaTeXを避け、できるだけ日本語で書く。

study_update:
  problem_id: "入力された問題ID"
  date: "${date}"
  mode: "full"
  time_minutes: 30
  mark: "△"
  score_label: "B"
  score_numeric: 72
  result_summary: "答案全体の短い評価"
  error_types:
    - "K"
    - "W"
  primary_error_type: "K"
  error_point: "最重要の失点箇所"
  next_action: "日付を書かず、次に行う具体的な復習だけを書く"
  improvement_guidance: |
    残す部分：
    置き換える部分：
    次回何も見ずに書く部分：
  required_derivation: |
    main_calc/fullまたは採点対象のN/Wで必要な途中計算。skeleton/checkで計算が対象外なら空欄
  corrected_answer: |
    fullは修正版答案、main_calcは該当計算、skeletonは最終式を含まない設計図、checkは確認項目だけ
  review_after_days: 1
  themes:
    - "主テーマ"
  linked_s_problems: []
  linked_past_exams: []
  grading_confidence: 85
  rubric_version: "${GRADING_RUBRIC_VERSION}"
  evaluation_scope: "full"
  graded_parts:
    - "答案から実際に採点した部分"
  assumed_correct_parts: []
  unresolved_carryover: []
  uncertain_points: []
  weak_notes:
    - theme: "主テーマ"
      error_type: "K"
      mistake: "今回のミス"
      correction_rule: "次回の修正ルール"

exam_selection_rank や「本番で選ぶか」の判定は出力しないでください。
修正版答案は一般論ではなく、貼り付けられた私の答案の順序・記号・誤りに対応させてください。
まず4つの見出しで説明し、最後にYAMLだけをコードブロックで出力してください。`;
}

export function buildReviewGradingPrompt(context:ReviewPromptContext){
  const steps=(context.reviewSteps||[]).map((step,index)=>`  ${index+1}. ${step}`).join("\n")||"  前回の課題に対応する部分を自力で再現する";
  const previousErrors=context.previousErrors||[];
  const minimumConditions=[
    previousErrors.includes("K")?"K：方針・入口、出発式、今見る量、条件、道具、解答の流れ、最後に示すことを設計図として再現する。最終式は不要。":"",
    previousErrors.includes("N")?"N：前回省略した式・説明を答案上に追加し、各式変形が成り立つ理由も短く説明する。正しい骨格や暗記した式だけの再掲では未達。":"",
    previousErrors.includes("W")?"W：前回失敗した計算・積分・和・式変形を、途中式付きで正しく完了する。答だけ一致しても未達。":"",
    previousErrors.includes("C")?"C：前回の符号・係数・条件ミスを再発させず、該当箇所を正しく書く。":""
  ].filter(Boolean).join("\n")||"前回指定された課題を答案上で自力再現する。";
  const fullScope=context.requiresFullAnswer||context.mode==="full"||context.mode==="exam_90min";
  const hintLevel=context.hintLevel||"none";
  const hintUsed=hintLevel!=="none";
  const hintLabels:Record<string,string>={
    none:"見ていない",minimal_hint:"1行ヒント",previous_mistake:"前回ミス",
    saved_gpt_feedback:"保存済みGPT解説",official_answer:"公式解答",external_reference:"外部参照"
  };
  const inferredReferenceLevel:Record<string,number>={none:0,minimal_hint:1,previous_mistake:2,saved_gpt_feedback:3,official_answer:4,external_reference:5};
  const actualReferenceLevel=Math.min(5,Math.max(0,Number(context.actualReferenceLevel??context.referenceLevel??inferredReferenceLevel[hintLevel]??0)));
  const defaultAllowed=fullScope?0:previousErrors.some(error=>["K","N","W","C"].includes(error))?2:1;
  const allowedReferenceLevel=Math.min(5,Math.max(0,Number(context.allowedReferenceLevel??defaultAllowed)));
  const referenceClosed=context.referenceClosedReproduction??context.afterHintReproduced??false;
  const modeScope=fullScope
    ?"フル答案：全範囲を答案から採点する。未提出部分を正しいと仮定しない。"
    :context.mode==="main_calc"
      ?"主要計算：指定計算と、その直前の式・必要条件・範囲・添字だけを採点する。問題全体、骨格、最終結論は要求しない。"
      :context.mode==="skeleton"
        ?"骨格：方針・入口、出発式、今見る量、先に確認すること、使う道具、解答の流れ、最後に示すこと、計算へ進む境界だけを採点する。最終式・計算完了・完成答案は要求しない。"
        :"チェック：型、初手、今見る量、注意点だけを採点する。それ以外は要求しない。";
  return `あなたは統計検定1級・統計数理の復習答案採点者です。
今回は初見答案の採点ではありません。前回の反省点が修正されたかを比較して判定してください。

rubric_version: ${REVIEW_RUBRIC_VERSION}

【今回の問題】
問題ID：${context.problemId}
問題名：${context.title||""}
テーマ：${context.theme||""}
復習モード：${context.mode}
フル答案の要求：${context.requiresFullAnswer?"必要":"不要。指定部分以外の省略は減点しない"}
採点範囲：${modeScope}

【前回の採点結果】
前回日：${context.previousDate||"不明"}
前回評価：${context.previousScore||"不明"}
前回K/W/N/C：${context.previousErrors?.join(" + ")||"不明"}
前回の反省点：${context.previousErrorPoint||"記録なし"}
前回決めた次回課題：${removeTimingExpressions(context.previousNextAction)||"記録なし"}
前回提示された直し方：${context.previousImprovementGuidance||"記録なし"}
前回、省略せずに書くべきとされた途中計算：${context.previousRequiredDerivation||"記録なし"}

【今回の復習指示】
方法：${context.reviewMethod||"必要部分の再現"}
見るポイント：${context.reviewInstruction||"前回のミスが修正されたか"}
手順：
${steps}
関連S問題：${context.linkedSProblemIds?.join(" / ")||"なし"}

【入力】
今回かかった時間（分）：${context.timeMinutes||""}
参照した内容：${hintLabels[hintLevel]}
許可された参照段階：${allowedReferenceLevel}
実際の参照段階：${actualReferenceLevel}
参照表示を隠してから白紙で再現したか：${hintUsed?(referenceClosed?"はい":"いいえ"):"該当なし"}
今回の答案：
模範解答・参考解答（あれば）：

【ヒント・解答の利用ルール】
1. 最初は必ず何も見ずに取り組む。骨格は3分、主要計算は5分、フル答案・90分演習は制限時間終了まで参照しない。
2. 1行ヒントは、上記時間考えても出発式または次の一手が出ない場合に限る。見るのは定義・使う定理・次の一手のうち1つだけとする。
3. 前回フィードバックは、自分の答案を一度書き切った後に、前回課題の確認目的で見てよい。見ながら答案を完成させない。
4. 解答・模範答案は、自分の答案と採点対象時間を確定した後にだけ見る。見た後の書き写しを今回の得点に含めない。
5. 何か参照した場合は、参照欄の表示を隠してから該当部分を白紙で再現する。一度見た参照段階は履歴として残し、表示を隠しても下げない。白紙再現を行わなければsuccessは禁止する。
6. フル答案・90分演習の点数は参照前の答案だけで決める。参照後の再現は別の補修結果として扱う。

【比較採点ルール】
1. 初回採点と同じフル答案ルーブリックを使う。モードによって変えるのは答案に要求する証拠範囲だけで、正しさの基準は変えない。
2. ${modeScope}
3. score_numeric と score_label は、提出対象外を正しいと仮定した「条件付きフル答案評価」とする。ただしフル答案では仮定を置かない。
4. 前回の反省点が今回修正されたかを、答案中の根拠を示して判定する。
5. 復習指示の対象外は減点しない。ただし、前回未解決のK/W/N/Cは必ず採点対象に含め、正しいと仮定してはならない。
6. 前回と同じミス、改善した点、新たに発生したミスを分けて書く。
7. review_outcome は次で判定する。
   success：最低クリア条件を満たした。ヒントなしなら自力成功。ヒントありなら、参照表示を隠した後に白紙から再現できた場合だけ補助あり成功
   partial：前回より実質的に改善したが、必要な式・説明の一部がまだ不足した
   failed：前回と同じ答案・同じ省略のまま、または前回の主要課題を答案上で改善できなかった
8. K/W/N/Cは今回残ったミスだけを複数選択する。修正済みなら none とする。
9. grading_confidenceは0〜100。答案から確認できない部分はuncertain_pointsへ入れる。
10. fullでは答案全体、main_calcでは指定計算だけ、skeletonでは最終式を含まない設計図だけ、checkでは確認項目だけの修正版を示す。モード外を要求しない。
11. skeletonでは最終式や完成答案を求めない。ゴールは「MLEを示す」「棄却域の形にする」など種類・方向だけでよい。具体的な端点・推定量・積分結果まで要求しない。
12. 次回の直し方を「今回改善したので残す部分」「まだ置き換える部分」「次回何も見ずに書く部分」に分ける。
13. 説明は【比較採点】【修正版答案】【省略してはいけない途中計算】【次回の直し方】の順にする。
14. 骨格が正しいことは、前回N/Wだった箇所を省略してよい理由にはならない。前回と全く同じ答案で省略も同じならsuccessは禁止する。
15. resolution_evidenceには、改善を示す今回答案の式または文章をそのまま引用する。一般的な評価文は禁止する。
16. required_work_shownには、今回答案で実際に確認できた途中式・作業を1項目ずつ入れる。
17. N/Wの復習では、今回の復習対象に指定された範囲・条件・式変形が未提示なら基準を緩めない。暗記した結果だけの再掲はsuccessにしない。一方、対象外の骨格・無関係な計算・最終結論は要求しない。
18. result_summary、error_point、next_actionは各1〜2文で簡潔にする。細かな判定根拠はresolution_evidenceとrequired_work_shownへ分離する。
19. unresolved_carryoverには前回から残った課題だけを入れ、すべて解消した場合だけ空配列にする。
20. 参照を使った場合でも、actual_reference_level が allowed_reference_level 以下で、参照表示を隠した後に白紙再現できていればsuccessを認める。前回ミスを見ただけで自動的にpartialへ下げない。
21. actual_reference_level が allowed_reference_level を超えた場合だけ次回間隔を短くする。保存済みGPT解説・公式解答・外部参照まで見た場合、または参照表示を隠した後に白紙再現していない場合はsuccessにしない。
22. next_actionには日付や復習間隔を書かない。「何をするか」だけを書く。復習間隔はreview_after_daysにのみ入れる。
23. review_after_daysは今回残ったerror_typesから決める。Kあり=1、Nあり=2、Wあり=3、Cあり=7、none=14。複数なら最短を採用する。
24. 最後に次のYAMLをコードブロックで出力する。LaTeXは避け、できるだけ日本語で書く。

【今回の最低クリア条件】
${minimumConditions}

study_update:
  problem_id: "${context.problemId}"
  date: "${context.date}"
  mode: "${context.mode}"
  time_minutes: ${context.timeMinutes||15}
  mark: "○"
  score_label: "A"
  score_numeric: 82
  result_summary: "前回課題がどこまで改善したか"
  error_types:
    - "none"
  primary_error_type: "none"
  error_point: "今回まだ残った課題。なければ空文字"
  next_action: "日付を書かず、次に確認する内容だけを書く"
  improvement_guidance: |
    今回改善したので残す部分：
    まだ置き換える部分：
    次回何も見ずに書く部分：
  required_derivation: |
    main_calc/fullまたは前回N/Wの修正確認に必要な途中計算。skeleton/checkで計算が対象外なら空欄
  corrected_answer: |
    fullは修正版答案、main_calcは指定計算、skeletonは最終式を含まない設計図、checkは確認項目だけ
  review_after_days: 14
  themes:
    - "${context.theme||"主テーマ"}"
  linked_s_problems: []
  grading_confidence: 90
  rubric_version: "${REVIEW_RUBRIC_VERSION}"
  evaluation_scope: "${fullScope?"full":"conditional_full"}"
  graded_parts:
    - "今回の答案から実際に採点した部分"
${fullScope?"  assumed_correct_parts: []":"  assumed_correct_parts:\n    - \"提出対象外として正しいと仮定した部分\""}
  unresolved_carryover: []
  uncertain_points: []
  generated_from_review_id: ${context.reviewId||0}
  review_outcome: "success"
  hint_used: ${hintUsed}
  hint_level: "${hintLevel}"
  after_hint_reproduced: ${hintUsed?referenceClosed:false}
  reference_closed_reproduction: ${hintUsed?referenceClosed:false}
  allowed_reference_level: ${allowedReferenceLevel}
  actual_reference_level: ${actualReferenceLevel}
  reference_level: ${actualReferenceLevel}
  no_hint: ${actualReferenceLevel===0}
  one_line_hint: ${context.oneLineHint??hintLevel==="minimal_hint"}
  previous_mistake: ${context.previousMistake??hintLevel==="previous_mistake"}
  saved_gpt_feedback: ${context.gptExplanation??hintLevel==="saved_gpt_feedback"}
  official_answer: ${context.officialAnswer??hintLevel==="official_answer"}
  external_reference: ${context.externalReference??hintLevel==="external_reference"}
  gpt_explanation: ${context.gptExplanation??hintLevel==="saved_gpt_feedback"}
  target_issue_resolved: true
  minimum_pass_condition_met: true
  resolution_evidence: |
    改善を示す今回答案中の式または文章をそのまま引用
  answer_change_summary: "前回答案から実際に追加・変更された内容"
  required_work_shown:
    - "今回答案で確認できた途中式または作業1"
    - "今回答案で確認できた途中式または作業2"
  weak_notes: []

一般的な模範解答ではなく、今回貼り付けた答案の記号と流れに対応させてください。
まず4つの見出しで説明し、最後にYAMLだけを出力してください。`;
}
import { removeTimingExpressions } from "./reviewTiming.ts";
