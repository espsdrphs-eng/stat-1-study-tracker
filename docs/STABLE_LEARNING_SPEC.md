# Study Tracker 学習運用安定仕様

この文書は、残り約4か月の統計検定1級学習で優先する安定仕様の正本です。日常運用に必要な不具合修正を除き、ここに反する機能追加は行いません。

## データの正本

- 問題の固定情報は `problem_master`、ID表記ゆれは `problem_aliases` を正本とする。
- 当日の構成は `today_plan_snapshot` を正本とし、更新・再読込では再生成しない。
- 答案の事実はAttempt、評価はAttempt内の評価項目、次回予定はReviewを正本とする。
- PDFは通常導線で管理しない。問題文と模範解答は書籍またはGoodNotesで確認する。
- 過去データは物理削除・再採点せず、canonical IDで表示・集計する。

## 復習範囲と採点

画面、完了条件、シート、GPT採点プロンプトは `ReviewScopeResolver` の同じ結果だけを使う。

| scope | 採点対象 |
|---|---|
| targeted_patch | targetedPartsのみ。範囲外の空欄は採点しない |
| full_skeleton | 方針・出発式・主役の量・条件・道具・流れ。最終計算は不要 |
| main_calc_target | 指定計算と開始式・条件だけ |
| check_only | 型・初手・主役の量・注意点だけ |
| full_answer | 答案全体 |

優先順位は、明示scope、targetedParts、完了条件、mode一般則の順。`skeleton` や過去のKだけを理由に `full_skeleton` へ拡大しない。

Kは今回答案に、型・方針・入口・出発式・主役の量・道具・大きな流れの崩れを示す引用 `k_evidence` がある場合だけ自動間隔へ反映する。引用のないKはraw評価として保持するが、1日間隔や骨格全面復習には使わない。計算失敗はW、条件・理由・再現性不足はN、記号・添字・次元・符号・転記はCとする。

## 今日の実行計画

- 期限到来一覧は削除しない。
- 必ずやるは最大3件、余裕があれば最大2件。
- 必ずやる時間は目標の90%以下、両者の合計は目標時間以下。
- 主課題1〜2件、補修0〜1件、短時間確認0〜1件、linked Sは実行枠で最大1件。
- 当日計画を変えるのは明示操作「今日の計画を再整理」だけ。タスクID、完了、実績、予定分数は保持する。

## 関連問題・メタデータ・弱点

- 関連問題の自動タスク化にはconfirmed、異なるsource/target、具体的sourceIssue・targetFocus・補修根拠が必要。
- problem_masterの汎用関連指定やGPT提案だけではタスク化しない。1Attemptから自動補修は最大1件。
- metadataはverified / generic / review_needed。genericでは、対象Attemptのerror_point等に根拠がない具体語を生成しない。
- error typeがnoneなら弱点ノートを作らない。表示はcanonical problem ID・error type・correction ruleで重複統合し、解決候補を除いた上位3〜5件を優先する。

## 本番力

既存 `pastSessions` を使い、timed_single、scan5、past_examを記録する。ダッシュボードは未見・長期未実施得点率、時間内完走率、5問スキャン選題成功率、過去問得点率を優先し、0件は0%ではなく「未計測」と表示する。

## 非破壊・凍結条件

Attempt、Review、problem_master、得点、実績時間、完了状態は自動変更しない。store/index変更がなければDB versionを上げない。型チェック、全テスト、ビルド、GPT保存試験、診断の主要不一致0件を満たした版を「学習運用安定版」とし、新機能よりA問題・過去問・本番演習を優先する。
