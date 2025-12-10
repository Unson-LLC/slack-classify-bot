# mana Memory Architecture Design

## 概要

本ドキュメントは、mana（AI PM）のメモリーアーキテクチャ設計を定義する。
認知科学とLLMメモリー研究に基づき、3種類のメモリーシステムを統合した設計を採用する。

## brainbaseアーキテクチャとの関係

### 情報の役割分担

```
┌─────────────────────────────────────────────────────────────────────┐
│                    brainbase 情報アーキテクチャ                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │   _codex/       │  │   sources/      │  │   mana Memory   │    │
│  │   (正本)        │  │   (情報源)       │  │   (学習記憶)     │    │
│  │                 │  │                 │  │                 │    │
│  │ • 判断基準      │  │ • Slack履歴     │  │ • 対話パターン   │    │
│  │ • ルール        │  │ • メール        │  │ • 嗜好学習      │    │
│  │ • RACI         │  │ • 外部情報      │  │ • エピソード    │    │
│  │ • 人物定義      │  │                 │  │                 │    │
│  │                 │  │ [参照専用]      │  │ [自動蓄積]      │    │
│  │ [手動編集]      │  │                 │  │                 │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
│          │                    │                    │              │
│          │                    │                    │              │
│          ▼                    ▼                    ▼              │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    AI PM / CEO Agent                         │  │
│  │  _codexを「憲法」、Memoryを「経験」として参照                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 正本（_codex）とMemoryの境界

| 情報タイプ | 保存先 | 理由 |
|-----------|--------|------|
| 人物の定義（名前、役割、RACI） | `_codex/common/meta/people/` | **正本**。変更には人間の承認が必要 |
| 人物の嗜好（報告形式、コミュニケーションスタイル） | mana Memory (Semantic) | **学習**。対話から自動推定、確度付き |
| プロジェクト戦略・KPI定義 | `_codex/projects/<name>/project.md` | **正本**。意思決定の根拠 |
| プロジェクトの進捗・状況 | mana Memory (Episodic) | **観察**。対話・会議から自動記録 |
| 組織構造・RACI | `_codex/common/meta/raci/` | **正本**。権限の根拠 |
| 過去の判断事例 | mana Memory (Episodic) | **学習**。類似ケースの参照用 |

### 原則

1. **_codexが憲法、Memoryが経験**: _codexのルール・定義が優先。Memoryは補助的な文脈提供
2. **Memoryは上書きしない**: 学習した嗜好が_codexの定義と矛盾する場合、_codexを優先
3. **昇華パス**: 高確度で繰り返し確認された学習内容は、人間の承認を経て_codexに昇華可能

### 3層アーキテクチャとの対応

```
┌─────────────────────────────────────────────────────────────────────┐
│  L3: CEO Agent                                                       │
│  ├─ Memory: 経営判断履歴、全プロジェクト俯瞰の学習                    │
│  └─ Scope: 全ワークスペース横断                                       │
├─────────────────────────────────────────────────────────────────────┤
│  L2: Project AI PM (per workspace)                                   │
│  ├─ Memory: プロジェクト固有の対話履歴、チームメンバー嗜好            │
│  └─ Scope: ワークスペース内のプロジェクト群                           │
├─────────────────────────────────────────────────────────────────────┤
│  L1: mana (Slack Gateway)                                            │
│  ├─ Memory: なし（ステートレス）                                      │
│  └─ Scope: イベント受信・ルーティングのみ                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Memory階層とアクセス制御

| 層 | Memory所有者 | アクセス可能範囲 |
|----|-------------|-----------------|
| L3 | CEO Agent | 全L2のMemory（読み取り）+ 自身のMemory（読み書き） |
| L2 | AI PM | 自ワークスペースのMemory（読み書き）+ L3への報告 |
| L1 | なし | ステートレス |

## 参考文献

