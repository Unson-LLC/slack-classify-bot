# デプロイメントガイド

## デプロイメントスクリプト（deploy.sh）

デプロイメントプロセスは以下のステップで実行されます：

1. **バージョンタイムスタンプの作成**
   - `api/version.txt`に現在時刻を記録
   - デプロイ履歴の追跡に使用

2. **古いパッケージのクリーンアップ**
   - 前回のデプロイメント残骸を削除
   - クリーンな状態からパッケージング開始

3. **本番用依存関係のインストール**
   - `npm ci --production`で確実な依存関係インストール
   - devDependenciesは含まれない

4. **デプロイメントZIPの作成**
   - 以下を除外：
     - テストファイル（`__tests__/`）
     - 設定ファイル（`.eslintrc`、`jest.config.js`など）
     - 開発用ファイル
   - 必要なファイルのみを含む最小限のパッケージ

5. **Lambda関数コードの更新**
   ```bash
   aws lambda update-function-code \
     --function-name slack-classify-bot \
     --zip-file fileb://./slack-classify-bot.zip \
     --profile k.sato \
     --region us-east-1
   ```

6. **環境変数の更新**
   - `api/env.json`から環境変数を読み込み
   - Lambda関数設定を更新

7. **デプロイメント完了待機**
   - 関数の更新が完了するまで待機
   - 成功/失敗をユーザーに通知

8. **関数URLの表示**
   - デプロイ後の関数URLを表示
   - Slack Appの設定に使用

## AWS設定

### Lambda関数設定

- **ランタイム**: Node.js 18.x
- **ハンドラー**: `index.handler`
- **タイムアウト**: 30秒
- **メモリ**: 256MB
- **アーキテクチャ**: x86_64
- **プロファイル**: k.sato（deploy.shで設定）
- **リージョン**: us-east-1

### IAMロール要件

Lambda実行ロールには以下の権限が必要：

1. **基本的なLambda実行権限**
   - CloudWatch Logsへの書き込み

2. **AWS Bedrock権限**
   - `bedrock:InvokeModel`
   - Claude Sonnet 4モデルへのアクセス

3. **その他のサービス権限**
   - 必要に応じて追加

## 環境変数の管理

### 必須環境変数（api/env.json）

```json
{
  "Variables": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_SIGNING_SECRET": "...",
    "SLACK_BOT_ID": "U...",
    "N8N_ENDPOINT": "https://...",
    "N8N_AIRTABLE_ENDPOINT": "https://...",
    "AIRTABLE_BASE_ID": "app...",
    "AIRTABLE_API_KEY": "pat...",
    "AIRTABLE_TABLE_NAME": "Projects",
    "BEDROCK_REGION": "us-east-1"
  }
}
```

### 環境変数の更新

個別に環境変数を更新する場合：

```bash
aws lambda update-function-configuration \
  --function-name slack-classify-bot \
  --environment "Variables={KEY=value}" \
  --profile k.sato \
  --region us-east-1
```

## デプロイメントコマンド

### 通常のデプロイ

```bash
# ルートディレクトリから
npm run deploy

# または直接実行
./deploy.sh
```

### Lambda関数のパッケージング（デプロイなし）

```bash
# ルートディレクトリから
npm run package

# またはapiディレクトリで
cd api && npm run package
```

### 手動デプロイ手順

1. 依存関係のインストール
   ```bash
   cd api
   npm ci --production
   ```

2. ZIPファイルの作成
   ```bash
   zip -r ../slack-classify-bot.zip . \
     -x "*.git*" \
     -x "*test*" \
     -x "*.md" \
     -x "jest.*" \
     -x ".eslintrc*"
   ```

3. Lambdaへのアップロード
   ```bash
   aws lambda update-function-code \
     --function-name slack-classify-bot \
     --zip-file fileb://./slack-classify-bot.zip \
     --profile k.sato \
     --region us-east-1
   ```

## デプロイ後の確認

1. **CloudWatchログの確認**
   ```bash
   aws logs tail /aws/lambda/slack-classify-bot --follow --profile k.sato --region us-east-1
   ```

2. **関数設定の確認**
   ```bash
   aws lambda get-function-configuration \
     --function-name slack-classify-bot \
     --profile k.sato \
     --region us-east-1
   ```

3. **テスト実行**
   ```bash
   aws lambda invoke \
     --function-name slack-classify-bot \
     --payload file://test-event.json \
     response.json \
     --profile k.sato \
     --region us-east-1
   ```

## ロールバック手順

デプロイに問題があった場合：

1. **前のバージョンのコードを特定**
   - CloudFormationスタックの履歴を確認
   - または前のデプロイメントZIPを保存しておく

2. **ロールバック実行**
   ```bash
   aws lambda update-function-code \
     --function-name slack-classify-bot \
     --zip-file fileb://./previous-version.zip \
     --profile k.sato \
     --region us-east-1
   ```

3. **動作確認**
   - ログを確認してエラーがないことを確認
   - Slackでの動作をテスト