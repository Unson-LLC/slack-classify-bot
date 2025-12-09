# mana Lambda デプロイ手順

mana（AI PMエージェント）のAWS Lambdaデプロイに関する完全な手順。

## 基本情報

| 項目 | 値 |
|------|-----|
| AWSプロファイル | `k.sato` |
| リージョン | `us-east-1` |
| Lambda関数 | `mana`, `mana-techknight`, `mana-salestailor` |
| S3バケット | `mana-lambda-deployments-us-east-1` |
| ソースディレクトリ | `/Users/ksato/workspace/mana/api` |

## アーキテクチャ

mana Lambdaはレイヤー分離方式を採用：

```
Lambda関数（約700KB）
├── index.js
├── mastra/（エージェントコード）
├── dist/（ビルド済みファイル）
└── node_modules/（新規依存のみ）

レイヤー（約45MB）
├── mastra-deps:4
├── slack-bolt-deps:1
├── misc-deps:2
└── ai-sdk-deps:1
```

**重要**: 解凍後サイズ制限は250MB（コード+レイヤー合計）

---

## 1. 環境変数更新手順

環境変数を追加・変更する場合の安全な手順。

### 手順

```bash
# 1. バックアップ取得
AWS_PROFILE=k.sato aws lambda get-function-configuration \
  --function-name mana \
  --region us-east-1 \
  --query 'Environment' > /tmp/mana_env.json

# 2. 環境変数を編集（jqで追加）
cat /tmp/mana_env.json | jq '.Variables += {
  "NEW_VAR_1": "value1",
  "NEW_VAR_2": "value2"
}' > /tmp/mana_env_updated.json

# 3. 更新を適用
AWS_PROFILE=k.sato aws lambda update-function-configuration \
  --function-name mana \
  --region us-east-1 \
  --environment file:///tmp/mana_env_updated.json

# 4. 他のLambdaにも同様に適用（必要に応じて）
# mana-techknight, mana-salestailor
```

---

## 2. コードデプロイ手順

### 推奨: deploy.sh を使用（最も安全）

```bash
cd /Users/ksato/workspace/mana
./deploy.sh
```

**注意**: `deploy.sh`は`mana`のみにデプロイする。3つ全てに反映するには追加手順が必要：

```bash
# deploy.sh実行後、残り2つにもデプロイ
AWS_PROFILE=k.sato aws s3 cp function.zip \
  s3://mana-lambda-deployments-us-east-1/lambda-deploy.zip \
  --region us-east-1

AWS_PROFILE=k.sato aws lambda update-function-code \
  --function-name mana-techknight \
  --s3-bucket mana-lambda-deployments-us-east-1 \
  --s3-key lambda-deploy.zip \
  --region us-east-1

AWS_PROFILE=k.sato aws lambda update-function-code \
  --function-name mana-salestailor \
  --s3-bucket mana-lambda-deployments-us-east-1 \
  --s3-key lambda-deploy.zip \
  --region us-east-1
```

---

### 手動デプロイ手順（deploy.shが使えない場合のみ）

#### ステップ1: TypeScriptビルド

```bash
cd /Users/ksato/workspace/mana/api
npm run build:mastra
```

#### ステップ2: デプロイ用ZIP作成

**⚠️ 重要**: 必須ファイルを漏らさないこと！以下のファイルは必ず含める：

| 必須ファイル | 役割 |
|-------------|------|
| `index.js` | エントリーポイント |
| `processFileUpload.js` | 議事録ファイル処理 |
| `llm-integration.js` | LLM呼び出し |
| `airtable-integration.js` | Airtable連携 |
| `dynamodb-deduplication.js` | イベント重複排除 |
| `slack-archive.js` | Slackアーカイブ |
| `slack-name-resolver.js` | Slack名前解決 |
| `github-integration.js` | GitHub連携 |
| `task-parser.js` | タスクパース |
| `task-ui.js` | タスクUI |
| `reminder.js` | リマインダー |
| `thread-context.js` | スレッドコンテキスト |
| `dist/` | ビルド済みMastra |

