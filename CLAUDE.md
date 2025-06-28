# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定 / Language Setting

**重要**: このプロジェクトで作業する際は、必ず日本語で応答してください。
**IMPORTANT**: When working on this project, always respond in Japanese.

## Project Overview

Slackにアップロードされたテキストファイル（議事録など）を自動処理し、AI要約を生成してGitHubにコミットするLambda関数です。

## 開発方針

### Test-Driven Development (TDD)
**必須**: t_wada方式のTDDに従ってください。テストを先に書き、Red-Green-Refactorサイクルを守ること。
詳細: → `docs/testing-guidelines.md`

### コード規約
- コメントは追加しない（ユーザーが明示的に要求した場合を除く）
- 既存のコーディングスタイルに従う
- ライブラリの使用前に必ずpackage.jsonを確認

## クイックリファレンス

```bash
# テスト実行（ファイル監視モード推奨）
cd api && npm run test:watch

# デプロイ
npm run deploy  # ルートディレクトリから

# ログ確認
aws logs tail /aws/lambda/slack-classify-bot --follow --profile k.sato --region us-east-1
```

## ドキュメント構成

- **アーキテクチャ詳細**: `docs/architecture-details.md`
- **テストガイドライン**: `docs/testing-guidelines.md`
- **デプロイメント手順**: `docs/deployment-guide.md`
- **トラブルシューティング**: `docs/troubleshooting.md`
- **セキュリティ設計**: `SECURITY-ARCHITECTURE.md`
- **Airtableスキーマ**: `README-Airtable.md`


## 重要な開発指針

### ドキュメントコメント
主要なクラス/モジュール作成時は、設計ドキュメントへの参照と関連クラスの記述を含めること。

### 環境変数
必須の環境変数は`api/env.json.template`を参照。デプロイ前に`api/env.json`として設定すること。