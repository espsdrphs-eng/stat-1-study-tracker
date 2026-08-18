export const GRADING_RUBRIC_VERSION="STAT1-GRADE-v5";
export const REVIEW_RUBRIC_VERSION="STAT1-REVIEW-v9";

import { removeTimingExpressions } from "./reviewTiming.ts";
import type { EffectiveReviewScope } from "./reviewScopeResolver.ts";
import type { Attempt, GradingContractSnapshot, ProblemContextPack, Review } from "./types.ts";
import { gradedPartIds, gradedPartLabels } from "./gradedParts.ts";
import { suppliedReferenceCoverage } from "./wholeAnswerDiagnostic.ts";

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
  reviewScope?:EffectiveReviewScope|"scan5";targetedParts?:string[];completionConditions?:string[];
  allowedErrorTypes?:string[];requiresKEvidence?:boolean;
  learningPurpose?:string;learningStage?:string;assessmentTiming?:string;targetKind?:string;
  gradingContract?:GradingContractSnapshot;problemContext?:ProblemContextPack;
};

export type FirstAttemptPromptContext={
  problemId:string;
  displayLabel?:string;
  theme?:string;
  canonicalProblemType?:string;
  mode?:string;
  estimatedMinutes?:number;
};

const wholeAnswerRules=`STEP 0で、今回実際に渡された全添付を problem_statement / official_reference_answer / supplemental_reference / current_answer / unrelated_or_unknown に分類する。
app_reference_coverageはアプリ内資料だけ、effective_reference_coverageはアプリ内資料と今回添付された正式資料の合計、written_answer_coverageは答案全ページの判読範囲とする。完全な問題・公式解答が添付されていれば、appがpartialでもeffectiveはfullになり得る。
答案の全ページ・continuationを先頭から末尾まで意味のあるregionへ分け、実際に書かれた各regionを checked_correct / checked_error / uncertain / not_checkable のどれかに必ず分類する。読めるregionを未評価で残さない。current targetが失敗しても後続regionの監査を止めない。
答案に実際に書かれていない内容、特に採点対象外の未記入は誤りにしない。判読不能・参照不足は誤答と断定せずdiagnostic_uncertaintiesへ構造化し、重大になり得る場合はuser_action_required=trueにする。
同じ上流能力を直せば消える複数誤式は同じroot_cause_keyにまとめる。上流を直しても残る独立majorだけ別rootにする。係数・添字等をmicro-targetへ分解しない。
whole-answer側の発見でcurrent contractのscore・success・graded_findingsを変更しない。`;

const wholeAnswerYaml=`whole_answer_scan:
    performed: null
    app_reference_coverage: "" # full/partial/insufficient
    effective_reference_coverage: "" # full/partial/insufficient
    written_answer_coverage: "" # full/partial/insufficient
    confidence: "" # high/medium/low。contract grading confidenceとは別
    reason: ""
    attachments: [] # attachment_id, kind, description, coverage, page_count
    regions: [] # region_id, description, answer_present, readable, reference_available, status, finding_ids
  observed_out_of_scope_findings: [] # finding_id, mastery_level, finding, evidence, correction, materiality, confidence, create_target_candidate, root_cause_key
  diagnostic_uncertainties: [] # region_id, description, reason, potential_materiality, confidence, candidate_interpretations, user_action_required`;

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

Kは、今回答案中に型・方針・出発式・主役の量・道具・大きな流れの崩れを示す記述がある場合だけです。Kの場合は、その答案中の記述をk_evidenceへ引用してください。

【出力】
最後に、以下のYAMLを必ず出してください。
アプリ取り込み用なので、YAML内ではLaTeXを使わず、自然な日本語またはプレーンテキストで書いてください。
next_action には日付や「何日後」を書かないでください。
mark、次回状態、卒業可否、review_after_daysはアプリが答案証拠と学習履歴から決めるため出力しないでください。
指定modeの採点範囲外でも、答案に実際に書かれたmajorな誤りはobserved_out_of_scope_findingsへ分離してください。
その観察で今回のscoreを下げず、minor・自己訂正済み・単なる改善案はtarget候補にしないでください。
${wholeAnswerRules}

