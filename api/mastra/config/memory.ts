// mastra/config/memory.ts
// Mastra Memory設定 - 会話履歴・コンテキスト管理（DynamoDB永続化）
// Working Memory: ユーザー嗜好・コンテキストのZodスキーマベース管理

import { Memory } from '@mastra/memory';
import { DynamoDBStore } from '@mastra/dynamodb';
import { userProfileSchema } from './memory-schema.js';

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
    // Working Memory有効化（GitHub Issue #5935 解決済み - Zod v3系で動作）
    workingMemory: {
      enabled: true,
      schema: userProfileSchema, // Zodスキーマでユーザープロファイルを管理
      scope: 'resource', // ユーザー単位で全スレッド共有（resourceId = Slack User ID）
    },
  },
});

// Working Memoryの設定オブジェクト（getWorkingMemory呼び出し用）
const workingMemoryConfig = {
  lastMessages: 20,
  workingMemory: {
    enabled: true,
    schema: userProfileSchema,
    scope: 'resource' as const,
  },
};

/**
 * ユーザーのWorking Memoryを取得する
 * @param resourceId - Slack User ID（例: U07LNUP582X）
 * @returns UserProfile（JSON文字列をパース）またはnull
 */
export async function getUserWorkingMemory(
  resourceId: string
): Promise<import('./memory-schema.js').UserProfile | null> {
  try {
    // resource-scopedの場合、threadIdは任意の値でOK（resourceIdで識別される）
    const workingMemoryStr = await memory.getWorkingMemory({
      threadId: `resource:${resourceId}`,
      resourceId,
      memoryConfig: workingMemoryConfig,
    });

    if (!workingMemoryStr) {
      return null;
    }

    return JSON.parse(workingMemoryStr);
  } catch (error) {
    console.error(`Failed to get working memory for ${resourceId}:`, error);
    return null;
  }
}

/**
 * ユーザーのリマインド希望時刻を取得する
 * @param resourceId - Slack User ID
 * @returns HH:mm形式の時刻文字列、または未設定の場合null
 */
export async function getUserReminderTiming(
  resourceId: string
): Promise<string | null> {
  const profile = await getUserWorkingMemory(resourceId);
  return profile?.preferences?.reminderTiming ?? null;
}

// スキーマ・ユーティリティの再エクスポート
export {
  userProfileSchema,
  preferencesSchema,
  currentContextSchema,
  learnedFactSchema,
  isEligibleForPromotion,
  getPromotionCandidates,
  PROMOTION_THRESHOLDS,
} from './memory-schema.js';

export type {
  UserProfile,
  Preferences,
  CurrentContext,
  LearnedFact,
} from './memory-schema.js';

// Semantic Recall設定（将来的に有効化する場合は以下を使用）
// import { SEMANTIC_RECALL_DEFAULTS, createSemanticMemory } from './semantic-memory';

export default memory;
