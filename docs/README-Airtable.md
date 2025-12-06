# 🟢 Airtable 連携版 Slack to GitHub n8n ワークフロー

このプロジェクトは、SlackにアップロードされたTXTファイルを自動処理し、Airtableでリポジトリマッピングを行い、GitHubにMarkdownファイルとしてコミットするシステムです。

## 🚀 ワークフロー概要

1. **Slack Webhook** でSlack Boltからのpayloadを受信
2. **TXTファイルをダウンロード** してコンテンツを取得
3. **Airtable RepoMap**から以下の情報を検索・取得:
   - `owner` - GitHubオーナー名
   - `repo` - リポジトリ名  
   - `path_prefix` - ファイル保存パス
4. **Markdownを生成**してGitHubへコミット
5. **同スレッドに✅を返信**して処理完了を通知

## 📊 Airtable Base/Table 構成

### RepoMapテーブル

| project_id | owner | repo | path_prefix |
|------------|-------|------|-------------|
| `AITLE / your-org / aitile-docs / docs/meetings` | your-org | aitile-docs | docs/meetings/ |
| `PROJECT-A / company / project-a / notes` | company | project-a | notes/ |
| `TEAM-B / myorg / team-b-repo / documentation` | myorg | team-b-repo | documentation/ |

### フィールド説明

- **project_id**: プロジェクト識別子（ファイル名から抽出）
- **owner**: GitHubオーナー名（ユーザー名または組織名）
- **repo**: GitHubリポジトリ名
- **path_prefix**: ファイル保存先のパス（末尾に`/`を含む）

## 🛠️ セットアップ手順

### 1. n8n クレデンシャル設定

#### Airtable Credentials
- **Name**: `__AIRTABLE_CRED__`
- **Type**: Airtable Token API
- **API Token**: AirtableのPersonal Access Token

#### Slack Header Auth
- **Name**: `__SLACK_HEADER_AUTH__`
- **Type**: Header Auth
- **Name**: `Authorization`
- **Value**: `Bearer xoxb-your-slack-bot-token`

#### GitHub PAT
- **Name**: `__GITHUB_CRED__`
- **Type**: GitHub
- **Access Token**: GitHubのPersonal Access Token

#### Slack API
- **Name**: `__SLACK_API_CRED__`
- **Type**: Slack OAuth2 API
- **OAuth Grant Type**: Authorization Code
- **Bot User OAuth Token**: `xoxb-your-slack-bot-token`

### 2. 環境変数設定

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
N8N_ENDPOINT=https://your-n8n-instance.com
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_API_KEY=pat...
AIRTABLE_TABLE_NAME=Projects
```

### 3. Slackアプリ設定

#### 必要な権限（OAuth & Permissions）
```
channels:history
chat:write
commands
files:read
groups:history
im:history
mpim:history
```

#### Event Subscriptions
- **Request URL**: `https://your-vercel-app.vercel.app/slack/events`
- **Subscribe to Bot Events**:
  - `file_shared`
  - `message.channels`
  - `message.groups`
  - `message.im`
  - `message.mpim`

#### Slash Commands
- `/process-file` - 手動ファイル処理
- `/classify` - メッセージ分類

### 4. n8nワークフローのインポート

1. n8nで新しいワークフローを作成
2. `n8n-workflow-airtable-github.json`をインポート
3. 上記のクレデンシャルを設定
4. 環境変数`AIRTABLE_BASE_ID`を設定
5. ワークフローをアクティブ化

## 📁 プロジェクト構造

```
mana/
├── api/
│   ├── app.js                          # メインアプリケーション
│   ├── n8n-integration.js              # n8n統合（分類用）
│   └── airtable-integration.js         # Airtable統合（ファイル処理用）
├── .github/
│   └── workflows/
│       └── deploy.yml                  # CI/CDパイプライン
├── n8n-workflow-airtable-github.json   # Airtable連携ワークフロー
├── n8n-workflow-slack-to-github.json   # 分類用ワークフロー
├── package.json
├── vercel.json
├── README.md                           # 基本README
└── README-Airtable.md                  # このファイル
```

## 📄 生成されるMarkdownファイル例

```markdown
# meeting-notes-2024-01-15.txt

**Date:** 2024-01-15  
**Time:** 14:30:00  
**Channel:** C1234567890  
**User:** U1234567890  
**Project ID:** AITLE / your-org / aitile-docs / docs/meetings

---

# Meeting Notes - Weekly Standup

## Attendees
- Alice
- Bob
- Charlie

## Discussion Points
1. Progress update on feature X
2. Bug fixes for release 1.2.3
3. Planning for next sprint

## Action Items
- [ ] Alice: Fix login bug by Friday
- [ ] Bob: Review PR #123
- [ ] Charlie: Update documentation

---

*Generated automatically from Slack via n8n*
```

## 🔧 ワークフロー詳細

### ノード構成

1. **Slack Webhook** (`/webhook/slack-airtable`)
   - Slack Boltからのファイルアップロードイベントを受信

2. **Filter TXT Files**
   - TXTファイルのみを処理対象として抽出

3. **Download TXT File**
   - Slack APIを使用してファイルコンテンツをダウンロード

4. **Extract Project Info**
   - ファイル名からproject_idを抽出
   - その他のメタデータを整理

5. **Search Airtable RepoMap**
   - project_idを使用してAirtableから設定を検索

6. **Generate Markdown**
   - ダウンロードしたコンテンツをMarkdown形式に変換
   - メタデータを含むヘッダーを追加

7. **Commit to GitHub**
   - 生成されたMarkdownをGitHubリポジトリにコミット

8. **Reply to Slack Thread**
   - 処理完了をSlackスレッドで通知

## 🧪 使用方法

### 自動処理
1. SlackチャンネルにTXTファイルをアップロード
2. ファイル名がproject_idとして使用される
3. 自動的にワークフローが実行される
4. GitHubにMarkdownファイルが作成される
5. Slackスレッドに完了通知が投稿される

### 手動処理
```bash
/process-file F1234567890
```

### ファイル命名規則
```
AITLE-your-org-aitile-docs-docs-meetings.txt
→ project_id: "AITLE-your-org-aitile-docs-docs-meetings"
→ Airtableで検索: "AITLE / your-org / aitile-docs / docs/meetings"
```

## 🔍 トラブルシューティング

### よくある問題

1. **ファイルが処理されない**
   - TXTファイル以外は処理されません
   - project_idがAirtableに登録されているか確認

2. **GitHubコミットエラー**
   - GitHub PAT権限を確認
   - リポジトリ名とオーナー名が正しいか確認

3. **Airtable検索エラー**
   - Base IDが正しく設定されているか確認
   - project_idの形式が一致しているか確認

### ログ確認
```bash
# Vercelログ確認
vercel logs

# n8nワークフロー実行履歴確認
# n8n UI > Executions タブ
```

## 📈 分析とモニタリング

### 処理統計
- ファイル処理回数
- エラー発生率
- 処理時間統計
- プロジェクト別使用状況

### Airtableでの管理
- 新しいプロジェクト設定の追加
- 既存設定の修正
- アクセス権限の管理

## 🔐 セキュリティ考慮事項

- SlackファイルのプライベートURL使用
- GitHub PAT権限の最小化
- Airtable Base アクセス制限
- n8nワークフローの実行権限管理

## 🤝 貢献方法

1. 新しいファイル形式のサポート追加
2. Markdownテンプレートの改善
3. エラーハンドリングの強化
4. 分析機能の追加

## 📄 ライセンス

ISC License

---

**💡 ヒント**: project_idの命名規則を統一することで、Airtableでの管理が簡単になります。 