\`\`\`yaml
study_update:
  problem_id: "${context.problemId}"
  display_label: "${context.displayLabel||context.problemId}"
  date: "auto_today"
  task_origin: "first_attempt"
  mode: "${mode}"
  review_method: ""
  score_text: ""
  score_numeric: null
  time_minutes:
  result_summary: ""
  exam_selection_rank: ""
  error_types: [] # K/W/N/C/noneから答案に該当するものを入れる
  primary_error_type: "" # K/W/N/C/none
  k_evidence: []
  main_theme: "${context.theme||""}"
  themes:
    - "${context.theme||""}"
  error_point: ""
  next_action: ""
  linked_s_problems: []
  linked_past_exams: []
  ignored_parts: []
  weak_notes: []
  s_check_suggestions: []
  grading_confidence: null
  rubric_version: "${GRADING_RUBRIC_VERSION}"
  evaluation_scope: "full"
  graded_parts:
    - "答案から実際に採点した部分"
  assumed_correct_parts: []
  unresolved_carryover: []
  ${wholeAnswerYaml}
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
   K：方針・入口、出発式、主役の量、道具、結論への大きな流れが崩れた。答案中の引用をk_evidenceへ必ず入れる
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
13. next_actionには日付や復習間隔を書かない。「何をするか」だけを書く。
14. mark、次回状態、卒業可否、review_after_daysはアプリが採点証拠と履歴から決めるため出力しない。
15. 採点説明は次の順で出力する。
   【採点と根拠】
   【今回の答案に沿った修正版答案】
   【省略してはいけない途中計算】
   【次回の直し方】
16. evaluation_scopeはfull答案ならfull、それ以外はconditional_fullとする。
17. まず現在modeの採点範囲だけでscore・successを確定する。その後、scoreを変更せず答案の残りを別監査する。
${wholeAnswerRules}
18. 出力末尾に必ず次のYAMLを付ける。YAML内ではLaTeXを避け、できるだけ日本語で書く。

study_update:
  problem_id: "入力された問題ID"
  date: "${date}"
  mode: "full"
  time_minutes: 30
  score_label: "" # S/A/B/Cを答案から判定
  score_numeric: null # 0〜100を答案から算出
  result_summary: "答案全体の短い評価"
  error_types: [] # K/W/N/C/none
  primary_error_type: "" # K/W/N/C/none
  k_evidence: []
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
  themes:
    - "主テーマ"
  linked_s_problems: []
  linked_past_exams: []
  grading_confidence: null
  rubric_version: "${GRADING_RUBRIC_VERSION}"
  evaluation_scope: "full"
  graded_parts:
    - "答案から実際に採点した部分"
  assumed_correct_parts: []
  unresolved_carryover: []
  ${wholeAnswerYaml}
  uncertain_points: []
  weak_notes: []

exam_selection_rank や「本番で選ぶか」の判定は出力しないでください。
修正版答案は一般論ではなく、貼り付けられた私の答案の順序・記号・誤りに対応させてください。
まず4つの見出しで説明し、最後にYAMLだけをコードブロックで出力してください。`;
}

