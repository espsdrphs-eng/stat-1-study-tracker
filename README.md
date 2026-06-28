# 統計検定1級 学習管理

iPad単体で使えるオフライン対応PWAです。学習記録はiPad内のIndexedDBに保存され、外部APIや常時稼働PCは使いません。

公開URL: https://espsdrphs-eng.github.io/stat-1-study-tracker/

## iPadで使う

1. 公開URLをiPadのSafariで開く
2. Safariの共有ボタンを押す
3. 「ホーム画面に追加」を選ぶ
4. ホーム画面の「統計一級」から起動する

初回表示でアプリ本体を保存するため、その後はオフラインでも利用できます。

詳しい日常運用、バックアップ、復元、更新方法は `IPAD_GUIDE.md` を参照してください。

## データ保存

- 保存先：iPad内のIndexedDB
- OpenAI API：不使用
- クラウド同期：なし
- iPhoneや別のiPadとは自動同期しない
- 設定画面からJSONバックアップ、CSV出力が可能
- JSONバックアップから全データを復元可能

iPadの故障・初期化・Safariデータ削除に備え、JSONバックアップを定期的に「ファイル」へ保存してください。

## 開発・公開

```powershell
npm install
npm run build
```

生成される `dist` フォルダをHTTPS対応の静的ホスティングへ配置します。PWAのインストールとオフライン動作には、原則としてHTTPSの公開URLが必要です。

このリポジトリでは `.github/workflows/deploy-pages.yml` により、`main` ブランチ更新時にGitHub Pagesへ自動公開します。

ローカル確認:

```powershell
npm run dev
```

本番ビルド確認:

```powershell
npm start
```
