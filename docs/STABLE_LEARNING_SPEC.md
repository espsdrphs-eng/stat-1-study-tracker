# Study Tracker 学習運用安定仕様

最上位目標は、2026-11-15の統計検定1級・統計数理で、5題から得点可能な3題を選び、必要な操作を自力で再現して合格得点を取る確率と期待得点を最大化することです。白本全問の完了、全problemのLevel 3化、Review backlogの解消は目的ではありません。問題情報は `problem_master`、朝の構成履歴は `today_plan_snapshot`、実績は Attempt、次回課題は Review を正本とします。PDFは通常導線で管理しません。

## 責務分離

- `LearningPolicyResolver`：純粋関数。学習目的、段階、範囲、mode、sheet、証拠、遷移方針を決め、DBへ書き込みません。
- `TaskScheduler`：復習可能期間、日別容量、policy版付き重複防止キー、週間soft quotaを扱います。
- `reviewSchedulePolicy`：ローカル日付の加算、policy/manual/legacy_unknownの判定、日付整合性診断、契約単位のpending重複判定を扱う純粋関数です。

## 復習日と重複pendingの正本

policy由来の復習は、同一Prescriptionから `source_date`、`review_after_days`、`due_date`、`schedule_origin`、`policy_version` を保存します。`due_date` は `addCalendarDays(source_date, review_after_days)` で決め、UTC時刻へ変換しません。間隔だけ、または日付だけを変更しません。

`schedule_origin=manual` と先送り履歴があるカードは、policy日付と一致しなくても手動変更として保持します。由来を確定できない旧カードは `legacy_unknown` としてプレビューし、明示操作後だけpolicy日付へ補正します。日付修復で過去日になっても、既存 `today_plan_snapshot` へ自動追加しません。

pendingの重複キーは canonical problem ID、learning purpose、mode、review scope、ソート済みgraded part ID集合です。同じキーでは最新の有効なsource Attempt由来だけを残し、古いpendingはsourceを付け替えず `superseded` にします。目的またはgraded part IDが異なるカード、完了済み履歴は統合・変更しません。
- `StudyTriage`：今日の必須・任意・先送り候補だけを分類します。
- `gradingPrompt.ts`：GradingPromptBuilder。画面と同じResolver結果から採点範囲と完了条件を生成します。
- `ReviewTransition`：復習結果後の遷移だけを決めます。

同じ規則をUI、DB保存、プロンプトで個別実装しません。

## 復習範囲とK判定

復習範囲は `targeted_patch`、`main_calc_target`、`full_skeleton`、`check_only`、`full_answer`、`scan5` です。優先順位は、明示範囲、targetedParts、完了条件、mode一般則です。`targeted_patch` は指定部分だけを採点し、範囲外の空欄を誤りにしません。

Kは今回答案に「型、方針・入口、出発式、主役量、道具、大きな流れ」の崩れを示す引用 `k_evidence` がある場合だけ自動計画へ反映します。計算失敗はW、条件・理由・再現不足はN、記号・符号・次元・転記はCです。根拠のないKはraw値として保持しますが、1日復習やfull skeletonの根拠にしません。

旧Kは `valid`、`invalid_legacy_k`、`needs_review` に分類します。`invalid_legacy_k` は履歴値を保持したまま計画・再発率・弱点順位・carryoverから除外し、`needs_review` は推測で無効化しません。数学的な `error_repair` へ骨格欄の不足を継承せず、骨格全体の確認が必要なら後日の `integration_check` として分離します。未完了タスクの再整理はプレビュー後に明示操作で行い、旧Kだけのタスクは削除せず `superseded` とします。

## 即時修正と遅延復習

学習イベントは `assessment`、`corrective_feedback`、`delayed_retrieval`、`transfer` に分離します。通常の誤りはGPT feedbackでその場で訂正し、採点済みsame-session Reviewを自動生成せず、後日の `delayed_retrieval` だけで保持を測ります。訂正を見ただけでは `○` や保持成功にしません。`same_session_correction` を使えるのは、型そのものの未理解、feedback後も修正不能、大規模再構築、またはユーザー明示の再確認だけです。

Level 2の新規局所弱点は残り81〜90日では原則3〜7日、強い失敗または明確なLevel 1崩壊は1〜3日のwindowで確認します。固定日数をpromptへ埋め込まず、残日数、mastery level、失敗強度、再発、保持証拠、試験関連性、代替transfer機会を共通interval policyへ渡します。

