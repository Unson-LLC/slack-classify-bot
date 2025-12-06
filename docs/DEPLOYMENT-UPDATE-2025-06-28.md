# DynamoDB重複排除機能 デプロイメント更新（2025-06-28）

## 概要

Slack Botが同じファイルアップロードに対して重複投稿する問題を解決するため、DynamoDBを使用した集中管理型の重複排除機能を実装しました。

## 問題の原因

AWS Lambdaの同時実行により、複数のインスタンスが同じSlackイベントを処理し、それぞれが独立したメモリ空間で重複チェックを行っていたため、重複投稿が発生していました。

## 解決策

### 1. DynamoDBテーブルの追加
- テーブル名: `mana-processed-events`
- プライマリキー: `event_key` (String)
- TTL: 6時間後に自動削除
- 料金: 月額約0.08円（現在の利用量）

### 2. HybridDeduplicationService
- 通常時: DynamoDBで重複チェック
- 障害時: インメモリフォールバック
- 自動復旧: 1分後にDynamoDBへ再接続

## デプロイ手順

### Terraformを使用する場合（推奨）

```bash
# 1. Terraformディレクトリへ移動
cd terraform

# 2. 環境変数を設定
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvarsを編集して実際の値を設定

# 3. Terraformを初期化
terraform init

# 4. 変更内容を確認
terraform plan

# 5. インフラストラクチャを更新
terraform apply

# 6. Lambda関数のコードを更新
cd ..
npm run deploy
```

### 手動デプロイの場合

```bash
# 1. DynamoDBテーブルを作成
aws dynamodb create-table \
  --table-name mana-processed-events \
  --attribute-definitions AttributeName=event_key,AttributeType=S \
  --key-schema AttributeName=event_key,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1 \
  --profile k.sato

# 2. TTLを有効化
aws dynamodb update-time-to-live \
  --table-name mana-processed-events \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" \
  --region us-east-1 \
  --profile k.sato

# 3. Lambda IAMロールにDynamoDB権限を追加
# (AWS ConsoleまたはCLIで実行)

# 4. 環境変数を追加
aws lambda update-function-configuration \
  --function-name mana \
  --environment "Variables={DEDUP_TABLE_NAME=mana-processed-events,...既存の環境変数...}" \
  --region us-east-1 \
  --profile k.sato

# 5. Lambda関数のコードを更新
npm run deploy
```

## 動作確認

```bash
# CloudWatchログで重複排除の動作を確認
aws logs tail /aws/lambda/mana --follow --profile k.sato --region us-east-1

# 以下のようなログが表示されれば成功:
# "DynamoDB deduplication enabled"
# "Processing new file upload event (key: ...)"
# "Duplicate event detected (key: ...), reason: Already processed by another instance"
```

## ロールバック手順

問題が発生した場合:

```bash
# 1. 前のバージョンに戻す
git checkout 956fae2  # 前のコミット
npm run deploy

# 2. DynamoDBテーブルを削除（オプション）
aws dynamodb delete-table \
  --table-name mana-processed-events \
  --region us-east-1 \
  --profile k.sato
```

## 影響範囲

- **パフォーマンス**: DynamoDB呼び出しによる数ミリ秒の遅延
- **コスト**: 月額約0.08円の追加（無視できるレベル）
- **信頼性**: 重複投稿の完全防止
- **互換性**: 既存の機能に影響なし

## テスト結果

- ✅ EventDeduplicationService: 9/9 テスト合格
- ✅ HybridDeduplicationService: 9/9 テスト合格
- ✅ 統合テスト: 5/5 テスト合格

## 関連ドキュメント

- 設計書: `docs/design/DYNAMODB-DEDUPLICATION-DESIGN.md`
- コスト分析: `docs/design/DYNAMODB-COST-ANALYSIS.md`
- Terraform設定: `terraform/main.tf`