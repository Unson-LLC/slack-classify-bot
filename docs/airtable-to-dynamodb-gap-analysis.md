# Airtable → DynamoDB 移行ギャップ分析

生成日: 2025-10-23
目的: Airtable API制限（月間1,000リクエスト超過）への対応

---

## 📊 現状（AS-IS）

### 1. Airtableの使用状況

#### 使用箇所（6ファイル）
- `api/airtable-integration.js` - メイン統合クラス
- `api/processFileUpload.js` - プロジェクトリスト取得
- `api/index.js` - イベントハンドラ（プロジェクト/チャネル選択）

#### 主要メソッド
```javascript
// プロジェクト情報取得
async getProjects()
  → GET /v0/{BASE}/project_id
  → 返り値: Array<{id, name, owner, repo, path_prefix, description, emoji}>

// Slackチャネル情報取得
async getSlackChannelsForProject(projectId)
  → GET /v0/{BASE}/project_id/{projectId}
  → GET /v0/{BASE}/slack_channels/{channelRecordId} (複数)
  → 返り値: Array<channelId>

// UI生成
createProjectSelectionBlocks(projects, fileId, fileData)
createChannelSelectionBlocks(channels, projectId, fileId, fileData)

// ファイル処理
processFileWithProject(action, body, client, logger, fileDataStore)
```

### 2. データ構造

#### プロジェクト情報（Airtableスキーマ）
```javascript
{
  id: "recXXXXXXXXXXXXXX",          // Airtable Record ID
  name: "Project Name",              // プロジェクト名
  owner: "github-org",               // GitHubオーナー
  repo: "repository-name",           // リポジトリ名
  path_prefix: "docs/meetings/",     // 保存先パス
  description: "説明文",             // 説明（オプション）
  emoji: "📁"                        // 絵文字（デフォルト: 📁）
}
```

#### Slackチャネル情報（Airtableスキーマ）
```javascript
// project_id テーブル
{
  slack_channels: ["recCHAN1", "recCHAN2"]  // リンクレコードID配列
}

// slack_channels テーブル
{
  channel_id: "C01234567"           // Slack Channel ID
}
```

### 3. API呼び出しパターン

#### ファイルアップロード時
```
1. getProjects() - 全プロジェクト取得
2. ユーザーがプロジェクト選択
3. getSlackChannelsForProject(projectId) - チャネル取得
   - 1回のプロジェクト情報取得
   - N回のチャネル情報取得（チャネル数分）
4. ユーザーがチャネル選択
5. processFileWithProject() - n8nへ送信
```

**問題点**:
- 1ファイル処理あたり: 2 + N回のAPI呼び出し
- 月間100ファイル、平均3チャネル = 500リクエスト
- キャッシュあり（5分TTL、Lambda instance内のみ）
- **Airtable月間制限: 1,000リクエスト → 超過済み**

### 4. 現在のDynamoDB使用状況

**既存テーブル**: `slack-classify-bot-processed-events`

```javascript
{
  TableName: "slack-classify-bot-processed-events",
  BillingMode: "PAY_PER_REQUEST",     // オンデマンド課金
  KeySchema: [{
    AttributeName: "event_key",
    KeyType: "HASH"                    // パーティションキー
  }],
  使用目的: "Slack イベント重複排除"
}
```

**使用クラス**: `dynamodb-deduplication.js`
- `EventDeduplicationService` - DynamoDB操作
- `HybridDeduplicationService` - メモリフォールバック

---

## 🎯 あるべき姿（TO-BE）

### 1. DynamoDB設計

#### 新規テーブル: `slack-classify-bot-projects`

```javascript
{
  TableName: "slack-classify-bot-projects",
  BillingMode: "PAY_PER_REQUEST",

  KeySchema: [{
    AttributeName: "project_id",
    KeyType: "HASH"                    // パーティションキー
  }],

  AttributeDefinitions: [
    { AttributeName: "project_id", AttributeType: "S" },
    { AttributeName: "updated_at", AttributeType: "N" }
  ],

  GlobalSecondaryIndexes: [{
    IndexName: "updated_at-index",
    KeySchema: [{
      AttributeName: "updated_at",
      KeyType: "HASH"
    }],
    Projection: { ProjectionType: "ALL" }
  }]
}
```

