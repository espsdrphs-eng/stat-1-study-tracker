export const GRADING_RUBRIC_VERSION="STAT1-GRADE-v4";
export const REVIEW_RUBRIC_VERSION="STAT1-REVIEW-v4";

export type ReviewPromptContext={
  reviewId?:number;problemId:string;title?:string;theme?:string;date:string;mode:string;
  previousDate?:string;previousScore?:string;previousErrors?:string[];
  previousErrorPoint?:string;previousNextAction?:string;
  previousImprovementGuidance?:string;previousRequiredDerivation?:string;
  reviewMethod?:string;reviewInstruction?:string;reviewSteps?:string[];
  requiresFullAnswer?:boolean;linkedSProblemIds?:string[];
};

export function buildGradingPrompt(date:string){
  return `あなたは統計検定1級・統計数理の答案採点者です。
以下のルーブリックに厳密に従い、答案の正しさと再現可能性を診断してください。

rubric_version: ${GRADING_RUBRIC_VERSION}

【入力】
問題ID：
問題文：
私の答案：
模範解答・参考解答（あれば）：
解答モード：full／main_calc／skeleton
学習時間（分）：

【採点ルール】
1. どの解答モードでも同じフル答案ルーブリックを使う。正しさの基準は緩めず、採点に必要な証拠範囲だけを変える。
   full：型、出発式、条件、統計量、定理、主要計算、結論をすべて答案から採点する。省略部分を正しいと仮定しない。
   main_calc：指定された主要計算と、その計算を開始する式・条件・範囲・添字を答案から採点する。提出対象外の骨格と結論は正しいと仮定する。
   skeleton：型、出発式、主役の統計量、条件・定理、結論の形を答案から採点する。定型的な詳細計算は正しいと仮定する。
2. score_numeric と score_label は、上記の仮定を明示したうえでフル答案と同じ配点基準に換算する。採点した部分と仮定した部分を混同しない。
3. 採点対象部分は推測で正解扱いにしない。問題文・答案・参考解答から確認できない部分は uncertain_points に入れる。
4. 各減点について、答案のどの記述を根拠にしたかを明記する。
5. K/W/N/Cを複数選択してよい。
   K：型・出発式・統計量・条件・定理・結論の骨格が崩れた
   W：計算・展開・積分・和・整理など作業部分で落ちた
   N：途中式や説明不足により答案として再現できない
   C：符号・係数・条件確認などのケアレスミス
6. grading_confidence は0〜100。根拠不足なら80以上にしない。
7. 修正は、次回に自力で実行できる短い規則にする。
8. 私の答案の正しい部分は残し、誤った箇所だけを置き換えた「今回の答案に沿った修正版答案」を作る。
9. 修正版答案では、結論に必要な途中計算を省略しない。「整理すると」「計算により」だけで飛ばさず、積分範囲、添字変換、微分、式変形、場合分け、定理の条件が追えるように書く。
10. 単純な四則演算以外は、直前の式から必要な結果を自力で導ける段階まで途中式を書く。
11. 次回の直し方は、今回の答案を引用または要約して「残す部分」「置き換える部分」「次回何も見ずに書く部分」に分ける。
12. result_summary、error_point、next_actionは各1〜2文で簡潔にする。詳細な式変形はrequired_derivationへ分離する。
13. 採点説明は次の順で出力する。
   【採点と根拠】
   【今回の答案に沿った修正版答案】
   【省略してはいけない途中計算】
   【次回の直し方】
14. evaluation_scopeはfull答案ならfull、main_calcまたはskeletonならconditional_fullとする。
15. 出力末尾に必ず次のYAMLを付ける。YAML内ではLaTeXを避け、できるだけ日本語で書く。

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
  next_action: "次回に行う具体的な復習"
  improvement_guidance: |
    残す部分：
    置き換える部分：
    次回何も見ずに書く部分：
  required_derivation: |
    結論を導くため、省略せずに書く途中計算
  corrected_answer: |
    今回の答案の正しい部分を活かした修正版答案
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
    previousErrors.includes("K")?"K：前回崩れた型・出発式・主役の統計量・条件・定理を答案上で再現する。":"",
    previousErrors.includes("N")?"N：前回省略した式・説明を答案上に追加し、各式変形が成り立つ理由も短く説明する。正しい骨格や暗記した式だけの再掲では未達。":"",
    previousErrors.includes("W")?"W：前回失敗した計算・積分・和・式変形を、途中式付きで正しく完了する。答だけ一致しても未達。":"",
    previousErrors.includes("C")?"C：前回の符号・係数・条件ミスを再発させず、該当箇所を正しく書く。":""
  ].filter(Boolean).join("\n")||"前回指定された課題を答案上で自力再現する。";
  const fullScope=context.requiresFullAnswer||context.mode==="full"||context.mode==="exam_90min";
  const modeScope=fullScope
    ?"フル答案：全範囲を答案から採点する。未提出部分を正しいと仮定しない。"
    :context.mode==="main_calc"
      ?"主要計算：指定計算と、その直前の式・必要条件・範囲・添字を答案から採点する。対象外の骨格と結論は正しいと仮定する。"
      :context.mode==="skeleton"
        ?"骨格：型・出発式・主役の統計量・条件・定理・結論の形を答案から採点する。対象外の定型計算は正しいと仮定する。"
        :"限定確認：今回指定された確認項目だけを答案から採点し、それ以外は正しいと仮定する。";
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
前回決めた次回課題：${context.previousNextAction||"記録なし"}
前回提示された直し方：${context.previousImprovementGuidance||"記録なし"}
前回、省略せずに書くべきとされた途中計算：${context.previousRequiredDerivation||"記録なし"}

【今回の復習指示】
方法：${context.reviewMethod||"必要部分の再現"}
見るポイント：${context.reviewInstruction||"前回のミスが修正されたか"}
手順：
${steps}
関連S問題：${context.linkedSProblemIds?.join(" / ")||"なし"}

【入力】
今回かかった時間（分）：
ヒント・解説を見たか：はい／いいえ
今回の答案：
模範解答・参考解答（あれば）：

【比較採点ルール】
1. 初回採点と同じフル答案ルーブリックを使う。モードによって変えるのは答案に要求する証拠範囲だけで、正しさの基準は変えない。
2. ${modeScope}
3. score_numeric と score_label は、提出対象外を正しいと仮定した「条件付きフル答案評価」とする。ただしフル答案では仮定を置かない。
4. 前回の反省点が今回修正されたかを、答案中の根拠を示して判定する。
5. 復習指示の対象外は減点しない。ただし、前回未解決のK/W/N/Cは必ず採点対象に含め、正しいと仮定してはならない。
6. 前回と同じミス、改善した点、新たに発生したミスを分けて書く。
7. review_outcome は次で判定する。
   success：下記の最低クリア条件をすべて満たし、前回の課題をヒントなしで答案上に再現できた
   partial：前回より実質的に改善したが、必要な式・説明の一部がまだ不足した
   failed：前回と同じ答案・同じ省略のまま、または前回の主要課題を答案上で改善できなかった
8. K/W/N/Cは今回残ったミスだけを複数選択する。修正済みなら none とする。
9. grading_confidenceは0〜100。答案から確認できない部分はuncertain_pointsへ入れる。
10. 今回の答案の正しい部分を残し、まだ不足する部分を補った「今回の答案に沿った修正版答案」を示す。
11. 結論に必要な途中計算は省略しない。「整理すると」で飛ばさず、前回の課題が直ったと確認できる式変形を書く。
12. 次回の直し方を「今回改善したので残す部分」「まだ置き換える部分」「次回何も見ずに書く部分」に分ける。
13. 説明は【比較採点】【修正版答案】【省略してはいけない途中計算】【次回の直し方】の順にする。
14. 骨格が正しいことは、前回N/Wだった箇所を省略してよい理由にはならない。前回と全く同じ答案で省略も同じならsuccessは禁止する。
15. resolution_evidenceには、改善を示す今回答案の式または文章をそのまま引用する。一般的な評価文は禁止する。
16. required_work_shownには、今回答案で実際に確認できた途中式・作業を1項目ずつ入れる。
17. N/Wの復習では、前回要求された範囲・条件・式変形が今回も未提示なら基準を緩めない。暗記した結果だけの再掲はsuccessにしない。一方、確認済みの骨格や無関係な計算の再提出は要求しない。
18. result_summary、error_point、next_actionは各1〜2文で簡潔にする。細かな判定根拠はresolution_evidenceとrequired_work_shownへ分離する。
19. unresolved_carryoverには前回から残った課題だけを入れ、すべて解消した場合だけ空配列にする。
20. 最後に次のYAMLをコードブロックで出力する。LaTeXは避け、できるだけ日本語で書く。

【今回の最低クリア条件】
${minimumConditions}

study_update:
  problem_id: "${context.problemId}"
  date: "${context.date}"
  mode: "${context.mode}"
  time_minutes: 15
  mark: "○"
  score_label: "A"
  score_numeric: 82
  result_summary: "前回課題がどこまで改善したか"
  error_types:
    - "none"
  primary_error_type: "none"
  error_point: "今回まだ残った課題。なければ空文字"
  next_action: "次回確認する内容。定着なら軽い骨格確認"
  improvement_guidance: |
    今回改善したので残す部分：
    まだ置き換える部分：
    次回何も見ずに書く部分：
  required_derivation: |
    前回課題の修正を確認するため、省略せずに書く途中計算
  corrected_answer: |
    今回の答案を基にした修正版答案
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
  hint_used: false
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
