# Mana Source Code Search Architecture (EFS + ripgrep)

## 概要

Mana BotがプロジェクトのソースコードをSlack経由で高速検索できる仕組み。
EFS (Elastic File System) + ripgrep による高速検索を実現。

## アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              VPC外                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Slack      ──────▶   API Gateway   ──────▶   mana-salestailor         │
│                                               (VPC外 Lambda)             │
│                                                     │                    │
│                                                     │ Lambda Invoke      │
│                                                     ▼                    │
├─────────────────────────────────────────────────────────────────────────┤
│                              VPC内                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                            mana-search                                   │
│                           (VPC内 Lambda)                                 │
│                                 │                                        │
│                    ┌────────────┼────────────┐                          │
│                    │            │            │                          │
│                    ▼            ▼            ▼                          │
│              list files   read file    search (rg)                      │
│                    │            │            │                          │
│                    └────────────┼────────────┘                          │
│                                 │                                        │
│                                 ▼                                        │
│                        ┌───────────────┐                                │
│                        │     EFS       │                                │
│                        │  /mnt/source  │                                │
│                        ├───────────────┤                                │
│                        │ owner/repo/   │                                │
│                        │   branch/     │                                │
│                        │     files...  │                                │
│                        └───────────────┘                                │
│                                 ▲                                        │
│                                 │                                        │
│                          mana-efs-sync                                   │
│                          (VPC内 Lambda)                                  │
│                                 │                                        │
│                                 │ S3 VPC Endpoint                       │
│                                 ▼                                        │
│                    ┌────────────────────────┐                           │
│                    │   S3 Source Bucket     │                           │
│                    │  brainbase-source-*    │                           │
│                    └────────────────────────┘                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## コンポーネント

### 1. mana-salestailor (VPC外 Lambda)
- **役割**: Slack Event受信、AI思考、応答生成
- **設定**: VPC外（Bedrock/外部API接続のため）
- **メモリ**: 2048MB, タイムアウト: 600秒

### 2. mana-search (VPC内 Lambda)
- **役割**: ソースコード検索（list/read/search）
- **設定**: VPC内、EFSマウント
- **メモリ**: 512MB, タイムアウト: 60秒
- **レイヤー**: ripgrep-arm64

### 3. mana-efs-sync (VPC内 Lambda)
- **役割**: S3からEFSへソースコード同期
- **設定**: VPC内、EFSマウント
- **メモリ**: 2048MB, タイムアウト: 900秒
- **トリガー**: EventBridge (定期実行) / 手動

### 4. EFS (Elastic File System)
- **ID**: fs-02e918819d61d1e9d
- **マウントパス**: /mnt/source
- **ディレクトリ構造**: `/{owner}/{repo}/{branch}/`

### 5. Lambda Layer: ripgrep-arm64
- **ARN**: arn:aws:lambda:us-east-1:593793022993:layer:ripgrep-arm64:1
- **内容**: ripgrep バイナリ (ARM64版)
- **パス**: /opt/bin/rg

## AWSリソース一覧

| リソース | ID/ARN | 用途 |
|---------|--------|------|
| EFS | fs-02e918819d61d1e9d | ソースコード格納 |
| Security Group | sg-0459e132b3f78d05f | EFSアクセス用 |
| Access Point | fsap-07e65d9d09af79dce | Lambda用アクセスポイント |
| VPC Endpoint | vpce-08f464895425af84f | S3アクセス (Gateway) |
| Lambda Layer | ripgrep-arm64:1 | ripgrepバイナリ |
| Lambda Layer | aws-sdk-lambda:1 | Lambda SDK v3 |

## Search Lambda API

### list アクション
```json
{
  "action": "list",
  "owner": "Unson-LLC",
  "repo": "salestailor-project",
  "branch": "main",
  "path": "src/",          // optional
  "pattern": "*.ts",       // optional
  "maxFiles": 100          // optional
}
```

### read アクション
```json
{
  "action": "read",
  "owner": "Unson-LLC",
  "repo": "salestailor-project",
  "branch": "main",
  "filePath": "src/index.ts",
  "maxLines": 100,         // optional
  "startLine": 1           // optional
}
```

### search アクション
```json
{
  "action": "search",
  "owner": "Unson-LLC",
  "repo": "salestailor-project",
  "branch": "main",
  "query": "promptBuilder",
  "path": "src/",          // optional
  "filePattern": "*.ts",   // optional
  "maxResults": 20,        // optional
  "caseSensitive": false   // optional
}
```

## コスト構造

| コンポーネント | 月額コスト目安 |
|--------------|---------------|
| EFS (50GB想定) | ~$0.03 |
| S3 VPC Endpoint (Gateway) | 無料 |
| Lambda実行 | 使用量による |
| **合計** | **~$1-5/月** |

※ NAT Gatewayを使用しない設計のため、大幅なコスト削減を実現

## 同期方法

### 手動同期
```bash
aws lambda invoke \
  --function-name mana-efs-sync \
  --cli-binary-format raw-in-base64-out \
  --payload '{"owner":"Unson-LLC","repo":"salestailor-project","branch":"main"}' \
  /tmp/result.json
```

### S3へのアップロード
```bash
aws s3 sync /path/to/repo s3://brainbase-source-593793022993/Unson-LLC/repo-name/main/ \
  --exclude "node_modules/*" \
  --exclude ".git/*" \
  --exclude ".next/*" \
  --exclude "dist/*"
```

## トラブルシューティング

### 検索が遅い場合
1. CloudWatch Logsでmana-searchの実行時間を確認
2. ripgrepのパフォーマンスログを確認

### 同期が失敗する場合
1. mana-efs-syncのメモリ増量を検討
2. S3 VPC Endpointの設定を確認
3. セキュリティグループのインバウンドルールを確認

### ファイルが見つからない場合
1. EFS内のディレクトリ構造を確認
2. 最新の同期が完了しているか確認

## 関連ファイル

- `/Users/ksato/workspace/mana/api/mastra/tools/source-code.ts` - ソースコードツール
- `/Users/ksato/workspace/mana/api/search-lambda/index.mjs` - Search Lambda
- `/Users/ksato/workspace/mana/api/search-lambda/sync.mjs` - Sync Lambda

---
最終更新: 2025-12-09