#### データ構造
```javascript
{
  project_id: "proj_unique_id",       // プライマリキー
  name: "Project Name",
  owner: "github-org",
  repo: "repository-name",
  path_prefix: "docs/meetings/",
  description: "説明文",
  emoji: "📁",
  slack_channels: [                   // 非正規化（Airtableのリンク解決済み）
    { channel_id: "C01234567", channel_name: "general" },
    { channel_id: "C89012345", channel_name: "dev-team" }
  ],
  created_at: 1729641600,             // Unix timestamp
  updated_at: 1729641600,             // Unix timestamp
  is_active: true                     // 論理削除フラグ
}
```

### 2. 新規クラス設計

#### `api/project-repository.js`

```javascript
class ProjectRepository {
  constructor() {
    // DynamoDB client初期化
    // キャッシュ管理（Lambda instance内、TTL: 10分）
  }

  // 全プロジェクト取得（キャッシュ優先）
  async getAllProjects()

  // 単一プロジェクト取得
  async getProjectById(projectId)

  // プロジェクト作成・更新
  async saveProject(projectData)

  // プロジェクト削除（論理削除）
  async deleteProject(projectId)

  // チャネル情報取得（プロジェクト内に含む）
  async getChannelsForProject(projectId)
}
```

### 3. API呼び出しパターン（変更後）

```
1. ProjectRepository.getAllProjects()
   - キャッシュヒット: 0 DynamoDB呼び出し
   - キャッシュミス: 1 Scan操作
2. ユーザーがプロジェクト選択
3. ProjectRepository.getChannelsForProject(projectId)
   - キャッシュヒット: 0 DynamoDB呼び出し
   - キャッシュミス: 1 GetItem操作（チャネル情報は既に含まれる）
4. ユーザーがチャネル選択
5. processFileWithProject() - n8nへ送信
```

**改善点**:
- 1ファイル処理あたり: 最大2回のDynamoDB呼び出し（キャッシュミス時）
- キャッシュヒット時: 0回
- **DynamoDB制限: 実質無制限**

---

## 🔄 ギャップ分析

### Gap 1: データソース変更
| 項目 | AS-IS | TO-BE | 変更内容 |
|------|-------|-------|----------|
| データソース | Airtable REST API | DynamoDB | API → SDK変更 |
| 認証 | Bearer Token | IAM Role | 環境変数削減可能 |
| テーブル名 | `project_id`, `slack_channels` | `slack-classify-bot-projects` | 統合 |
| データ取得 | 2段階（プロジェクト→チャネル） | 1段階（非正規化） | N+1問題解消 |

### Gap 2: キャッシュ戦略
| 項目 | AS-IS | TO-BE | 変更内容 |
|------|-------|-------|----------|
| スコープ | Lambda instance内 | Lambda instance内 | 変更なし |
| TTL | 5分 | 10分 | 延長 |
| 実装 | `airtable-integration.js`内 | `ProjectRepository`に集約 | 責任分離 |

### Gap 3: コード変更箇所
| ファイル | 変更タイプ | 変更内容 |
|----------|-----------|----------|
| `airtable-integration.js` | 🔴 大幅変更 | Airtable呼び出しをProjectRepositoryに置き換え |
| `processFileUpload.js` | 🟡 中規模変更 | `airtableIntegration.getProjects()`を`projectRepository.getAllProjects()`に |
| `index.js` | 🟡 中規模変更 | イベントハンドラ内のAirtable呼び出しを置き換え |
| `env.json.template` | 🟢 小変更 | `AIRTABLE_*`環境変数を削除（オプション） |
| 新規: `project-repository.js` | ✨ 新規作成 | DynamoDB操作レイヤー |
| テスト | 🔴 大幅変更 | モック対象をAirtable→DynamoDBに変更 |

### Gap 4: インフラ変更
| 項目 | AS-IS | TO-BE | 作業 |
|------|-------|-------|------|
| DynamoDBテーブル | 1個（dedup用） | 2個（dedup + projects） | テーブル作成 |
| Lambda IAMロール | DynamoDB読み書き（dedup） | DynamoDB読み書き（両テーブル） | ポリシー更新 |
| 環境変数 | `AIRTABLE_*` 3個 | 削除可能 | デプロイ時に削除 |