```bash
cd /Users/ksato/workspace/mana/api

# 全ての必須ファイルを含めてZIP作成
zip -r lambda-deploy.zip \
  index.js \
  processFileUpload.js \
  llm-integration.js \
  airtable-integration.js \
  dynamodb-deduplication.js \
  slack-archive.js \
  slack-name-resolver.js \
  github-integration.js \
  task-parser.js \
  task-ui.js \
  reminder.js \
  thread-context.js \
  user-permissions.js \
  security-classifier.js \
  n8n-integration.js \
  project-repository.js \
  dist/ \
  -x "*.ts" -x "*.test.js" -x "__tests__/*" -x "*.map"

# 新規パッケージを追加した場合のみ、そのパッケージをZIPに追加
# 例：Gmail API
zip -r lambda-deploy.zip \
  node_modules/@googleapis \
  node_modules/google-auth-library

# サイズ確認（目安: 15MB以下）
ls -lh lambda-deploy.zip

# 必須ファイルが含まれているか確認
unzip -l lambda-deploy.zip | grep -E "processFileUpload|llm-integration|airtable"
```

#### ステップ3: S3アップロード

```bash
AWS_PROFILE=k.sato aws s3 cp lambda-deploy.zip \
  s3://mana-lambda-deployments-us-east-1/lambda-deploy.zip \
  --region us-east-1
```

### ステップ4: Lambda関数を更新

```bash
# 3つのLambda関数をすべて更新
for fn in mana mana-techknight mana-salestailor; do
  AWS_PROFILE=k.sato aws lambda update-function-code \
    --function-name $fn \
    --s3-bucket mana-lambda-deployments-us-east-1 \
    --s3-key lambda-deploy.zip \
    --region us-east-1
done
```

---

## トラブルシューティング

### エラー: パッケージサイズ超過

```
Unzipped size must be smaller than 262144000 bytes
```

**原因**: node_modulesを含めすぎている

**解決**:
1. node_modulesを除外（レイヤーに既存の依存がある）
2. 新規パッケージのみを選択的に追加
3. 大きなパッケージ（googleapis等）は軽量版を使用
   - `googleapis` (193MB) → `@googleapis/gmail` (1MB)

### エラー: リージョン不一致

```
S3 Error Code: AuthorizationHeaderMalformed
```

**原因**: S3バケットとLambdaのリージョンが異なる

**解決**: us-east-1のS3バケットを使用

### エラー: Lambda not found

**解決**: リージョンをus-east-1に指定しているか確認

### エラー: Cannot find module './processFileUpload'

```
Runtime.ImportModuleError: Error: Cannot find module './processFileUpload'
```

**原因**: 手動ZIP作成時に必須ファイルを含め忘れた

**解決**:
1. `deploy.sh`を使用する（推奨）
2. 手動の場合は必須ファイル一覧を確認
3. デプロイ前に確認: `unzip -l lambda-deploy.zip | grep processFileUpload`

---

## 新規パッケージ追加時のチェックリスト

1. [ ] パッケージサイズを確認 (`du -sh node_modules/パッケージ名`)
2. [ ] 軽量版があるか確認（googleapis → @googleapis/〇〇）
3. [ ] レイヤーに既存の依存があるか確認
4. [ ] ZIPに必要最小限の依存のみ追加
5. [ ] 環境変数が必要か確認（APIキー等）
6. [ ] ローカルテストを実行
7. [ ] 3つのLambda全てにデプロイ

---

## 現在のレイヤー内容

確認コマンド:
```bash
AWS_PROFILE=k.sato aws lambda get-function \
  --function-name mana \
  --region us-east-1 \
  --query 'Configuration.Layers'
```

| レイヤー | サイズ | 主な内容 |
|---------|--------|----------|
| mastra-deps:4 | 19MB | @mastra/core等 |
| slack-bolt-deps:1 | 4MB | @slack/bolt等 |
| misc-deps:2 | 19MB | zod, axios等 |
| ai-sdk-deps:1 | 3MB | @ai-sdk等 |

---

最終更新: 2025-12-08
