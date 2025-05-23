# Airtable RepoMap テーブル設定

## Base ID
`app9oeZUNRWZyaSdb`

## Table名
`RepoMap`

## フィールド構成

| Field Name | Type | Description |
|------------|------|-------------|
| project_id | Single line text | プロジェクト識別子（ファイル名から抽出） |
| owner | Single line text | GitHubオーナー名 |
| repo | Single line text | GitHubリポジトリ名 |
| path_prefix | Single line text | ファイル保存先パス |

## サンプルデータ

### レコード1
- **project_id**: `test-project`
- **owner**: `unson`
- **repo**: `slack-classify-bot`
- **path_prefix**: `docs/`

### レコード2
- **project_id**: `meeting-notes`
- **owner**: `unson`
- **repo**: `slack-classify-bot`
- **path_prefix**: `meetings/`

### レコード3
- **project_id**: `team-standup`
- **owner**: `unson`
- **repo**: `slack-classify-bot`
- **path_prefix**: `standups/`

## 設定方法

1. https://airtable.com/app9oeZUNRWZyaSdb/tblCPixx6xX2HODOl にアクセス
2. 各レコードを上記の値で追加
3. フィールドタイプが正しく設定されていることを確認

## 重要なポイント

- `project_id` はファイル名（.txt を除く）と完全一致する必要があります
- `path_prefix` は末尾に `/` を含めてください
- `owner` と `repo` は実際に存在するGitHubリポジトリである必要があります 