// mastra/test-schema.ts
// Zodスキーマのテスト

// Zod v4を使用（Mastraの内部と一致させる）
import { z } from 'zod/v4';

// テスト対象のスキーマ
// blocksありバージョン
const slackPostMessageSchema = z.object({
  channel: z.string().describe('チャンネルID'),
  text: z.string().describe('メッセージ本文'),
  threadTs: z.string().optional().describe('スレッドのタイムスタンプ（返信時）'),
  // blocks削除（Zod v4でz.unknown()がtoJSONSchemaで失敗するため）
});

const githubAppendTaskSchema = z.object({
  title: z.string().describe('タスクタイトル'),
  projectId: z.string().describe('プロジェクトID（例: salestailor, zeims）'),
  assignee: z.string().describe('担当者名（brainbase表記）'),
  due: z.string().optional().describe('期限（YYYY-MM-DD）'),
  context: z.string().optional().describe('背景・詳細'),
  slackLink: z.string().optional().describe('Slackメッセージへのリンク'),
});

async function testSchemaConversion() {
  console.log('Testing Zod schema conversion...\n');

  try {
    // Zod v4のtoJSONSchemaを使う
    const { toJSONSchema } = await import('zod/v4');

    console.log('1. Testing slackPostMessageSchema...');
    const slackJson = toJSONSchema(slackPostMessageSchema);
    console.log('   ✓ Success:', JSON.stringify(slackJson, null, 2).substring(0, 200) + '...\n');

    console.log('2. Testing githubAppendTaskSchema...');
    const githubJson = toJSONSchema(githubAppendTaskSchema);
    console.log('   ✓ Success:', JSON.stringify(githubJson, null, 2).substring(0, 200) + '...\n');

    console.log('All tests passed!');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testSchemaConversion();
