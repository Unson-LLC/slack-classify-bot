// mastra/config/memory.ts
// Mastra Memory設定 - 会話履歴・コンテキスト管理

import { Memory } from '@mastra/memory';

// Memory設定
// DynamoDBやLibSQLを使う場合はadapterを指定
// デフォルトはin-memory（Lambda再起動で消える）

// TODO: 永続化が必要な場合はDynamoDB adapterに切り替え
// import { DynamoDBAdapter } from '@mastra/memory-dynamodb';
// const adapter = new DynamoDBAdapter({
//   tableName: 'mana-memory',
//   region: 'us-east-1',
// });

export const memory = new Memory({
  // options: {
  //   lastMessages: 20,  // 直近20メッセージを保持
  //   semanticRecall: {
  //     topK: 5,         // 関連メッセージ上位5件を取得
  //     messageRange: {
  //       before: 10,
  //       after: 2,
  //     },
  //   },
  // },
});

export default memory;
