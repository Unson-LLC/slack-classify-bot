// mastra/test-integration.js
// Mastra統合テスト - llm-integration.jsとの連携確認

// 環境変数設定
process.env.AWS_REGION = 'us-east-1';
process.env.LLM_PROVIDER = 'bedrock';
process.env.USE_MASTRA = 'true';

async function testIntegration() {
  console.log('=== Mastra 統合テスト ===\n');
  console.log('USE_MASTRA:', process.env.USE_MASTRA);

  try {
    // 1. llm-integration.jsの読み込み
    console.log('\n--- 1. llm-integration.js 読み込みテスト ---');
    const llmIntegration = require('../llm-integration.js');
    console.log('llm-integration.js loaded successfully');
    console.log('Available functions:', Object.keys(llmIntegration));

    // 2. Mastraブリッジの確認
    console.log('\n--- 2. Mastraブリッジ確認 ---');
    const bridge = require('../dist/mastra/bridge.js');
    console.log('Bridge functions:', Object.keys(bridge));
    console.log('mastra instance:', bridge.mastra ? 'OK' : 'NG');

    // 3. 関数の型チェック
    console.log('\n--- 3. 関数型チェック ---');
    console.log('summarizeText:', typeof llmIntegration.summarizeText);
    console.log('generateMeetingMinutes:', typeof llmIntegration.generateMeetingMinutes);
    console.log('extractTaskFromMessage:', typeof llmIntegration.extractTaskFromMessage);

    // 4. 軽量な呼び出しテスト（実際のLLM呼び出しはしない）
    console.log('\n--- 4. 空入力テスト ---');
    const emptyResult1 = await llmIntegration.summarizeText('');
    console.log('summarizeText(""):', emptyResult1 === null ? 'OK (null)' : 'NG');

    const emptyResult2 = await llmIntegration.generateMeetingMinutes('');
    console.log('generateMeetingMinutes(""):', emptyResult2 === null ? 'OK (null)' : 'NG');

    const emptyResult3 = await llmIntegration.extractTaskFromMessage('');
    console.log('extractTaskFromMessage(""):', emptyResult3 === null ? 'OK (null)' : 'NG');

    console.log('\n=== テスト完了: 成功 ===');
    return true;
  } catch (error) {
    console.error('\n=== テスト失敗 ===');
    console.error('エラー:', error.message);
    console.error('スタック:', error.stack);
    return false;
  }
}

testIntegration().then(success => {
  process.exit(success ? 0 : 1);
});