- [From Human Memory to AI Memory: A Survey on Memory Mechanisms in the Era of LLMs](https://arxiv.org/html/2504.15965v2) - 3D-8Q分類法
- [In Prospect and Retrospect: Reflective Memory Management](https://arxiv.org/abs/2503.08026) - RMM
- [CoALA: Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427) - 認知アーキテクチャ

## Mastra標準メモリ機能の採用

### 採用理由

Mastra標準メモリは[LongMemEvalベンチマークで80%精度](https://mastra.ai/blog/changelog-2025-07-17)を達成しており、
[Mem0（66.9%）やOpenAI Memory（52.9%）](https://mem0.ai/blog/benchmarked-openai-memory-vs-langmem-vs-memgpt-vs-mem0-for-long-term-memory-here-s-how-they-stacked-up)を上回る。
独自実装よりもMastra標準機能を活用する方が、保守性・性能の両面で優れている。

### Mastra標準の3つのメモリ機能

```
┌─────────────────────────────────────────────────────────────────┐
│                    mana Memory System (Mastra標準)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Working Memory  │  │ Conversation    │  │ Semantic Recall │ │
│  │                 │  │ History         │  │                 │ │
│  │ ユーザー嗜好・  │  │                 │  │ 過去の関連      │ │
│  │ 目標を構造化    │  │ 直近N件の       │  │ メッセージを    │ │
│  │ 保存            │  │ メッセージ履歴  │  │ ベクトル検索    │ │
│  │                 │  │                 │  │                 │ │
│  │ [Zodスキーマ]   │  │ [lastMessages]  │  │ [Vector DB]     │ │
│  │ [DynamoDB]      │  │ [DynamoDB]      │  │ [Pinecone]      │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
│                              +                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Procedural Memory (brainbase)                   ││
│  │                                                             ││
│  │  • エージェント指示（instructions）                          ││
│  │  • ツール定義（tools/）                                      ││
│  │  • brainbaseナレッジ（_codex/）                              ││
│  │                                                             ││
│  │  ※ Mastra外部。コードとドキュメントで管理                    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 認知科学との対応

| 認知科学の概念 | Mastra機能 | 実装 |
|--------------|-----------|------|
| 作業記憶 | Working Memory | Zodスキーマで構造化 |
| エピソード記憶 | Conversation History + Semantic Recall | DynamoDB + ベクトル検索 |
| 意味記憶 | Working Memory（構造化データ） | Zodスキーマのプロファイル |
| 手続き記憶 | Procedural Memory | brainbase/_codex |

## 各メモリ機能の詳細設計

### 1. Working Memory（作業記憶）

[Mastra Working Memory](https://mastra.ai/docs/memory/working-memory)を使用。

**目的**: ユーザー嗜好・目標・プロファイルを構造化して永続保存

**Zodスキーマ設計**:
```typescript
import { z } from 'zod';

// ユーザープロファイルスキーマ
export const userProfileSchema = z.object({
  // 基本情報
  name: z.string().optional().describe('ユーザーの名前'),
  role: z.string().optional().describe('役割（PM、エンジニア等）'),

  // 嗜好
  preferences: z.object({
    reportingStyle: z.enum(['bullet_points', 'prose', 'numbered_list']).optional()
      .describe('報告形式の好み'),
    communicationTone: z.enum(['formal', 'casual', 'concise']).optional()
      .describe('コミュニケーションのトーン'),
    reminderTiming: z.string().optional()
      .describe('リマインドの好みの時間帯'),
  }).optional(),

  // 現在のコンテキスト
  currentContext: z.object({
    activeProject: z.string().optional().describe('現在フォーカス中のプロジェクト'),
    currentGoal: z.string().optional().describe('現在の目標'),
    blockers: z.array(z.string()).optional().describe('現在の障害'),
  }).optional(),

  // 学習した事実
  learnedFacts: z.array(z.object({
    fact: z.string().describe('学習した事実'),
    confidence: z.number().min(0).max(1).describe('確度'),
    source: z.string().optional().describe('情報源'),
    learnedAt: z.string().optional().describe('学習日時'),
  })).optional(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;
```

**スコープ設定**:
```typescript
workingMemory: {
  enabled: true,
  scope: 'resource',  // ユーザー単位で全スレッド共有
  template: userProfileSchema,
}
```

**保存内容**:
- ユーザーの名前・役割
- 報告形式・コミュニケーションスタイルの好み
- 現在フォーカス中のプロジェクト・目標
- 対話から学習した事実（確度付き）

### 2. Conversation History（会話履歴）

**目的**: 直近の会話コンテキストを保持

**設定**:
```typescript
options: {
  lastMessages: 20,  // 直近20メッセージを保持
}
```

**保存内容**:
- ユーザーメッセージ
- エージェント応答
- ツール呼び出し結果

### 3. Semantic Recall（セマンティック検索）

[Mastra Semantic Recall](https://mastra.ai/docs/memory/semantic-recall)を使用。

**目的**: 過去の関連メッセージをベクトル検索で取得

**設定**:
```typescript
options: {
  semanticRecall: {
    topK: 3,           // 類似メッセージ3件を取得
    messageRange: 2,   // 前後2メッセージを含める
    scope: 'resource', // ユーザー単位で全スレッド検索
  },
}
```

**ベクトルDB選択**:
- 本番: Pinecone（スケーラビリティ、マネージド）
- 開発: LibSQL（ローカル、セットアップ不要）

### 4. Procedural Memory（手続き記憶）

**Mastra外部で管理**。brainbaseの`_codex/`とエージェントコードで実装。

**実装箇所**:
- `instructions`: エージェントの基本指示
- `tools/`: 利用可能なツール定義
- `_codex/`: プロジェクト知識、ルール、RACI

## ストレージ構成

### DynamoDB（会話履歴・Working Memory）

[@mastra/dynamodb](https://mastra.ai/reference/storage/dynamodb)を使用。Single-table designパターンを採用。

**テーブル構造**:
既存の`mana-memory`テーブルを使用（TABLE_SETUP.md参照）。

**制限事項**:
- resource-scoped Working Memoryは**非対応**（DynamoDBの制限）
- Semantic Recallには別途ベクトルDBが必要

**workspaceId定義**:
```yaml
# config.ymlのworkspace設定を参照
workspaces:
  unson:           # WS#unson
    slack_team_id: T0XXXXXXX
    projects: [salestailor, zeims, senrigan, ...]
  tech-knight:     # WS#tech-knight
    slack_team_id: T0YYYYYYY
    projects: [aitle, hp-sales, ...]
```

### ベクトルDB（Semantic Recall）

**本番環境**: Pinecone
```typescript
import { PineconeVector } from '@mastra/pinecone';

const vector = new PineconeVector({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
  indexName: 'mana-memory',
});
```

**開発環境**: LibSQL（ローカル）
```typescript
import { LibSQLVector } from '@mastra/libsql';

const vector = new LibSQLVector({
  connectionUrl: 'file:./local.db',
});
```

### 3層アーキテクチャとストレージの対応

| 層 | Storage | Vector | Working Memory Scope |
|----|---------|--------|---------------------|
| L3 CEO Agent | DynamoDB | Pinecone | resource（全WS横断）|
| L2 AI PM | DynamoDB | Pinecone | thread（WS内）|
| L1 mana | なし | なし | なし（ステートレス）|

## 処理フロー

### Mastra標準のメモリフロー

Mastraは自動でメモリを管理。独自のMemory Processorは不要。

```
┌─────────────┐     ┌─────────────────────────────────────┐     ┌─────────────┐
│  ユーザー   │────▶│           Mastra Agent              │────▶│   応答     │
│   入力     │     │                                     │     │   生成     │
└─────────────┘     │  ┌─────────────────────────────┐   │     └─────────────┘
                    │  │      Memory (自動管理)       │   │
                    │  │                             │   │
                    │  │  1. 入力時:                  │   │
                    │  │     - Working Memory読込    │   │
                    │  │     - 会話履歴取得          │   │
                    │  │     - Semantic Recall実行   │   │
                    │  │                             │   │
                    │  │  2. 応答後:                  │   │
                    │  │     - メッセージ保存        │   │
                    │  │     - ベクトル埋め込み生成  │   │
                    │  │     - Working Memory更新    │   │
                    │  │       (updateWorkingMemory  │   │
                    │  │        ツール経由)          │   │
                    │  └─────────────────────────────┘   │
                    └─────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │           Storage Layer             │
                    │                                     │
                    │  ┌───────────┐    ┌───────────┐    │
                    │  │ DynamoDB  │    │ Pinecone  │    │
                    │  │           │    │           │    │
                    │  │ • Threads │    │ • Vectors │    │
                    │  │ • Messages│    │ • Index   │    │
                    │  │ • Working │    │           │    │
                    │  │   Memory  │    │           │    │
                    │  └───────────┘    └───────────┘    │
                    └─────────────────────────────────────┘
```

### Working Memory更新の仕組み

Mastraは`updateWorkingMemory`ツールを自動で提供。エージェントが対話中に重要な情報を学習すると、このツールを呼び出してWorking Memoryを更新。

```typescript
// エージェントが自動で呼び出す（明示的な実装不要）
// 例: ユーザーが「報告は箇条書きでお願い」と言った場合
// → updateWorkingMemory({ preferences: { reportingStyle: 'bullet_points' } })
```

## 実装フェーズ

### Phase 1: 基盤構築 ✅
- [x] DynamoDB テーブル作成（mana-memory）
- [x] Mastra Memory基本設定（lastMessages: 20）
- [x] @mastra/dynamodb導入

### Phase 2: Working Memory強化 ✅
- [x] Zodスキーマ（userProfileSchema）の実装（TDD）
  - memory-schema.ts / memory-schema.js
  - 22テストケース
- [x] エージェントへのWorking Memory設定追加
  - workspace-mana-agent.ts: memory統合済
  - base-pm-agent.ts: memory統合済
- [x] instructionsにWorking Memory学習指示追加
  - 学習対象: 報告形式、コミュニケーションスタイル、フォーカス、ブロッカー
  - 学習タイミング: 明示的な好み、繰り返し要求
- [x] 昇華判定ロジック（isEligibleForPromotion, getPromotionCandidates）

### Phase 3: Semantic Recall導入（保留）
- [x] ベクトルDB選定: PostgreSQL + pgvector
- [x] semantic-memory.ts / semantic-memory.js 作成（11テストケース）
- [x] @mastra/pg, @mastra/fastembed インストール済
- [ ] **保留**: まずWorking Memoryのみで運用し、必要性を検証
- [ ] 将来的にAWS RDS PostgreSQL or Neon DBで有効化可能

### Phase 4: 3層アーキテクチャ対応（部分完了）
- [x] L2 AI PM (base-pm-agent): memory統合済
- [x] L1 Mana (workspace-mana-agent): memory統合済
- [ ] L3 CEO Agent: 未実装
- [ ] ワークスペース間のメモリ分離確認

### Phase 5: 昇華パスの実装（オプション）
- [x] 高確度ファクトの検出ロジック（isEligibleForPromotion）
- [x] 昇華候補抽出（getPromotionCandidates）
- [ ] 昇華候補のレポート生成
- [ ] _codexへのPR作成自動化

## 昇華パス（Memory → _codex）

Working Memoryで学習した高確度の事実は、人間の承認を経て`_codex`に昇華可能。

### 昇華基準

| 基準 | 閾値 |
|------|-----|
| confidence | >= 0.9 |
| 確認回数 | >= 3回 |
| 矛盾なし | _codex既存情報と整合 |

### 昇華フロー

```
┌─────────────────┐
│ Working Memory  │
│ learnedFacts[]  │
└────────┬────────┘
         │ 高確度ファクト検出
         ▼
┌─────────────────┐
│  昇華候補リスト  │
│ （週次レポート） │
└────────┬────────┘
         │ 人間レビュー
         ▼
┌─────────────────┐
│  GitHub PR作成  │
│ _codex/へ追記   │
└────────┬────────┘
         │ マージ
         ▼
┌─────────────────┐
│   _codex更新    │
│  （正本に昇華）  │
└─────────────────┘
```

### 昇華例

```
Working Memory:
  learnedFacts:
    - fact: "佐藤は箇条書き形式の報告を好む"
      confidence: 0.95
      confirmedCount: 5

↓ 昇華

_codex/common/meta/people/sato.md:
  preferences:
    reporting_style: bullet_points  # ← 追記
```

## 環境変数

```bash
# DynamoDB（必須）
MANA_MEMORY_TABLE=mana-memory
AWS_REGION=us-east-1

# ベクトルDB（Phase 3で追加）
# Option A: Pinecone
PINECONE_API_KEY=xxx
PINECONE_ENVIRONMENT=us-east-1

# Option B: OpenAI Embeddings
OPENAI_API_KEY=sk-xxx
```

## 制約事項

1. **DynamoDB制限**: resource-scoped Working Memoryは非対応。thread-scopedを使用
2. **ベクトルDB必須**: Semantic Recallを使う場合は別途ベクトルDB設定が必要
3. **コスト考慮**:
   - DynamoDB: PAY_PER_REQUEST
   - Pinecone: Free tierで1インデックス
   - OpenAI Embeddings: $0.0001/1K tokens
4. **レイテンシ**: Semantic Recall有効時は応答に+0.5〜1秒

## 次のアクション

1. Phase 2: Working Memory Zodスキーマの実装
2. Phase 3: ベクトルDB選定・導入
3. 既存memory.tsの更新（Working Memory + Semantic Recall追加）
