# 合格逆算型適応プランナー仕様

この文書は、統計検定1級「統計数理」について、正規化済み参照パック、concept弱点評価、
過去問露出、日付フェーズを計画候補へ変換する唯一の仕様です。復習契約と保存規則は
`STABLE_LEARNING_SPEC.md`、永続化不変条件は `SYSTEM_INVARIANTS.md` を正本とします。

## 参照パック

- 正規化入力は `stat1_exam_reference_pack_v1`。PDFや外部Webを実行時に再解析しません。
- ZIP全体のSHA-256、manifest記載の各ファイルbytes/SHA-256、schema、件数を検証します。
- 2019年、2021〜2025年の30大問だけをcoreとして登録できます。2020年は問題を作りません。
- 2016〜2018年の15件は `metadata_only` のまま保持し、計画・採点・模試へ使用しません。
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

## shadow planner

- 既存plannerとtodayPlanSnapshotを正本のまま維持し、新plannerはshadowで14日・30日を比較します。
- 日次は得点形成1件、局所補修最大1件、維持・選択0〜1件。設定学習時間を超えません。
- 期限到来Reviewが多くても得点形成枠を確保します。
- 残り91日以上は第2・4・6章を主軸に、第5章・第7章、scan_plus_one、full/timedを各週1回以上。
- 90〜61日は過去問30〜40%、第5・7・8章20〜25%を目安にします。
- 60〜31日は過去問・90分演習50%以上、90分演習週1回以上。
- 30日以下は新規白本Aを原則追加せず、simulation・選題・確認済み弱点の安定化を優先します。
- soft quotaは容量内で候補化し、未実施scanを期限超過Reviewとして蓄積しません。
- shadow開始14日未満、参照パック/照合エラー、シミュレーション未達がある間は切替不可です。
- 切替は必ず明示操作と比較確認を経ます。取込・更新・日中の学習結果で当日snapshotを変えません。

## データ保護

Attempt、Evaluation、Review、weakNote、pastSession、点数、K/W/N/C、実績時間、
todayPlanSnapshotは再採点・物理削除・無断再生成しません。参照パックはバックアップではなく、
公開してよいメタデータだけを含む実装入力として扱います。問題本文、解答全文、PDF、個人バックアップ、
診断パックはリポジトリへ保存しません。
