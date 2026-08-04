# 合格逆算型適応プランナー仕様

この文書は、統計検定1級「統計数理」について、正規化済み参照パック、concept弱点評価、
過去問露出、日付フェーズを計画候補へ変換する唯一の仕様です。復習契約と保存規則は
`STABLE_LEARNING_SPEC.md`、永続化不変条件は `SYSTEM_INVARIANTS.md` を正本とします。

## 正式運用の整合性

- 当日の正本は引き続き `todayPlanSnapshot` とする。
- 新しいsnapshotは合格逆算プランナーだけから生成する。既存の当日snapshotは公開更新で置換せず、次の日次生成から適用する。
- 未使用容量は `targetMinutes - completedMinutes - confirmedRemainingMinutes` とし、得点形成、試験得点課題、第5・7章維持、有効な先送り候補の順で最大3件を追加候補として提示する。
- 追加候補は表示だけではsnapshotへ入らない。「今日に追加」の明示操作でのみ `if_time` として追加し、同じcandidate keyを冪等に扱う。
- pending総数ではなく、期限超過・今日・今後7日・8日以降を主指標にする。直近7日の完了と新規生成を別々に数え、完了後の遅延確認生成による差引0を正常な遷移として説明する。
- concept evidenceを正式な弱点順位へ使用し、旧K/W/N/C集計と同じランキングへ混ぜない。強い独立失敗が0件なら、暫定失敗率が高くても「要診断」であり「確認済み弱点」ではない。
- 「過去問での出題年度数」と「過去問実答案で失敗した年度数」を分離する。
- 同じシミュレーション内では、新しい永続化Attemptまたは露出イベントなしに同じ過去問を再配置しない。各配置は目的、露出状態、前回イベント、根拠を持つ。
- unknownまたは利用可能な具体素材がない場合は、50分答案ではなく10分の素材選択確認を提示する。
- D90・D60・D30診断は純粋関数として実行し、DB、todayPlanSnapshotを変更しない。

## 参照パック

- 正規化入力は `stat1_exam_reference_pack_v1`。PDFや外部Webを実行時に再解析しません。
- ZIP全体のSHA-256、manifest記載の各ファイルbytes/SHA-256、schema、件数を検証します。
- 2019年、2021〜2025年の30大問だけをcoreとして登録できます。2020年は問題を作りません。
- 2016〜2018年の15件は `metadata_only` のまま保持し、計画・採点・模試へ使用しません。
- 検証済みv1はアプリへ同梱し、起動時に新規・既存IndexedDBへ冪等に反映します。
- 既存の問題固有情報、Attempt、Review、pastSession、露出状態、todayPlanSnapshotは上書きしません。
- 同じパックを再適用しても問題は重複せず、別版が導入済みなら内蔵版へ自動ダウングレードしません。
- 過去問画面の年度一覧は固定配列ではなく、schedulableな正規過去問カタログから生成します。
- 年度の候補順は正式plan、露出状態、残り日数、模試保護から導出します。
- 2024・2025年は模試保護を初期値とします。
- live problem masterが汎用メタデータの場合だけ補完し、固有情報との競合はlive値を保持して
  要確認にします。旧過去問masterを参照パックへ逆流させません。
- 白本リンクはexactまたは既存aliasで解決できた候補だけを利用します。未解決は計画から除外します。
- 同じpack hashの再取込はno-opです。meta storeの既存JSONへ保存するためDB schemaを変更しません。

## concept弱点の証拠

- concept IDは表示文言から再生成しません。参照パックの安定IDを使います。
- 同一日・同一canonical problem・同一学習文脈の指摘は独立機会1回に集約します。
- raw weakNote件数は証拠の説明にのみ使い、スコアや順位へ直接加算しません。
- 強い失敗は、翌日以降の参照なし失敗、別問題、過去問、timed、補修後再発です。
- 同日補修、ヒント・解答参照、限定check、旧policyは弱い証拠です。
- 状態は `unassessed / suspected / confirmed / repairing / transfer_pending / resolved / relapsed`。
- 遅延・参照なし成功と別問題のtransfer成功を解消条件に使い、解消後の失敗はrelapsedです。
- 白本とのcandidate mappingだけでは断定せず、verifiedな過去問concept mappingより低い確信度で扱います。

## 過去問閉ループ

- 露出は `unknown / unseen / prompt_scanned / partially_attempted / fully_attempted /
  answer_exposed / simulated`。unknownをunseenへ変換しません。
- scan_onlyは選題・型識別・初手・時間較正だけを記録し、数学的K/W/N/Cや通常Reviewを生成しません。
- 実答案がある問題だけをconcept弱点評価へ接続します。
- 1 past sessionから出す白本補修候補は優先度上位2件までで、常にユーザー確認候補です。
- 同じ過去問の再現だけでtransfer成功にせず、別問題・別年度の成功を必要とします。

## 正式planner

- 合格逆算プランナーを今日・週間・将来計画の唯一の通常生成元とする。旧plannerは診断・ロールバック用に限る。
- 日次は得点形成1件、局所補修最大1件、維持・選択0〜1件。設定学習時間を超えません。
- 期限到来Reviewが多くても得点形成枠を確保します。
- 残り91日以上は第2・4・6章を主軸に、第5章・第7章、scan_plus_one、full/timedを各週1回以上。
- 90〜61日は過去問30〜40%、第5・7・8章20〜25%を目安にします。
- 60〜31日は過去問・90分演習50%以上、90分演習週1回以上。
- 30日以下は新規白本Aを原則追加せず、simulation・選題・確認済み弱点の安定化を優先します。
- soft quotaは容量内で候補化し、未実施scanを期限超過Reviewとして蓄積しません。
- 同日切替は差分プレビューと明示確定を必須とし、完了済み・追加済み・先送り済み課題を保持する。
- ロールバックは次に作るsnapshotから旧plannerを使用するだけで、既存snapshotや履歴を巻き戻さない。
- 取込・更新・日中の学習結果で当日snapshotを自動再生成しません。

## 時間表示

- `confirmedPlan = completed + confirmedRemaining`
- `targetRemaining = max(0, target - completed)`
- `additionalCapacity = max(0, target - confirmedPlan)`
- 先送り候補は確定計画にも追加可能時間の使用済みにも含めない。
- 追加候補は明示採用後にだけ確定計画へ1回加算する。

## データ保護

Attempt、Evaluation、Review、weakNote、pastSession、点数、K/W/N/C、実績時間、
todayPlanSnapshotは再採点・物理削除・無断再生成しません。参照パックはバックアップではなく、
公開してよいメタデータだけを含む実装入力として扱います。問題本文、解答全文、PDF、個人バックアップ、
診断パックはリポジトリへ保存しません。
