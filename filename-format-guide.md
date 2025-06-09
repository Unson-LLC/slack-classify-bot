# GitHub ファイル名フォーマットガイド

## 概要
Slackにアップロードされたファイルは、GitHubに保存する際にAIが内容を分析して意味のあるファイル名を生成します。

## ファイル名フォーマット
```
YYYY-MM-DD_ai-generated-name.md
```

### 例
- トランスクリプト内容: 週次チームミーティングの議事録
- 生成されるファイル名: `2025-06-09_weekly-team-standup.md`

- トランスクリプト内容: 製品ロードマップのレビュー会議
- 生成されるファイル名: `2025-06-10_product-roadmap-review.md`

- トランスクリプト内容: ABC社とのクライアントミーティング
- 生成されるファイル名: `2025-06-11_client-meeting-abc-corp.md`

### フォーマットの詳細
- `YYYY-MM-DD`: アップロード日付（例: 2025-06-09）
- `ai-generated-name`: AIがトランスクリプト内容から生成した意味のある名前
  - 3-5単語程度の簡潔な英語
  - 全て小文字、単語間はハイフン（-）で接続
  - 内容を表す分かりやすい名前
- `.md`: 拡張子は`.md`（Markdown）に統一

### AI生成の仕組み
1. トランスクリプトの最初の2000文字を分析
2. Claude Sonnet 4モデルが内容を理解して適切な名前を生成
3. 生成できない場合は元のファイル名をフォールバックとして使用

## 実装詳細

### コード実装
```javascript
// Generate a formatted filename for GitHub
const now = new Date();
const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS

// Remove file extension and clean up the original filename
const baseFileName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');

// Create formatted filename: YYYY-MM-DD_HH-MM-SS_originalname.md
const formattedFileName = `${dateStr}_${timeStr}_${baseFileName}.md`;
```

### n8nワークフローでの使用
n8nワークフローでは、`file.formattedName`プロパティを使用してフォーマット済みのファイル名を取得できます：

```javascript
// n8n Expression
{{ $json.file.formattedName }}
```

## メリット
1. **時系列での整理**: ファイルが日付順に自動的に並ぶ
2. **重複回避**: タイムスタンプにより同名ファイルの重複を防ぐ
3. **検索性向上**: 一貫した命名規則により検索が容易
4. **Markdown形式**: GitHubでのプレビューが可能

## GitHubでの保存パス例
```
/meetings/2025-06-09_15-30-45_meeting-notes.md
/docs/2025-06-10_09-15-22_project-update.md
/transcripts/2025-06-11_14-00-00_weekly-standup.md
```