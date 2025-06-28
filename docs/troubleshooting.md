# トラブルシューティングガイド

## 一般的な問題と解決方法

### 1. Lambda タイムアウト

**症状**: 
- Lambda関数が30秒でタイムアウトする
- CloudWatchログに "Task timed out" エラー

**原因**:
- 大きなファイルの処理
- 外部APIの応答が遅い
- Bedrockモデルの応答時間

**解決方法**:
1. SAMテンプレートまたはAWSコンソールでタイムアウト値を増やす
   ```yaml
   Timeout: 60  # 60秒に増加
   ```

2. ファイルサイズ制限を実装
   ```javascript
   const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
   ```

3. 非同期処理の最適化
   - 並列処理の活用
   - 不要な待機時間の削減

### 2. Slack検証エラー

**症状**:
- "Slack verification failed" エラー
- 401 Unauthorized レスポンス

**原因**:
- SLACK_SIGNING_SECRETが正しくない
- リクエストタイムスタンプが古い（5分以上）
- リクエストボディの改変

**解決方法**:
1. 環境変数の確認
   ```bash
   aws lambda get-function-configuration \
     --function-name slack-classify-bot \
     --query 'Environment.Variables.SLACK_SIGNING_SECRET' \
     --profile k.sato \
     --region us-east-1
   ```

2. Slack App設定の確認
   - Signing Secretが正しくコピーされているか
   - 環境変数に余分なスペースが含まれていないか

3. タイムスタンプの検証
   ```javascript
   const timestamp = req.headers['x-slack-request-timestamp'];
   const currentTime = Math.floor(Date.now() / 1000);
   if (Math.abs(currentTime - timestamp) > 300) {
     throw new Error('Request timestamp too old');
   }
   ```

### 3. n8n接続エラー

**症状**:
- "Failed to send to n8n" エラー
- n8nワークフローがトリガーされない

**原因**:
- WebhookURLが間違っている
- n8nワークフローが非アクティブ
- ネットワーク接続の問題

**解決方法**:
1. WebhookURLの確認
   - 環境変数のURLが正しいか確認
   - HTTPSであることを確認

2. n8nワークフローの状態確認
   - ワークフローがアクティブになっているか
   - Webhookノードが正しく設定されているか

3. cURLでのテスト
   ```bash
   curl -X POST $N8N_ENDPOINT \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}'
   ```

### 4. Airtableエラー

**症状**:
- "Failed to fetch projects from Airtable" エラー
- プロジェクトリストが表示されない

**原因**:
- APIキーの期限切れまたは無効
- Base IDまたはTable名が間違っている
- レート制限に到達

**解決方法**:
1. APIキーの確認
   ```bash
   node api/test-airtable.js
   ```

2. Airtable設定の確認
   - Personal Access Tokenが有効か
   - 必要なスコープが付与されているか

3. レート制限の対処
   - リトライロジックの実装
   - キャッシュの活用

### 5. Bedrockエラー

**症状**:
- "Failed to generate summary" エラー
- AI機能が動作しない

**原因**:
- リージョンがus-east-1でない
- IAMロールに権限がない
- モデルへのアクセスが有効化されていない

**解決方法**:
1. リージョンの確認（強制的にus-east-1を使用）
   ```javascript
   const BEDROCK_REGION = 'us-east-1'; // ハードコード
   ```

2. IAM権限の確認
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "bedrock:InvokeModel",
       "Resource": "arn:aws:bedrock:us-east-1::foundation-model/*"
     }]
   }
   ```

3. モデルアクセスの有効化
   - AWSコンソールでBedrockにアクセス
   - Model accessページでClaude Sonnet 4を有効化

### 6. 重複処理

**症状**:
- 同じファイルが複数回処理される
- 同じメッセージが複数回投稿される

**原因**:
- イベント重複排除が機能していない
- SLACK_BOT_IDが設定されていない
- キャッシュTTLが短すぎる

**解決方法**:
1. SLACK_BOT_IDの設定確認
   ```javascript
   if (event.user === process.env.SLACK_BOT_ID) {
     return; // 自分のメッセージは無視
   }
   ```

2. 重複排除キャッシュの確認
   - 5分間のTTLが適切か評価
   - イベントIDが正しく生成されているか

## デバッグコマンド

### ログの確認

```bash
# リアルタイムログ監視
aws logs tail /aws/lambda/slack-classify-bot --follow --profile k.sato --region us-east-1

# 特定時間範囲のログ取得
aws logs filter-log-events \
  --log-group-name /aws/lambda/slack-classify-bot \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --profile k.sato \
  --region us-east-1
```

### 関数の状態確認

```bash
# 関数設定の確認
aws lambda get-function-configuration \
  --function-name slack-classify-bot \
  --profile k.sato \
  --region us-east-1

# 関数の最終更新時刻
aws lambda get-function \
  --function-name slack-classify-bot \
  --query 'Configuration.LastModified' \
  --profile k.sato \
  --region us-east-1
```

### テスト実行

```bash
# テストイベントでの実行
aws lambda invoke \
  --function-name slack-classify-bot \
  --payload file://test-event.json \
  --log-type Tail \
  response.json \
  --profile k.sato \
  --region us-east-1

# ログの確認（Base64デコード）
cat response.json | jq -r '.LogResult' | base64 -d
```

## パフォーマンス最適化

### メモリ使用量の確認

CloudWatchメトリクスで以下を監視：
- Duration（実行時間）
- Memory Usage（メモリ使用量）
- Concurrent Executions（同時実行数）

### コールドスタート対策

1. **定期的なウォームアップ**
   - CloudWatch Eventsで定期実行
   - 軽量なpingイベントを送信

2. **依存関係の最小化**
   - 不要なnpmパッケージを削除
   - 動的importの活用

3. **Lambda Layersの使用**
   - 共通ライブラリをLayerに分離
   - デプロイサイズの削減