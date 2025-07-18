# MCP (Model Context Protocol) 設定ガイド

このプロジェクトでMCPサーバーを設定する方法について説明します。

## 概要

MCPを使用することで、Claude Desktopから外部サービス（Airtable、Perplexityなど）に直接アクセスできるようになります。

## 設定済みMCPサーバー

### 1. Airtable MCP Server

プロジェクトルートの `.mcp.json` で設定済み：

```json
{
  "mcpServers": {
    "airtable": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@felores/airtable-mcp-server"
      ],
      "env": {
        "AIRTABLE_API_KEY": "patthBdWKAvrmPFnC.0e10dbe9aa3630661826bdcc0d6a3cf97c941b833fd0406f7bd2ec3f34e1f772",
        "AIRTABLE_BASE": "app9oeZUNRWZyaSdb"
      }
    }
  }
}
```

### 2. Perplexity MCP Server

Claude Desktop用の設定：

#### インストール手順

1. **リポジトリのクローン**
```bash
mkdir -p ~/tools/mcp-servers
cd ~/tools/mcp-servers
git clone https://github.com/ppl-ai/modelcontextprotocol.git
```

2. **依存関係のインストール**
```bash
cd modelcontextprotocol/perplexity-ask
npm install
```

3. **Claude Desktop設定**

`/Users/unson/Library/Application Support/Claude/claude_desktop_config.json` を作成：

```json
{
  "mcpServers": {
    "perplexity-ask": {
      "command": "node",
      "args": ["/Users/unson/tools/mcp-servers/modelcontextprotocol/perplexity-ask/dist/index.js"],
      "env": {
        "PERPLEXITY_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

4. **Claude Code設定**

プロジェクトルートの `.mcp.json` に追加：

```json
{
  "mcpServers": {
    "airtable": {
      // 既存のairtable設定...
    },
    "perplexity-ask": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/Users/unson/tools/mcp-servers/modelcontextprotocol/perplexity-ask/dist/index.js"
      ],
      "env": {
        "PERPLEXITY_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

#### 利用可能な機能

- **Ask**: 質問に対してリアルタイムWeb検索で回答
- **Research**: 詳細な調査レポートを生成  
- **Reason**: 複雑な推論タスクを実行

## 使用方法

### Claude Desktop
1. Claude Desktopアプリを再起動
2. MCPサーバーが自動的に接続される
3. 各サービスの機能が利用可能になる

### Claude Code
1. Claude Codeセッションを再起動（または新しいセッションを開始）
2. `/mcp` コマンドでMCPサーバーの状態を確認
3. 各サービスの機能が利用可能になる

## トラブルシューティング

### Perplexity MCP Server

- **API Key エラー**: `PERPLEXITY_API_KEY` 環境変数が正しく設定されているか確認
- **接続エラー**: Claude Desktopの再起動を試す
- **パスエラー**: `dist/index.js` ファイルが存在するか確認

### Airtable MCP Server

- **認証エラー**: `.mcp.json` のAPI KeyとBase IDを確認
- **インストールエラー**: `npx @felores/airtable-mcp-server` が実行可能か確認

## セキュリティ注意事項

- API Keyは機密情報として取り扱う
- 設定ファイルをGitリポジトリにコミットする際は、API Keyを環境変数化する
- 定期的にAPI Keyをローテーションする