export function buildReviewGradingPrompt(context:ReviewPromptContext){
  // A stored contract is immutable. Prompt generation must never run policy resolution again.
  const contract=context.gradingContract;
  const scope=contract?.reviewScope||context.reviewScope||(context.requiresFullAnswer||context.mode==="full"||context.mode==="exam_90min"?"full_answer":context.mode==="main_calc"?"main_calc_target":context.mode==="check"?"check_only":"full_skeleton");
  const targets=(contract?.targetedParts||context.targetedParts||[]).filter(Boolean);
  const gradedParts=contract?.gradedParts||[];
  const gradedIds=gradedPartIds(gradedParts);
  const gradedLabels=gradedPartLabels(gradedParts);
  const outOfScope=(contract?.explicitlyOutOfScopeParts||[]).filter(Boolean);
  const conditions=(contract?.completionConditions||context.completionConditions||[]).filter(Boolean);
  const fullScope=scope==="full_answer";
  const hintLevel=context.hintLevel||"none";
  const hintUsed=hintLevel!=="none";
  const hintLabels:Record<string,string>={
    none:"見ていない",minimal_hint:"1行ヒント",previous_mistake:"前回ミス",
    saved_gpt_feedback:"保存済みGPT解説",official_answer:"公式解答",external_reference:"外部参照"
  };
  const inferredReferenceLevel:Record<string,number>={none:0,minimal_hint:1,previous_mistake:2,saved_gpt_feedback:3,official_answer:4,external_reference:5};
  const actualReferenceLevel=Math.min(5,Math.max(0,Number(context.actualReferenceLevel??context.referenceLevel??inferredReferenceLevel[hintLevel]??0)));
  const defaultAllowed=fullScope?0:(context.previousErrors||[]).some(error=>["K","N","W","C"].includes(error))?2:1;
  const allowedReferenceLevel=Math.min(5,Math.max(0,Number(context.allowedReferenceLevel??defaultAllowed)));
  const referenceClosed=context.referenceClosedReproduction??context.afterHintReproduced??false;
  const scopeRule:Record<EffectiveReviewScope|"scan5",string>={
    targeted_patch:"targetedPartsだけを採点する。指定範囲外の空欄・省略・未提出をK/W/N/Cの根拠にしない。骨格全項目を要求しない。",
    full_skeleton:"骨格全体（方針、出発式、主役の量、条件、道具、流れ、最後に示すこと）を採点する。最終式・計算完了は要求しない。",
    main_calc_target:"指定計算と開始式・必要条件だけを採点する。問題全体や骨格全項目を要求しない。",
    check_only:"指定された型・初手・主役の量・注意点だけを採点する。",
    full_answer:"答案全体を採点し、未提出部分を正しいと仮定しない。",
    scan5:"5問スキャン専用契約だけを評価し、通常答案のK/W/N/Cは付けない。",
  };
  const allowed=gradedParts.map(part=>`${part.id}: ${part.allowedErrorTypes.join(" / ")}`).join("\n")||"採点対象なし";
  const targetText=targets.length?targets.map((part,index)=>`${index+1}. ${part}`).join("\n"):"指定なし";
  const conditionText=conditions.length?conditions.map((condition,index)=>`${index+1}. ${condition}`).join("\n"):"指定範囲を自力で再現する";
  const problemContext=context.problemContext;
  const referenceCoverage=suppliedReferenceCoverage(problemContext);
  const priorResolved=problemContext?.currentSourceAttempt?.graded_findings?.filter(row=>row.resolved)
    .map(row=>`${row.graded_part_id}: ${row.evidence}`).join("\n")||"なし";
  const problemContextText=problemContext?`canonical problem_id：${problemContext.canonicalProblemId}
表示名：${problemContext.displayLabel}
テーマ：${problemContext.theme}
問題型：${problemContext.canonicalProblemType}
キーワード：${problemContext.canonicalKeywords.join("、")||"未登録"}
情報充足度：${problemContext.contextCompleteness}
app_reference_coverage：${referenceCoverage}
問題文：
${problemContext.problemStatement||"（アプリ内に問題全文なし。必要なら貼り付ける）"}
公式・正規参照解答：
${problemContext.officialAnswerText||"（アプリ内に全文なし）"}
参照解答抜粋：
${problemContext.answerExcerpt||"（なし）"}
現在contractのhidden answer key（current target限定）：
${contract?.hiddenAnswerKey.map(row=>`- ${row.gradedPartId}: ${row.content}`).join("\n")||"なし"}
既に解消済みと記録されたtarget（復活させない）：
${priorResolved}`:`問題ID：${context.problemId}
問題名：${context.title||""}
テーマ：${context.theme||""}
app_reference_coverage：insufficient
問題文・正規参照解答：アプリ内に未供給`;
  const contractText=contract?`contract_id：${contract.contractId}
contract_version：${contract.contractVersion}
contract_hash：${contract.contractHash}
learning_purpose：${contract.learningPurpose}
mode：${contract.mode}
review_scope：${contract.reviewScope}
target_kind：${contract.targetKind||""}
graded_parts：
${gradedParts.map(part=>`- ${part.id}｜${part.label}｜許可: ${part.allowedErrorTypes.join("/")}`).join("\n")||"なし"}
explicitly_out_of_scope_parts：${outOfScope.join(" / ")||"なし"}`:`legacy contract（保存前に契約化が必要）`;
  const graduationGate=contract?.learningPurpose==="retrieval_check"&&context.assessmentTiming==="delayed_retrieval"&&
    actualReferenceLevel===0&&!hintUsed;
  return `あなたは統計検定1級・統計数理の復習答案採点者です。
rubric_version: ${REVIEW_RUBRIC_VERSION}

【problem_context：問題理解の参考。採点範囲ではない】
${problemContextText}

【grading_contract：今回の唯一の採点範囲】
${contractText}
採点規則：${scopeRule[scope]}

【targetedParts】
${targetText}

【前回から残った課題】
${context.previousErrorPoint||removeTimingExpressions(context.previousNextAction)||"記録なし"}

【今回の最低クリア条件】
${conditionText}

【参照状況】
今回かかった時間（分）：${context.timeMinutes||""}
参照した内容：${hintLabels[hintLevel]}
許可された参照段階：${allowedReferenceLevel}
実際の参照段階：${actualReferenceLevel}
参照表示を隠してから白紙で再現したか：${hintUsed?(referenceClosed?"はい":"いいえ"):"該当なし"}

【今回の答案】
今回の答案：
模範解答・参考解答（あれば）：

【STEP 1 — in-scope grading / current grading contract】
1. 採点対象は上記の復習範囲とtargetedPartsだけ。画面の最低クリア条件と同じ条件を使い、このSTEPでscore・success・graded_findingsを確定する。
   problem_contextに問題全体の情報があってもgrading_contractを拡張しない。
   explicitly_out_of_scope_partsの欠落・未記入・空欄を減点しない。
2. 誤り分類は採点項目ごとの許可範囲に従う。指定範囲外の空欄や未記入を誤りの根拠にしない。
${allowed}
3. Kは、今回答案から「型・方針・入口・出発式・主役の量・必要な道具・結論への大きな流れ」の崩れを確認できる場合だけ。Kを返す場合は答案中の根拠をk_evidenceへ引用する。引用がなければKを返さない。${context.allowedErrorTypes&&!context.allowedErrorTypes.includes("K")?"今回はKが採点範囲外なのでKを返さない。":""}
4. 計算過程の失敗はW、条件・理由・再現性不足はN、記号・添字・次元・符号・転記はCとする。
   形式的な骨格欄・見出し（方針、今見る量、道具、ゴール、「ここから先は計算」）の未記入は、targetedPartsに明示されていない限りKにもNにも使わない。
   行列・ベクトル・成分の取り違え（例：W1にベクトル全体を置く誤記）は、大きな方針が保たれている限りCとして扱う。
5. 参照が許可範囲内で、表示を隠して白紙再現できればsuccess可。許可超過または白紙再現なしはsuccess不可。
6. markを点数だけで決めない。×＝最低クリア条件未達か重大な未解決、△＝採点対象に未解決が残る、
   ○＝今回の課題には成功したがgraduation gate未達、◎＝アプリから明示されたgraduation gateを満たしたdelayed retrieval成功。
   graduation gateが明示されていなければ◎を推測しない。最終markはアプリが履歴と証拠から再計算するためYAMLへ出力しない。
   今回のgraduation gate候補：${graduationGate?"eligible（全対象resolved・最低条件達成も必要）":"not_eligible"}
7. next_actionに日付を書かない。review_after_days、次のlearning state、卒業可否はアプリが決定するため出力しない。
8. result_summary、error_point、next_actionは各1〜2文。解消済みの履歴や長い一般論を繰り返さない。

【STEP 2 — whole-answer diagnostic / score locked】
9. STEP 1で確定したscore・score_label・success・graded_findingsは、STEP 2の発見を理由に絶対に変更しない。今回のscore・mark・successへ影響させない。
${wholeAnswerRules}
10. 本番で明確な失点になる誤りだけをobserved_out_of_scope_findingsへ分離し、minor・自己訂正済み・改善案はtarget候補にしない。既に解消済みtargetを古い文言から復活させない。
16. 最後に次のYAMLをコードブロックで出力する。空欄・null・[]は答案から判定した値で置き換える。

study_update:
  contract_id: "${contract?.contractId||""}"
  contract_version: "${contract?.contractVersion||""}"
  contract_hash: "${contract?.contractHash||""}"
  problem_id: "${context.problemId}"
  date: "${context.date}"
  mode: "${contract?.mode||context.mode}"
  time_minutes: ${context.timeMinutes||15}
  score_label: "" # S/A/B/Cを答案から判定
  score_numeric: null # 0〜100を答案から算出
  result_summary: "前回課題がどこまで改善したか"
  error_types: [] # K/W/N/C/none
  primary_error_type: "" # K/W/N/C/none
  k_evidence: []
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
  themes:
    - "${context.theme||"主テーマ"}"
  linked_s_problems: []
  grading_confidence: null
  rubric_version: "${REVIEW_RUBRIC_VERSION}"
  learning_purpose: "${contract?.learningPurpose||context.learningPurpose||"error_repair"}"
  learning_stage: "${contract?.learningStage||context.learningStage||"repair"}"
  assessment_timing: "${context.assessmentTiming||"delayed_retrieval"}"
  target_kind: "${contract?.targetKind||context.targetKind||""}"
  review_scope: "${scope}"
  targeted_parts: ${targets.length?`\n${targets.map(part=>`    - "${part.replaceAll('"','\\"')}"`).join("\n")}`:"[]"}
  evaluation_scope: "${fullScope?"full":"conditional_full"}"
  graded_part_ids: ${gradedIds.length?`\n${gradedIds.map(id=>`    - "${id}"`).join("\n")}`:"[]"}
  graded_findings:
${gradedIds.length?gradedIds.map(id=>`    - graded_part_id: "${id}"
      error_type: "" # K/W/N/C/none
      evidence: ""
      resolved: null`).join("\n"):"    []"}
  graded_parts: ${gradedLabels.length?`\n${gradedLabels.map(part=>`    - "${part.replaceAll('"','\\"')}"`).join("\n")}`:"[]"}
  explicitly_out_of_scope_parts: ${outOfScope.length?`\n${outOfScope.map(part=>`    - "${part.replaceAll('"','\\"')}"`).join("\n")}`:"[]"}
  ${wholeAnswerYaml}
${fullScope?"  assumed_correct_parts: []":"  assumed_correct_parts:\n    - \"提出対象外として正しいと仮定した部分\""}
  unresolved_carryover: []
  uncertain_points: []
  generated_from_review_id: ${context.reviewId||0}
  review_outcome: "" # success/partial/failed
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
  target_issue_resolved: null
  minimum_pass_condition_met: null
  resolution_evidence: |

  answer_change_summary: ""
  required_work_shown: []
  weak_notes: []

STEP 1の今回採点と、STEP 2の答案全体の追加確認を分けて短く説明してからYAMLを出力してください。`;
}

