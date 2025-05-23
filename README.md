# Slack Classify Bot with n8n GitHub Integration

このプロジェクトは、Slackメッセージを自動分類し、n8nを通じてGitHubリポジトリにデータを保存するSlackボットです。

## 🚀 機能

- **自動メッセージ分類**: Slackメッセージをカテゴリ別に自動分類
- **GitHubデータ保存**: n8nワークフローを通じてGitHubに分類結果を保存
- **リアルタイム処理**: Slackメッセージをリアルタイムで処理
- **日次サマリー**: 日別の分類サマリーをGitHubに保存
- **スラッシュコマンド**: `/classify`コマンドで手動分類も可能

## 📊 分類カテゴリ

- `bug` - バグ、問題、エラー関連
- `feature-request` - 新機能要望、改善提案
- `question` - 質問、ヘルプ依頼
- `feedback` - フィードバック、提案
- `urgent` - 緊急、重要な事項
- `performance` - パフォーマンス関連
- `security` - セキュリティ関連
- `documentation` - ドキュメント関連
- `general` - その他一般的な内容

## 🛠️ セットアップ

### 1. 環境変数の設定

`.env`ファイルを作成し、以下の環境変数を設定：

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
N8N_ENDPOINT=https://your-n8n-instance.com
```

### 2. n8nワークフローのインポート

1. n8nにログインし、新しいワークフローを作成
2. `n8n-workflow-slack-to-github.json`の内容をインポート
3. GitHubクレデンシャルを設定
4. ワークフローをアクティブ化

### 3. Slackアプリの設定

1. [Slack API](https://api.slack.com/apps)でアプリを作成
2. 必要な権限を設定：
   - `app_mentions:read`
   - `channels:history`
   - `chat:write`
   - `commands`
   - `groups:history`
   - `im:history`
   - `mpim:history`

3. スラッシュコマンドを追加：
   - コマンド: `/classify`
   - リクエストURL: `https://your-vercel-app.vercel.app/slack/events`

4. Event Subscriptionsを有効化：
   - リクエストURL: `https://your-vercel-app.vercel.app/slack/events`
   - `message.channels`, `message.groups`, `message.im`, `message.mpim`を購読

### 4. デプロイ

#### Vercelでのデプロイ

```bash
npm install -g vercel
vercel --prod
```

#### 環境変数の設定（Vercel）

```bash
vercel env add SLACK_BOT_TOKEN
vercel env add SLACK_SIGNING_SECRET
vercel env add N8N_ENDPOINT
```

## 📁 プロジェクト構造

```
slack-classify-bot/
├── api/
│   ├── app.js                 # メインアプリケーション
│   └── n8n-integration.js     # n8n統合ヘルパー
├── .github/
│   └── workflows/
│       └── deploy.yml         # CI/CDパイプライン
├── n8n-workflow-slack-to-github.json  # n8nワークフロー定義
├── package.json
├── vercel.json
└── README.md
```

## 📊 GitHubデータ構造

### 分類データ (`data/classifications.json`)

```json
[
  {
    "id": "slack-1234567890-U123456",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "user": "U123456",
    "channel": "C123456",
    "text": "There's a bug in the login system",
    "category": "bug",
    "source": "slack",
    "metadata": {
      "original_event": {...},
      "classification_timestamp": "2024-01-01T12:00:01.000Z"
    }
  }
]
```

### 日次サマリー (`data/daily-summary/2024-01-01.json`)

```json
{
  "date": "2024-01-01",
  "totalClassifications": 150,
  "newClassification": {...},
  "summary": {
    "user": "U123456",
    "category": "bug",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

## 🔧 n8nワークフロー詳細

ワークフローは以下のステップで動作します：

1. **Webhook受信**: Slackからのデータを受信
2. **イベントフィルタ**: Slack event_callbackのみを処理
3. **メッセージ分類**: テキスト内容を基にカテゴリを決定
4. **既存データ取得**: GitHubから現在の分類ファイルを取得
5. **データマージ**: 新しい分類を既存データに追加
6. **GitHub保存**: 更新されたデータをGitHubにコミット
7. **日次サマリー**: その日の分類サマリーを別途保存
8. **レスポンス**: 処理結果をSlackに返す

## 🧪 テスト

```bash
# Slackでテスト
/classify This is a test message about a bug

# 直接メッセージ
@bot_name This feature request would be great
```

## 🤝 貢献

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📄 ライセンス

ISC License

## 🆘 サポート

問題が発生した場合は、GitHubのIssuesセクションで報告してください。 