### Gap 5: データ移行
| タスク | 説明 | 優先度 |
|--------|------|--------|
| 初期データ投入 | Airtableから既存プロジェクトをエクスポート → DynamoDBに投入 | 🔴 必須 |
| Slackチャネル解決 | リンクレコードをchannel_id配列に変換 | 🔴 必須 |
| データ検証 | 移行後のデータ整合性確認 | 🔴 必須 |
| 管理UI | プロジェクト追加・編集方法の確立 | 🟡 推奨 |

### Gap 6: 運用変更
| 項目 | AS-IS | TO-BE | 影響 |
|------|-------|-------|------|
| プロジェクト追加 | Airtable UI | DynamoDB直接 or 管理スクリプト | 運用手順変更 |
| コスト | $0/月（Free枠） | < ¥1/月 | ほぼ影響なし |
| 監視 | なし | CloudWatch Metrics（推奨） | 可視性向上 |

---

## 📋 移行タスクリスト

### フェーズ1: 準備（推定: 30分）
- [ ] DynamoDBテーブル作成
- [ ] Lambda IAMロールにDynamoDB権限追加
- [ ] Airtableデータエクスポート

### フェーズ2: 実装（推定: 2-3時間）
- [ ] `ProjectRepository`クラス実装
- [ ] `airtable-integration.js`をリファクタリング（または新規`project-service.js`作成）
- [ ] `processFileUpload.js`を更新
- [ ] `index.js`イベントハンドラを更新
- [ ] データ移行スクリプト作成・実行

### フェーズ3: テスト（推定: 1-2時間）
- [ ] ユニットテスト修正
- [ ] 統合テスト実行
- [ ] 手動動作確認（Slackでファイルアップロード）

### フェーズ4: デプロイ（推定: 15分）
- [ ] Lambda関数デプロイ
- [ ] 環境変数更新（`AIRTABLE_*`削除）
- [ ] 本番動作確認

### フェーズ5: クリーンアップ（オプション）
- [ ] Airtable依存削除（`airtable` npm package）
- [ ] 古いテストファイル削除
- [ ] ドキュメント更新

**総推定時間**: 4-6時間

---

## 💰 コスト比較

### Airtable（現状）
```
プラン: Free
月間リクエスト: 1,000回
現在の使用量: 1,000回超過 → 使用不可
月額コスト: $0（ただし使用不可）
```

### DynamoDB（移行後）
```
課金モード: PAY_PER_REQUEST
想定データ量: 20プロジェクト × 1KB = 20KB
月間読み取り: 100回（キャッシュミス）
月間書き込み: 5回（プロジェクト更新）

ストレージ: 20KB × $0.25/GB = $0.000005
読み取り: 100 × $0.25/100万 = $0.000025
書き込み: 5 × $1.25/100万 = $0.000006
────────────────────────────────────
月額コスト: < $0.0001 ≈ ¥0.01未満
```

**結論**: コストはほぼゼロで、Airtable制限から解放される。

---

## ⚠️ リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| データ移行ミス | 🔴 高 | 移行前にバックアップ、検証スクリプト実行 |
| Lambda権限不足 | 🟡 中 | デプロイ前にIAMポリシー確認 |
| キャッシュ動作不良 | 🟢 低 | 既存のキャッシュロジックを流用 |
| プロジェクト管理UI不在 | 🟡 中 | 暫定: AWS Console直接編集、将来: 管理画面構築 |

---

## 🎯 推奨アクション

**即座に実施**:
1. DynamoDBテーブル作成
2. データ移行スクリプト実行
3. `ProjectRepository`実装
4. コード修正・テスト
5. デプロイ

**将来的に検討**:
- プロジェクト管理用の簡易Admin UI（Slack Slash Commandなど）
- DynamoDBテーブルのバックアップ設定
- プロジェクト変更履歴の記録

---

## 📌 結論

**移行を強く推奨します**。

理由:
- ✅ 現在Airtableが使用不可（月間制限超過）
- ✅ DynamoDBは既に使用中で追加コストほぼゼロ
- ✅ パフォーマンス向上（N+1問題解消）
- ✅ 実装工数は4-6時間程度
- ✅ インフラ変更は最小限

次のステップ: **フェーズ1から着手**