/**
 * Build the canonical prompt for a persisted Review without re-running learning
 * policy. Both stale-contract recovery and answer replacement use this helper.
 */
export function buildStoredReviewGradingPrompt(args:{
  review:Review;problemContext:ProblemContextPack;sourceAttempt?:Attempt;date:string;
}){
  const contract=args.review.grading_contract;
  if(!contract)throw new Error("現在Reviewの採点契約が見つかりません");
  const source=args.sourceAttempt;
  return buildReviewGradingPrompt({
    reviewId:args.review.id,problemId:args.review.problem_id,title:args.problemContext.displayLabel,
    theme:args.problemContext.theme,date:args.date,mode:contract.mode,
    previousDate:source?.date,previousScore:source?.score_label,
    previousErrors:source?.error_types||[source?.error_type||"none"],
    previousErrorPoint:source?.error_point,previousNextAction:source?.next_action,
    previousImprovementGuidance:source?.improvement_guidance,previousRequiredDerivation:source?.required_derivation,
    timeMinutes:contract.estimatedMinutes,allowedReferenceLevel:contract.allowedReferenceLevel,
    reviewScope:contract.reviewScope,targetedParts:contract.targetedParts,
    completionConditions:contract.completionConditions,allowedErrorTypes:contract.allowedErrorTypes,
    requiresKEvidence:contract.requiresKEvidence,learningPurpose:contract.learningPurpose,
    learningStage:contract.learningStage,assessmentTiming:args.review.assessment_timing,
    targetKind:contract.targetKind,gradingContract:contract,problemContext:args.problemContext,
  });
}