markは点数記号ではなく今回の学習状態です。`×` は最低条件未達または重大な未解決、`△` は採点対象に未解決あり、`○` は今回の課題に成功したが保持確認前、`◎` は参照なしの遅延保持確認に成功して同一問題系列を卒業できる状態を表します。scoreだけでは決めず、GPT値を正本にせず、保存時に契約・答案証拠・履歴からアプリが再計算します。

局所的な `error_repair` 成功は `○` とし、同一問題には `retrieval_check` を1回だけ生成します。`delayed_retrieval` の参照0・ヒントなし・success・最低合格条件達成・対象問題解決・全graded partが `none + resolved`・K/W/N/Cなし・未解決carryoverなしを同時に満たすと `◎` で卒業します。必要なintegrationや別問題transferは別purpose／別Reviewとして扱います。参照使用、same-session、未解決errorでは卒業しません。過去markは書き換えません。

自動タスクは `policy_version`、`source_attempt_id`、`deduplication_key` を持ち、同じ問題・目的・timing・source・policy版の未完了タスクを重複作成しません。日付は `earliest_date`、`preferred_date`、`latest_date` で持ち、容量不足時も期間内だけで調整します。

## 得点の分離

check、targeted patch、main calculation、skeleton、conditional fullの点数は `task_score` です。本番力へ使うのは、参照なし・時間制限あり・結論到達済みのfull、timed single、past examだけで、`exam_score_eligible=true` を保存します。conditional fullは未見得点率、時間内完走率、過去問得点率へ入れません。

## 遷移と安定判定

明示的な採点repairを行う場合の遷移は error repair → retrieval check → 同一問題卒業です。通常の即時feedbackでは `correction_provided / retention_pending` から直接retrieval checkへ進み、擬似的な `○` を作りません。integration checkは問題全体の構成確認が必要な場合の独立purpose、transfer checkは別問題での転移確認です。同一問題の成功だけで問題型をstableにしません。別のcanonical problemまたは過去問で同じ能力を十分に成功した場合は、元問題のsame-problem Reviewを不要化できます。

generic metadataでは転移先を推測しません。verified/confirmedな候補がなければ自動タスク化せず、ユーザー選択候補にします。GPTの関連提案はcandidate止まりで、1 Attemptから自動補修は最大1件です。

## 今日の計画と週間構成

必須は最大3件、任意は最大2件、必須は目標時間の90%以下、必須+任意は目標時間以内です。同一問題は原則1日1件、linked Sは実行枠で最大1件です。期限到来一覧は削除せず、全件を必須へ移しません。更新ボタンで `today_plan_snapshot` を再生成しません。

full skeleton、timed full、scan5は週間soft quotaです。既存実績が不足するときだけ容量内の候補を出します。1回の過去問が複数条件を満たしても重複タスクを追加しません。

## データ保護と開発凍結

既存Attempt、Review、点数、実績時間、完了・先送り状態、problem master、today planを物理削除・再採点しません。今回のpolicy項目は既存storeへの任意フィールド追加であり、store/indexを変えないためDB versionは上げません。

型チェック、全テスト、GPT保存ブラウザ試験、iPad幅確認、診断パックの不一致0件を満たした版を「学習運用安定版」とし、それ以後は新機能追加よりA問題・過去問・本番演習を優先します。

## 復習カードの出所とSCAN5分析取り込み

復習カードの出所は `ReviewOrigin` を正本とします。通常・過去問Attemptはsourceとtargetのcanonical ID一致を必須とし、異なる問題を結べるのはconfirmed/verified relationまたは現行problem_masterの明示的関連だけです。完了済みの旧linked Sは `historical_completed` として履歴に残し、現在対応が必要なsource mismatchへ数えません。invalid legacy K由来の未完了cross-targetカードは付け替えずsupersededとし、対象問題自身の有効なAttemptがある場合だけ独立した新カードを冪等生成します。出所修復と派生表示の再構築は別操作です。

整合性診断・ReviewCardResolver・派生表示の再構築でも同じ `ReviewOrigin` 判定を使います。`done` / `completed` / `cancelled` / `superseded` は現在対応件数と派生表示の再構築対象から除外し、履歴レコードを書き換えません。verified relation の移行対象は必ず現在対応件数へ含め、内訳との件数矛盾を許しません。

