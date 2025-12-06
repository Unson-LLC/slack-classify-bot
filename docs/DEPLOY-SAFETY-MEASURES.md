# デプロイ時の環境変数保護対策（2025-06-28実装）

## 実装した再発防止策

### 1. `.gitignore`の更新
- `api/env.json`を追加して、機密情報が誤ってコミットされることを防止
- `terraform/*.tfvars`も追加

### 2. `env.json.template`の更新
- 新しい必須環境変数を追加:
  - `SLACK_BOT_ID`: Bot自身のメッセージを無視するため
  - `DEDUP_TABLE_NAME`: DynamoDB重複排除テーブル名

### 3. `deploy.sh`の安全性向上
以下のチェックを追加：
- `env.json`が存在しない場合は環境変数の更新をスキップ
- `env.json`にテンプレート値が含まれている場合はデプロイを中止
- エラーメッセージで具体的な対処法を表示

### 4. デプロイ前チェックスクリプト（`pre-deploy-check.sh`）
以下の項目を自動チェック：
1. **環境設定**: env.jsonの存在と内容の妥当性
2. **AWS設定**: CLIとプロファイルの確認
3. **Node.js環境**: バージョン18.x以上の確認
4. **依存関係**: node_modulesの最新性
5. **テスト状態**: すべてのテストが通っているか
6. **インフラ**: DynamoDBテーブルの存在確認
7. **Git状態**: 未コミットの変更確認

## 使用方法

### デプロイ前の確認
```bash
./pre-deploy-check.sh
```

### 安全なデプロイ手順
```bash
# 1. デプロイ前チェック
./pre-deploy-check.sh

# 2. エラーがなければデプロイ
./deploy.sh
```

### 環境変数の更新のみ
```bash
# env.jsonを編集後
aws lambda update-function-configuration \
  --function-name mana \
  --environment "file://api/env.json" \
  --profile k.sato \
  --region us-east-1
```

## トラブルシューティング

### env.jsonが上書きされた場合
1. CloudWatchログから以前の環境変数を確認
2. env.json.templateをコピーして実際の値を設定
3. 環境変数のみを更新（コードのデプロイは不要）

### テンプレート値でデプロイしようとした場合
- deploy.shが自動的にエラーを出して停止します
- env.jsonを正しい値で更新してから再実行

## 今後の改善案

1. **AWS Secrets Manager**の使用
   - 環境変数をSecrets Managerで管理
   - Lambda関数から動的に取得

2. **GitHub Actions**での自動デプロイ
   - シークレットをGitHub Secretsで管理
   - プルリクエストマージ時に自動デプロイ

3. **環境別設定**
   - dev/staging/production環境の分離
   - 環境ごとの設定ファイル管理