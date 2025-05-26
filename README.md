# Slack Classify Bot - AWS Lambda Version

このプロジェクトは、Slackメッセージを自動分類し、n8nを通じてGitHubリポジトリにデータを保存するSlackボットです。AWS Lambdaでサーバーレス実行されます。

## 🚀 機能

- **自動メッセージ分類**: Slackメッセージをカテゴリ別に自動分類
- **ファイル処理**: .txtファイルをAirtableに送信
- **GitHubデータ保存**: n8nワークフローを通じてGitHubに分類結果を保存
- **リアルタイム処理**: Slackメッセージをリアルタイムで処理
- **スラッシュコマンド**: `/classify`、`/process-file`コマンドで手動操作も可能
- **サーバーレス**: AWS Lambdaでコスト効率的に実行

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

### 前提条件

- AWS CLI設定済み
- Node.js 18+
- Slack App作成済み
- n8nインスタンス稼働中

### 1. リポジトリのクローン

```bash
git clone https://github.com/sintariran/slack-classify-bot.git
cd slack-classify-bot
```

### 2. 環境変数の設定（オプション）

```bash
export SLACK_BOT_TOKEN=xoxb-your-bot-token
export SLACK_SIGNING_SECRET=your-signing-secret
export N8N_ENDPOINT=https://your-n8n-instance.com
```

### 3. デプロイ

```bash
# ルートディレクトリから
npm run deploy

# または直接
cd api
./deploy.sh
```

### 4. Slackアプリの設定

1. [Slack API](https://api.slack.com/apps)でアプリを作成
2. 必要な権限を設定：
   - `chat:write`
   - `files:read`
   - `commands`

3. Event Subscriptionsを有効化：
   - リクエストURL: `https://your-lambda-function-url.lambda-url.region.on.aws/`
   - 購読イベント:
     - `message.channels`
     - `message.groups`
     - `message.im`
     - `file_shared`

4. スラッシュコマンドを追加：
   - `/classify` - メッセージを手動分類
   - `/process-file` - ファイルを手動処理
   - `/hello-bolt-app` - テストコマンド

### 5. n8nワークフローのセットアップ

1. n8nにログインし、新しいワークフローを作成
2. `n8n-workflow-slack-to-github.json`の内容をインポート
3. `n8n-workflow-airtable-github.json`の内容をインポート
4. GitHubとAirtableのクレデンシャルを設定
5. ワークフローをアクティブ化

## 📁 プロジェクト構造

```
slack-classify-bot/
├── api/
│   ├── lambda-handler.js      # Lambda関数メインハンドラー
│   ├── n8n-integration.js     # n8n統合（メッセージ分類）
│   ├── airtable-integration.js # Airtable統合（ファイル処理）
│   ├── package.json           # Lambda用依存関係
│   ├── deploy.sh              # デプロイスクリプト
│   ├── template.yaml          # SAMテンプレート
│   └── README-Lambda.md       # Lambda詳細ドキュメント
├── .github/
│   └── workflows/             # CI/CDパイプライン
├── data/                      # サンプルデータ
├── terraform/                 # インフラ設定
├── n8n-workflow-*.json        # n8nワークフロー定義
├── package.json               # プロジェクト設定
└── README.md                  # このファイル
```

## 🔧 AWS Lambda設定

### 関数設定
- **Runtime**: Node.js 18.x
- **Handler**: `lambda-handler.handler`
- **Timeout**: 30秒
- **Memory**: 256MB
- **Architecture**: x86_64

### 環境変数
- `SLACK_BOT_TOKEN`: Slackボットトークン
- `SLACK_SIGNING_SECRET`: Slack署名シークレット
- `N8N_ENDPOINT`: n8nインスタンスのエンドポイント
- `N8N_AIRTABLE_ENDPOINT`: Airtable用n8nエンドポイント（オプション）

### IAMロール
- `AWSLambdaBasicExecutionRole`
- CloudWatch Logsへの書き込み権限

## 📊 データフロー

### メッセージ分類フロー
1. Slackメッセージ受信
2. Lambda関数で分類処理
3. n8n webhook (`/webhook/slack-classify`) に送信
4. GitHubリポジトリに保存

### ファイル処理フロー
1. Slackファイルアップロード検知
2. .txtファイルのみ処理
3. n8n webhook (`/webhook/slack-airtable`) に送信
4. Airtableに保存

## 🧪 テスト

```bash
# Slackでテスト
/classify This is a test message about a bug
/process-file F1234567890
/hello-bolt-app

# 直接メッセージ
@bot_name This feature request would be great
```

## 📈 監視とログ

- **CloudWatch Logs**: Lambda実行ログ
- **CloudWatch Metrics**: 実行時間、エラー率
- **X-Ray**: 分散トレーシング（オプション）

## 💰 コスト最適化

- サーバーレスアーキテクチャで従量課金
- 適切なメモリ設定でコスト削減
- 不要なログ出力を最小化

## 🔧 開発とデバッグ

### ローカルテスト
```bash
# SAM CLIを使用
cd api
sam local start-api

# 直接テスト
node lambda-handler.js
```

### ログ確認
```bash
aws logs tail /aws/lambda/slack-classify-bot --follow
```

## 🚀 デプロイオプション

### 1. 自動デプロイスクリプト（推奨）
```bash
npm run deploy
```

### 2. SAMを使用
```bash
cd api
sam build
sam deploy --guided
```

### 3. 手動デプロイ
```bash
cd api
npm install
npm run package
aws lambda update-function-code --function-name slack-classify-bot --zip-file fileb://lambda-deployment.zip
```

## 🤝 貢献

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを作成

## 📄 ライセンス

MIT License

## 🆘 サポート

問題が発生した場合は、GitHubのIssuesセクションで報告してください。

### よくある問題

- **Lambda timeout**: メモリやタイムアウト設定を調整
- **Slack verification failed**: 署名シークレットを確認
- **n8n connection error**: エンドポイントURLを確認
- **Permission denied**: IAMロールの権限を確認

詳細なトラブルシューティングは `api/README-Lambda.md` を参照してください。 