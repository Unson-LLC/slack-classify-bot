// mastra/config/memory.ts
// Mastra Memory設定 - 会話履歴・コンテキスト管理（DynamoDB永続化）
// Working Memory: ユーザー嗜好・コンテキストのZodスキーマベース管理
import { Memory } from '@mastra/memory';
import { DynamoDBStore } from '@mastra/dynamodb';
// DynamoDB Storage設定
// テーブルは事前に作成が必要（TABLE_SETUP.md参照）
const storage = new DynamoDBStore({
    name: 'dynamodb',
    config: {
        id: 'mana-memory-store',
        tableName: process.env.MANA_MEMORY_TABLE || 'mana-memory',
        region: process.env.AWS_REGION || 'us-east-1',
    },
});
// Memory設定（DynamoDB永続化 + Working Memory）
// Semantic Recallは将来的に有効化可能（semantic-memory.ts参照）
export const memory = new Memory({
    storage,
    options: {
        lastMessages: 20, // 直近20メッセージを保持
        // Working Memory一時無効化（Bedrock互換性問題 - GitHub Issue #5935）
        // TODO: Mastra側のBedrock対応が修正されたら再有効化
        // workingMemory: {
        //   enabled: true,
        //   schema: userProfileSchema, // Zodスキーマでユーザープロファイルを管理
        // },
    },
});
// スキーマ・ユーティリティの再エクスポート
export { userProfileSchema, preferencesSchema, currentContextSchema, learnedFactSchema, isEligibleForPromotion, getPromotionCandidates, PROMOTION_THRESHOLDS, } from './memory-schema.js';
// Semantic Recall設定（将来的に有効化する場合は以下を使用）
// import { SEMANTIC_RECALL_DEFAULTS, createSemanticMemory } from './semantic-memory';
export default memory;
//# sourceMappingURL=memory.js.map