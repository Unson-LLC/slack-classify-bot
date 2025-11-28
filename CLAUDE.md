# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定 / Language Setting

**重要**: このプロジェクトで作業する際は、必ず日本語で応答してください。
**IMPORTANT**: When working on this project, always respond in Japanese.

## Project Overview

Slackにアップロードされたテキストファイル（議事録など）を自動処理し、n8nワークフローを通じてGitHubにコミットするAWS Lambdaベースのボットシステムです。

### 主要機能
- Slackファイル共有イベントの監視
- プロジェクト情報の管理（DynamoDB）
- n8nワークフローへのファイル転送
- GitHubへの自動コミット（n8n経由）

## 開発方針

### Test-Driven Development (TDD)
**必須**: t_wada方式のTDDに従ってください。テストを先に書き、Red-Green-Refactorサイクルを守ること。

**重要なルール**:
- Greenフェーズではベタ書き・ハードコードを許容する
- **Refactorフェーズで必ずベタ書き・ハードコードを除去すること**
- 最終的なコードにベタ書き・ハードコードが残ることは許されない

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

# DynamoDB操作
# 全プロジェクト取得
aws dynamodb scan --table-name slack-classify-bot-projects --profile k.sato --region us-east-1

# 特定プロジェクト取得
aws dynamodb get-item --table-name slack-classify-bot-projects \
  --key '{"project_id": {"S": "proj_aitle"}}' \
  --profile k.sato --region us-east-1

# プロジェクト更新
aws dynamodb put-item --table-name slack-classify-bot-projects \
  --item file:///tmp/project.json \
  --profile k.sato --region us-east-1
```

## プロジェクト構造

```
slack-classify-bot/
├── api/                       # Lambda関数メインコード
│   ├── app.js                # Slack Boltアプリケーション
│   ├── project-repository.js # DynamoDBアクセス層
│   ├── n8n-integration.js    # n8nワークフロー連携
│   ├── deploy.sh             # デプロイスクリプト
│   └── env.json.template     # 環境変数テンプレート
├── lambda/                    # Lambda関数設定
├── docs/                      # ドキュメント
│   ├── architecture-details.md
│   ├── testing-guidelines.md
│   ├── deployment-guide.md
│   ├── troubleshooting.md
│   ├── SECURITY-ARCHITECTURE.md
│   └── airtable-to-dynamodb-gap-analysis.md
├── scripts/                   # ユーティリティスクリプト
│   ├── seed-projects.js      # プロジェクト初期データ投入
│   └── migrate-*.js          # データ移行スクリプト
├── terraform/                 # インフラコード（使用停止中）
└── README.md                  # プロジェクトREADME
```

## データストレージ

### DynamoDB（現在）
- **テーブル名**: `slack-classify-bot-projects`
- **用途**: プロジェクト情報、リポジトリマッピング、Slackチャンネル設定
- **主要フィールド**: `project_id`, `name`, `owner`, `repo`, `path_prefix`, `slack_channels`

### Airtable（レガシー）
- 2024年10月にDynamoDBへ完全移行済み
- 参照: `docs/airtable-to-dynamodb-gap-analysis.md`

## ドキュメント構成

- **アーキテクチャ詳細**: `docs/architecture-details.md`
- **テストガイドライン**: `docs/testing-guidelines.md`
- **デプロイメント手順**: `docs/deployment-guide.md`
- **トラブルシューティング**: `docs/troubleshooting.md`
- **セキュリティ設計**: `docs/SECURITY-ARCHITECTURE.md`
- **DynamoDB移行設計**: `docs/airtable-to-dynamodb-gap-analysis.md`
- **Airtableスキーマ（レガシー）**: `docs/README-Airtable.md`

## 重要な開発指針

### ドキュメントコメント
主要なクラス/モジュール作成時は、設計ドキュメントへの参照と関連クラスの記述を含めること。

### 環境変数
必須の環境変数は`api/env.json.template`を参照。デプロイ前に`api/env.json`として設定すること。