export const GRADING_RUBRIC_VERSION="STAT1-GRADE-v2";
export const REVIEW_RUBRIC_VERSION="STAT1-REVIEW-v1";

export type ReviewPromptContext={
  reviewId?:number;problemId:string;title?:string;theme?:string;date:string;mode:string;
  previousDate?:string;previousScore?:string;previousErrors?:string[];
  previousErrorPoint?:string;previousNextAction?:string;
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
学習時間（分）：

【採点ルール】
1. 最終答だけでなく、型の選択、出発式、条件、主役の統計量、定理の適用、計算、結論を別々に確認する。
2. 推測で正解扱いにしない。問題文・答案・参考解答から確認できない部分は uncertain_points に入れる。
3. 各減点について、答案のどの記述を根拠にしたかを明記する。
4. K/W/N/Cを複数選択してよい。
   K：型・出発式・統計量・条件・定理・結論の骨格が崩れた
   W：計算・展開・積分・和・整理など作業部分で落ちた
   N：途中式や説明不足により答案として再現できない
   C：符号・係数・条件確認などのケアレスミス
5. grading_confidence は0〜100。根拠不足なら80以上にしない。
6. 修正は、次回に自力で実行できる短い規則にする。
7. 出力末尾に必ず次のYAMLを付ける。YAML内ではLaTeXを避け、できるだけ日本語で書く。

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
  review_after_days: 1
  themes:
    - "主テーマ"
  linked_s_problems: []
  linked_past_exams: []
  grading_confidence: 85
  rubric_version: "${GRADING_RUBRIC_VERSION}"
  uncertain_points: []
  weak_notes:
    - theme: "主テーマ"
      error_type: "K"
      mistake: "今回のミス"
      correction_rule: "次回の修正ルール"

exam_selection_rank や「本番で選ぶか」の判定は出力しないでください。
まず採点結果と根拠を説明し、最後にYAMLだけをコードブロックで出力してください。`;
}

export function buildReviewGradingPrompt(context:ReviewPromptContext){
  const steps=(context.reviewSteps||[]).map((step,index)=>`  ${index+1}. ${step}`).join("\n")||"  前回の課題に対応する部分を自力で再現する";
  return `あなたは統計検定1級・統計数理の復習答案採点者です。
今回は初見答案の採点ではありません。前回の反省点が修正されたかを比較して判定してください。

rubric_version: ${REVIEW_RUBRIC_VERSION}

【今回の問題】
問題ID：${context.problemId}
問題名：${context.title||""}
テーマ：${context.theme||""}
復習モード：${context.mode}
フル答案の要求：${context.requiresFullAnswer?"必要":"不要。指定部分以外の省略は減点しない"}

【前回の採点結果】
前回日：${context.previousDate||"不明"}
前回評価：${context.previousScore||"不明"}
前回K/W/N/C：${context.previousErrors?.join(" + ")||"不明"}
前回の反省点：${context.previousErrorPoint||"記録なし"}
前回決めた次回課題：${context.previousNextAction||"記録なし"}

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
1. 前回の反省点が今回修正されたかを、答案中の根拠を示して判定する。
2. 復習指示の対象外は採点しない。フル答案不要の場合、答案全体がないことをN判定にしない。
3. 前回と同じミス、改善した点、新たに発生したミスを分けて書く。
4. review_outcome は次で判定する。
   success：前回の課題をヒントなしで自力再現できた
   partial：一部改善したが、再現不足またはヒント使用があった
   failed：前回の主要課題が再びできなかった
5. K/W/N/Cは今回残ったミスだけを複数選択する。修正済みなら none とする。
6. grading_confidenceは0〜100。答案から確認できない部分はuncertain_pointsへ入れる。
7. 最後に次のYAMLをコードブロックで出力する。LaTeXは避け、できるだけ日本語で書く。

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
  review_after_days: 14
  themes:
    - "${context.theme||"主テーマ"}"
  linked_s_problems: []
  grading_confidence: 90
  rubric_version: "${REVIEW_RUBRIC_VERSION}"
  uncertain_points: []
  generated_from_review_id: ${context.reviewId||0}
  review_outcome: "success"
  hint_used: false
  weak_notes: []

まず比較結果を短く説明し、最後にYAMLだけを出力してください。`;
}
