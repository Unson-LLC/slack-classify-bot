# アーキテクチャ詳細

## システム構成図

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Slack     │────▶│  AWS Lambda │────▶│   Airtable  │
│ Workspace   │     │   Function  │     │  Database   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐     ┌─────────────┐
                    │ AWS Bedrock │     │     n8n     │
                    │  (Claude)   │     │  Workflows  │
                    └─────────────┘     └─────────────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   GitHub    │
                                        │ Repository  │
                                        └─────────────┘
```

## 主要コンポーネント

### 1. Slackイベント処理（api/index.js）

**責務**:
- Slackイベントの受信と検証
- イベントの重複排除
- 適切なハンドラーへのルーティング

**主要機能**:
- `file_share`イベントの処理
- インタラクティブボタンの処理
- スレッドへの返信

**イベント重複排除**:
```javascript
// 5分間のTTLを持つメモリ内キャッシュ
const processedEvents = new Map();
const EVENT_TTL = 5 * 60 * 1000; // 5分

function isDuplicateEvent(eventId) {
  if (processedEvents.has(eventId)) {
    return true;
  }
  processedEvents.set(eventId, Date.now());
  return false;
}
```

### 2. AI統合（api/llm-integration.js）

**責務**:
- AWS Bedrockとの通信
- 会議要約の生成
- アクションアイテムの抽出
- ファイル名の生成

**使用モデル**:
- Claude Sonnet 4 (`us.anthropic.claude-sonnet-4-20250514-v1:0`)
- リージョン: us-east-1（固定）

**プロンプト構成**:
```javascript
const systemPrompt = `あなたは会議の議事録を分析し、要約とアクションアイテムを抽出する専門家です。`;

const userPrompt = `
以下の会議の内容から：
1. 簡潔な要約（2-3文）
2. アクションアイテムのリスト
3. 適切なファイル名（日本語可）
を生成してください。

会議内容：
${content}
`;
```

### 3. ファイル処理（api/processFileUpload.js）

**責務**:
- Slackからのファイルダウンロード
- テキストコンテンツの抽出
- プロジェクト選択UIの表示
- 処理結果のn8nへの送信

**処理フロー**:
1. ファイルメタデータの取得
2. ファイルコンテンツのダウンロード
3. AI要約の生成
4. Airtableからプロジェクトリスト取得
5. ユーザーへのプロジェクト選択UI表示
6. 選択後のn8nワークフロー実行

### 4. データストレージ（api/airtable-integration.js）

**責務**:
- Airtable APIとの通信
- プロジェクトデータの取得
- エラーハンドリングとリトライ

**スキーマ**:
```javascript
// Projectsテーブル
{
  ID: "project-unique-id",
  name: "プロジェクト名",
  owner: "github-org",
  repo: "repository-name",
  type: "meeting-notes",
  description: "プロジェクトの説明",
  path_prefix: "meetings/2024"
}
```

### 5. 自動化（api/n8n-integration.js）

**責務**:
- n8n webhookへのデータ送信
- ペイロードの構築
- エラーハンドリング

**ペイロード構造**:
```javascript
{
  projectId: "selected-project-id",
  projectName: "プロジェクト名",
  content: "ファイルコンテンツ",
  summary: "AI生成の要約",
  actionItems: ["アクション1", "アクション2"],
  suggestedFilename: "AI提案のファイル名",
  originalFilename: "元のファイル名.txt",
  uploadedBy: "@username",
  uploadDate: "2024-01-28T10:00:00Z",
  owner: "github-org",
  repo: "repository-name",
  pathPrefix: "meetings/2024"
}
```

## データフロー詳細

### 1. ファイルアップロードフロー

```
1. ユーザーがSlackチャンネルに.txtファイルをアップロード
   ↓
2. Slack APIがfile_shareイベントを送信
   ↓
3. Lambda関数がイベントを受信・検証
   ↓
4. イベント重複チェック（5分TTLキャッシュ）
   ↓
5. ファイルダウンロード（Slack private URL使用）
   ↓
6. AWS Bedrockで要約生成
   ↓
7. Airtableからプロジェクトリスト取得
   ↓
8. Slackにプロジェクト選択ボタン表示
   ↓
9. ユーザーがプロジェクトを選択
   ↓
10. n8nワークフローにデータ送信
   ↓
11. n8nがGitHubにMarkdownファイルをコミット
   ↓
12. Slackスレッドに完了通知（✅）
```

### 2. エラーハンドリングフロー

各ステップでのエラーは適切にキャッチされ、ユーザーに通知されます：

- **ファイルダウンロード失敗**: "ファイルのダウンロードに失敗しました"
- **AI要約生成失敗**: "要約の生成に失敗しました"
- **Airtable接続失敗**: "プロジェクトリストの取得に失敗しました"
- **n8n送信失敗**: "ワークフローの実行に失敗しました"

## セキュリティ考慮事項

### 1. 認証と認可

- **Slack署名検証**: すべてのリクエストでHMAC署名を検証
- **タイムスタンプ検証**: 5分以内のリクエストのみ受付
- **Bot ID検証**: 自己応答ループの防止

### 2. データ保護

- **一時的なファイルURL**: Slackのプライベートファイルリンクは短期間のみ有効
- **環境変数管理**: すべての機密情報は環境変数で管理
- **最小権限の原則**: Lambda実行ロールは必要最小限の権限のみ

### 3. 通信セキュリティ

- **HTTPS通信**: すべての外部通信はHTTPS
- **APIキーローテーション**: 定期的なキーの更新を推奨

## 拡張性とメンテナンス

### モジュール設計

各機能は独立したモジュールとして設計：
- 疎結合な設計により、個別の更新が容易
- 明確なインターフェースによる保守性の向上
- テスタビリティの確保

### 設計ドキュメント参照

詳細な設計については以下を参照：
- `SECURITY-ARCHITECTURE.md`: セキュリティ設計
- `README-Airtable.md`: Airtableスキーマ設計
- `docs/design/`: その他の設計ドキュメント