const addReplacementDirective=(prompt:string,attemptId:number)=>prompt.replace(
  /study_update:\s*\n/,
  `study_update:\n  replacement_for_attempt_id: ${attemptId}\n  replacement_reason: "答案差し替えによる正式再採点"\n`,
);

/**
 * A replacement prompt keeps the original immutable grading contract. The
 * persistence transaction creates a new current Review generation and binds
 * the answer to it atomically; the old Attempt remains immutable history.
 */
export function buildAttemptReplacementGradingPrompt(args:{
  attempt:Attempt;problemContext:ProblemContextPack;sourceReview?:Review;sourceAttempt?:Attempt;date:string;
}){
  const {attempt,problemContext}=args;
  const base=attempt.grading_contract&&args.sourceReview
    ?buildStoredReviewGradingPrompt({review:{...args.sourceReview,grading_contract:attempt.grading_contract},
      problemContext,sourceAttempt:args.sourceAttempt,date:args.date})
    :buildFirstAttemptGradingPrompt({problemId:attempt.problem_id,displayLabel:problemContext.displayLabel,
      theme:problemContext.theme,canonicalProblemType:problemContext.canonicalProblemType,mode:attempt.mode,
      estimatedMinutes:attempt.time_minutes});
  return `【解答差し替えによる正式再採点】\nAttempt #${attempt.id} の元履歴は削除せず、新しく添付する答案を同じ採点範囲で採点してください。\n以下の replacement_for_attempt_id は変更しないでください。\n\n${addReplacementDirective(base,attempt.id)}`;
}

