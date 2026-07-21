# Study Tracker 学習運用安定仕様

最上位目標は「今日やる1問を迷わず決め、答案を書き、GPT採点を壊れず保存し、必要部分だけを復習する」です。問題情報は `problem_master`、当日の構成は `today_plan_snapshot`、実績は Attempt、次回課題は Review を正本とします。PDFは通常導線で管理しません。

## 責務分離

- `LearningPolicyResolver`：純粋関数。学習目的、段階、範囲、mode、sheet、証拠、遷移方針を決め、DBへ書き込みません。
- `TaskScheduler`：復習可能期間、日別容量、policy版付き重複防止キー、週間soft quotaを扱います。
- `StudyTriage`：今日の必須・任意・先送り候補だけを分類します。
- `gradingPrompt.ts`：GradingPromptBuilder。画面と同じResolver結果から採点範囲と完了条件を生成します。
- `ReviewTransition`：復習結果後の遷移だけを決めます。

同じ規則をUI、DB保存、プロンプトで個別実装しません。

## 復習範囲とK判定

復習範囲は `targeted_patch`、`main_calc_target`、`full_skeleton`、`check_only`、`full_answer`、`scan5` です。優先順位は、明示範囲、targetedParts、完了条件、mode一般則です。`targeted_patch` は指定部分だけを採点し、範囲外の空欄を誤りにしません。

Kは今回答案に「型、方針・入口、出発式、主役量、道具、大きな流れ」の崩れを示す引用 `k_evidence` がある場合だけ自動計画へ反映します。計算失敗はW、条件・理由・再現不足はN、記号・符号・次元・転記はCです。根拠のないKはraw値として保持しますが、1日復習やfull skeletonの根拠にしません。

旧Kは `valid`、`invalid_legacy_k`、`needs_review` に分類します。`invalid_legacy_k` は履歴値を保持したまま計画・再発率・弱点順位・carryoverから除外し、`needs_review` は推測で無効化しません。数学的な `error_repair` へ骨格欄の不足を継承せず、骨格全体の確認が必要なら後日の `integration_check` として分離します。未完了タスクの再整理はプレビュー後に明示操作で行い、旧Kだけのタスクは削除せず `superseded` とします。

## 即時修正と遅延復習

`same_session_correction` は答案直後に対象部分だけを5分以内で直します。同日にfull/full skeletonを追加せず、成功しても定着成功にしません。K/N/W/Cは別に `delayed_retrieval` を1/2/3/7日後に作り、その結果だけをerror repairの定着判定へ使います。

自動タスクは `policy_version`、`source_attempt_id`、`deduplication_key` を持ち、同じ問題・目的・timing・source・policy版の未完了タスクを重複作成しません。日付は `earliest_date`、`preferred_date`、`latest_date` で持ち、容量不足時も期間内だけで調整します。

## 得点の分離

check、targeted patch、main calculation、skeleton、conditional fullの点数は `task_score` です。本番力へ使うのは、参照なし・時間制限あり・結論到達済みのfull、timed single、past examだけで、`exam_score_eligible=true` を保存します。conditional fullは未見得点率、時間内完走率、過去問得点率へ入れません。

## 遷移と安定判定

基本遷移は error repair → integration check → transfer check → exam performance → stable です。同一問題の成功だけで問題型をstableにしません。型のstableには、別のcanonical problem IDまたは過去問でのeligibleなtransfer/performance成功が必要です。

generic metadataでは転移先を推測しません。verified/confirmedな候補がなければ自動タスク化せず、ユーザー選択候補にします。GPTの関連提案はcandidate止まりで、1 Attemptから自動補修は最大1件です。

## 今日の計画と週間構成

必須は最大3件、任意は最大2件、必須は目標時間の90%以下、必須+任意は目標時間以内です。同一問題は原則1日1件、linked Sは実行枠で最大1件です。期限到来一覧は削除せず、全件を必須へ移しません。更新ボタンで `today_plan_snapshot` を再生成しません。

full skeleton、timed full、scan5は週間soft quotaです。既存実績が不足するときだけ容量内の候補を出します。1回の過去問が複数条件を満たしても重複タスクを追加しません。

## データ保護と開発凍結

既存Attempt、Review、点数、実績時間、完了・先送り状態、problem master、today planを物理削除・再採点しません。今回のpolicy項目は既存storeへの任意フィールド追加であり、store/indexを変えないためDB versionは上げません。

型チェック、全テスト、GPT保存ブラウザ試験、iPad幅確認、診断パックの不一致0件を満たした版を「学習運用安定版」とし、それ以後は新機能追加よりA問題・過去問・本番演習を優先します。

## 復習カードの出所とSCAN5分析取り込み

復習カードの出所は `ReviewOrigin` を正本とします。通常・過去問Attemptはsourceとtargetのcanonical ID一致を必須とし、異なる問題を結べるのはconfirmed/verified relationまたは現行problem_masterの明示的関連だけです。完了済みの旧linked Sは `historical_completed` として履歴に残し、現在対応が必要なsource mismatchへ数えません。invalid legacy K由来の未完了cross-targetカードは付け替えずsupersededとし、対象問題自身の有効なAttemptがある場合だけ独立した新カードを冪等生成します。出所修復と派生表示の再構築は別操作です。

`STAT1-SCAN5-v1` の `primary_selection_error` は正式8値のみを保存します。既知aliasはschema検証前に正式値へ正規化してraw値とログを残し、未知値は`none`へ変換しません。session ID・kind・stageは既存pastSessionと照合し、未解決の復習候補IDはラベルとして保持します。SCAN5分析の保存先はpastSession.analysisだけであり、Attempt・Review・todayPlanSnapshot・K/W/N/C・露出状態を変更しません。
