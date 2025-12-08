# ソースコード読み取り機能 セットアップガイド

manaがプロジェクトのソースコードを調査できるようにする機能のセットアップ手順。

## アーキテクチャ

```
┌──────────────┐     GitHub Actions      ┌─────────────────────────┐
│   GitHub     │ ─────────────────────▶  │  S3: brainbase-source   │
│  (各リポジトリ) │    push時に同期         │  /{owner}/{repo}/{branch}/│
└──────────────┘                         └─────────────────────────┘
                                                    │
       Slackチャンネル                               │
           ↓                                        ▼
    project_id特定（DynamoDB）         ┌─────────────────────────┐
           ↓                           │  mana Lambda            │
    source_owner/repo/branch取得       │  - list_source_files    │
           ↓                           │  - read_source_file     │
    S3から読み取り  ◀─────────────────  │  - search_source_code   │
                                       └─────────────────────────┘
```

## セットアップ手順

### 1. S3バケット作成

```bash
cd /Users/ksato/workspace/mana
chmod +x scripts/setup-source-code-infra.sh
./scripts/setup-source-code-infra.sh
```

出力されるIAMポリシーをLambda実行ロールに追加。

### 2. DynamoDBにソースリポジトリ情報を追加

`scripts/add-source-repo-fields.js` のマッピングを編集：

```javascript
const SOURCE_REPO_MAPPINGS = {
  'proj_mana': {
    source_owner: 'ksato',
    source_repo: 'mana',
    source_branch: 'main'
  },
  'proj_salestailor': {
    source_owner: 'SalesTailor-inc',
    source_repo: 'salestailor-app',
    source_branch: 'main'
  },
  // ... 各プロジェクトのマッピングを追加
};
```

実行：

```bash
# プレビュー
node scripts/add-source-repo-fields.js --dry-run

# 実行
node scripts/add-source-repo-fields.js
```

### 3. GitHub Actionsワークフローを各リポジトリに設置

`templates/github-actions/sync-to-s3.yml` を各リポジトリにコピー：

```bash
# 対象リポジトリで実行
mkdir -p .github/workflows
cp /path/to/mana/templates/github-actions/sync-to-s3.yml .github/workflows/
```

必要な設定：
1. リポジトリのSecretsに追加：
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`

2. `S3_BUCKET` を正しいバケット名に更新

3. mainブランチにpushして動作確認

### 4. Lambda環境変数を追加

```bash
aws lambda update-function-configuration \
  --function-name mana \
  --environment "Variables={SOURCE_BUCKET=brainbase-source-593793022993,...既存の変数...}"
```

### 5. Lambdaをデプロイ

```bash
cd /Users/ksato/workspace/mana
./deploy.sh
```

## 使い方（Slack）

```
@mana index.jsの中身を見せて

@mana handleMessage関数はどこにある？

@mana api/配下のファイル一覧を教えて

@mana "processEvent" を検索して
```

## ツール一覧

| ツール | 説明 | パラメータ |
|--------|------|-----------|
| `list_source_files` | ファイル一覧取得 | path, pattern, maxFiles |
| `read_source_file` | ファイル読み取り | filePath, maxLines, startLine |
| `search_source_code` | コード内検索 | query, path, filePattern, maxResults |

## トラブルシューティング

### 「Source repo not configured」エラー

DynamoDBに `source_owner`, `source_repo`, `source_branch` が設定されていない。
→ `add-source-repo-fields.js` を実行

### 「File not found」エラー

S3にファイルが同期されていない。
→ GitHub Actionsの実行履歴を確認、手動で `workflow_dispatch` をトリガー

### 「Access denied」エラー

Lambda実行ロールにS3読み取り権限がない。
→ IAMポリシーを確認

## 作成したファイル

- `scripts/setup-source-code-infra.sh` - S3バケット作成スクリプト
- `scripts/add-source-repo-fields.js` - DynamoDB更新スクリプト
- `templates/github-actions/sync-to-s3.yml` - GitHub Actionsテンプレート
- `api/dist/mastra/tools/source-code.js` - Mastraツール実装
- `api/dist/mastra/agents/workspace-mana-agent.js` - エージェント更新（ツール追加）
