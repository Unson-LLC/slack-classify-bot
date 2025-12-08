# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定 / Language Setting

**重要**: このプロジェクトで作業する際は、必ず日本語で応答してください。
**IMPORTANT**: When working on this project, always respond in Japanese.

## Project Overview

**mana** は brainbase の AI PM エージェントです。Slack を通じてタスク管理、会議議事録処理、プロジェクトオーケストレーションを行います。

### 主要機能
- **タスク管理**: Slackメンションからのタスク自動取り込み、リマインダー、完了追跡
- **会議議事録**: Slackファイル共有からの議事録自動生成・GitHub保存
- **通知連携**: @k.satoメンションを_inbox/pending.mdに自動蓄積
- **プロジェクト情報管理**: DynamoDBによるプロジェクト・チャンネルマッピング

### アーキテクチャ
```
┌─────────────────────────────────────────────────────────┐
│                    mana (AI PM Agent)                    │
├─────────────────────────────────────────────────────────┤
│  タスク取り込み → リマインド → 完了追跡                   │
│  議事録生成 → GitHub保存                                 │
│  通知蓄積 → _inbox連携                                   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   brainbase 運用OS                       │
│  _codex/ (ナレッジ・判断基準・テンプレ・KPI・RACI)        │
│  _tasks/index.md (タスク正本)                            │
│  _inbox/pending.md (通知蓄積)                            │
└─────────────────────────────────────────────────────────┘
```

### 二層構造（会議記録）
会議記録は**議事録**と**トランスクリプト**の二層で保存されます：
- `{path_prefix}minutes/YYYY-MM-DD_name.md` - 議事録（AI処理済み、brainbaseのアクティブデータ）
- `{path_prefix}transcripts/YYYY-MM-DD_name.txt` - トランスクリプト（原本アーカイブ）

## 開発方針

### Test-Driven Development (TDD)
**必須**: t_wada方式のTDDに従ってください。テストを先に書き、Red-Green-Refactorサイクルを守ること。

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
aws logs tail /aws/lambda/mana --follow --profile k.sato --region us-east-1

# DynamoDB操作
# 全プロジェクト取得
aws dynamodb scan --table-name mana-projects --profile k.sato --region us-east-1

# 特定プロジェクト取得
aws dynamodb get-item --table-name mana-projects \
  --key '{"project_id": {"S": "proj_aitle"}}' \
  --profile k.sato --region us-east-1
```

## プロジェクト構造

```
mana/
├── api/                       # Lambda関数メインコード
│   ├── index.js              # エントリポイント（Slack Boltハンドラ）
│   ├── task-ui.js            # サポット風タスクUIブロック
│   ├── task-parser.js        # _tasks/index.mdパーサー
│   ├── reminder.js           # リマインダーサービス（DM送信、旧方式）
│   ├── slack-thread-reminder.js # スレッドリマインダー（Slackタスク専用）
│   ├── project-repository.js # DynamoDBアクセス層
│   ├── github-integration.js # GitHub API連携（Octokit）
│   ├── llm-integration.js    # AWS Bedrock LLM連携
│   ├── slack-archive.js      # Slack履歴S3アーカイブ
│   └── slack-name-resolver.js # Slack ID ↔ brainbase名前解決
├── docs/                      # ドキュメント
├── scripts/                   # ユーティリティスクリプト
├── terraform/                 # インフラコード（使用停止中）
└── README.md                  # プロジェクトREADME
```

## タスクデータ構造

Slackから作成されたタスクは以下のフィールドを持つ：

```yaml
---
id: SLACK-2025-12-08-XXX
title: タスクタイトル
project_id: general
status: todo
owner: keigo
priority: medium
due: null
tags: [slack, auto-import]
links: []
source: slack                      # Slackから作成された場合のみ
channel_id: C123456789             # スレッドリマインド用
thread_ts: "1733644800.123456"     # スレッドリマインド用
created_at: "2025-12-08T10:00:00Z" # リマインド起算用
owner_slack_id: U123456789         # 担当者メンション用
---
```

### リマインダー仕様

**二重リマインダーシステム:**

#### 1. DMサマリー（サポット風UI）
- **トリガー**: EventBridge で毎日9:00 JST
- **対象**: 全ての未完了タスク（担当中 + 依頼中）
- **UI**: 日付ヘッダー + 担当中/依頼中セクション
- **アクション**: 「期限を見直す」ドロップダウン + 「完了」ボタン
- **実装**: `reminder.js` の `sendDailySummary()`

#### 2. スレッドリマインド
- **トリガー**: EventBridge で1時間ごと
- **対象**: `source: slack` のタスクのみ
- **リマインド先**: タスク作成元のスレッド（DMではない）
- **リマインド時刻**: `created_at`から起算（例: 24時間後）
- **完了検知**: スレッドでの完了報告またはボタン操作
- **実装**: `slack-thread-reminder.js`

#### EventBridge設定（terraform/main.tf）
```hcl
# 毎日9:00 JST (0:00 UTC)
schedule_expression = "cron(0 0 * * ? *)"  # daily_reminder

# 1時間ごと
schedule_expression = "rate(1 hour)"       # thread_reminder
```

## データストレージ

### DynamoDB
- **テーブル名**: `mana-projects`（旧: slack-classify-bot-projects）
- **用途**: プロジェクト情報、リポジトリマッピング、Slackチャンネル設定
- **主要フィールド**: `project_id`, `name`, `owner`, `repo`, `path_prefix`, `slack_channels`

### S3
- **バケット**: `brainbase-context-593793022993`
- **用途**: Slack履歴アーカイブ、メンバーマッピング

## 環境変数

必須の環境変数は`api/env.json.template`を参照。デプロイ前に`api/env.json`として設定すること。

**必須環境変数:**
- `SLACK_BOT_TOKEN` - Slack Bot Token
- `SLACK_SIGNING_SECRET` - Slack Signing Secret
- `GITHUB_TOKEN` - GitHub Personal Access Token
- `AWS_REGION` - AWSリージョン（デフォルト: us-east-1）

**オプション環境変数:**
- `PROJECTS_TABLE_NAME` - DynamoDBテーブル名（デフォルト: mana-projects）
- `INBOX_TARGET_USER_ID` - _inbox通知対象のSlack ID（デフォルト: U07LNUP582X）
