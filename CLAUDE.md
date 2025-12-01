# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定 / Language Setting

**重要**: このプロジェクトで作業する際は、必ず日本語で応答してください。
**IMPORTANT**: When working on this project, always respond in Japanese.

## Project Overview

Slackにアップロードされたテキストファイル（議事録など）を自動処理し、GitHub APIを使って直接GitHubにコミットするAWS Lambdaベースのボットシステムです。

### 主要機能
- Slackファイル共有イベントの監視
- プロジェクト情報の管理（DynamoDB）
- AI（AWS Bedrock Claude）による要約・議事録生成
- GitHubへの自動コミット（GitHub API直接、Octokit使用）

### 二層構造（会議記録）
会議記録は**議事録**と**トランスクリプト**の二層で保存されます：
- `{path_prefix}minutes/YYYY-MM-DD_name.md` - 議事録（AI処理済み、brainbaseのアクティブデータ）
- `{path_prefix}transcripts/YYYY-MM-DD_name.txt` - トランスクリプト（原本アーカイブ）

議事録には `transcript_ref` で原本への参照が含まれます。

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
│   ├── index.js              # エントリポイント
│   ├── app.js                # Slack Boltアプリケーション
│   ├── project-repository.js # DynamoDBアクセス層
│   ├── github-integration.js # GitHub API連携（Octokit）★
│   ├── llm-integration.js    # AWS Bedrock LLM連携
│   ├── airtable-integration.js # ファイル処理・Slack UI
│   ├── deploy.sh             # デプロイスクリプト
│   └── env.json.template     # 環境変数テンプレート
├── lambda/                    # Lambda関数設定（レガシー）
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

**必須環境変数:**
- `SLACK_BOT_TOKEN` - Slack Bot Token
- `SLACK_SIGNING_SECRET` - Slack Signing Secret
- `GITHUB_TOKEN` - GitHub Personal Access Token（リポジトリへの書き込み権限必須）
- `AWS_REGION` - AWSリージョン（デフォルト: us-east-1）

**オプション環境変数:**
- `PROJECTS_TABLE_NAME` - DynamoDBテーブル名（デフォルト: slack-classify-bot-projects）