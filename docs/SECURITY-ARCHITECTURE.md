# 議事録管理システム - セキュリティアーキテクチャ設計

## 概要
業務委託メンバー10名を含む組織での議事録自動管理システムにおける権限設定とアクセス制御の設計書

## 推奨アーキテクチャ: AI-First + 段階的アクセス制御

### システム構成図
```
Slack議事録アップロード
        ↓
    Lambda関数 (分類・処理)
        ↓
┌─────────────────────────────┐
│     コンテンツ分類エンジン      │
│  - 機密度レベル判定           │
│  - プロジェクト分類           │
│  - アクセス権限マッピング      │
└─────────────────────────────┘
        ↓
┌─────────────────┬─────────────────┐
│   パブリック層    │   プライベート層   │
│  GitHub Public   │  GitHub Private  │
│  (業務委託OK)    │   (社員のみ)     │
└─────────────────┴─────────────────┘
        ↓
┌─────────────────────────────┐
│      AI分析・要約エンジン      │
│  - 権限ベース情報フィルタリング │
│  - コンテキスト保持           │
│  - 自然言語での回答生成       │
└─────────────────────────────┘
        ↓
    Slack Bot応答
   (権限に応じた情報のみ)
```

## 権限レベル定義

### Level 1: 業務委託メンバー
- **アクセス可能情報:**
  - 一般的なプロジェクト進捗
  - 公開可能な技術情報
  - 自分が参加した会議の議事録
- **制限事項:**
  - 予算・人事情報へのアクセス不可
  - 他プロジェクトの詳細情報不可
  - 戦略的意思決定情報不可

### Level 2: 正社員
- **アクセス可能情報:**
  - Level 1の全情報
  - 担当プロジェクトの詳細情報
  - 社内技術情報
  - 部門間連携情報
- **制限事項:**
  - 他部門の機密情報不可
  - 経営戦略情報不可

### Level 3: 管理職
- **アクセス可能情報:**
  - Level 2の全情報
  - 部門横断プロジェクト情報
  - 予算・リソース情報
  - 人事関連情報（担当範囲内）

### Level 4: 役員
- **アクセス可能情報:**
  - 全ての情報にアクセス可能

## 技術実装詳細

### 1. コンテンツ分類システム

```javascript
// 機密度判定ロジック
const classifySecurityLevel = (content, metadata) => {
  const confidentialKeywords = [
    '予算', '売上', '利益', '人事評価', '給与', 
    '戦略', '買収', '機密', '競合分析'
  ];
  
  const internalKeywords = [
    '社内システム', '内部プロセス', '組織変更',
    'リソース配分', '技術仕様'
  ];
  
  const projectSensitiveKeywords = [
    'クライアント名', '契約条件', '価格情報',
    '納期調整', 'トラブル対応'
  ];
  
  // 機密度スコア計算
  let confidentialScore = 0;
  let internalScore = 0;
  let projectScore = 0;
  
  confidentialKeywords.forEach(keyword => {
    if (content.includes(keyword)) confidentialScore++;
  });
  
  internalKeywords.forEach(keyword => {
    if (content.includes(keyword)) internalScore++;
  });
  
  projectSensitiveKeywords.forEach(keyword => {
    if (content.includes(keyword)) projectScore++;
  });
  
  // 分類決定
  if (confidentialScore > 0) return 'CONFIDENTIAL';
  if (internalScore > 1) return 'INTERNAL';
  if (projectScore > 0) return 'PROJECT_SENSITIVE';
  return 'PUBLIC';
};
```

### 2. 権限ベースアクセス制御

```javascript
// ユーザー権限管理
const getUserPermissions = async (userId) => {
  // Airtableまたは社内システムから権限情報を取得
  const userInfo = await airtableIntegration.getUserInfo(userId);
  
  return {
    level: userInfo.accessLevel, // 1-4
    projects: userInfo.accessibleProjects,
    departments: userInfo.departments,
    isContractor: userInfo.employmentType === 'contractor'
  };
};

// 情報フィルタリング
const filterContentByPermission = (content, userPermissions) => {
  const filteredContent = content.filter(item => {
    // 機密度チェック
    if (item.securityLevel === 'CONFIDENTIAL' && userPermissions.level < 4) {
      return false;
    }
    
    if (item.securityLevel === 'INTERNAL' && userPermissions.level < 2) {
      return false;
    }
    
    // プロジェクトアクセス権チェック
    if (item.projectId && !userPermissions.projects.includes(item.projectId)) {
      return false;
    }
    
    // 業務委託メンバーの追加制限
    if (userPermissions.isContractor && item.internalOnly) {
      return false;
    }
    
    return true;
  });
  
  return filteredContent;
};
```

