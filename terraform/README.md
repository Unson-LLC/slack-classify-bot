# Terraform Infrastructure for Slack Classify Bot

このディレクトリには、Slack Classify BotのAWSインフラストラクチャをTerraformで管理するための設定が含まれています。

## 構成要素

- **Lambda Function**: Slack Botのメインロジック
- **DynamoDB Table**: イベント重複排除用のテーブル（TTL設定付き）
- **IAM Roles & Policies**: Lambda実行に必要な権限
- **CloudWatch Logs**: ログ管理（14日間保持）
- **Lambda Function URL**: Slack Webhookエンドポイント

## セットアップ

1. **Terraformの初期化**
   ```bash
   cd terraform
   terraform init
   ```

2. **環境変数の設定**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # terraform.tfvarsを編集して実際の値を設定
   ```

3. **プランの確認**
   ```bash
   terraform plan
   ```

4. **インフラストラクチャの作成**
   ```bash
   terraform apply
   ```

## 重要な変更点

### DynamoDB Table追加（2025-06-28）
- 重複投稿を防ぐためのイベント重複排除テーブルを追加
- TTL設定により6時間後に自動的にレコードを削除
- Pay-per-requestモデルで自動スケーリング

### IAM権限の更新
- DynamoDB読み書き権限を追加
- Bedrock権限を明示的に定義

## 環境変数

以下の環境変数をterraform.tfvarsに設定する必要があります：

- `SLACK_BOT_TOKEN`: Slack Bot OAuth Token
- `SLACK_SIGNING_SECRET`: Slack App Signing Secret
- `SLACK_BOT_ID`: Bot User ID
- `N8N_ENDPOINT`: n8n Webhook URL
- `N8N_AIRTABLE_ENDPOINT`: n8n Airtable統合用Webhook URL
- `AIRTABLE_BASE_ID`: Airtable Base ID
- `AIRTABLE_API_KEY`: Airtable Personal Access Token
- `AIRTABLE_TABLE_NAME`: Airtableテーブル名（デフォルト: "Projects"）

## デプロイ手順

1. **Lambdaパッケージの作成**
   ```bash
   cd ../api
   npm run package
   ```

2. **Terraformでデプロイ**
   ```bash
   cd ../terraform
   terraform apply
   ```

3. **Function URLの確認**
   ```bash
   terraform output lambda_function_url
   ```

## ロールバック

問題が発生した場合：
```bash
terraform destroy
```

## 注意事項

- terraform.tfvarsには機密情報が含まれるため、絶対にGitにコミットしないでください
- 本番環境への適用前に必ずterraform planで変更内容を確認してください
- DynamoDBテーブルは削除保護が設定されていないため、destroyコマンドに注意してください