`STAT1-SCAN5-v1` の `primary_selection_error` は正式8値のみを保存します。既知aliasはschema検証前に正式値へ正規化してraw値とログを残し、未知値は`none`へ変換しません。session ID・kind・stageは既存pastSessionと照合し、未解決の復習候補IDはラベルとして保持します。SCAN5分析の保存先はpastSession.analysisだけであり、Attempt・Review・todayPlanSnapshot・K/W/N/C・露出状態を変更しません。
# 採点契約の固定（STAT1-CONTRACT-v2）

- 1つの復習カードについて、画面、使用シート、所要時間、完了条件、GPT採点範囲、保存検証は同じ `GradingContractSnapshot` を参照する。
- `ProblemContextPack` は問題理解の参考情報であり、採点範囲を拡張しない。採点範囲は `grading_contract` だけが正本である。
- 契約確定後は表示時・プロンプトコピー時に LearningPolicy を再実行しない。目的を変える場合は別Reviewを生成する。
- `required_work_shown`、`resolution_evidence`、`target_issue_resolved`、`minimum_pass_condition_met` は成功証拠であり、次回の `targetedParts` に変換しない。
- `error_types=["none"]` または課題解消済みAttemptから `error_repair` を作らない。

## retrieval_check

`light_check` は `retrieval_check` として扱う。`careless_check` は有効なCがある限り局所的な `error_repair` とし、checkシートのまま3〜9分で扱う。成功済みの注意点を想起するだけのタスクへ変わった場合に限り、別Reviewとして `retrieval_check` を作る。

- mode: `check`
- reviewScope: `check_only`
- sheetType: `check_sheet`
- estimatedMinutes: 3〜5分
- 採点対象: 型、最初の一手、主役の量、重要条件または注意点
- 採点対象外: 全体骨格、全計算、最終結論の完全再現

`retrieval_check` を同じReview IDのまま `integration_check` へ昇格しない。全体骨格の確認が必要なら、検証済み `FullSkeletonBlueprint` を根拠に別Reviewとして作成する。検証済みblueprintがない `full_skeleton` は `needs_review` とする。

## 保存時照合

復習GPT結果の `contract_hash`、problem ID、purpose、mode、scope、target kind、graded part ID集合が画面契約と一致しない場合は保存しない。GPT結果から画面契約を逆変更しない。

採点対象は日本語文ではなく `GradedPartContract.id` を正本とし、順序や表記の違いは不一致にしない。各 `graded_finding` の誤り分類は、そのIDに定義された `allowedErrorTypes` で個別に検証する。checkだからNを一律禁止せず、説明項目の正当なNは保存する一方、数式実行項目で許可されていないNは保存しない。

完了条件は想起を妨げない短いcueだけを表示し、正しい式・係数・導出は `hiddenAnswerKey` に分離する。ヒント、前回ミス、修正ルール、保存済み解説、外部参照を開いた時点で参照段階を記録する。`invalid_legacy_k`、契約未確定、または不可能なpurpose/mode/scopeのReviewは実行・参照・プロンプトコピー・保存を禁止する。

`STAT1-REVIEW-v9` のYAML契約には固定のmark、score、outcome、次回間隔、解消フラグを模範値として置かない。GPTは答案証拠を返し、mark、卒業、次purpose、次回Reviewの有無と間隔は保存トランザクション内でアプリが決定する。不整合なGPT値は履歴を書き換えず今回保存値だけを補正し、補正ログへ残す。

過去問の `scan_only` はAttempt・数学的K/W/N/C・mastery・通常Reviewを作らない。過去問のfull/timed答案は通常どおり採点し、失敗時だけ同一問題の局所repairへ接続できる。cleanな独立performanceまたはrepair後の保持成功から同じ過去問の定期反復は作らず、転移は別の白本／過去問で確認する。verified relation以外を自動採用せず、simulation protectionを最終候補選択まで維持する。
# Data integrity source

Persistence, idempotency, execution gating, and repair invariants are defined in
[`SYSTEM_INVARIANTS.md`](./SYSTEM_INVARIANTS.md). Do not add another task-specific repair path.

正規化済み過去問参照パック、concept証拠評価、過去問露出、合格逆算プランナーの正本は
[`ADAPTIVE_PLANNER_SPEC.md`](./ADAPTIVE_PLANNER_SPEC.md) とし、この文書へ重複実装しません。

## 習得段階

現在の問題別習得状態は `SYSTEM_INVARIANTS.md` の共通projectionを正本とする。
Level 1（骨格保持）、Level 2（主要計算完遂）、Level 3（別問題での転移）を、演習modeおよびReview lifecycleと分離して表示する。