### 3. AI応答システム

```javascript
// 権限に応じたAI応答生成
app.message(/議事録|進捗|状況/, async ({ message, client }) => {
  try {
    const userPermissions = await getUserPermissions(message.user);
    const query = message.text;
    
    // 関連する議事録を検索
    const relevantMinutes = await searchMinutes(query);
    
    // 権限に応じてフィルタリング
    const accessibleMinutes = filterContentByPermission(relevantMinutes, userPermissions);
    
    // AI分析・要約
    const summary = await generateAISummary(accessibleMinutes, query, userPermissions);
    
    // 権限レベルに応じた注意書きを追加
    let disclaimer = '';
    if (userPermissions.isContractor) {
      disclaimer = '\n\n*注: 業務委託メンバー向けの情報のみ表示しています';
    } else if (userPermissions.level < 3) {
      disclaimer = '\n\n*注: アクセス権限に応じた情報のみ表示しています';
    }
    
    await client.chat.postMessage({
      channel: message.channel,
      text: summary + disclaimer,
      thread_ts: message.ts
    });
    
  } catch (error) {
    console.error('Error in AI response:', error);
    await client.chat.postMessage({
      channel: message.channel,
      text: '申し訳ございません。情報の取得中にエラーが発生しました。',
      thread_ts: message.ts
    });
  }
});
```

## リポジトリ構成

### パブリックリポジトリ (contractor-accessible)
```
company-public-minutes/
├── general/
│   ├── weekly-standup/
│   ├── tech-sharing/
│   └── project-updates/
├── project-a/
│   ├── public-progress/
│   └── technical-docs/
└── announcements/
    ├── company-news/
    └── policy-updates/
```

### プライベートリポジトリ (employees-only)
```
company-internal-minutes/
├── strategic/
│   ├── quarterly-planning/
│   ├── budget-review/
│   └── competitive-analysis/
├── hr/
│   ├── performance-review/
│   ├── compensation/
│   └── organizational-changes/
├── projects/
│   ├── project-a-internal/
│   ├── project-b-confidential/
│   └── cross-project-coordination/
└── executive/
    ├── board-meetings/
    ├── strategic-decisions/
    └── confidential-discussions/
```

## セキュリティ対策

### 1. データ暗号化
- GitHub上のデータは暗号化して保存
- 機密情報は追加の暗号化レイヤーを適用

### 2. アクセスログ
- 全てのアクセスをログ記録
- 異常なアクセスパターンの検知

### 3. 定期的な権限見直し
- 月次での権限レビュー
- プロジェクト終了時の自動権限削除

### 4. データ保持ポリシー
- 機密情報の自動削除（保持期間経過後）
- アーカイブ機能による長期保存

## 実装フェーズ

### Phase 1: 基本分類システム
1. コンテンツ分類エンジンの実装
2. 基本的な権限管理システム
3. パブリック/プライベートリポジトリの分離

### Phase 2: AI統合
1. AI分析エンジンの統合
2. 権限ベースフィルタリング
3. 自然言語での質問応答機能

### Phase 3: 高度なセキュリティ機能
1. 暗号化システムの実装
2. 詳細なアクセス制御
3. 監査ログシステム

### Phase 4: 運用最適化
1. 自動権限管理
2. パフォーマンス最適化
3. ユーザビリティ向上

## 運用ガイドライン

### 管理者向け
- 新規メンバーの権限設定手順
- 権限変更時の対応フロー
- セキュリティインシデント対応

### ユーザー向け
- 情報アクセスのガイドライン
- AI質問の効果的な方法
- セキュリティ意識の向上

## コスト見積もり

### 初期開発費用
- システム開発: 200-300万円
- セキュリティ監査: 50-100万円

### 運用費用（月額）
- AWS Lambda/API Gateway: 1-3万円
- GitHub Enterprise: 5-10万円
- AI API利用料: 3-5万円
- 運用保守: 10-20万円

## まとめ

このアーキテクチャにより、以下を実現できます：

1. **セキュリティの確保**: 業務委託メンバーと正社員の適切な情報分離
2. **利便性の維持**: AIを通じた自然な情報アクセス
3. **運用効率**: 自動化による管理負荷の軽減
4. **拡張性**: 組織成長に応じたスケーラビリティ

最も重要なのは、技術的な制御だけでなく、組織全体でのセキュリティ意識の向上と、明確なガイドラインの策定です。 