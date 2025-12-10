// mastra/config/memory.ts
// Mastra Memory設定 - 会話履歴・コンテキスト管理（DynamoDB永続化）

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

// Memory設定（DynamoDB永続化）
export const memory = new Memory({
  storage,
  options: {
    lastMessages: 20, // 直近20メッセージを保持
    // semanticRecall: {
    //   topK: 5,         // 関連メッセージ上位5件を取得（ベクトル検索が必要）
    //   messageRange: {
    //     before: 10,
    //     after: 2,
    //   },
    // },
  },
});

export default memory;
