# データディレクトリ

このディレクトリには、Slackボットが分類したメッセージのデータが保存されます。

## 📁 ディレクトリ構造

```
data/
├── classifications.json          # 全ての分類データ
├── daily-summary/               # 日次サマリー
│   ├── 2024-01-01.json
│   ├── 2024-01-02.json
│   └── ...
└── README.md                   # このファイル
```

## 📄 ファイル形式

### classifications.json

全ての分類されたメッセージを含むメインファイルです。最新の1000件のみが保持されます。

```json
[
  {
    "id": "slack-1704067200-U123456789",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "user": "U123456789",
    "channel": "C123456789",
    "text": "There's a bug in the login system that prevents users from signing in",
    "category": "bug",
    "source": "slack",
    "metadata": {
      "original_event": {
        "type": "message",
        "user": "U123456789",
        "text": "There's a bug in the login system that prevents users from signing in",
        "ts": "1704067200.123456",
        "channel": "C123456789"
      },
      "classification_timestamp": "2024-01-01T12:00:01.456Z"
    }
  }
]
```

### daily-summary/{date}.json

各日の分類活動のサマリーです。

```json
{
  "date": "2024-01-01",
  "totalClassifications": 45,
  "newClassification": {
    "id": "slack-1704067200-U123456789",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "user": "U123456789",
    "channel": "C123456789",
    "text": "This feature would be really helpful",
    "category": "feature-request",
    "source": "slack"
  },
  "summary": {
    "user": "U123456789",
    "category": "feature-request",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

## 📊 分類カテゴリ

- **bug**: バグ報告、エラー、問題
- **feature-request**: 新機能要望、改善提案
- **question**: 質問、ヘルプ依頼
- **feedback**: フィードバック、提案
- **urgent**: 緊急事項、重要な問題
- **performance**: パフォーマンス関連
- **security**: セキュリティ関連の議論
- **documentation**: ドキュメント関連
- **general**: その他、一般的な内容

## 🔄 データの更新

データは以下の方法で更新されます：

1. **リアルタイム**: Slackメッセージが投稿されるたびに自動更新
2. **手動**: `/classify`スラッシュコマンドで手動分類
3. **バッチ**: n8nワークフローによる定期処理

## 📈 データ分析

このデータを使用して以下の分析が可能です：

- カテゴリ別のメッセージ頻度
- ユーザー別の投稿パターン
- 時系列での傾向分析
- チャンネル別の分類分布

## 🔐 プライバシー

- ユーザーIDは匿名化されています
- センシティブな情報は自動的に除外されます
- データの保持期間は最大1000件のメッセージです 