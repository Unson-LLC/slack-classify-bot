# Airtable RepoMap テーブル設定

## Base ID
`app9oeZUNRWZyaSdb`

## Table名
`project_id` (実際のテーブル名)

## フィールド構成

| Field Name | Type | Description |
|------------|------|-------------|
| Name | Single line text | プロジェクト識別子（primary field、ファイル名から抽出される project_id） |
| owner | Single line text | GitHubオーナー名 |
| repo | Single line text | GitHubリポジトリ名 |
| path_prefix | Single line text | ファイル保存先パス |
| branch | Single line text | GitHubブランチ名（オプション、デフォルト: main） |

## サンプルデータ

### レコード1: aitle
- **Name**: `aitle`
- **owner**: `Tech-Knight-inc`
- **repo**: `aitle`
- **path_prefix**: `meetings/`
- **branch**: `main` (デフォルト)

### レコード2: senrigan
- **Name**: `senrigan`
- **owner**: `Unson-LLC`
- **repo**: `senrigan`
- **path_prefix**: `meetings/`
- **branch**: `main` (デフォルト)

### レコード3: zeims
- **Name**: `zeims`
- **owner**: `Unson-LLC`
- **repo**: `zeims`
- **path_prefix**: `meetings/`
- **branch**: `main` (デフォルト)

### レコード4: postio
- **Name**: `postio`
- **owner**: `Unson-LLC`
- **repo**: `Postio`
- **path_prefix**: `meetings/`
- **branch**: `main` (デフォルト)

## 設定方法

1. https://airtable.com/app9oeZUNRWZyaSdb/tblCPixx6xX2HODOl にアクセス
2. 必要に応じて `branch` フィールドを手動で追加
3. 各レコードを上記の値で設定
4. フィールドタイプが正しく設定されていることを確認

## 重要なポイント

- **Name** フィールドはプライマリフィールドで、ファイル名（.txt を除く）と完全一致する必要があります
- `path_prefix` は末尾に `/` を含めてください
- `owner` と `repo` は実際に存在するGitHubリポジトリである必要があります
- `branch` フィールドが設定されていない場合、デフォルトで `main` ブランチが使用されます
- 異なるブランチを使用したい場合は、Airtableで `branch` フィールドを追加し、値を設定してください

## ブランチ機能

- **デフォルト動作**: `branch` フィールドがない場合は `main` ブランチに自動コミット
- **カスタムブランチ**: `branch` フィールドで任意のブランチを指定可能
- **プロジェクト別設定**: プロジェクトごとに異なるブランチを設定可能 