export function buildWholeAnswerRediagnosisPrompt(attempt:Attempt,problemContext?:ProblemContextPack){
  const appCoverage=suppliedReferenceCoverage(problemContext);
  return `あなたは統計検定1級・統計数理の答案全体診断者です。
これは既存Attemptの追加診断です。元の点数・mark・graded_findings・Review完了結果は変更しません。

attempt_id: ${attempt.id}
problem_id: ${attempt.problem_id}
original_score: ${attempt.score_label} / ${attempt.score_numeric??"未記録"}
original_mark: ${attempt.mark}
app_reference_coverage: ${appCoverage}

【アプリ内problem context】
問題文：${problemContext?.problemStatement||"（全文なし。完全な問題画像を添付してください）"}
公式解答：${problemContext?.officialAnswerText||problemContext?.answerExcerpt||"（全文なし。公式解答の全ページを添付してください）"}
既存の採点対象：${attempt.graded_parts?.join(" / ")||"記録なし"}
既存stable targets：${attempt.observed_out_of_scope_findings?.map(row=>`${row.root_cause_key||"root未設定"}: ${row.finding}`).join(" / ")||"なし"}

【添付してください】
- 問題文の全ページ
- 公式・正規参照解答の全ページ
- このAttemptの答案全ページ（continuationを含む）

${wholeAnswerRules}
現在の採点範囲を再採点せず、答案へ実際に書かれた追加major errorと判定不能領域だけを返してください。
答案へ書かれていない部分は誤りにしません。同じroot原因の下流誤りはevidenceへまとめます。

次のYAMLだけを最後に出力してください。
\`\`\`yaml
whole_answer_diagnostic_update:
  attempt_id: ${attempt.id}
  problem_id: "${attempt.problem_id}"
  ${wholeAnswerYaml}
\`\`\``;
}
