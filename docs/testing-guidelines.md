# テストガイドライン

## Test-Driven Development (TDD) - t_wada方式

このプロジェクトでは、t_wada方式のTDDを採用しています。

### TDDサイクル

1. **最初にテストを書く（Red）**
   - 実装前に失敗するテストを書く
   - テストは具体的で、1つの振る舞いだけをテストする
   - テストの意図が明確になるような名前をつける

2. **最小限の実装（Green）**
   - テストを通すために必要最小限のコードを書く
   - この時点では汚いコードでも構わない
   - とにかくテストを通すことを優先する

3. **リファクタリング（Refactor）**
   - テストが通った状態を保ちながらコードを改善する
   - 重複を取り除き、設計を改善する
   - テストも必要に応じてリファクタリングする

### テストの実行

```bash
# ファイル変更を監視しながらテストを実行
cd api && npm run test:watch

# 特定のテストファイルのみ実行
npm test -- path/to/test.js

# カバレッジレポート付きで実行
npm run test:coverage
```

### テストの書き方の原則

- **Arrange-Act-Assert (AAA) パターンを使用**
  ```javascript
  test('should process file upload correctly', async () => {
    // Arrange - テストデータとモックの準備
    const mockFile = { content: 'test content' };
    const mockProject = { id: 'project-1' };
    
    // Act - テスト対象の実行
    const result = await processFileUpload(mockFile, mockProject);
    
    // Assert - 結果の検証
    expect(result.success).toBe(true);
    expect(result.project).toEqual(mockProject);
  });
  ```

- **各テストは独立して実行可能**
  - beforeEach/afterEachを活用してクリーンな状態を保つ
  - グローバル状態に依存しない

- **モックは最小限に留める**
  - 外部依存（API、データベース）のみモック化
  - ビジネスロジックはモックしない

- **テストデータは意味のある値を使用**
  - "test", "foo", "bar"ではなく実際のユースケースに近い値を使う

### Unit Tests

- テストファイルは`api/__tests__/`に配置
- ファイル名は`*.test.js`形式
- Slack clientとAWSサービスはモック化
- `npm test`で実行（apiディレクトリ内）

### Integration Testing

1. **CloudWatchログの確認**
   ```bash
   aws logs tail /aws/lambda/slack-classify-bot --follow --profile k.sato --region us-east-1
   ```

2. **テストペイロードの使用**
   - `api/test-*.json`ファイルを使用
   - 実際のSlackイベントに近い形式

3. **Slack署名の検証**
   - テスト環境でも本番と同じ検証ロジックを使用

4. **実際のファイルアップロードテスト**
   - Slackワークスペースでの実機テスト
   - 各種ファイル形式での動作確認

5. **n8n実行履歴の監視**
   - ワークフローが正しくトリガーされているか確認

### Common Test Scenarios

- **ファイルアップロード**
  - 様々なコンテンツタイプのファイル
  - 大きなファイルサイズ
  - 特殊文字を含むファイル名

- **プロジェクト選択と処理**
  - 存在するプロジェクトの選択
  - 存在しないプロジェクトのエラーハンドリング
  - 複数プロジェクトの表示

- **エラーハンドリング**
  - ネットワークエラー
  - タイムアウト
  - 認証エラー

- **AI要約のエッジケース**
  - 空のコンテンツ
  - 非常に長いコンテンツ
  - 複数言語のコンテンツ

- **重複イベントハンドリング**
  - 同じイベントIDの重複処理防止
  - キャッシュTTLの動作確認