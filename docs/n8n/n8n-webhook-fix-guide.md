# n8n Webhook Response 修正ガイド

## 問題
n8nのWebhookレスポンスでテンプレート変数（`{{$json.project.owner}}`など）が評価されずにそのまま返されています。

## 解決方法

### n8nの"Respond to Webhook"ノードの設定

1. **Response Mode**: "When Last Node Finishes"を選択

2. **Response Data Source**: "First Entry JSON"を選択

3. **Response Code**: 200

4. **Response Headers**: 
   - Name: `Content-Type`
   - Value: `application/json`

5. **Response Body**:
   "Set Body"ノードを使用して、以下のような構造でJSONを生成：

```javascript
{
  "status": "success",
  "message": "File processed and committed to GitHub",
  "data": {
    "owner": $json.project.owner,
    "repo": $json.project.repo,
    "filePath": $json.project.path_prefix + $json.file.formattedName,
    "commitMessage": "Add meeting transcript: " + $json.file.name,
    "commitUrl": "https://github.com/" + $json.project.owner + "/" + $json.project.repo + "/blob/" + $json.project.branch + "/" + $json.project.path_prefix + $json.file.formattedName
  }
}
```

### 重要なポイント

1. **式モードを使用**: JSONフィールドで`{{ }}`を使う代わりに、式モード（Expression）を使用してください

2. **文字列連結**: URLなどの文字列を作る場合は、`+`演算子で連結します

3. **変数の参照**: `$json`を使って前のノードのデータを参照します

### テスト方法

1. n8nワークフローをテスト実行
2. "Respond to Webhook"ノードの出力を確認
3. テンプレート変数が実際の値に置き換わっていることを確認

### 期待される出力例

```json
{
  "status": "success",
  "message": "File processed and committed to GitHub",
  "data": {
    "owner": "Unson-LLC",
    "repo": "salestailor",
    "filePath": "meetings/2025-06-09_email-analytics-ui-implementation.md",
    "commitMessage": "Add meeting transcript: test8.txt",
    "commitUrl": "https://github.com/Unson-LLC/salestailor/blob/main/meetings/2025-06-09_email-analytics-ui-implementation.md"
  }
}
```

## Lambda側の対応

Lambda側のコードは、テンプレート変数が返された場合に警告を表示するように更新されています。n8nが正しく設定されれば、GitHubのリンクが表示されるようになります。